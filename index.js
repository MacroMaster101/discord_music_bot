require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startDashboardServer } = require('./server');
const settings = require('./settings');

settings.load();

const {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  StringSelectMenuBuilder,
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  getVoiceConnection,
  StreamType,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

const ytSearch = require('yt-search');
const youtubedlPkg = require('youtube-dl-exec');
// Prefer system-installed yt-dlp (kept up-to-date in Docker) over the
// bundled binary inside node_modules which can be months out of date.
const YTDLP_SYSTEM_PATH = '/usr/local/bin/yt-dlp';
const youtubedl = fs.existsSync(YTDLP_SYSTEM_PATH)
  ? youtubedlPkg.create(YTDLP_SYSTEM_PATH)
  : youtubedlPkg;

// Stats tracking (in-memory, resets on restart)
const stats = {
  totalSongsPlayed: 0,
  commandLog: [], // ring buffer of last 20 commands
};

function logCommand(entry) {
  stats.commandLog.unshift({
    ...entry,
    timestamp: Date.now(),
  });
  if (stats.commandLog.length > 20) stats.commandLog.pop();
}

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const ERROR_DISCONNECT_MS = 5000;

function getPrefix(guildId) { return settings.get(guildId, 'prefix'); }
function getIdleDisconnectMs(guildId) { return settings.get(guildId, 'idleDisconnectSeconds') * 1000; }
function getEmptyVcDisconnectMs(guildId) { return settings.get(guildId, 'emptyVcDisconnectSeconds') * 1000; }
function getDefaultVolume(guildId) { return settings.get(guildId, 'defaultVolume'); }
function getAutoPauseWhenAlone(guildId) { return settings.get(guildId, 'autoPauseWhenAlone'); }
const YTDLP_COOKIES_PATH = process.env.YTDLP_COOKIES_PATH || process.env.YTDLP_COOKIES;
const YTDLP_COOKIES_BASE64 = process.env.YTDLP_COOKIES_BASE64;
const YTDLP_PO_TOKEN = process.env.YTDLP_PO_TOKEN;
const VOICE_STATUS_ROUTE = (channelId) => `/channels/${channelId}/voice-status`;
let nextSongId = 1;
let tempCookiesPath = null;
let presenceInVoice = false;
let presenceCurrentSong = null;
let presenceIndex = 0;
let presenceInterval = null;

const PRESENCE_ROTATE_MS = 12000;

// Player client fallback chains — tried in order when YouTube blocks a request
// Order matters: lead with clients whose googlevideo stream URLs actually
// download from a datacenter IP. web_embedded extracts but its media 403s,
// so it is no longer first. mweb + android_vr (default) download cleanly with
// the bgutil WEB PO token; web_embedded kept last as a fallback.
const PLAYER_CLIENT_CHAINS = [
  'mweb,default',
  'default',
  'tv_simply,default,-tv',
  'web_embedded,default',
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
    // Two separate extractor-arg namespaces: the youtube extractor (player_client)
    // and the bgutil HTTP PO-token provider (base_url). The provider key MUST be
    // `youtubepot-bgutilhttp:base_url` — anything else and yt-dlp never calls it.
    extractorArgs: [
      `youtube:player_client=${playerClient}`,
      `youtubepot-bgutilhttp:base_url=${bgutilBaseUrl}`,
    ],
  };
  if (tempCookiesPath) {
    opts.cookies = tempCookiesPath;
  }
  // Legacy manual PO token still honored if explicitly set (auto-provider preferred).
  if (YTDLP_PO_TOKEN) {
    opts.extractorArgs[0] += `;po_token=web+${YTDLP_PO_TOKEN}`;
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
const inflightPlay = new Set(); // guildIds currently bootstrapping a queue

client.once('ready', async () => {
  const machineId = process.env.FLY_MACHINE_ID || 'local';
  console.log(`🎵 ${client.user.tag} is online! [machine=${machineId}]`);
  console.log(`👉 If you see this log from MORE than one machine, run: fly scale count 1`);
  updatePresence();
  startPresenceRotation();

  // Start the web dashboard and statistics API server
  try {
    startDashboardServer(client, queue, { getBotStats, getQueueProgress, seek });
  } catch (err) {
    console.error('Could not start Web Dashboard Server:', err);
  }

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
  const guild = newState.guild || oldState.guild;
  const guildId = guild.id;

  // Bot was disconnected externally
  if (oldState.id === client.user?.id && oldState.channelId && !newState.channelId) {
    const serverQueue = queue.get(guildId);
    if (serverQueue && !serverQueue.stopped) {
      console.log('🔴 Bot was disconnected, stopping playback');
      teardownQueue(guildId, serverQueue, true);
    }
    return;
  }

  // Re-evaluate the "alone in VC" state on any relevant change
  const serverQueue = queue.get(guildId);
  if (!serverQueue) return;
  reevaluateLoneliness(guildId, serverQueue);
});

function countHumansInVc(voiceChannel) {
  if (!voiceChannel?.members) return 0;
  let n = 0;
  for (const m of voiceChannel.members.values()) {
    if (!m.user.bot) n++;
  }
  return n;
}

function reevaluateLoneliness(guildId, serverQueue) {
  const vc = serverQueue.voiceChannel;
  // Refresh from cache so we see real membership (oldState/newState already applied)
  const liveVc = vc.guild.channels.cache.get(vc.id) || vc;
  const humans = countHumansInVc(liveVc);

  if (humans === 0) {
    // Pause playback if configured and not already paused
    if (getAutoPauseWhenAlone(guildId)
        && serverQueue.player.state.status === AudioPlayerStatus.Playing) {
      serverQueue.player.pause();
      serverQueue.wasAutoPaused = true;
      console.log(`⏸️ Auto-paused in ${liveVc.name} (empty VC)`);
    }
    // Schedule disconnect
    if (!serverQueue.emptyVcTimeout) {
      const ms = getEmptyVcDisconnectMs(guildId);
      console.log(`⏳ Empty VC, disconnecting in ${ms / 1000}s`);
      serverQueue.emptyVcTimeout = setTimeout(() => {
        const q = queue.get(guildId);
        if (!q) return;
        const stillEmpty = countHumansInVc(
          q.voiceChannel.guild.channels.cache.get(q.voiceChannel.id) || q.voiceChannel
        ) === 0;
        if (stillEmpty) {
          console.log('🔴 Disconnecting after empty VC timeout');
          q.textChannel.send('👋 Nobody in voice channel, leaving.').catch(() => {});
          teardownQueue(guildId, q, true);
        }
      }, ms);
    }
  } else {
    // Someone (re-)joined
    if (serverQueue.emptyVcTimeout) {
      clearTimeout(serverQueue.emptyVcTimeout);
      serverQueue.emptyVcTimeout = null;
    }
    if (serverQueue.wasAutoPaused
        && serverQueue.player.state.status === AudioPlayerStatus.Paused) {
      serverQueue.player.unpause();
      console.log('▶️ Auto-resumed (humans returned)');
    }
    serverQueue.wasAutoPaused = false;
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  const PREFIX = getPrefix(message.guild.id);
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const serverQueue = queue.get(message.guild.id);

  const KNOWN = new Set([
    'play','p','skip','s','stop','dc','disconnect','queue','q','help','h',
    'pause','resume','unpause','nowplaying','np','volume','vol','shuffle',
    'remove','loop','repeat','clear','move','mv','seek','search','sr',
    'playlist','pl','lyrics','ly'
  ]);

  try {
    if (KNOWN.has(command)) {
      logCommand({
        command,
        guildName: message.guild.name,
        userName: message.author.username,
      });
    }

    if (command === 'play' || command === 'p') await execute(message, serverQueue, args);
    else if (command === 'skip' || command === 's') skip(message, serverQueue);
    else if (command === 'stop' || command === 'dc' || command === 'disconnect') stop(message, serverQueue);
    else if (command === 'queue' || command === 'q') showQueue(message, serverQueue);
    else if (command === 'help' || command === 'h') sendHelp(message);
    else if (command === 'pause') pause(message, serverQueue);
    else if (command === 'resume' || command === 'unpause') resume(message, serverQueue);
    else if (command === 'nowplaying' || command === 'np') nowPlaying(message, serverQueue);
    else if (command === 'volume' || command === 'vol') setVolume(message, serverQueue, args);
    else if (command === 'shuffle') shuffle(message, serverQueue);
    else if (command === 'remove') removeSong(message, serverQueue, args);
    else if (command === 'loop' || command === 'repeat') loopCommand(message, serverQueue, args);
    else if (command === 'clear') clearQueue(message, serverQueue);
    else if (command === 'move' || command === 'mv') moveCommand(message, serverQueue, args);
    else if (command === 'seek') await seekCommand(message, serverQueue, args);
    else if (command === 'search' || command === 'sr') await searchCommand(message, args);
    else if (command === 'playlist' || command === 'pl') await playlistCommand(message, serverQueue, args);
    else if (command === 'lyrics' || command === 'ly') await lyricsCommand(message, serverQueue, args);
  } catch (err) {
    console.error('Error:', err);
    message.reply('⚠️ Something went wrong!');
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.guild) return;
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  // Queue picker — select menu produces this; action buttons follow it
  if (interaction.isStringSelectMenu() && interaction.customId === 'queue_pick') {
    const sq = queue.get(interaction.guild.id);
    if (!sq) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    const songId = interaction.values[0];
    const song = sq.songs.find((s) => s.id === songId);
    if (!song) return interaction.reply({ content: '❌ Song no longer in queue.', ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`qa_play:${songId}`).setLabel('▶️ Play Now').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`qa_next:${songId}`).setLabel('⏫ Move to Top').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`qa_remove:${songId}`).setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger),
    );
    return interaction.reply({
      content: `What do you want to do with **${song.title}**?`,
      components: [row],
      ephemeral: true,
    });
  }

  // Queue action buttons (from the picker)
  if (interaction.isButton() && interaction.customId.startsWith('qa_')) {
    const sq = queue.get(interaction.guild.id);
    if (!sq) return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    const [action, songId] = interaction.customId.split(':');
    const songIndex = sq.songs.findIndex((s) => s.id === songId);
    if (songIndex === -1 || songIndex === 0) {
      return interaction.update({ content: '❌ That song is no longer in the queue.', components: [] });
    }
    const song = sq.songs[songIndex];

    if (action === 'qa_remove') {
      sq.songs.splice(songIndex, 1);
      return interaction.update({ content: `🗑️ Removed **${song.title}**.`, components: [] });
    }
    if (action === 'qa_next') {
      sq.songs.splice(songIndex, 1);
      sq.songs.splice(1, 0, song);
      return interaction.update({ content: `⏫ **${song.title}** is now up next.`, components: [] });
    }
    if (action === 'qa_play') {
      sq.songs.splice(songIndex, 1);
      sq.songs.splice(1, 0, song);
      await interaction.update({ content: `▶️ Playing **${song.title}** now.`, components: [] });
      skipQueue(sq);
      return;
    }
  }

  // Search-result picker is handled separately (doesn't need an existing queue)
  if (interaction.customId.startsWith('search_pick:')) {
    const [, sessionId, indexStr] = interaction.customId.split(':');
    const session = searchSessions.get(sessionId);
    if (!session) {
      return interaction.reply({ content: '❌ This search has expired.', ephemeral: true });
    }
    if (session.requesterId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Only the user who ran the search can pick.', ephemeral: true });
    }
    const video = session.results[parseInt(indexStr, 10)];
    if (!video) {
      return interaction.reply({ content: '❌ Invalid pick.', ephemeral: true });
    }
    searchSessions.delete(sessionId);

    if (!interaction.member?.voice?.channel) {
      return interaction.reply({ content: '❌ Join a voice channel first.', ephemeral: true });
    }
    await interaction.update({ components: [] });

    // Reuse execute() with a synthetic args list — pretend the user did !play <url>
    const fakeMessage = {
      guild: interaction.guild,
      member: interaction.member,
      channel: interaction.channel,
      author: interaction.user,
      reply: (content) => interaction.followUp(typeof content === 'string' ? { content, ephemeral: false } : content),
    };
    return execute(fakeMessage, queue.get(interaction.guild.id), [video.url]);
  }

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
    return interaction.reply('⏹️ Stopped!');
  }

  if (interaction.customId === 'music_queue') {
    const { embed, components } = buildQueueView(serverQueue);
    return interaction.reply({ embeds: [embed], components, ephemeral: true });
  }

  if (interaction.customId === 'np_loop') {
    // Cycle off → song → queue → off
    if (!serverQueue.loop) serverQueue.loop = 'song';
    else if (serverQueue.loop === 'song') serverQueue.loop = 'queue';
    else serverQueue.loop = null;
    const label = serverQueue.loop === 'song' ? '🔂 Looping current song'
      : serverQueue.loop === 'queue' ? '🔁 Looping entire queue'
      : '➡️ Loop disabled';
    // Refresh the card so the loop button reflects new state
    const song = serverQueue.songs[0];
    if (song && serverQueue.nowPlayingMessage) {
      serverQueue.nowPlayingMessage.edit({
        embeds: [buildNowPlayingEmbed(song, serverQueue)],
        components: nowPlayingComponents(serverQueue),
      }).catch(() => {});
    }
    return interaction.reply({ content: label, ephemeral: true });
  }

  if (interaction.customId === 'np_shuffle') {
    if (serverQueue.songs.length < 3) {
      return interaction.reply({ content: '❌ Need at least 2 upcoming songs to shuffle.', ephemeral: true });
    }
    const upcoming = serverQueue.songs.slice(1);
    for (let i = upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }
    serverQueue.songs = [serverQueue.songs[0], ...upcoming];
    return interaction.reply({ content: `🔀 Shuffled ${upcoming.length} songs.`, ephemeral: true });
  }

  if (interaction.customId.startsWith('np_vol:')) {
    const delta = parseInt(interaction.customId.split(':')[1], 10);
    const current = Math.round((serverQueue.targetVolume ?? 0.5) * 100);
    const target = Math.max(0, Math.min(100, current + delta));
    serverQueue.targetVolume = target / 100;
    const resource = serverQueue.player.state?.resource;
    if (resource?.volume) resource.volume.setVolume(target / 100);
    const song = serverQueue.songs[0];
    if (song && serverQueue.nowPlayingMessage) {
      serverQueue.nowPlayingMessage.edit({
        embeds: [buildNowPlayingEmbed(song, serverQueue)],
        components: nowPlayingComponents(serverQueue),
      }).catch(() => {});
    }
    return interaction.reply({ content: `🔊 Volume: **${target}%**`, ephemeral: true });
  }

  if (interaction.customId === 'np_pause') {
    const isPaused = serverQueue.player.state.status === AudioPlayerStatus.Paused;
    if (isPaused) {
      serverQueue.player.unpause();
      return interaction.reply({ content: '▶️ Resumed', ephemeral: true });
    } else {
      serverQueue.player.pause();
      return interaction.reply({ content: '⏸️ Paused', ephemeral: true });
    }
  }

  if (interaction.customId.startsWith('np_seek:')) {
    const delta = parseInt(interaction.customId.split(':')[1], 10);
    const song = serverQueue.songs[0];
    if (!song) {
      return interaction.reply({ content: '❌ Nothing is playing.', ephemeral: true });
    }
    const elapsed = getElapsedSeconds(serverQueue);
    let target = elapsed + delta;
    if (target < 0) target = 0;
    if (song.duration && target >= song.duration - 1) {
      // Seeking past end → just skip
      skipQueue(serverQueue);
      return interaction.reply({ content: '⏭️ Past end — skipped.', ephemeral: true });
    }
    await interaction.deferUpdate().catch(() => {});
    await playSong(interaction.guild.id, song, target);
    return;
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
  const PREFIX = getPrefix(message.guild.id);
  if (!voiceChannel) return message.reply('❌ You need to be in a voice channel!');
  if (!args.length) return message.reply(`Usage: \`${PREFIX}play <song name or URL>\``);

  const guildId = message.guild.id;
  const searchText = args.join(' ');

  // Always read live state — never trust the snapshot from messageCreate
  serverQueue = queue.get(guildId);

  // ── 1. Resolve song metadata FIRST. Single status message, regardless of branch.
  const statusMsg = await message.reply('🔍 **Searching...**');

  let song;
  try {
    if (isUrl(searchText)) {
      song = await getSongFromUrl(searchText);
    } else {
      const searchResult = await ytSearch(searchText);
      const video = searchResult.videos?.[0];
      if (!video) {
        await statusMsg.edit('❌ No results found.').catch(() => {});
        return;
      }
      song = {
        id: createSongId(),
        title: video.title,
        url: video.url,
        streamUrl: null,
        duration: video.seconds || null,
        thumbnail: video.thumbnail || null,
      };
    }
  } catch (err) {
    console.error('Search error:', err);
    await statusMsg.edit('❌ Could not resolve song metadata.').catch(() => {});
    return;
  }

  // Re-read AFTER awaits to pick up state changes during search
  serverQueue = queue.get(guildId);

  // ── 2. Branch on queue state — re-resolved with fresh state
  if (!serverQueue) {
    // Cold path: need to join VC. Guard against concurrent bootstrap.
    if (inflightPlay.has(guildId)) {
      // Another !play is bootstrapping right now. Wait briefly for it to finish, then append.
      await statusMsg.edit('⏳ Joining a voice channel — your song will be queued...').catch(() => {});
      const joined = await waitForQueue(guildId, 15_000);
      if (!joined) {
        await statusMsg.edit('❌ Voice join took too long, try again.').catch(() => {});
        return;
      }
      // Fall through to append path
      serverQueue = queue.get(guildId);
      if (!serverQueue) {
        await statusMsg.edit('❌ Bot left before your song could be queued.').catch(() => {});
        return;
      }
      return await appendAndMaybePlay(guildId, serverQueue, song, statusMsg);
    }

    inflightPlay.add(guildId);
    try {
      await bootstrapAndPlay(message, voiceChannel, song, statusMsg);
    } finally {
      inflightPlay.delete(guildId);
    }
    return;
  }

  // Warm path: queue exists, just append
  return await appendAndMaybePlay(guildId, serverQueue, song, statusMsg);
}

