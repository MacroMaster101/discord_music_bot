// Saves what every server is playing when the bot shuts down (for example
// during a deploy) and reads it back on the next start, so music resumes from
// the same song and position instead of stopping.

const fs = require('fs');

const RESUME_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_SONGS = 200;
const MAX_HISTORY = 50;
const SNOWFLAKE_RE = /^\d{15,25}$/;

function pickSong(song) {
  return {
    title: String(song.title || ''),
    url: song.url || null,
    source: song.source || null,
    spotify: song.spotify || null,
    youtubeUrl: song.youtubeUrl || null,
    duration: Number(song.duration) || null,
    thumbnail: song.thumbnail || null,
  };
}

function snapshotQueue(guildId, serverQueue, elapsedSeconds) {
  return {
    guildId: String(guildId),
    voiceChannelId: serverQueue.voiceChannel?.id || null,
    textChannelId: serverQueue.textChannel?.id || null,
    loop: serverQueue.loop || null,
    volume: Number.isFinite(serverQueue.targetVolume) ? serverQueue.targetVolume : null,
    positionSeconds: Math.max(0, Math.floor(Number(elapsedSeconds) || 0)),
    songs: serverQueue.songs.slice(0, MAX_SONGS).map(pickSong),
    history: (serverQueue.history || []).slice(-MAX_HISTORY).map(pickSong),
  };
}

// Written to a temp file and renamed, so a crash mid-write never leaves a
// half-written file behind.
function saveSnapshots(file, snapshots, now = Date.now()) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: now, queues: snapshots }));
  fs.renameSync(tmp, file);
}

function isValidSong(song) {
  if (!song || typeof song.title !== 'string' || !song.title || typeof song.url !== 'string') return false;
  if (song.source === 'spotify') {
    return Boolean(song.spotify && typeof song.spotify.title === 'string' && Array.isArray(song.spotify.artists));
  }
  return true;
}

// Reads and deletes the saved state. Returns [] when there is nothing to
// resume, the file is unreadable, or it is too old to be the restart that
// just happened (a bot that was stopped for hours should not suddenly rejoin).
function loadSnapshots(file, now = Date.now()) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  try { fs.unlinkSync(file); } catch {}

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || !Number.isFinite(data.savedAt) || now - data.savedAt > RESUME_MAX_AGE_MS) return [];

  return (Array.isArray(data.queues) ? data.queues : [])
    .filter((q) => q && SNOWFLAKE_RE.test(q.guildId) && SNOWFLAKE_RE.test(q.voiceChannelId || '')
      && SNOWFLAKE_RE.test(q.textChannelId || '') && Array.isArray(q.songs))
    .map((q) => ({
      guildId: q.guildId,
      voiceChannelId: q.voiceChannelId,
      textChannelId: q.textChannelId,
      loop: ['song', 'queue'].includes(q.loop) ? q.loop : null,
      volume: Number.isFinite(q.volume) ? Math.min(Math.max(q.volume, 0), 2) : null,
      positionSeconds: Math.max(0, Math.floor(Number(q.positionSeconds) || 0)),
      songs: q.songs.filter(isValidSong).slice(0, MAX_SONGS),
      history: (Array.isArray(q.history) ? q.history : []).filter(isValidSong).slice(-MAX_HISTORY),
    }))
    .filter((q) => q.songs.length > 0);
}

// Where to restart the first song: the saved position, unless the song was
// about to end anyway.
function resumePosition(snapshot) {
  const duration = Number(snapshot.songs[0]?.duration) || 0;
  const position = snapshot.positionSeconds;
  if (!position || (duration && position >= duration - 5)) return 0;
  return position;
}

module.exports = {
  RESUME_MAX_AGE_MS,
  loadSnapshots,
  resumePosition,
  saveSnapshots,
  snapshotQueue,
};
