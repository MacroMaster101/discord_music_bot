FROM node:22-slim

# Install runtime tools for Discord voice playback and yt-dlp.
RUN apt-get update && apt-get install -y \
    ca-certificates \
    ffmpeg \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Start the bot
CMD ["npm", "start"]
