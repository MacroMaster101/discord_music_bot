const http = require('http');
const os = require('os');
const settings = require('./settings');

const VM_MEMORY_MB = 2048;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function formatUptime(s) {
  const sec = Math.floor(s % 60);
  const min = Math.floor((s / 60) % 60);
  const hr = Math.floor((s / 3600) % 24);
  const d = Math.floor(s / 86400);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (hr) parts.push(`${hr}h`);
  if (min) parts.push(`${min}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

function getVolume(serverQueue) {
  const r = serverQueue?.player?.state?.resource;
  return r?.volume ? Math.round(r.volume.volume * 100) : 50;
}

function startDashboardServer(client, queue, hooks = {}) {
  const PORT = process.env.PORT || 8080;

  const server = http.createServer((req, res) => {
    if (req.url === '/api/stats') {
      const isOnline = client && client.user && client.ws.status === 0;
      const botStats = hooks.getBotStats ? hooks.getBotStats() : { totalSongsPlayed: 0, commandLog: [] };

      const payload = {
        status: isOnline ? 'online' : 'connecting',
        bot: {
          name: client?.user?.username || 'J4FN MUSIC',
          tag: client?.user?.tag || '',
          avatar: client?.user?.displayAvatarURL?.({ size: 128 }) || '',
        },
        uptimeMs: Math.floor(process.uptime() * 1000),
        ping: isOnline ? client.ws.ping : -1,
        guilds: isOnline ? client.guilds.cache.size : 0,
        users: isOnline ? client.guilds.cache.reduce((a, g) => a + (g.memberCount || 0), 0) : 0,
        activeStreams: queue.size,
        totalSongsPlayed: botStats.totalSongsPlayed,
        commandLog: botStats.commandLog,
        system: {
          os: os.type(),
          cpus: os.cpus().length,
          nodeVersion: process.version,
          memoryUsedRss: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
          memoryTotalLimit: VM_MEMORY_MB,
        },
        activeTracks: Array.from(queue.entries()).map(([guildId, q]) => {
          const song = q.songs[0];
          const progress = hooks.getQueueProgress ? hooks.getQueueProgress(q) : null;
          return {
            guildId,
            guildName: q.textChannel.guild.name,
            voiceChannelName: q.voiceChannel.name,
            songTitle: song?.title || null,
            songUrl: song?.url || null,
            thumbnail: progress?.thumbnail || song?.thumbnail || null,
            elapsedSeconds: progress?.elapsedSeconds || 0,
            durationSeconds: progress?.durationSeconds || 0,
            elapsedText: progress?.elapsedText || '0:00',
            durationText: progress?.durationText || 'live',
            loop: q.loop || 'off',
            volume: getVolume(q),
            upcoming: progress?.upcoming || [],
          };
        }).filter((t) => t.songTitle),
      };

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(payload));
    }

    if (req.url === '/api/guilds') {
      const guilds = client?.guilds?.cache ? Array.from(client.guilds.cache.values()).map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount || 0,
        iconURL: g.iconURL?.({ size: 64 }) || null,
      })) : [];
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ guilds }));
    }

    if (req.url.startsWith('/api/settings')) {
      const url = new URL(req.url, 'http://x');
      const guildId = url.searchParams.get('guildId') || null;

      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({
          authEnabled: !!ADMIN_TOKEN,
          defaults: settings.getDefaults(),
          keys: settings.getKeys(),
          ...settings.getAll(guildId),
        }));
      }

      if (req.method === 'POST') {
        if (!ADMIN_TOKEN) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Set ADMIN_TOKEN env var to enable editing.' }));
        }
        const auth = req.headers['x-admin-token'] || '';
        if (auth !== ADMIN_TOKEN) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid admin token.' }));
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4096) req.destroy();
        });
        req.on('end', () => {
          let payload;
          try { payload = JSON.parse(body || '{}'); } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid JSON.' }));
          }
          try {
            if (payload.reset && guildId) {
              settings.resetGuild(guildId);
            } else if (guildId) {
              settings.setGuild(guildId, payload);
            } else {
              settings.setGlobal(payload);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(settings.getAll(guildId)));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message || 'Failed.' }));
          }
        });
        return;
      }
    }

    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderDashboardHtml(settings.get(null, 'prefix')));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Dashboard live on :${PORT}`);
  });

  server.on('error', (err) => console.error('Dashboard error:', err.message || err));
}

function renderDashboardHtml(PREFIX = '!') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>J4FN Music — Live Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #07070d;
  --bg-2: #0d0e1a;
  --panel: rgba(15, 17, 32, 0.72);
  --border: rgba(255,255,255,0.06);
  --border-strong: rgba(255,255,255,0.12);
  --text: #f1f5f9;
  --muted: #8b94ad;
  --primary: #818cf8;
  --primary-strong: #6366f1;
  --accent: #d946ef;
  --success: #34d399;
  --warning: #fbbf24;
  --danger: #f87171;
  --shadow-glow: 0 0 60px rgba(99,102,241,0.18);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: 'Inter', system-ui, sans-serif; color: var(--text); background: var(--bg); }
