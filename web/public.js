(() => {
  'use strict';

  const progressState = new Map();
  let failures = 0;

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const formatCount = (value) => new Intl.NumberFormat().format(Number(value || 0));
  const formatDuration = (milliseconds) => {
    let seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const days = Math.floor(seconds / 86400); seconds %= 86400;
    const hours = Math.floor(seconds / 3600); seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds % 60}s`;
  };
  const formatClock = (seconds) => {
    const value = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = value % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`;
  };

  function setConnectionState(state) {
    const online = state === 'online';
    const dot = document.querySelector('.live-dot');
    dot?.classList.toggle('online', online);
    $('hero-state').textContent = online ? 'Live and operational' : state === 'offline' ? 'Dashboard unreachable' : 'Reconnecting to Discord';
    $('signal-status').textContent = online ? 'Online' : state;
  }

  function setIdentity(bot) {
    if (!bot) return;
    $('brand-name').textContent = bot.name || 'Discord Music';
    $('signal-tag').textContent = bot.tag || 'Discord gateway';
  }

  function setCommandPrefix(prefix) {
    const safePrefix = String(prefix || '!').slice(0, 5);
    document.querySelectorAll('[data-command]').forEach((element) => {
      element.textContent = `${safePrefix}${element.dataset.command}`;
    });
    $('command-prefix').textContent = safePrefix;
  }

  function renderTracks(tracks) {
    const container = $('public-tracks');
    progressState.clear();
    if (!tracks?.length) {
      container.innerHTML = '<div class="empty-state"><span>♬</span><strong>The stage is quiet</strong><p>Active tracks will appear here automatically.</p></div>';
      return;
    }

    container.innerHTML = tracks.map((track) => {
      const image = safeUrl(track.thumbnail);
      const link = safeUrl(track.url);
      const duration = Number(track.durationSeconds || 0);
      const elapsed = Math.min(Number(track.elapsedSeconds || 0), duration || Infinity);
      const percentage = duration ? Math.min(100, (elapsed / duration) * 100) : 100;
      progressState.set(track.id, { elapsed, duration, paused: Boolean(track.paused) });
      const art = image
        ? `<img class="track-art" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : '<div class="track-art track-fallback">♫</div>';
      const title = link
        ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(track.title)}</a>`
        : escapeHtml(track.title);
      return `<article class="track-card">
        ${art}
        <div class="track-copy">
          <span>${track.paused ? 'PAUSED' : 'NOW PLAYING'}</span>
          <h3 title="${escapeHtml(track.title)}">${title}</h3>
          <div class="progress"><i id="public-fill-${escapeHtml(track.id)}" style="width:${percentage}%"></i></div>
          <div class="progress-labels"><span id="public-elapsed-${escapeHtml(track.id)}">${escapeHtml(track.elapsedText || formatClock(elapsed))}</span><span>${escapeHtml(track.durationText || 'live')}</span></div>
        </div>
      </article>`;
    }).join('');
  }

  async function refreshStatus() {
    try {
      const response = await fetch('/api/public/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      failures = 0;
      setConnectionState(data.status);
      setIdentity(data.bot);
      setCommandPrefix(data.prefix);
      $('metric-uptime').textContent = formatDuration(data.uptimeMs);
      $('metric-guilds').textContent = formatCount(data.guilds);
      $('metric-audience').textContent = `${formatCount(data.audience)} listeners in reach`;
      $('metric-streams').textContent = formatCount(data.activeStreams);
      $('metric-tracks').textContent = formatCount(data.totalSongsPlayed);
      $('metric-ping').textContent = data.ping >= 0 ? `${Math.round(data.ping)} ms` : '—';
      $('last-updated').textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      renderTracks(data.activeTracks);
      renderServers(data.servers);
    } catch {
      failures += 1;
      if (failures >= 3) setConnectionState('offline');
      else setConnectionState('reconnecting');
    }
  }

  function renderServers(servers) {
    const container = $('public-servers');
    if (!container) return;
    const countEl = $('servers-count');
    if (countEl) countEl.textContent = `${formatCount(servers?.length || 0)} servers`;
    if (!servers?.length) {
      container.innerHTML = '<div class="empty-state"><span>🏰</span><strong>No servers joined yet</strong><p>Invite the bot to your Discord server to see it featured here.</p></div>';
      return;
    }

    container.innerHTML = servers.map((server) => {
      const image = safeUrl(server.iconURL);
      const name = escapeHtml(server.name || 'Discord Server');
      const initials = (server.name || 'DS').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
      const iconHtml = image
        ? `<img class="server-icon" src="${escapeHtml(image)}" alt="${name}" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="server-icon server-fallback">${escapeHtml(initials)}</div>`;
      const badgeHtml = server.active
        ? '<span class="server-badge active"><i class="pulse-dot"></i> Playing</span>'
        : '<span class="server-badge">Idle</span>';
      return `<article class="server-card">
        <div class="server-avatar-wrap">
          ${iconHtml}
        </div>
        <div class="server-info">
          <h3 title="${name}">${name}</h3>
          <div class="server-meta">
            <span class="server-members">${formatCount(server.memberCount)} members</span>
            ${badgeHtml}
          </div>
        </div>
      </article>`;
    }).join('');
  }

  function chartGeometry(values) {
    if (!values.length) return { points: '', area: '' };
    const clean = values.map((value) => Math.max(0, Number(value) || 0));
    const max = Math.max(...clean, 1);
    const min = Math.min(...clean);
    const span = Math.max(max - min, max * .2, 1);
    const points = clean.map((value, index) => {
      const x = clean.length === 1 ? 300 : (index / (clean.length - 1)) * 600;
      const y = 165 - ((value - min) / span) * 135;
      return [x.toFixed(1), Math.max(15, Math.min(165, y)).toFixed(1)];
    });
    const line = points.map((point) => point.join(',')).join(' ');
    const area = `M ${points[0][0]} 180 L ${points.map((point) => point.join(' ')).join(' L ')} L ${points.at(-1)[0]} 180 Z`;
    return { points: line, area };
  }

  function drawChart(prefix, values, suffix = '') {
    const { points, area } = chartGeometry(values);
    $(`${prefix}-line`).setAttribute('points', points);
    $(`${prefix}-area`).setAttribute('d', area);
    const latest = values.at(-1);
    $(`chart-${prefix}-value`).textContent = latest == null || latest < 0 ? '—' : `${Math.round(latest)}${suffix}`;
  }

  async function refreshHistory() {
    try {
      const response = await fetch('/api/public/history', { cache: 'no-store' });
      if (!response.ok) return;
      const { points = [] } = await response.json();
      drawChart('ping', points.map((point) => point.ping).filter((value) => value >= 0), ' ms');
      drawChart('stream', points.map((point) => point.activeStreams));
    } catch { /* The live status remains useful without chart history. */ }
  }

  setInterval(() => {
    progressState.forEach((state, id) => {
      if (!state.paused && state.duration && state.elapsed < state.duration) state.elapsed += 1;
      const fill = $(`public-fill-${id}`);
      const label = $(`public-elapsed-${id}`);
      if (fill && state.duration) fill.style.width = `${Math.min(100, (state.elapsed / state.duration) * 100)}%`;
      if (label) label.textContent = formatClock(state.elapsed);
    });
  }, 1000);

  refreshStatus();
  refreshHistory();
  setInterval(refreshStatus, 10_000);
  setInterval(refreshHistory, 30_000);
})();
