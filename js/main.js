/**
 * Wiring. Every module renders from state; this file owns the element
 * lookups, the phase-end behaviour and the shortcut map.
 * @module main
 */

import { getState, subscribe, updateSettings } from './state.js';
import * as timer from './timer.js';
import * as audio from './audio.js';
import * as notifications from './notifications.js';
import * as setsData from './sets.js';
import * as shortcuts from './shortcuts.js';
import * as theme from './ui/theme.js';
import * as clock from './ui/clock.js';
import * as controls from './ui/controls.js';
import * as task from './ui/task.js';
import * as settings from './ui/settings.js';
import * as panel from './ui/panel.js';
import * as alarm from './ui/alarm.js';
import * as resizer from './ui/resizer.js';

const $ = (id) => document.getElementById(id);
const all = (sel) => [...document.querySelectorAll(sel)];

/* ---- focus mode ------------------------------------------------------ */

/** @type {HTMLElement|null} */
let fullscreenTrigger = null;

/** @param {boolean} [force] */
function setFocusMode(force) {
  const on = force === undefined ? !document.body.classList.contains('focus-mode') : force;
  document.body.classList.toggle('focus-mode', on);
  $('btn-focusmode').setAttribute('aria-pressed', String(on));

  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {
      /* fullscreen can be blocked; the layout change still applies */
    });
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
  if (!on) fullscreenTrigger?.focus();
}

/* ---- phase end ------------------------------------------------------- */

/** @param {import('./state.js').Mode} finished */
function onPhaseEnd(finished) {
  const { settings: s } = getState();
  const chime = finished === 'focus' ? s.focusChime : s.breakChime;

  /* Mute the music first, so the alarm is not competing with a DJ set. */
  const paused = panel.pausePlayback();

  const started = audio.startAlarm(chime, s.volume);

  const detail = finished === 'focus'
    ? `${Math.round(timer.phaseMs('focus', s) / 60000)} minutes logged. Time to step away.`
    : 'Break over. Back to it.';

  if (s.notify) notifications.show(finished === 'focus' ? 'Focus session done' : 'Break over', detail, true);

  alarm.show(finished, paused ? `${detail} Playback paused.` : detail);

  /* If audio could not start there is nothing to dismiss, so clear at once. */
  if (!started) alarm.dismiss();
}

function onWarn() {
  const { settings: s } = getState();
  audio.play(s.focusChime, s.volume, 0.3);
}

/* ---- boot ------------------------------------------------------------ */

function boot() {
  theme.init();

  clock.init({
    time: $('clock-time'),
    mode: $('clock-mode'),
    ring: $('ring-fill'),
    ringGroup: $('ring'),
    sessions: $('stat-sessions'),
    minutes: $('stat-minutes'),
    live: $('live-region'),
  });

  controls.init({
    modeInputs: all('input[name="mode"]'),
    start: $('btn-start'),
    startLabel: $('btn-start-label'),
    reset: $('btn-reset'),
    skip: $('btn-skip'),
    cycle: $('cycle'),
  });

  task.init({ input: $('task-input'), list: $('task-steps') });

  settings.init({
    focus: $('set-focus'),
    short: $('set-short'),
    long: $('set-long'),
    longEvery: $('set-long-every'),
    auto: $('set-auto'),
    presets: all('[data-preset]'),
    volume: $('set-volume'),
    focusChime: $('set-focus-chime'),
    breakChime: $('set-break-chime'),
    previews: all('[data-preview]'),
    warn: $('set-warn'),
    notify: $('set-notify'),
    notifyHint: $('notify-hint'),
    audioHint: $('audio-hint'),
    themeInputs: all('input[name="theme"]'),
    accentInputs: all('input[name="accent"]'),
    wipe: $('btn-wipe'),
  });

  panel.init({
    panel: $('sets-panel'),
    sources: $('filter-sources'),
    tags: $('filter-tags'),
    list: $('sets-list'),
    meta: $('sets-meta'),
    shuffle: $('btn-shuffle'),
    surprise: $('btn-surprise'),
    close: $('btn-panel-close'),
    toggleButton: $('btn-panel'),
    stop: $('btn-player-stop'),
    retry: $('btn-sets-retry'),
    player: $('player'),
    playerMount: $('player-mount'),
    playerTitle: $('player-title'),
    playerLink: $('player-link'),
    emptyState: $('sets-empty'),
    errorState: $('sets-error'),
  });

  resizer.init($('panel-resizer'));

  alarm.init(
    {
      root: $('alarm'),
      title: $('alarm-title'),
      body: $('alarm-body'),
      dismiss: $('btn-alarm-dismiss'),
    },
    () => { /* nothing extra to do on dismiss */ }
  );

  /* dialogs -------------------------------------------------------- */
  const settingsDialog = $('dlg-settings');
  const helpDialog = $('dlg-help');
  /** @type {HTMLElement|null} */
  let dialogTrigger = null;

  const openDialog = (dialog, trigger) => {
    dialogTrigger = trigger;
    settings.render();
    dialog.showModal();
  };
  $('btn-settings').addEventListener('click', (e) => openDialog(settingsDialog, e.currentTarget));
  $('btn-help').addEventListener('click', (e) => openDialog(helpDialog, e.currentTarget));
  [settingsDialog, helpDialog].forEach((d) =>
    d.addEventListener('close', () => dialogTrigger?.focus())
  );

  /* header buttons --------------------------------------------------- */
  $('btn-theme').addEventListener('click', () => { theme.toggle(); settings.render(); });
  $('btn-panel').addEventListener('click', (e) => panel.toggle(e.currentTarget));
  $('btn-focusmode').addEventListener('click', (e) => {
    fullscreenTrigger = e.currentTarget;
    setFocusMode();
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) setFocusMode(false);
  });

  /* shortcuts --------------------------------------------------------- */
  shortcuts.init(
    {
      space: () => { audio.warmUp(); timer.toggle(); },
      r: () => timer.reset(),
      s: () => timer.skip(),
      f: () => setFocusMode(),
      t: () => { theme.toggle(); settings.render(); },
      d: () => panel.toggle($('btn-panel')),
      x: () => $('btn-surprise').click(),
      '?': () => $('btn-help').click(),
    },
    () => {
      /* Escape: unwind one layer at a time */
      if (audio.isRinging()) { alarm.dismiss(); return true; }
      if (document.body.classList.contains('focus-mode')) { setFocusMode(false); return true; }
      if (getState().panelOpen && panel.isSheet()) { panel.close(); return true; }
      return false;
    }
  );

  /* render on every state change ------------------------------------- */
  subscribe(() => {
    clock.render();
    controls.render();
  });

  let lastSetsSignature = '';
  subscribe((state) => {
    const signature = `${state.setsStatus}|${state.sets.length}|${state.favs.length}|${state.filter.source}|${state.filter.tag}|${state.playing}`;
    if (signature !== lastSetsSignature) {
      lastSetsSignature = signature;
      panel.render();
    }
  });

  /* start ------------------------------------------------------------- */
  const finishedWhileAway = timer.restore();
  timer.init({ onPhaseEnd, onWarn });
  clock.render();
  controls.render();
  panel.render();

  if (finishedWhileAway) {
    $('live-region').textContent = 'A phase finished while you were away.';
  }

  setsData.load();

  /* keep the stored phase safe if the tab is closed mid-session */
  window.addEventListener('pagehide', () => {
    const { timer: t } = getState();
    if (t.running) timer.pause();
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
