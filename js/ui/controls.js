/**
 * Segmented mode control and the transport buttons.
 * @module ui/controls
 */

import { getState } from '../state.js';
import * as timer from '../timer.js';
import * as audio from '../audio.js';

/** @type {Record<string, any>} */
let el;

/**
 * @param {Record<string, any>} elements
 */
export function init(elements) {
  el = elements;

  /* native radios inside a fieldset: keyboard and screen readers for free */
  el.modeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) timer.setMode(input.value);
    });
  });

  el.start.addEventListener('click', () => {
    audio.warmUp(); // unlock audio while we have the gesture
    timer.toggle();
  });
  el.reset.addEventListener('click', () => timer.reset());
  el.skip.addEventListener('click', () => timer.skip());
}

export function render() {
  const { timer: t, settings } = getState();
  const left = timer.remainingMs(t);
  const total = timer.phaseMs(t.mode, settings);

  el.modeInputs.forEach((input) => {
    input.checked = input.value === t.mode;
  });

  el.startLabel.textContent = t.running ? 'Pause' : left < total ? 'Resume' : 'Start';
  el.start.setAttribute('aria-pressed', String(t.running));

  /* cycle dots: how many focus sessions until the long break */
  const every = Math.max(1, Number(settings.longEvery) || 4);
  const done = t.cycle % every;
  if (el.cycle.childElementCount !== every) {
    el.cycle.replaceChildren(
      ...Array.from({ length: every }, () => {
        const dot = document.createElement('span');
        dot.className = 'cycle__dot';
        return dot;
      })
    );
  }
  [...el.cycle.children].forEach((dot, i) => dot.classList.toggle('is-done', i < done));
  el.cycle.setAttribute('aria-label', `${done} of ${every} focus sessions before a long break`);
}
