# Self-hosting guide

How to run your own copy of the bot and its web dashboard. If you just want to use the bot, see the [README](README.md).

---

## How it fits together

| Part | What it does |
| :--- | :--- |
| `index.js` | The bot: commands, buttons, queue, playback, Spotify links, resume after restart |
| `server.js` | Web dashboard: public status page, admin console, APIs |
| `spotify.js` | Spotify link parsing, Web API client, playlist reader, YouTube matching |
| `resume.js` | Saves queues on shutdown and restores them on the next start |
| `slash-commands.js` | Slash command definitions (registered on startup only when they change) |
| `settings.js` | Global and per-server settings (JSON in `data/`) |
| `web/` | Dashboard pages, scripts, and styles |
| `test/` | Automated tests (`npm test`) |

The Docker Compose stack runs **two containers**: the bot and `bgutil-provider`, which supplies YouTube PO tokens. The optional `tunnel` profile adds a `cloudflared` container for Cloudflare Tunnel.

| Component | Technology |
| :--- | :--- |
| Voice | `@discordjs/voice` (Opus over UDP) |
| YouTube audio | `yt-dlp` nightly + `ffmpeg` |
| PO tokens | `bgutil-ytdlp-pot-provider` sidecar |
| Search | `yt-search` |
| Dashboard | Node.js `http`, no framework |

---

## Configuration

