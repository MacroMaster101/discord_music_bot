require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
  StreamType,
} = require('@discordjs/voice');

const ytSearch = require('yt-search');
const youtubedl = require('youtube-dl-exec');

const PREFIX = process.env.PREFIX || '!';
const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const IDLE_DISCONNECT_MS = 10000;
const ERROR_DISCONNECT_MS = 5000;
const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || process.env.YTDLP_COOKIES;
const YTDLP_COOKIES_BASE64 = process.env.YTDLP_COOKIES_BASE64;
const YTDLP_PO_TOKEN = process.env.YTDLP_PO_TOKEN;
const VOICE_STATUS_ROUTE = (channelId) => `/channels/${channelId}/voice-status`;
let nextSongId = 1;
let tempCookiesPath = null;

// Player client fallback chains — tried in order when YouTube blocks a request
const PLAYER_CLIENT_CHAINS = [
  'web_safari,web_embedded,default',
  'mweb,default',
  'tv_simply,default,-tv',
  'web,default',
];

if (!TOKEN) {
  console.error('Missing Discord bot token. Set TOKEN in your environment.');
  process.exit(1);
}

// Resolve cookies file for yt-dlp
function resolveCookiesPath() {
  if (YTDLP_COOKIES_PATH && fs.existsSync(YTDLP_COOKIES_PATH)) {
    return YTDLP_COOKIES_PATH;
  }
  if (YTDLP_COOKIES_BASE64) {
    const tmpDir = os.tmpdir();
    const cookiesFile = path.join(tmpDir, 'ytdlp_cookies.txt');
    fs.writeFileSync(cookiesFile, Buffer.from(YTDLP_COOKIES_BASE64, 'base64'));
    return cookiesFile;
  }
  return null;
}

tempCookiesPath = resolveCookiesPath();
if (tempCookiesPath) {
  console.log(`\u{1F36A} Using cookies file: ${tempCookiesPath}`);
}

function getYtdlpBaseOptions(playerClientOverride) {
  const playerClient = playerClientOverride || PLAYER_CLIENT_CHAINS[0];
  const opts = {
    noCheckCertificates: true,
    noWarnings: true,
    noPlaylist: true,
    preferFreeFormats: true,
    addHeader: [
      'referer:https://www.youtube.com/',
      'user-agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
    ],
    extractorArgs: `youtube:player_client=${playerClient}`,
  };
  if (tempCookiesPath) {
    opts.cookies = tempCookiesPath;
  }
  if (YTDLP_PO_TOKEN) {
    opts.extractorArgs += `;po_token=web+${YTDLP_PO_TOKEN}`;
  }
  return opts;
}

