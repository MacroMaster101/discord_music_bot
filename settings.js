const fs = require('fs');
const path = require('path');

// Set up persistent data directory (prefer Docker/Fly mounts over local fallback)
const DATA_DIR = fs.existsSync('/app/data') 
  ? '/app/data' 
  : (fs.existsSync('/data') ? '/data' : path.join(__dirname, 'data'));
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  prefix: '!',
  defaultVolume: 100,
  idleDisconnectSeconds: 10,
  emptyVcDisconnectSeconds: 60,
  autoPauseWhenAlone: true,
};

let state = {
  global: { ...DEFAULTS },
  guilds: {}, // guildId -> partial overrides
};

let saveTimer = null;

function ensureDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.warn('Could not create data dir:', err.message);
  }
}

function load() {
  ensureDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      state.global = { ...DEFAULTS, ...(parsed.global || {}) };
      state.guilds = parsed.guilds || {};
      console.log(`⚙️  Settings loaded from ${SETTINGS_FILE}`);
    } else {
      console.log(`⚙️  No settings file yet, using defaults (will write to ${SETTINGS_FILE})`);
    }
  } catch (err) {
    console.error('Could not load settings, using defaults:', err.message);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      ensureDir();
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('Could not save settings:', err.message);
    }
  }, 250);
}

function get(guildId, key) {
  if (guildId && state.guilds[guildId] && state.guilds[guildId][key] != null) {
    return state.guilds[guildId][key];
  }
  return state.global[key];
}

function getAll(guildId) {
  return {
    global: { ...state.global },
    guild: guildId ? { ...(state.guilds[guildId] || {}) } : {},
    effective: Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, get(guildId, k)])),
  };
}

function setGlobal(patch) {
  state.global = { ...state.global, ...sanitize(patch) };
  scheduleSave();
  return state.global;
}

function setGuild(guildId, patch) {
  // Explicit nulls mean "clear this override" — apply before sanitize so they don't get coerced
  const clears = [];
  for (const k of Object.keys(patch)) {
    if (patch[k] === null) clears.push(k);
  }
  const clean = sanitize(patch);
  const current = { ...(state.guilds[guildId] || {}), ...clean };
  for (const k of clears) delete current[k];
  if (Object.keys(current).length === 0) {
    delete state.guilds[guildId];
  } else {
    state.guilds[guildId] = current;
  }
  scheduleSave();
  return state.guilds[guildId] || {};
}

function resetGuild(guildId) {
  delete state.guilds[guildId];
  scheduleSave();
}

function resetGlobal() {
  state.global = { ...DEFAULTS };
  scheduleSave();
  return state.global;
}

function sanitize(patch) {
  const out = {};
  if (patch.prefix !== undefined) {
    const p = String(patch.prefix).trim();
    if (p.length >= 1 && p.length <= 5) out.prefix = p;
  }
  if (patch.defaultVolume !== undefined) {
    const v = Number(patch.defaultVolume);
    if (!isNaN(v) && v >= 0 && v <= 100) out.defaultVolume = Math.round(v);
  }
  if (patch.idleDisconnectSeconds !== undefined) {
    const n = Number(patch.idleDisconnectSeconds);
    if (!isNaN(n) && n >= 5 && n <= 3600) out.idleDisconnectSeconds = Math.round(n);
  }
  if (patch.emptyVcDisconnectSeconds !== undefined) {
    const n = Number(patch.emptyVcDisconnectSeconds);
    if (!isNaN(n) && n >= 10 && n <= 3600) out.emptyVcDisconnectSeconds = Math.round(n);
  }
  if (patch.autoPauseWhenAlone !== undefined) {
    out.autoPauseWhenAlone = !!patch.autoPauseWhenAlone;
  }
  return out;
}

function getDefaults() { return { ...DEFAULTS }; }
function getKeys() { return Object.keys(DEFAULTS); }

module.exports = {
  load,
  get,
  getAll,
  setGlobal,
  setGuild,
  resetGuild,
  resetGlobal,
  getDefaults,
  getKeys,
  DEFAULTS,
};
