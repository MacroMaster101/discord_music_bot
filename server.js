const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const settings = require('./settings');

const WEB_DIR = path.join(__dirname, 'web');
const PORT = Number(process.env.PORT || 8080);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// Cloudflare Access application settings. When both are set, the Access JWT is
// verified (signature, audience, issuer, expiry) instead of trusting headers.
const CF_ACCESS_TEAM_DOMAIN = String(process.env.CF_ACCESS_TEAM_DOMAIN || '')
  .trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const CF_ACCESS_AUD = String(process.env.CF_ACCESS_AUD || '').trim();
const ACCESS_KEYS_TTL_MS = 60 * 60 * 1000;
const SNOWFLAKE_RE = /^\d{15,25}$/;
// Public bug reports are relayed server-side to Formspree, which emails them to
// the form owner. The form ID stays on the server; unset disables the feature.
const FORMSPREE_FORM_ID = String(process.env.FORMSPREE_FORM_ID || '').trim();
const BUG_REPORT_MAX_PER_WINDOW = 3;
const BUG_REPORT_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;
const VM_MEMORY_MB = Number(process.env.VM_MEMORY_MB || 2048);
const HISTORY_INTERVAL_MS = 30_000;
const HISTORY_LIMIT = 240;
const DISCORD_INVITE_PERMISSIONS = [
  10n, // View Channels
  11n, // Send Messages
  14n, // Embed Links
  16n, // Read Message History
  20n, // Connect
  21n, // Speak
  25n, // Use Voice Activity
  48n, // Set Voice Channel Status
].reduce((permissions, bit) => permissions | (1n << bit), 0n);

const STATIC_FILES = new Map([
  ['/assets/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/assets/public.js', ['public.js', 'application/javascript; charset=utf-8']],
  ['/assets/admin.js', ['admin.js', 'application/javascript; charset=utf-8']],
  ['/assets/login.js', ['login.js', 'application/javascript; charset=utf-8']],
  ['/assets/login.css', ['login.css', 'text/css; charset=utf-8']],
  ['/assets/logo.png', ['logo.png', 'image/png']],
  ['/assets/favicon.png', ['favicon.png', 'image/png']],
]);

