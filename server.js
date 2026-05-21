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
  const PREFIX = '!';

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
  <title>${botName} - Cyber Music Dashboard</title>
  
  <!-- Premium Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --bg-color: #040409;
      --panel-bg: rgba(10, 11, 24, 0.7);
      --panel-border: rgba(255, 255, 255, 0.05);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #6366f1;
      --primary-rgb: 99, 102, 241;
      --accent: #d946ef;
      --accent-rgb: 217, 70, 239;
      --success: #10b981;
      --success-rgb: 16, 185, 129;
      --danger: #f43f5e;
      --warning: #f59e0b;
      --cyber-glow: 0 0 25px rgba(99, 102, 241, 0.25);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Outfit', sans-serif;
    }

    body {
      background-color: var(--bg-color);
      /* Cyber Grid Overlay with smooth breathing anim */
      background-image: 
        linear-gradient(rgba(99, 102, 241, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px),
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.18) 0px, transparent 60%),
        radial-gradient(at 100% 100%, rgba(217, 70, 239, 0.12) 0px, transparent 60%),
        radial-gradient(at 50% 0%, rgba(16, 185, 129, 0.06) 0px, transparent 50%);
      background-size: 32px 32px, 32px 32px, 100% 100%, 100% 100%, 100% 100%;
      background-attachment: fixed;
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 40px 20px;
      overflow-x: hidden;
      position: relative;
    }

    /* Cyber grid light sweep effect */
    body::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(to bottom, transparent, rgba(99, 102, 241, 0.02) 50%, transparent);
      animation: sweep 12s linear infinite;
      pointer-events: none;
      z-index: 1;
    }

    @keyframes sweep {
      0% { transform: translateY(-100%); }
      100% { transform: translateY(100%); }
    }

    .container {
      max-width: 1240px;
      margin: 0 auto;
      width: 100%;
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 32px;
      position: relative;
      z-index: 2;
    }

    /* Connection Error Banner */
    .error-banner {
      display: none;
      background: rgba(244, 63, 94, 0.15);
      border: 1px solid var(--danger);
      box-shadow: 0 0 25px rgba(244, 63, 94, 0.25);
      padding: 16px 28px;
      border-radius: 14px;
      color: #ffe4e6;
      font-weight: 600;
      text-align: center;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      animation: pulseAlert 2.5s infinite;
      letter-spacing: 0.5px;
    }

    @keyframes pulseAlert {
      0%, 100% { opacity: 0.95; transform: scale(1); }
      50% { opacity: 0.75; transform: scale(0.997); }
    }

    /* Header Styling */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 24px 32px;
      border-radius: 24px;
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255,255,255,0.05);
      position: relative;
      overflow: hidden;
    }

    header::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
      transform: translateX(-100%);
      animation: shineOverlay 8s infinite linear;
    }

    @keyframes shineOverlay {
      0% { transform: translateX(-100%); }
      30%, 100% { transform: translateX(100%); }
    }

    .bot-profile {
      display: flex;
      align-items: center;
      gap: 22px;
    }

    .bot-avatar-container {
      position: relative;
    }

    .bot-avatar {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      border: 2px solid var(--primary);
      background-color: rgba(99, 102, 241, 0.05);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      box-shadow: 0 0 20px rgba(99, 102, 241, 0.35);
      position: relative;
      transition: transform 0.5s cubic-bezier(0.25, 0.8, 0.25, 1);
    }

    .bot-avatar-container:hover .bot-avatar {
      transform: rotate(360deg);
      border-color: var(--accent);
      box-shadow: 0 0 25px rgba(217, 70, 239, 0.5);
    }

    .bot-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .bot-avatar-glow {
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      border: 2px solid transparent;
      background: linear-gradient(135deg, var(--primary), var(--accent)) border-box;
      -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      opacity: 0.4;
      animation: spinGlowRing 6s linear infinite;
    }

    @keyframes spinGlowRing {
      100% { transform: rotate(360deg); }
    }

    .bot-info h1 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.8px;
      background: linear-gradient(135deg, #ffffff 30%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .bot-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
      letter-spacing: -0.2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .bot-tag::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--primary);
      box-shadow: 0 0 6px var(--primary);
    }

    .system-status {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 22px;
      background: rgba(16, 185, 129, 0.05);
      border: 1px solid rgba(16, 185, 129, 0.2);
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.08);
      border-radius: 9999px;
      color: var(--success);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 1px;
      transition: all 0.3s;
    }

    .status-dot {
      width: 10px;
      height: 10px;
      background-color: var(--success);
      border-radius: 50%;
      position: relative;
      box-shadow: 0 0 10px var(--success);
    }

    .status-dot.connecting {
      background-color: var(--warning);
      box-shadow: 0 0 10px var(--warning);
    }

    .status-dot::after {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background-color: inherit;
      animation: pingGlow 2.5s cubic-bezier(0, 0, 0.2, 1) infinite;
      top: 0;
      left: 0;
    }

    @keyframes pingGlow {
      75%, 100% {
        transform: scale(3.5);
        opacity: 0;
      }
    }

    /* KPI Grid Styling */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 24px;
    }

    .kpi-card {
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      border-radius: 24px;
      padding: 26px 28px;
      display: flex;
      align-items: center;
      gap: 22px;
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      box-shadow: 0 15px 35px rgba(0, 0, 0, 0.3), inset 0 1px 1px rgba(255,255,255,0.02);
      position: relative;
      overflow: hidden;
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle at top right, rgba(255,255,255,0.03), transparent 70%);
      pointer-events: none;
    }

    .kpi-card:hover {
      transform: translateY(-6px);
      border-color: rgba(var(--primary-rgb), 0.3);
      box-shadow: 0 20px 40px rgba(var(--primary-rgb), 0.08), 0 0 20px rgba(var(--primary-rgb), 0.05);
    }

    .kpi-card.success:hover {
      border-color: rgba(var(--success-rgb), 0.3);
      box-shadow: 0 20px 40px rgba(var(--success-rgb), 0.08), 0 0 20px rgba(var(--success-rgb), 0.05);
    }

    .kpi-card.warning:hover {
      border-color: rgba(245, 158, 11, 0.3);
      box-shadow: 0 20px 40px rgba(245, 158, 11, 0.08), 0 0 20px rgba(245, 158, 11, 0.05);
    }

    .kpi-icon {
      width: 58px;
      height: 58px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-main);
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      transition: all 0.3s;
      flex-shrink: 0;
    }

    .kpi-card.primary .kpi-icon { color: #818cf8; background: rgba(99, 102, 241, 0.07); border-color: rgba(99, 102, 241, 0.15); }
    .kpi-card.success .kpi-icon { color: #34d399; background: rgba(16, 185, 129, 0.07); border-color: rgba(16, 185, 129, 0.15); }
    .kpi-card.warning .kpi-icon { color: #fbbf24; background: rgba(245, 158, 11, 0.07); border-color: rgba(245, 158, 11, 0.15); }
    .kpi-card.danger .kpi-icon { color: #fda4af; background: rgba(244, 63, 94, 0.07); border-color: rgba(244, 63, 94, 0.15); }

    .kpi-card:hover .kpi-icon {
      transform: scale(1.1);
    }

    .kpi-content {
      flex-grow: 1;
    }

    .kpi-value {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -1px;
      background: linear-gradient(135deg, #ffffff 40%, #c7d2fe 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .kpi-label {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    /* Core Content Grid Split */
    .dashboard-details {
      display: grid;
      grid-template-columns: 1fr 1.3fr;
      gap: 28px;
    }

    @media (max-width: 1000px) {
      .dashboard-details {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background: var(--panel-bg);
      border: 1px solid var(--panel-border);
      border-radius: 24px;
      padding: 28px;
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255,255,255,0.02);
      display: flex;
      flex-direction: column;
      gap: 24px;
      position: relative;
      transition: border-color 0.3s;
    }

    .panel:hover {
      border-color: rgba(255,255,255,0.08);
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      padding-bottom: 18px;
    }

    .panel-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .panel-header svg {
      width: 22px;
      height: 22px;
      color: var(--primary);
      filter: drop-shadow(0 0 6px rgba(var(--primary-rgb), 0.4));
    }

    .panel-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 19px;
      font-weight: 700;
      letter-spacing: -0.4px;
    }

    /* Hardware Telemetry Meter Details */
    .resource-stat {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .resource-label {
      display: flex;
      justify-content: space-between;
      font-size: 14px;
      color: var(--text-muted);
      font-weight: 600;
    }

    .resource-value {
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-main);
      font-weight: 700;
      background: rgba(255,255,255,0.03);
      padding: 2px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.05);
    }

    .progress-bar-container {
      width: 100%;
      height: 16px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 9999px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 3px;
      overflow: hidden;
      position: relative;
    }

    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%);
      border-radius: 9999px;
      width: 0%;
      box-shadow: 0 0 15px rgba(var(--primary-rgb), 0.5);
      transition: width 1.2s cubic-bezier(0.16, 1, 0.3, 1), background-image 0.5s;
      position: relative;
    }

    .progress-bar::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0.25) 50%,
        rgba(255, 255, 255, 0) 100%
      );
      animation: progressSweep 2.5s infinite linear;
    }

    @keyframes progressSweep {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }

    .system-details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 8px;
    }

    .sys-info-box {
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.04);
      padding: 16px;
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.3s;
    }

    .sys-info-box:hover {
      border-color: rgba(var(--primary-rgb), 0.25);
      background: rgba(var(--primary-rgb), 0.02);
      transform: translateY(-2px);
    }

    .sys-label {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }

    .sys-val {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
      font-family: 'Space Grotesk', sans-serif;
    }

    /* Active Playback visual upgrades */
    .active-tracks-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-height: 480px;
      overflow-y: auto;
      padding-right: 6px;
    }

    .active-tracks-list::-webkit-scrollbar {
      width: 6px;
    }
    .active-tracks-list::-webkit-scrollbar-track {
      background: transparent;
    }
    .active-tracks-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.06);
      border-radius: 99px;
    }
    .active-tracks-list::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .track-card {
      background: rgba(255, 255, 255, 0.01);
      border: 1px solid rgba(255, 255, 255, 0.03);
      padding: 20px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      gap: 20px;
      position: relative;
      transition: all 0.3s;
      overflow: hidden;
    }

    .track-card::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      width: 3px;
      background: linear-gradient(to bottom, var(--primary), var(--accent));
      opacity: 0.6;
    }

    .track-card:hover {
      border-color: rgba(var(--primary-rgb), 0.25);
      background: rgba(255, 255, 255, 0.02);
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }

    .vinyl-wrapper {
      position: relative;
      width: 58px;
      height: 58px;
      flex-shrink: 0;
    }

    .vinyl-disc {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: repeating-radial-gradient(#08080c, #08080c 2px, #161726 3px, #161726 4px);
      box-shadow: 
        0 6px 20px rgba(0, 0, 0, 0.8),
        inset 0 0 10px rgba(255, 255, 255, 0.05);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: rotateVinyl 3.5s linear infinite;
    }

    .vinyl-center {
      width: 20px;
      height: 20px;
      background-color: var(--primary);
      border-radius: 50%;
      border: 2px solid #040409;
      box-shadow: 0 0 6px rgba(var(--primary-rgb), 0.6);
      background-image: radial-gradient(circle, var(--accent) 20%, transparent 60%);
    }

    @keyframes rotateVinyl {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .track-details {
      flex-grow: 1;
      min-width: 0;
    }

    .track-title-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }

    .track-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-main);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-grow: 1;
      font-family: 'Space Grotesk', sans-serif;
    }

    .track-title a {
      color: inherit;
      text-decoration: none;
      transition: color 0.2s, text-shadow 0.2s;
    }

    .track-title a:hover {
      color: var(--primary);
      text-shadow: 0 0 10px rgba(var(--primary-rgb), 0.3);
    }

    /* Live Equalizer CSS bounce animation */
    .equalizer-bars {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 18px;
      width: 18px;
      flex-shrink: 0;
    }

    .eq-bar {
      width: 2px;
      background-color: var(--primary);
      border-radius: 99px;
      animation: eqBounce 0.8s ease-in-out infinite alternate;
      transform-origin: bottom;
    }

    .eq-bar:nth-child(1) { height: 30%; animation-delay: 0.1s; }
    .eq-bar:nth-child(2) { height: 80%; animation-delay: 0.4s; background-color: var(--accent); }
    .eq-bar:nth-child(3) { height: 100%; animation-delay: 0.25s; background-color: #818cf8; }
    .eq-bar:nth-child(4) { height: 45%; animation-delay: 0.5s; }

    @keyframes eqBounce {
      0% { transform: scaleY(0.2); }
      100% { transform: scaleY(1); }
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
      background: rgba(255, 255, 255, 0.02);
      padding: 4px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .meta-badge.guild {
      background: rgba(99, 102, 241, 0.06);
      color: #c7d2fe;
      border-color: rgba(99, 102, 241, 0.18);
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta-badge.loop-active {
      background: rgba(16, 185, 129, 0.06);
      color: #a7f3d0;
      border-color: rgba(16, 185, 129, 0.18);
      animation: neonPulseGreen 2s infinite alternate;
    }

    @keyframes neonPulseGreen {
      0% { box-shadow: 0 0 2px rgba(16, 185, 129, 0.1); }
      100% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.3); }
    }

    /* Flashing live broadcasting badge */
    .live-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: rgba(244, 63, 94, 0.08);
      border: 1px solid rgba(244, 63, 94, 0.2);
      padding: 3px 10px;
      border-radius: 99px;
      color: #fda4af;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.8px;
      animation: fadeLive 1.5s infinite ease-in-out;
    }

    @keyframes fadeLive {
      0%, 100% { opacity: 0.7; }
      50% { opacity: 1; filter: drop-shadow(0 0 3px rgba(244, 63, 94, 0.5)); }
    }

    /* Empty state */
    .empty-state {
      padding: 70px 20px;
      text-align: center;
      color: var(--text-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      background: rgba(255,255,255,0.005);
      border-radius: 18px;
      border: 1px dashed rgba(255,255,255,0.03);
    }

    .empty-state svg {
      width: 48px;
      height: 48px;
      stroke: var(--text-muted);
      opacity: 0.25;
      filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.02));
      animation: floatIcon 4s ease-in-out infinite;
    }

    @keyframes floatIcon {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }

    .empty-state-title {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 700;
      color: var(--text-main);
      font-size: 16px;
      letter-spacing: -0.2px;
    }

    .empty-state-subtitle {
      font-size: 13px;
      margin-top: 6px;
      max-width: 320px;
      line-height: 1.6;
    }

    /* Commands Helper Section */
    .console-panel {
      background: linear-gradient(135deg, rgba(12,13,29,0.85) 0%, rgba(6,7,16,0.9) 100%);
      border: 1px solid rgba(99, 102, 241, 0.15);
      box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4), 0 0 15px rgba(99, 102, 241, 0.05);
    }

    .cmd-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
    }

    .cmd-box {
      background: rgba(255, 255, 255, 0.01);
      border: 1px solid rgba(255, 255, 255, 0.03);
      padding: 12px 16px;
      border-radius: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: all 0.2s;
    }

    .cmd-box:hover {
      border-color: rgba(217, 70, 239, 0.25);
      background: rgba(217, 70, 239, 0.01);
      transform: scale(1.02);
    }

    .cmd-name {
      color: var(--accent);
      font-weight: 700;
    }

    .cmd-desc {
      color: var(--text-muted);
      font-size: 11px;
      font-family: 'Outfit', sans-serif;
    }

    footer {
      text-align: center;
      padding: 50px 0 20px;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      border-top: 1px solid rgba(255,255,255,0.03);
      margin-top: 20px;
    }

    footer a {
      color: var(--primary);
      text-decoration: none;
      transition: all 0.2s;
      position: relative;
    }

    footer a::after {
      content: '';
      position: absolute;
      bottom: -2px;
      left: 0;
      width: 100%;
      height: 1px;
      background: var(--accent);
      transform: scaleX(0);
      transform-origin: right;
      transition: transform 0.3s ease;
    }

    footer a:hover {
      color: var(--accent);
      text-shadow: 0 0 10px rgba(var(--accent-rgb), 0.4);
    }

    footer a:hover::after {
      transform: scaleX(1);
      transform-origin: left;
    }
  </style>
