/**
 * Safe localStorage access and settings migration.
 *
 * Every read and write is guarded: localStorage throws in private windows,
 * with site data blocked, and when the quota is full.
 * @module storage
 */

/** Keys used by the app. Unchanged since v1, so old saves still load. */
export const KEYS = {
  settings: 'dw.settings',
  task: 'dw.task',
  subs: 'dw.subs',
  timer: 'dw.timer',
  stats: 'dw.stats',
  favs: 'dw.favs',
  scHint: 'dw.seenScHint',
};

/**
 * @param {string} key
 * @param {*} fallback
 * @returns {*} parsed value, or `fallback` if absent or unreadable
 */
export function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {string} key
 * @param {*} value
 * @returns {boolean} whether the write succeeded
 */
export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** @param {string} key */
export function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Clear every key this app owns. */
export function clearAll() {
  Object.values(KEYS).forEach(remove);
}

/**
 * Accents were renamed when the palette moved to system tones. Old saves map
 * onto the nearest new accent instead of being reset.
 * @type {Record<string, string>}
 */
const ACCENT_MIGRATION = {
  violet: 'indigo',
  acid: 'green',
  cyan: 'blue',
  amber: 'orange',
};

/** Chimes that existed in earlier versions and still do. */
const KNOWN_CHIMES = ['siren', 'ukg', 'bell', 'pad', 'marimba', 'sub'];

/**
 * Bring a stored settings object up to the current schema. Existing choices
 * are preserved wherever they still mean something.
 *
 * @param {Partial<import('./state.js').Settings>} stored
 * @param {import('./state.js').Settings} defaults
 * @returns {import('./state.js').Settings}
 */
export function migrateSettings(stored, defaults) {
  const next = { ...defaults, ...stored };

  if (next.accent && ACCENT_MIGRATION[next.accent]) next.accent = ACCENT_MIGRATION[next.accent];
  if (!['blue', 'orange', 'green', 'indigo'].includes(next.accent)) next.accent = defaults.accent;

  /* v1 and v2 stored only 'light' or 'dark'; following the OS is the new
     default, but an explicit earlier choice is kept. */
  if (!['light', 'dark', 'system'].includes(next.theme)) next.theme = defaults.theme;

  if (!KNOWN_CHIMES.includes(next.focusChime)) next.focusChime = defaults.focusChime;
  if (!KNOWN_CHIMES.includes(next.breakChime)) next.breakChime = defaults.breakChime;

  next.schema = 3;
  return next;
}
