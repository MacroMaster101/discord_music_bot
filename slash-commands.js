// Slash commands (/play, /skip, ...). They are registered with Discord so they
// autocomplete and appear in the bot's profile, and each one runs the same code
// as its `!` command, so both styles behave identically.

const STRING = 3; // ApplicationCommandOptionType.String
const INTEGER = 4; // ApplicationCommandOptionType.Integer
const GUILD_ONLY = { contexts: [0], integration_types: [0] }; // servers only, not DMs

const text = (name, description, required = true) => ({ type: STRING, name, description, required, max_length: 300 });
const words = (value) => String(value || '').trim().split(/ +/).filter(Boolean);

// name → { description, options, command (the ! command it runs), args (options → ! args) }
const COMMANDS = {
  play: {
    description: 'Play a song by name, or a YouTube or Spotify link',
    options: [text('song', 'Song name, YouTube link, or Spotify link')],
    command: 'play',
    args: (o) => words(o.song),
  },
  search: {
    description: 'Search YouTube and Spotify and pick a result',
    options: [text('query', 'What to search for')],
    command: 'search',
    args: (o) => words(o.query),
  },
  spotify: {
    description: 'Find a song on Spotify by name and play it',
    options: [text('song', 'Song name')],
    command: 'spotify',
    args: (o) => words(o.song),
  },
  playlist: {
    description: 'Queue a YouTube playlist, or a Spotify album or playlist',
    options: [text('link', 'Playlist or album link')],
    command: 'playlist',
    args: (o) => words(o.link).slice(0, 1),
  },
  skip: { description: 'Skip to the next song', command: 'skip' },
  previous: { description: 'Go back to the song before this one', command: 'previous' },
  pause: { description: 'Pause the music', command: 'pause' },
  resume: { description: 'Resume the music', command: 'resume' },
  stop: { description: 'Stop the music, clear the queue, and leave', command: 'stop' },
  nowplaying: { description: 'Show the current song with its control buttons', command: 'nowplaying' },
  queue: { description: 'See what is coming up', command: 'queue' },
  shuffle: { description: 'Shuffle the upcoming songs', command: 'shuffle' },
  clear: { description: 'Clear the upcoming songs', command: 'clear' },
  seek: {
    description: 'Jump to a time in the current song',
    options: [text('time', 'Time like 1:30 or 90')],
    command: 'seek',
    args: (o) => words(o.time).slice(0, 1),
  },
  lyrics: {
    description: 'Show lyrics for the current song, or another one',
    options: [text('song', 'Song to look up (defaults to the current song)', false)],
    command: 'lyrics',
    args: (o) => words(o.song),
  },
  remove: {
    description: 'Remove a song from the queue',
    options: [{ type: INTEGER, name: 'number', description: 'Its number in /queue', required: true, min_value: 1 }],
    command: 'remove',
    args: (o) => [String(o.number)],
  },
  move: {
    description: 'Move a song to a different spot in the queue',
    options: [
      { type: INTEGER, name: 'from', description: 'Current number in /queue', required: true, min_value: 1 },
      { type: INTEGER, name: 'to', description: 'New number', required: true, min_value: 1 },
    ],
    command: 'move',
    args: (o) => [String(o.from), String(o.to)],
  },
  loop: {
    description: 'Repeat the current song or the whole queue',
    options: [{
      type: STRING,
      name: 'mode',
      description: 'Leave empty to cycle through the modes',
      required: false,
      choices: [
        { name: 'Off', value: 'off' },
        { name: 'Current song', value: 'song' },
        { name: 'Whole queue', value: 'queue' },
      ],
    }],
    command: 'loop',
    args: (o) => (o.mode ? [o.mode] : []),
  },
  volume: {
    description: 'Check or change the volume',
    options: [{ type: INTEGER, name: 'level', description: '0 to 100 (leave empty to see the current volume)', required: false, min_value: 0, max_value: 100 }],
    command: 'volume',
    args: (o) => (o.level === undefined || o.level === null ? [] : [String(o.level)]),
  },
  help: { description: 'Show all commands', command: 'help' },
};

// The JSON sent to Discord's bulk-overwrite endpoint.
function commandDefinitions() {
  return Object.entries(COMMANDS).map(([name, def]) => ({
    name,
    description: def.description,
    options: def.options || [],
    ...GUILD_ONLY,
  }));
}

// Maps a slash command and its option values to the `!` command and args.
function toPrefixCommand(name, optionValues = {}) {
  const def = COMMANDS[name];
  if (!def) return null;
  return { command: def.command, args: def.args ? def.args(optionValues) : [] };
}

// Compares only the parts we define, so registration is skipped when nothing
// changed (Discord adds its own fields to registered commands).
function definitionsSignature(commands) {
  return JSON.stringify(
    [...commands]
      .map((c) => ({
        name: c.name,
        description: c.description,
        options: (c.options || []).map((o) => ({
          type: o.type,
          name: o.name,
          description: o.description,
          required: Boolean(o.required),
          choices: (o.choices || []).map((ch) => ({ name: ch.name, value: ch.value })),
          min_value: o.min_value ?? o.minValue ?? null,
          max_value: o.max_value ?? o.maxValue ?? null,
        })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}

module.exports = { commandDefinitions, definitionsSignature, toPrefixCommand };