async function setVoiceChannelStatus(channelId, status) {
  try {
    await client.rest.put(VOICE_STATUS_ROUTE(channelId), {
      body: { status: status || '' },
    });
  } catch (err) {
    console.warn('Could not set voice channel status:', err.message || err);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queue = new Map();

client.once('ready', async () => {
  console.log(`🎵 ${client.user.tag} is online!`);
  updatePresence();

  // Reset bot nickname in all guilds to the original app name
  for (const [, guild] of client.guilds.cache) {
    try {
      const me = guild.members.me || await guild.members.fetchMe();
      if (me.nickname) {
        await me.setNickname(null, 'Bot startup: reset nickname');
        console.log(`Reset nickname in ${guild.name}`);
      }
    } catch (err) {
      console.warn(`Could not reset nickname in ${guild.name}:`, err.message);
    }
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  // Check if bot was disconnected by someone
  if (oldState.id === client.user?.id && oldState.channelId && !newState.channelId) {
    const serverQueue = queue.get(oldState.guild.id);
    if (serverQueue) {
      console.log('🔴 Bot was disconnected, stopping playback');
      teardownQueue(oldState.guild.id, serverQueue, false);
    }
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  try {
    if (command === 'play') await execute(message, serverQueue, args);
    else if (command === 'skip') skip(message, serverQueue);
    else if (command === 'stop') stop(message, serverQueue);
    else if (command === 'queue') showQueue(message, serverQueue);
  } catch (err) {
    console.error('Error:', err);
    message.reply('⚠️ Something went wrong!');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() || !interaction.guild) return;

  const serverQueue = queue.get(interaction.guild.id);
  const memberVoiceChannel = interaction.member?.voice?.channel;

  if (!serverQueue) {
    return interaction.reply({
      content: '❌ Nothing is playing!',
      ephemeral: true,
    });
  }

  if (!memberVoiceChannel || memberVoiceChannel.id !== serverQueue.voiceChannel.id) {
    return interaction.reply({
      content: '❌ Join the same voice channel as the bot to use these controls.',
      ephemeral: true,
    });
  }

  if (interaction.customId === 'music_skip') {
    skipQueue(serverQueue);
    return interaction.reply('⏭️ Skipped!');
  }

  if (interaction.customId === 'music_stop') {
    stopQueue(interaction.guild.id, serverQueue);
    await interaction.update({
      components: [createMusicControls(null, { disabled: true })],
    });
    return interaction.followUp('⏹️ Stopped!');
  }

  if (interaction.customId === 'music_queue') {
    return interaction.reply({
      content: getQueueText(serverQueue),
      ephemeral: true,
    });
  }

  if (interaction.customId.startsWith('music_next:')) {
    const songId = interaction.customId.split(':')[1];
    const result = moveSongNext(serverQueue, songId);

    if (!result.song) {
      return interaction.reply({
        content: '❌ That song is no longer in the queue.',
        ephemeral: true,
      });
    }

    if (result.status === 'playing') {
      return interaction.reply({
        content: '▶️ That song is already playing.',
        ephemeral: true,
      });
    }

    await interaction.update({
      components: [createMusicControls(songId, { playNextDisabled: true })],
    });

    skipQueue(serverQueue);
    return interaction.followUp(`▶️ Starting next: **${result.song.title}**`);
  }
});

async function execute(message, serverQueue, args) {
  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.reply('❌ You need to be in a voice channel!');
  if (!args.length) return message.reply(`Usage: \`${PREFIX}play <song name or URL>\``);

  let song;
  const searchText = args.join(' ');

  try {
    // Check if URL or search
    if (isUrl(searchText)) {
      song = await getSongFromUrl(searchText);
    } else {
      const searchResult = await ytSearch(searchText);
      const video = searchResult.videos[0];
      if (!video) return message.reply('❌ No results found!');
      song = {
        id: createSongId(),
        title: video.title,
        url: video.url,
        streamUrl: null,
      };
    }
  } catch (err) {
    console.error('Search error:', err);
    return message.reply('❌ Could not find that song!');
  }

  if (!serverQueue) {
    const queueConstruct = {
      textChannel: message.channel,
      voiceChannel,
      connection: null,
      currentProcess: null,
      currentSongId: null,
      advancingSongId: null,
      idleTimeout: null,
      stopped: false,
      player: createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
      }),
      songs: [song],
    };

    queue.set(message.guild.id, queueConstruct);

    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      queueConstruct.connection = connection;
      
      // Handle connection errors
      connection.on('error', (error) => {
        console.error('Voice connection error:', error);
        message.channel.send('❌ Voice connection error! Trying to reconnect...');
      });

      connection.on('stateChange', (oldState, newState) => {
        console.log(`Connection state: ${oldState.status} -> ${newState.status}`);
        if (newState.status === 'disconnected') {
          // Only reconnect if queue still exists (not manually disconnected)
          const serverQueue = queue.get(message.guild.id);
          if (serverQueue && serverQueue.songs.length > 0) {
            console.log('Reconnecting...');
            setTimeout(() => connection.rejoin(), 500);
          }
        }
      });

      connection.subscribe(queueConstruct.player);

      queueConstruct.player.on('stateChange', (oldState, newState) => {
        console.log(`Player state: ${oldState.status} -> ${newState.status}`);
      });

      queueConstruct.player.on(AudioPlayerStatus.Idle, async () => {
        if (queueConstruct.stopped) return;
        console.log('Song finished, checking queue...');
        advanceQueue(message.guild.id, queueConstruct, false);
      });

      queueConstruct.player.on('error', async (error) => {
        if (queueConstruct.stopped) return;
        console.error('Player error:', error.message);
        message.channel.send(`❌ Playback error, skipping...`);
        advanceQueue(message.guild.id, queueConstruct, true);
      });

      await playSong(message.guild.id, song);
    } catch (err) {
      console.error('Connection error:', err);
      queue.delete(message.guild.id);
      return message.reply('❌ Could not join voice channel! Make sure the bot has proper permissions.');
    }
  } else {
    serverQueue.stopped = false;
    clearIdleDisconnect(serverQueue);

    const shouldStartNow = serverQueue.songs.length === 0;
    serverQueue.songs.push(song);
    if (shouldStartNow) {
      await playSong(message.guild.id, song);
      return;
    }

    return message.reply({
      content: `➕ Added to queue: **${song.title}**`,
      components: [createMusicControls(song.id)],
    });
  }
}

function createSongId() {
  nextSongId += 1;
  return nextSongId.toString();
}

function isUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeMediaUrl(input) {
  const url = new URL(input);

  if (url.hostname === 'youtu.be') {
    const videoId = url.pathname.split('/').filter(Boolean)[0];
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  }

  if (url.hostname.endsWith('youtube.com')) {
    const videoId = url.searchParams.get('v');
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;

    const pathParts = url.pathname.split('/').filter(Boolean);
    if ((pathParts[0] === 'live' || pathParts[0] === 'shorts') && pathParts[1]) {
      return `https://www.youtube.com/watch?v=${pathParts[1]}`;
    }
  }

  return input;
}

async function getSongFromUrl(input) {
  const url = normalizeMediaUrl(input);

  for (let i = 0; i < PLAYER_CLIENT_CHAINS.length; i++) {
    try {
      const videoInfo = await youtubedl(url, {
        ...getYtdlpBaseOptions(PLAYER_CLIENT_CHAINS[i]),
        dumpSingleJson: true,
        skipDownload: true,
      });

      return {
        id: createSongId(),
        title: videoInfo.title || url,
        url: videoInfo.webpage_url || videoInfo.original_url || url,
        streamUrl: getBestAudioUrl(videoInfo),
      };
    } catch (err) {
      const errMsg = (err?.stderr || err?.message || '').toLowerCase();
      const isBlockedError = errMsg.includes('sign in') || errMsg.includes('not a bot') || errMsg.includes('403');

      if (isBlockedError && i < PLAYER_CLIENT_CHAINS.length - 1) {
        console.warn(`Client chain "${PLAYER_CLIENT_CHAINS[i]}" blocked for ${url}, trying next...`);
        continue;
      }

      console.warn(`Metadata lookup failed for ${url}:`, err.message || err);
    }
  }

  return {
    id: createSongId(),
    title: url,
    url,
    streamUrl: null,
  };
}

function getBestAudioUrl(info) {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const audioFormats = formats
    .filter((format) => format.url && format.acodec && format.acodec !== 'none' && (!format.vcodec || format.vcodec === 'none'))
    .sort((a, b) => {
      const aScore = (a.abr || a.tbr || 0) + (a.ext === 'webm' ? 1000 : 0);
      const bScore = (b.abr || b.tbr || 0) + (b.ext === 'webm' ? 1000 : 0);
      return bScore - aScore;
    });

  return audioFormats[0]?.url || info?.url || null;
}

function createMusicControls(playNextSongId, options = {}) {
  const buttons = [];

  if (playNextSongId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`music_next:${playNextSongId}`)
        .setLabel('Play Now')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(options.disabled || options.playNextDisabled || false)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId('music_skip')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(options.disabled || false),
    new ButtonBuilder()
      .setCustomId('music_queue')
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(options.disabled || false),
    new ButtonBuilder()
      .setCustomId('music_stop')
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(options.disabled || false)
  );

  return new ActionRowBuilder().addComponents(buttons);
}

