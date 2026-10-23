const fs = require('node:fs');

function validatePullRequestFlow(pr) {
  const base = pr?.base?.ref;
  const head = pr?.head?.ref;
  const baseRepository = pr?.base?.repo?.full_name;
  const headRepository = pr?.head?.repo?.full_name;

  if (base === 'dev') return;
  if (base === 'main' && head === 'dev' && baseRepository && baseRepository === headRepository) return;
  throw new Error('Open feature, fix, and dependency-update PRs against dev. Only this repository\'s dev branch may target main.');
}

if (require.main === module) {
  try {
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      validatePullRequestFlow(event.pull_request);
      console.log('Pull request follows feature -> dev -> main.');
    } else {
      console.log('Direct pushes to dev are supported; production is deployed from main.');
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { validatePullRequestFlow };
