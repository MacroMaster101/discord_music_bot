FROM node:22-slim

# Install runtime tools for Discord voice playback and yt-dlp.
RUN apt-get update && apt-get install -y \
    build-essential \
    ca-certificates \
    ffmpeg \
    python3 \
    wget \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies, then remove the huge ffmpeg-static binary (~100MB)
# since we already have ffmpeg from apt-get above
RUN npm ci --omit=dev \
    && node -e "require('@discordjs/opus')" \
    && rm -rf node_modules/ffmpeg-static/ffmpeg node_modules/ffmpeg-static/ffmpeg.exe

# yt-dlp recommends the nightly channel for site breakages. Install its portable
# binary and replace the older binary bundled by youtube-dl-exec.
RUN wget -q https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && cp /usr/local/bin/yt-dlp ./node_modules/youtube-dl-exec/bin/yt-dlp

# Install the exact bgutil plugin release used by the Compose sidecar. The
# portable yt-dlp binary does not discover arbitrary pip site-packages, but it
# does discover plugin archives in this standard system plugin directory.
ARG BGUTIL_VERSION=1.3.1
RUN mkdir -p /etc/yt-dlp/plugins \
    && wget -q "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${BGUTIL_VERSION}/bgutil-ytdlp-pot-provider.zip" \
        -O /etc/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip \
    && unzip -l /etc/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip | grep -q 'yt_dlp_plugins/' \
    && apt-get purge -y build-essential unzip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy application files
COPY . .

# Start the bot
CMD ["npm", "start"]