function moveSongNext(serverQueue, songId) {
  const songIndex = serverQueue.songs.findIndex((song) => song.id === songId);
  if (songIndex === -1) return { status: 'missing', song: null };

  const song = serverQueue.songs[songIndex];
  if (songIndex === 0) return { status: 'playing', song };
  if (songIndex === 1) return { status: 'already_next', song };

  serverQueue.songs.splice(songIndex, 1);
  serverQueue.songs.splice(1, 0, song);
  return { status: 'moved', song };
}

async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue || !song) return;

  try {
    clearIdleDisconnect(serverQueue);
    cleanupCurrentProcess(serverQueue);
    serverQueue.currentSongId = song.id;
    serverQueue.advancingSongId = null;

    const audioUrl = song.streamUrl || await getAudioUrl(song.url);

    if (!audioUrl) {
      throw new Error('yt-dlp did not return an audio URL');
    }

    const ffmpeg = spawn('ffmpeg', [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', audioUrl,
      '-analyzeduration', '0',
      '-loglevel', 'warning',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    ], {
      windowsHide: true,
    });

    serverQueue.currentProcess = ffmpeg;

    let ffmpegError = '';
    ffmpeg.stderr.on('data', (chunk) => {
      ffmpegError += chunk.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code && code !== 0) {
        console.error(`FFmpeg exited with code ${code}:`, ffmpegError.trim());
      }
    });

    ffmpeg.on('error', (err) => {
      console.error('Could not start FFmpeg:', err.message || err);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: true,
      metadata: {
        title: song.title,
      },
    });
    
    resource.volume?.setVolume(0.5);
    serverQueue.player.play(resource);
    updatePresence(true);
    setVoiceChannelStatus(serverQueue.voiceChannel.id, `🎵 ${song.title}`);
    serverQueue.textChannel.send({
      content: `▶️ Now playing: **${song.title}**`,
      components: [createMusicControls()],
    });
    console.log(`▶️ Playing: ${song.title}`);
    return true;
  } catch (err) {
    const technicalReason = getTechnicalErrorMessage(err);
    const publicReason = getPublicPlayErrorMessage(technicalReason);
    console.error('Play error:', technicalReason);
    cleanupCurrentProcess(serverQueue);
    if (serverQueue.songs.length > 1) {
      serverQueue.textChannel.send(`⚠️ I couldn't play that track. ${publicReason} Trying the next song...`);
    }
    advanceQueue(guildId, serverQueue, true, publicReason);
    return false;
  }
}

