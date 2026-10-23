const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Admin health monitor: runs component checks on an interval, keeps per-day
// counts for 90-day uptime bars, and logs every outage (start, end, cause) plus
// operator events such as restarts and maintenance. Persisted to the data dir.

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 90;
const LOG_LIMIT = 200;
const CHECK_TIMEOUT_MS = 8000;
const STATUS_RANK = { operational: 0, unconfigured: 0, degraded: 1, down: 2 };

// Configuration report. Only whether a value is set is ever exposed, never the value.
const ENV_KEYS = [
  { key: 'TOKEN', aliases: ['DISCORD_TOKEN', 'BOT_TOKEN'], level: 'required', purpose: 'Discord bot login' },
  { key: 'ADMIN_TOKEN', level: 'recommended', purpose: 'Admin console sign-in without Cloudflare Access' },
  { key: 'CF_ACCESS_TEAM_DOMAIN', level: 'recommended', purpose: 'Verify Cloudflare Access sign-ins' },
  { key: 'CF_ACCESS_AUD', level: 'recommended', purpose: 'Verify Cloudflare Access sign-ins' },
  { key: 'TUNNEL_TOKEN', level: 'optional', purpose: 'Cloudflare Tunnel for the dashboard' },
  { key: 'SPOTIFY_CLIENT_ID', level: 'optional', purpose: 'Spotify tracks, albums, and search' },
  { key: 'SPOTIFY_CLIENT_SECRET', level: 'optional', purpose: 'Spotify tracks, albums, and search' },
  { key: 'FORMSPREE_FORM_ID', level: 'optional', purpose: 'Report a bug button' },
  { key: 'BGUTIL_BASE_URL', level: 'optional', purpose: 'YouTube PO-token provider address' },
  { key: 'YTDLP_COOKIES_PATH', aliases: ['YTDLP_COOKIES', 'YTDLP_COOKIES_BASE64'], level: 'optional', purpose: 'YouTube cookies' },
  { key: 'PRESENCE_STREAM_URL', level: 'optional', purpose: 'Streaming badge link' },
];
const MIN_ADMIN_TOKEN_LENGTH = 24;

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function envReport(env = process.env) {
  return ENV_KEYS.map(({ key, aliases = [], level, purpose }) => {
    const setName = [key, ...aliases].find((name) => String(env[name] || '').trim());
    const entry = { key, level, purpose, set: Boolean(setName) };
    if (setName && setName !== key) entry.via = setName;
    if (key === 'ADMIN_TOKEN' && setName && String(env[key]).trim().length < MIN_ADMIN_TOKEN_LENGTH) {
      entry.warning = `Shorter than ${MIN_ADMIN_TOKEN_LENGTH} characters`;
    }
    return entry;
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function runVersion(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout).split(/\r?\n/)[0].trim());
    });
  });
}

// Binaries rarely change while running, so their version probe is cached.
function cachedProbe(probe, ttlMs, now) {
  let value = null;
  let at = 0;
  return async () => {
    if (value && now() - at < ttlMs) return value;
    value = await probe();
    at = now();
    return value;
  };
}

