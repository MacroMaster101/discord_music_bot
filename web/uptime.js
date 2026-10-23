// Uptime bars shared by the status page and the admin console: today by the
// hour in the viewer's own time zone, or the last 7, 30, or 90 days.
(() => {
  'use strict';

  const RANGES = ['today', '7', '30', '90'];
  const HOUR = 60 * 60 * 1000;

  const average = (values) => (values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
    : null);
  // Same scale as public status pages: green at 99.9 % and above, red for a bad period.
  const level = (uptime) => {
    if (uptime == null) return 'none';
    if (uptime >= 99.9) return 'l0';
    if (uptime >= 99) return 'l1';
    if (uptime >= 95) return 'l2';
    if (uptime >= 80) return 'l3';
    return 'l4';
  };
  const hourLabel = (timestamp) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric' });
  // Daily buckets are UTC dates.
  const dayLabel = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const describe = (uptime) => (uptime == null ? 'no data' : `${uptime}% uptime`);

  // 24 bars from local midnight, built from the server's quarter-hour slots.
  function today(component, data, now = Date.now()) {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const slotMs = (data.slotMinutes || 15) * 60 * 1000;
    const seen = [];
    const bars = Array.from({ length: 24 }, (_, hour) => {
      const start = midnight.getTime() + hour * HOUR;
      if (start > now) return { level: 'future', label: `${hourLabel(start)}: later today` };
      const values = [];
      for (let at = start; at < start + HOUR; at += slotMs) {
        const value = component.slots?.[Math.round((at - data.slotsStart) / slotMs)];
        if (value != null) values.push(value);
      }
      seen.push(...values);
      const uptime = average(values);
      return { level: level(uptime), label: `${hourLabel(start)} – ${hourLabel(start + HOUR)}: ${describe(uptime)}` };
    });
    const uptime = average(seen);
    return {
      bars,
      from: hourLabel(midnight.getTime()),
      to: hourLabel(midnight.getTime() + 23 * HOUR),
      summary: uptime == null ? 'No data yet today' : `${uptime}% uptime today`,
    };
  }

  function lastDays(component, count) {
    const uptime = component.uptimes?.[count] ?? (count === 90 ? component.uptime : null);
    return {
      bars: (component.days || []).slice(-count).map((day) => ({ level: level(day.uptime), label: `${dayLabel(day.date)}: ${describe(day.uptime)}` })),
      from: `${count} days ago`,
      to: 'Today',
      summary: uptime == null ? 'No data yet' : `${uptime}% uptime`,
    };
  }

  // Returns the bars and the caption row as HTML. escapeHtml comes from the page.
  function render(component, data, range, escapeHtml) {
    const view = range === 'today' ? today(component, data) : lastDays(component, Number(range));
    const bars = view.bars.map((bar) => `<i class="bar ${bar.level}" title="${escapeHtml(bar.label)}"></i>`).join('');
    return `<div class="uptime-bars" data-range="${escapeHtml(range)}" role="img" aria-label="${escapeHtml(`${component.name}: ${view.summary}`)}">${bars}</div>
      <div class="uptime-foot"><span>${escapeHtml(view.from)}</span><span>${escapeHtml(view.summary)}</span><span>${escapeHtml(view.to)}</span></div>`;
  }

  // Wires a tab list of buttons with data-range; remembers the choice per page.
  function bindTabs(tablist, storageKey, onChange) {
    let range = 'today';
    try {
      const saved = localStorage.getItem(storageKey);
      if (RANGES.includes(saved)) range = saved;
    } catch {}
    const select = (next) => {
      range = next;
      for (const tab of tablist.querySelectorAll('[data-range]')) {
        tab.setAttribute('aria-pressed', String(tab.dataset.range === range));
      }
    };
    select(range);
    tablist.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-range]');
      if (!tab || !RANGES.includes(tab.dataset.range)) return;
      select(tab.dataset.range);
      try { localStorage.setItem(storageKey, range); } catch {}
      onChange(range);
    });
    return () => range;
  }

  window.UptimeBars = { bindTabs, render };
})();