// Wait up to timeoutMs for queue to exist for guildId
function waitForQueue(guildId, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (queue.has(guildId)) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  });
}

// Append to an existing queue. Plays now if queue was empty; otherwise edits status to "added".
async function appendAndMaybePlay(guildId, serverQueue, song, statusMsg) {
  serverQueue.stopped = false;
  clearIdleDisconnect(serverQueue);

  const shouldStartNow = serverQueue.songs.length === 0;
  serverQueue.songs.push(song);

  if (shouldStartNow) {
    // Delete the status; playSong will send the Now Playing embed
    try { await statusMsg.delete(); } catch {}
    await playSong(guildId, song);
    return;
  }

  // Otherwise edit the original status into an "added to queue" message — no second message
  try {
    await statusMsg.edit({
      content: `➕ Added to queue: **${song.title}**`,
      components: [createMusicControls(song.id)],
    });
  } catch {}
}

// Build queue, join VC, play first song. statusMsg used as the single visible status line.
async function bootstrapAndPlay(message, voiceChannel, song, statusMsg) {
  const guildId = message.guild.id;
  const queueConstruct = {
    textChannel: message.channel,
    voiceChannel,
    connection: null,
    currentProcess: null,
    currentSongId: null,
    advancingSongId: null,
    idleTimeout: null,
    stopped: false,
    loop: null,
    player: createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    }),
    songs: [],
  };

  // Enqueue the song IMMEDIATELY, before the (up to 20s) voice-connection await
  // below. Otherwise a second !play arriving during connection setup sees an
  // empty queue and starts a racing playback, causing the current song to
  // stutter/restart.
  queueConstruct.songs.push(song);
  queue.set(guildId, queueConstruct);

  let connection;
  try {
    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: message.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    queueConstruct.connection = connection;
  } catch (err) {
    console.error('joinVoiceChannel failed:', err);
    queue.delete(guildId);
    await statusMsg.edit('❌ Could not join voice channel. Check permissions.').catch(() => {});
    return;
  }

  await statusMsg.edit('🎧 **Joining voice channel...**').catch(() => {});

  connection.on('error', (error) => {
    console.error('Voice connection error:', error.message || error);
  });

  connection.on('stateChange', async (oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        const currentQueue = queue.get(guildId);
        if (currentQueue && !currentQueue.stopped) {
          console.warn('🔌 [DIAG] Voice connection dropped & did not recover → teardown (this is the "dc")');
          currentQueue.textChannel.send('❌ Lost voice connection. Stopping playback.').catch(() => {});
          teardownQueue(guildId, currentQueue, true);
        } else {
          try { connection.destroy(); } catch {}
        }
      }
    }
  });

  connection.subscribe(queueConstruct.player);

  queueConstruct.player.on(AudioPlayerStatus.Idle, async () => {
    if (queueConstruct.stopped) return;
    console.warn(`🟡 [DIAG] Idle fired. playToken=${queueConstruct.playToken} activePlayToken=${queueConstruct.activePlayToken}`);
    // A restart is in flight when the latest playToken hasn't gone live yet
    // (token bumped, but player.play() for it not reached). The Idle we see is
    // from the killed/superseded stream — ignore it.
    if (queueConstruct.playToken !== queueConstruct.activePlayToken) {
      console.warn('🟡 [DIAG] Idle ignored (restart in flight)');
      return;
    }
    // Defensive: confirm still Idle on the next tick (a fresh stream may be
    // starting). If the player is Playing again, this was a restart artifact.
    const tokenAtIdle = queueConstruct.activePlayToken;
    setTimeout(() => {
      if (queueConstruct.stopped) return;
      if (queueConstruct.activePlayToken !== tokenAtIdle) return; // superseded
      if (queueConstruct.player.state.status !== AudioPlayerStatus.Idle) return; // playing again
      advanceQueue(guildId, queueConstruct, false);
    }, 150);
  });

  queueConstruct.player.on('error', async (error) => {
    if (queueConstruct.stopped) return;
    console.warn(`🔴 [DIAG] Player error fired. playToken=${queueConstruct.playToken} activePlayToken=${queueConstruct.activePlayToken} msg=${error?.message}`);
    // Ignore errors from a superseded stream being torn down during a restart.
    if (queueConstruct.playToken !== queueConstruct.activePlayToken) {
      console.warn('🔴 [DIAG] Player error ignored (restart in flight)');
      return;
    }
    console.error('Player error:', error.message || error);
    queueConstruct.textChannel.send('❌ Playback error, skipping...').catch(() => {});
    advanceQueue(guildId, queueConstruct, true);
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (err) {
    console.error('Voice did not become ready:', err.message || err);
    await statusMsg.edit('❌ Voice connection timed out. Check the bot has permission to join.').catch(() => {});
    teardownQueue(guildId, queueConstruct, true);
    return;
  }

  // Song was already pushed before the connection await (see above).
  try { await statusMsg.delete(); } catch {}
  await playSong(guildId, song);
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
        duration: videoInfo.duration || null,
        thumbnail: videoInfo.thumbnail || (videoInfo.thumbnails && videoInfo.thumbnails[videoInfo.thumbnails.length - 1]?.url) || null,
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
      // Penalize HLS (m3u8) since ffmpeg reconnect handling is flaky for chunked streams
      const aHls = (a.protocol || '').includes('m3u8') || (a.url || '').includes('.m3u8');
      const bHls = (b.protocol || '').includes('m3u8') || (b.url || '').includes('.m3u8');
      const aScore = (a.abr || a.tbr || 0) + (a.ext === 'webm' ? 1000 : 0) + (aHls ? -5000 : 0);
      const bScore = (b.abr || b.tbr || 0) + (b.ext === 'webm' ? 1000 : 0) + (bHls ? -5000 : 0);
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

async function playSong(guildId, song, seekSeconds = 0) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue || !song) return;

  try {
    clearIdleDisconnect(serverQueue);
    // Bump a generation token for this playback. Killing the old ffmpeg below
    // makes the player emit Idle/error from the SUPERSEDED stream; those stale
    // events carry the old token and must be ignored, or a seek (especially a
    // rapid forward-then-back) advances/drops the queue and stops the song.
    // A monotonic token is race-free where a boolean "restarting" flag was not.
    serverQueue.playToken = (serverQueue.playToken || 0) + 1;
    const myToken = serverQueue.playToken;
    cleanupCurrentProcess(serverQueue);
    serverQueue.currentSongId = song.id;
    serverQueue.advancingSongId = null;
    serverQueue.playbackStartedAt = Date.now() - (seekSeconds * 1000);
    serverQueue.seekOffset = seekSeconds;

    const audioUrl = song.streamUrl || await getAudioUrl(song.url);

    if (!audioUrl) {
      throw new Error('yt-dlp did not return an audio URL');
    }

    const ffmpegArgs = [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_on_http_error', '4xx,5xx',
      '-reconnect_delay_max', '30',
      '-rw_timeout', '15000000',
    ];
    if (seekSeconds > 0) {
      ffmpegArgs.push('-ss', String(seekSeconds));
    }
    ffmpegArgs.push(
      '-i', audioUrl,
      '-vn',
      '-analyzeduration', '0',
      '-loglevel', 'warning',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    );

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
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
    
    const vol = serverQueue.targetVolume ?? (getDefaultVolume(guildId) / 100);
    serverQueue.targetVolume = vol;
    resource.volume?.setVolume(vol);
    serverQueue.player.play(resource);
    // Mark this token as the live stream. A later Idle/error advances the queue
    // ONLY if it belongs to this same token; events from a superseded (killed)
    // stream carry an older token and are ignored.
    serverQueue.activePlayToken = myToken;
    updatePresence(true, song.title);
    setVoiceChannelStatus(serverQueue.voiceChannel.id, `🎵 ${song.title}`);

    if (seekSeconds === 0) {
      stats.totalSongsPlayed += 1;
      // New song → delete old card, post fresh one at the bottom
      await postFreshNowPlaying(serverQueue, song);
    } else {
      // Seek: keep the same card, just refresh contents
      await showOrUpdateNowPlaying(serverQueue, song);
    }

    console.log(`▶️ Playing: ${song.title}${seekSeconds ? ` (from ${seekSeconds}s)` : ''}`);
    return true;
  } catch (err) {
    // Sync the active token so future Idle events aren't permanently suppressed
    // after a failed (seek-)restart.
    serverQueue.activePlayToken = myToken;
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

  // Handle loop modes
  if (serverQueue.loop === 'song' && serverQueue.songs[0] && !errorReason) {
    // Re-play the same song
    const currentSong = serverQueue.songs[0];
    console.log(`🔂 Looping: ${currentSong.title}`);
    const replay = () => playSong(guildId, currentSong);
    if (delayNext) setTimeout(replay, 1000);
    else replay();
    return;
  }

  if (serverQueue.loop === 'queue' && serverQueue.songs[0] && !errorReason) {
    // Move current song to end, then play next
    const finishedSong = serverQueue.songs.shift();
    serverQueue.songs.push(finishedSong);
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
  updatePresence(false);
  setVoiceChannelStatus(serverQueue.voiceChannel.id, '');
  stopNowPlayingTicker(serverQueue);
  if (serverQueue.nowPlayingMessage) {
    serverQueue.nowPlayingMessage.edit({ components: [] }).catch(() => {});
    serverQueue.nowPlayingMessage = null;
  }

  if (errorReason) {
    console.log('⚠️ Queue empty after playback error, disconnecting soon');
    serverQueue.textChannel.send(`⚠️ Playback stopped. ${errorReason} Disconnecting in 5 seconds.`);
    scheduleIdleDisconnect(guildId, serverQueue, ERROR_DISCONNECT_MS);
    return;
  }

  console.log('✅ Queue empty, disconnecting soon');
  serverQueue.textChannel.send('✅ Queue finished! Disconnecting in 10 seconds unless you add another song.');
  scheduleIdleDisconnect(guildId, serverQueue, getIdleDisconnectMs(guildId));
}

function getPresenceActivities() {

  // Scan the active queue map dynamically to check if there is an active stream
  let activeQueue = null;
  for (const q of queue.values()) {
    if (q.songs.length > 0 && !q.stopped) {
      activeQueue = q;
      break;
    }
  }

  if (activeQueue && activeQueue.songs[0]) {
    const song = activeQueue.songs[0];
    const songTitle = song.title;
    const title = songTitle.length > 50
      ? songTitle.slice(0, 47) + '...'
      : songTitle;

    const queueCount = activeQueue.songs.length;
    const vcName = activeQueue.voiceChannel?.name || 'Voice Room';

    // Use the song's YouTube URL for Streaming type (purple LIVE badge + clickable link)
    const streamUrl = song.url && song.url.includes('youtube.com')
      ? song.url
      : 'https://www.youtube.com';

    return [
      { name: `🎶 ${title}`, type: ActivityType.Streaming, url: streamUrl },
      { name: `📋 Queue | ${queueCount} track(s)`, type: ActivityType.Streaming, url: streamUrl },
      { name: `🔊 Room | ${vcName}`, type: ActivityType.Streaming, url: streamUrl },
      { name: `🔥 Dropping Beats Non-Stop`, type: ActivityType.Streaming, url: streamUrl },
      { name: `!np 🔎 for info`, type: ActivityType.Streaming, url: streamUrl },
    ];
  }

  return [
    { name: `!play 🎵 | Vibes on Demand`, type: ActivityType.Listening },
    { name: `!help 📖 | Guide & Controls`, type: ActivityType.Watching },
    { name: `💿 Spinning Virtual Vinyl`, type: ActivityType.Playing },
    { name: `🎤 Ready to Drop the Bass`, type: ActivityType.Competing },
    { name: `🏆 The Ultimate DJ Battle`, type: ActivityType.Competing },
  ];
}

function updatePresence(inVoice, songTitle) {
  if (!client.user) return;
  if (typeof inVoice === 'boolean') presenceInVoice = inVoice;
  if (songTitle !== undefined) presenceCurrentSong = songTitle;
  if (inVoice === false) presenceCurrentSong = null;
  presenceIndex = 0;
  applyPresence();
}

function applyPresence() {
  if (!client.user) return;
  
  const activities = getPresenceActivities();
  const activity = activities[presenceIndex % activities.length];

  // Dynamically set status based on active rooms: dnd if streaming, online if idle
  let hasActiveStream = false;
  for (const q of queue.values()) {
    if (q.songs.length > 0 && !q.stopped) {
      hasActiveStream = true;
      break;
    }
  }

  client.user.setPresence({
    activities: [activity],
    status: hasActiveStream ? 'dnd' : 'online',
  });
}

function startPresenceRotation() {
  if (presenceInterval) clearInterval(presenceInterval);
  presenceInterval = setInterval(() => {
    presenceIndex += 1;
    applyPresence();
  }, PRESENCE_ROTATE_MS);
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

function scheduleIdleDisconnect(guildId, serverQueue, delayMs) {
  if (delayMs == null) delayMs = getIdleDisconnectMs(guildId);
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
  if (serverQueue.stopped) return;
  serverQueue.stopped = true;
  serverQueue.songs = [];
  serverQueue.currentSongId = null;
  serverQueue.advancingSongId = null;
  clearIdleDisconnect(serverQueue);
  stopNowPlayingTicker(serverQueue);
  // Disable buttons on the final Now Playing message
  if (serverQueue.nowPlayingMessage) {
    serverQueue.nowPlayingMessage.edit({ components: [] }).catch(() => {});
    serverQueue.nowPlayingMessage = null;
  }
  if (serverQueue.emptyVcTimeout) {
    clearTimeout(serverQueue.emptyVcTimeout);
    serverQueue.emptyVcTimeout = null;
  }
  cleanupCurrentProcess(serverQueue);
  serverQueue.player.stop(true);

  // Delete queue entry BEFORE destroying connection to prevent
  // voiceStateUpdate handler from triggering a second teardown
  queue.delete(guildId);
  updatePresence(false);
  setVoiceChannelStatus(serverQueue.voiceChannel.id, '');

  if (destroyConnection) {
    const conn = getVoiceConnection(guildId);
    if (conn) conn.destroy();
  }
}

function showQueue(message, serverQueue) {
  if (!serverQueue || !serverQueue.songs.length) {
    return message.reply('❌ Queue is empty!');
  }
  const { embed, components } = buildQueueView(serverQueue);
  return message.reply({ embeds: [embed], components });
}

function getQueueText(serverQueue) {
  const loopIndicator = serverQueue.loop === 'song' ? ' 🔂 Song loop' : serverQueue.loop === 'queue' ? ' 🔁 Queue loop' : '';
  const queueList = serverQueue.songs
    .map((song, i) => `${i === 0 ? '▶️' : `${i}.`} ${song.title}`)
    .join('\n');
  return `🎵 **Queue${loopIndicator}:**\n${queueList}`;
}

function buildQueueView(serverQueue) {
  const loopIndicator = serverQueue.loop === 'song' ? ' • 🔂 Looping song'
    : serverQueue.loop === 'queue' ? ' • 🔁 Looping queue' : '';

  const current = serverQueue.songs[0];
  const upcoming = serverQueue.songs.slice(1);

  const lines = upcoming.slice(0, 15).map((s, i) => {
    const dur = s.duration ? ` \`${formatTime(s.duration)}\`` : '';
    return `**${i + 1}.** [${s.title}](${s.url})${dur}`;
  });

  const description =
    `**▶️ Now Playing:**\n[${current.title}](${current.url})` +
    (upcoming.length
      ? `\n\n**📋 Up Next (${upcoming.length}):**\n${lines.join('\n')}` +
        (upcoming.length > 15 ? `\n*…and ${upcoming.length - 15} more*` : '')
      : '\n\n*No upcoming songs.*');

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`🎵 Queue${loopIndicator}`)
    .setDescription(description)
    .setFooter({ text: `${serverQueue.songs.length} total • use the menu below to manage tracks` });

  const components = [];
  if (upcoming.length > 0) {
    const options = upcoming.slice(0, 25).map((s, i) => ({
      label: s.title.length > 100 ? s.title.slice(0, 97) + '...' : s.title,
      description: s.duration ? `${formatTime(s.duration)} • position ${i + 1}` : `position ${i + 1}`,
      value: s.id,
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId('queue_pick')
      .setPlaceholder('Pick a song to manage...')
      .addOptions(options);
    components.push(new ActionRowBuilder().addComponents(select));
  }
  return { embed, components };
}

// ──── Embed / time helpers ────
function formatTime(totalSeconds) {
  if (totalSeconds == null || isNaN(totalSeconds)) return '--:--';
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function parseSeekTime(input) {
  if (!input) return NaN;
  const parts = input.split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

function getElapsedSeconds(serverQueue) {
  if (!serverQueue?.playbackStartedAt) return 0;
  return Math.floor((Date.now() - serverQueue.playbackStartedAt) / 1000);
}

function buildProgressBar(elapsed, duration, length = 20) {
  if (!duration || duration <= 0) return '─'.repeat(length);
  const ratio = Math.max(0, Math.min(1, elapsed / duration));
  const pos = Math.floor(ratio * (length - 1));
  return '─'.repeat(pos) + '🔘' + '─'.repeat(length - pos - 1);
}

// Send or edit the live "Now Playing" message. Posts a new one if the channel
// has changed, otherwise edits the existing one. Also (re)starts the live ticker.
function nowPlayingComponents(serverQueue) {
  const loopMode = serverQueue?.loop;
  const loopLabel = loopMode === 'song' ? '🔂 Song' : loopMode === 'queue' ? '🔁 Queue' : '🔁 Loop';
  const loopStyle = loopMode ? ButtonStyle.Success : ButtonStyle.Secondary;

  // Row 1: seek controls
  const seekRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('np_seek:-30').setLabel('⏪ 30s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np_seek:-10').setLabel('⏪ 10s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np_pause').setLabel('⏯️ Play/Pause').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np_seek:10').setLabel('10s ⏩').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np_seek:30').setLabel('30s ⏩').setStyle(ButtonStyle.Secondary),
  );
  // Row 2: playback toggles
  const playbackRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('np_loop').setLabel(loopLabel).setStyle(loopStyle),
    new ButtonBuilder().setCustomId('np_shuffle').setLabel('🔀 Shuffle').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np_vol:-10').setLabel('🔉 -10').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('np_vol:10').setLabel('🔊 +10').setStyle(ButtonStyle.Secondary),
  );
  // Row 3: queue & stop
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music_queue').setLabel('📋 Queue').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
  );
  return [seekRow, playbackRow, actionRow];
}

// Delete the previous Now Playing message (if any) and send a fresh one at the bottom.
// Used when a new song starts so the card stays visible.
async function postFreshNowPlaying(serverQueue, song) {
  stopNowPlayingTicker(serverQueue);

  // Best-effort delete of the old card
  if (serverQueue.nowPlayingMessage) {
    serverQueue.nowPlayingMessage.delete().catch(() => {});
    serverQueue.nowPlayingMessage = null;
  }

  const payload = {
    embeds: [buildNowPlayingEmbed(song, serverQueue)],
    components: nowPlayingComponents(serverQueue),
  };

  try {
    serverQueue.nowPlayingMessage = await serverQueue.textChannel.send(payload);
  } catch (err) {
    console.warn('Could not post Now Playing message:', err.message || err);
    return;
  }

  startNowPlayingTicker(serverQueue);
}

// Edit the existing Now Playing message in place (used for ticks and seeks).
// Falls back to a fresh send if the old one is gone.
async function showOrUpdateNowPlaying(serverQueue, song) {
  stopNowPlayingTicker(serverQueue);

  const payload = {
    embeds: [buildNowPlayingEmbed(song, serverQueue)],
    components: nowPlayingComponents(serverQueue),
  };

  try {
    if (serverQueue.nowPlayingMessage) {
      await serverQueue.nowPlayingMessage.edit(payload);
    } else {
      serverQueue.nowPlayingMessage = await serverQueue.textChannel.send(payload);
    }
  } catch (err) {
    try {
      serverQueue.nowPlayingMessage = await serverQueue.textChannel.send(payload);
    } catch (sendErr) {
      console.warn('Could not post Now Playing message:', sendErr.message || sendErr);
      return;
    }
  }

  startNowPlayingTicker(serverQueue);
}

function startNowPlayingTicker(serverQueue) {
  stopNowPlayingTicker(serverQueue);
  serverQueue.nowPlayingTicker = setInterval(async () => {
    const song = serverQueue.songs[0];
    if (!song || serverQueue.stopped || !serverQueue.nowPlayingMessage) {
      stopNowPlayingTicker(serverQueue);
      return;
    }
    // Skip ticking while paused — clock stays put
    if (serverQueue.player.state.status === AudioPlayerStatus.Paused) return;
    try {
      await serverQueue.nowPlayingMessage.edit({
        embeds: [buildNowPlayingEmbed(song, serverQueue)],
        components: nowPlayingComponents(serverQueue),
      });
    } catch (err) {
      stopNowPlayingTicker(serverQueue);
    }
  }, 2000);
}

function stopNowPlayingTicker(serverQueue) {
  if (serverQueue?.nowPlayingTicker) {
    clearInterval(serverQueue.nowPlayingTicker);
    serverQueue.nowPlayingTicker = null;
  }
}

function buildNowPlayingEmbed(song, serverQueue) {
  const elapsed = getElapsedSeconds(serverQueue);
  const duration = song.duration || 0;
  const bar = buildProgressBar(elapsed, duration);
  const timeLine = duration
    ? `\`${formatTime(elapsed)} ${bar} ${formatTime(duration)}\``
    : `\`${formatTime(elapsed)} ${bar} live\``;
  const loopText = serverQueue.loop === 'song' ? ' 🔂' : serverQueue.loop === 'queue' ? ' 🔁' : '';

  const embed = new EmbedBuilder()
    .setColor(0x6366f1)
    .setAuthor({ name: `▶️ Now Playing${loopText}` })
    .setTitle(song.title.length > 250 ? song.title.slice(0, 247) + '...' : song.title)
    .setURL(song.url)
    .setDescription(timeLine)
    .addFields(
      { name: 'Volume', value: `${getVolume(serverQueue)}%`, inline: true },
      { name: 'Queue', value: `${Math.max(0, serverQueue.songs.length - 1)} up next`, inline: true },
    );
  if (song.thumbnail) embed.setThumbnail(song.thumbnail);
  return embed;
}

// ──── Help Command ────
function sendHelp(message) {
  const PREFIX = getPrefix(message.guild.id);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🎵 J4FN Music Bot — Commands')
    .setDescription(`Use prefix \`${PREFIX}\` before each command.\nAliases are shown in parentheses.`)
    .addFields(
      {
        name: '🎶  Playback',
        value: [
          `\`${PREFIX}play <song>\` *(p)* — Play a song by name or URL`,
          `\`${PREFIX}search <query>\` *(sr)* — Pick from top 5 results`,
          `\`${PREFIX}playlist <url>\` *(pl)* — Add a YouTube playlist`,
          `\`${PREFIX}pause\` / \`${PREFIX}resume\` — Pause / resume`,
          `\`${PREFIX}skip\` *(s)* — Skip to the next song`,
          `\`${PREFIX}seek <time>\` — Jump to a position (\`1:30\`)`,
          `\`${PREFIX}stop\` *(dc)* — Stop and disconnect`,
          `\`${PREFIX}nowplaying\` *(np)* — Show current song`,
          `\`${PREFIX}lyrics\` *(ly)* — Lyrics for current song`,
        ].join('\n'),
      },
      {
        name: '📋  Queue',
        value: [
          `\`${PREFIX}queue\` *(q)* — View the current queue`,
          `\`${PREFIX}shuffle\` — Shuffle the upcoming songs`,
          `\`${PREFIX}remove <#>\` — Remove a song by its position`,
          `\`${PREFIX}move <from> <to>\` *(mv)* — Move a song to a new position`,
          `\`${PREFIX}clear\` — Clear the entire queue (keeps current song)`,
        ].join('\n'),
      },
      {
        name: '🔧  Settings',
        value: [
          `\`${PREFIX}volume <0-100>\` *(vol)* — Set playback volume`,
          `\`${PREFIX}loop [off|song|queue]\` *(repeat)* — Toggle loop mode`,
        ].join('\n'),
      },
      {
        name: '❓  Info',
        value: `\`${PREFIX}help\` *(h)* — Show this help menu`,
      }
    )
    .setFooter({ text: '🎧 Enjoy the music! • Interactive buttons are also available on now-playing messages.' })
    .setTimestamp();

  message.reply({ embeds: [embed] });
}

// ──── Pause & Resume ────
function pause(message, serverQueue) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');
  if (serverQueue.player.state.status === AudioPlayerStatus.Paused) {
    return message.reply('⏸️ Already paused! Use `' + getPrefix(message.guild.id) + 'resume` to continue.');
  }
  serverQueue.player.pause();
  message.reply('⏸️ Paused!');
}

function resume(message, serverQueue) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');
  if (serverQueue.player.state.status !== AudioPlayerStatus.Paused) {
    return message.reply('▶️ Not currently paused!');
  }
  serverQueue.player.unpause();
  message.reply('▶️ Resumed!');
}

// ──── Now Playing ────
function nowPlaying(message, serverQueue) {
  if (!serverQueue || !serverQueue.songs.length) {
    return message.reply('❌ Nothing is playing right now!');
  }

  const song = serverQueue.songs[0];
  const isPaused = serverQueue.player.state.status === AudioPlayerStatus.Paused;
  const loopText = serverQueue.loop === 'song' ? ' • 🔂 Looping song' : serverQueue.loop === 'queue' ? ' • 🔁 Looping queue' : '';

  const embed = new EmbedBuilder()
    .setColor(isPaused ? 0xFEE75C : 0x57F287)
    .setTitle(isPaused ? '⏸️ Currently Paused' : '▶️ Now Playing')
    .setDescription(`**[${song.title}](${song.url})**${loopText}`)
    .addFields(
      { name: 'Queue', value: `${serverQueue.songs.length - 1} song(s) remaining`, inline: true },
      { name: 'Volume', value: `${getVolume(serverQueue)}%`, inline: true }
    )
    .setTimestamp();

  message.reply({ embeds: [embed] });
}

function getVolume(serverQueue) {
  const resource = serverQueue.player.state?.resource;
  if (resource?.volume) {
    return Math.round(resource.volume.volume * 100);
  }
  return 50;
}

// ──── Volume ────
function setVolume(message, serverQueue, args) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');

  if (!args.length) {
    return message.reply(`🔊 Current volume: **${getVolume(serverQueue)}%**`);
  }

  const vol = parseInt(args[0], 10);
  if (isNaN(vol) || vol < 0 || vol > 100) {
    return message.reply('❌ Volume must be a number between 0 and 100.');
  }

  const resource = serverQueue.player.state?.resource;
  serverQueue.targetVolume = vol / 100;
  if (resource?.volume) {
    resource.volume.setVolume(vol / 100);
    message.reply(`🔊 Volume set to **${vol}%**`);
  } else {
    message.reply('❌ Cannot adjust volume right now.');
  }
}

