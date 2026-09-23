const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  RESUME_MAX_AGE_MS, loadSnapshots, resumePosition, saveSnapshots, snapshotQueue,
} = require('../resume');

const GUILD = '111111111111111111';
const VOICE = '222222222222222222';
const TEXT = '333333333333333333';

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resume-')), 'resume.json');
}

const youtubeSong = { id: '7', title: 'YouTube Song', url: 'https://www.youtube.com/watch?v=abc', duration: 200, prefetchedAudioUrl: 'https://googlevideo/x', currentProcess: {} };
const spotifySong = {
  id: '8', title: 'Artist - Spotify Song', url: 'https://open.spotify.com/track/x', source: 'spotify',
  spotify: { title: 'Spotify Song', artists: ['Artist'], durationMs: 180000 }, youtubeUrl: 'https://youtube.com/watch?v=def', duration: 181,
};

test('a queue is saved and restored with position, loop, volume and history', () => {
  const file = tempFile();
  const serverQueue = {
    voiceChannel: { id: VOICE }, textChannel: { id: TEXT }, loop: 'queue', targetVolume: 0.7,
    songs: [youtubeSong, spotifySong], history: [{ title: 'Earlier', url: 'https://www.youtube.com/watch?v=old' }],
  };
  const now = Date.UTC(2026, 8, 23, 12);
  saveSnapshots(file, [snapshotQueue(GUILD, serverQueue, 83.9)], now);

  const [restored] = loadSnapshots(file, now + 20_000);
  assert.equal(restored.guildId, GUILD);
  assert.equal(restored.voiceChannelId, VOICE);
  assert.equal(restored.loop, 'queue');
  assert.equal(restored.volume, 0.7);
  assert.equal(restored.positionSeconds, 83);
  assert.deepEqual(restored.songs.map((s) => s.title), ['YouTube Song', 'Artist - Spotify Song']);
  assert.equal(restored.songs[1].youtubeUrl, 'https://youtube.com/watch?v=def');
  assert.equal(restored.songs[0].prefetchedAudioUrl, undefined, 'short-lived stream URLs are not saved');
  assert.equal(restored.history[0].title, 'Earlier');
  assert.equal(fs.existsSync(file), false, 'the file is consumed so it resumes only once');
});

test('old, missing, corrupt or invalid saves resume nothing', () => {
  const now = Date.UTC(2026, 8, 23, 12);
  const serverQueue = { voiceChannel: { id: VOICE }, textChannel: { id: TEXT }, songs: [youtubeSong] };

  const old = tempFile();
  saveSnapshots(old, [snapshotQueue(GUILD, serverQueue, 10)], now - RESUME_MAX_AGE_MS - 1);
  assert.deepEqual(loadSnapshots(old, now), []);

  assert.deepEqual(loadSnapshots(tempFile(), now), []);

  const corrupt = tempFile();
  fs.writeFileSync(corrupt, '{not json');
  assert.deepEqual(loadSnapshots(corrupt, now), []);

  const invalid = tempFile();
  fs.writeFileSync(invalid, JSON.stringify({
    savedAt: now,
    queues: [
      { guildId: '../etc', voiceChannelId: VOICE, textChannelId: TEXT, songs: [youtubeSong] },
      { guildId: GUILD, voiceChannelId: VOICE, textChannelId: TEXT, songs: [{ title: '', url: 5 }] },
    ],
  }));
  assert.deepEqual(loadSnapshots(invalid, now), []);
});

test('resume position restarts songs that were about to end', () => {
  assert.equal(resumePosition({ positionSeconds: 90, songs: [{ duration: 200 }] }), 90);
  assert.equal(resumePosition({ positionSeconds: 197, songs: [{ duration: 200 }] }), 0);
  assert.equal(resumePosition({ positionSeconds: 0, songs: [{ duration: 200 }] }), 0);
  assert.equal(resumePosition({ positionSeconds: 42, songs: [{ duration: null }] }), 42);
});