body {
  min-height: 100vh;
  background-image:
    radial-gradient(at 0% 0%, rgba(99,102,241,0.16) 0, transparent 50%),
    radial-gradient(at 100% 0%, rgba(217,70,239,0.10) 0, transparent 45%),
    radial-gradient(at 50% 100%, rgba(52,211,153,0.06) 0, transparent 50%),
    linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px);
  background-size: 100% 100%, 100% 100%, 100% 100%, 36px 36px, 36px 36px;
  background-attachment: fixed;
  padding: 28px 20px 60px;
}
.shell { max-width: 1280px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }

/* Header */
header.bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 24px; gap: 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 18px;
  backdrop-filter: blur(20px);
  box-shadow: 0 20px 50px rgba(0,0,0,0.4);
}
.brand { display: flex; align-items: center; gap: 14px; }
.brand .avatar {
  width: 48px; height: 48px; border-radius: 12px; overflow: hidden;
  border: 1px solid var(--border-strong);
  background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(217,70,239,0.15));
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
}
.brand .avatar img { width: 100%; height: 100%; object-fit: cover; }
.brand h1 { font-family: 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
.brand .tag { color: var(--muted); font-size: 12px; font-family: 'JetBrains Mono', monospace; margin-top: 2px; }

.status-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px; border-radius: 999px;
  background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.25);
  color: var(--success); font-size: 11px; font-weight: 700; letter-spacing: 1.2px;
}
.status-pill.warn { background: rgba(251,191,36,0.08); border-color: rgba(251,191,36,0.25); color: var(--warning); }
.status-pill.err  { background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.25); color: var(--danger); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
.status-dot.pulse { animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

/* KPI Grid */
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
.kpi {
  background: var(--panel); border: 1px solid var(--border); border-radius: 16px;
  padding: 18px 20px; backdrop-filter: blur(20px);
  display: flex; flex-direction: column; gap: 4px; transition: transform 0.2s, border-color 0.2s;
}
.kpi:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.kpi .lbl { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 1.2px; }
.kpi .val { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; letter-spacing: -0.8px; }
.kpi .sub { font-size: 12px; color: var(--muted); font-family: 'JetBrains Mono', monospace; }
.kpi.accent .val { background: linear-gradient(135deg, #c7d2fe, #f0abfc); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }

/* Main Grid */
.main-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 20px; }
@media (max-width: 1080px) { .main-grid { grid-template-columns: 1fr; } }

.panel {
  background: var(--panel); border: 1px solid var(--border); border-radius: 18px;
  padding: 22px 24px; backdrop-filter: blur(20px);
  display: flex; flex-direction: column; gap: 18px;
}
.panel h2 {
  font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted);
  display: flex; align-items: center; gap: 10px;
}
.panel h2::before {
  content: ''; width: 4px; height: 14px; background: linear-gradient(180deg, var(--primary), var(--accent));
  border-radius: 2px;
}

/* Stream cards */
.streams { display: flex; flex-direction: column; gap: 14px; max-height: 720px; overflow-y: auto; padding-right: 4px; }
.streams::-webkit-scrollbar { width: 6px; }
.streams::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 99px; }

.stream {
  background: rgba(255,255,255,0.015); border: 1px solid var(--border);
  border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px;
  position: relative; overflow: hidden;
}
.stream::before {
  content: ''; position: absolute; top: 0; left: 0; height: 100%; width: 3px;
  background: linear-gradient(180deg, var(--primary), var(--accent));
}
.stream-head { display: flex; gap: 14px; align-items: center; }
.thumb {
  width: 56px; height: 56px; border-radius: 10px; flex-shrink: 0;
  background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(217,70,239,0.15));
  display: flex; align-items: center; justify-content: center; font-size: 22px; overflow: hidden;
  border: 1px solid var(--border);
}
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.stream-info { flex: 1; min-width: 0; }
.stream-title { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stream-title a { color: inherit; text-decoration: none; }
.stream-title a:hover { color: var(--primary); }
.stream-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.badge {
  font-size: 11px; padding: 2px 10px; border-radius: 6px; font-weight: 600;
  background: rgba(255,255,255,0.04); border: 1px solid var(--border); color: var(--muted);
  white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis;
}
.badge.live { color: var(--danger); border-color: rgba(248,113,113,0.3); background: rgba(248,113,113,0.05); }
.badge.loop { color: var(--success); border-color: rgba(52,211,153,0.3); background: rgba(52,211,153,0.05); }

.progress {
  display: flex; flex-direction: column; gap: 6px;
}
.progress-bar {
  height: 6px; background: rgba(255,255,255,0.05); border-radius: 999px; overflow: hidden; position: relative;
}
.progress-fill {
  height: 100%; background: linear-gradient(90deg, var(--primary), var(--accent));
  border-radius: 999px; width: 0%; transition: width 0.7s ease;
  box-shadow: 0 0 10px rgba(129,140,248,0.4);
}
.progress-time { display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); }

