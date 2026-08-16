(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { scope: 'global', guildId: '', tracks: new Map(), refreshTimer: null };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const token = () => sessionStorage.getItem('j4fnAdminToken') || '';
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

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers, cache: 'no-store' });
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
    if (locked && state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
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
            <button class="control" type="button" data-action="restart">↺ Restart</button><button class="control" type="button" data-action="seekrel" data-value="-10">−10s</button><button class="control primary" type="button" data-action="pause">${track.paused ? '▶ Resume' : 'Ⅱ Pause'}</button><button class="control" type="button" data-action="seekrel" data-value="10">+10s</button><button class="control" type="button" data-action="skip">Skip →</button><button class="control" type="button" data-action="loop">Loop</button><button class="control" type="button" data-action="shuffle">Shuffle</button><button class="control danger" type="button" data-action="stop">Stop</button>
            <label class="volume-control">VOL <input type="range" min="0" max="200" value="${Number(track.volume || 0)}" data-action="volume"><span>${Number(track.volume || 0)}%</span></label>
          </div>
          ${queue ? `<div class="queue-admin">${queue}</div><button class="control danger" type="button" data-action="clear">Clear upcoming</button>` : ''}
          <form class="add-track-form"><input name="query" placeholder="YouTube URL or song search" autocomplete="off" required><button class="control primary" type="submit">Add to queue</button></form>
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

  async function refreshAdmin() {
    try {
      const data = await api('/api/admin/stats');
      $('a-status').textContent = data.status === 'online' ? 'Online' : 'Connecting';
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
        sessionStorage.removeItem('j4fnAdminToken');
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
    sessionStorage.setItem('j4fnAdminToken', value);
    $('unlock-message').textContent = 'Verifying…';
    try {
      await Promise.all([refreshAdmin(), loadGuilds()]);
      if (!token()) return;
      setLocked(false);
      await loadSettings();
      state.refreshTimer = setInterval(refreshAdmin, 6000);
    } catch (error) {
      sessionStorage.removeItem('j4fnAdminToken');
      setLocked(true, error.message);
    }
  });

  $('lock-admin').addEventListener('click', () => {
    sessionStorage.removeItem('j4fnAdminToken');
    $('admin-token').value = '';
    setLocked(true, 'Console locked.');
  });
  $('refresh-admin').addEventListener('click', refreshAdmin);
  $('setting-volume').addEventListener('input', () => { $('volume-output').textContent = `${$('setting-volume').value}%`; });

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
    await loadSettings();
    state.refreshTimer = setInterval(refreshAdmin, 6000);
  }).catch(() => setLocked(true, 'Sign in with Cloudflare Access or use the emergency admin token.'));
})();
