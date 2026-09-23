# Changelog

All notable changes to J4FN Music, newest first.

## [Unreleased]

### New
- **Slash commands.** Every command also works as a `/` command (`/play`, `/skip`, `/previous`, `/queue`, `/volume`, ...), with options shown as you type. They appear in the bot's profile under **Commands**. `!` commands keep working.

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

[1.1.1]: https://github.com/MacroMaster101/discord_music_bot/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/MacroMaster101/discord_music_bot/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/MacroMaster101/discord_music_bot/releases/tag/v1.0.0