.upcoming { margin-top: 4px; display: flex; flex-direction: column; gap: 4px; }
.upcoming .sub-title { font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
.upcoming-item {
  font-size: 12px; color: var(--text); padding: 4px 8px; border-radius: 6px;
  background: rgba(255,255,255,0.015); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.upcoming-item a { color: var(--muted); text-decoration: none; }
.upcoming-item a:hover { color: var(--primary); }

.empty {
  text-align: center; padding: 36px 20px;
  border: 1px dashed var(--border); border-radius: 12px; color: var(--muted);
}
.empty .icon { font-size: 28px; margin-bottom: 8px; opacity: 0.5; }
.empty .ttl { font-weight: 700; color: var(--text); margin-bottom: 4px; }
.empty .sub { font-size: 12px; }

/* System panel */
.sys-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sys-cell { background: rgba(255,255,255,0.015); border: 1px solid var(--border); padding: 12px 14px; border-radius: 10px; }
.sys-cell .lbl { font-size: 10px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
.sys-cell .val { font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 700; }

.ram { display: flex; flex-direction: column; gap: 6px; }
.ram-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); }
.ram-val { font-family: 'JetBrains Mono', monospace; color: var(--text); font-weight: 600; }
.ram-bar { height: 8px; background: rgba(255,255,255,0.05); border-radius: 999px; overflow: hidden; }
.ram-fill { height: 100%; width: 0%; border-radius: 999px; background: linear-gradient(90deg, var(--primary), var(--accent)); transition: width 0.7s, background 0.3s; }

/* Log */
.log { display: flex; flex-direction: column; gap: 6px; max-height: 240px; overflow-y: auto; }
.log::-webkit-scrollbar { width: 4px; }
.log::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 99px; }
.log-entry {
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  background: rgba(255,255,255,0.015); border: 1px solid var(--border);
  padding: 6px 10px; border-radius: 8px; display: flex; gap: 8px; align-items: center;
}
.log-cmd { color: var(--primary); font-weight: 700; }
.log-meta { color: var(--muted); }
.log-time { color: var(--muted); margin-left: auto; opacity: 0.6; font-size: 10px; }

/* Commands ref */
.cmd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
.cmd-pill {
  background: rgba(255,255,255,0.015); border: 1px solid var(--border);
  padding: 10px 12px; border-radius: 10px; font-family: 'JetBrains Mono', monospace; font-size: 12px;
  transition: border-color 0.2s, background 0.2s;
}
.cmd-pill:hover { border-color: rgba(217,70,239,0.3); background: rgba(217,70,239,0.03); }
.cmd-name { color: var(--accent); font-weight: 700; }
.cmd-desc { color: var(--muted); font-family: 'Inter', sans-serif; font-size: 11px; margin-top: 2px; }

footer { text-align: center; padding: 30px 0 10px; color: var(--muted); font-size: 11px; letter-spacing: 1.2px; }
footer a { color: var(--primary); text-decoration: none; }
footer a:hover { color: var(--accent); }

/* Settings button + modal */
.icon-btn {
  background: rgba(255,255,255,0.04); border: 1px solid var(--border);
  color: var(--text); border-radius: 10px; padding: 8px 14px;
  font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex;
  align-items: center; gap: 8px; transition: all 0.2s;
}
.icon-btn:hover { border-color: var(--primary); background: rgba(99,102,241,0.1); }

.header-actions { display: flex; align-items: center; gap: 12px; }

.modal-bg {
  position: fixed; inset: 0; background: rgba(4,4,9,0.78);
  backdrop-filter: blur(10px); display: none;
  align-items: center; justify-content: center; z-index: 100;
  padding: 20px;
}
.modal-bg.open { display: flex; }
.modal {
  background: var(--bg-2); border: 1px solid var(--border-strong);
  border-radius: 18px; max-width: 580px; width: 100%;
  max-height: 92vh; overflow-y: auto;
  box-shadow: 0 30px 80px rgba(0,0,0,0.6), var(--shadow-glow);
}
.modal-header {
  padding: 20px 24px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
}
.modal-header h3 {
  font-family: 'Space Grotesk', sans-serif; font-size: 16px;
  letter-spacing: -0.3px;
}
.modal-close {
  background: none; border: none; color: var(--muted);
  font-size: 22px; cursor: pointer; padding: 4px 8px; border-radius: 6px;
}
.modal-close:hover { color: var(--text); background: rgba(255,255,255,0.04); }
.modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
.modal-footer {
  padding: 16px 24px; border-top: 1px solid var(--border);
  display: flex; gap: 10px; justify-content: flex-end;
}