function securityHeaders(contentType, cacheControl = 'no-store') {
  return {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function sendJson(res, status, payload, isPublic = false) {
  const headers = securityHeaders('application/json; charset=utf-8');
  if (isPublic) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
}

function sendText(res, status, value) {
  res.writeHead(status, securityHeaders('text/plain; charset=utf-8'));
  res.end(value);
}

function sendFile(res, fileName, contentType, cacheControl = 'no-store') {
  fs.readFile(path.join(WEB_DIR, fileName), (error, body) => {
    if (error) return sendText(res, 500, 'Dashboard asset unavailable.');
    res.writeHead(200, securityHeaders(contentType, cacheControl));
    res.end(body);
  });
}

function buildDiscordInviteUrl(applicationId) {
  const clientId = String(applicationId || '').trim();
  if (!/^\d+$/.test(clientId)) return null;

  const invite = new URL('https://discord.com/oauth2/authorize');
  invite.searchParams.set('client_id', clientId);
  invite.searchParams.set('permissions', DISCORD_INVITE_PERMISSIONS.toString());
  invite.searchParams.set('integration_type', '0');
  invite.searchParams.set('scope', 'bot applications.commands');
  return invite.toString();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getRequestToken(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return bearer?.[1] || req.headers['x-admin-token'] || '';
}

function base64UrlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// Verifies a Cloudflare Access JWT (RS256) against the team's published keys.
// Returns the authenticated email, or '' when the token is missing or invalid.
function createAccessVerifier({ teamDomain, aud, fetchKeys, now = () => Date.now() }) {
  const issuer = `https://${teamDomain}`;
  let cachedKeys = null;
  let cachedAt = 0;

  const loadKeys = async (force = false) => {
    if (!force && cachedKeys && now() - cachedAt < ACCESS_KEYS_TTL_MS) return cachedKeys;
    const jwks = await (fetchKeys
      ? fetchKeys()
      : fetch(`${issuer}/cdn-cgi/access/certs`).then((r) => {
        if (!r.ok) throw new Error(`Access certs HTTP ${r.status}`);
        return r.json();
      }));
    cachedKeys = new Map((jwks.keys || []).map((jwk) => [jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })]));
    cachedAt = now();
    return cachedKeys;
  };

  return async function verify(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3) return '';
      const header = base64UrlJson(parts[0]);
      const claims = base64UrlJson(parts[1]);
      if (header.alg !== 'RS256' || !header.kid) return '';

      let key = (await loadKeys()).get(header.kid);
      if (!key) key = (await loadKeys(true)).get(header.kid); // key rotation
      if (!key) return '';

      const valid = crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`),
        key,
        Buffer.from(parts[2], 'base64url'),
      );
      if (!valid) return '';

      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const seconds = Math.floor(now() / 1000);
      if (!audiences.includes(aud)) return '';
      if (claims.iss !== issuer) return '';
      if (!Number.isFinite(claims.exp) || claims.exp <= seconds) return '';
      if (Number.isFinite(claims.nbf) && claims.nbf > seconds + 60) return '';
      return typeof claims.email === 'string' ? claims.email : '';
    } catch (err) {
      console.warn('[admin] Access JWT verification failed:', err.message || err);
      return '';
    }
  };
}

const defaultAccessVerifier = CF_ACCESS_TEAM_DOMAIN && CF_ACCESS_AUD
  ? createAccessVerifier({ teamDomain: CF_ACCESS_TEAM_DOMAIN, aud: CF_ACCESS_AUD })
  : null;
if (!defaultAccessVerifier) {
  console.warn('[admin] CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD not set: Cloudflare Access headers are trusted without JWT verification. Keep the origin reachable only through the tunnel.');
}

async function getCloudflareIdentity(req, verifier = defaultAccessVerifier) {
  const email = String(req.headers['cf-access-authenticated-user-email'] || '').trim();
  const assertion = String(req.headers['cf-access-jwt-assertion'] || '').trim();
  if (verifier) return assertion ? verifier(assertion) : '';
  const ray = String(req.headers['cf-ray'] || '').trim();
  return email && assertion && ray ? email : '';
}

async function isAdminRequest(req, token = ADMIN_TOKEN, verifier = defaultAccessVerifier) {
  if (Boolean(token) && safeEqual(getRequestToken(req), token)) return true;
  return Boolean(await getCloudflareIdentity(req, verifier));
}

// The /console/api mount is reachable from the internet (Cloudflare Access only gates
// /admin and /api/admin), so token guesses are throttled: LOGIN_MAX_ATTEMPTS failures
// from one IP inside LOGIN_WINDOW start a LOGIN_LOCKOUT cooldown.
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const loginFailures = new Map();
const loginLockouts = new Map();

function clientIp(req) {
  // Every request arrives from Cloudflare, so socket address alone would throttle all
  // callers as one; CF-Connecting-IP carries the real client (Cloudflare overwrites it).
  // X-Forwarded-For is not trusted: a caller could rotate it to dodge the lockout.
  return String(req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || 'unknown');
}

function loginRetryAfter(ip, now) {
  const until = loginLockouts.get(ip);
  if (until && now < until) return Math.ceil((until - now) / 1000);
  if (until) loginLockouts.delete(ip);
  return 0;
}

function recordLoginFailure(ip, now) {
  const recent = (loginFailures.get(ip) || []).filter((at) => now - at <= LOGIN_WINDOW_MS);
  // Bound memory if many distinct addresses fail: drop the oldest tracked entry.
  if (!loginFailures.has(ip) && loginFailures.size >= 10_000) {
    loginFailures.delete(loginFailures.keys().next().value);
  }
  recent.push(now);
  if (recent.length >= LOGIN_MAX_ATTEMPTS) {
    loginLockouts.set(ip, now + LOGIN_LOCKOUT_MS);
    loginFailures.delete(ip);
    console.warn(`[admin] token lockout for ${ip} after ${LOGIN_MAX_ATTEMPTS} failures`);
    return;
  }
  loginFailures.set(ip, recent);
}

async function requireAdmin(req, res) {
  const ip = clientIp(req);
  const now = Date.now();

  const retryAfter = loginRetryAfter(ip, now);
  if (retryAfter) {
    res.setHeader?.('Retry-After', String(retryAfter));
    sendJson(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` });
    return false;
  }

  if (await isAdminRequest(req)) {
    loginFailures.delete(ip);
    return true;
  }
  if (!ADMIN_TOKEN) {
    sendJson(res, 503, { error: 'Cloudflare Access identity unavailable and ADMIN_TOKEN is not configured.' });
    return false;
  }
  recordLoginFailure(ip, now);
  sendJson(res, 401, { error: 'Cloudflare Access session or admin token is invalid.' });
  return false;
}

