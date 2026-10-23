const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { sendPlaybackNotice } = require('../playback-notifications');
const {
  buildFfmpegArgs, hasFreshAudioStream, prepareAudio, redactMediaUrls,
  selectAudioStream, spawnAudioProcess, waitForAudio,
} = require('../audio');

test('keeps the checked HLS selection and its headers instead of repicking a rejected WebM', () => {
  const stream = selectAudioStream({
    url: 'https://media.example/audio.m3u8',
    http_headers: { 'User-Agent': 'yt-dlp browser', Referer: 'https://www.youtube.com/' },
    formats: [{ url: 'https://media.example/forbidden', acodec: 'opus', vcodec: 'none', ext: 'webm', abr: 160 }],
  }, 'web_safari');
  assert.equal(stream.url, 'https://media.example/audio.m3u8');
  assert.equal(stream.playerClient, 'web_safari');
  const args = buildFfmpegArgs(stream, 12, 0.6);
  assert.match(args[args.indexOf('-headers') + 1], /User-Agent: yt-dlp browser\r\n/);
  assert.match(args[args.indexOf('-headers') + 1], /Referer: https:\/\/www.youtube.com\/\r\n/);
  assert.ok(args.indexOf('-headers') < args.indexOf('-i'));
  assert.equal(args[args.indexOf('-ss') + 1], '12');
  assert.equal(args[args.indexOf('-af') + 1], 'volume=0.60');
  assert.equal(args[args.indexOf('-reconnect_on_http_error') + 1], '429,5xx');
});

test('supports requested downloads, preserves per-format headers, and rejects unselected/local formats', () => {
  assert.deepEqual(selectAudioStream({
    http_headers: { Referer: 'https://www.youtube.com/', 'User-Agent': 'default' },
    requested_downloads: [{ url: 'https://media.example/audio', http_headers: { 'User-Agent': 'selected' } }],
  }, 'mweb').headers, { Referer: 'https://www.youtube.com/', 'User-Agent': 'selected' });
  assert.equal(selectAudioStream({ formats: [{ url: 'https://media.example/unselected' }] }), null);
  assert.equal(selectAudioStream({ url: 'file:///etc/passwd' }), null);
  const args = buildFfmpegArgs({ url: 'https://media.example/audio', headers: { Good: 'ok', Bad: 'x\r\nInjected: y' } });
  assert.equal(args[args.indexOf('-headers') + 1], 'Good: ok\r\n');
});

test('accepts the checked combined WEB format when audio-only formats are unavailable', () => {
  const stream = selectAudioStream({
    url: 'https://media.example/combined', format_id: '18', ext: 'mp4',
    vcodec: 'avc1.42001E', acodec: 'mp4a.40.2',
    http_headers: { 'User-Agent': 'selected web client' },
  }, 'default');
  assert.ok(stream);
  assert.equal(stream.playerClient, 'default');
  const args = buildFfmpegArgs(stream);
  assert.equal(args[args.indexOf('-i') + 1], stream.url);
  assert.ok(args.includes('-vn'), 'FFmpeg strips video from the combined format');
});

function extractorConfig(cookies = null, manualToken = null) {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8').replace(/\r\n/g, '\n');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  return vm.runInNewContext([
    section('const PLAYER_CLIENT_CHAINS =', 'const YTDLP_ATTEMPT_TIMEOUT_MS'),
    section('function getYtdlpBaseOptions(', '// youtube-dl-exec exposes'),
    section('function getPlayerClientChains(', 'async function setVoiceChannelStatus('),
    '({ getPlayerClientChains, getYtdlpBaseOptions })',
  ].join('\n'), { tempCookiesPath: cookies, YTDLP_PO_TOKEN: manualToken, process: { env: {} } });
}