function formatAgo(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function createDefaultChecks({
  client,
  getPlaybackHealth = () => ({}),
  spotify = null,
  bgutilBaseUrl = '',
  ytdlpPath = 'yt-dlp',
  ffmpegPath = 'ffmpeg',
  tunnelReadyUrl = '',
  getLastEdgeRequestAt = () => 0,
  dataDir = os.tmpdir(),
  env = process.env,
  memoryLimitMb = 2048,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const ytdlpVersion = cachedProbe(() => runVersion(ytdlpPath, ['--version']), 30 * 60 * 1000, now);
  const ffmpegVersion = cachedProbe(() => runVersion(ffmpegPath, ['-version']), 30 * 60 * 1000, now);

  return [
    {
      id: 'discord',
      name: 'Discord gateway',
      group: 'Bot',
      async run() {
        if (!client?.user || client.ws?.status !== 0) return { status: 'down', detail: 'Not connected to Discord' };
        const ping = Number(client.ws.ping);
        const servers = client.guilds?.cache?.size || 0;
        const detail = `${Number.isFinite(ping) && ping >= 0 ? `${Math.round(ping)} ms` : 'ping pending'} · ${servers} servers`;
        return { status: ping > 1000 ? 'degraded' : 'operational', detail };
      },
    },
    {
      id: 'playback',
      name: 'YouTube playback',
      group: 'Bot',
      async run() {
        const health = getPlaybackHealth() || {};
        const recent = (health.failures || []).filter((at) => now() - at < 15 * 60 * 1000);
        const lastOk = Number(health.lastSuccessAt || 0);
        const lastFail = Number(health.lastFailureAt || 0);
        const via = health.playerClient ? ` · client ${health.playerClient}` : '';
        if (recent.length && lastFail > lastOk) {
          const reason = health.lastFailureReason ? `: ${health.lastFailureReason}` : '';
          return { status: recent.length >= 3 ? 'down' : 'degraded', detail: `${recent.length} failed start(s) in 15m${reason}` };
        }
        if (!lastOk) return { status: 'operational', detail: 'No songs played since restart' };
        return { status: 'operational', detail: `Last song started ${formatAgo(now() - lastOk)}${via}` };
      },
    },
    {
      id: 'ytdlp',
      name: 'yt-dlp',
      group: 'Audio pipeline',
      async run() {
        return { status: 'operational', detail: `Version ${await ytdlpVersion()}` };
      },
    },
    {
      id: 'ffmpeg',
      name: 'FFmpeg',
      group: 'Audio pipeline',
      async run() {
        const line = await ffmpegVersion();
        return { status: 'operational', detail: line.replace(/^ffmpeg version\s+/i, 'Version ').split(' Copyright')[0] };
      },
    },
    {
      id: 'potoken',
      name: 'PO-token provider',
      group: 'Audio pipeline',
      async run() {
        if (!bgutilBaseUrl) return { status: 'unconfigured', detail: 'BGUTIL_BASE_URL is not set' };
        const response = await fetchImpl(`${bgutilBaseUrl.replace(/\/+$/, '')}/ping`, { signal: AbortSignal.timeout(4000) });
        if (!response.ok) return { status: 'down', detail: `Ping returned HTTP ${response.status}` };
        const data = await response.json().catch(() => ({}));
        return { status: 'operational', detail: data.version ? `Version ${data.version}` : 'Responding' };
      },
    },
    {
      id: 'spotify',
      name: 'Spotify API',
      group: 'Integrations',
      async run() {
        if (!spotify?.configured) return { status: 'unconfigured', detail: 'Client ID and secret not set; playlists still work' };
        await spotify.checkAuth();
        return { status: 'operational', detail: 'Signed in' };
      },
    },
    {
      id: 'tunnel',
      name: 'Cloudflare Tunnel',
      group: 'Hosting',
      async run() {
        if (!String(env.TUNNEL_TOKEN || '').trim()) return { status: 'unconfigured', detail: 'TUNNEL_TOKEN is not set' };
        const edgeAt = Number(getLastEdgeRequestAt() || 0);
        const edgeDetail = edgeAt ? `last request through Cloudflare ${formatAgo(now() - edgeAt)}` : 'no requests through Cloudflare yet';
        if (tunnelReadyUrl) {
          try {
            const response = await fetchImpl(tunnelReadyUrl, { signal: AbortSignal.timeout(3000) });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
              const connections = Number(data.readyConnections);
              return { status: 'operational', detail: `${Number.isFinite(connections) ? `${connections} edge connections` : 'Connected'} · ${edgeDetail}` };
            }
            return { status: 'down', detail: `cloudflared is not connected to Cloudflare (HTTP ${response.status})` };
          } catch {
            // Metrics unreachable (older compose file): fall back to recent edge traffic.
          }
        }
        if (edgeAt && now() - edgeAt < 15 * 60 * 1000) return { status: 'operational', detail: edgeDetail };
        return { status: 'degraded', detail: `cloudflared metrics unreachable; ${edgeDetail}` };
      },
    },
    {
      id: 'host',
      name: 'Server (EC2)',
      group: 'Hosting',
      async run() {
        const issues = [];
        const rssMb = process.memoryUsage().rss / 1024 / 1024;
        const freeMemPct = (os.freemem() / os.totalmem()) * 100;
        const load = os.loadavg()[0] / Math.max(1, os.cpus().length);
        let diskFreePct = null;
        try {
          const stats = fs.statfsSync(dataDir);
          diskFreePct = (stats.bavail / stats.blocks) * 100;
        } catch {}
        let writable = true;
        try { fs.accessSync(dataDir, fs.constants.W_OK); } catch { writable = false; }

        let status = 'operational';
        if (!writable) { status = 'down'; issues.push('data folder is not writable'); }
        if (diskFreePct !== null && diskFreePct < 3) { status = 'down'; issues.push('disk almost full'); }
        else if (diskFreePct !== null && diskFreePct < 10) { status = worst(status, 'degraded'); issues.push('disk low'); }
        if (freeMemPct < 8 || rssMb > memoryLimitMb * 0.9) { status = worst(status, 'degraded'); issues.push('memory pressure'); }
        if (load > 2) { status = worst(status, 'degraded'); issues.push('high CPU load'); }

        const parts = [
          `Bot ${Math.round(rssMb)} MB`,
          `${Math.round(freeMemPct)}% memory free`,
          diskFreePct === null ? null : `${Math.round(diskFreePct)}% disk free`,
          `load ${load.toFixed(2)}/core`,
          `up ${formatAgo(os.uptime() * 1000).replace(' ago', '')}`,
        ].filter(Boolean);
        return { status, detail: `${issues.length ? `${issues.join(', ')} · ` : ''}${parts.join(' · ')}` };
      },
    },
    {
      id: 'config',
      name: 'Environment config',
      group: 'Hosting',
      async run() {
        const report = envReport(env);
        const missingRequired = report.filter((e) => e.level === 'required' && !e.set).map((e) => e.key);
        const missingRecommended = report.filter((e) => e.level === 'recommended' && !e.set).map((e) => e.key);
        const warnings = report.filter((e) => e.warning).map((e) => `${e.key}: ${e.warning.toLowerCase()}`);
        if (missingRequired.length) return { status: 'down', detail: `Missing ${missingRequired.join(', ')}` };
        if (missingRecommended.length || warnings.length) {
          return { status: 'degraded', detail: [missingRecommended.length ? `Not set: ${missingRecommended.join(', ')}` : '', ...warnings].filter(Boolean).join(' · ') };
        }
        return { status: 'operational', detail: `${report.filter((e) => e.set).length} of ${report.length} settings set` };
      },
    },
  ];
}

// The public status page shows what users rely on, under friendly names. Internal
// components (host, config, binaries), check details, and error text stay admin-only.
const PUBLIC_COMPONENTS = [
  ['discord', 'Discord bot'],
  ['playback', 'Music playback'],
  ['spotify', 'Spotify links'],
  ['tunnel', 'Status website'],
];

function publicHealth(snapshot, maintenance = {}) {
  const names = new Map(PUBLIC_COMPONENTS);
  const components = PUBLIC_COMPONENTS
    .map(([id]) => snapshot.components.find((component) => component.id === id))
    .filter((component) => component && component.status !== 'unconfigured')
    .map((component) => ({
      id: component.id,
      name: names.get(component.id),
      status: component.status,
      uptime: component.uptime,
      days: component.days.map(({ date, status, uptime }) => ({ date, status, uptime })),
    }));

  const statuses = components.map((component) => component.status);
  let overall = 'operational';
  if (statuses.includes('pending')) overall = 'pending';
  if (statuses.includes('degraded')) overall = 'degraded';
  if (statuses.includes('down')) overall = components.find((c) => c.id === 'discord')?.status === 'down' ? 'major' : 'partial';

  return {
    overall,
    maintenance: maintenance.enabled ? { enabled: true, message: String(maintenance.message || '') } : { enabled: false, message: '' },
    checkedAt: snapshot.checkedAt,
    historyDays: snapshot.historyDays,
    components,
    incidents: snapshot.incidents
      .filter((incident) => names.has(incident.component))
      .slice(0, 20)
      .map(({ component, status, startedAt, resolvedAt }) => ({ name: names.get(component), status, startedAt, resolvedAt })),
    maintenanceLog: snapshot.events
      .filter((event) => event.kind === 'maintenance')
      .slice(0, 10)
      .map(({ at, message }) => ({ at, message: message.replace(/, stopped \d+ room\(s\)$/, '') })),
  };
}

function worst(a, b) {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

function emptyState() {
  return { days: {}, current: {}, incidents: [], events: [] };
}

function loadState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
      current: parsed.current && typeof parsed.current === 'object' ? parsed.current : {},
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents.slice(-LOG_LIMIT) : [],
      events: Array.isArray(parsed.events) ? parsed.events.slice(-LOG_LIMIT) : [],
    };
  } catch {
    return emptyState();
  }
}

