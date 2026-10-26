/**
 * The single source of truth. UI modules subscribe and re-render from state
 * rather than mutating the DOM from scattered event handlers.
 * @module state
 */

import { KEYS, read, write, migrateSettings } from './storage.js';

/**
 * @typedef {'focus'|'short'|'long'} Mode
 * @typedef {'siren'|'ukg'|'bell'|'pad'|'marimba'|'sub'} ChimeName
 * @typedef {'blue'|'orange'|'green'|'indigo'} Accent
 * @typedef {'light'|'dark'|'system'} ThemePref
 */

/**
 * @typedef {object} Settings
 * @property {number} schema      settings schema version
 * @property {number} focus       focus length, minutes
 * @property {number} short       short break length, minutes
 * @property {number} long        long break length, minutes
 * @property {number} longEvery   focus sessions before a long break
 * @property {boolean} autoStart  start the next phase automatically
 * @property {ThemePref} theme
 * @property {Accent} accent
 * @property {number} volume      0–1
 * @property {ChimeName} focusChime
 * @property {ChimeName} breakChime
 * @property {boolean} warn       chime one minute before the end
 * @property {boolean} notify     browser notification when a phase ends
 */

/**
 * @typedef {object} TimerState
 * @property {Mode} mode
 * @property {boolean} running
 * @property {number|null} endsAt  absolute ms timestamp; the source of truth
 * @property {number} remaining    ms left while paused
 * @property {number} cycle        completed focus sessions this cycle
 * @property {boolean} warned      one-minute chime already played
 */

/**
 * @typedef {object} Stats
 * @property {string} date      local YYYY-MM-DD; totals reset when it changes
 * @property {number} sessions
 * @property {number} focusMs
 */

/**
 * One entry in data/sets.json. Shape is fixed by scripts/update-sets.mjs.
 * @typedef {object} DjSet
 * @property {string} id                      "yt:<videoId>" or "sc:<path>"
 * @property {'youtube'|'soundcloud'} source
 * @property {string} title
 * @property {string} channel
 * @property {string} url
 * @property {string} [videoId]
 * @property {string|null} published          ISO; approximate for YouTube
 * @property {number|null} [durationMs]
 * @property {string|null} [thumb]
 * @property {string[]} tags
 */

/**
 * @typedef {object} Subtask
 * @property {string} text
 * @property {boolean} done
 */

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  schema: 3,
  focus: 50,
  short: 10,
  long: 20,
  longEvery: 4,
  autoStart: false,
  theme: 'system',
  accent: 'blue',
  volume: 0.6,
  focusChime: 'siren',
  breakChime: 'marimba',
  warn: true,
  notify: false,
};

/** @returns {string} local date key, e.g. "2026-10-26" */
export function todayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * @typedef {object} AppState
 * @property {Settings} settings
 * @property {TimerState} timer
 * @property {Stats} stats
 * @property {string} task
 * @property {Subtask[]} subs
 * @property {DjSet[]} sets
 * @property {'loading'|'ready'|'empty'|'error'} setsStatus
 * @property {string|null} setsUpdatedAt
 * @property {string[]} favs
 * @property {string|null} playing   id of the set in the player
 * @property {{tag: string|null, source: string}} filter
 * @property {boolean} panelOpen
 * @property {boolean} focusMode
 */

/** @returns {AppState} */
function initialState() {
  const settings = migrateSettings(read(KEYS.settings, {}), DEFAULT_SETTINGS);

  /** @type {TimerState} */
  const timer = {
    mode: 'focus',
    running: false,
    endsAt: null,
    remaining: settings.focus * 60000,
    cycle: 0,
    warned: false,
    ...read(KEYS.timer, {}),
  };

  const stats = { date: todayKey(), sessions: 0, focusMs: 0, ...read(KEYS.stats, {}) };

  /** @type {Subtask[]} */
  const subs = read(KEYS.subs, []);
  while (subs.length < 3) subs.push({ text: '', done: false });

  return {
    settings,
    timer,
    stats,
    task: read(KEYS.task, ''),
    subs: subs.slice(0, 3),
    sets: [],
    setsStatus: 'loading',
    setsUpdatedAt: null,
    favs: read(KEYS.favs, []),
    playing: null,
    filter: { tag: null, source: 'all' },
    panelOpen: false,
    focusMode: false,
  };
}

/** @type {AppState} */
let state = initialState();

/** @type {Set<(s: AppState, changed: string[]) => void>} */
const listeners = new Set();

/** @returns {AppState} current state; treat as read-only */
export function getState() {
  return state;
}

/**
 * Merge a patch into state and notify subscribers.
 * @param {Partial<AppState>} patch
 */
export function setState(patch) {
  const changed = Object.keys(patch).filter((k) => state[k] !== patch[k]);
  if (!changed.length) return;
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state, changed));
}

/**
 * @param {(s: AppState, changed: string[]) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---- persisting updates -------------------------------------------- */

/** @param {Partial<Settings>} patch */
export function updateSettings(patch) {
  const settings = { ...state.settings, ...patch };
  setState({ settings });
  write(KEYS.settings, settings);
}

/** @param {Partial<TimerState>} patch */
export function updateTimer(patch) {
  const timer = { ...state.timer, ...patch };
  setState({ timer });
  write(KEYS.timer, timer);
}

/** @param {Partial<Stats>} patch */
export function updateStats(patch) {
  const stats = { ...state.stats, ...patch };
  setState({ stats });
  write(KEYS.stats, stats);
}

/** @param {string} task */
export function setTask(task) {
  setState({ task });
  write(KEYS.task, task);
}

/** @param {Subtask[]} subs */
export function setSubs(subs) {
  setState({ subs });
  write(KEYS.subs, subs);
}

/** @param {string} id */
export function toggleFavourite(id) {
  const favs = state.favs.includes(id)
    ? state.favs.filter((f) => f !== id)
    : [...state.favs, id];
  setState({ favs });
  write(KEYS.favs, favs);
}
