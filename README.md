# J4FN MUSIC — Discord Music Bot 🎵

A powerful, self-hostable Discord music bot that streams audio from YouTube with robust anti-bot bypass mechanisms, interactive message controls, and automatic voice-channel management.

---

## ✨ Features

| Category | Details |
|---|---|
| 🎵 **YouTube Playback** | Play by **search query** or **direct URL** (supports `youtube.com`, `youtu.be`, `/shorts/`, `/live/`) |
| 🎛️ **Interactive Controls** | In-chat buttons: **Play Now**, **Skip**, **Queue**, **Stop** — no need to type commands |
| ⏸️ **Pause & Resume** | Pause and resume playback at any time |
| 🔊 **Volume Control** | Adjust playback volume from 0–100% |
| 🔂 **Loop Modes** | Loop a single song, the entire queue, or disable looping |
| 🔀 **Shuffle** | Shuffle upcoming songs in the queue |
| 🎧 **Now Playing Embed** | Rich embed showing current song, volume, queue size, and loop status |
| 📋 **Queue Management** | View, reorder, remove, and clear songs in the queue |
| 🔊 **Voice Channel Status** | The currently playing song title is shown in the voice channel's status bar |
| 🤖 **Presence** | Bot activity shows `!play · 🔊 In voice` while connected, `!play` otherwise |
| 🍪 **Anti-Bot Bypass** | Cookie-based auth, PO token support, and automatic player-client fallback chains |
| 🔄 **Auto-Reconnect** | Automatically rejoins voice if the connection drops while songs remain in the queue |
| ⏱️ **Idle Disconnect** | Leaves the voice channel after 10 seconds of an empty queue (5 s on error) |
| 🏷️ **Nickname Reset** | Resets the bot's server nickname to the application default on every startup |

---

## 🎮 Commands

All commands use the configurable prefix (default: `!`). Aliases are shown in parentheses.

### 🎶 Playback

| Command | Alias | Description |
|---|---|---|
| `!play <song name or URL>` | `!p` | Play a song or add it to the queue |
| `!pause` | — | Pause the current song |
| `!resume` | `!unpause` | Resume playback |
| `!skip` | `!s` | Skip to the next song |
| `!stop` | `!dc`, `!disconnect` | Stop playback, clear the queue, and disconnect |
| `!nowplaying` | `!np` | Show the current song in a rich embed |

### 📋 Queue

| Command | Alias | Description |
|---|---|---|
| `!queue` | `!q` | Show the current queue |
| `!shuffle` | — | Shuffle the upcoming songs |
| `!remove <#>` | — | Remove a song by its queue position |
| `!move <from> <to>` | `!mv` | Move a song to a different queue position |
| `!clear` | — | Clear the queue (keeps the current song) |

### 🔧 Settings

| Command | Alias | Description |
|---|---|---|
| `!volume <0-100>` | `!vol` | Get or set the playback volume |
| `!loop [off\|song\|queue]` | `!repeat` | Toggle loop mode (cycles: off → song → queue) |

### ❓ Info

| Command | Alias | Description |
|---|---|---|
| `!help` | `!h` | Show the full help menu in a rich embed |

### Button Controls

Every "Now Playing" and "Added to Queue" message includes interactive buttons:

- **Play Now** — Immediately plays a queued song (skips the current one)
- **Skip** — Skip the current song
- **Queue** — View the queue (shown ephemerally, only visible to you)
- **Stop** — Stop playback and disconnect

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 22.12+**
- **FFmpeg** — bundled via `ffmpeg-static` for local use; Docker/Nixpacks install it automatically
- A **Discord Bot Token** with the following gateway intents enabled:
  - `Guilds`
  - `Guild Messages`
  - `Message Content` (privileged)
  - `Guild Voice States`

### Installation

```bash
git clone https://github.com/MacroMaster101/discord_music_bot.git
cd discord_music_bot
npm ci
```

### Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `TOKEN` | ✅ | Discord bot token (also reads `DISCORD_TOKEN` / `BOT_TOKEN`) |
| `PREFIX` | — | Command prefix (default: `!`) |
| `YTDLP_COOKIES_PATH` | — | Path to a Netscape-format `cookies.txt` file |
| `YTDLP_COOKIES_BASE64` | — | Base64-encoded cookies (great for cloud hosts like Railway) |
| `YTDLP_PO_TOKEN` | — | YouTube Proof-of-Origin token (advanced, see [yt-dlp docs](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)) |

### Run

```bash
npm start
```

---

## 🍪 YouTube Cookies Setup

If YouTube starts blocking playback with _"Sign in to confirm you're not a bot"_, you need to supply session cookies:

1. Install a browser extension like **"Get cookies.txt LOCALLY"**.
2. Log in to YouTube in your browser, then export the cookies.
3. Provide them to the bot via **one** of these methods:

| Method | How |
|---|---|
| **File path** | Save as `cookies.txt` and set `YTDLP_COOKIES_PATH=./cookies.txt` in `.env` |
| **Base64** | Encode the file (`base64 cookies.txt`) and set `YTDLP_COOKIES_BASE64=<encoded>` in `.env` |

> **Tip:** Base64 is recommended for cloud platforms (Railway, Render) where you can't upload files easily — just paste the value into the environment variable dashboard.

---

## 🛡️ Anti-Bot Fallback System

The bot automatically rotates through multiple YouTube player-client chains when a request is blocked:

```
web_safari, web_embedded, default
→ mweb, default
→ tv_simply, default, -tv
→ web, default
```

Each chain is tried in order. If one is blocked (403 / "Sign in" / "not a bot"), the next chain is attempted. This happens transparently for both metadata lookups and audio stream extraction.

---

## 🐳 Deployment

### Docker

```bash
docker build -t j4fn-music .
docker run -d --name j4fn-music \
  -e TOKEN=your_discord_bot_token \
  -e PREFIX=! \
  -e YTDLP_COOKIES_BASE64=your_base64_cookies \
  j4fn-music
```

The Dockerfile:
- Uses **Node.js 22 slim** base image
- Installs **FFmpeg** and **Python 3** (needed by yt-dlp)
- Automatically upgrades the bundled **yt-dlp** binary to the latest version on build

### Railway / Render / Nixpacks

1. Push the code to GitHub.
2. Connect your hosting provider to the repo.
3. Add environment variables (`TOKEN`, `PREFIX`, `YTDLP_COOKIES_BASE64`).
4. Deploy — the included `nixpacks.toml` ensures **Node.js 22**, **Python 3**, and **FFmpeg** are available.

### Local

```bash
npm start
```

Keep the terminal (or your PC) running. The bot stays online as long as the process is alive.

---

## 🏗️ Project Structure

```
discord_music_bot/
├── index.js            # Bot logic (commands, playback, queue, controls)
├── package.json        # Dependencies & scripts
├── Dockerfile          # Docker container definition
├── nixpacks.toml       # Nixpacks build config (Railway, etc.)
├── .env.example        # Environment variable template
├── .gitignore          # Git ignore rules
└── .dockerignore       # Docker ignore rules
```

---

## 📦 Tech Stack

| Package | Purpose |
|---|---|
| [discord.js](https://discord.js.org/) v14 | Discord API client |
| [@discordjs/voice](https://github.com/discordjs/discord.js/tree/main/packages/voice) | Voice connection & audio player |
| [youtube-dl-exec](https://github.com/microlinkhq/youtube-dl-exec) | yt-dlp wrapper for metadata & stream URLs |
| [yt-search](https://github.com/nicedoc/yt-search) | YouTube search by keyword |
| [opusscript](https://github.com/nicedoc/opusscript) | Opus audio encoding |
| [libsodium-wrappers](https://github.com/nicedoc/libsodium.js) | Encryption for voice UDP |
| [ffmpeg-static](https://github.com/nicedoc/ffmpeg-static) | Bundled FFmpeg binary (local dev) |
| [dotenv](https://github.com/motdotla/dotenv) | `.env` file loading |

---

## 📝 Scripts

| Script | Command | Description |
|---|---|---|
| `start` | `npm start` | Start the bot |
| `check` | `npm run check` | Syntax-check `index.js` without running it |

---

## 📄 License

MIT
