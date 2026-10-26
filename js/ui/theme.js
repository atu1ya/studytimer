/**
 * Theme and accent. The default follows the OS; a manual choice overrides it.
 * @module ui/theme
 */

import { getState, updateSettings } from '../state.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');

/** @returns {'light'|'dark'} the theme actually in use */
export function resolved() {
  const pref = getState().settings.theme;
  if (pref === 'light' || pref === 'dark') return pref;
  return media.matches ? 'dark' : 'light';
}

/** Apply the current settings to the document. */
export function apply() {
  const { accent, theme } = getState().settings;
  const root = document.documentElement;

  /* 'system' leaves data-theme off so the media query in CSS decides */
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;

  root.dataset.accent = accent;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved() === 'dark' ? '#000000' : '#ffffff';
}

/** Cycle light -> dark -> system. */
export function toggle() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(getState().settings.theme) + 1) % order.length];
  updateSettings({ theme: next });
  apply();
  return next;
}

export function init() {
  apply();
  /* repaint when the OS flips while we are following it */
  media.addEventListener('change', () => {
    if (getState().settings.theme === 'system') apply();
  });
}
