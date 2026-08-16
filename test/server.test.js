const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

process.env.ADMIN_TOKEN = 'test-admin-token';
const { buildPublicPayload, createDashboardServer, isAdminRequest } = require('../server');

class MockCollection extends Map {
  reduce(callback, initial) {
    let result = initial;
    for (const value of this.values()) result = callback(result, value);
    return result;
  }
}

const guild = {
  id: 'private-guild-id',
  name: 'Private Guild Name',
  memberCount: 42,
  iconURL: () => 'https://cdn.example.test/guild.png',
};
const client = {
  user: {
    username: 'J4FN MUSIC',
    tag: 'J4FN MUSIC#3509',
    displayAvatarURL: () => 'https://cdn.example.test/bot.png',
  },
  ws: { status: 0, ping: 44 },
  guilds: { cache: new MockCollection([[guild.id, guild]]) },
};
const serverQueue = {
  songs: [{ title: 'Public Song', url: 'https://youtube.example.test/watch', thumbnail: 'https://img.example.test/song.jpg', duration: 180 }],
  textChannel: { guild },
  voiceChannel: { name: 'Private Voice Room' },
  player: { state: { status: 'playing', resource: { volume: { volume: 1 } } } },
  loop: null,
};
const queue = new Map([[guild.id, serverQueue]]);
const hooks = {
  getBotStats: () => ({
    totalSongsPlayed: 7,
    commandLog: [{ command: 'play', userName: 'Private User', guildName: guild.name }],
  }),
  getQueueProgress: () => ({
    elapsedSeconds: 30,
    durationSeconds: 180,
    elapsedText: '0:30',
    durationText: '3:00',
    upcoming: [{ title: 'Private Queue Item' }],
  }),
};

test('public payload contains useful aggregates without private guild data', () => {
  const payload = buildPublicPayload(client, queue, hooks);
  assert.equal(payload.status, 'online');
  assert.equal(payload.guilds, 1);
  assert.equal(payload.audience, 42);
  assert.equal(payload.activeTracks[0].title, 'Public Song');
  assert.equal(payload.prefix, '!');

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /private-guild-id/i);
  assert.doesNotMatch(serialized, /Private Guild Name/i);
  assert.doesNotMatch(serialized, /Private Voice Room/i);
  assert.doesNotMatch(serialized, /Private User/i);
  assert.doesNotMatch(serialized, /Private Queue Item/i);
  assert.equal(payload.commandLog, undefined);
  assert.equal(payload.system, undefined);
});

test('admin token comparison accepts bearer and legacy header tokens', () => {
  assert.equal(isAdminRequest({ headers: { authorization: 'Bearer secret' } }, 'secret'), true);
  assert.equal(isAdminRequest({ headers: { 'x-admin-token': 'secret' } }, 'secret'), true);
  assert.equal(isAdminRequest({ headers: { authorization: 'Bearer wrong' } }, 'secret'), false);
});

test('Cloudflare Access identity authorizes tunneled admin requests', () => {
  const accessHeaders = {
    'cf-access-authenticated-user-email': 'admin@example.com',
    'cf-access-jwt-assertion': 'signed-access-assertion',
    'cf-ray': 'preview-ray',
  };
  assert.equal(isAdminRequest({ headers: accessHeaders }, ''), true);
  assert.equal(isAdminRequest({ headers: { 'cf-access-authenticated-user-email': 'spoof@example.com' } }, ''), false);
});

let dashboard;
let baseUrl;

before(async () => {
  dashboard = createDashboardServer(client, queue, hooks);
  await new Promise((resolve) => dashboard.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${dashboard.address().port}`;
});

after(async () => {
  await new Promise((resolve) => dashboard.close(resolve));
});

test('public page and API are reachable without an admin token', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Live status/);

  const response = await fetch(`${baseUrl}/api/public/status`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).activeStreams, 1);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);

  const robots = await fetch(`${baseUrl}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Disallow: \/api\/admin/);

  const logo = await fetch(`${baseUrl}/assets/logo.png`);
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get('content-type'), /image\/png/);
  assert.ok((await logo.arrayBuffer()).byteLength > 100_000);

  const favicon = await fetch(`${baseUrl}/assets/favicon.png`);
  assert.equal(favicon.status, 200);
  assert.match(favicon.headers.get('content-type'), /image\/png/);
  assert.ok((await favicon.arrayBuffer()).byteLength > 10_000);
});

test('admin APIs reject anonymous requests and allow the configured token', async () => {
  const denied = await fetch(`${baseUrl}/api/admin/stats`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { Authorization: 'Bearer test-admin-token' },
  });
  assert.equal(allowed.status, 200);
  const payload = await allowed.json();
  assert.equal(payload.activeTracks[0].guildName, 'Private Guild Name');
  assert.equal(payload.commandLog[0].userName, 'Private User');

  const accessAllowed = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: {
      'Cf-Access-Authenticated-User-Email': 'admin@example.com',
      'Cf-Access-Jwt-Assertion': 'signed-access-assertion',
      'Cf-Ray': 'test-ray',
    },
  });
  assert.equal(accessAllowed.status, 200);
  assert.equal((await accessAllowed.json()).accessEmail, 'admin@example.com');
});

test('admin redirect and malformed control requests fail safely', async () => {
  const redirect = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/admin/');

  const malformed = await fetch(`${baseUrl}/api/admin/control`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-admin-token',
      'Content-Type': 'application/json',
    },
    body: '{not-json',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: 'Invalid JSON.' });
});
