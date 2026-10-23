const { spawn } = require('node:child_process');

// Use yt-dlp's selected (and checked) format, not a second bitrate ranking of
// info.formats that could pick a rejected URL or discard a working HLS fallback.
function selectAudioStream(info, playerClient) {
  const selected = info?.url ? info : info?.requested_downloads?.find((format) => format.url);
  if (!selected?.url || !/^https?:\/\//i.test(selected.url)) return null;
  return {
    url: selected.url,
    headers: { ...info.http_headers, ...selected.http_headers },
    playerClient,
  };
}

function hasFreshAudioStream(song, now = Date.now()) {
  if (!song?.prefetchedAudioStream?.url) return false;
  let expiresAt = 0;
  try {
    expiresAt = Number(new URL(song.prefetchedAudioStream.url).searchParams.get('expire')) * 1000;
  } catch { return false; }
  if (!expiresAt) expiresAt = (song.prefetchedAt || 0) + 3 * 3600 * 1000;
  return expiresAt - now > 10 * 60 * 1000;
}

function buildFfmpegArgs(stream, seekSeconds = 0, volume = 1) {
  const args = [
    '-loglevel', 'warning',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    // Authentication failures need a new stream/client; retrying the same 403
    // URL only leaves the bot connected and silent for longer.
    '-reconnect_on_http_error', '429,5xx',
    '-reconnect_delay_max', '5',
    '-rw_timeout', '15000000',
    '-thread_queue_size', '8192',
  ];
  const headers = Object.entries(stream.headers || {})
    .filter(([name, value]) => /^[\w-]+$/.test(name) && typeof value === 'string' && !/[\r\n\0]/.test(value))
    .map(([name, value]) => `${name}: ${value}\r\n`).join('');
  if (headers) args.push('-headers', headers);
  if (seekSeconds > 0) args.push('-ss', String(seekSeconds));
  args.push('-i', stream.url, '-vn', '-probesize', '65536', '-analyzeduration', '1000000');
  if (Math.abs(volume - 1) > 0.001) args.push('-af', `volume=${volume.toFixed(2)}`);
  args.push(
    '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-application', 'audio',
    '-frame_duration', '20', '-fec', '1', '-packet_loss', '10',
    '-ar', '48000', '-ac', '2', '-f', 'ogg', 'pipe:1',
  );
  return args;
}

function redactMediaUrls(message) {
  return String(message).replace(/https?:\/\/[^\s]+/g, '[media URL]');
}

function spawnAudioProcess(stream, seekSeconds, volume, spawnProcess = spawn) {
  const child = spawnProcess('ffmpeg', buildFfmpegArgs(stream, seekSeconds, volume), { windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-8192); });
  // Keep the error listener after startup too, so a late process error cannot
  // become an unhandled EventEmitter error.
  child.on('error', (err) => { child.audioError = err; });
  child.on('exit', (code) => {
    if (code) child.audioError = new Error(`FFmpeg exited with code ${code}: ${redactMediaUrls(stderr.trim())}`);
  });
  child.getAudioError = () => child.audioError || new Error(
    `FFmpeg produced no playable audio${stderr.trim() ? `: ${redactMediaUrls(stderr.trim())}` : ''}`,
  );
  return child;
}

// Observe buffered bytes without consuming the Ogg header that Discord needs.
function waitForAudio(child, signal, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (err) => {
      clearTimeout(timer);
      child.stdout.off('readable', onReadable);
      child.stdout.off('end', onEnd);
      child.off('close', onEnd);
      child.off('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onReadable = () => { if (child.stdout.readableLength > 0) finish(); };
    const onEnd = () => finish(child.getAudioError());
    const onError = (err) => finish(err);
    const onAbort = () => finish(signal.reason);
    child.stdout.on('readable', onReadable);
    child.stdout.once('end', onEnd);
    child.once('close', onEnd);
    child.once('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(new Error('FFmpeg timed out preparing audio')), timeoutMs);
    if (signal?.aborted) onAbort();
    else if (child.audioError || child.exitCode != null) onEnd();
    else onReadable();
  });
}

// Resolves once the player is actually playing THIS resource. A loading sound
// can already have the player in Playing, so the status alone proves nothing.
function waitForResourcePlaying(player, resource, signal) {
  const isPlaying = () => player.state.status === 'playing' && player.state.resource === resource;
  return new Promise((resolve, reject) => {
    const finish = (err) => {
      player.off('playing', onPlaying);
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onPlaying = () => { if (isPlaying()) finish(); };
    const onAbort = () => finish(signal.reason);
    player.on('playing', onPlaying);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else onPlaying();
  });
}

// Waits for a task that something else owns (such as a prefetch) without
// keeping a cancelled playback alive.
function untilAborted(task, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(task).then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

// A successful extraction is only a candidate: the consumer must start actual
// playback before we accept it. A failed cache is retried with fresh extraction.
async function prepareAudio({ cachedStream, clients, extract, start, signal, onFailure = () => {} }) {
  let lastError = new Error('yt-dlp did not return an audio URL');
  const attempts = [...(cachedStream ? [null] : []), ...clients];
  for (const client of attempts) {
    signal?.throwIfAborted();
    let stream;
    try {
      stream = client === null ? cachedStream : await extract(client);
      signal?.throwIfAborted();
      if (!stream) throw new Error('yt-dlp did not return an audio URL');
      const playback = await start(stream);
      signal?.throwIfAborted();
      return { stream, playback };
    } catch (err) {
      signal?.throwIfAborted();
      lastError = err;
      onFailure(err, stream?.playerClient || client, client === null);
    }
  }
  throw lastError;
}

module.exports = {
  buildFfmpegArgs, hasFreshAudioStream, prepareAudio, redactMediaUrls,
  selectAudioStream, spawnAudioProcess, untilAborted, waitForAudio, waitForResourcePlaying,
};
