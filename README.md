# 🎵 J4FN Music

A Discord music bot that turns any voice channel into a live stage. Search for a song or paste a YouTube or Spotify link, and control everything with one-tap buttons right in your server.

**[➕ Add J4FN Music to your server](https://music.j4fn.site/invite)** · **[📊 Live status page](https://music.j4fn.site)**

---

## ✨ Features

- 🎶 **Play anything by name.** Type a song name, or paste a YouTube link (videos, Shorts, live streams).
- 🟢 **Spotify links.** Paste a Spotify track, album, or playlist link and the bot plays it. Albums and playlists queue up to 100 songs.
- 📂 **Playlists.** Queue a whole YouTube playlist, Spotify album, or Spotify playlist at once.
- 🎛️ **One-tap controls.** Every song gets a Now Playing card with buttons: previous, skip, pause, seek ±10/30 seconds, loop, shuffle, volume, and queue.
- 🔍 **Search YouTube and Spotify.** `!search` shows results from both so you can pick the right version, and `!spotify <song>` finds a song by its Spotify name.
- 🎤 **Lyrics.** `!lyrics` finds the words to the current song.
- 🔒 **Private per server.** Each server has its own queue and controls. The song shows on your voice channel's status, visible only inside your server.
- ⏱️ **Tidy by default.** Leaves empty voice channels and pauses when everyone leaves.
- 🔄 **Keeps playing through updates.** If the bot restarts for an update, it comes back and resumes the same song where it left off.

---

## 🎮 Commands

Every command works two ways: type it with the `!` prefix (like `!play`), or as a **slash command** (type `/` and pick it from the list, like `/play`). Slash commands show their options as you type. The bot owner can set a different `!` prefix for your server.

### Playing music
| Command | What it does |
| :--- | :--- |
| `!play <song or link>` (`!p`) | Play a song by name, or a YouTube or Spotify link. Adds to the queue if something is already playing. |
| `!search <song>` (`!sr`) | Show the top YouTube and Spotify results and pick one. |
| `!spotify <song>` (`!sp`) | Find a song on Spotify by name and play it. |
| `!playlist <link>` (`!pl`) | Queue a YouTube playlist, or a Spotify album or playlist. |
| `!pause` / `!resume` | Pause or resume. |
| `!skip` (`!s`) | Skip to the next song. |
| `!previous` (`!prev`, `!back`) | Go back to the song before this one. |
| `!seek <time>` | Jump to a time, like `1:30` or `90`. |
| `!nowplaying` (`!np`) | Show the current song with its control buttons. |
| `!lyrics` (`!ly`) | Show lyrics for the current song. |
| `!stop` (`!dc`) | Stop the music, clear the queue, and leave. |

### Managing the queue
| Command | What it does |
| :--- | :--- |
| `!queue` (`!q`) | See what's coming up. |
| `!shuffle` | Shuffle the upcoming songs. |
| `!remove <number>` | Remove a song from the queue. |
| `!move <from> <to>` (`!mv`) | Move a song to a different spot. |
| `!clear` | Clear the upcoming songs. |
| `!loop [off / song / queue]` (`!repeat`) | Repeat the current song or the whole queue. |
| `!volume <0-100>` (`!vol`) | Check or change the volume. |
| `!help` (`!h`) | Show all commands in Discord. |

---

## 🟢 About Spotify links

Spotify doesn't let bots stream its audio, so J4FN Music reads the song details from your Spotify link and plays the best-matching version from YouTube. It prefers official audio and avoids live or cover versions unless the song title asks for one. Once in a while the match may be a different recording of the same song.

Songs are also found by name on Spotify (`!spotify <song>`, or automatically when YouTube search finds nothing). The audio still comes from YouTube, so a song that exists only on Spotify can't be played.

Private Spotify playlists can't be read. Make a playlist public to play it.

---

## 🔒 Privacy

- Each server's queue, controls, and settings are separate. Other servers never see what you're playing in Discord.
- The [public status page](https://music.j4fn.site) shows server names, song titles, and overall stats, but never channels, members, queues, or settings.
- The bot only asks for the permissions it needs to join voice channels, play music, and post its messages.

---

## 🐞 Found a bug?

Use the 🐞 button on the [status page](https://music.j4fn.site), or [open an issue](../../issues). Security problems should be reported privately; see [SECURITY.md](SECURITY.md).

---

## 🛠️ Run your own copy

J4FN Music is open source and self-hostable with Docker. The [self-hosting guide](SELF_HOSTING.md) covers setup, configuration, the web dashboard, and automatic deploys. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📰 What's new

See the [changelog](CHANGELOG.md) for every release.

---

## 📄 License

MIT. See [LICENSE](LICENSE).