.tabs { display: flex; gap: 4px; padding: 4px; background: rgba(255,255,255,0.025); border-radius: 10px; }
.tab {
  flex: 1; padding: 8px 14px; border-radius: 8px; cursor: pointer;
  background: transparent; border: none; color: var(--muted);
  font-size: 13px; font-weight: 600; transition: all 0.2s; font-family: inherit;
}
.tab.active { background: var(--panel); color: var(--text); }

.field { display: flex; flex-direction: column; gap: 6px; }
.field label {
  font-size: 11px; font-weight: 700; color: var(--muted);
  text-transform: uppercase; letter-spacing: 1px;
}
.field input[type=text], .field input[type=number], .field select {
  background: rgba(255,255,255,0.02); border: 1px solid var(--border);
  color: var(--text); padding: 10px 12px; border-radius: 10px;
  font-size: 14px; font-family: inherit; transition: border-color 0.2s;
}
.field input:focus, .field select:focus {
  outline: none; border-color: var(--primary);
}
.field-hint {
  font-size: 11px; color: var(--muted); font-style: italic;
}
.field-row { display: flex; align-items: center; gap: 10px; }

.switch { position: relative; width: 42px; height: 22px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute; inset: 0; background: rgba(255,255,255,0.06);
  border-radius: 999px; cursor: pointer; transition: 0.2s;
}
.slider::before {
  content: ''; position: absolute; height: 16px; width: 16px;
  left: 3px; top: 3px; background: var(--muted); border-radius: 50%; transition: 0.2s;
}
.switch input:checked + .slider { background: rgba(99,102,241,0.4); }
.switch input:checked + .slider::before { transform: translateX(20px); background: var(--primary); }

.btn-primary {
  background: linear-gradient(135deg, var(--primary), var(--accent));
  border: none; color: white; padding: 10px 20px; border-radius: 10px;
  font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit;
  transition: opacity 0.2s, transform 0.1s;
}
.btn-primary:hover { opacity: 0.92; }
.btn-primary:active { transform: scale(0.98); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-ghost {
  background: transparent; border: 1px solid var(--border);
  color: var(--muted); padding: 10px 18px; border-radius: 10px;
  font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit;
}
.btn-ghost:hover { border-color: var(--border-strong); color: var(--text); }
.btn-danger {
  background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3);
  color: var(--danger);
}
.btn-danger:hover { background: rgba(248,113,113,0.15); }

.token-section {
  background: rgba(99,102,241,0.04); border: 1px solid rgba(99,102,241,0.15);
  padding: 14px 16px; border-radius: 10px;
}

.notice {
  background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.25);
  color: var(--warning); padding: 10px 14px; border-radius: 10px; font-size: 12px;
}
.notice.err { background: rgba(248,113,113,0.06); border-color: rgba(248,113,113,0.25); color: var(--danger); }
.notice.ok { background: rgba(52,211,153,0.06); border-color: rgba(52,211,153,0.25); color: var(--success); }
</style>
</head>
<body>
<div class="shell">

<header class="bar">
  <div class="brand">
    <div class="avatar"><span id="brand-fb">🎵</span></div>
    <div>
      <h1 id="brand-name">J4FN MUSIC</h1>
      <div class="tag" id="brand-tag">connecting…</div>
    </div>
  </div>
  <div class="header-actions">
    <button class="icon-btn" id="open-settings" title="Settings">⚙️ Settings</button>
    <div id="status" class="status-pill warn">
      <span class="status-dot pulse"></span>
      <span id="status-text">CONNECTING</span>
    </div>
  </div>
</header>

<div class="kpis">
  <div class="kpi accent"><div class="lbl">Uptime</div><div class="val" id="kpi-uptime">--</div><div class="sub">since last boot</div></div>
  <div class="kpi"><div class="lbl">Guilds</div><div class="val" id="kpi-guilds">--</div><div class="sub" id="kpi-users">-- users</div></div>
  <div class="kpi"><div class="lbl">Active Rooms</div><div class="val" id="kpi-rooms">--</div><div class="sub">currently playing</div></div>
  <div class="kpi"><div class="lbl">Songs Played</div><div class="val" id="kpi-played">--</div><div class="sub">since boot</div></div>
  <div class="kpi"><div class="lbl">Gateway Ping</div><div class="val" id="kpi-ping">--</div><div class="sub">discord ws</div></div>
</div>

