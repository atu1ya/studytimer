/**
 * The "time's up" banner. Visible for as long as the alarm is ringing, and
 * the only thing on screen while it is.
 * @module ui/alarm
 */

import * as audio from '../audio.js';
import { MODE_LABEL } from '../timer.js';

/** @type {HTMLElement} */
let root;
/** @type {HTMLElement} */
let titleEl;
/** @type {HTMLElement} */
let bodyEl;
/** @type {HTMLButtonElement} */
let dismissBtn;
/** @type {(() => void)|null} */
let onDismiss = null;

/**
 * @param {{root: HTMLElement, title: HTMLElement, body: HTMLElement, dismiss: HTMLButtonElement}} els
 * @param {() => void} dismissed called once the user clears the alarm
 */
export function init(els, dismissed) {
  root = els.root;
  titleEl = els.title;
  bodyEl = els.body;
  dismissBtn = els.dismiss;
  onDismiss = dismissed;

  dismissBtn.addEventListener('click', dismiss);

  /* any key or pointer press clears it, so it is never in the way */
  document.addEventListener('keydown', (e) => {
    if (audio.isRinging()) { e.preventDefault(); dismiss(); }
  }, true);

  audio.onRingChange(render);
  render();
}

/**
 * @param {import('../state.js').Mode} finishedMode
 * @param {string} detail
 */
export function show(finishedMode, detail) {
  titleEl.textContent = finishedMode === 'focus' ? 'Focus session done' : `${MODE_LABEL[finishedMode]} over`;
  bodyEl.textContent = detail;
  render();
  /* move focus so a keyboard user can dismiss with Return straight away */
  requestAnimationFrame(() => dismissBtn.focus());
}

export function dismiss() {
  audio.stopAlarm();
  onDismiss?.();
  render();
}

function render() {
  const ringing = audio.isRinging();
  root.hidden = !ringing;
  document.body.classList.toggle('is-ringing', ringing);
}
