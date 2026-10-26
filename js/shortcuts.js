/**
 * Keyboard shortcuts. Never fire while typing or while a dialog is open.
 * @module shortcuts
 */

/**
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function isTyping(e) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

/** @returns {boolean} */
function dialogOpen() {
  return Boolean(document.querySelector('dialog[open]'));
}

/**
 * @param {Record<string, () => void>} map lowercase key -> handler
 * @param {() => boolean} onEscape returns true if Escape was handled
 */
export function init(map, onEscape) {
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Escape') {
      /* Escape works even from a focused control, so overlays always close */
      if (!dialogOpen() && onEscape()) e.preventDefault();
      return;
    }
    if (isTyping(e) || dialogOpen()) return;

    const key = e.key === ' ' || e.key === 'Spacebar' ? 'space' : e.key.toLowerCase();
    const handler = map[key];
    if (handler) {
      e.preventDefault();
      handler();
    }
  });
}
