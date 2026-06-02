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
