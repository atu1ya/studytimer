/**
 * Loading and filtering data/sets.json. The timer never depends on this —
 * if the fetch fails the panel shows an error and everything else works.
 * @module sets
 */

import { getState, setState } from './state.js';

/**
 * Fetch the set list.
 * @returns {Promise<void>}
 */
export async function load() {
  setState({ setsStatus: 'loading' });
  try {
    const res = await fetch('data/sets.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    /* accept {updatedAt, sets:[…]} or a bare array */
    const list = Array.isArray(json) ? json : json.sets || [];
    const updatedAt = Array.isArray(json) ? null : json.updatedAt;

    const sets = list
      .filter((s) => s && s.id && s.title && (s.url || s.videoId))
      .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));

    setState({
      sets,
      setsUpdatedAt: updatedAt,
      setsStatus: sets.length ? 'ready' : 'empty',
    });
  } catch {
    setState({ sets: [], setsStatus: 'error' });
  }
}

/**
 * @param {import('./state.js').DjSet} set
 * @returns {string} thumbnail URL, or '' when there is none
 */
export function thumbOf(set) {
  if (set.thumb) return set.thumb;
  return set.source === 'youtube' ? `https://i.ytimg.com/vi/${set.videoId}/mqdefault.jpg` : '';
}

/**
 * The sets matching the current filter, in display order.
 * @returns {import('./state.js').DjSet[]}
 */
export function visible() {
  const { sets, filter, favs } = getState();
  return sets.filter((s) => {
    if (filter.source === 'favs') {
      if (!favs.includes(s.id)) return false;
    } else if (filter.source !== 'all' && s.source !== filter.source) {
      return false;
    }
    if (filter.tag && !(s.tags || []).includes(filter.tag)) return false;
    return true;
  });
}

/**
 * Tags ordered by how many sets carry them.
 * @param {number} [limit]
 * @returns {Array<{tag: string, count: number}>}
 */
export function topTags(limit = 14) {
  const counts = new Map();
  for (const s of getState().sets) {
    for (const t of s.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

/** @returns {import('./state.js').DjSet|null} a random set from the current filter */
export function randomSet() {
  const pool = visible().length ? visible() : getState().sets;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/**
 * @param {string|null} iso
 * @returns {string} e.g. "3d ago"
 */
export function relativeDate(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * @param {number|null|undefined} ms
 * @returns {string} e.g. "1h02" or "46m"
 */
export function duration(ms) {
  if (!ms) return '';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`;
}