// ──── Shuffle ────
function shuffle(message, serverQueue) {
  if (!serverQueue || serverQueue.songs.length < 3) {
    return message.reply('❌ Not enough songs in the queue to shuffle! (Need at least 2 upcoming songs)');
  }

  const upcoming = serverQueue.songs.slice(1);
  for (let i = upcoming.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
  }
  serverQueue.songs = [serverQueue.songs[0], ...upcoming];
  message.reply(`🔀 Shuffled **${upcoming.length}** songs in the queue!`);
}

// ──── Remove ────
function removeSong(message, serverQueue, args) {
  if (!serverQueue || !serverQueue.songs.length) {
    return message.reply('❌ Queue is empty!');
  }

  const pos = parseInt(args[0], 10);
  if (isNaN(pos) || pos < 1 || pos >= serverQueue.songs.length) {
    return message.reply(`❌ Invalid position! Use a number between 1 and ${serverQueue.songs.length - 1}.`);
  }

  const removed = serverQueue.songs.splice(pos, 1)[0];
  message.reply(`🗑️ Removed **${removed.title}** from position ${pos}.`);
}

// ──── Loop ────
function loopCommand(message, serverQueue, args) {
  if (!serverQueue) return message.reply('❌ Nothing is playing!');

  const mode = (args[0] || '').toLowerCase();
  const MODES = ['off', 'song', 'queue'];

  if (mode && MODES.includes(mode)) {
    serverQueue.loop = mode === 'off' ? null : mode;
  } else {
    // Cycle: off → song → queue → off
    if (!serverQueue.loop) serverQueue.loop = 'song';
    else if (serverQueue.loop === 'song') serverQueue.loop = 'queue';
    else serverQueue.loop = null;
  }

  const labels = { song: '🔂 Looping current song', queue: '🔁 Looping entire queue' };
  const label = labels[serverQueue.loop] || '➡️ Loop disabled';
  message.reply(label);
}

