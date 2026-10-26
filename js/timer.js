/**
 * Timer logic.
 *
 * While running, the source of truth is `endsAt`, an absolute timestamp.
 * Remaining time is always (endsAt - now), so a throttled background tab,
 * sleep, or a tab switch can never make the clock drift.
 * @module timer
 */

import { getState, updateTimer, updateStats, todayKey, setState } from './state.js';

/** @type {Record<import('./state.js').Mode, string>} */
export const MODE_LABEL = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};

/**
 * @param {import('./state.js').Mode} mode
 * @param {import('./state.js').Settings} settings
 * @returns {number} phase length in ms
 */
export function phaseMs(mode, settings) {
  const minutes = Number(settings[mode]) || 1;
  return Math.max(1, Math.min(600, minutes)) * 60000;
}

/**
 * @param {import('./state.js').TimerState} [timer]
 * @returns {number} ms remaining, never negative
 */
export function remainingMs(timer = getState().timer) {
  return timer.running && timer.endsAt
    ? Math.max(0, timer.endsAt - Date.now())
    : Math.max(0, timer.remaining);
}

/** @returns {number} 0–1 */
export function progress() {
  const { timer, settings } = getState();
  const total = phaseMs(timer.mode, settings);
  return total > 0 ? 1 - remainingMs(timer) / total : 0;
}

/** @type {{onPhaseEnd?: (mode: import('./state.js').Mode) => void, onWarn?: () => void}} */
let hooks = {};

export function start() {
  const { timer, settings } = getState();
  if (timer.running) return;
  const remaining = timer.remaining > 0 ? timer.remaining : phaseMs(timer.mode, settings);
  updateTimer({ running: true, remaining, endsAt: Date.now() + remaining });
}

export function pause() {
  const { timer } = getState();
  if (!timer.running) return;
  updateTimer({ running: false, remaining: remainingMs(timer), endsAt: null });
}

export function toggle() {
  getState().timer.running ? pause() : start();
}

/**
 * @param {import('./state.js').Mode} mode
 * @param {boolean} [keepRunning]
 */
export function setMode(mode, keepRunning = false) {
  const { settings } = getState();
  const remaining = phaseMs(mode, settings);
  updateTimer({
    mode,
    remaining,
    warned: false,
    running: keepRunning,
    endsAt: keepRunning ? Date.now() + remaining : null,
  });
}

export function reset() {
  setMode(getState().timer.mode);
}

/**
 * Move to the next phase.
 * @param {boolean} completed whether the phase actually ran out
 */
export function advance(completed) {
  const { timer, settings, stats } = getState();
  let next;

  if (timer.mode === 'focus') {
    if (completed) {
      updateStats({
        sessions: stats.sessions + 1,
        focusMs: stats.focusMs + phaseMs('focus', settings),
      });
      updateTimer({ cycle: timer.cycle + 1 });
    }
    const cycle = completed ? timer.cycle + 1 : timer.cycle;
    const every = Math.max(1, Number(settings.longEvery) || 4);
    next = cycle > 0 && cycle % every === 0 ? 'long' : 'short';
  } else {
    next = 'focus';
  }

  setMode(next, completed && settings.autoStart);
}

/** Skip to the next phase without counting it. */
export function skip() {
  advance(false);
}

/** Roll today's totals over at local midnight. */
function rollOverIfNewDay() {
  const { stats } = getState();
  if (stats.date !== todayKey()) {
    updateStats({ date: todayKey(), sessions: 0, focusMs: 0 });
  }
}

/**
 * Restore after a reload. If the stored end time has already passed, the
 * phase finished while the tab was closed: count it, but stay quiet.
 * @returns {boolean} whether a phase completed while away
 */
export function restore() {
  const { timer, settings } = getState();

  if (timer.running && timer.endsAt) {
    if (timer.endsAt <= Date.now()) {
      updateTimer({ running: false, endsAt: null, remaining: 0 });
      advance(true);
      return true;
    }
    updateTimer({ remaining: remainingMs(timer) });
    return false;
  }

  updateTimer({
    running: false,
    endsAt: null,
    remaining: Math.min(timer.remaining > 0 ? timer.remaining : phaseMs(timer.mode, settings), phaseMs(timer.mode, settings)),
  });
  return false;
}

/**
 * Start the tick loop. 250ms is plenty: the display needs one-second
 * resolution, and accuracy comes from the stored timestamp, not the ticks.
 * @param {{onPhaseEnd: (mode: import('./state.js').Mode) => void, onWarn: () => void}} handlers
 */
export function init(handlers) {
  hooks = handlers;

  const tick = () => {
    rollOverIfNewDay();
    const { timer, settings } = getState();

    if (timer.running) {
      const left = remainingMs(timer);

      if (settings.warn && !timer.warned && left <= 60000 && left > 0) {
        updateTimer({ warned: true });
        hooks.onWarn?.();
      }
      if (left <= 0) {
        const finished = timer.mode;
        updateTimer({ running: false, endsAt: null, remaining: 0 });
        advance(true);
        hooks.onPhaseEnd?.(finished);
        return;
      }
    }
    /* nudge subscribers so the clock repaints */
    setState({ tickAt: Date.now() });
  };

  tick();
  setInterval(tick, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
