# Contributing to Discord Music Bot

Thank you for your interest in contributing! We welcome bug reports, feature suggestions, documentation enhancements, and pull requests from the community.

Please take a moment to review this document before submitting contributions.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please treat all community members with respect and kindness.

---

## How to Contribute

### 1. Reporting Bugs
- First, search existing [GitHub Issues](../../issues) to see if the bug has already been reported.
- If not, open a new issue using our **Bug Report** template.
- Provide a clear title, reproduction steps, expected vs. actual behavior, and relevant logs (with sensitive tokens redacted).

### 2. Suggesting Enhancements
- Check [existing issues](../../issues) to ensure your idea hasn't been proposed yet.
- Open a new issue using the **Feature Request** template describing the proposed feature, use cases, and how it would improve the bot.

### 3. Submitting Pull Requests (PRs)
1. **Fork** the repository and clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/discord_music_bot.git
   cd discord_music_bot
   ```
2. **Create a topic branch from `dev`**:
   ```bash
   git checkout dev
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```
3. **Set up dependencies**:
   ```bash
   npm ci
   cp .env.example .env
   ```
4. **Make your changes**:
   - Write clean, readable code with comments where helpful.
   - Respect privacy boundaries: never expose internal Discord snowflake IDs, channel IDs, user tags, or private queues through public APIs.
   - Ensure you do not commit any personal tokens, domains, or credentials.
5. **Run verification checks**:
   Make sure all syntax checks and tests pass before committing:
   ```bash
   npm run check
   npm test
   ```
6. **Commit your changes**:
   Follow conventional commit conventions:
   ```bash
   git commit -m "feat(web): add new volume slider visualization"
   # or
   git commit -m "fix(player): resolve edge case in playlist advancement"
   ```
7. **Push to your fork and open a Pull Request**:
   - Push to your branch: `git push origin feat/your-feature-name`
   - Open a PR against `dev` on the original repository.
   - Describe what changed and why.

---

## Branches

- `dev` is the integration branch. All feature and fix PRs target `dev`.
- `main` is production: every push to `main` deploys to the live bot. It is protected by a ruleset (changes only through pull requests, the `test` CI check must pass, linear history, no force-push or deletion), and is updated by PRs from `dev`.

---

## Development Guidelines

- **Code Style**: Vanilla JavaScript (Node.js CommonJS), clean and dependency-light.
- **Privacy & Security**:
  - Keep public endpoints strictly sanitized (`/api/public/*`).
  - Keep admin endpoints authenticated via Cloudflare Access or `ADMIN_TOKEN`.
  - Only YouTube URLs may reach `yt-dlp`/`ffmpeg`; never pass arbitrary user URLs or text that could be read as a command-line flag.
- **Testing**:
  - Add or update tests in `test/` when changing API payloads, authentication, Spotify handling, or resume-after-restart.
- **Documentation**:
  - Update `README.md` for anything users see (commands, features) and `SELF_HOSTING.md` for configuration, environment variables, or deployment changes.
