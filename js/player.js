/**
 * The docked embed. Owns the single <iframe>, which is created only when a
 * set is actually opened, and can pause it when the timer goes off.
 * @module player
 */

/** @type {HTMLElement|null} */
let mount = null;
/** @type {HTMLIFrameElement|null} */
let frame = null;
/** @type {import('./state.js').DjSet|null} */
let current = null;

/**
 * @param {HTMLElement} el container the iframe is created inside
 */
export function init(el) {
  mount = el;
}

/**
 * @param {import('./state.js').DjSet} set
 * @returns {string} the page to open in a new tab
 */
export function externalUrl(set) {
  if (set.url) return set.url;
  return set.videoId ? `https://www.youtube.com/watch?v=${set.videoId}` : '#';
}

/**
 * @param {import('./state.js').DjSet} set
 * @returns {string}
 */
function embedUrl(set) {
  /* enablejsapi lets us pause it later via postMessage */
  const p = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    enablejsapi: '1',
    origin: location.origin,
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(set.videoId || '')}?${p}`;
}

/**
 * Open a set. The iframe is created on first use, not at page load.
 * @param {import('./state.js').DjSet} set
 */
export function open(set) {
  if (!mount) return;
  if (!frame) {
    frame = document.createElement('iframe');
    frame.title = 'DJ set player';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('allowfullscreen', '');
    frame.loading = 'lazy';
    mount.append(frame);
  }
  current = set;
  frame.src = embedUrl(set);
}

/** @returns {import('./state.js').DjSet|null} */
export function currentSet() {
  return current;
}

/**
 * Pause playback without tearing the embed down, so it can be resumed.
 * Both providers accept a postMessage command.
 * @returns {boolean} whether a pause command was sent
 */
export function pause() {
  if (!frame || !frame.contentWindow || !current) return false;
  try {
    frame.contentWindow.postMessage(
      JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
      'https://www.youtube-nocookie.com'
    );
    return true;
  } catch {
    return false;
  }
}

/** Tear the embed down completely. */
export function close() {
  if (frame) {
    frame.src = 'about:blank';
    frame.remove();
    frame = null;
  }
  current = null;
}

/** @returns {boolean} */
export function isOpen() {
  return frame !== null;
}