// ──── Clear Queue ────
function clearQueue(message, serverQueue) {
  if (!serverQueue || serverQueue.songs.length <= 1) {
    return message.reply('❌ No upcoming songs to clear!');
  }

  const count = serverQueue.songs.length - 1;
  serverQueue.songs = [serverQueue.songs[0]];
  message.reply(`🗑️ Cleared **${count}** song(s) from the queue.`);
}

// ──── Move ────
function moveCommand(message, serverQueue, args) {
  if (!serverQueue || serverQueue.songs.length <= 1) {
    return message.reply('❌ Not enough songs in the queue to move!');
  }

  const from = parseInt(args[0], 10);
  const to = parseInt(args[1], 10);
  const max = serverQueue.songs.length - 1;

  if (isNaN(from) || isNaN(to) || from < 1 || from > max || to < 1 || to > max) {
    return message.reply(`❌ Usage: \`${getPrefix(message.guild.id)}move <from> <to>\` — positions 1 to ${max}`);
  }

  if (from === to) return message.reply('❌ Source and destination are the same!');

  const [song] = serverQueue.songs.splice(from, 1);
  serverQueue.songs.splice(to, 0, song);
  message.reply(`↕️ Moved **${song.title}** from position ${from} to ${to}.`);
}

// ──── Seek ────
async function seekCommand(message, serverQueue, args) {
  if (!serverQueue || !serverQueue.songs[0]) return message.reply('❌ Nothing is playing!');
  const PREFIX = getPrefix(message.guild.id);
  const seconds = parseSeekTime(args[0]);
  if (isNaN(seconds) || seconds < 0) {
    return message.reply(`❌ Usage: \`${PREFIX}seek 1:30\` (or seconds like \`90\`)`);
  }
  const current = serverQueue.songs[0];
  if (current.duration && seconds >= current.duration) {
    return message.reply('❌ Seek time is past the end of the song.');
  }
  await message.reply(`⏩ Seeking to **${formatTime(seconds)}**...`);
  await playSong(message.guild.id, current, seconds);
}

