# Changelog

All notable changes to J4FN Music, newest first.

## [Unreleased]

### Fixed
- Deploys no longer log a false "Status website degraded" incident. Health failures in the first two minutes after a restart, while cloudflared is still starting, are shown but not recorded.

## [1.3.0] - 2026-10-23

### New
- **Maintenance mode.** Admins can switch it on from the console with a custom notice. The bot stays online, but every command, slash command, and button replies with the notice; the bot's status turns idle and shows "Under maintenance"; the status page shows a banner. Turning it on can also stop the music that is playing, with a note posted in each room. Restarts during maintenance keep saved queues instead of resuming them.
- **System health in the admin console.** Checks run every minute for the Discord gateway, YouTube playback, yt-dlp, FFmpeg, the PO-token provider, Spotify, the Cloudflare Tunnel, the server (memory, disk, CPU), and the environment settings. Each shows 90 days of uptime bars, and an incident log records every break with its cause and how long it lasted, alongside restarts and maintenance changes. The environment panel shows only which settings are set, never their values.
- **Public status page** at `/status`: overall state, 90-day uptime for the Discord bot, music playback, Spotify links, and the website, plus past incidents and maintenance. Internal details stay in the admin console.

### Improved
- The public dashboard's **Now playing** and **Joined servers** sections show the first rows with a **See more** button and add search: live rooms by song or server name, servers by name. Search text and expanded rows persist across the automatic refresh.
- Songs start faster: the bot remembers which YouTube client last started playback and tries it first, instead of repeating a failing client before every song. Other clients remain automatic fallbacks.

### Security
- Admin changes (settings, controls, maintenance) are refused when sent from another website, so a page cannot ride on a signed-in Cloudflare Access session.
- Resolved CodeQL findings: dashboard JSON escapes HTML characters, per-server settings can no longer write to object prototypes, the admin token parser avoids slow regex backtracking, client IPs are stripped of line breaks before logging, the yt-dlp cookies file is written to a private temporary directory, and YouTube links must use an exact YouTube host.

### Maintenance
- Standardized feature and dependency updates through `dev` before production PRs to `main`, with branch checks, weekly Dependabot updates, and automatic synchronization after production merges.
- Dependabot no longer proposes `opusscript` 0.1+ (incompatible with `@discordjs/voice`) or major Node.js Docker image upgrades; the image stays on the Node 22 LTS line that CI tests. `main` is the default branch again, and Dependabot security PRs opened against it are moved to `dev` automatically.

### Fixed
- Added a separate yt-dlp default-client fallback so playable combined WEB formats remain available when forced YouTube clients receive API 403 errors.
- YouTube playback now preserves stream headers, uses yt-dlp's checked format, and tries another client when FFmpeg cannot start the audio. Now Playing appears only after the audio player starts.
- Failed cached streams are refreshed; stopping, skipping, or seeking cancels older playback attempts.
- Updated the matching PO-token plugin and Docker sidecar to 2.0.2, including upstream fixes for some YouTube 403 failures.
- Deployments rebuild yt-dlp instead of reusing a stale download layer. Failed playback notices no longer crash the bot when Discord denies access to the text channel.

## [1.2.0] - 2026-09-24

### New
- **Slash commands.** Every command also works as a `/` command (`/play`, `/skip`, `/previous`, `/queue`, `/volume`, ...), with options shown as you type. The bot's profile shows the **Supports Commands** badge, and its most-used commands appear there over time. `!` commands keep working.
- The Now Playing card has a tip pointing to the `/` commands.

## [1.1.1] - 2026-09-23

### New
- **Search Spotify by name.** `!search` shows YouTube and Spotify results together, `!spotify <song>` (`!sp`) plays the top Spotify match, and `!play <song>` falls back to Spotify when YouTube finds nothing. Songs play from their matching YouTube audio, which finds official uploads that YouTube's own search can miss.

## [1.1.0] - 2026-09-23

### New
- **Spotify links.** `!play` and `!playlist` accept Spotify track, album, and playlist links and play the best-matching audio. Albums and playlists queue up to 100 songs.
- **Previous and Next buttons.** Go back to the song before, or on to the next one. Each button only appears when there's a song to go to. `!previous` (`!prev`, `!back`) works too.
- **Music keeps playing through updates.** When the bot restarts, it rejoins voice channels that still have listeners and resumes the same song where it left off.
- **Report a bug** button on the status page. Reports are emailed to the maintainer.
- Status page announcement for Spotify support, a `!previous` command card, and clearer wording throughout.

### Improved
- **Smoother playback when many servers play at once.** Audio is encoded by ffmpeg instead of inside the bot, heavy YouTube lookups are limited to two at a time, and the Now Playing card refreshes every 10 seconds instead of every 2.
- Seeking, volume changes, and Previous start almost instantly by reusing the song's audio stream.
- The bot's own status shows the purple **Streaming** badge while music plays, without revealing any server's song to other servers.
- README rewritten as a user guide; setup moved to [SELF_HOSTING.md](SELF_HOSTING.md).

### Fixed
- Restarting or seeking a song could drop it from the queue, and a single song would stop.
- The bot's status no longer shows one server's song to every other server.

### Security
- Only YouTube links are fetched, which blocks requests to internal addresses through `!play`.
- Admin sign-ins through Cloudflare Access are verified cryptographically.
- HTTPS certificate checks are always on for YouTube requests.
- Stricter admin login rate limiting and input validation, and updated dependencies.

## [1.0.0] - 2026-09-01

First release: YouTube playback with search, playlists, queue controls, lyrics, and interactive buttons; a public status page; and a protected admin console.

[Unreleased]: https://github.com/MacroMaster101/discord_music_bot/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/MacroMaster101/discord_music_bot/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/MacroMaster101/discord_music_bot/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/MacroMaster101/discord_music_bot/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/MacroMaster101/discord_music_bot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/MacroMaster101/discord_music_bot/releases/tag/v1.0.0
