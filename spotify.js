// Spotify link support. Spotify audio cannot be streamed, so the bot reads a
// track's details (title, artists, length) from the official Web API and plays
// the closest YouTube match instead.
//
// Web API constraints for Development Mode apps (February 2026 changes):
// - the app owner needs Spotify Premium;
// - playlist contents are only readable for playlists the *logged-in user*
//   owns, so a bot using client credentials cannot read playlists at all;
// - single tracks and albums are still readable.

const API_BASE = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_HOSTS = new Set(['open.spotify.com', 'play.spotify.com', 'spotify.link']);
const ID_RE = /^[A-Za-z0-9]{22}$/;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_COLLECTION_TRACKS = 100;

class SpotifyError extends Error {
  constructor(message, { userMessage, status } = {}) {
    super(message);
    this.name = 'SpotifyError';
    this.userMessage = userMessage || message;
    this.status = status;
  }
}

// True for anything that looks like a Spotify link, including kinds we do not
// support, so callers can explain instead of treating it as a search query.
function isSpotifyLink(input) {
  const text = String(input || '').trim();
  if (/^spotify:/i.test(text)) return true;
  try {
    const url = new URL(text);
    return ['https:', 'http:'].includes(url.protocol) && SPOTIFY_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Returns { type, id } for track/album/playlist links, or null.
function parseSpotifyLink(input) {
  const text = String(input || '').trim();
  const uri = text.match(/^spotify:(track|album|playlist):([A-Za-z0-9]{22})$/i);
  if (uri) return { type: uri[1].toLowerCase(), id: uri[2] };

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || (host !== 'open.spotify.com' && host !== 'play.spotify.com')) {
    return null;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0]?.startsWith('intl-')) parts.shift(); // /intl-de/track/...
  if (parts[0] === 'embed') parts.shift(); // /embed/track/...
  const [type, id] = parts;
  if (!['track', 'album', 'playlist'].includes(type) || !ID_RE.test(id || '')) return null;
  return { type, id };
}

function toTrack(raw, albumImages) {
  if (!raw || raw.type !== 'track' || raw.is_local || !raw.name) return null;
  const images = raw.album?.images || albumImages || [];
  return {
    title: raw.name,
    artists: (raw.artists || []).map((artist) => artist.name).filter(Boolean),
    durationMs: Number(raw.duration_ms) || null,
    spotifyUrl: raw.external_urls?.spotify || (raw.id ? `https://open.spotify.com/track/${raw.id}` : null),
    image: images[0]?.url || null,
  };
}

function createSpotifyClient({ clientId, clientSecret, fetchImpl = fetch, now = Date.now, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let token = null;
  let tokenExpiresAt = 0;

  const configured = Boolean(clientId && clientSecret);

  async function getToken() {
    if (token && now() < tokenExpiresAt - 60_000) return token;
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new SpotifyError(`Spotify token request failed: HTTP ${response.status}`, {
        status: response.status,
        userMessage: 'Spotify links are unavailable right now (the bot could not sign in to Spotify).',
      });
    }
    const data = await response.json();
    token = data.access_token;
    tokenExpiresAt = now() + Number(data.expires_in || 3600) * 1000;
    return token;
  }

  // `path` is always built here from a validated ID, never from user input.
  async function api(path, attempt = 0) {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401 && attempt === 0) {
      token = null; // expired or revoked: fetch a new one once
      return api(path, attempt + 1);
    }
    if (response.status === 429 && attempt === 0) {
      const retryAfter = Math.min(Math.max(Number(response.headers.get('retry-after')) || 1, 1), 10);
      await wait(retryAfter * 1000);
      return api(path, attempt + 1);
    }
    if (response.status === 404 || response.status === 400) {
      throw new SpotifyError(`Spotify ${path} not found`, {
        status: response.status,
        userMessage: 'That Spotify link could not be found. It may be private or removed.',
      });
    }
    if (response.status === 403) {
      throw new SpotifyError(`Spotify ${path} forbidden`, {
        status: 403,
        userMessage: 'Spotify refused that request. Check that the bot owner\'s Spotify app is active (it needs Premium).',
      });
    }
    if (!response.ok) {
      throw new SpotifyError(`Spotify ${path} failed: HTTP ${response.status}`, {
        status: response.status,
        userMessage: 'Spotify is not responding right now. Try again in a moment.',
      });
    }
    return response.json();
  }

  async function getTrack(id) {
    const track = toTrack(await api(`/tracks/${id}`));
    if (!track) throw new SpotifyError(`Spotify track ${id} is not playable`, { userMessage: 'That Spotify track cannot be played.' });
    return track;
  }

  async function getAlbum(id) {
    const album = await api(`/albums/${id}`);
    const images = album.images || [];
    const items = [...(album.tracks?.items || [])];
    let offset = items.length;
    const total = Math.min(Number(album.tracks?.total) || items.length, MAX_COLLECTION_TRACKS);
    while (items.length < total && offset > 0) {
      const page = await api(`/albums/${id}/tracks?limit=50&offset=${offset}`);
      if (!page.items?.length) break;
      items.push(...page.items);
      offset += page.items.length;
    }
    return {
      name: album.name || 'Spotify album',
      tracks: items.slice(0, MAX_COLLECTION_TRACKS).map((raw) => toTrack({ ...raw, type: raw.type || 'track' }, images)).filter(Boolean),
    };
  }

  return { configured, getTrack, getAlbum };
}

const NOISE_RE = /\b(live|cover|karaoke|instrumental|remix|sped up|slowed|nightcore|8d|reaction|tutorial|lesson)\b/i;

// Picks the YouTube result that best matches a Spotify track: closest length,
// with a penalty for versions (live, cover, remix...) the track title does not ask for.
function pickBestYouTubeMatch(track, videos) {
  const wanted = track.durationMs ? track.durationMs / 1000 : null;
  const titleWants = (word) => new RegExp(`\\b${word}\\b`, 'i').test(track.title);
  let best = null;
  let bestScore = Infinity;

  (videos || []).slice(0, 8).forEach((video, index) => {
    if (!video?.url || !video.seconds) return;
    let score = index * 2; // keep YouTube's own relevance order as a tiebreaker
    if (wanted) {
      const diff = Math.abs(video.seconds - wanted);
      score += diff > 30 ? 100 + diff : diff;
    }
    const noise = String(video.title || '').match(NOISE_RE);
    if (noise && !titleWants(noise[1])) score += 60;
    // Prefer the studio recording: YouTube's auto-generated "Artist - Topic"
    // uploads and official audio/video over lyric or fan uploads.
    if (/ - Topic$/i.test(video.author?.name || '')) score -= 4;
    else if (/official (audio|music video|video)/i.test(video.title || '')) score -= 3;
    if (score < bestScore) {
      best = video;
      bestScore = score;
    }
  });
  return best;
}

function youTubeQueryFor(track) {
  return `${track.artists.slice(0, 2).join(' ')} ${track.title}`.trim();
}

module.exports = {
  SpotifyError,
  createSpotifyClient,
  isSpotifyLink,
  parseSpotifyLink,
  pickBestYouTubeMatch,
  youTubeQueryFor,
};