<div class="main-grid">

  <div class="panel">
    <h2>Active Streams</h2>
    <div id="streams" class="streams">
      <div class="empty">
        <div class="icon">🎧</div>
        <div class="ttl">No active rooms</div>
        <div class="sub">Run <code>${PREFIX}play &lt;song&gt;</code> in a voice channel to start.</div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>System Telemetry</h2>
    <div class="ram">
      <div class="ram-row"><span>Memory</span><span class="ram-val" id="ram-text">-- / --</span></div>
      <div class="ram-bar"><div id="ram-fill" class="ram-fill"></div></div>
    </div>
    <div class="sys-grid">
      <div class="sys-cell"><div class="lbl">OS</div><div class="val" id="sys-os">--</div></div>
      <div class="sys-cell"><div class="lbl">CPU Cores</div><div class="val" id="sys-cpus">--</div></div>
      <div class="sys-cell"><div class="lbl">Node</div><div class="val" id="sys-node">--</div></div>
      <div class="sys-cell"><div class="lbl">Audience</div><div class="val" id="sys-aud">--</div></div>
    </div>

    <h2 style="margin-top:6px">Command Log</h2>
    <div id="log" class="log">
      <div class="empty" style="padding: 18px 14px"><div class="sub">No commands yet.</div></div>
    </div>
  </div>

</div>

<div class="panel">
  <h2>Quick Commands</h2>
  <div class="cmd-grid">
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}play &lt;query&gt;</div><div class="cmd-desc">Play a song or URL</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}search &lt;query&gt;</div><div class="cmd-desc">Pick top 5 results</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}playlist &lt;url&gt;</div><div class="cmd-desc">Queue a full playlist</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}seek 1:30</div><div class="cmd-desc">Jump to a position</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}lyrics</div><div class="cmd-desc">Lyrics for current song</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}queue</div><div class="cmd-desc">Show the queue</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}loop</div><div class="cmd-desc">song / queue / off</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}shuffle</div><div class="cmd-desc">Shuffle upcoming</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}volume 60</div><div class="cmd-desc">Set volume 0-100</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}skip</div><div class="cmd-desc">Skip current</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}stop</div><div class="cmd-desc">Stop & disconnect</div></div>
    <div class="cmd-pill"><div class="cmd-name">${PREFIX}help</div><div class="cmd-desc">Full command list</div></div>
  </div>
</div>

<div id="settings-modal" class="modal-bg">
  <div class="modal" role="dialog">
    <div class="modal-header">
      <h3>⚙️ Bot Settings</h3>
      <button class="modal-close" id="close-settings" aria-label="Close">×</button>
    </div>
    <div class="modal-body">
      <div class="tabs">
        <button class="tab active" data-tab="global">🌐 Global Default</button>
        <button class="tab" data-tab="guild">🏛️ Per-Server</button>
      </div>

      <div id="tab-global" class="tab-pane">
        <div class="field" style="margin-bottom: 14px">
          <div class="field-hint">These apply to every server unless overridden below.</div>
        </div>
      </div>

      <div id="tab-guild" class="tab-pane" style="display:none">
        <div class="field" style="margin-bottom: 14px">
          <label>Server</label>
          <select id="guild-select"><option value="">— pick a server —</option></select>
          <div class="field-hint">Leave fields blank to inherit the global default.</div>
        </div>
      </div>

      <div id="fields-container" style="display: flex; flex-direction: column; gap: 14px;">
        <div class="field">
          <label>Prefix</label>
          <input type="text" id="f-prefix" maxlength="5" placeholder="!">
          <div class="field-hint">1–5 chars. The character users type before commands.</div>
        </div>
        <div class="field">
          <label>Default Volume <span id="vol-readout" style="color:var(--text); margin-left:8px">--%</span></label>
          <input type="range" id="f-defaultVolume" min="0" max="100" step="1" style="accent-color: var(--primary);">
          <div class="field-hint">Volume when the bot first joins (0–100). Users can override with !volume.</div>
        </div>
        <div class="field">
          <label>Idle Disconnect Timeout (seconds)</label>
          <input type="number" id="f-idleDisconnectSeconds" min="5" max="3600">
          <div class="field-hint">How long to wait after the queue empties before leaving the voice channel.</div>
        </div>
        <div class="field">
          <label>Empty VC Disconnect Timeout (seconds)</label>
          <input type="number" id="f-emptyVcDisconnectSeconds" min="10" max="3600">
          <div class="field-hint">If the voice channel becomes empty (no humans), wait this long before disconnecting.</div>
        </div>
        <div class="field">
          <div class="field-row">
            <label class="switch"><input type="checkbox" id="f-autoPauseWhenAlone"><span class="slider"></span></label>
            <div>
              <div style="font-weight: 600; color: var(--text); font-size: 13px;">Auto-pause when alone in VC</div>
              <div class="field-hint">Pause playback when the last human leaves, resume when they return.</div>
            </div>
          </div>
        </div>
      </div>

      <div class="token-section">
        <div class="field">
          <label>Admin Token</label>
          <input type="password" id="admin-token" placeholder="Paste ADMIN_TOKEN env var value" autocomplete="off">
          <div class="field-hint">Stored only in this browser. Required to save changes.</div>
        </div>
      </div>

      <div id="settings-msg"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-ghost btn-danger" id="reset-guild" style="display:none">Reset to Global</button>
      <button class="btn-ghost" id="cancel-settings">Cancel</button>
      <button class="btn-primary" id="save-settings">Save Changes</button>
    </div>
  </div>
