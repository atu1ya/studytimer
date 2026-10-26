/**
 * The hero: digits, progress ring, mode label, session count, and the
 * screen-reader announcements.
 * @module ui/clock
 */

import { getState } from '../state.js';
import { MODE_LABEL, phaseMs, remainingMs, progress } from '../timer.js';

/** @type {Record<string, HTMLElement>} */
let el;
let lastAnnouncedMinute = -1;
/** @type {string} */
let lastMode = '';

/**
 * @param {number} ms
 * @returns {string} h:mm:ss or mm:ss
 */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** @param {Record<string, HTMLElement>} elements */
export function init(elements) {
  el = elements;
}

export function render() {
  const { timer, settings, stats } = getState();
  const left = remainingMs(timer);
  const total = phaseMs(timer.mode, settings);
  const label = MODE_LABEL[timer.mode];
  const pct = Math.max(0, Math.min(1, progress()));

  el.time.textContent = formatClock(left);
  el.mode.textContent = label;

  /* pathLength="1" means the dash offset is simply 1 - progress */
  el.ring.setAttribute('stroke-dashoffset', String(1 - pct));
  el.ringGroup.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
  el.ringGroup.setAttribute('aria-valuetext', `${formatClock(left)} remaining of ${label}`);

  el.sessions.textContent = String(stats.sessions);
  el.minutes.textContent = String(Math.round(stats.focusMs / 60000));

  const ending = timer.running && left > 0 && left <= 60000;
  document.body.classList.toggle('is-ending', ending);
  document.body.classList.toggle('is-running', timer.running);

  document.title = timer.running || left < total ? `${formatClock(left)} · ${label}` : 'Deep Work';

  announce(left, label);
}

/**
 * Announce mode changes and each whole minute, never every second.
 * @param {number} left
 * @param {string} label
 */
function announce(left, label) {
  const minute = Math.ceil(left / 60000);
  if (label !== lastMode) {
    lastMode = label;
    lastAnnouncedMinute = minute;
    el.live.textContent = `${label}, ${formatClock(left)} remaining`;
    return;
  }
  if (minute !== lastAnnouncedMinute) {
    lastAnnouncedMinute = minute;
    el.live.textContent = minute <= 1 ? 'Less than a minute remaining' : `${minute} minutes remaining`;
  }
}