// ──── Search ────
const searchSessions = new Map(); // sessionId -> { results, requesterId }
let nextSearchSessionId = 1;

async function searchCommand(message, args) {
  const PREFIX = getPrefix(message.guild.id);
  if (!args.length) return message.reply(`❌ Usage: \`${PREFIX}search <query>\``);
  const query = args.join(' ');
  const searching = await message.reply(`🔍 Searching for **${query}**...`);

  let videos;
  try {
    const result = await ytSearch(query);
    videos = (result.videos || []).slice(0, 5);
  } catch (err) {
    return searching.edit('❌ Search failed.');
  }

  if (!videos.length) return searching.edit('❌ No results found.');

  const sessionId = (nextSearchSessionId++).toString();
  searchSessions.set(sessionId, {
    results: videos,
    requesterId: message.author.id,
    createdAt: Date.now(),
  });
  setTimeout(() => searchSessions.delete(sessionId), 60_000);

  const list = videos.map((v, i) => `**${i + 1}.** [${v.title}](${v.url}) — \`${v.timestamp}\``).join('\n');
  const embed = new EmbedBuilder()
    .setColor(0xd946ef)
    .setTitle(`🔍 Search results for "${query}"`)
    .setDescription(list)
    .setFooter({ text: 'Pick a result with the buttons below • expires in 60s' });

  const row = new ActionRowBuilder().addComponents(
    ...videos.map((_, i) =>
      new ButtonBuilder()
        .setCustomId(`search_pick:${sessionId}:${i}`)
        .setLabel(`${i + 1}`)
        .setStyle(ButtonStyle.Primary)
    )
  );

  await searching.edit({ content: '', embeds: [embed], components: [row] });
}

