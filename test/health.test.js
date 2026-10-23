const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { createDefaultChecks, createHealthMonitor, envReport, publicHealth } = require('../health');

const quietLogger = { log() {}, warn() {} };
const DAY = 24 * 60 * 60 * 1000;

function fakeCheck(id, results) {
  let call = 0;
  return { id, name: id.toUpperCase(), group: 'Test', run: async () => results[Math.min(call++, results.length - 1)] };
}

test('an outage opens one incident, escalates, and records how long it lasted', async () => {
  let clock = Date.UTC(2026, 9, 23, 10);
  const monitor = createHealthMonitor({
    now: () => clock,
    startupGraceMs: 0,
    logger: quietLogger,
    checks: [fakeCheck('tunnel', [
      { status: 'operational' },
      { status: 'degraded', detail: 'slow' },
      { status: 'down', detail: 'cloudflared is not connected' },
      { status: 'operational' },
    ])],
  });

  for (let i = 0; i < 4; i += 1) {
    await monitor.runChecks();
    clock += 60_000;
  }
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.incidents.length, 1);
  const [incident] = snapshot.incidents;
  assert.equal(incident.status, 'down');
  assert.equal(incident.detail, 'cloudflared is not connected');
  assert.equal(incident.resolvedAt - incident.startedAt, 120_000);

  const today = snapshot.components[0].days.at(-1);
  assert.equal(today.status, 'down');
  assert.equal(today.uptime, 62.5); // 4 checks: 2 ok, 1 degraded (half), 1 down
  assert.equal(snapshot.components[0].days.length, 90);
  assert.equal(snapshot.overall, 'operational');
});

test('a check that throws or hangs counts as down instead of breaking the monitor', async () => {
  const monitor = createHealthMonitor({
    startupGraceMs: 0,
    logger: quietLogger,
    checks: [
      { id: 'discord', name: 'Discord', group: 'Bot', run: async () => { throw new Error('gateway closed\nstack'); } },
      { id: 'host', name: 'Host', group: 'Hosting', run: async () => ({ status: 'operational' }) },
    ],
  });
  await monitor.runChecks();
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.components[0].status, 'down');
  assert.equal(snapshot.components[0].detail, 'gateway closed');
  assert.equal(snapshot.overall, 'major');
});

