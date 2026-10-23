const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

// Exercise the actual scheduled deployment gate without contacting a host or
// starting containers. An overdue rebuild must still leave listeners alone.
const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/deploy.yml'), 'utf8');
const start = workflow.indexOf('            full_state=');
const end = workflow.indexOf('            before=', start);
assert.ok(start >= 0 && end > start);
const gate = workflow.slice(start, end).replace(/^ {12}/gm, '');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

function scheduledRebuild(ageDays, activity) {
  const result = spawnSync(bash, ['--noprofile', '--norc', '-c', `
set -eu
date() { printf '2000000000'; }
cat() { printf '%s' "$TEST_LAST"; }
grep() { printf '8080'; }
docker() { printf '%s' "$TEST_ACTIVITY"; }
${gate}
printf 'REBUILD=%s' "$FULL_REBUILD"
`], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, SCHEDULED: 'true', FULL_REBUILD: 'false',
      TEST_LAST: String(2000000000 - ageDays * 86400), TEST_ACTIVITY: activity },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('weekly rebuild waits until due, then runs only with confirmed idle activity', () => {
  assert.match(scheduledRebuild(6, '0'), /not due/);
  assert.match(scheduledRebuild(7, '0'), /REBUILD=true/);
  assert.match(scheduledRebuild(7, '1'), /music is playing/);
  assert.match(scheduledRebuild(14, '2'), /music is playing/);
  assert.match(scheduledRebuild(30, '1'), /music is playing/);
  assert.match(scheduledRebuild(30, ''), /Cannot confirm/);
  assert.match(scheduledRebuild(30, 'unavailable'), /Cannot confirm/);
});
