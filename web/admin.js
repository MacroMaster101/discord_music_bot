(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { scope: 'global', guildId: '', tracks: new Map(), refreshTimer: null, healthTimer: null, maintenance: null };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const token = () => sessionStorage.getItem('musicAdminToken') || '';
  const setToken = (value) => sessionStorage.setItem('musicAdminToken', value);
  const clearToken = () => sessionStorage.removeItem('musicAdminToken');
  const formatDuration = (milliseconds) => {
    let seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const days = Math.floor(seconds / 86400); seconds %= 86400;
    const hours = Math.floor(seconds / 3600); seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds % 60}s`;
  };
  const timeAgo = (timestamp) => {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };

  // Two mounts serve the same console. Under /admin/, Cloudflare Access gates the path
  // and injects the Cf-Access-* identity headers, so calls must stay on /api/admin to
  // carry that identity. Under /console (reached with the admin token) the Access app
  // does not apply, so the ungated /console/api mirror is used with a bearer token.
  const onAccessMount = window.location.pathname.startsWith('/admin');
  const apiPath = (path) => (onAccessMount ? path : path.replace(/^\/api\/admin\//, '/console/api/'));

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(apiPath(path), { ...options, headers, cache: 'no-store' });
    let data = {};
    try { data = await response.json(); } catch { /* handled by status below */ }
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function toast(message, kind = '') {
    const element = $('toast');
    element.textContent = message;
    element.className = `toast show ${kind}`;
    clearTimeout(element.hideTimer);
    element.hideTimer = setTimeout(() => { element.className = 'toast'; }, 3200);
  }

  function setLocked(locked, message = '') {
    $('admin-content').classList.toggle('is-locked', locked);
    $('admin-content').setAttribute('aria-hidden', String(locked));
    $('unlock-card').hidden = !locked;
    const chip = $('admin-status');
    chip.className = `status-chip ${locked ? 'waiting' : 'online'}`;
    chip.querySelector('span').textContent = locked ? 'LOCKED' : 'AUTHORIZED';
    $('unlock-message').textContent = message;
    if (locked) {
      clearInterval(state.refreshTimer);
      clearInterval(state.healthTimer);
      state.refreshTimer = null;
      state.healthTimer = null;
    }
  }

  function startTimers() {
    clearInterval(state.refreshTimer);
    clearInterval(state.healthTimer);
    state.refreshTimer = setInterval(refreshAdmin, 6000);
    state.healthTimer = setInterval(loadHealth, 60000);
  }

  function renderTracks(tracks) {
    state.tracks.clear();
    const container = $('admin-tracks');
    if (!tracks?.length) {
      container.innerHTML = '<div class="empty-state"><span>♬</span><strong>No active rooms</strong><p>Start playback in Discord to manage it here.</p></div>';
      return;
    }
    container.innerHTML = tracks.map((track) => {
      state.tracks.set(track.guildId, track);
      const art = safeUrl(track.thumbnail)
        ? `<img class="track-art" src="${escapeHtml(safeUrl(track.thumbnail))}" alt="" referrerpolicy="no-referrer">`
        : '<div class="track-art track-fallback">♫</div>';
      const duration = Number(track.durationSeconds || 0);
      const elapsed = Number(track.elapsedSeconds || 0);
      const percent = duration ? Math.min(100, (elapsed / duration) * 100) : 100;
      const queue = (track.upcoming || []).map((song, index) => {
        const queueIndex = index + 1;
        return `<div class="queue-row"><span>${queueIndex}</span><span title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</span><div class="queue-actions">
          ${queueIndex > 1 ? `<button type="button" data-action="move" data-from="${queueIndex}" data-to="${queueIndex - 1}" title="Move up">↑</button>` : ''}
          ${index < track.upcoming.length - 1 ? `<button type="button" data-action="move" data-from="${queueIndex}" data-to="${queueIndex + 1}" title="Move down">↓</button>` : ''}
          <button type="button" data-action="remove" data-value="${queueIndex}" title="Remove">×</button>
        </div></div>`;
      }).join('');
      return `<article class="admin-track" data-guild="${escapeHtml(track.guildId)}">
        ${art}
        <div class="admin-track-main">
          <div class="admin-track-head"><div><h3 title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</h3><p>${escapeHtml(track.guildName)} · ${escapeHtml(track.voiceChannelName)}</p></div><span class="room-badge">${track.paused ? 'PAUSED' : 'PLAYING'} · ${escapeHtml(track.loop)}</span></div>
          <div class="admin-progress" data-action="seek"><div class="progress"><i style="width:${percent}%"></i></div><div class="progress-labels"><span>${escapeHtml(track.elapsedText)}</span><span>${escapeHtml(track.durationText)}</span></div></div>
          <div class="control-row">
            <button class="control" type="button" data-action="previous">← Previous</button><button class="control" type="button" data-action="restart">↺ Restart</button><button class="control" type="button" data-action="seekrel" data-value="-10">−10s</button><button class="control primary" type="button" data-action="pause">${track.paused ? '▶ Resume' : 'Ⅱ Pause'}</button><button class="control" type="button" data-action="seekrel" data-value="10">+10s</button><button class="control" type="button" data-action="skip">Skip →</button><button class="control" type="button" data-action="loop">Loop</button><button class="control" type="button" data-action="shuffle">Shuffle</button><button class="control danger" type="button" data-action="stop">Stop</button>
            <label class="volume-control">VOL <input type="range" min="0" max="200" value="${Number(track.volume || 0)}" data-action="volume"><span>${Number(track.volume || 0)}%</span></label>
          </div>
          ${queue ? `<div class="queue-admin">${queue}</div><button class="control danger" type="button" data-action="clear">Clear upcoming</button>` : ''}
          <form class="add-track-form"><input name="query" placeholder="Song search, YouTube or Spotify link" autocomplete="off" required><button class="control primary" type="submit">Add to queue</button></form>
        </div>
      </article>`;
    }).join('');
  }

  function renderCommandLog(entries) {
    const container = $('command-log');
    if (!entries?.length) {
      container.innerHTML = '<p class="muted">No commands recorded yet.</p>';
      return;
    }
    container.innerHTML = entries.map((entry) => `<div class="log-row"><code>!${escapeHtml(entry.command)}</code><span>${escapeHtml(entry.userName)} · ${escapeHtml(entry.guildName)}</span><time>${timeAgo(entry.timestamp)} ago</time></div>`).join('');
  }

  function setMaintenanceState(message, error = false) {
    const element = $('maintenance-state');
    element.textContent = message;
    element.className = `saved-state ${error ? 'error' : 'ok'}`;
  }

  // The button names what Apply will do; "Stop music" only matters when turning it on.
  function updateMaintenanceFields() {
    const wanted = $('maintenance-enabled').checked;
    $('maintenance-stop-row').hidden = !(wanted && !state.maintenance);
    $('maintenance-save').textContent = wanted === state.maintenance
      ? 'Save notice'
      : (wanted ? 'Turn on maintenance' : 'Turn off maintenance');
  }

  function renderMaintenance(maintenance) {
    state.maintenance = Boolean(maintenance?.enabled);
    $('maintenance-card').classList.toggle('is-active', state.maintenance);
    $('maintenance-pill').textContent = state.maintenance ? 'On' : 'Off';
    $('maintenance-enabled').checked = state.maintenance;
    $('maintenance-message').value = maintenance?.message || '';
    updateMaintenanceFields();
  }

  async function loadMaintenance() {
    try {
      renderMaintenance(await api('/api/admin/maintenance'));
      setMaintenanceState(state.maintenance ? 'Maintenance on' : 'Ready');
    } catch (error) { setMaintenanceState(error.message, true); }
  }

  const HEALTH_LABELS = {
    operational: 'Operational', degraded: 'Degraded', down: 'Down', unconfigured: 'Not configured', pending: 'Checking', starting: 'Starting',
  };
  const OVERALL_LABELS = {
    operational: 'All systems operational',
    degraded: 'Degraded performance',
    partial: 'Partial outage',
    major: 'Major outage: the bot is offline',
    pending: 'Checking systems…',
    starting: 'Starting up after a restart…',
  };
  const formatDateTime = (timestamp) => new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatSpan = (ms) => {
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
  };
  // Same scale as public status pages: green at 99.9 % and above, red for a bad day.
  const barLevel = (day) => {
    if (day.uptime == null) return 'none';
    if (day.uptime >= 99.9) return 'l0';
    if (day.uptime >= 99) return 'l1';
    if (day.uptime >= 95) return 'l2';
    if (day.uptime >= 80) return 'l3';
    return 'l4';
  };

  function renderHealth(data) {
    const overall = data.overall || 'pending';
    $('health-overall').dataset.state = overall;
    $('health-overall-text').textContent = data.maintenance?.enabled ? `${OVERALL_LABELS[overall]} · maintenance mode on` : OVERALL_LABELS[overall];
    const broken = (data.components || []).filter((c) => c.status === 'down' || c.status === 'degraded');
    $('health-overall-note').textContent = broken.length ? broken.map((c) => `${c.name}: ${HEALTH_LABELS[c.status].toLowerCase()}`).join(' · ') : '';
    $('health-checked').textContent = data.checkedAt ? `Checked ${new Date(data.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Not checked yet';

    $('health-components').innerHTML = (data.components || []).map((component) => {
      const bars = component.days.map((day) => {
        const label = day.uptime == null ? `${day.date}: no data` : `${day.date}: ${day.uptime}% uptime${day.status !== 'operational' ? ` (${day.status})` : ''}`;
        return `<i class="bar ${barLevel(day)}" title="${escapeHtml(label)}"></i>`;
      }).join('');
      const uptime = component.uptime == null ? 'No data yet' : `${component.uptime}% uptime`;
      return `<article class="health-row" data-status="${escapeHtml(component.status)}">
        <div class="health-row-head"><div><strong>${escapeHtml(component.name)}</strong><small>${escapeHtml(component.group)}</small></div><span class="health-status">${escapeHtml(HEALTH_LABELS[component.status] || component.status)}</span></div>
        <p class="health-detail">${escapeHtml(component.detail)}</p>
        <div class="uptime-bars" aria-hidden="true">${bars}</div>
        <div class="uptime-foot"><span><span class="days-long">90 days ago</span><span class="days-short">30 days ago</span></span><span>${escapeHtml(uptime)}</span><span>Today</span></div>
      </article>`;
    }).join('');

    const incidents = data.incidents || [];
    $('health-incidents').innerHTML = incidents.length ? incidents.map((incident) => {
      const end = incident.resolvedAt ? `resolved after ${formatSpan(incident.resolvedAt - incident.startedAt)}` : `ongoing for ${formatSpan(Date.now() - incident.startedAt)}`;
      return `<div class="log-entry" data-status="${incident.resolvedAt ? 'resolved' : escapeHtml(incident.status)}">
        <div><strong>${escapeHtml(incident.name)}</strong> <span class="log-tag">${escapeHtml(incident.resolvedAt ? 'Resolved' : HEALTH_LABELS[incident.status] || incident.status)}</span></div>
        <p>${escapeHtml(incident.detail || 'No details')}</p>
        <time>${escapeHtml(formatDateTime(incident.startedAt))} · ${escapeHtml(end)}</time>
      </div>`;
    }).join('') : '<p class="muted">No incidents recorded. Every check has passed.</p>';

    const events = data.events || [];
    $('health-events').innerHTML = events.length ? events.map((event) => `<div class="log-entry" data-status="event">
        <div><span class="log-tag">${escapeHtml(event.kind)}</span></div>
        <p>${escapeHtml(event.message)}</p>
        <time>${escapeHtml(formatDateTime(event.at))}</time>
      </div>`).join('') : '<p class="muted">No events recorded.</p>';

    $('health-env').innerHTML = (data.env || []).map((entry) => {
      const state = entry.set ? (entry.warning ? 'warn' : 'ok') : (entry.level === 'optional' ? 'off' : 'missing');
      const label = entry.set ? (entry.warning || (entry.via ? `Set (as ${entry.via})` : 'Set')) : 'Not set';
      return `<div class="env-row" data-state="${state}"><code>${escapeHtml(entry.key)}</code><span>${escapeHtml(entry.purpose)} · ${escapeHtml(entry.level)}</span><strong>${escapeHtml(label)}</strong></div>`;
    }).join('');
  }

  async function loadHealth() {
    try { renderHealth(await api('/api/admin/health')); } catch (error) { $('health-overall-text').textContent = error.message; }
  }

  async function refreshAdmin() {
    try {
      const data = await api('/api/admin/stats');
      $('a-status').textContent = data.maintenance?.enabled ? 'Maintenance' : data.status === 'online' ? 'Online' : 'Connecting';
      // Pick up a change made from another console without overwriting a notice being typed.
      if (state.maintenance !== null && Boolean(data.maintenance?.enabled) !== state.maintenance) loadMaintenance();
      $('a-guilds').textContent = Number(data.guilds || 0).toLocaleString();
      $('a-audience').textContent = `${Number(data.audience || 0).toLocaleString()} audience`;
      $('a-streams').textContent = Number(data.activeStreams || 0).toLocaleString();
      $('a-memory').textContent = `${data.system?.memoryUsedRss || 0} MB`;
      $('a-ping').textContent = data.ping >= 0 ? `${Math.round(data.ping)} ms` : '—';
      $('sys-os').textContent = data.system?.os || '—';
      $('sys-node').textContent = data.system?.nodeVersion || '—';
      $('sys-cpu').textContent = data.system?.cpus || '—';
      $('sys-uptime').textContent = formatDuration(data.uptimeMs);
      $('access-email').textContent = data.accessEmail || 'Identity header unavailable';
      renderTracks(data.activeTracks);
      renderCommandLog(data.commandLog);
    } catch (error) {
      if (error.status === 401) {
        clearToken();
        setLocked(true, 'Cloudflare Access session or admin token was rejected.');
      } else {
        toast(error.message, 'error');
      }
    }
  }

  async function loadGuilds() {
    const { guilds = [] } = await api('/api/admin/guilds');
    $('guild-select').innerHTML = '<option value="">Choose a server</option>' + guilds.map((guild) => `<option value="${escapeHtml(guild.id)}">${escapeHtml(guild.name)} (${Number(guild.memberCount || 0).toLocaleString()})</option>`).join('');
  }

  function populateSettings(data) {
    const values = data.effective || data.global || data.defaults || {};
    $('setting-prefix').value = values.prefix ?? '!';
    $('setting-volume').value = values.defaultVolume ?? 100;
    $('volume-output').textContent = `${$('setting-volume').value}%`;
    $('setting-idle').value = values.idleDisconnectSeconds ?? 10;
    $('setting-empty').value = values.emptyVcDisconnectSeconds ?? 60;
    $('setting-autopause').checked = Boolean(values.autoPauseWhenAlone);
    const overridden = data.guild || {};
    $('effective-prefix').textContent = state.scope === 'guild' ? (overridden.prefix == null ? 'Inherited from global settings' : 'Server override') : 'Used by every server without an override';
    $('effective-volume').textContent = state.scope === 'guild' ? (overridden.defaultVolume == null ? 'Inherited from global settings' : 'Server override') : 'Initial playback volume';
  }

  async function loadSettings() {
    if (state.scope === 'guild' && !state.guildId) return;
    const query = state.scope === 'guild' ? `?guildId=${encodeURIComponent(state.guildId)}` : '';
    try {
      populateSettings(await api(`/api/admin/settings${query}`));
      setSettingsState('Loaded');
    } catch (error) { setSettingsState(error.message, true); }
  }

  function setPresenceState(message, error = false) {
    const element = $('presence-state');
    element.textContent = message;
    element.className = `saved-state ${error ? 'error' : 'ok'}`;
  }

  function updatePresenceFields() {
    const custom = $('presence-mode').value === 'custom';
    ['presence-status', 'presence-type', 'presence-text'].forEach((id) => { $(id).disabled = !custom; });
  }

  async function loadPresence() {
    try {
      const data = await api('/api/admin/presence');
      $('presence-mode').value = data.mode || 'automatic';
      $('presence-status').value = data.status || 'online';
      $('presence-type').value = data.activityType || 'competing';
      $('presence-text').value = data.activityText || 'The Ultimate DJ Battle';
      updatePresenceFields();
      setPresenceState(data.mode === 'custom' ? 'Custom active' : 'Automatic');
    } catch (error) { setPresenceState(error.message, true); }
  }

  function setSettingsState(message, error = false) {
    const element = $('settings-state');
    element.textContent = message;
    element.className = `saved-state ${error ? 'error' : 'ok'}`;
  }

  async function control(guildId, action, value = null) {
    try {
      const result = await api('/api/admin/control', { method: 'POST', body: JSON.stringify({ guildId, action, value }) });
      toast(result.title ? `${action}: ${result.title}` : `${action} completed`);
      setTimeout(refreshAdmin, 350);
      return result;
    } catch (error) { toast(error.message, 'error'); return null; }
  }

  $('unlock-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = $('admin-token').value.trim();
    if (!value) return;
    setToken(value);
    $('unlock-message').textContent = 'Verifying…';
    try {
      await Promise.all([refreshAdmin(), loadGuilds()]);
      if (!token()) return;
      setLocked(false);
      await Promise.all([loadSettings(), loadPresence(), loadMaintenance(), loadHealth()]);
      startTimers();
    } catch (error) {
      clearToken();
      setLocked(true, error.message);
    }
  });

  $('lock-admin').addEventListener('click', () => {
    clearToken();
    $('admin-token').value = '';
    setLocked(true, 'Console locked.');
  });

  // A bare /cdn-cgi/access/logout ends the session but leaves the browser on
  // Cloudflare's own "logged out" page. returnTo sends it back here instead, and
  // is built from the current origin so it follows whichever host served the page.
  document.querySelectorAll('a[href="/cdn-cgi/access/logout"]').forEach((link) => {
    link.href = `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(`${window.location.origin}/`)}`;
  });
  $('refresh-admin').addEventListener('click', refreshAdmin);
  $('setting-volume').addEventListener('input', () => { $('volume-output').textContent = `${$('setting-volume').value}%`; });
  $('presence-mode').addEventListener('change', updatePresenceFields);
  $('maintenance-enabled').addEventListener('change', updateMaintenanceFields);
  $('health-run').addEventListener('click', async () => {
    const button = $('health-run');
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      renderHealth(await api('/api/admin/health/check', { method: 'POST' }));
      toast('Health checks finished');
    } catch (error) { toast(error.message, 'error'); }
    button.disabled = false;
    button.textContent = 'Run checks now';
  });
  $('maintenance-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const enabled = $('maintenance-enabled').checked;
    const stopPlayback = enabled && !state.maintenance && $('maintenance-stop').checked;
    if (stopPlayback && state.tracks.size
      && !window.confirm(`Stop music in ${state.tracks.size} active room(s) and turn on maintenance?`)) return;
    setMaintenanceState('Applying…');
    try {
      const result = await api('/api/admin/maintenance', {
        method: 'PUT',
        body: JSON.stringify({ enabled, message: $('maintenance-message').value.trim(), stopPlayback }),
      });
      renderMaintenance(result);
      setMaintenanceState(result.enabled ? 'Maintenance on' : 'Maintenance off');
      toast(result.enabled
        ? `Maintenance on${result.stopped ? ` · stopped ${result.stopped} room(s)` : ''}`
        : 'Maintenance off: commands work again');
      refreshAdmin();
    } catch (error) { setMaintenanceState(error.message, true); }
  });
  $('presence-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    setPresenceState('Applying…');
    try {
      const result = await api('/api/admin/presence', {
        method: 'PUT',
        body: JSON.stringify({
          mode: $('presence-mode').value,
          status: $('presence-status').value,
          activityType: $('presence-type').value,
          activityText: $('presence-text').value.trim(),
        }),
      });
      setPresenceState(result.mode === 'custom' ? 'Custom active' : 'Automatic');
      toast(result.mode === 'custom' ? 'Discord presence updated' : 'Automatic presence restored');
      await loadPresence();
    } catch (error) { setPresenceState(error.message, true); }
  });

  document.querySelectorAll('.scope-button').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.scope-button').forEach((item) => item.classList.toggle('active', item === button));
    state.scope = button.dataset.scope;
    $('guild-field').hidden = state.scope !== 'guild';
    if (state.scope === 'global') loadSettings();
    else if (state.guildId) loadSettings();
    else setSettingsState('Choose a server');
  }));

  $('guild-select').addEventListener('change', () => {
    state.guildId = $('guild-select').value;
    if (state.guildId) loadSettings();
    else setSettingsState('Choose a server');
  });

  $('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.scope === 'guild' && !state.guildId) return setSettingsState('Choose a server first', true);
    const payload = {
      prefix: $('setting-prefix').value.trim(),
      defaultVolume: Number($('setting-volume').value),
      idleDisconnectSeconds: Number($('setting-idle').value),
      emptyVcDisconnectSeconds: Number($('setting-empty').value),
      autoPauseWhenAlone: $('setting-autopause').checked,
    };
    const query = state.scope === 'guild' ? `?guildId=${encodeURIComponent(state.guildId)}` : '';
    try {
      await api(`/api/admin/settings${query}`, { method: 'PUT', body: JSON.stringify(payload) });
      setSettingsState(state.scope === 'guild' ? 'Override saved' : 'Global settings saved');
      toast('Settings saved');
      await loadSettings();
    } catch (error) { setSettingsState(error.message, true); }
  });

  $('reset-settings').addEventListener('click', async () => {
    if (state.scope === 'guild' && !state.guildId) return setSettingsState('Choose a server first', true);
    const label = state.scope === 'guild' ? 'delete this server override' : 'reset every global setting to its default';
    if (!window.confirm(`Are you sure you want to ${label}?`)) return;
    const query = state.scope === 'guild' ? `?guildId=${encodeURIComponent(state.guildId)}` : '';
    try {
      await api(`/api/admin/settings${query}`, { method: 'DELETE' });
      setSettingsState(state.scope === 'guild' ? 'Override deleted' : 'Defaults restored');
      toast(state.scope === 'guild' ? 'Server override deleted' : 'Global defaults restored');
      await loadSettings();
    } catch (error) { setSettingsState(error.message, true); }
  });

  $('admin-tracks').addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || target.matches('input')) return;
    const card = target.closest('.admin-track');
    const guildId = card?.dataset.guild;
    const action = target.dataset.action;
    if (!guildId || !action) return;
    if (action === 'seek') {
      const track = state.tracks.get(guildId);
      if (!track?.durationSeconds) return;
      const rect = target.getBoundingClientRect();
      const seconds = Math.floor(((event.clientX - rect.left) / rect.width) * track.durationSeconds);
      try { await api('/api/admin/seek', { method: 'POST', body: JSON.stringify({ guildId, seconds }) }); toast(`Seeked to ${seconds}s`); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'seekrel') {
      const track = state.tracks.get(guildId);
      const seconds = Math.max(0, Number(track?.elapsedSeconds || 0) + Number(target.dataset.value || 0));
      try { await api('/api/admin/seek', { method: 'POST', body: JSON.stringify({ guildId, seconds }) }); toast(`Seeked to ${seconds}s`); } catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (action === 'move') return control(guildId, 'move', { from: Number(target.dataset.from), to: Number(target.dataset.to) });
    if (action === 'remove') return control(guildId, 'remove', Number(target.dataset.value));
    return control(guildId, action);
  });

  $('admin-tracks').addEventListener('input', (event) => {
    const input = event.target.closest('input[data-action="volume"]');
    if (!input) return;
    input.nextElementSibling.textContent = `${input.value}%`;
    clearTimeout(input.changeTimer);
    const card = input.closest('.admin-track');
    input.changeTimer = setTimeout(() => control(card.dataset.guild, 'volume', Number(input.value)), 300);
  });

  $('admin-tracks').addEventListener('submit', async (event) => {
    const form = event.target.closest('.add-track-form');
    if (!form) return;
    event.preventDefault();
    const guildId = form.closest('.admin-track').dataset.guild;
    const query = new FormData(form).get('query')?.trim();
    if (!query) return;
    const result = await control(guildId, 'add', query);
    if (result?.ok) form.reset();
  });

  if (token()) $('admin-token').value = token();
  Promise.all([refreshAdmin(), loadGuilds()]).then(async () => {
    setLocked(false);
    await Promise.all([loadSettings(), loadPresence(), loadMaintenance(), loadHealth()]);
    startTimers();
  }).catch(() => setLocked(true, 'Choose Cloudflare Access or enter the admin token to continue.'));
})();