test('history persists across restarts and old days are dropped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-'));
  const file = path.join(dir, 'health.json');
  let clock = Date.UTC(2026, 0, 1, 12);
  const checks = [fakeCheck('discord', [{ status: 'operational' }])];
  const first = createHealthMonitor({ file, now: () => clock, logger: quietLogger, checks });
  await first.runChecks();
  first.recordEvent('maintenance', 'Maintenance mode turned on, stopped 2 room(s)');
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.ok(fs.existsSync(file));

  clock += 2 * DAY;
  const second = createHealthMonitor({ file, now: () => clock, logger: quietLogger, checks });
  const days = second.snapshot().components[0].days;
  assert.equal(days.at(-3).uptime, 100);
  assert.equal(days.at(-1).uptime, null);
  assert.equal(second.snapshot().events[0].kind, 'maintenance');

  clock += 100 * DAY;
  await second.runChecks();
  const later = second.snapshot().components[0];
  assert.equal(later.days.filter((day) => day.uptime != null).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('environment report shows only whether keys are set, never their values', () => {
  const env = { TOKEN: 'secret-discord-token', ADMIN_TOKEN: 'short', DISCORD_TOKEN: '', YTDLP_COOKIES_BASE64: 'Y29va2ll' };
  const report = envReport(env);
  const json = JSON.stringify(report);
  assert.doesNotMatch(json, /secret-discord-token|short"|Y29va2ll/);
  assert.equal(report.find((e) => e.key === 'TOKEN').set, true);
  assert.equal(report.find((e) => e.key === 'ADMIN_TOKEN').warning, 'Shorter than 24 characters');
  assert.equal(report.find((e) => e.key === 'YTDLP_COOKIES_PATH').via, 'YTDLP_COOKIES_BASE64');
  assert.equal(report.find((e) => e.key === 'CF_ACCESS_AUD').set, false);
});

test('the config check reports missing required settings by name', async () => {
  const checks = createDefaultChecks({ client: null, env: {} });
  const config = checks.find((check) => check.id === 'config');
  const result = await config.run();
  assert.equal(result.status, 'down');
  assert.match(result.detail, /TOKEN/);
});

test('the playback check degrades on host failures and recovers after a good start', async () => {
  const clock = Date.UTC(2026, 9, 23, 10);
  const health = { lastSuccessAt: clock - 60_000, lastFailureAt: clock - 1000, lastFailureReason: 'YouTube refused', failures: [clock - 1000] };
  const playback = createDefaultChecks({ client: null, getPlaybackHealth: () => health, now: () => clock })
    .find((check) => check.id === 'playback');
  assert.equal((await playback.run()).status, 'degraded');
  health.failures = [clock - 3000, clock - 2000, clock - 1000];
  assert.equal((await playback.run()).status, 'down');
  health.lastSuccessAt = clock;
  assert.equal((await playback.run()).status, 'operational');
});

test('the tunnel check uses cloudflared readiness and is skipped without a token', async () => {
  const make = (env, fetchImpl) => createDefaultChecks({ client: null, env, tunnelReadyUrl: 'http://cloudflared:20241/ready', fetchImpl })
    .find((check) => check.id === 'tunnel');
  assert.equal((await make({}, null).run()).status, 'unconfigured');
  const ready = await make({ TUNNEL_TOKEN: 'x' }, async () => ({ ok: true, json: async () => ({ readyConnections: 4 }) })).run();
  assert.equal(ready.status, 'operational');
  assert.match(ready.detail, /4 edge connections/);
  const broken = await make({ TUNNEL_TOKEN: 'x' }, async () => ({ ok: false, status: 503, json: async () => ({}) })).run();
  assert.equal(broken.status, 'down');
});

test('the public view hides internal components, details, and error text', () => {
  const snapshot = {
    checkedAt: 1,
    historyDays: 90,
    components: [
      { id: 'discord', name: 'Discord gateway', status: 'operational', detail: '44 ms', uptime: 100, days: [{ date: '2026-10-23', status: 'operational', uptime: 100 }] },
      { id: 'host', name: 'Server (EC2)', status: 'degraded', detail: 'disk low', uptime: 90, days: [] },
      { id: 'spotify', name: 'Spotify API', status: 'unconfigured', detail: '', uptime: null, days: [] },
      { id: 'playback', name: 'YouTube playback', status: 'down', detail: '403 from rr1.googlevideo.com', uptime: 80, days: [] },
    ],
    incidents: [
      { component: 'host', name: 'Server (EC2)', status: 'degraded', startedAt: 5, resolvedAt: null, detail: 'disk low' },
      { component: 'playback', name: 'YouTube playback', status: 'down', startedAt: 4, resolvedAt: 9, detail: '403 secret detail' },
    ],
    events: [{ at: 3, kind: 'maintenance', message: 'Maintenance mode turned on, stopped 2 room(s)' }, { at: 2, kind: 'restart', message: 'Bot started' }],
  };
  const view = publicHealth(snapshot, { enabled: true, message: 'Back soon' });
  assert.deepEqual(view.components.map((c) => c.name), ['Discord bot', 'Music playback']);
  assert.equal(view.overall, 'partial');
  assert.deepEqual(view.incidents, [{ name: 'Music playback', status: 'down', startedAt: 4, resolvedAt: 9 }]);
  assert.deepEqual(view.maintenanceLog, [{ at: 3, message: 'Maintenance mode turned on' }]);
  assert.doesNotMatch(JSON.stringify(view), /disk low|googlevideo|secret|EC2|restart/);
});

test('quarter-hour slots back the today view, and 7/30/90-day uptime is weighted by checks', async () => {
  let clock = Date.UTC(2026, 9, 23, 10, 0);
  const results = [];
  const monitor = createHealthMonitor({
    now: () => clock,
    startupGraceMs: 0,
    logger: quietLogger,
    checks: [{ id: 'tunnel', name: 'TUNNEL', group: 'Test', run: async () => results.shift() || { status: 'operational' } }],
  });
  // 10:00 and 10:05 operational, 10:20 down, 10:25 operational.
  results.push({ status: 'operational' }, { status: 'operational' }, { status: 'down', detail: 'x' }, { status: 'operational' });
  for (const minutes of [0, 5, 20, 25]) {
    clock = Date.UTC(2026, 9, 23, 10, minutes);
    await monitor.runChecks();
  }
  const snapshot = monitor.snapshot();
  const [component] = snapshot.components;
  assert.equal(snapshot.slotMinutes, 15);
  assert.equal(component.slots.length, 192);
  assert.equal(snapshot.slotsStart + 191 * 15 * 60_000, Date.UTC(2026, 9, 23, 10, 15), 'the last slot is the current quarter hour');
  assert.deepEqual(component.slots.slice(-2), [100, 50]);
  assert.ok(component.slots.slice(0, -2).every((value) => value === null));
  assert.deepEqual(component.uptimes, { 7: 75, 30: 75, 90: 75 });
  assert.equal(component.uptime, 75);
  const view = publicHealth(snapshot);
  assert.equal(view.slotsStart, snapshot.slotsStart);
  assert.deepEqual(view.components[0].slots, component.slots);
  assert.deepEqual(view.components[0].uptimes, component.uptimes);

  // Two days later the quarter-hour history has rolled off; daily history remains.
  clock += 2 * DAY;
  const later = monitor.snapshot().components[0];
  assert.ok(later.slots.every((value) => value === null));
  assert.equal(later.uptimes[7], 75);
});

test('failures while the stack is still starting show as starting and are not logged', async () => {
  let clock = Date.UTC(2026, 9, 23, 11, 20);
  const monitor = createHealthMonitor({
    now: () => clock,
    logger: quietLogger,
    checks: [fakeCheck('tunnel', [{ status: 'degraded', detail: 'cloudflared metrics unreachable' }, { status: 'operational' }, { status: 'down', detail: 'gone' }])],
  });
  await monitor.runChecks();
  let snapshot = monitor.snapshot();
  assert.equal(snapshot.components[0].status, 'starting');
  assert.equal(snapshot.components[0].detail, 'Starting up · cloudflared metrics unreachable');
  assert.equal(snapshot.overall, 'starting');
  assert.equal(snapshot.incidents.length, 0);
  assert.equal(snapshot.components[0].uptime, null);
  const view = publicHealth({ ...snapshot, events: [] });
  assert.equal(view.overall, 'starting');
  assert.equal(view.components[0].status, 'starting');

  clock += 60_000;
  await monitor.runChecks();
  clock += 2 * 60_000;
  await monitor.runChecks();
  snapshot = monitor.snapshot();
  assert.equal(snapshot.incidents.length, 1);
  assert.equal(snapshot.incidents[0].detail, 'gone');
  assert.equal(snapshot.components[0].status, 'down');
  assert.equal(snapshot.overall, 'partial');
  assert.equal(snapshot.components[0].uptime, 50);
});