</div>

<footer>J4FN Music • powered by <a href="https://fly.io" target="_blank">Fly.io</a></footer>
</div>

<script>
let localUptimeMs = 0;
let uptimeTimer = null;

function fmtDur(ms) {
  const s = Math.floor(ms/1000);
  const sec = s%60, min = Math.floor(s/60)%60, hr = Math.floor(s/3600)%24, d = Math.floor(s/86400);
  const p = [];
  if (d) p.push(d+'d');
  if (hr) p.push(hr+'h');
  if (min) p.push(min+'m');
  p.push(sec+'s');
  return p.join(' ');
}

function escapeHtml(s) {
  return (s||'').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\'':'&#39;'}[c]));
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts)/1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  return Math.floor(diff/3600) + 'h ago';
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error('down');
    const d = await res.json();

    // Brand
    if (d.bot.avatar) {
      document.getElementById('brand-fb').outerHTML = '<img src="'+d.bot.avatar+'" alt="">';
    }
    document.getElementById('brand-name').textContent = d.bot.name;
    document.getElementById('brand-tag').textContent = d.bot.tag || '';

    // Status
    const st = document.getElementById('status');
    const stTxt = document.getElementById('status-text');
    if (d.status === 'online') {
      st.className = 'status-pill';
      stTxt.textContent = 'OPERATIONAL';
    } else {
      st.className = 'status-pill warn';
      stTxt.textContent = 'CONNECTING';
    }

    // Uptime (tick locally to avoid waiting for next fetch)
    localUptimeMs = d.uptimeMs;
    if (!uptimeTimer) {
      uptimeTimer = setInterval(() => {
        localUptimeMs += 1000;
        document.getElementById('kpi-uptime').textContent = fmtDur(localUptimeMs);
      }, 1000);
    }
    document.getElementById('kpi-uptime').textContent = fmtDur(localUptimeMs);

    document.getElementById('kpi-guilds').textContent = d.guilds;
    document.getElementById('kpi-users').textContent = d.users.toLocaleString() + ' users';
    document.getElementById('kpi-rooms').textContent = d.activeStreams;
    document.getElementById('kpi-played').textContent = d.totalSongsPlayed.toLocaleString();
    document.getElementById('kpi-ping').textContent = d.ping >= 0 ? d.ping + ' ms' : '--';

    // System
    document.getElementById('sys-os').textContent = d.system.os;
    document.getElementById('sys-cpus').textContent = d.system.cpus;
    document.getElementById('sys-node').textContent = d.system.nodeVersion;
    document.getElementById('sys-aud').textContent = d.users.toLocaleString();

    const rss = d.system.memoryUsedRss;
    const lim = d.system.memoryTotalLimit;
    const pct = Math.min(100, (rss/lim)*100);
    document.getElementById('ram-text').textContent = rss + ' MB / ' + lim + ' MB (' + pct.toFixed(1) + '%)';
    const fill = document.getElementById('ram-fill');
    fill.style.width = pct + '%';
    if (pct > 85) fill.style.background = 'linear-gradient(90deg, #fbbf24, #f87171)';
    else if (pct > 60) fill.style.background = 'linear-gradient(90deg, #818cf8, #fbbf24)';
    else fill.style.background = 'linear-gradient(90deg, #818cf8, #d946ef)';

    // Streams
    const streamsEl = document.getElementById('streams');
    if (!d.activeTracks.length) {
      streamsEl.innerHTML = '<div class="empty"><div class="icon">🎧</div><div class="ttl">No active rooms</div><div class="sub">Run <code>${PREFIX}play &lt;song&gt;</code> in a voice channel.</div></div>';
    } else {
      streamsEl.innerHTML = d.activeTracks.map((t) => {
        const pct = t.durationSeconds > 0 ? Math.min(100, (t.elapsedSeconds / t.durationSeconds) * 100) : 0;
        const thumb = t.thumbnail
          ? '<img src="'+escapeHtml(t.thumbnail)+'" alt="">'
          : '💿';
        const loopBadge = t.loop && t.loop !== 'off'
          ? '<span class="badge loop">🔁 '+t.loop+'</span>' : '';
        const upcomingHtml = t.upcoming.length
          ? '<div class="upcoming"><div class="sub-title">Up next</div>'+
            t.upcoming.map((u,i) => '<div class="upcoming-item">'+(i+1)+'. <a href="'+escapeHtml(u.url||'#')+'" target="_blank">'+escapeHtml(u.title)+'</a></div>').join('')+
            '</div>' : '';
        const titleHtml = t.songUrl
          ? '<a href="'+escapeHtml(t.songUrl)+'" target="_blank">'+escapeHtml(t.songTitle)+'</a>'
          : escapeHtml(t.songTitle);
        return '<div class="stream">'+
          '<div class="stream-head">'+
            '<div class="thumb">'+thumb+'</div>'+
            '<div class="stream-info">'+
              '<div class="stream-title">'+titleHtml+'</div>'+
              '<div class="stream-meta">'+
                '<span class="badge">🏛️ '+escapeHtml(t.guildName)+'</span>'+
                '<span class="badge">🔊 '+escapeHtml(t.voiceChannelName)+'</span>'+
                '<span class="badge">vol '+t.volume+'%</span>'+
                loopBadge+
                '<span class="badge live">● LIVE</span>'+
              '</div>'+
            '</div>'+
          '</div>'+
          '<div class="progress">'+
            '<div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%"></div></div>'+
            '<div class="progress-time"><span>'+t.elapsedText+'</span><span>'+t.durationText+'</span></div>'+
          '</div>'+
          upcomingHtml+
        '</div>';
      }).join('');
    }

    // Command log
    const logEl = document.getElementById('log');
    if (!d.commandLog.length) {
      logEl.innerHTML = '<div class="empty" style="padding: 18px 14px"><div class="sub">No commands yet.</div></div>';
    } else {
      logEl.innerHTML = d.commandLog.map((e) =>
        '<div class="log-entry">'+
          '<span class="log-cmd">${PREFIX}'+escapeHtml(e.command)+'</span>'+
          '<span class="log-meta">by '+escapeHtml(e.userName)+' in '+escapeHtml(e.guildName)+'</span>'+
          '<span class="log-time">'+timeAgo(e.timestamp)+'</span>'+
        '</div>'
      ).join('');
    }
  } catch (err) {
    const st = document.getElementById('status');
    st.className = 'status-pill err';
    document.getElementById('status-text').textContent = 'OFFLINE';
  }
}