test('production client selection includes default separately with and without cookies', () => {
  for (const cookies of [null, '/app/data/cookies.txt']) {
    const config = extractorConfig(cookies);
    const clients = Array.from(config.getPlayerClientChains());
    assert.deepEqual(clients.slice(0, 2), ['mweb', 'default']);
    assert.equal(clients.includes('android_vr'), !cookies);
    assert.ok(clients.every((name) => !name.includes(',')));
    assert.equal(config.getYtdlpBaseOptions('default').extractorArgs[0], 'youtube:player_client=default');
    assert.equal(Boolean(config.getYtdlpBaseOptions('default').cookies), Boolean(cookies));
  }
});

test('default clients use provider tokens rather than an invalid default.gvs namespace', () => {
  const config = extractorConfig('/app/data/cookies.txt', 'manual-test-token');
  assert.match(config.getYtdlpBaseOptions('mweb').extractorArgs[0], /po_token=mweb\.gvs\+manual-test-token/);
  assert.equal(config.getYtdlpBaseOptions('default').extractorArgs[0], 'youtube:player_client=default');
  assert.equal(config.getYtdlpBaseOptions('default').extractorArgs[1], 'youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416');
});

test('checks cached stream expiry while keeping headers with the cached URL', () => {
  const now = Date.now();
  const song = { prefetchedAudioStream: { url: `https://media.example/audio?expire=${Math.floor(now / 1000) + 3600}`, headers: { Referer: 'youtube' } } };
  assert.equal(hasFreshAudioStream(song, now), true);
  assert.equal(hasFreshAudioStream(song, now + 55 * 60 * 1000), false);
  assert.equal(hasFreshAudioStream({ prefetchedAudioUrl: song.prefetchedAudioStream.url }, now), false);
});

test('tries another client when extraction succeeds but FFmpeg rejects its URL', async () => {
  const attempts = [];
  const result = await prepareAudio({
    clients: ['mweb', 'web_safari', 'web_embedded'],
    extract: async (playerClient) => ({ url: `https://media.example/${playerClient}`, playerClient }),
    start: async (stream) => {
      attempts.push(stream.playerClient);
      if (stream.playerClient === 'mweb') throw new Error('HTTP error 403 Forbidden');
      return 'playing';
    },
  });
  assert.deepEqual(attempts, ['mweb', 'web_safari']);
  assert.equal(result.playback, 'playing');
});

test('refreshes a rejected cache and bounds retries when every client fails', async () => {
  const cachedStream = { url: 'https://media.example/cached', playerClient: 'mweb' };
  const attempts = [];
  await assert.rejects(prepareAudio({
    cachedStream, clients: ['mweb', 'web_safari'],
    extract: async (playerClient) => ({ url: `https://media.example/fresh-${playerClient}`, playerClient }),
    start: async (stream) => { attempts.push(stream.url); throw new Error('HTTP error 403 Forbidden'); },
  }), /403/);
  assert.deepEqual(attempts, [cachedStream.url, 'https://media.example/fresh-mweb', 'https://media.example/fresh-web_safari']);
});

test('cancellation during extraction cannot start stale audio or try another client', async () => {
  const controller = new AbortController();
  let finishExtraction;
  let started = false;
  let failed = false;
  const task = prepareAudio({
    clients: ['mweb', 'web_safari'], signal: controller.signal,
    extract: () => new Promise((resolve) => { finishExtraction = resolve; }),
    start: async () => { started = true; },
    onFailure: () => { failed = true; },
  });
  controller.abort();
  finishExtraction({ url: 'https://media.example/stale' });
  await assert.rejects(task, { name: 'AbortError' });
  assert.equal(started, false);
  assert.equal(failed, false);
});

function fakeProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.kill = () => {};
  return child;
}

test('waits for bytes without consuming the Ogg header', async () => {
  const child = spawnAudioProcess({ url: 'https://media.example/audio' }, 0, 1, fakeProcess);
  let ready = false;
  const task = waitForAudio(child).then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  child.stdout.write('OggS');
  await task;
  assert.equal(child.stdout.read().toString(), 'OggS');
});

