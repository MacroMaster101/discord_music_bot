const http = require('http');
const os = require('os');

const PREFIX = '!';
const VM_MEMORY_MB = 2048;

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

    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderDashboardHtml());
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Dashboard live on :${PORT}`);
  });

  server.on('error', (err) => console.error('Dashboard error:', err.message || err));
}

function renderDashboardHtml() {
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
  <div id="status" class="status-pill warn">
    <span class="status-dot pulse"></span>
    <span id="status-text">CONNECTING</span>
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

fetchStats();
setInterval(fetchStats, 2500);
</script>
</body>
</html>`;
}

module.exports = { startDashboardServer };
