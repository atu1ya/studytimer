/**
 * Drag handle for the sets sidebar.
 *
 * The width lives in a custom property on :root so the grid picks it up, and
 * is persisted so it survives a reload. Below the sidebar breakpoint the
 * panel is a sheet, so the handle is inert.
 * @module ui/resizer
 */

import { KEYS, read, write } from '../storage.js';

const MIN = 300;
const DEFAULT = 360;
const STEP = 16;

/** @type {HTMLElement} */
let handle;

/** @returns {number} the widest the sidebar may be at this viewport */
function maxWidth() {
  return Math.max(MIN, Math.min(620, Math.round(window.innerWidth * 0.5)));
}

/**
 * @param {number} px
 * @returns {number}
 */
function clamp(px) {
  return Math.round(Math.min(maxWidth(), Math.max(MIN, px)));
}

/** @returns {number} the current width */
function current() {
  const raw = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10);
  return Number.isFinite(raw) ? raw : DEFAULT;
}

/**
 * @param {number} px
 * @param {boolean} [persist]
 */
function setWidth(px, persist = true) {
  const value = clamp(px);
  document.documentElement.style.setProperty('--sidebar-w', `${value}px`);
  handle?.setAttribute('aria-valuenow', String(value));
  if (persist) write(KEYS.sidebar, value);
}

/** @returns {boolean} whether the sidebar layout is in use */
function isSidebar() {
  return window.matchMedia('(min-width: 1024px)').matches;
}

/** @param {HTMLElement} el the separator element */
export function init(el) {
  handle = el;

  const saved = read(KEYS.sidebar, null);
  if (typeof saved === 'number') setWidth(saved, false);

  handle.setAttribute('aria-valuemin', String(MIN));
  handle.setAttribute('aria-valuemax', String(maxWidth()));
  handle.setAttribute('aria-valuenow', String(current()));

  /* pointer drag ---------------------------------------------------- */
  handle.addEventListener('pointerdown', (e) => {
    if (!isSidebar()) return;
    e.preventDefault();
    /* capture keeps the drag alive over the iframe; not fatal if refused */
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    document.body.classList.add('is-resizing');

    const move = (ev) => {
      /* the handle sits on the panel's left edge, so the width is
         whatever lies between the pointer and the right of the window */
      setWidth(window.innerWidth - ev.clientX, false);
    };
    const up = (ev) => {
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      document.body.classList.remove('is-resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      write(KEYS.sidebar, current());
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  /* keyboard -------------------------------------------------------- */
  handle.addEventListener('keydown', (e) => {
    if (!isSidebar()) return;
    const step = e.shiftKey ? STEP * 4 : STEP;
    if (e.key === 'ArrowLeft') { setWidth(current() + step); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { setWidth(current() - step); e.preventDefault(); }
    else if (e.key === 'Home' || e.key === 'Enter') { setWidth(DEFAULT); e.preventDefault(); }
  });

  /* double-click restores the default */
  handle.addEventListener('dblclick', () => setWidth(DEFAULT));

  /* a narrower window may make the stored width illegal */
  window.addEventListener('resize', () => {
    handle.setAttribute('aria-valuemax', String(maxWidth()));
    setWidth(current(), false);
  });
}
