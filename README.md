# J4FN MUSIC — Discord Music Bot 🎵

A powerful, self-hostable Discord music bot that streams audio from YouTube with robust anti-bot bypass mechanisms, interactive message controls, and automatic voice-channel management.

---

## ✨ Features

| Category | Details |
|---|---|
| 📊 **Web Dashboard** | Premium dark-mode status page featuring live-ticking uptime, system specs, RAM usage against the 2 GB VM limit, rotating vinyl card animations for active DJ playbacks, and an admin settings modal for real-time configuration |
| 🎵 **YouTube Playback** | Play by **search query** or **direct URL** (supports `youtube.com`, `youtu.be`, `/shorts/`, `/live/`) |
| 🔍 **Interactive Search** | `!search` picks the top 5 YouTube results and lets the user choose via buttons |
| 📂 **Playlist Support** | `!playlist` queues up to 100 videos from a YouTube playlist in one go |
| 🎤 **Lyrics Lookup** | `!lyrics` fetches and displays lyrics for the current or any requested song |
| ⏩ **Seek** | `!seek 1:30` jumps to any position in the current track |
| 🎛️ **Interactive Controls** | In-chat buttons: **Play Now**, **Skip**, **Queue**, **Stop** — no need to type commands |
| 📋 **Queue Picker** | A select-menu on queue messages lets you **Play Now**, **Move to Top**, or **Remove** any song |
| ❓ **Help Command** | Rich embed help menu (`!help`) showing all commands grouped by category with aliases |
| 🎙️ **Rotating Status** | Bot status cycles every 12s between idle prompts (`!play`, `!help`, `💿 Spinning Virtual Vinyl`, `🎤 Ready to Drop the Bass`, `🏆 The Ultimate DJ Battle`) and live playback info with a **purple LIVE Streaming badge** (`🎶 Now Playing`, `📋 Queue`, `🔊 Room`, `🔥 Dropping Beats`, `!np`) — each clickable and linking to the current YouTube track |
| ⏸️ **Pause & Resume** | Pause and resume playback at any time |
| 🔊 **Volume Control** | Adjust playback volume from 0–100% |
| 🔂 **Loop Modes** | Loop a single song, the entire queue, or disable looping |
| 🔀 **Shuffle** | Shuffle upcoming songs in the queue |
| 🎧 **Now Playing Embed** | Rich embed with a live-updating progress bar, current song, volume, queue size, and loop status |
| 📋 **Queue Management** | View, reorder, remove, and clear songs in the queue |
| ⚙️ **Per-Guild Settings** | Customise prefix, default volume, idle timers, and auto-pause per server — editable via the web dashboard |
| 🍪 **Anti-Bot Bypass** | Cookie-based auth, PO token support, and automatic player-client fallback chains |
| 🔄 **Auto-Reconnect** | Automatically rejoins voice if the connection drops while songs remain in the queue |
| ⏱️ **Idle Disconnect** | Leaves the voice channel after a configurable delay when the queue empties (default 10 s; 5 s on error) |
| 👻 **Empty VC Disconnect** | Auto-pauses and disconnects when no humans are left in the voice channel (configurable, default 60 s) |
| 🏷️ **Nickname Reset** | Resets the bot's server nickname to the application default on every startup |
| 🎙️ **Voice Channel Status** | Sets the voice channel's status text to the currently playing song |

---

## 🎮 Commands

All commands use the configurable prefix (default: `!`). Aliases are shown in parentheses.

### 🎶 Playback

| Command | Alias | Description |
|---|---|---|
| `!play <song name or URL>` | `!p` | Play a song or add it to the queue |
| `!search <query>` | `!sr` | Search YouTube and pick from the top 5 results |
| `!playlist <URL>` | `!pl` | Queue every song from a YouTube playlist |
| `!pause` | — | Pause the current song |
| `!resume` | `!unpause` | Resume playback |
| `!skip` | `!s` | Skip to the next song |
| `!seek <time>` | — | Jump to a position (e.g. `1:30`, `90`) |
| `!stop` | `!dc`, `!disconnect` | Stop playback, clear the queue, and disconnect |
| `!nowplaying` | `!np` | Show the current song in a rich embed |
| `!lyrics` | `!ly` | Show lyrics for the current (or specified) song |

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

**"Added to Queue" messages** include:

- **Play Now** — Immediately plays a queued song (skips the current one)
- **Skip** — Skip the current song
- **Queue** — View the queue (shown ephemerally, only visible to you)
- **Stop** — Stop playback and disconnect