test('reports a 403 exit before audio and redacts signed URLs', async () => {
  const child = spawnAudioProcess({ url: 'https://media.example/audio' }, 0, 1, fakeProcess);
  const task = waitForAudio(child);
  child.stderr.write('HTTP error 403 Forbidden https://media.example/audio?sig=secret&pot=secret');
  child.emit('exit', 1);
  child.emit('close', 1);
  await assert.rejects(task, (err) => /403/.test(err.message) && !err.message.includes('secret'));
  assert.equal(redactMediaUrls('Failed https://media.example/?token=secret'), 'Failed [media URL]');
});

test('startup cannot hang on an empty stream, process error, timeout, or cancellation', async () => {
  for (const kind of ['empty', 'error', 'timeout', 'abort']) {
    const child = spawnAudioProcess({ url: 'https://media.example/audio' }, 0, 1, fakeProcess);
    const controller = new AbortController();
    const task = waitForAudio(child, controller.signal, 10);
    if (kind === 'empty') child.emit('close', 0);
    if (kind === 'error') child.emit('error', new Error('spawn ENOENT'));
    if (kind === 'abort') controller.abort();
    await assert.rejects(task);
    assert.equal(child.stdout.listenerCount('readable'), 0);
    assert.equal(child.listenerCount('close'), 0);
  }
});

test('a denied Discord playback notice is contained rather than crashing the bot', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(await sendPlaybackNotice({ textChannel: { send: async () => {
      throw Object.assign(new Error('Missing Access'), { code: 50001 });
    } } }, 'Playback stopped'), false);
    assert.match(warnings[0], /50001.*Missing Access/);
  } finally { console.warn = originalWarn; }
});

