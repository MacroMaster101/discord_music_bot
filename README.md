# 🎵 Discord Music Bot 🎧

A premium, self-hostable Discord music player featuring a glassmorphic web dashboard with full remote playback controls, resilient yt-dlp extraction (Node + automatic PO-token provider), interactive message buttons, and automatic voice channel management. 🎧✨

![Node.js](https://img.shields.io/badge/Node.js-22.12+-339933?logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-14.x-5865F2?logo=discord&logoColor=white)
![AWS EC2](https://img.shields.io/badge/Deployed_on-AWS_EC2-FF9900?logo=amazonec2&logoColor=white)
![Docker](https://img.shields.io/badge/Containerized-Docker-2496ED?logo=docker&logoColor=white)

---

## ✨ Key Features 🚀

- 📊 **Public Status Dashboard** — A public-safe status page with bot health, aggregate reach, active track titles, live progress, rolling activity graphs, joined communities showcase, and a least-privilege Discord install flow at `/invite`. Internal Discord server snowflake IDs, voice channels, users, queues, logs, and system telemetry remain strictly protected.
- 🔐 **Protected Admin Console** — Cloudflare Access protects playback controls, queues, command logs, runtime telemetry, persistent Discord presence editing, and global/per-server settings CRUD; a server-side token remains available for local/recovery access.
- 🎛️ **Full Web Remote** — Drive the bot from the browser: play/pause, restart, skip, stop, ±10s, **click-to-seek**, loop, shuffle, volume, queue management (reorder/remove/clear), and add songs by URL or search.
- 🎵 **Advanced Playback** — Play via search query or direct URL (`youtube.com`, `youtu.be`, `/shorts/`, `/live/`).
- 🔍 **Interactive Search** — `!search` lets you pick from the top 5 YouTube results with Discord buttons.
- 📂 **Playlist Handler** — Queue full YouTube playlists via `!playlist`.
- 🎤 **Lyrics Lookup** — `!lyrics` fetches lyrics for the current song.
- 🎛️ **In-Chat Controls** — Tap message buttons to pause, skip, seek, adjust volume, and view the queue.
- 🤖 **Playback Resilience** — Node JS runtime + an automatic **PO-token provider** sidecar, player-client fallback chains, and optional YouTube cookies for restricted playback environments.
- ⏱️ **Auto Voice Manager** — Leaves empty rooms and pauses playback when alone.

---

## 🛠️ Tech Stack 📦

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| 🎙️ **Voice** | `@discordjs/voice` | Low-latency Opus audio streaming over UDP |
| 🎬 **Media Extractor** | `yt-dlp` (via `youtube-dl-exec`) | YouTube extraction with anti-bot bypass |
| 🧩 **JS Runtime** | Node.js | Used by modern yt-dlp YouTube extraction |
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
| `ADMIN_TOKEN` | ✅ for recovery | Local/emergency fallback for `/api/admin/*`. Cloudflare Access-authenticated tunnel requests enter automatically. Use a long, unique value and never commit it. |
| `PORT` | optional | Dashboard HTTP port (default `8080`). |
| `DASHBOARD_BIND_ADDRESS` | optional | Host bind address for port `8080`; use `127.0.0.1` with Cloudflare Tunnel. |
| `COMPOSE_PROFILES` | tunnel only | Set to `tunnel` to start the `cloudflared` sidecar. |
| `TUNNEL_TOKEN` | tunnel only | Raw token for a remotely-managed Cloudflare Tunnel. Never commit it. |
| `BGUTIL_BASE_URL` | optional | PO-token provider URL (defaults to the compose sidecar `http://bgutil-provider:4416`). |
| `YTDLP_COOKIES_PATH` / `YTDLP_COOKIES_BASE64` | optional | YouTube cookies (path or base64) to unlock login-restricted videos. |

---

## 🐳 Deployment — Docker Compose (Recommended)

The base stack runs **two containers**: the bot and the `bgutil-provider` PO-token sidecar. Enabling the `tunnel` profile adds a `cloudflared` sidecar.

### 1. On your server (e.g. an Ubuntu EC2 instance)

```bash
# Install Docker + compose + git (Ubuntu)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git \
  && sudo usermod -aG docker $USER && sudo systemctl enable --now docker
# log out / back in so the docker group applies

git clone https://github.com/<your-username>/discord_music_bot.git ~/discord_music_bot
cd ~/discord_music_bot
mkdir -p data

cp .env.example .env
nano .env            # set TOKEN and ADMIN_TOKEN

docker compose up -d --build
docker compose logs -f      # confirm "is online!"
```

The dashboard is served on port `8080`. Direct IP access should be used only during initial setup; the production setup below publishes it through Cloudflare Tunnel.

### 2. Publish the dashboard securely with Cloudflare Tunnel

1. Add your domain to Cloudflare and wait until its status is **Active**.
2. In Cloudflare, go to **Networking → Tunnels**, create a remotely-managed tunnel named `music-dashboard-tunnel`, and copy only its raw token.
3. Add a published-application route with your chosen hostname (e.g. `music.example.com`) and service URL `http://bot:8080`.
4. Create a Cloudflare Access self-hosted application for the same hostname, but protect **only** these four destinations (replacing `music.example.com` with your hostname):
   - `music.example.com/admin`
   - `music.example.com/admin/*`
   - `music.example.com/api/admin`
   - `music.example.com/api/admin/*`
5. Remove any existing blank-path/whole-host destination for your hostname; otherwise Cloudflare will also require login for the public `/` page and `/api/public/*` APIs.
6. Use an **Allow** policy containing only exact administrator email addresses. Do not use `Everyone`. Keep the application session short enough for your team (for example, 24 hours).
7. Add the raw tunnel token as the GitHub Actions secret `CLOUDFLARE_TUNNEL_TOKEN`, then deploy `main`.

Cloudflare path wildcards do not include the parent path, which is why both `admin` and `admin/*` are listed. The tunnel route should use origin service URL `http://bot:8080`; public HTTPS terminates at Cloudflare, so the private Docker-network hop correctly remains HTTP.

The workflow stores the token only in the EC2 `.env`, enables the `tunnel` Compose profile, binds host port `8080` to localhost, waits for the bot dashboard health check, and starts `cloudflared`. After `https://music.example.com` is verified, remove the AWS security-group inbound rule for TCP `8080`. Keep `ADMIN_TOKEN` as a local recovery fallback.

### Dashboard routes and privacy boundary

| Route | Audience | Contents |
| :--- | :--- | :--- |
| `/` | Public | Aggregate service status, active song titles/progress, graphs, and commands |
| `/api/public/status` | Public | Public-safe current snapshot |
| `/api/public/history` | Public | In-memory aggregate chart history |
| `/healthz` | Public/monitor | Minimal bot readiness result |
| `/invite` | Public | Discord server-install redirect with the bot's required permissions |
| `/admin/` | Cloudflare Access admins | Admin user interface |
| `/api/admin/*` | Cloudflare Access admin or recovery `ADMIN_TOKEN` | Guilds, controls, queues, logs, telemetry, Discord presence, and settings CRUD |

The public payload is covered by an automated privacy regression test. Access-authenticated tunnel requests are recognized from Cloudflare's identity and assertion headers. The optional recovery token is sent as a bearer token and retained only in browser `sessionStorage`, so closing the tab/session clears it. Keep the origin bound to localhost and reachable only through the Tunnel.

### 3. (Optional) GitHub Actions auto-deploy

`.github/workflows/deploy.yml` redeploys on push to `main` via SSH. Add these **Repository Secrets** (Settings → Secrets and variables → Actions):

- `EC2_HOST` — your server's public IP/DNS
- `EC2_USERNAME` — e.g. `ubuntu`
- `EC2_SSH_KEY` — the full contents of your private key (`.pem`)
- `CLOUDFLARE_TUNNEL_TOKEN` — raw token copied from the tunnel installation command

---

## 💻 Local Setup

```bash
npm ci
cp .env.example .env     # add TOKEN (+ ADMIN_TOKEN)
npm start
```

Verify changes before deployment:

```bash
npm run check
npm test
```

> Local runs without the Docker image won't have the configured Node runtime + bgutil sidecar, so YouTube extraction may hit bot-checks. Docker Compose is the supported path.

---

## 🍪 Playback Authentication & PO Tokens 🛡️

Modern `yt-dlp` needs a JavaScript runtime and, on datacenter IPs, Proof-of-Origin (PO) tokens to satisfy YouTube's "confirm you're not a bot" checks. The Docker image handles both automatically:

- **Node.js** is used as the JS runtime.
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
├── web/                  # Public status and protected admin dashboard assets
├── test/                 # Dashboard auth/privacy/API regression tests
├── package.json          # Dependencies
├── Dockerfile            # Bot image: ffmpeg, yt-dlp, bgutil plugin
├── docker-compose.yml    # bot + bgutil-provider + optional tunnel sidecar
├── .env.example          # Environment variable template
├── .github/workflows/    # CI/CD deploy workflow
├── .gitignore
└── .dockerignore
```

---

## 📄 License

MIT — see the LICENSE file.