// ──── Playlist ────
async function playlistCommand(message, serverQueue, args) {
  const PREFIX = getPrefix(message.guild.id);
  const url = args[0];
  if (!url || !isUrl(url)) return message.reply(`❌ Usage: \`${PREFIX}playlist <youtube playlist url>\``);

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) return message.reply('❌ You need to be in a voice channel!');

  const status = await message.reply('📥 Loading playlist...');
  let info;
  try {
    info = await youtubedl(url, {
      ...getYtdlpBaseOptions(),
      dumpSingleJson: true,
      flatPlaylist: true,
      skipDownload: true,
      noPlaylist: false,
    });
  } catch (err) {
    console.error('Playlist load failed:', err.message || err);
    return status.edit('❌ Could not load that playlist.');
  }

  const entries = Array.isArray(info?.entries) ? info.entries : [];
  if (!entries.length) return status.edit('❌ Playlist is empty or unreadable.');

  const songsToAdd = entries
    .filter((e) => e && (e.url || e.id))
    .slice(0, 100)
    .map((e) => ({
      id: createSongId(),
      title: e.title || 'Unknown title',
      url: e.url && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
      streamUrl: null,
      duration: e.duration || null,
      thumbnail: e.thumbnails && e.thumbnails[e.thumbnails.length - 1]?.url || null,
    }));

  if (!serverQueue) {
    // bootstrap a queue using execute() for the first song so voice connection is set up correctly
    const fakeArgs = [songsToAdd[0].url];
    await execute(message, undefined, fakeArgs);
    const newQueue = queue.get(message.guild.id);
    if (newQueue) {
      for (let i = 1; i < songsToAdd.length; i++) newQueue.songs.push(songsToAdd[i]);
    }
  } else {
    for (const s of songsToAdd) serverQueue.songs.push(s);
  }

  await status.edit(`✅ Added **${songsToAdd.length}** songs from the playlist.`);
}

