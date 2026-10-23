const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validatePullRequestFlow } = require('../scripts/check-branch-flow');

const repository = 'MacroMaster101/discord_music_bot';
function pullRequest(base, head, headRepository = repository) {
  return { base: { ref: base, repo: { full_name: repository } }, head: { ref: head, repo: { full_name: headRepository } } };
}

test('feature, dependency, and fork contributions target dev', () => {
  for (const head of ['feature/search', 'fix/player', 'dependabot/npm_and_yarn/updates']) {
    assert.doesNotThrow(() => validatePullRequestFlow(pullRequest('dev', head)));
  }
  assert.doesNotThrow(() => validatePullRequestFlow(pullRequest('dev', 'feature/search', 'contributor/fork')));
  assert.doesNotThrow(() => validatePullRequestFlow(pullRequest('dev', 'main')));
});

test('main accepts only the same repository dev branch', () => {
  assert.doesNotThrow(() => validatePullRequestFlow(pullRequest('main', 'dev')));
  for (const head of ['feature/search', 'fix/player', 'dependabot/npm_and_yarn/updates']) {
    assert.throws(() => validatePullRequestFlow(pullRequest('main', head)), /against dev/);
  }
  assert.throws(() => validatePullRequestFlow(pullRequest('main', 'dev', 'contributor/fork')), /against dev/);
  assert.throws(() => validatePullRequestFlow(pullRequest('release', 'feature/search')), /against dev/);
  assert.throws(() => validatePullRequestFlow({}), /against dev/);
});