Copy `.env.example` to `.env` and fill it in. `.env` is never committed.

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `TOKEN` | ✅ | Discord bot token. |
| `ADMIN_TOKEN` | ✅ | Recovery sign-in for the admin console (`/login` → token). At least 24 random characters. |
| `PORT` | optional | Dashboard port (default `8080`). |
| `DASHBOARD_BIND_ADDRESS` | optional | Host address for the dashboard port; use `127.0.0.1` behind Cloudflare Tunnel. |
| `COMPOSE_PROFILES` / `TUNNEL_TOKEN` | tunnel only | `COMPOSE_PROFILES=tunnel` starts `cloudflared` with the tunnel's raw token. |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | recommended | Your Zero Trust team domain (`myteam.cloudflareaccess.com`) and the Access application's **AUD tag**. When set, admin sign-ins are verified by JWT signature, audience, issuer, and expiry. When unset, Access headers are trusted and a warning is logged. |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | optional | Spotify track and album links. Create an app at the [Spotify developer dashboard](https://developer.spotify.com/dashboard) (Web API only); since February 2026 the app owner needs Spotify Premium. Playlist links work without these. |
| `PRESENCE_STREAM_URL` | optional | Link behind the purple **Streaming** status while music plays. Must be a Twitch channel or YouTube video URL (default `https://www.twitch.tv/discord`). Never a song link: the status is visible in every server. |
| `FORMSPREE_FORM_ID` | optional | Turns on the public **Report a bug** button. Only the ID after `/f/` in the [Formspree](https://formspree.io) endpoint. Turn reCAPTCHA off and leave domain restrictions empty in the form's settings, because the server sends the reports. |
| `BGUTIL_BASE_URL` | optional | PO-token provider URL (default `http://bgutil-provider:4416`). |
| `YTDLP_COOKIES_PATH` / `YTDLP_COOKIES_BASE64` | optional | YouTube cookies for login-restricted videos (see below). |
| `YTDLP_MAX_CONCURRENT` | optional | How many YouTube lookups may run at once (default `2`). Raise it on a server with more CPU. |
| `VM_MEMORY_MB` | optional | Memory ceiling shown in the admin console (default `2048`). |

### Changing `.env` on a running server

The bot reads `.env` when its container starts. Editors and `sed -i` often save by replacing the file, and a running container keeps seeing the old copy, so after editing `.env` by hand run:

```bash
docker compose up -d --force-recreate bot
```

Deploys already recreate the containers.

---

## Running with Docker Compose

On an Ubuntu server (for example AWS EC2):

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git \
  && sudo usermod -aG docker $USER && sudo systemctl enable --now docker
# log out and back in so the docker group applies

git clone https://github.com/<your-username>/discord_music_bot.git ~/discord_music_bot
cd ~/discord_music_bot
mkdir -p data
cp .env.example .env
nano .env            # set TOKEN and ADMIN_TOKEN at least

docker compose up -d --build
docker compose logs -f bot    # wait for "is online!"
```

The dashboard listens on port `8080`. Use direct IP access only while setting up; publish it through Cloudflare Tunnel for real use.

### Music keeps playing through restarts

When Docker stops the bot (a deploy, `docker compose restart`, a server reboot), the bot saves every server's queue, song position, loop mode, volume, and history to `data/resume.json`. On the next start it rejoins voice channels that still have listeners and continues from the same spot, posting "Back after a quick update" in the music channel. Saves older than 15 minutes are ignored. The bot gets 20 seconds to save (`stop_grace_period` in `docker-compose.yml`).

---

## Publishing the dashboard with Cloudflare Tunnel

1. Add your domain to Cloudflare and wait until it is **Active**.
2. **Networking → Tunnels**: create a remotely-managed tunnel and copy its raw token.
3. Add a published-application route for your hostname (for example `music.example.com`) with service URL `http://bot:8080`.
4. Create a Cloudflare Access self-hosted application for the same hostname that protects **only** these paths:
   - `music.example.com/admin`
   - `music.example.com/admin/*`
   - `music.example.com/api/admin`
   - `music.example.com/api/admin/*`
5. Remove any whole-host destination for the hostname, or the public page will require a login too.
6. Use an **Allow** policy with exact administrator email addresses (never `Everyone`) and a short session, such as 24 hours.
7. Put the application's **AUD tag** and your team domain in `.env` as `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN`.
8. Add the tunnel token as the GitHub Actions secret `CLOUDFLARE_TUNNEL_TOKEN` and deploy.

Cloudflare path wildcards don't include the parent path, which is why both `admin` and `admin/*` are listed. Public HTTPS ends at Cloudflare; the hop to `http://bot:8080` stays inside the Docker network. Once the hostname works, remove any firewall rule that exposes port `8080`.

### Dashboard routes

| Route | Who | What |
| :--- | :--- | :--- |
| `/` | Everyone | Status page: bot health, what's playing, activity charts, servers, commands |
| `/api/public/status`, `/api/public/history` | Everyone | Data for the status page (no channel, member, or queue details) |
| `/api/public/bug-report` | Everyone (POST) | Bug reports relayed to Formspree; same-site JSON only, spam-filtered, 3 per visitor per 10 minutes |
| `/healthz` | Monitors | Bot readiness |
| `/invite` | Everyone | Discord install link with the bot's required permissions |
| `/admin/`, `/api/admin/*` | Cloudflare Access admins | Admin console: controls, queues, logs, settings, bot status text |
| `/login`, `/console/`, `/console/api/*` | `ADMIN_TOKEN` holders | Same console for token sign-in; failed attempts lock out an address for 15 minutes after 6 tries |

The privacy of the public data is covered by automated tests.

---

## Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs the checks and tests, then deploys to the server over SSH on every push to `main`. Add these repository secrets (**Settings → Secrets and variables → Actions**):

- `EC2_HOST`: server IP or hostname
- `EC2_USERNAME`: for example `ubuntu`
- `EC2_SSH_KEY`: the private key (`.pem`) contents
- `CLOUDFLARE_TUNNEL_TOKEN`: the tunnel token
- `YTDLP_COOKIES_BASE64` (optional): base64 YouTube cookies

`main` is protected: changes arrive through pull requests from `dev`, and the `test` check must pass.

---

## YouTube playback reliability

Modern `yt-dlp` needs a JavaScript runtime and, on datacenter IPs, Proof-of-Origin (PO) tokens. The Docker image uses Node.js as the runtime, and the `bgutil-provider` container mints PO tokens automatically.

For login-restricted videos you can add YouTube cookies:

1. Export cookies in **Netscape format** (for example with the *Get cookies.txt LOCALLY* extension). Use a throwaway Google account; heavy server use can get an account flagged.
2. Put the file at `data/cookies.txt` (`YTDLP_COOKIES_PATH=/app/data/cookies.txt`), or base64-encode it into `YTDLP_COOKIES_BASE64`.

---

## Spotify details

Spotify doesn't allow bots to stream its audio, so the bot uses Spotify only for song details and plays the matching YouTube audio:

- **Tracks and albums** come from the Spotify Web API (client credentials).
- **Playlists** come from Spotify's public embed player, because the Web API stopped exposing playlists to bots in February 2026. No credentials are needed, but it's unofficial: if Spotify changes that page, playlist links stop working until the bot is updated.
- Just before each song plays, the bot searches YouTube for "artist title" and picks the closest-length result, preferring official audio and skipping live, cover, and remix versions the title doesn't ask for.

---

## Local development

```bash
npm ci
cp .env.example .env     # TOKEN, ADMIN_TOKEN
npm start
```

Before opening a pull request:

```bash
npm run check
npm test
```

Local runs need `ffmpeg` and an up-to-date `yt-dlp` on your PATH, and they don't have the PO-token provider, so YouTube may occasionally refuse a stream that production handles. Docker Compose is the supported way to run the bot.
