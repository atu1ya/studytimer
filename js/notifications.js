/**
 * Opt-in browser notifications. Permission is only ever requested from the
 * settings toggle, never on page load.
 * @module notifications
 */

/** @returns {boolean} */
export function isSupported() {
  return 'Notification' in window;
}

/** @returns {NotificationPermission|'unsupported'} */
export function permission() {
  return isSupported() ? Notification.permission : 'unsupported';
}

/**
 * Ask for permission. Resolves false if unsupported, blocked or declined.
 * @returns {Promise<{granted: boolean, reason: string}>}
 */
export async function request() {
  if (!isSupported()) {
    return { granted: false, reason: 'This browser does not support notifications.' };
  }
  if (Notification.permission === 'granted') return { granted: true, reason: '' };
  if (Notification.permission === 'denied') {
    return { granted: false, reason: 'Notifications are blocked for this site in your browser settings.' };
  }
  try {
    const result = await Notification.requestPermission();
    return result === 'granted'
      ? { granted: true, reason: '' }
      : { granted: false, reason: 'Permission was not granted, so notifications stay off.' };
  } catch {
    return { granted: false, reason: 'The permission request failed.' };
  }
}

/**
 * @param {string} title
 * @param {string} body
 * @param {boolean} [requireInteraction] keep it on screen until dismissed
 */
export function show(title, body, requireInteraction = false) {
  if (!isSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      tag: 'deep-work',
      renotify: true,
      requireInteraction,
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* ignore */ }
}
