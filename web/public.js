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
    $('hero-state').textContent = online ? 'Live and operational' : state === 'offline' ? 'Status unavailable right now' : 'Reconnecting';
    $('signal-status').textContent = online ? 'Online' : state;
  }

  function setMaintenance(maintenance) {
    const enabled = Boolean(maintenance?.enabled);
    $('maintenance-banner').hidden = !enabled;
    if (!enabled) return;
    $('maintenance-message').textContent = maintenance.message || 'Music commands are paused for now.';
    $('hero-state').textContent = 'Online · under maintenance';
    $('signal-status').textContent = 'Maintenance';
  }

  function setIdentity(bot) {
    if (!bot) return;
    $('brand-name').textContent = bot.name || 'Discord Music';
    $('signal-tag').textContent = bot.tag || 'Music bot';
  }

  function setCommandPrefix(prefix) {
    const safePrefix = String(prefix || '!').slice(0, 5);
    document.querySelectorAll('[data-command]').forEach((element) => {
      element.textContent = `${safePrefix}${element.dataset.command}`;
    });
    $('command-prefix').textContent = safePrefix;
  }

  const normalize = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase();

  // Search and "See more" for a list that is re-rendered on every status refresh.
  // The controls sit outside the container, so the query and the number of
  // expanded rows survive each refresh.
  function createListView({ key, pageSize, noun, matches, renderItems, emptyHtml, onRender = () => {} }) {
    const container = $(`public-${key}`);
    const search = $(`${key}-search`);
    const searchWrap = search.closest('.list-search');
    const more = $(`${key}-more`);
    const moreButton = $(`${key}-more-button`);
    const shown = $(`${key}-shown`);
    let items = [];
    let limit = pageSize;
    let matchCount = 0;

    const render = () => {
      const rawQuery = search.value.trim();
      const query = normalize(rawQuery);
      const filtered = query ? items.filter((item) => matches(item, query)) : items;
      matchCount = filtered.length;
      onRender();
      searchWrap.hidden = items.length <= pageSize && !rawQuery;
      if (!items.length) container.innerHTML = emptyHtml;
      else if (!filtered.length) {
        container.innerHTML = `<div class="empty-state"><span>⌕</span><strong>No ${noun} match “${escapeHtml(rawQuery)}”</strong><p>Try another name.</p></div>`;
      } else container.innerHTML = renderItems(filtered.slice(0, limit));
      more.hidden = filtered.length <= pageSize;
      const visible = Math.min(limit, filtered.length);
      shown.textContent = `Showing ${formatCount(visible)} of ${formatCount(filtered.length)} ${noun}`;
      moreButton.textContent = visible < filtered.length ? 'See more' : 'Show less';
    };

    search.addEventListener('input', () => { limit = pageSize; render(); });
    moreButton.addEventListener('click', () => {
      if (limit < matchCount) limit += pageSize;
      else {
        limit = pageSize;
        container.closest('.section').scrollIntoView({ block: 'start' });
      }
      render();
    });
    return { update(next) { items = next || []; render(); } };
  }

  function renderTrackCards(tracks) {
    return tracks.map((track) => {
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
      const serverIcon = safeUrl(track.serverIcon);
      const serverBadge = track.serverName
        ? `<span class="track-server">
            ${serverIcon ? `<img class="track-server-icon" src="${escapeHtml(serverIcon)}" alt="" loading="lazy">` : '<i class="room-indicator"></i>'}
            <span>${escapeHtml(track.serverName)}</span>
          </span>`
        : '';
      const queueSuffix = track.queueCount > 0 ? ` · +${track.queueCount} in queue` : '';
      return `<article class="track-card">
        ${art}
        <div class="track-copy">
          <div class="track-header">
            <span>${track.paused ? 'PAUSED' : 'NOW PLAYING'}</span>
            ${serverBadge}
          </div>
          <h3 title="${escapeHtml(track.title)}">${title}</h3>
          <div class="progress"><i id="public-fill-${escapeHtml(track.id)}" style="width:${percentage}%"></i></div>
          <div class="progress-labels"><span id="public-elapsed-${escapeHtml(track.id)}">${escapeHtml(track.elapsedText || formatClock(elapsed))}</span><span>${escapeHtml(track.durationText || 'live')}${escapeHtml(queueSuffix)}</span></div>
        </div>
      </article>`;
    }).join('');
  }

  const tracksView = createListView({
    key: 'tracks',
    pageSize: 4,
    noun: 'live rooms',
    matches: (track, query) => normalize(track.title).includes(query) || normalize(track.serverName).includes(query),
    renderItems: renderTrackCards,
    emptyHtml: '<div class="empty-state"><span>♬</span><strong>The stage is quiet</strong><p>Active tracks will appear here automatically.</p></div>',
    // Progress ticks only for cards that are on screen.
    onRender: () => progressState.clear(),
  });

  async function refreshStatus() {
    try {
      const response = await fetch('/api/public/status', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      failures = 0;
      setConnectionState(data.status);
      setMaintenance(data.maintenance);
      setIdentity(data.bot);
      setCommandPrefix(data.prefix);
      $('metric-uptime').textContent = formatDuration(data.uptimeMs);
      $('metric-guilds').textContent = formatCount(data.guilds);
      $('metric-audience').textContent = `${formatCount(data.audience)} listeners in reach`;
      $('metric-streams').textContent = formatCount(data.activeStreams);
      $('metric-tracks').textContent = formatCount(data.totalSongsPlayed);
      $('metric-ping').textContent = data.ping >= 0 ? `${Math.round(data.ping)} ms` : '—';
      $('last-updated').textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      $('bug-open').hidden = !data.bugReports;
      tracksView.update(data.activeTracks);
      $('servers-count').textContent = `${formatCount(data.servers?.length || 0)} servers`;
      serversView.update(data.servers);
    } catch {
      failures += 1;
      if (failures >= 3) setConnectionState('offline');
      else setConnectionState('reconnecting');
    }
  }

  function renderServerCards(servers) {
    return servers.map((server) => {
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

  const serversView = createListView({
    key: 'servers',
    pageSize: 8,
    noun: 'servers',
    matches: (server, query) => normalize(server.name).includes(query),
    renderItems: renderServerCards,
    emptyHtml: '<div class="empty-state"><span>🏰</span><strong>No servers joined yet</strong><p>Invite the bot to your Discord server to see it featured here.</p></div>',
  });

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

  function setupBugReport() {
    const dialog = $('bug-dialog');
    const form = $('bug-form');
    const status = $('bug-status');
    const submit = $('bug-submit');
    const message = $('bug-message');
    const setStatus = (text, kind = '') => {
      status.textContent = text;
      status.className = `bug-status ${kind}`.trim();
    };
    const close = () => dialog.close();

    $('bug-open').addEventListener('click', () => {
      setStatus('');
      dialog.showModal();
      $('bug-email').focus();
    });
    $('bug-cancel').addEventListener('click', close);
    $('bug-dismiss').addEventListener('click', close);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    message.addEventListener('input', () => {
      $('bug-count').textContent = `${message.value.length} / 2000`;
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = $('bug-email').value.trim();
      const text = message.value.trim();
      if (!$('bug-email').checkValidity() || !email) return setStatus('Enter a valid email address so we can reply.', 'error');
      if (text.length < 10) return setStatus('Describe the bug in at least 10 characters.', 'error');

      submit.disabled = true;
      setStatus('Sending…');
      try {
        const response = await fetch('/api/public/bug-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, message: text, website: $('bug-website').value }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Could not send the report. Please try again later.');
        form.reset();
        $('bug-count').textContent = '0 / 2000';
        setStatus('Thanks! Your report was sent.', 'success');
        setTimeout(() => { if (dialog.open) close(); }, 1800);
      } catch (err) {
        setStatus(err.message, 'error');
      } finally {
        submit.disabled = false;
      }
    });
  }

  setupBugReport();
  refreshStatus();
  refreshHistory();
  setInterval(refreshStatus, 10_000);
  setInterval(refreshHistory, 30_000);
})();
