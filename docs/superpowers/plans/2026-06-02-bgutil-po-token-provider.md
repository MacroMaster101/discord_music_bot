# bgutil PO Token Provider + deno Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make YouTube extraction work reliably on the datacenter-hosted bot by giving yt-dlp a JS runtime (deno) and automatic, self-refreshing PO tokens via a bgutil sidecar service.

**Architecture:** Add a `bgutil-provider` sidecar container that mints PO tokens on demand. The bot's yt-dlp installs the bgutil yt-dlp plugin + deno, and is told (via extractor-args) the provider's base URL. yt-dlp then auto-fetches a fresh PO token per request, solving YouTube's "confirm you're not a bot" challenge without manual token/cookie babysitting.

**Tech Stack:** Docker Compose (2 services), node:22-slim base image, yt-dlp + `bgutil-ytdlp-pot-provider` plugin, deno (JS runtime), `brainicism/bgutil-ytdlp-pot-provider` provider image, youtube-dl-exec (Node wrapper).

**Verification model:** This repo has no unit-test framework; it is a Discord bot validated by running yt-dlp directly and by a live `!play`. "Tests" in this plan are real verification commands run inside the container (expecting a format table instead of a bot-check error). This is the honest equivalent of a failing→passing test for this codebase.

**Deployment model:** Changes land in `Dockerfile`, `docker-compose.yml`, `index.js`. Commit + push to `main` triggers the GitHub Actions workflow (`.github/workflows/deploy.yml`) which SSHes into the EC2 host (`54.179.1.104`) and runs `git pull && docker compose up -d --build`. The new sidecar is pulled automatically by `docker compose up`.

**Known-good facts established before this plan (do not re-litigate):**
- yt-dlp version in image: `2026.03.17`.
- Installing deno inside the container removed the "No supported JavaScript runtime" warning (proven live).
- Cookies file is valid Netscape format with auth cookies but YouTube still challenges from the EC2 IP → PO token needed.
- yt-dlp binary lives at `/usr/local/bin/yt-dlp`; the bot prefers it over the bundled one (`index.js:38-41`).
- `getYtdlpBaseOptions()` (`index.js:110-129`) builds the options object passed to youtube-dl-exec; it already conditionally appends cookies and a manual `po_token`.

---

## File Structure

- **`Dockerfile`** (modify): add deno install, install the bgutil yt-dlp plugin into yt-dlp's plugin dir, keep wget around long enough to fetch both.
- **`docker-compose.yml`** (modify): add `bgutil-provider` service; add `depends_on` + keep bot service.
- **`index.js`** (modify `getYtdlpBaseOptions`, ~lines 110-129): append the bgutil provider base URL to `extractorArgs`; add the deno JS runtime to yt-dlp options; remove/replace the manual `po_token` branch.
- **`.env.example`** (modify): document the new optional `BGUTIL_BASE_URL`, mark `YTDLP_PO_TOKEN` as legacy.

No new application source files; this is config + a small options change.

---

## Task 1: Add the bgutil-provider sidecar to docker-compose

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add the sidecar service and wire the dependency**

Replace the entire contents of `docker-compose.yml` with:

```yaml
services:
  bot:
    build: .
    container_name: discord-music-bot
    restart: unless-stopped
    depends_on:
      - bgutil-provider
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
      - ./.env:/app/.env

  bgutil-provider:
    image: brainicism/bgutil-ytdlp-pot-provider:latest
    container_name: bgutil-provider
    restart: unless-stopped
    # Provider listens on 4416 inside the compose network.
    # Not published to the host — only the bot needs to reach it.
    expose:
      - "4416"
```

- [ ] **Step 2: Validate compose file syntax (verification)**

Run (on the EC2 box, in `~/discord_music_bot` after the change is pulled — or locally if you have compose): `docker compose config`
Expected: prints the merged config with both `bot` and `bgutil-provider` services, no YAML errors.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add bgutil PO token provider sidecar to compose"
```

---

## Task 2: Install deno + bgutil yt-dlp plugin in the bot image

**Files:**
- Modify: `Dockerfile`

**Context:** yt-dlp loads plugins from `/etc/yt-dlp/plugins` (system plugin dir) or `~/.yt-dlp/plugins`. The bgutil plugin (client half) is the `bgutil-ytdlp-pot-provider` Python package providing a yt-dlp extractor plugin; it must be importable by yt-dlp. Since yt-dlp here is the standalone binary, we install the plugin as a yt-dlp plugin package into the user plugin dir using pip target, OR place the plugin source under the plugins dir. We use pip into a directory yt-dlp scans. deno is installed to `/usr/local/bin/deno`.

- [ ] **Step 1: Rewrite the Dockerfile to add deno and the plugin**

Replace the entire contents of `Dockerfile` with:

```dockerfile
FROM node:22-slim