function getTechnicalErrorMessage(err) {
  const rawMessage = (err?.stderr || err?.message || String(err)).trim();
  const firstUsefulLine = rawMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('WARNING:'));

  const message = firstUsefulLine || rawMessage || 'Unknown playback error';
  return message.length > 1000 ? `${message.slice(0, 997)}...` : message;
}

function getPublicPlayErrorMessage(reason) {
  const message = reason.toLowerCase();

  if (message.includes('sign in to confirm') || message.includes('not a bot')) {
    return 'YouTube blocked this request for bot verification. Please try a different video or search term.';
  }

  if (message.includes('private video')) {
    return 'That video is private.';
  }

  if (message.includes('unavailable')) {
    return 'That video is unavailable from the bot server.';
  }

  if (message.includes('age-restricted') || message.includes('age restricted')) {
    return 'That video is age restricted.';
  }

  if (message.includes('copyright') || message.includes('blocked')) {
    return 'That video is blocked for playback.';
  }

  if (message.includes('did not return an audio url') || message.includes('requested format is not available')) {
    return 'I could not get a playable audio stream for that track.';
  }

  if (message.includes('ffmpeg')) {
    return 'The audio stream failed while starting.';
  }

  return 'Please try another link or song name.';
}

async function getAudioUrl(url) {
  for (let i = 0; i < PLAYER_CLIENT_CHAINS.length; i++) {
    try {
      const info = await youtubedl(url, {
        ...getYtdlpBaseOptions(PLAYER_CLIENT_CHAINS[i]),
        dumpSingleJson: true,
      });

      const audioUrl = getBestAudioUrl(info);
      if (audioUrl) return audioUrl;

      console.warn(`No audio URL from client chain "${PLAYER_CLIENT_CHAINS[i]}" for ${url}`);
    } catch (err) {
      const errMsg = (err?.stderr || err?.message || '').toLowerCase();
      const isBlockedError = errMsg.includes('sign in') || errMsg.includes('not a bot') || errMsg.includes('403');

      if (isBlockedError && i < PLAYER_CLIENT_CHAINS.length - 1) {
        console.warn(`Audio extraction blocked with "${PLAYER_CLIENT_CHAINS[i]}", trying next client chain...`);
        continue;
      }

      throw err;
    }
  }

  return null;
}