// ───── Settings modal ─────
const modal = document.getElementById('settings-modal');
const tabBtns = document.querySelectorAll('.tab');
const tabGlobal = document.getElementById('tab-global');
const tabGuild = document.getElementById('tab-guild');
const guildSelect = document.getElementById('guild-select');
const resetBtn = document.getElementById('reset-guild');
const saveBtn = document.getElementById('save-settings');
const msgEl = document.getElementById('settings-msg');
const tokenInput = document.getElementById('admin-token');
const volSlider = document.getElementById('f-defaultVolume');
const volReadout = document.getElementById('vol-readout');

let currentTab = 'global';
let currentGuildId = null;
let lastDefaults = {};

function showMsg(text, kind) {
  msgEl.innerHTML = text ? '<div class="notice '+(kind||'')+'">'+text+'</div>' : '';
}

function setTab(tab) {
  currentTab = tab;
  tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  tabGlobal.style.display = tab === 'global' ? 'block' : 'none';
  tabGuild.style.display = tab === 'guild' ? 'block' : 'none';
  resetBtn.style.display = (tab === 'guild' && currentGuildId) ? 'inline-block' : 'none';
  loadCurrent();
}

tabBtns.forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

document.getElementById('open-settings').addEventListener('click', async () => {
  modal.classList.add('open');
  tokenInput.value = localStorage.getItem('adminToken') || '';
  await loadGuildList();
  setTab('global');
});
document.getElementById('close-settings').addEventListener('click', () => modal.classList.remove('open'));
document.getElementById('cancel-settings').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

volSlider.addEventListener('input', () => { volReadout.textContent = volSlider.value + '%'; });
guildSelect.addEventListener('change', () => {
  currentGuildId = guildSelect.value || null;
  resetBtn.style.display = currentGuildId ? 'inline-block' : 'none';
  loadCurrent();
});

async function loadGuildList() {
  try {
    const res = await fetch('/api/guilds');
    const data = await res.json();
    guildSelect.innerHTML = '<option value="">— pick a server —</option>' +
      data.guilds.map(g => '<option value="'+g.id+'">'+escapeHtml(g.name)+'</option>').join('');
  } catch {}
}