# Install runtime tools for Discord voice playback and yt-dlp.
# python3 + pip needed to install the bgutil yt-dlp plugin; unzip for deno.
RUN apt-get update && apt-get install -y \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-pip \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install deno (JS runtime required by modern yt-dlp YouTube extraction).
RUN wget -q https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -O /tmp/deno.zip \
    && unzip -q /tmp/deno.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/deno \
    && rm /tmp/deno.zip \
    && /usr/local/bin/deno --version

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies, then remove the huge ffmpeg-static binary (~100MB)
# since we already have ffmpeg from apt-get above
RUN npm ci --omit=dev \
    && rm -rf node_modules/ffmpeg-static/ffmpeg node_modules/ffmpeg-static/ffmpeg.exe 2>/dev/null; true

# Download latest yt-dlp binary and replace the bundled one.
RUN wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && cp /usr/local/bin/yt-dlp ./node_modules/youtube-dl-exec/bin/yt-dlp

# Install the bgutil yt-dlp PO-token plugin into yt-dlp's system plugin dir.
# yt-dlp scans /etc/yt-dlp/plugins for plugin packages.
RUN pip install --no-cache-dir --break-system-packages \
        --target /etc/yt-dlp/plugins/bgutil \
        bgutil-ytdlp-pot-provider \
    && apt-get purge -y unzip && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY . .

# Start the bot
CMD ["npm", "start"]
```

- [ ] **Step 2: Note for verification (deferred to Task 4)**

The image build is verified end-to-end in Task 4 (build on the box, then run yt-dlp with the provider). No separate build test here to avoid a redundant ~2-min build.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: install deno + bgutil yt-dlp plugin in bot image"
```

---

## Task 3: Wire the provider URL + deno into yt-dlp options

**Files:**
- Modify: `index.js` (function `getYtdlpBaseOptions`, lines 110-129)
- Modify: `.env.example`

**Context:** `getYtdlpBaseOptions()` builds the options object for youtube-dl-exec. youtube-dl-exec maps camelCase keys to yt-dlp flags (`extractorArgs` → `--extractor-args`). We add the deno runtime and the bgutil base URL. The bgutil plugin reads the base URL from extractor-arg `youtube:getpot_bgutil_baseurl=<url>`. deno is passed via `--js-runtimes deno` (binary on PATH at `/usr/local/bin/deno`).

- [ ] **Step 1: Establish the failing verification (current behavior)**

Run on the EC2 box (documents the pre-fix failure):
```bash
docker compose exec bot yt-dlp \
  --cookies /app/data/cookies.txt \
  -F "https://www.youtube.com/watch?v=eXtPsLLc7qM" 2>&1 | tail -5
```
Expected (FAIL): `ERROR: [youtube] ... Sign in to confirm you're not a bot`.

- [ ] **Step 2: Modify `getYtdlpBaseOptions` in `index.js`**

Replace lines 110-129 (the whole `getYtdlpBaseOptions` function) with:

```javascript
function getYtdlpBaseOptions(playerClientOverride) {
  const playerClient = playerClientOverride || PLAYER_CLIENT_CHAINS[0];
  // bgutil PO-token provider base URL (sidecar on the compose network).
  // Override via BGUTIL_BASE_URL if the service name/port differs.
  const bgutilBaseUrl = process.env.BGUTIL_BASE_URL || 'http://bgutil-provider:4416';
  const opts = {
    noCheckCertificates: true,
    noWarnings: true,
    noPlaylist: true,
    noCheckFormats: true,
    // Modern yt-dlp YouTube extraction needs a JS runtime; deno is baked into the image.
    jsRuntimes: 'deno',
    addHeader: [
      'referer:https://www.youtube.com/',
    ],
    extractorArgs:
      `youtube:player_client=${playerClient};getpot_bgutil_baseurl=${bgutilBaseUrl}`,
  };
  if (tempCookiesPath) {
    opts.cookies = tempCookiesPath;
  }
  // Legacy manual PO token still honored if explicitly set (auto-provider preferred).
  if (YTDLP_PO_TOKEN) {
    opts.extractorArgs += `;po_token=web+${YTDLP_PO_TOKEN}`;
  }
  return opts;
}
```

- [ ] **Step 3: Document config in `.env.example`**

In `.env.example`, replace the PO-token line block:

```
# Option C: Proof-of-Origin token (advanced, see yt-dlp docs)
# YTDLP_PO_TOKEN=
```

with:

```
# Option C: Proof-of-Origin (PO) tokens.
# Preferred: an auto-provider sidecar mints these automatically — nothing to set.
# The bot defaults to the compose service at http://bgutil-provider:4416.
# Override only if you run the provider elsewhere:
# BGUTIL_BASE_URL=http://bgutil-provider:4416
# Legacy manual token (expires in hours, not recommended):
# YTDLP_PO_TOKEN=
```