function createHealthMonitor({ checks, file = null, now = Date.now, intervalMs = 60_000, logger = console } = {}) {
  const state = file ? loadState(file) : emptyState();
  const latest = new Map();
  let checkedAt = 0;
  let timer = null;
  let running = null;
  let saveTimer = null;

  const known = new Set(checks.map((check) => check.id));
  for (const id of Object.keys(state.days)) if (!known.has(id)) delete state.days[id];

  const save = () => {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(state));
        fs.renameSync(temp, file);
      } catch (err) {
        logger.warn('[health] could not save health history:', err.message || err);
      }
    }, 500);
    saveTimer.unref?.();
  };

  const pruneDays = () => {
    const oldest = dayKey(now() - (HISTORY_DAYS - 1) * DAY_MS);
    for (const days of Object.values(state.days)) {
      for (const key of Object.keys(days)) if (key < oldest) delete days[key];
    }
  };

  function recordEvent(kind, message) {
    state.events.push({ at: now(), kind: String(kind), message: String(message).slice(0, 300) });
    if (state.events.length > LOG_LIMIT) state.events.splice(0, state.events.length - LOG_LIMIT);
    save();
  }

  function track(check, result) {
    const { id, name } = check;
    const status = result.status;
    if (status !== 'unconfigured') {
      const days = state.days[id] || (state.days[id] = {});
      const bucket = days[dayKey(now())] || (days[dayKey(now())] = { total: 0, degraded: 0, down: 0 });
      bucket.total += 1;
      if (status === 'degraded') bucket.degraded += 1;
      if (status === 'down') bucket.down += 1;
    }

    const isBroken = STATUS_RANK[status] > 0;
    const open = state.incidents.findLast((incident) => incident.component === id && !incident.resolvedAt);

    if (isBroken && !open) {
      state.incidents.push({ component: id, name, status, startedAt: now(), resolvedAt: null, detail: result.detail || '' });
      logger.warn(`[health] ${name} is ${status}: ${result.detail || ''}`);
    } else if (isBroken && open) {
      // Escalate to the worst status seen, and keep the latest cause.
      open.status = worst(open.status, status);
      open.detail = result.detail || open.detail;
    } else if (!isBroken && open) {
      open.resolvedAt = now();
      logger.log(`[health] ${name} recovered after ${Math.round((open.resolvedAt - open.startedAt) / 1000)}s`);
    }
    if (state.incidents.length > LOG_LIMIT) state.incidents.splice(0, state.incidents.length - LOG_LIMIT);
    state.current[id] = status;
  }

  async function runChecks() {
    if (running) return running;
    running = (async () => {
      const results = await Promise.all(checks.map(async (check) => {
        const started = now();
        let result;
        try {
          result = await withTimeout(Promise.resolve().then(() => check.run()), CHECK_TIMEOUT_MS, check.name);
        } catch (err) {
          result = { status: 'down', detail: String(err?.message || err).split(/\r?\n/)[0].slice(0, 200) };
        }
        if (!(result?.status in STATUS_RANK)) result = { status: 'down', detail: 'Check returned no status' };
        return [check, { ...result, latencyMs: now() - started }];
      }));
      checkedAt = now();
      pruneDays();
      for (const [check, result] of results) {
        latest.set(check.id, result);
        track(check, result);
      }
      save();
    })().finally(() => { running = null; });
    return running;
  }

  function dayStatus(bucket) {
    if (!bucket?.total) return { status: 'none', uptime: null };
    const uptime = (bucket.total - bucket.down - bucket.degraded * 0.5) / bucket.total;
    const status = bucket.down ? 'down' : bucket.degraded ? 'degraded' : 'operational';
    return { status, uptime: Math.round(uptime * 10000) / 100 };
  }

  function snapshot() {
    const today = now();
    const components = checks.map((check) => {
      const days = state.days[check.id] || {};
      let total = 0;
      let weighted = 0;
      const history = [];
      for (let i = HISTORY_DAYS - 1; i >= 0; i -= 1) {
        const date = dayKey(today - i * DAY_MS);
        const bucket = days[date];
        if (bucket?.total) {
          total += bucket.total;
          weighted += bucket.total - bucket.down - bucket.degraded * 0.5;
        }
        history.push({ date, ...dayStatus(bucket) });
      }
      const result = latest.get(check.id) || { status: 'pending', detail: 'Waiting for the first check' };
      return {
        id: check.id,
        name: check.name,
        group: check.group,
        status: result.status,
        detail: result.detail || '',
        latencyMs: result.latencyMs ?? null,
        uptime: total ? Math.round((weighted / total) * 10000) / 100 : null,
        days: history,
      };
    });

    const statuses = components.map((component) => component.status);
    let overall = 'operational';
    if (statuses.includes('pending')) overall = 'pending';
    if (statuses.includes('degraded')) overall = 'degraded';
    if (statuses.includes('down')) overall = components.find((c) => c.id === 'discord')?.status === 'down' ? 'major' : 'partial';

    return {
      overall,
      checkedAt,
      intervalMs,
      historyDays: HISTORY_DAYS,
      components,
      incidents: [...state.incidents].reverse().slice(0, 50),
      events: [...state.events].reverse().slice(0, 50),
    };
  }

  function start() {
    if (timer) return;
    runChecks().catch(() => {});
    timer = setInterval(() => runChecks().catch(() => {}), intervalMs);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { runChecks, snapshot, recordEvent, start, stop };
}

module.exports = { createDefaultChecks, createHealthMonitor, envReport, publicHealth, dayKey, ENV_KEYS };