function bugReportFormId(hooks) {
  const id = hooks.bugReportFormId ?? FORMSPREE_FORM_ID;
  return /^[A-Za-z0-9]{4,32}$/.test(id) ? id : '';
}

async function forwardToFormspree(formId, report) {
  const response = await fetch(`https://formspree.io/f/${formId}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      _subject: 'Bug report from the Discord Music status page',
      email: report.email,
      message: report.message,
      userAgent: report.userAgent,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Formspree HTTP ${response.status}`);
}

function validateBugReport(body) {
  const email = String(body?.email || '').trim();
  const message = String(body?.message || '').trim();
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: 'Enter a valid email address so we can reply.' };
  if (message.length < 10) return { error: 'Describe the bug in at least 10 characters.' };
  if (message.length > 2000) return { error: 'Keep the description under 2000 characters.' };
  return { email, message };
}

// A browser on another site must not be able to submit through this relay.
function isSameOriginPost(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readJson(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let failed = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (failed) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        failed = true;
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
      }
    });
    req.on('end', () => {
      if (failed) return;
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function getVolume(serverQueue) {
  return Math.round((serverQueue?.targetVolume ?? 1) * 100);
}

function getBotIdentity(client) {
  return {
    name: client?.user?.username || 'Discord Music',
    tag: client?.user?.tag || '',
    avatar: client?.user?.displayAvatarURL?.({ size: 256 }) || '',
  };
}

function isClientOnline(client) {
  return Boolean(client?.user) && client.ws?.status === 0;
}

function activeQueueEntries(queue) {
  return Array.from(queue?.entries?.() || []).filter(([, serverQueue]) => serverQueue?.songs?.[0]);
}

function publicGuildList(client, queue) {
  try {
    if (!client?.guilds?.cache) return [];
    const activeGuildIds = new Set(activeQueueEntries(queue).map(([guildId]) => String(guildId)));
    return Array.from(client.guilds.cache.values())
      .map((guild) => {
        let iconURL = null;
        try {
          iconURL = typeof guild.iconURL === 'function' ? guild.iconURL({ size: 128 }) : null;
        } catch {
          iconURL = null;
        }
        return {
          name: String(guild.name || 'Discord Server'),
          iconURL,
          memberCount: Number(guild.memberCount || 0),
          active: activeGuildIds.has(String(guild.id)),
        };
      })
      .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || b.memberCount - a.memberCount);
  } catch (err) {
    console.error('Error generating public guild list:', err);
    return [];
  }
}

function buildPublicPayload(client, queue, hooks = {}) {
  const online = isClientOnline(client);
  const botStats = hooks.getBotStats?.() || { totalSongsPlayed: 0 };
  const entries = activeQueueEntries(queue);

  return {
    generatedAt: Date.now(),
    status: online ? 'online' : 'connecting',
    bot: getBotIdentity(client),
    prefix: settings.get(null, 'prefix'),
    uptimeMs: Math.floor(process.uptime() * 1000),
    ping: online && Number.isFinite(client.ws.ping) ? client.ws.ping : -1,
    guilds: online ? client.guilds.cache.size : 0,
    audience: online ? client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount || 0), 0) : 0,
    activeStreams: entries.length,
    totalSongsPlayed: Number(botStats.totalSongsPlayed || 0),
    bugReports: Boolean(bugReportFormId(hooks)),
    servers: publicGuildList(client, queue),
    activeTracks: entries.map(([guildId, serverQueue], index) => {
      const song = serverQueue.songs[0];
      const progress = hooks.getQueueProgress?.(serverQueue) || {};
      const guild = client?.guilds?.cache?.get?.(String(guildId))
        || serverQueue?.textChannel?.guild
        || serverQueue?.voiceChannel?.guild;
      let serverIcon = null;
      try {
        serverIcon = typeof guild?.iconURL === 'function' ? guild.iconURL({ size: 64 }) : null;
      } catch {}
      return {
        id: `stream-${index + 1}`,
        title: song.title || 'Unknown track',
        url: song.url || null,
        thumbnail: progress.thumbnail || song.thumbnail || null,
        serverName: guild?.name || 'Discord Server',
        serverIcon,
        queueCount: Math.max(0, (serverQueue.songs?.length || 1) - 1),
        elapsedSeconds: Number(progress.elapsedSeconds || 0),
        durationSeconds: Number(progress.durationSeconds || 0),
        elapsedText: progress.elapsedText || '0:00',
        durationText: progress.durationText || 'live',
        paused: String(serverQueue.player?.state?.status || '').toLowerCase().includes('paused'),
      };
    }),
  };
}

