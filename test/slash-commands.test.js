const assert = require('node:assert/strict');
const { test } = require('node:test');
const { commandDefinitions, definitionsSignature, toPrefixCommand } = require('../slash-commands');

test('definitions follow Discord naming and length rules', () => {
  const defs = commandDefinitions();
  assert.ok(defs.length >= 15);
  assert.equal(new Set(defs.map((d) => d.name)).size, defs.length, 'names are unique');
  for (const def of defs) {
    assert.match(def.name, /^[a-z0-9_-]{1,32}$/, `bad name ${def.name}`);
    assert.ok(def.description.length >= 1 && def.description.length <= 100, `description length for ${def.name}`);
    assert.deepEqual(def.contexts, [0], `${def.name} is server-only`);
    let seenOptional = false;
    for (const option of def.options) {
      assert.match(option.name, /^[a-z0-9_-]{1,32}$/);
      assert.ok(option.description.length >= 1 && option.description.length <= 100, `option description for ${def.name}.${option.name}`);
      if (!option.required) seenOptional = true;
      else assert.equal(seenOptional, false, `required options must come first in ${def.name}`);
    }
  }
});

test('slash options map onto the same ! commands', () => {
  assert.deepEqual(toPrefixCommand('play', { song: 'bowitiya  mal' }), { command: 'play', args: ['bowitiya', 'mal'] });
  assert.deepEqual(toPrefixCommand('play', { song: 'https://open.spotify.com/track/x' }), { command: 'play', args: ['https://open.spotify.com/track/x'] });
  assert.deepEqual(toPrefixCommand('move', { from: 3, to: 1 }), { command: 'move', args: ['3', '1'] });
  assert.deepEqual(toPrefixCommand('volume', {}), { command: 'volume', args: [] });
  assert.deepEqual(toPrefixCommand('volume', { level: 0 }), { command: 'volume', args: ['0'] });
  assert.deepEqual(toPrefixCommand('loop', { mode: 'queue' }), { command: 'loop', args: ['queue'] });
  assert.deepEqual(toPrefixCommand('lyrics', {}), { command: 'lyrics', args: [] });
  assert.deepEqual(toPrefixCommand('skip'), { command: 'skip', args: [] });
  assert.equal(toPrefixCommand('not-a-command'), null);
});

test('signature ignores extra fields Discord adds, so unchanged commands are not re-registered', () => {
  const defs = commandDefinitions();
  // What discord.js returns: camelCase limits and extra ids/versions.
  const registered = defs.map((d) => ({
    ...d,
    id: '123',
    version: '456',
    options: d.options.map(({ min_value: minValue, max_value: maxValue, ...rest }) => ({ ...rest, minValue, maxValue })),
  })).reverse();
  assert.equal(definitionsSignature(registered), definitionsSignature(defs));

  const changed = defs.map((d) => (d.name === 'play' ? { ...d, description: 'Something else' } : d));
  assert.notEqual(definitionsSignature(changed), definitionsSignature(defs));
});