// Exercise the production orchestration and player event handlers without
// importing index.js's bot login, dashboard server, or environment credentials.
function playbackHarness(options = {}) {
  const { AudioPlayerStatus, entersState, StreamType } = require('@discordjs/voice');
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8').replace(/\r\n/g, '\n');
  const section = (start, end) => {
    assert.ok(source.indexOf(start) >= 0 && source.indexOf(end, source.indexOf(start)) >= 0);
    return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  };
  const player = new EventEmitter();
  player.state = { status: AudioPlayerStatus.Idle };
  player.play = (resource) => {
    player.state = { status: AudioPlayerStatus.Buffering, resource };
    if (!options.holdPlaying) setImmediate(() => player.start(resource));
  };
  player.start = (resource = player.state.resource) => {
    if (player.state.resource !== resource || !resource) return;
    player.state = { status: AudioPlayerStatus.Playing, resource };
    player.emit(AudioPlayerStatus.Playing);
  };
  player.stop = () => {
    const old = player.state;
    player.state = { status: AudioPlayerStatus.Idle };
    player.emit(AudioPlayerStatus.Idle, old);
  };
  const song = { id: 'song', title: 'Test song', url: 'https://www.youtube.com/watch?v=test' };
  const serverQueue = { guildId: 'guild', songs: [song], voiceChannel: { id: 'voice' }, player, textChannel: {
    send: async () => { if (options.denyMessages) throw new Error('Missing Access'); },
  } };
  const notices = [];
  const advanced = [];
  const processes = [];
  const extracted = [];
  const context = {
    serverQueue, queue: new Map([['guild', serverQueue]]), AbortController, AbortSignal, Date,
    AudioPlayerStatus, StreamType, entersState, hasFreshAudioStream, prepareAudio, redactMediaUrls, waitForAudio,
    console: { log() {}, warn() {}, error() {} }, stats: { totalSongsPlayed: 0 },
    clearIdleDisconnect() {}, getDefaultVolume: () => 100,
    getPlayerClientChains: () => options.clients || ['mweb', 'web_safari'],
    getPlayableUrl: async () => song.url,
    getAudioStream: async (url, [playerClient]) => {
      extracted.push(playerClient);
      if (options.extract) return options.extract(playerClient);
      return { url: `https://media.example/${playerClient}`, playerClient };
    },
    spawnAudioProcess: (stream, seek, volume) => {
      const child = spawnAudioProcess(stream, seek, volume, fakeProcess);
      child.kill = () => { child.killed = true; child.emit('exit', null); child.emit('close', null); };
      processes.push(child);
      setImmediate(() => {
        if (child.killed) return;
        if (options.failAll || (options.failFirst && stream.playerClient === 'mweb')) {
          child.stderr.write('HTTP error 403 Forbidden'); child.emit('exit', 1); child.emit('close', 1);
        } else child.stdout.write('OggS');
      });
      return child;
    },
    createAudioResource: (stdout, { metadata }) => ({ metadata }),
    postFreshNowPlaying: async () => notices.push('new'),
    showOrUpdateNowPlaying: async () => notices.push('update'),
    maybePrefetchNextSong() {}, updatePresence() {}, setVoiceChannelStatus() {},
    getElapsedSeconds: () => 17,
    sendPlaybackNotice: (q, content) => sendPlaybackNotice(q, content),
    advanceQueue: (...args) => {
      advanced.push(args);
      serverQueue.currentResource = null;
      context.cleanupCurrentProcess(serverQueue);
    },
  };
  vm.createContext(context);
  vm.runInContext([
    section('async function playSong(', 'async function getAudioStream('),
    section('function cleanupCurrentProcess(', 'function scheduleIdleDisconnect('),
    section('function skipQueue(', 'function stop('),
    'const queueConstruct = serverQueue; const guildId = "guild";',
    section('  queueConstruct.player.on(AudioPlayerStatus.Idle', '  try {\n    await entersState(connection'),
  ].join('\n'), context);
  return { context, player, serverQueue, song, notices, advanced, processes, extracted };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
async function waitUntil(predicate) {
  for (let turn = 0; turn < 50; turn++) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail('Playback did not reach the expected state');
}

test('production waits for Playing before announcing, and starts the resource once', async () => {
  const h = playbackHarness({ holdPlaying: true });
  const task = h.context.playSong('guild', h.song);
  await waitUntil(() => h.player.state.status === 'buffering');
  assert.equal(h.notices.length, 0);
  assert.equal(h.serverQueue.currentResource, null);
  h.player.start();
  assert.equal(await task, true);
  assert.equal(h.notices.length, 1);
  assert.equal(h.player.state.status, 'playing');
  h.context.cleanupCurrentProcess(h.serverQueue);
});

test('production retries a 403 without advancing or announcing the failed client', async () => {
  const h = playbackHarness({ failFirst: true });
  assert.equal(await h.context.playSong('guild', h.song), true);
  assert.deepEqual(h.extracted, ['mweb', 'web_safari']);
  assert.equal(h.notices.length, 1);
  assert.equal(h.advanced.length, 0);
  assert.equal(h.processes[0].killed, true);
  h.context.cleanupCurrentProcess(h.serverQueue);
});

test('production retries a forced-client API 403 using the default combined WEB format', async () => {
  const h = playbackHarness({
    clients: Array.from(extractorConfig('/app/data/cookies.txt').getPlayerClientChains()),
    extract: async (playerClient) => {
      if (playerClient === 'mweb') throw new Error('Unable to download API page: HTTP Error 403: Forbidden');
      assert.equal(playerClient, 'default');
      return selectAudioStream({
        url: 'https://media.example/format18', format_id: '18',
        vcodec: 'avc1.42001E', acodec: 'mp4a.40.2',
        http_headers: { 'User-Agent': 'selected web client' },
      }, playerClient);
    },
  });
  assert.equal(await h.context.playSong('guild', h.song), true);
  assert.deepEqual(h.extracted, ['mweb', 'default']);
  assert.equal(h.notices.length, 1);
  assert.equal(h.advanced.length, 0);
  assert.equal(h.song.prefetchedAudioStream.playerClient, 'default');
  h.context.cleanupCurrentProcess(h.serverQueue);
});

test('skip during extraction cancels the old task and advances exactly once', async () => {
  let resolveExtraction;
  const h = playbackHarness({ extract: () => new Promise((resolve) => { resolveExtraction = resolve; }) });
  const task = h.context.playSong('guild', h.song);
  await nextTurn();
  h.context.skipQueue(h.serverQueue);
  resolveExtraction({ url: 'https://media.example/stale', playerClient: 'mweb' });
  assert.equal(await task, false);
  assert.equal(h.advanced.length, 1);
  assert.equal(h.processes.length, 0);
  assert.equal(h.notices.length, 0);
});

test('rapid seeks cancel the older startup without killing the new process', async () => {
  const pending = [];
  const h = playbackHarness({ extract: () => new Promise((resolve) => pending.push(resolve)) });
  const first = h.context.playSong('guild', h.song, 10);
  await nextTurn();
  const second = h.context.playSong('guild', h.song, 20);
  await nextTurn();
  pending[1]({ url: 'https://media.example/current', playerClient: 'mweb' });
  assert.equal(await second, true);
  const currentProcess = h.serverQueue.currentProcess;
  pending[0]({ url: 'https://media.example/stale', playerClient: 'mweb' });
  assert.equal(await first, false);
  assert.equal(h.serverQueue.currentProcess, currentProcess);
  assert.equal(currentProcess.killed, undefined);
  assert.equal(h.advanced.length, 0);
  assert.equal(h.notices.length, 1);
  h.context.cleanupCurrentProcess(h.serverQueue);
});

test('a mid-song failure retries once, and exhausted clients advance without announcing success', async () => {
  const h = playbackHarness();
  assert.equal(await h.context.playSong('guild', h.song), true);
  h.processes[0].emit('exit', 1);
  await waitUntil(() => h.notices.length === 2);
  assert.deepEqual(h.extracted, ['mweb', 'web_safari']);
  assert.equal(h.advanced.length, 0);
  h.processes[1].emit('exit', 1);
  await nextTurn(); await nextTurn();
  assert.equal(h.advanced.length, 1);
  assert.equal(h.notices.length, 2, 'recovery updates the existing card');
  const failed = playbackHarness({ failAll: true });
  assert.equal(await failed.context.playSong('guild', failed.song), false);
  assert.equal(failed.advanced.length, 1);
  assert.equal(failed.notices.length, 0);
});

// This exercises the actual HTTP -> FFmpeg -> Ogg/Opus -> Discord player path,
// without logging in to Discord or depending on YouTube availability/cookies.
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0;
test('real FFmpeg retries a 403, forwards headers, and plays audio from a combined MP4', { skip: !hasFfmpeg }, async () => {
  const { createAudioPlayer, createAudioResource, entersState, AudioPlayerStatus, StreamType, NoSubscriberBehavior } = require('@discordjs/voice');
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '1', '-c:v', 'mpeg4', '-c:a', 'aac',
    '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1',
  ], { windowsHide: true, timeout: 10_000 });
  assert.equal(generated.status, 0, generated.stderr?.toString());
  const mp4 = generated.stdout;
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/blocked' || req.headers['user-agent'] !== 'audio-regression' || req.headers.referer !== 'https://www.youtube.com/') {
      res.writeHead(403).end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': mp4.length }).end(mp4);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  const processes = [];
  try {
    const { stream } = await prepareAudio({
      clients: ['blocked', 'working'],
      extract: async (playerClient) => ({
        url: `http://127.0.0.1:${server.address().port}/${playerClient}`,
        headers: { 'User-Agent': 'audio-regression', Referer: 'https://www.youtube.com/' }, playerClient,
      }),
      start: async (candidate) => {
        const child = spawnAudioProcess(candidate, 0, 1);
        processes.push(child);
        await waitForAudio(child, undefined, 5000);
        const resource = createAudioResource(child.stdout, { inputType: StreamType.OggOpus });
        player.play(resource);
        await entersState(player, AudioPlayerStatus.Playing, 5000);
        assert.ok(resource.readable);
        return resource;
      },
    });
    assert.equal(stream.playerClient, 'working');
    assert.deepEqual(requests, ['/blocked', '/working'], '403 is rejected promptly instead of reconnected repeatedly');
    assert.equal(player.state.status, AudioPlayerStatus.Playing);
  } finally {
    player.stop(true);
    for (const child of processes) { try { child.kill('SIGKILL'); } catch {} }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