function buildAdminPayload(client, queue, hooks = {}) {
  const base = buildPublicPayload(client, queue, hooks);
  const botStats = hooks.getBotStats?.() || { commandLog: [] };
  const entries = activeQueueEntries(queue);

  return {
    ...base,
    activeTracks: entries.map(([guildId, serverQueue]) => {
      const song = serverQueue.songs[0];
      const progress = hooks.getQueueProgress?.(serverQueue) || {};
      return {
        guildId,
        guildName: serverQueue.textChannel?.guild?.name || 'Unknown server',
        voiceChannelName: serverQueue.voiceChannel?.name || 'Unknown channel',
        title: song.title || 'Unknown track',
        url: song.url || null,
        thumbnail: progress.thumbnail || song.thumbnail || null,
        elapsedSeconds: Number(progress.elapsedSeconds || 0),
        durationSeconds: Number(progress.durationSeconds || 0),
        elapsedText: progress.elapsedText || '0:00',
        durationText: progress.durationText || 'live',
        loop: serverQueue.loop || 'off',
        volume: getVolume(serverQueue),
        paused: String(serverQueue.player?.state?.status || '').toLowerCase().includes('paused'),
        upcoming: Array.isArray(progress.upcoming) ? progress.upcoming : [],
      };
    }),
    commandLog: Array.isArray(botStats.commandLog) ? botStats.commandLog : [],
    system: {
      os: os.type(),
      cpus: os.cpus().length,
      nodeVersion: process.version,
      memoryUsedRss: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      memoryTotalLimit: VM_MEMORY_MB,
    },
  };
}

function listGuilds(client) {
  return client?.guilds?.cache
    ? Array.from(client.guilds.cache.values()).map((guild) => ({
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount || 0,
      iconURL: guild.iconURL?.({ size: 128 }) || null,
    })).sort((a, b) => a.name.localeCompare(b.name))
    : [];
}

async function runControl(hooks, data) {
  const { guildId, action, value } = data || {};
  if (!guildId || !action) return { ok: false, error: 'guildId and action are required.' };
  switch (action) {
    case 'pause': return hooks.pauseResumeCore?.(guildId);
    case 'skip': return hooks.skipCore?.(guildId);
    case 'previous': return hooks.previousCore?.(guildId);
    case 'stop': return hooks.stopCore?.(guildId);
    case 'restart': return hooks.restartCore?.(guildId);
    case 'volume': return hooks.volumeCore?.(guildId, value);
    case 'loop': return hooks.loopCore?.(guildId);
    case 'shuffle': return hooks.shuffleCore?.(guildId);
    case 'remove': return hooks.removeCore?.(guildId, value);
    case 'move': return hooks.moveCore?.(guildId, value?.from, value?.to);
    case 'clear': return hooks.clearCore?.(guildId);
    case 'add': return hooks.addCore?.(guildId, value);
    default: return { ok: false, error: 'Unknown action.' };
  }
}

