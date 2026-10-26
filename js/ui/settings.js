/**
 * The settings sheet: an inset grouped list, iOS Settings style.
 * @module ui/settings
 */

import { getState, updateSettings, DEFAULT_SETTINGS } from '../state.js';
import { clearAll } from '../storage.js';
import * as audio from '../audio.js';
import * as notifications from '../notifications.js';
import * as theme from './theme.js';
import * as timer from '../timer.js';

/** @type {Record<string, any>} */
let el;

/** @param {Record<string, any>} elements */
export function init(elements) {
  el = elements;

  /* durations ----------------------------------------------------- */
  const number = (node, key, min, max) => {
    node.addEventListener('change', () => {
      const raw = Math.round(Number(node.value));
      const value = Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : DEFAULT_SETTINGS[key];
      updateSettings({ [key]: value });
      node.value = String(value);
      /* a length change applies at once to an idle phase */
      const { timer: t } = getState();
      if (!t.running && key === t.mode) timer.reset();
    });
  };
  number(el.focus, 'focus', 1, 240);
  number(el.short, 'short', 1, 120);
  number(el.long, 'long', 1, 180);
  number(el.longEvery, 'longEvery', 1, 12);

  el.presets.forEach((btn) => {
    btn.addEventListener('click', () => {
      const [focus, short, long] = btn.dataset.preset.split(',').map(Number);
      updateSettings({ focus, short, long });
      const { timer: t } = getState();
      if (!t.running) timer.reset();
      render();
    });
  });

  el.auto.addEventListener('change', () => updateSettings({ autoStart: el.auto.checked }));

  /* sound ---------------------------------------------------------- */
  el.volume.addEventListener('input', () => updateSettings({ volume: Number(el.volume.value) }));
  el.volume.addEventListener('change', () => audio.play(getState().settings.focusChime, getState().settings.volume, 0.6));

  el.focusChime.addEventListener('change', () => {
    updateSettings({ focusChime: el.focusChime.value });
    audio.play(el.focusChime.value, getState().settings.volume);
  });
  el.breakChime.addEventListener('change', () => {
    updateSettings({ breakChime: el.breakChime.value });
    audio.play(el.breakChime.value, getState().settings.volume);
  });
  el.previews.forEach((btn) => {
    btn.addEventListener('click', () => {
      const select = document.getElementById(btn.dataset.preview);
      audio.play(select.value, getState().settings.volume);
    });
  });

  el.warn.addEventListener('change', () => updateSettings({ warn: el.warn.checked }));

  el.notify.addEventListener('change', async () => {
    if (!el.notify.checked) {
      updateSettings({ notify: false });
      el.notifyHint.hidden = true;
      return;
    }
    const { granted, reason } = await notifications.request();
    updateSettings({ notify: granted });
    el.notify.checked = granted;
    el.notifyHint.textContent = reason;
    el.notifyHint.hidden = granted;
  });

  /* appearance ------------------------------------------------------ */
  el.themeInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) { updateSettings({ theme: input.value }); theme.apply(); }
    });
  });
  el.accentInputs.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) { updateSettings({ accent: input.value }); theme.apply(); }
    });
  });

  /* data ------------------------------------------------------------ */
  el.wipe.addEventListener('click', () => {
    if (!confirm('Clear the task, settings, favourites and today’s totals?')) return;
    clearAll();
    location.reload();
  });

  applyCapabilityHints();
  render();
}

/** Disable controls whose feature the browser will not provide. */
function applyCapabilityHints() {
  if (!audio.isSupported()) {
    [el.volume, el.focusChime, el.breakChime, el.warn, ...el.previews].forEach((n) => { n.disabled = true; });
    el.audioHint.hidden = false;
    el.audioHint.textContent = 'This browser has no Web Audio support, so chimes are unavailable.';
  }
  if (!notifications.isSupported()) {
    el.notify.disabled = true;
    el.notifyHint.hidden = false;
    el.notifyHint.textContent = 'This browser does not support notifications.';
  }
}

export function render() {
  const s = getState().settings;
  el.focus.value = String(s.focus);
  el.short.value = String(s.short);
  el.long.value = String(s.long);
  el.longEvery.value = String(s.longEvery);
  el.auto.checked = s.autoStart;
  el.volume.value = String(s.volume);
  el.focusChime.value = s.focusChime;
  el.breakChime.value = s.breakChime;
  el.warn.checked = s.warn;
  el.notify.checked = s.notify;

  el.themeInputs.forEach((i) => { i.checked = i.value === s.theme; });
  el.accentInputs.forEach((i) => { i.checked = i.value === s.accent; });
}
