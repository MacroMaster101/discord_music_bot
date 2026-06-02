# 🎵 J4FN MUSIC — Discord Music Bot 🎧

A premium, self-hostable Discord music player featuring a high-tech glassmorphic web dashboard, robust anti-bot bypass mechanisms, interactive message buttons, and automatic voice channel management. 🎧✨

![Node.js](https://img.shields.io/badge/Node.js-22.12+-339933?logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-14.x-5865F2?logo=discord&logoColor=white)
![AWS EC2](https://img.shields.io/badge/Deployed_on-AWS_EC2-FF9900?logo=amazonec2&logoColor=white)
![Docker](https://img.shields.io/badge/Containerized-Docker-2496ED?logo=docker&logoColor=white)

---

## ✨ Key Features 🚀

- 📊 **Web Dashboard** — Premium dark-mode status page featuring live-ticking uptime, system specs, memory telemetry, active stream details, and real-time dashboard configurations.
- 🎵 **Advanced Playback** — Play music via search query or direct URL (supports `youtube.com`, `youtu.be`, `/shorts/`, `/live/`).
- 🔍 **Interactive Search** — The `!search` command lets you pick from the top 5 YouTube results using active Discord buttons.
- 📂 **Playlist Handler** — Stream complete YouTube playlists (up to 100 tracks in a single query) via `!playlist`.
- 🎤 **Lyrics Lookup** — Look up exact song lyrics in real-time using the `!lyrics` command.
- 🎛️ **Interactive Controls** — Tap in-chat control buttons to pause, play, seek, adjust volume, and list queues.
- ⚙️ **Custom Configuration** — Configure custom prefixes, default volume, and voice timeout policies globally or per-server via the web dashboard.
- 🤖 **Anti-Bot Bypass** — Automatic player-client fallback chains, Netscape cookie parsers, base64 encoding support, and PO token support to bypass YouTube blocks.
- ⏱️ **Auto Voice Manager** — Leaves empty rooms automatically and pauses playback when alone to conserve bandwidth.

---

## 🛠️ Engine & Tech Stack 📦

Our lightweight and high-performance server engine is built on:

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| 🎙️ **Voice Controller** | `@discordjs/voice` | Low-latency audio packet streaming and UDP transport |
| 🎬 **Media Streamer** | `youtube-dl-exec` | Active `yt-dlp` wrapper providing advanced anti-bot bypass |
| 🔍 **Search Engine** | `yt-search` | Fast YouTube search-by-keyword indexer |
| 🎛️ **Audio Transcoder** | `ffmpeg-static` + `opusscript` | Portable audio transcoding and high-fidelity Opus compression |
| 🖥️ **Dashboard Server** | Native Node.js `http` | Ultra-lightweight telemetry API and UI server |

---

## 🎮 Command List 🎚️

Configure commands using your server's custom prefix (default: `!`).

### 🎶 Playback Controls
- `!play <query / URL>` (`!p`) — 🎵 Search and stream a song, or append to queue.
- `!search <query>` (`!sr`) — 🔍 Search YouTube and choose from top 5 results.
- `!playlist <URL>` (`!pl`) — 📂 Load and queue a full YouTube playlist.
- `!pause` — ⏸️ Pause the current track.
- `!resume` (`!unpause`) — ▶️ Resume playback.
- `!skip` (`!s`) — ⏩ Skip the current song.
- `!seek <time>` — ⏱️ Jump to a timestamp (e.g. `1:30` or `90`).
- `!stop` (`!dc`) — ⏹️ Clear the queue and disconnect from the voice channel.
- `!nowplaying` (`!np`) — 📻 Show rich details and control buttons for the current track.
- `!lyrics` (`!ly`) — 🎤 Display lyrics for the current song.

### 📋 Queue Management
- `!queue` (`!q`) — 📋 View upcoming tracks.
- `!shuffle` — 🔀 Shuffle the order of upcoming songs.
- `!remove <number>` — 🗑️ Remove a song from the queue.
- `!move <from> <to>` (`!mv`) — 🔄 Reorder queue tracks.
- `!clear` — ❌ Empty the upcoming queue.

### ⚙️ Server Settings
- `!volume <0-100>` (`!vol`) — 🔊 Read or update playback volume.
- `!loop [off | song | queue]` — 🔁 Toggle loops (cycles: off → song → queue).

---

## 🐳 Deployment & Hosting 🌐

### AWS EC2 & Docker Compose (Recommended) 🚀

Host this bot concurrently alongside your other bots on a single AWS EC2 instance:

#### 1. Setup the Server 🖥️
1. Connect to your EC2 instance via SSH:
   ```bash
   ssh -i bot-key.pem ubuntu@13.212.35.227
   ```
2. Navigate to your home directory and clone the repository:
   ```bash
   cd ~
   git clone https://github.com/MacroMaster101/discord_music_bot.git
   ```
3. Navigate into the folder:
   ```bash
   cd ~/discord_music_bot
   ```
4. Initialize the environment variables:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Add your active Discord `TOKEN` and custom dashboard `ADMIN_TOKEN`. Save and exit (`Ctrl + O`, `Enter`, `Ctrl + X`).
5. Run the container cluster:
   ```bash
   docker compose up -d --build
   ```

#### 2. Configure GitHub CI/CD Pipeline 🚀
To trigger automated server deployments upon push to the `main` branch, add the following as **Repository Secrets** (**Settings** -> **Secrets and variables** -> **Actions**):
- `EC2_HOST`: `13.212.35.227`
- `EC2_USERNAME`: `ubuntu`
- `EC2_SSH_KEY`: The entire content of your private key file (`bot-key.pem`).

#### 3. Inbound Security Group Rule 🔒
In the AWS Console, edit your instance's active security group (`launch-wizard-1`):
- Add a new **Custom TCP** inbound rule for port **8082**.
- Set **Source** to `Anywhere` (`0.0.0.0/0`) or your trusted IP network.

Access the live glassmorphic dashboard at:
`http://13.212.35.227:8082`

---

### Local Setup 💻
1. Clone the repository and install dependencies:
   ```bash
   npm ci
   ```
2. Initialize environment file and add secrets:
   ```bash
   cp .env.example .env
   ```
3. Start the application:
   ```bash
   npm start
   ```

---

## 🍪 Anti-Bot & YouTube Cookies 🛡️

If YouTube begins throttling connections or throwing "Sign in to confirm you're not a bot" errors:
1. Extract your active YouTube session cookies using a browser extension (such as *Get cookies.txt LOCALLY*).
2. Save the cookies as a Netscape-format text file.
3. Encode the file content to base64 (e.g. `base64 cookies.txt`) and set it as `YTDLP_COOKIES_BASE64` in your `.env` file.

Our custom fallback engine will automatically feed these credentials to `yt-dlp` to bypass verification checks.

---

## 🏗️ Project Structure 📁

```
discord_music_bot/
├── index.js            # Bot core (commands, playback loops, button triggers)
├── server.js           # Native telemetry web server and HSL CSS dashboard interface
├── settings.js         # Settings manager with dynamic JSON path fallback
├── package.json        # Node dependency manifest
├── Dockerfile          # Multi-stage slim Docker runtime definition
├── docker-compose.yml  # Container port and volume mapping configuration
├── .env.example        # Environment variable blueprint
├── .gitignore          # Version control file filters
└── .dockerignore       # Docker context build filters
```

---

## 📄 License 📝

This project is licensed under the MIT License - see the LICENSE file for details.