</head>
<body>
  <div class="container">
    
    <div id="error-banner" class="error-banner">
      ⚠️ SYSTEM OFFLINE: WebSocket connection severed. Re-negotiating secure telemetry handshake...
    </div>

    <header>
      <div class="bot-profile">
        <div class="bot-avatar-container">
          <div class="bot-avatar-glow"></div>
          <div class="bot-avatar">
            ${botAvatar ? `<img src="${botAvatar}" alt="Avatar">` : `<div class="bot-avatar-fallback">🎵</div>`}
          </div>
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
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </div>
        <div class="kpi-content">
          <div id="kpi-uptime" class="kpi-value">--</div>
          <div class="kpi-label">System Uptime</div>
        </div>
      </div>
      
      <!-- SERVERS -->
      <div class="kpi-card success">
        <div class="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        </div>
        <div class="kpi-content">
          <div id="kpi-servers" class="kpi-value">--</div>
          <div class="kpi-label">Connected Guilds</div>
        </div>
      </div>

      <!-- ACTIVE STREAMS -->
      <div class="kpi-card warning">
        <div class="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v1a7 7 0 0 1-14 0v-1"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
        </div>
        <div class="kpi-content">
          <div id="kpi-streams" class="kpi-value">--</div>
          <div class="kpi-label">Active Music Rooms</div>
        </div>
      </div>

      <!-- PING LATENCY -->
      <div class="kpi-card primary" id="ping-card">
        <div class="kpi-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m22 12-4-4v3H3v2h15v3l4-4Z"></path></svg>
        </div>
        <div class="kpi-content">
          <div id="kpi-ping" class="kpi-value">--</div>
          <div class="kpi-label">Gateway Latency</div>
        </div>
      </div>
    </div>

    <div class="dashboard-details">
      <!-- Left Panel: Performance & System Specs -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-header-left">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
            <div class="panel-title">Micro-VM Performance Specs</div>
          </div>
        </div>

        <div class="resource-stat">
          <div class="resource-label">
            <span>Container Memory Allocation</span>
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
            <div class="sys-label">Runtime Engine</div>
            <div id="sys-node" class="sys-val">--</div>
          </div>
          <div class="sys-info-box">
            <div class="sys-label">Aggregated Audience</div>
            <div id="sys-users" class="sys-val">--</div>
          </div>
        </div>
      </div>

      <!-- Right Panel: Active Playback Streams -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-header-left">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            <div class="panel-title">Real-Time Streams Room</div>
          </div>
        </div>

        <div id="active-tracks-container" class="active-tracks-list">
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
            <div>
              <div class="empty-state-title">No Active Audio Rooms</div>
              <div class="empty-state-subtitle">Launch a DJ session in your voice channel using the !play command!</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Commands Helper Console -->
    <div class="panel console-panel">
      <div class="panel-header">
        <div class="panel-header-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
          <div class="panel-title">DJ Command Control Console</div>
        </div>
      </div>
      <div class="cmd-grid">
        <div class="cmd-box">
          <span class="cmd-name">${PREFIX}play &lt;query/url&gt;</span>
          <span class="cmd-desc">Add a track to the queue and stream instantly</span>
        </div>
        <div class="cmd-box">
          <span class="cmd-name">${PREFIX}skip</span>
          <span class="cmd-desc">Skip the current playing music track</span>
        </div>
        <div class="cmd-box">
          <span class="cmd-name">${PREFIX}stop</span>
          <span class="cmd-desc">Stop audio, flush the queue, and disconnect</span>
        </div>
        <div class="cmd-box">
          <span class="cmd-name">${PREFIX}queue</span>
          <span class="cmd-desc">Display all current tracks in the queue list</span>
        </div>
        <div class="cmd-box">
          <span class="cmd-name">${PREFIX}loop &lt;song/queue/off&gt;</span>
          <span class="cmd-desc">Toggles loop configuration setting</span>
        </div>
        <div class="cmd-box">
          <span class="cmd-name">${PREFIX}volume &lt;1-100&gt;</span>
          <span class="cmd-desc">Modify bot playback audio sound volume</span>
        </div>
      </div>
    </div>

    <footer>
      J4FN Cyber Telemetry Dashboard • Telemetry Systems Powered by <a href="https://fly.io" target="_blank">Fly.io</a>
    </footer>

  </div>

  <script>
    let rawUptimeMs = 0;
    let uptimeInterval = null;

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

    async function fetchStats() {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) throw new Error('API down');
        
        const data = await res.json();
        
        document.getElementById('error-banner').style.display = 'none';

        const statusBadge = document.getElementById('status-badge');
        const statusBadgeDot = document.getElementById('status-badge-dot');
        const statusBadgeText = document.getElementById('status-badge-text');

        if (data.status === 'online') {
          statusBadge.style.background = 'rgba(16, 185, 129, 0.05)';
          statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
          statusBadge.style.color = 'var(--success)';
          statusBadgeDot.className = 'status-dot';
          statusBadgeText.innerText = 'OPERATIONAL';
        } else {
          statusBadge.style.background = 'rgba(245, 158, 11, 0.05)';
          statusBadge.style.borderColor = 'rgba(245, 158, 11, 0.2)';
          statusBadge.style.color = 'var(--warning)';
          statusBadgeDot.className = 'status-dot connecting';
          statusBadgeText.innerText = 'GATEWAY HANDSHAKING';
        }

        rawUptimeMs = data.uptimeMs;
        document.getElementById('kpi-uptime').innerText = formatDuration(rawUptimeMs);
        if (!uptimeInterval) {
          uptimeInterval = setInterval(() => {
            rawUptimeMs += 1000;
            document.getElementById('kpi-uptime').innerText = formatDuration(rawUptimeMs);
          }, 1000);
        }

        document.getElementById('kpi-servers').innerText = data.guilds;
        document.getElementById('kpi-streams').innerText = data.activeStreams;
        
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

        document.getElementById('sys-os').innerText = data.system.os;
        document.getElementById('sys-cpus').innerText = data.system.cpus + ' Cores';
        document.getElementById('sys-node').innerText = data.system.nodeVersion;
        document.getElementById('sys-users').innerText = data.users.toLocaleString();

        const rssMB = parseFloat(data.system.memoryUsedRss);
        const limitMB = parseFloat(data.system.memoryTotalLimit);
        const percentage = Math.min((rssMB / limitMB) * 100, 100).toFixed(1);

        document.getElementById('ram-percentage-text').innerText = percentage + '% (' + rssMB + ' MB / ' + limitMB + ' MB)';
        document.getElementById('ram-progress').style.width = percentage + '%';

        const ramBar = document.getElementById('ram-progress');
        if (percentage < 60) {
          ramBar.style.background = 'linear-gradient(90deg, var(--primary) 0%, var(--accent) 100%)';
          ramBar.style.boxShadow = '0 0 15px rgba(var(--primary-rgb), 0.5)';
        } else if (percentage < 85) {
          ramBar.style.background = 'linear-gradient(90deg, var(--warning) 0%, #f59e0b 100%)';
          ramBar.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.4)';
        } else {
          ramBar.style.background = 'linear-gradient(90deg, var(--danger) 0%, #f43f5e 100%)';
          ramBar.style.boxShadow = '0 0 15px rgba(244, 63, 94, 0.6)';
        }

        const tracksContainer = document.getElementById('active-tracks-container');
        if (data.activeTracks.length === 0) {
          tracksContainer.innerHTML = \`
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
              <div>
                <div class="empty-state-title">No Active Audio Rooms</div>
                <div class="empty-state-subtitle">Launch a DJ session in your voice channel using the !play command!</div>
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
                  <div class="track-title-container">
                    <div class="track-title" title="\${track.songTitle}">\${linkHtml}</div>
                    <div class="equalizer-bars">
                      <div class="eq-bar"></div>
                      <div class="eq-bar"></div>
                      <div class="eq-bar"></div>
                      <div class="eq-bar"></div>
                    </div>
                  </div>
                  <div class="track-meta">
                    <span class="meta-badge guild" title="\${track.guildName}">🏛️ \${track.guildName}</span>
                    <span class="meta-badge">🔊 \${track.voiceChannelName}</span>
                    <span class="meta-badge">🎵 vol: \${track.volume}%</span>
                    \${loopBadgeHtml}
                    <span class="live-badge">● LIVE</span>
                  </div>
                </div>
              </div>
            \`;
          });
          tracksContainer.innerHTML = tracksHtml;
        }

      } catch (err) {
        console.error('Fetch error:', err);
        document.getElementById('error-banner').style.display = 'block';
        document.getElementById('status-badge-dot').className = 'status-dot connecting';
        document.getElementById('status-badge-text').innerText = 'OFFLINE';
      }
    }

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