function createDashboardServer(client, queue, hooks = {}) {
  const history = [];

  const sampleHistory = () => {
    const snapshot = buildPublicPayload(client, queue, hooks);
    history.push({
      timestamp: snapshot.generatedAt,
      ping: snapshot.ping,
      activeStreams: snapshot.activeStreams,
      audience: snapshot.audience,
      status: snapshot.status,
    });
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  };
  sampleHistory();
  const historyTimer = setInterval(sampleHistory, HISTORY_INTERVAL_MS);
  historyTimer.unref?.();

  const bugReportTimes = new Map();
  const bugReportAllowed = (ip, now) => {
    const recent = (bugReportTimes.get(ip) || []).filter((at) => now - at < BUG_REPORT_WINDOW_MS);
    if (recent.length >= BUG_REPORT_MAX_PER_WINDOW) return false;
    if (!bugReportTimes.has(ip) && bugReportTimes.size >= 10_000) {
      bugReportTimes.delete(bugReportTimes.keys().next().value);
    }
    recent.push(now);
    bugReportTimes.set(ip, recent);
    return true;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://dashboard.local');
    let pathname = url.pathname;

    // /console/api/* is the ungated mirror of the Access-gated /api/admin/*. Cloudflare
    // Access covers /admin and /api/admin, so a token-authenticated operator cannot
    // reach those; rewriting here lets one set of handlers serve both mounts, with
    // requireAdmin still enforcing identity-or-token on every call.
    if (pathname.startsWith('/console/api/')) {
      pathname = `/api/admin/${pathname.slice('/console/api/'.length)}`;
    }

    try {
      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return sendFile(res, 'public.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && pathname === '/robots.txt') {
        // /console and /login are not behind Cloudflare Access, so unlike /admin they are
        // actually crawlable — keep them out of search results explicitly.
        return sendText(res, 200, 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin\nDisallow: /console\nDisallow: /login\n');
      }
      if (req.method === 'GET' && pathname === '/invite') {
        const inviteUrl = buildDiscordInviteUrl(client?.application?.id || client?.user?.id);
        if (!inviteUrl) return sendText(res, 503, 'The Discord invite is unavailable while the bot is starting.');
        res.writeHead(302, { Location: inviteUrl, 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (req.method === 'GET' && pathname === '/admin') {
        res.writeHead(308, { Location: '/admin/' });
        return res.end();
      }
      if (req.method === 'GET' && pathname === '/admin/') {
        return sendFile(res, 'admin.html', 'text/html; charset=utf-8');
      }
      // Public sign-in chooser. Access gates /admin at the edge, so this page has to sit
      // outside the Access application for the token route to be reachable at all.
      if (req.method === 'GET' && (pathname === '/login' || pathname === '/login/')) {
        return sendFile(res, 'login.html', 'text/html; charset=utf-8');
      }
      // Same console as /admin/, on a path Access does not gate; opened with the token.
      if (req.method === 'GET' && (pathname === '/console' || pathname === '/console/')) {
        return sendFile(res, 'admin.html', 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && STATIC_FILES.has(pathname)) {
        const [fileName, type] = STATIC_FILES.get(pathname);
        return sendFile(res, fileName, type, 'no-cache');
      }
      if (req.method === 'GET' && pathname === '/healthz') {
        const snapshot = buildPublicPayload(client, queue, hooks);
        return sendJson(res, snapshot.status === 'online' ? 200 : 503, {
          ok: snapshot.status === 'online', status: snapshot.status, generatedAt: snapshot.generatedAt,
        }, true);
      }
      if (req.method === 'GET' && pathname === '/api/public/status') {
        return sendJson(res, 200, buildPublicPayload(client, queue, hooks), true);
      }
      if (req.method === 'GET' && pathname === '/api/public/history') {
        return sendJson(res, 200, { intervalMs: HISTORY_INTERVAL_MS, points: history }, true);
      }
      if (req.method === 'POST' && pathname === '/api/public/bug-report') {
        const formId = bugReportFormId(hooks);
        if (!formId) return sendJson(res, 503, { error: 'Bug reports are not enabled.' });
        if (!isSameOriginPost(req)) return sendJson(res, 403, { error: 'Cross-site submissions are not allowed.' });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          return sendJson(res, 415, { error: 'Send the report as JSON.' });
        }
        const body = await readJson(req, 8 * 1024);
        // Honeypot: real visitors never see or fill the "website" field.
        if (String(body?.website || '').trim()) return sendJson(res, 200, { ok: true });
        const report = validateBugReport(body);
        if (report.error) return sendJson(res, 400, { error: report.error });
        if (!bugReportAllowed(clientIp(req), Date.now())) {
          return sendJson(res, 429, { error: 'Too many reports. Please try again in a few minutes.' });
        }
        try {
          await (hooks.forwardBugReport || ((r) => forwardToFormspree(formId, r)))({
            ...report,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
          });
        } catch (err) {
          console.error('Bug report delivery failed:', err.message || err);
          return sendJson(res, 502, { error: 'Could not send the report right now. Please try again later.' });
        }
        return sendJson(res, 200, { ok: true });
      }

      if (pathname.startsWith('/api/admin/')) {
        if (!(await requireAdmin(req, res))) return;

        if (req.method === 'GET' && pathname === '/api/admin/stats') {
          return sendJson(res, 200, {
            ...buildAdminPayload(client, queue, hooks),
            accessEmail: (await getCloudflareIdentity(req)) || null,
          });
        }
        if (req.method === 'GET' && pathname === '/api/admin/guilds') {
          return sendJson(res, 200, { guilds: listGuilds(client) });
        }
        if (pathname === '/api/admin/presence') {
          if (req.method === 'GET') {
            return sendJson(res, 200, hooks.getPresenceConfig?.() || {
              mode: 'automatic', status: 'online', activityType: 'competing', activityText: '',
            });
          }
          if (req.method === 'PUT') {
            const result = hooks.setPresenceCore?.(await readJson(req));
            if (!result) return sendJson(res, 503, { error: 'Presence controls are unavailable.' });
            return sendJson(res, result.ok ? 200 : 400, result);
          }
          return sendJson(res, 405, { error: 'Method not allowed.' });
        }
        if (pathname === '/api/admin/settings') {
          const guildId = url.searchParams.get('guildId') || null;
          if (guildId && !SNOWFLAKE_RE.test(guildId)) {
            return sendJson(res, 400, { error: 'guildId must be a Discord server ID.' });
          }
          if (req.method === 'GET') {
            return sendJson(res, 200, {
              defaults: settings.getDefaults(),
              keys: settings.getKeys(),
              scope: guildId ? 'guild' : 'global',
              guildId,
              ...settings.getAll(guildId),
            });
          }
          if (req.method === 'PUT') {
            const patch = await readJson(req);
            if (guildId) settings.setGuild(guildId, patch);
            else settings.setGlobal(patch);
            return sendJson(res, 200, settings.getAll(guildId));
          }
          if (req.method === 'DELETE') {
            if (guildId) settings.resetGuild(guildId);
            else settings.resetGlobal();
            return sendJson(res, 200, settings.getAll(guildId));
          }
          return sendJson(res, 405, { error: 'Method not allowed.' });
        }
        if (req.method === 'POST' && pathname === '/api/admin/control') {
          const result = await runControl(hooks, await readJson(req));
          return sendJson(res, result?.ok ? 200 : 400, result || { ok: false, error: 'Action unavailable.' });
        }
        if (req.method === 'POST' && pathname === '/api/admin/seek') {
          const { guildId, seconds } = await readJson(req);
          if (!guildId || !Number.isFinite(Number(seconds))) {
            return sendJson(res, 400, { ok: false, error: 'guildId and numeric seconds are required.' });
          }
          const result = hooks.seek?.(guildId, Number(seconds)) || { ok: false, error: 'Seek unavailable.' };
          return sendJson(res, result.ok ? 200 : 400, result);
        }
        return sendJson(res, 404, { error: 'Admin endpoint not found.' });
      }

      return sendText(res, 404, 'Not Found');
    } catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) console.error('Dashboard request error:', error?.message || error);
      // Internal error details stay in the server log.
      return sendJson(res, status, { error: status >= 500 ? 'Request failed.' : (error.message || 'Request failed.') });
    }
  });

  server.on('close', () => clearInterval(historyTimer));
  server.on('error', (error) => console.error('Dashboard error:', error.message || error));
  return server;
}

function startDashboardServer(client, queue, hooks = {}) {
  const server = createDashboardServer(client, queue, hooks);
  server.listen(PORT, '0.0.0.0', () => console.log(`📡 Dashboard live on :${PORT}`));
  return server;
}

module.exports = {
  buildDiscordInviteUrl,
  buildPublicPayload,
  createAccessVerifier,
  createDashboardServer,
  isAdminRequest,
  startDashboardServer,
};