function advanceQueue(guildId, serverQueue, delayNext, errorReason = null) {
  if (serverQueue.stopped || !queue.has(guildId)) return;

  const songId = serverQueue.currentSongId;
  if (songId && serverQueue.advancingSongId === songId) return;

  serverQueue.advancingSongId = songId;
  cleanupCurrentProcess(serverQueue);

  if (serverQueue.songs[0]?.id === songId) {
    serverQueue.songs.shift();
  } else {
    serverQueue.songs.shift();
  }

  const nextSong = serverQueue.songs[0];
  if (nextSong) {
    console.log(`▶️ Next: ${nextSong.title}`);
    const playNext = () => playSong(guildId, nextSong);
    if (delayNext) setTimeout(playNext, 1000);
    else playNext();
    return;
  }

  serverQueue.currentSongId = null;
  serverQueue.advancingSongId = null;
  updatePresence();
  setVoiceChannelStatus(serverQueue.voiceChannel.id, '');

  if (errorReason) {
    console.log('⚠️ Queue empty after playback error, disconnecting soon');
    serverQueue.textChannel.send(`⚠️ Playback stopped. ${errorReason} Disconnecting in 5 seconds.`);
    scheduleIdleDisconnect(guildId, serverQueue, ERROR_DISCONNECT_MS);
    return;
  }

  console.log('✅ Queue empty, disconnecting soon');
  serverQueue.textChannel.send('✅ Queue finished! Disconnecting in 10 seconds unless you add another song.');
  scheduleIdleDisconnect(guildId, serverQueue, IDLE_DISCONNECT_MS);
}

function updatePresence(inVoice) {
  if (!client.user) return;

  const activityName = inVoice ? `${PREFIX}play · 🔊 In voice` : `${PREFIX}play`;
  client.user.setPresence({
    activities: [{ name: activityName, type: ActivityType.Listening }],
    status: 'online',
  });
}

function cleanupCurrentProcess(serverQueue) {
  if (!serverQueue?.currentProcess) return;

  try {
    serverQueue.currentProcess.kill('SIGKILL');
  } catch (err) {
    console.warn('Could not stop audio process:', err.message || err);
  } finally {
    serverQueue.currentProcess = null;
  }
}

function scheduleIdleDisconnect(guildId, serverQueue, delayMs = IDLE_DISCONNECT_MS) {
  clearIdleDisconnect(serverQueue);
  serverQueue.idleTimeout = setTimeout(() => {
    const latestQueue = queue.get(guildId);
    if (!latestQueue || latestQueue.songs.length > 0) return;

    console.log('Disconnecting after idle timeout');
    stopQueue(guildId, latestQueue);
  }, delayMs);
}

function clearIdleDisconnect(serverQueue) {
  if (!serverQueue?.idleTimeout) return;
  clearTimeout(serverQueue.idleTimeout);
  serverQueue.idleTimeout = null;
}

function skip(message, serverQueue) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');
  skipQueue(serverQueue);
  message.reply('⏭️ Skipped!');
}

function skipQueue(serverQueue) {
  clearIdleDisconnect(serverQueue);
  cleanupCurrentProcess(serverQueue);
  serverQueue.player.stop();
}

function stop(message, serverQueue) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');
  stopQueue(message.guild.id, serverQueue);
  message.reply('⏹️ Stopped!');
}

function stopQueue(guildId, serverQueue) {
  teardownQueue(guildId, serverQueue, true);
}

function teardownQueue(guildId, serverQueue, destroyConnection) {
  serverQueue.stopped = true;
  serverQueue.songs = [];
  serverQueue.currentSongId = null;
  serverQueue.advancingSongId = null;
  clearIdleDisconnect(serverQueue);
  cleanupCurrentProcess(serverQueue);
  serverQueue.player.stop(true);

  if (destroyConnection) {
    const conn = getVoiceConnection(guildId);
    if (conn) conn.destroy();
  }

  queue.delete(guildId);
  updatePresence();
  setVoiceChannelStatus(serverQueue.voiceChannel.id, '');
}

function showQueue(message, serverQueue) {
  if (!serverQueue || !serverQueue.songs.length) {
    return message.reply('❌ Queue is empty!');
  }
  message.reply(getQueueText(serverQueue));
}

function getQueueText(serverQueue) {
  const queueList = serverQueue.songs
    .map((song, i) => `${i === 0 ? '▶️' : `${i}.`} ${song.title}`)
    .join('\n');
  return `🎵 **Queue:**\n${queueList}`;
}

client.login(TOKEN);
