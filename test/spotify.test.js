const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  SpotifyError, createSpotifyClient, isSpotifyLink, parseSpotifyLink, pickBestYouTubeMatch, youTubeQueryFor,
} = require('../spotify');

const TRACK_ID = '4uLU6hMCjMI75M1A2tKUQC';
const ALBUM_ID = '1DFixLWuPkv3KT3TnV35m3';

test('Spotify links are recognized and parsed; everything else is not', () => {
  assert.deepEqual(parseSpotifyLink(`https://open.spotify.com/track/${TRACK_ID}?si=abc`), { type: 'track', id: TRACK_ID });
  assert.deepEqual(parseSpotifyLink(`https://open.spotify.com/intl-de/album/${ALBUM_ID}`), { type: 'album', id: ALBUM_ID });
  assert.deepEqual(parseSpotifyLink(`https://open.spotify.com/embed/track/${TRACK_ID}`), { type: 'track', id: TRACK_ID });
  assert.deepEqual(parseSpotifyLink(`spotify:playlist:${ALBUM_ID}`), { type: 'playlist', id: ALBUM_ID });

  assert.equal(parseSpotifyLink(`https://open.spotify.com/artist/${TRACK_ID}`), null);
  assert.equal(parseSpotifyLink('https://open.spotify.com/track/../../v1/me'), null);
  assert.equal(parseSpotifyLink(`https://evil.example/track/${TRACK_ID}`), null);
  assert.equal(parseSpotifyLink(`https://open.spotify.com.evil.example/track/${TRACK_ID}`), null);

  assert.equal(isSpotifyLink('https://spotify.link/abc123'), true);
  assert.equal(isSpotifyLink(`https://open.spotify.com/artist/${TRACK_ID}`), true);
  assert.equal(isSpotifyLink('https://www.youtube.com/watch?v=x'), false);
  assert.equal(isSpotifyLink('never gonna give you up'), false);
});

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const handler = routes[url.replace(/^https:\/\/api\.spotify\.com\/v1/, '')] || routes[url];
    if (!handler) return new Response('{}', { status: 404 });
    const { status = 200, body, headers } = typeof handler === 'function' ? handler(calls.length) : handler;
    return new Response(JSON.stringify(body ?? {}), { status, headers });
  };
  return { impl, calls };
}

const tokenRoute = { body: { access_token: 'tok', expires_in: 3600 } };
const rawTrack = (name, ms, id = TRACK_ID) => ({
  type: 'track', id, name, duration_ms: ms, artists: [{ name: 'Artist' }],
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
});

test('client reads a track with a cached client-credentials token', async () => {
  const { impl, calls } = fakeFetch({
    'https://accounts.spotify.com/api/token': tokenRoute,
    [`/tracks/${TRACK_ID}`]: { body: { ...rawTrack('Song', 200_000), album: { images: [{ url: 'https://i.scdn.co/a.jpg' }] } } },
  });
  const client = createSpotifyClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: impl });

  const track = await client.getTrack(TRACK_ID);
  assert.deepEqual(track, {
    title: 'Song', artists: ['Artist'], durationMs: 200_000,
    spotifyUrl: `https://open.spotify.com/track/${TRACK_ID}`, image: 'https://i.scdn.co/a.jpg',
  });
  await client.getTrack(TRACK_ID);
  assert.equal(calls.filter((call) => call.url.includes('accounts.spotify.com')).length, 1);
  assert.equal(calls[0].options.headers.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer tok');
});

test('client pages through album tracks and caps at 100', async () => {
  const page = (offset, count) => Array.from({ length: count }, (_, i) => rawTrack(`T${offset + i}`, 180_000));
  const { impl } = fakeFetch({
    'https://accounts.spotify.com/api/token': tokenRoute,
    [`/albums/${ALBUM_ID}`]: { body: { name: 'Big Album', images: [{ url: 'https://i.scdn.co/b.jpg' }], tracks: { total: 130, items: page(0, 50) } } },
    [`/albums/${ALBUM_ID}/tracks?limit=50&offset=50`]: { body: { items: page(50, 50) } },
  });
  const album = await createSpotifyClient({ clientId: 'id', clientSecret: 's', fetchImpl: impl }).getAlbum(ALBUM_ID);
  assert.equal(album.name, 'Big Album');
  assert.equal(album.tracks.length, 100);
  assert.equal(album.tracks[99].title, 'T99');
  assert.equal(album.tracks[0].image, 'https://i.scdn.co/b.jpg');
});

test('client turns API failures into user-facing errors and retries once on 429', async () => {
  let hits = 0;
  const { impl } = fakeFetch({
    'https://accounts.spotify.com/api/token': tokenRoute,
    [`/tracks/${TRACK_ID}`]: () => {
      hits += 1;
      return hits === 1 ? { status: 429, headers: { 'retry-after': '1' } } : { body: rawTrack('Song', 1000) };
    },
  });
  const slept = [];
  const client = createSpotifyClient({ clientId: 'id', clientSecret: 's', fetchImpl: impl, sleep: async (ms) => slept.push(ms) });
  assert.equal((await client.getTrack(TRACK_ID)).title, 'Song');
  assert.deepEqual(slept, [1000]);

  const missing = createSpotifyClient({ clientId: 'id', clientSecret: 's', fetchImpl: fakeFetch({ 'https://accounts.spotify.com/api/token': tokenRoute }).impl });
  await assert.rejects(missing.getTrack(TRACK_ID), (err) => err instanceof SpotifyError && /could not be found/.test(err.userMessage));

  const badCreds = createSpotifyClient({ clientId: 'id', clientSecret: 'bad', fetchImpl: fakeFetch({ 'https://accounts.spotify.com/api/token': { status: 400 } }).impl });
  await assert.rejects(badCreds.getTrack(TRACK_ID), (err) => err instanceof SpotifyError && /sign in to Spotify/.test(err.userMessage));
});

test('YouTube matching prefers the closest length and skips unwanted versions', () => {
  const track = { title: 'Blinding Lights', artists: ['The Weeknd'], durationMs: 200_000 };
  const videos = [
    { url: 'https://youtube.com/watch?v=live', title: 'The Weeknd - Blinding Lights (Live)', seconds: 201 },
    { url: 'https://youtube.com/watch?v=ext', title: 'Blinding Lights 1 hour', seconds: 3600 },
    { url: 'https://youtube.com/watch?v=official', title: 'The Weeknd - Blinding Lights (Official Audio)', seconds: 203 },
  ];
  assert.equal(pickBestYouTubeMatch(track, videos).url, 'https://youtube.com/watch?v=official');
  assert.equal(pickBestYouTubeMatch({ ...track, title: 'Blinding Lights - Live' }, videos).url, 'https://youtube.com/watch?v=live');
  assert.equal(pickBestYouTubeMatch(track, []), null);
  assert.equal(youTubeQueryFor({ title: 'Song', artists: ['A', 'B', 'C'] }), 'A B Song');
});
