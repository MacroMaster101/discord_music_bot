const http = require('http');
const os = require('os');

function formatUptime(uptimeSeconds) {
  const seconds = Math.floor(uptimeSeconds % 60);
  const minutes = Math.floor((uptimeSeconds / 60) % 60);
  const hours = Math.floor((uptimeSeconds / 3600) % 24);
  const days = Math.floor(uptimeSeconds / 86400);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function getVolume(serverQueue) {
  const resource = serverQueue?.player?.state?.resource;
  if (resource?.volume) {
    return Math.round(resource.volume.volume * 100);
  }
  return 50;
}

function startDashboardServer(client, queue) {
  const PORT = process.env.PORT || 8080;

  const server = http.createServer((req, res) => {
    // 1. API Stats Endpoint
    if (req.url === '/api/stats') {
      const isOnline = client && client.user && client.ws.status === 0;
      
      const stats = {
        status: isOnline ? 'online' : 'connecting',
        uptime: formatUptime(process.uptime()),
        uptimeMs: Math.floor(process.uptime() * 1000),
        ping: isOnline ? client.ws.ping : -1,
        guilds: isOnline ? client.guilds.cache.size : 0,
        users: isOnline ? client.guilds.cache.reduce((acc, g) => acc + (g.memberCount || 0), 0) : 0,
        activeStreams: queue.size,
        system: {
          os: os.type(),
          cpus: os.cpus().length,
          nodeVersion: process.version,
          memoryUsedRss: (process.memoryUsage().rss / 1024 / 1024).toFixed(1),
          memoryTotalLimit: 512, // Fly.io VM RAM limit context
        },
        activeTracks: Array.from(queue.entries()).map(([guildId, serverQueue]) => {
          const currentSong = serverQueue.songs[0];
          return {
            guildId,
            guildName: serverQueue.textChannel.guild.name,
            voiceChannelName: serverQueue.voiceChannel.name,
            songTitle: currentSong ? currentSong.title : 'None',
            songUrl: currentSong ? currentSong.url : null,
            loop: serverQueue.loop || 'off',
            volume: getVolume(serverQueue)
          };
        }).filter(track => track.songTitle !== 'None')
      };

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(stats));
    }

    // 2. Main Dashboard Page serving (Root)
    if (req.url === '/' || req.url === '/index.html') {
      const botName = client?.user?.username || 'J4FN MUSIC';
      const botTag = client?.user?.tag || 'J4FN MUSIC#3509';
      const botAvatar = client?.user?.displayAvatarURL({ size: 128 }) || '';

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${botName} - Live Status Dashboard</title>
  <!-- Outfit and Inter Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --bg-color: #0b0f19;
      --panel-bg: rgba(17, 24, 39, 0.6);
      --panel-border: rgba(255, 255, 255, 0.08);
      --accent-glow: rgba(99, 102, 241, 0.15);
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --success: #10b981;
      --danger: #ef4444;
      --warning: #f59e0b;
      --card-gradient: linear-gradient(135deg, rgba(31, 41, 55, 0.4) 0%, rgba(17, 24, 39, 0.4) 100%);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Inter', sans-serif;
      transition: background-color 0.3s, border-color 0.3s;
    }

    body {
      background-color: var(--bg-color);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 0%, rgba(168, 85, 247, 0.1) 0px, transparent 50%);
      background-attachment: fixed;
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 24px;
      overflow-x: hidden;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* Connection Error Banner */
    .error-banner {
      display: none;
      background-color: rgba(239, 68, 68, 0.2);
      border: 1px solid var(--danger);
      padding: 12px 24px;
      border-radius: 12px;
      color: #fee2e2;
      font-weight: 500;
      text-align: center;
      backdrop-filter: blur(8px);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { opacity: 0.9; }
      50% { opacity: 0.6; }
      100% { opacity: 0.9; }
    }

    /* Header Styling */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px;
      border-radius: 16px;
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
    }

    .bot-profile {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .bot-avatar {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: 2px solid var(--primary);
      background-color: rgba(99, 102, 241, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.3);
    }

    .bot-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .bot-avatar-fallback {
      font-size: 24px;
    }

    .bot-info h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }

    .bot-tag {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .system-status {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 9999px;
      color: var(--success);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      position: relative;
      box-shadow: 0 0 8px var(--success);
    }

    .status-dot.connecting {
      background-color: var(--warning);
      box-shadow: 0 0 8px var(--warning);
    }

    .status-dot::after {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background-color: inherit;
      animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
      top: 0;
      left: 0;
    }

    @keyframes ping {
      75%, 100% {
        transform: scale(2.5);
        opacity: 0;
      }
    }

    /* Metric Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 20px;
    }

    .kpi-card {
      background: var(--card-gradient);
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 20px;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
      position: relative;
      overflow: hidden;
    }

    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: transparent;
    }

    .kpi-card.primary::before { background: var(--primary); }
    .kpi-card.success::before { background: var(--success); }
    .kpi-card.warning::before { background: var(--warning); }
    .kpi-card.danger::before { background: var(--danger); }

    .kpi-icon {
      background: rgba(255, 255, 255, 0.03);
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-main);
      border: 1px solid var(--panel-border);
    }

    .kpi-card.primary .kpi-icon { color: #818cf8; background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.2); }
    .kpi-card.success .kpi-icon { color: #34d399; background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.2); }
    .kpi-card.warning .kpi-icon { color: #fbbf24; background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.2); }
    .kpi-card.danger .kpi-icon { color: #f87171; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.2); }

    .kpi-content {
      flex-grow: 1;
    }

    .kpi-value {
      font-family: 'Outfit', sans-serif;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }

    .kpi-label {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
      font-weight: 500;
    }

    /* Core Content Grid Split */
    .dashboard-details {
      display: grid;
      grid-template-columns: 1fr 1.6fr;
      gap: 24px;
    }

    @media (max-width: 900px) {
      .dashboard-details {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      padding: 24px;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid var(--panel-border);
      padding-bottom: 16px;
    }

    .panel-header svg {
      width: 20px;
      height: 20px;
      color: var(--primary);
    }

    .panel-title {
      font-family: 'Outfit', sans-serif;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.2px;
    }

    /* Performance Resources Panel details */
    .resource-stat {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .resource-label {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 500;
    }

    .resource-value {
      color: var(--text-main);
      font-weight: 600;
    }

    .progress-bar-container {
      width: 100%;
      height: 10px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 9999px;
      border: 1px solid var(--panel-border);
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--primary) 0%, #a855f7 100%);
      border-radius: 9999px;
      width: 0%;
      transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .system-details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 10px;
    }

    .sys-info-box {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--panel-border);
      padding: 12px;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .sys-label {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .sys-val {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-main);
    }

    /* Active playback listing */
    .active-tracks-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-height: 480px;
      overflow-y: auto;
      padding-right: 4px;
    }

    .active-tracks-list::-webkit-scrollbar {
      width: 6px;
    }
    .active-tracks-list::-webkit-scrollbar-track {
      background: transparent;
    }
    .active-tracks-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 99px;
    }

    .track-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--panel-border);
      padding: 16px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      gap: 16px;
      position: relative;
    }

    .track-card:hover {
      border-color: rgba(99, 102, 241, 0.25);
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.05);
    }

    .vinyl-wrapper {
      position: relative;
      width: 48px;
      height: 48px;
      flex-shrink: 0;
    }

    .vinyl-disc {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: repeating-radial-gradient(#111, #111 2px, #222 3px, #222 4px);
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.5), inset 0 0 5px rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: rotateVinyl 4s linear infinite;
    }

    .vinyl-center {
      width: 16px;
      height: 16px;
      background-color: var(--primary);
      border-radius: 50%;
      border: 2px solid #000;
    }

    @keyframes rotateVinyl {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .track-details {
      flex-grow: 1;
      min-width: 0;
    }

    .track-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    }

    .track-title a {
      color: inherit;
      text-decoration: none;
    }

    .track-title a:hover {
      color: var(--primary);
      text-decoration: underline;
    }

    .track-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .meta-badge {
      background: rgba(255, 255, 255, 0.04);
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid var(--panel-border);
      font-size: 11px;
    }

    .meta-badge.guild {
      background: rgba(99, 102, 241, 0.08);
      color: #a5b4fc;
      border-color: rgba(99, 102, 241, 0.15);
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta-badge.loop-active {
      background: rgba(16, 185, 129, 0.08);
      color: #6ee7b7;
      border-color: rgba(16, 185, 129, 0.2);
    }

    /* Empty state */
    .empty-state {
      padding: 48px 24px;
      text-align: center;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }

    .empty-state svg {
      width: 48px;
      height: 48px;
      stroke: var(--text-muted);
      opacity: 0.4;
    }

    .empty-state-title {
      font-weight: 600;
      color: var(--text-main);
      font-size: 14px;
    }

    .empty-state-subtitle {
      font-size: 12px;
      margin-top: 4px;
      max-width: 250px;
    }

    footer {
      text-align: center;
      padding: 40px 0 20px;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.5px;
    }

    footer a {
      color: var(--primary);
      text-decoration: none;
    }

    footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    
    <div id="error-banner" class="error-banner">
      ⚠️ WebSocket Connection to bot lost! Attempting to reconnect and restore dashboard sync...
    </div>

    <header>
      <div class="bot-profile">
        <div class="bot-avatar">
          ${botAvatar ? `<img src="${botAvatar}" alt="Avatar">` : `<div class="bot-avatar-fallback">🎵</div>`}
        </div>
        <div class="bot-info">
          <h1>${botName}</h1>
          <div class="bot-tag">${botTag}</div>
        </div>
      </div>
      <div id="status-badge" class="system-status">
        <div id="status-badge-dot" class="status-dot"></div>
        <span id="status-badge-text">OPERATIONAL</span>
      </div>
    </header>

    <div class="kpi-grid">
      <!-- UPTIME -->
      <div class="kpi-card primary">
        <div class="kpi-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <div class="kpi-content">
          <div id="kpi-uptime" class="kpi-value">--</div>
          <div class="kpi-label">System Uptime</div>
        </div>
      </div>
      
      <!-- SERVERS -->
      <div class="kpi-card success">
        <div class="kpi-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        </div>
        <div class="kpi-content">
          <div id="kpi-servers" class="kpi-value">--</div>
          <div class="kpi-label">Connected Guilds</div>
        </div>
      </div>

      <!-- ACTIVE STREAMS -->
      <div class="kpi-card warning">
        <div class="kpi-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
        </div>
        <div class="kpi-content">
          <div id="kpi-streams" class="kpi-value">--</div>
          <div class="kpi-label">Active DJ Rooms</div>
        </div>
      </div>

      <!-- PING LATENCY -->
      <div class="kpi-card primary" id="ping-card">
        <div class="kpi-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 12-4-4v3H3v2h15v3l4-4Z"></path></svg>
        </div>
        <div class="kpi-content">
          <div id="kpi-ping" class="kpi-value">--</div>
          <div class="kpi-label">Gateway Ping</div>
        </div>
      </div>
    </div>

    <div class="dashboard-details">
      <!-- Left Panel: Performance & System Specs -->
      <div class="panel">
        <div class="panel-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
          <div class="panel-title">Resource & System Load</div>
        </div>

        <div class="resource-stat">
          <div class="resource-label">
            <span>Container Memory (RSS)</span>
            <span id="ram-percentage-text" class="resource-value">0.0% (-- MB / -- MB)</span>
          </div>
          <div class="progress-bar-container">
            <div id="ram-progress" class="progress-bar"></div>
          </div>
        </div>

        <div class="system-details-grid">
          <div class="sys-info-box">
            <div class="sys-label">OS Platform</div>
            <div id="sys-os" class="sys-val">--</div>
          </div>
          <div class="sys-info-box">
            <div class="sys-label">CPU Cores</div>
            <div id="sys-cpus" class="sys-val">--</div>
          </div>
          <div class="sys-info-box">
            <div class="sys-label">Node Runtime</div>
            <div id="sys-node" class="sys-val">--</div>
          </div>
          <div class="sys-info-box">
            <div class="sys-label">Total Users</div>
            <div id="sys-users" class="sys-val">--</div>
          </div>
        </div>
      </div>

      <!-- Right Panel: Active Playback Streams -->
      <div class="panel">
        <div class="panel-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
          <div class="panel-title">Live Playback Activity</div>
        </div>

        <div id="active-tracks-container" class="active-tracks-list">
          <!-- Active tracks injected here by dynamic fetch -->
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            <div>
              <div class="empty-state-title">No Active Music Rooms</div>
              <div class="empty-state-subtitle">Use the !play command inside a voice channel to get the music party started!</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer>
      J4FN Music Web Dashboard • Running securely on <a href="https://fly.io" target="_blank">Fly.io</a>
    </footer>

  </div>

  <script>
    let rawUptimeMs = 0;
    let uptimeInterval = null;

    // Format uptime helper for live clock
    function formatDuration(ms) {
      let seconds = Math.floor((ms / 1000) % 60);
      let minutes = Math.floor((ms / (1000 * 60)) % 60);
      let hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
      let days = Math.floor(ms / (1000 * 60 * 60 * 24));

      let parts = [];
      if (days > 0) parts.push(days + "d");
      if (hours > 0) parts.push(hours + "h");
      if (minutes > 0) parts.push(minutes + "m");
      parts.push(seconds + "s");
      return parts.join(" ");
    }

    // Dynamic poll function
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error('API down');
        
        const data = await res.json();
        
        // Hide error banner on success
        document.getElementById('error-banner').style.display = 'none';

        // Update Operational Badge
        const statusBadge = document.getElementById('status-badge');
        const statusBadgeDot = document.getElementById('status-badge-dot');
        const statusBadgeText = document.getElementById('status-badge-text');

        if (data.status === 'online') {
          statusBadge.style.background = 'rgba(16, 185, 129, 0.08)';
          statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
          statusBadge.style.color = 'var(--success)';
          statusBadgeDot.className = 'status-dot';
          statusBadgeText.innerText = 'OPERATIONAL';
        } else {
          statusBadge.style.background = 'rgba(245, 158, 11, 0.08)';
          statusBadge.style.borderColor = 'rgba(245, 158, 11, 0.2)';
          statusBadge.style.color = 'var(--warning)';
          statusBadgeDot.className = 'status-dot connecting';
          statusBadgeText.innerText = 'CONNECTING TO DISCORD';
        }

        // Live Uptime Sync
        rawUptimeMs = data.uptimeMs;
        document.getElementById('kpi-uptime').innerText = formatDuration(rawUptimeMs);
        if (!uptimeInterval) {
          uptimeInterval = setInterval(() => {
            rawUptimeMs += 1000;
            document.getElementById('kpi-uptime').innerText = formatDuration(rawUptimeMs);
          }, 1000);
        }

        // Guilds and Streams KPIs
        document.getElementById('kpi-servers').innerText = data.guilds;
        document.getElementById('kpi-streams').innerText = data.activeStreams;
        
        // Gateway Latency Card coloring
        const pingCard = document.getElementById('ping-card');
        const pingEl = document.getElementById('kpi-ping');
        pingEl.innerText = data.ping >= 0 ? data.ping + ' ms' : '--';
        
        if (data.ping < 0) {
          pingCard.className = "kpi-card primary";
        } else if (data.ping < 100) {
          pingCard.className = "kpi-card success";
        } else if (data.ping < 250) {
          pingCard.className = "kpi-card warning";
        } else {
          pingCard.className = "kpi-card danger";
        }

        // Sys Details
        document.getElementById('sys-os').innerText = data.system.os;
        document.getElementById('sys-cpus').innerText = data.system.cpus + ' Cores';
        document.getElementById('sys-node').innerText = data.system.nodeVersion;
        document.getElementById('sys-users').innerText = data.users.toLocaleString();

        // Memory Usage calculations (relative to 512MB limit)
        const rssMB = parseFloat(data.system.memoryUsedRss);
        const limitMB = parseFloat(data.system.memoryTotalLimit);
        const percentage = Math.min((rssMB / limitMB) * 100, 100).toFixed(1);

        document.getElementById('ram-percentage-text').innerText = percentage + '% (' + rssMB + ' MB / ' + limitMB + ' MB)';
        document.getElementById('ram-progress').style.width = percentage + '%';

        // Memory Progress bar color depending on usage
        const ramBar = document.getElementById('ram-progress');
        if (percentage < 60) {
          ramBar.style.background = 'linear-gradient(90deg, var(--primary) 0%, #a855f7 100%)';
        } else if (percentage < 85) {
          ramBar.style.background = 'linear-gradient(90deg, var(--warning) 0%, #f59e0b 100%)';
        } else {
          ramBar.style.background = 'linear-gradient(90deg, var(--danger) 0%, #ef4444 100%)';
        }

        // Active Track List render
        const tracksContainer = document.getElementById('active-tracks-container');
        if (data.activeTracks.length === 0) {
          tracksContainer.innerHTML = \`
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
              <div>
                <div class="empty-state-title">No Active Music Rooms</div>
                <div class="empty-state-subtitle">Use the !play command inside a voice channel to get the music party started!</div>
              </div>
            </div>
          \`;
        } else {
          let tracksHtml = '';
          data.activeTracks.forEach(track => {
            const hasLink = track.songUrl;
            const linkHtml = hasLink 
              ? \`<a href="\${track.songUrl}" target="_blank">\${track.songTitle}</a>\`
              : track.songTitle;

            const loopBadgeHtml = track.loop && track.loop !== 'off'
              ? \`<span class="meta-badge loop-active">🔁 loop: \${track.loop}</span>\`
              : '';

            tracksHtml += \`
              <div class="track-card">
                <div class="vinyl-wrapper">
                  <div class="vinyl-disc">
                    <div class="vinyl-center"></div>
                  </div>
                </div>
                <div class="track-details">
                  <div class="track-title" title="\${track.songTitle}">\${linkHtml}</div>
                  <div class="track-meta">
                    <span class="meta-badge guild" title="\${track.guildName}">🏛️ \${track.guildName}</span>
                    <span class="meta-badge">🔊 \${track.voiceChannelName}</span>
                    <span class="meta-badge">🎵 vol: \${track.volume}%</span>
                    \${loopBadgeHtml}
                  </div>
                </div>
              </div>
            \`;
          });
          tracksContainer.innerHTML = tracksHtml;
        }

      } catch (err) {
        console.error('Fetch error:', err);
        // Show error connection banner
        document.getElementById('error-banner').style.display = 'block';
        document.getElementById('status-badge-dot').className = 'status-dot connecting';
        document.getElementById('status-badge-text').innerText = 'OFFLINE';
      }
    }

    // Call and setup interval
    fetchStats();
    setInterval(fetchStats, 3000);
  </script>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }

    // 3. Fallback Route (404)
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Web Dashboard Server is live on port ${PORT}`);
  });

  server.on('error', (err) => {
    console.error('⚠️ Dashboard Server Error:', err.message || err);
  });
}

module.exports = {
  startDashboardServer
};