async function loadCurrent() {
  showMsg('');
  try {
    const guildId = (currentTab === 'guild' && currentGuildId) ? currentGuildId : '';
    const url = '/api/settings' + (guildId ? '?guildId=' + encodeURIComponent(guildId) : '');
    const res = await fetch(url);
    const data = await res.json();
    lastDefaults = data.defaults || {};

    const fillValue = (key) => {
      if (currentTab === 'guild' && currentGuildId) {
        // guild tab: show overrides only (blank if none); placeholder = global value
        const ov = data.guild?.[key];
        return { value: ov ?? '', placeholder: data.global?.[key] ?? data.defaults?.[key] ?? '' };
      } else {
        // global tab: show global value
        return { value: data.global?.[key] ?? data.defaults?.[key] ?? '', placeholder: '' };
      }
    };

    const apply = (id, key, type) => {
      const el = document.getElementById(id);
      const { value, placeholder } = fillValue(key);
      if (type === 'bool') {
        el.checked = !!(value === '' ? (data.global?.[key] ?? data.defaults?.[key]) : value);
      } else {
        el.value = value;
        if (placeholder !== '') el.placeholder = String(placeholder);
        else el.placeholder = '';
      }
    };

    apply('f-prefix', 'prefix', 'text');
    apply('f-defaultVolume', 'defaultVolume', 'num');
    apply('f-idleDisconnectSeconds', 'idleDisconnectSeconds', 'num');
    apply('f-emptyVcDisconnectSeconds', 'emptyVcDisconnectSeconds', 'num');
    apply('f-autoPauseWhenAlone', 'autoPauseWhenAlone', 'bool');
    volReadout.textContent = (volSlider.value || '0') + '%';

    if (!data.authEnabled) {
      showMsg('⚠️ ADMIN_TOKEN env var is not set on the server. Editing is disabled.', '');
      saveBtn.disabled = true;
    } else {
      saveBtn.disabled = false;
    }
  } catch (err) {
    showMsg('Failed to load settings: ' + (err.message || err), 'err');
  }
}

function collectPatch() {
  const out = {};
  const prefix = document.getElementById('f-prefix').value.trim();
  const vol = document.getElementById('f-defaultVolume').value;
  const idle = document.getElementById('f-idleDisconnectSeconds').value;
  const empty = document.getElementById('f-emptyVcDisconnectSeconds').value;
  const auto = document.getElementById('f-autoPauseWhenAlone').checked;

  if (currentTab === 'guild' && currentGuildId) {
    // Per-server: blank means "inherit global" → omit. Null tells server to clear override.
    if (prefix === '') out.prefix = null; else out.prefix = prefix;
    if (vol === '') out.defaultVolume = null; else out.defaultVolume = Number(vol);
    if (idle === '') out.idleDisconnectSeconds = null; else out.idleDisconnectSeconds = Number(idle);
    if (empty === '') out.emptyVcDisconnectSeconds = null; else out.emptyVcDisconnectSeconds = Number(empty);
    out.autoPauseWhenAlone = auto;
  } else {
    if (prefix !== '') out.prefix = prefix;
    if (vol !== '') out.defaultVolume = Number(vol);
    if (idle !== '') out.idleDisconnectSeconds = Number(idle);
    if (empty !== '') out.emptyVcDisconnectSeconds = Number(empty);
    out.autoPauseWhenAlone = auto;
  }
  return out;
}

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) { showMsg('Enter your admin token first.', 'err'); return; }
  localStorage.setItem('adminToken', token);

  if (currentTab === 'guild' && !currentGuildId) {
    showMsg('Pick a server first.', 'err'); return;
  }

  const patch = collectPatch();
  // Strip nulls (treated as "inherit") into a separate clear list — but the sanitizer drops null values anyway
  Object.keys(patch).forEach(k => { if (patch[k] === null) delete patch[k]; });

  const url = '/api/settings' + (currentTab === 'guild' ? '?guildId=' + encodeURIComponent(currentGuildId) : '');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    showMsg('✅ Saved.', 'ok');
    setTimeout(loadCurrent, 200);
  } catch (err) {
    showMsg('❌ ' + (err.message || err), 'err');
  }
});

resetBtn.addEventListener('click', async () => {
  if (!currentGuildId) return;
  const token = tokenInput.value.trim();
  if (!token) { showMsg('Enter your admin token first.', 'err'); return; }
  localStorage.setItem('adminToken', token);
  if (!confirm('Reset this server to global defaults?')) return;

  try {
    const res = await fetch('/api/settings?guildId=' + encodeURIComponent(currentGuildId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ reset: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    showMsg('✅ Reset. This server now uses global defaults.', 'ok');
    setTimeout(loadCurrent, 200);
  } catch (err) {
    showMsg('❌ ' + (err.message || err), 'err');
  }
});

fetchStats();
setInterval(fetchStats, 2500);
</script>
</body>
</html>`;
}

module.exports = { startDashboardServer };