**"Now Playing" embeds** include three rows of interactive controls:

- **⏪ 30s / ⏪ 10s / ⏯️ Play-Pause / 10s ⏩ / 30s ⏩** — Seek and pause controls
- **⏭️ Skip / 🔁 Loop / 🔀 Shuffle / 🔉 -10 / 🔊 +10** — Playback and volume controls
- **📋 Queue / ⏹️ Stop** — Queue view and disconnect

The **queue view** also features a **select-menu picker** where you can choose a song and then:

- **▶️ Play Now** — Jump to that song immediately
- **⏫ Move to Top** — Bump it to the next position
- **🗑️ Remove** — Remove it from the queue

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
| `ADMIN_TOKEN` | — | Secret token required to edit bot settings via the web dashboard |
| `PORT` | — | HTTP port for the web dashboard (default: `8080`) |
| `YTDLP_COOKIES_PATH` | — | Path to a Netscape-format `cookies.txt` file (also reads `YTDLP_COOKIES`) |
| `YTDLP_COOKIES_BASE64` | — | Base64-encoded cookies (great for cloud hosts like Fly.io) |
| `YTDLP_PO_TOKEN` | — | YouTube Proof-of-Origin token (advanced, see [yt-dlp docs](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)) |

> **Note:** The command prefix (default `!`) is configured via the web dashboard settings panel, not an environment variable. It can be set globally or overridden per server.

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

> **Tip:** Base64 is recommended for cloud platforms (Fly.io, Render) where you can't upload files easily — just set it as a secret: `fly secrets set YTDLP_COOKIES_BASE64=<encoded>`.

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
  -e ADMIN_TOKEN=your_secret_admin_token \
  -e YTDLP_COOKIES_BASE64=your_base64_cookies \
  j4fn-music
```

The Dockerfile:
- Uses **Node.js 22 slim** base image
- Installs **FFmpeg** and **Python 3** (needed by yt-dlp)
- Automatically upgrades the bundled **yt-dlp** binary to the latest version on build

### AWS EC2 & Docker Compose (Recommended)

To host this Discord Music Bot concurrently on your AWS EC2 instance (Ubuntu Server, Singapore region) alongside other bots:

#### 1. First-Time Manual Server Setup
1. Connect to your EC2 instance via SSH:
   ```bash
   ssh -i bot-key.pem ubuntu@13.212.35.227
   ```
2. Navigate to your user home directory and clone the repository:
   ```bash
   cd ~
   git clone https://github.com/MacroMaster101/discord_music_bot.git
   ```
3. Navigate into the cloned folder:
   ```bash
   cd ~/discord_music_bot
   ```
4. Create and configure your local environment file:
   ```bash
   nano .env
   ```
   Add your required variables, such as:
   ```env
   TOKEN=your_discord_bot_token
   ADMIN_TOKEN=your_secret_admin_token
   PORT=8080
   ```
5. Launch the container:
   ```bash
   docker compose up -d --build
   ```

#### 2. Configure GitHub Secrets for Automatic Deployment (CI/CD)
To enable automatic updates whenever changes are pushed to `main`, configure the following **Repository Secrets** in your GitHub repository (**Settings** -> **Secrets and variables** -> **Actions**):
- `EC2_HOST`: `13.212.35.227`
- `EC2_USERNAME`: `ubuntu`
- `EC2_SSH_KEY`: The entire contents of your private SSH key (`bot-key.pem`).

#### 3. AWS Security Group Configuration
To access the live web dashboard:
- Open your AWS EC2 Console.
- Navigate to the **Security Groups** page and select the `launch-wizard-1` security group.
- Add an **Inbound Rule** with:
  - **Type**: Custom TCP
  - **Port Range**: `8082`
  - **Source**: `Anywhere-IPv4` (`0.0.0.0/0`) or your trusted IP network.

The dashboard will be active and viewable at:
`http://13.212.35.227:8082`

### Local

```bash
npm start
```

Keep the terminal running. The bot stays online as long as the process is active.

---

## 🏗️ Project Structure

```
discord_music_bot/
├── index.js            # Bot core (commands, playback, queue, controls, presence)
├── server.js           # Native HTTP server, stats API, and dashboard web interface
├── settings.js         # Per-guild and global settings with persistent JSON storage
├── package.json        # Dependencies & scripts
├── Dockerfile          # Docker container definition
├── docker-compose.yml  # Docker Compose configuration
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