- [ ] **Step 4: Commit**

```bash
git add index.js .env.example
git commit -m "feat: use bgutil provider + deno for yt-dlp youtube extraction"
```

---

## Task 4: Deploy and verify end-to-end on the EC2 host

**Files:** none (deploy + verify)

**Context:** Push triggers CI deploy. But to verify tightly, we also verify directly on the box. The bot host is `54.179.1.104`, repo at `~/discord_music_bot`, SSH key `Music-bot-key.pem`.

- [ ] **Step 1: Push to trigger deploy**

```bash
git push origin main
```
Expected: GitHub Actions "Deploy Bot to AWS EC2" runs and ends with `✅ Successfully executed commands to all host.`

- [ ] **Step 2: Confirm both containers are up (verification)**

On the box (`ssh -i Music-bot-key.pem ubuntu@54.179.1.104`, then `cd ~/discord_music_bot`):
```bash
docker compose ps
```
Expected: both `discord-music-bot` and `bgutil-provider` show `Up`.

- [ ] **Step 3: Confirm yt-dlp sees the bgutil plugin (verification)**

```bash
docker compose exec bot yt-dlp -v --print-traffic --simulate \
  "https://www.youtube.com/watch?v=eXtPsLLc7qM" 2>&1 | grep -i -m1 "bgutil\|PO Token\|getpot" || echo "PLUGIN-LINE-NOT-FOUND"
```
Expected: a line mentioning bgutil / PO Token / getpot (plugin loaded). If `PLUGIN-LINE-NOT-FOUND`, the plugin dir is wrong — see Troubleshooting.

- [ ] **Step 4: The real test — format extraction succeeds (verification)**

```bash
docker compose exec bot yt-dlp \
  --js-runtimes deno \
  --extractor-args "youtube:getpot_bgutil_baseurl=http://bgutil-provider:4416" \
  --cookies /app/data/cookies.txt \
  -F "https://www.youtube.com/watch?v=eXtPsLLc7qM" 2>&1 | tail -30
```
Expected (PASS): a **format table** (rows with `audio only`, codecs, bitrates), NO "Sign in to confirm you're not a bot".

- [ ] **Step 5: Live Discord test**

In Discord, join a voice channel and run `!play <song>`. Expected: bot joins and audio plays; dashboard "SONGS PLAYED" increments.

- [ ] **Step 6: Confirm bot logs are clean (verification)**

```bash
docker compose logs --tail=30 bot
```
Expected: `🎵 ... is online!`, no `Sign in to confirm` errors during the play.

---

## Troubleshooting (for the implementer)

- **`PLUGIN-LINE-NOT-FOUND` / plugin not loaded:** yt-dlp scans `/etc/yt-dlp/plugins/<name>/yt_dlp_plugins/...`. The pip `--target /etc/yt-dlp/plugins/bgutil` should place a `yt_dlp_plugins` package there. Verify with `docker compose exec bot ls -R /etc/yt-dlp/plugins`. If the package layout differs, instead place it at `/etc/yt-dlp/plugins/` directly (pip target = `/etc/yt-dlp/plugins`) and re-check. The plugin must expose a `yt_dlp_plugins` namespace.
- **`pip` fails with externally-managed-environment:** the `--break-system-packages` flag handles this; if pip is missing, ensure `python3-pip` installed (it is, in the Dockerfile).
- **Provider unreachable (`Connection refused` to bgutil-provider:4416):** confirm `docker compose ps` shows `bgutil-provider` Up and on the same network; `docker compose exec bot wget -qO- http://bgutil-provider:4416/ping` should respond.
- **deno not found:** `docker compose exec bot deno --version` should print 2.x. If not, the unzip path in the Dockerfile is wrong.
- **Still bot-checked with everything green:** try without cookies (`omit --cookies`) — sometimes stale cookies conflict with a fresh PO session. The provider alone often suffices.

---

## Self-Review Notes

- **Spec coverage:** deno (Task 2), bgutil sidecar (Task 1), provider URL wiring (Task 3), cookies retained (Task 3 keeps `tempCookiesPath`), verification incl. live play (Task 4) — all design points covered.
- **Type/name consistency:** `BGUTIL_BASE_URL` env + `http://bgutil-provider:4416` used identically in `index.js`, `.env.example`, and Task 4 commands; service name `bgutil-provider` consistent across compose + URL.
- **Placeholders:** none — every step has concrete file content or a concrete command + expected output.
- **Risk acknowledged:** exact yt-dlp plugin dir layout is the one uncertainty; Troubleshooting gives the fallback and the verify step (Task 4 Step 3) catches it before declaring success.
