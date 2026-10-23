(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]);
  const STATUS_LABELS = { operational: 'Operational', degraded: 'Degraded', down: 'Outage', pending: 'Checking', starting: 'Starting' };
  const OVERALL_LABELS = {
    operational: 'All systems operational',
    degraded: 'Degraded performance',
    partial: 'Partial outage',
    major: 'Major outage',
    pending: 'Checking systems…',
    starting: 'Starting up after an update…',
  };
  const formatDateTime = (timestamp) => new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatSpan = (ms) => {
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
  };
  const barLevel = (day) => {
    if (day.uptime == null) return 'none';
    if (day.uptime >= 99.9) return 'l0';
    if (day.uptime >= 99) return 'l1';
    if (day.uptime >= 95) return 'l2';
    if (day.uptime >= 80) return 'l3';
    return 'l4';
  };

  function render(data) {
    const overall = data.overall || 'pending';
    $('status-overall').dataset.state = data.maintenance?.enabled ? 'maintenance' : overall;
    $('status-overall-text').textContent = data.maintenance?.enabled ? 'Under maintenance' : OVERALL_LABELS[overall];
    $('status-checked').textContent = data.checkedAt ? `Last checked ${new Date(data.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    $('status-maintenance').hidden = !data.maintenance?.enabled;
    $('status-maintenance-message').textContent = data.maintenance?.message || '';

    const components = data.components || [];
    $('status-components').innerHTML = components.length ? components.map((component) => {
      const bars = component.days.map((day) => {
        const label = day.uptime == null ? `${day.date}: no data` : `${day.date}: ${day.uptime}% uptime`;
        return `<i class="bar ${barLevel(day)}" title="${escapeHtml(label)}"></i>`;
      }).join('');
      return `<article class="health-row" data-status="${escapeHtml(component.status)}">
        <div class="health-row-head"><strong>${escapeHtml(component.name)}</strong><span class="health-status">${escapeHtml(STATUS_LABELS[component.status] || component.status)}</span></div>
        <div class="uptime-bars" role="img" aria-label="${escapeHtml(`${component.name}: ${component.uptime == null ? 'no data yet' : `${component.uptime}% uptime`}`)}">${bars}</div>
        <div class="uptime-foot"><span><span class="days-long">90 days ago</span><span class="days-short">30 days ago</span></span><span>${component.uptime == null ? 'No data yet' : `${escapeHtml(component.uptime)}% uptime`}</span><span>Today</span></div>
      </article>`;
    }).join('') : '<div class="empty-state"><span>◌</span><strong>No checks yet</strong><p>The first results appear a minute after the bot starts.</p></div>';

    const entries = [
      ...(data.incidents || []).map((incident) => ({
        at: incident.startedAt,
        html: `<div class="log-entry" data-status="${incident.resolvedAt ? 'resolved' : escapeHtml(incident.status)}">
          <div><strong>${escapeHtml(incident.name)}</strong> <span class="log-tag">${incident.resolvedAt ? 'Resolved' : escapeHtml(STATUS_LABELS[incident.status] || incident.status)}</span></div>
          <p>${incident.status === 'down' ? 'Outage' : 'Degraded performance'}${incident.resolvedAt ? `, resolved after ${escapeHtml(formatSpan(incident.resolvedAt - incident.startedAt))}` : ', under investigation'}.</p>
          <time>${escapeHtml(formatDateTime(incident.startedAt))}</time>
        </div>`,
      })),
      ...(data.maintenanceLog || []).map((event) => ({
        at: event.at,
        html: `<div class="log-entry" data-status="event"><div><strong>Maintenance</strong></div><p>${escapeHtml(event.message)}.</p><time>${escapeHtml(formatDateTime(event.at))}</time></div>`,
      })),
    ].sort((a, b) => b.at - a.at);
    $('status-incidents').innerHTML = entries.length ? entries.map((entry) => entry.html).join('') : '<p class="muted">No incidents recorded.</p>';
  }

  async function refresh() {
    try {
      const response = await fetch('/api/public/health', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch {
      $('status-overall').dataset.state = 'major';
      $('status-overall-text').textContent = 'Status unavailable right now';
      $('status-checked').textContent = 'The bot may be restarting. This page retries every minute.';
    }
  }

  refresh();
  setInterval(refresh, 60000);
})();