// ──── Lyrics ────
async function lyricsCommand(message, serverQueue, args) {
  const PREFIX = getPrefix(message.guild.id);
  let query = args.join(' ').trim();
  if (!query && serverQueue?.songs[0]) {
    query = serverQueue.songs[0].title;
  }
  if (!query) return message.reply(`❌ Usage: \`${PREFIX}lyrics <artist - song>\` (or play a song first)`);

  // Try to split on " - " for artist/title; otherwise fall back to title-only search
  let artist, title;
  if (query.includes(' - ')) {
    [artist, title] = query.split(' - ').map((s) => s.trim());
  } else {
    artist = '';
    title = query.replace(/\(.*?\)|\[.*?\]/g, '').trim();
  }

  const status = await message.reply(`📜 Looking up lyrics for **${title || query}**...`);

  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.lyrics) throw new Error('No lyrics');

    let body = data.lyrics.trim();
    if (body.length > 3900) body = body.slice(0, 3900) + '\n\n... *(truncated)*';

    const embed = new EmbedBuilder()
      .setColor(0x10b981)
      .setTitle(`📜 ${title || query}${artist ? ` — ${artist}` : ''}`)
      .setDescription(body);
    await status.edit({ content: '', embeds: [embed] });
  } catch (err) {
    await status.edit(`❌ No lyrics found. Try \`${getPrefix(message.guild.id)}lyrics Artist - Song\`.`);
  }
}

