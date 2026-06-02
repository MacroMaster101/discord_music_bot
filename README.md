# 🎵 J4FN MUSIC — Discord Music Bot 🎧

A premium, self-hostable Discord music player featuring a glassmorphic web dashboard with full remote playback controls, robust anti-bot bypass (deno + automatic PO-token provider), interactive message buttons, and automatic voice channel management. 🎧✨

![Node.js](https://img.shields.io/badge/Node.js-22.12+-339933?logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-14.x-5865F2?logo=discord&logoColor=white)
![AWS EC2](https://img.shields.io/badge/Deployed_on-AWS_EC2-FF9900?logo=amazonec2&logoColor=white)
![Docker](https://img.shields.io/badge/Containerized-Docker-2496ED?logo=docker&logoColor=white)

---

## ✨ Key Features 🚀

- 📊 **Web Dashboard** — Dark-mode dashboard with live-ticking uptime, system telemetry, real-time progress bars, and per-server configuration.
- 🎛️ **Full Web Remote** — Drive the bot from the browser: play/pause, restart, skip, stop, ±10s, **click-to-seek**, loop, shuffle, volume, queue management (reorder/remove/clear), and add songs by URL or search. All control actions are gated by an admin token.
- 🎵 **Advanced Playback** — Play via search query or direct URL (`youtube.com`, `youtu.be`, `/shorts/`, `/live/`).
- 🔍 **Interactive Search** — `!search` lets you pick from the top 5 YouTube results with Discord buttons.
- 📂 **Playlist Handler** — Queue full YouTube playlists via `!playlist`.
- 🎤 **Lyrics Lookup** — `!lyrics` fetches lyrics for the current song.
- 🎛️ **In-Chat Controls** — Tap message buttons to pause, skip, seek, adjust volume, and view the queue.
- 🤖 **Anti-Bot Bypass** — deno JS runtime + an automatic **PO-token provider** sidecar, player-client fallback chains, and optional YouTube cookies, to get past "confirm you're not a bot" blocks on datacenter IPs.
- ⏱️ **Auto Voice Manager** — Leaves empty rooms and pauses playback when alone.

---

## 🛠️ Tech Stack 📦

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| 🎙️ **Voice** | `@discordjs/voice` | Low-latency Opus audio streaming over UDP |
| 🎬 **Media Extractor** | `yt-dlp` (via `youtube-dl-exec`) | YouTube extraction with anti-bot bypass |
| 🧩 **JS Runtime** | `deno` | Required by modern yt-dlp YouTube extraction |
| 🔐 **PO Tokens** | `bgutil-ytdlp-pot-provider` (sidecar) | Auto-mints Proof-of-Origin tokens — no manual refresh |
| 🔍 **Search** | `yt-search` | YouTube search-by-keyword |
| 🎚️ **Transcoder** | system `ffmpeg` + `opusscript` | Audio transcoding + Opus encoding |
| 🖥️ **Dashboard** | Native Node.js `http` | Telemetry API, control API, and UI server |

> The Docker image installs system `ffmpeg` and removes the bundled `ffmpeg-static` binary to save space.

---

## 🎮 Command List 🎚️

Commands use your server's prefix (default: `!`).

### 🎶 Playback
- `!play <query / URL>` (`!p`) — Search and stream a song, or append to queue.
- `!search <query>` (`!sr`) — Search YouTube and choose from the top 5.
- `!playlist <URL>` (`!pl`) — Load and queue a full YouTube playlist.
- `!pause` / `!resume` (`!unpause`) — Pause / resume.
- `!skip` (`!s`) — Skip the current song.
- `!seek <time>` — Jump to a timestamp (e.g. `1:30` or `90`).
- `!stop` (`!dc`) — Clear the queue and disconnect.
- `!nowplaying` (`!np`) — Show the current track with control buttons.
- `!lyrics` (`!ly`) — Display lyrics for the current song.

### 📋 Queue
- `!queue` (`!q`) — View upcoming tracks.
- `!shuffle` — Shuffle the upcoming songs.
- `!remove <number>` — Remove a queued song.
- `!move <from> <to>` (`!mv`) — Reorder tracks.
- `!clear` — Empty the upcoming queue.

### ⚙️ Settings
- `!volume <0-100>` (`!vol`) — Read or set playback volume.
- `!loop [off | song | queue]` — Cycle loop mode.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `TOKEN` | ✅ | Discord bot token. |
| `ADMIN_TOKEN` | recommended | Protects dashboard editing **and all web playback controls**. Pick a long random string. |
| `PORT` | optional | Dashboard HTTP port (default `8080`). |
| `BGUTIL_BASE_URL` | optional | PO-token provider URL (defaults to the compose sidecar `http://bgutil-provider:4416`). |
| `YTDLP_COOKIES_PATH` / `YTDLP_COOKIES_BASE64` | optional | YouTube cookies (path or base64) to unlock login-restricted videos. |

---

## 🐳 Deployment — Docker Compose (Recommended)

The stack runs **two containers**: the bot and the `bgutil-provider` PO-token sidecar.

### 1. On your server (e.g. an Ubuntu EC2 instance)

```bash
# Install Docker + compose + git (Ubuntu)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git \
  && sudo usermod -aG docker $USER && sudo systemctl enable --now docker
# log out / back in so the docker group applies

git clone https://github.com/MacroMaster101/discord_music_bot.git ~/discord_music_bot
cd ~/discord_music_bot
mkdir -p data

cp .env.example .env
nano .env            # set TOKEN and ADMIN_TOKEN

docker compose up -d --build
docker compose logs -f      # confirm "is online!"
```

The dashboard is served on the port in `docker-compose.yml` (default `8080`). Reach it at `http://<your-server-ip>:<port>`.

### 2. Open the dashboard port

In your cloud firewall / AWS security group, add an inbound **Custom TCP** rule for the dashboard port (default **8080**). Restrict the source to your IP where possible — the dashboard's control actions are token-gated, but limiting exposure is good practice.

### 3. (Optional) GitHub Actions auto-deploy

`.github/workflows/deploy.yml` redeploys on push to `main` via SSH. Add these **Repository Secrets** (Settings → Secrets and variables → Actions):

- `EC2_HOST` — your server's public IP/DNS
- `EC2_USERNAME` — e.g. `ubuntu`
- `EC2_SSH_KEY` — the full contents of your private key (`.pem`)

---

## 💻 Local Setup

```bash
npm ci
cp .env.example .env     # add TOKEN (+ ADMIN_TOKEN)
npm start
```

> Local runs without the Docker image won't have the deno + bgutil sidecar, so YouTube extraction may hit bot-checks. Docker Compose is the supported path.

---

## 🍪 Anti-Bot, deno & PO Tokens 🛡️

Modern `yt-dlp` needs a JavaScript runtime and, on datacenter IPs, Proof-of-Origin (PO) tokens to satisfy YouTube's "confirm you're not a bot" checks. The Docker image handles both automatically:

- **deno** is installed into the image as the JS runtime.
- The **`bgutil-provider`** sidecar mints PO tokens on demand; the bot passes its URL to yt-dlp via `youtubepot-bgutilhttp:base_url`. No manual token refresh required.

For login-restricted videos you can additionally supply YouTube cookies:

1. Export your YouTube session cookies in **Netscape format** (e.g. the *Get cookies.txt LOCALLY* browser extension).
2. Either place the file at `data/cookies.txt` and set `YTDLP_COOKIES_PATH=/app/data/cookies.txt`, or base64-encode it and set `YTDLP_COOKIES_BASE64`.

> Tip: use a throwaway Google account for cookies — heavy datacenter usage can get an account flagged.

---

## 🏗️ Project Structure 📁

```
discord_music_bot/
├── index.js              # Bot core: commands, playback, queue, control cores, buttons
├── server.js             # Dashboard HTTP server: telemetry + control API + UI
├── settings.js           # Per-guild + global settings manager (JSON-backed)
├── package.json          # Dependencies
├── Dockerfile            # Bot image: ffmpeg, deno, yt-dlp, bgutil plugin
├── docker-compose.yml    # bot + bgutil-provider sidecar, ports & volumes
├── .env.example          # Environment variable template
├── .github/workflows/    # CI/CD deploy workflow
├── .gitignore
└── .dockerignore
```

---

## 📄 License

MIT — see the LICENSE file.