// Expose stats for the dashboard
function getBotStats() {
  return {
    totalSongsPlayed: stats.totalSongsPlayed,
    commandLog: stats.commandLog.slice(0, 10),
  };
}

// Seek the currently-playing song in a guild to an absolute position (seconds).
// Reuses the same logic as the np_seek buttons. Returns a result for the HTTP layer.
function seek(guildId, seconds) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) return { ok: false, error: 'No active queue for that guild.' };
  const song = serverQueue.songs[0];
  if (!song) return { ok: false, error: 'Nothing is playing.' };
  console.warn(`🔵 [DIAG] seek requested → ${seconds}s (playToken=${serverQueue.playToken})`);

  let target = Math.floor(Number(seconds));
  if (!Number.isFinite(target) || target < 0) target = 0;

  if (song.duration && target >= song.duration - 1) {
    // Seeking at/after the end → skip to next
    skipQueue(serverQueue);
    return { ok: true, skipped: true };
  }

  // Fire-and-forget restart at the new position (playSong is async).
  playSong(guildId, song, target).catch((err) => {
    console.error('Seek playSong failed:', err?.message || err);
  });
  return { ok: true, seconds: target };
}

function getQueueProgress(serverQueue) {
  const elapsed = getElapsedSeconds(serverQueue);
  const song = serverQueue.songs[0];
  return {
    elapsedSeconds: elapsed,
    durationSeconds: song?.duration || 0,
    elapsedText: formatTime(elapsed),
    durationText: song?.duration ? formatTime(song.duration) : 'live',
    thumbnail: song?.thumbnail || null,
    upcoming: serverQueue.songs.slice(1, 5).map((s) => ({
      title: s.title,
      url: s.url,
      duration: s.duration || null,
    })),
  };
}

module.exports = { getBotStats, getQueueProgress, seek };

client.login(TOKEN);
