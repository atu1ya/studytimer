/**
 * The DJ sets sidebar: filters, list, and the docked player.
 * @module ui/panel
 */

import { getState, setState, toggleFavourite } from '../state.js';
import * as sets from '../sets.js';
import * as player from '../player.js';

/** @type {Record<string, any>} */
let el;
/** @type {HTMLElement|null} */
let lastTrigger = null;

/** @param {Record<string, any>} elements */
export function init(elements) {
  el = elements;

  player.init(el.playerMount);

  el.shuffle.addEventListener('click', () => {
    shuffled = !shuffled;
    renderList();
  });
  el.surprise.addEventListener('click', () => {
    const pick = sets.randomSet();
    if (pick) openSet(pick);
  });
  el.close.addEventListener('click', () => close());
  el.stop.addEventListener('click', () => {
    player.close();
    setState({ playing: null });
    renderPlayer();
    renderList();
  });
  el.retry.addEventListener('click', () => sets.load());
}

let shuffled = false;
/** @type {string[]} */
let shuffleOrder = [];

/** @param {HTMLElement} [trigger] element to return focus to */
export function open(trigger) {
  lastTrigger = trigger || null;
  setState({ panelOpen: true });
  el.panel.classList.add('is-open');
  if (isSheet()) el.panel.querySelector('button')?.focus();
}

export function close() {
  setState({ panelOpen: false });
  el.panel.classList.remove('is-open');
  lastTrigger?.focus();
}

/** @param {HTMLElement} [trigger] */
export function toggle(trigger) {
  getState().panelOpen ? close() : open(trigger);
}

/** @returns {boolean} whether the panel is an overlay sheet at this width */
export function isSheet() {
  return window.matchMedia('(max-width: 1023px)').matches;
}

/** Pause whatever is playing, without tearing the embed down. */
export function pausePlayback() {
  return player.pause();
}

/** @param {import('../state.js').DjSet} set */
function openSet(set) {
  player.open(set);
  setState({ playing: set.id });
  renderPlayer();
  renderList();
  if (isSheet()) open();
}

export function render() {
  renderFilters();
  renderList();
  renderPlayer();
  renderFooter();
}

function renderPlayer() {
  const open = player.isOpen();
  el.player.hidden = !open;
  const set = player.currentSet();
  el.playerTitle.textContent = set ? set.title : '';
  if (set) {
    el.playerLink.href = player.externalUrl(set);
    el.playerLink.title = 'Open on YouTube';
  }
}

function renderFooter() {
  const { sets: all, setsUpdatedAt, setsStatus } = getState();
  if (setsStatus === 'loading') { el.meta.textContent = 'Loading sets…'; return; }
  if (setsStatus === 'error') { el.meta.textContent = 'Could not load sets'; return; }
  const when = sets.relativeDate(setsUpdatedAt);
  el.meta.textContent = when ? `${all.length} sets · updated ${when}` : `${all.length} sets`;
}

/** how many tag chips show before "Show more" */
const COLLAPSED_TAGS = 7;
let tagsExpanded = false;

function renderFilters() {
  const { sets: all, favs, filter } = getState();

  const sources = [
    { key: 'all', label: 'All', count: all.length },
    { key: 'favs', label: 'Favourites', count: favs.length },
  ];

  el.sources.replaceChildren(
    ...sources.map((s) => pill('source', s.key, `${s.label} ${s.count}`, filter.source === s.key, (key) => {
      setState({ filter: { ...getState().filter, source: key } });
      render();
    }))
  );

  const tags = sets.topTags(40);
  const shown = tagsExpanded ? tags : tags.slice(0, COLLAPSED_TAGS);
  const hiddenCount = tags.length - shown.length;

  const chips = [
    pill('tag', '', 'Everything', !filter.tag, () => {
      setState({ filter: { ...getState().filter, tag: null } });
      render();
    }),
    ...shown.map(({ tag, count }) =>
      pill('tag', tag, `${tag} ${count}`, filter.tag === tag, (key) => {
        setState({ filter: { ...getState().filter, tag: key === filter.tag ? null : key } });
        render();
      })
    ),
  ];

  /* keep a selected tag reachable even when it sits past the cut */
  if (!tagsExpanded && filter.tag && !shown.some((t) => t.tag === filter.tag)) {
    const active = tags.find((t) => t.tag === filter.tag);
    if (active) {
      chips.push(
        pill('tag', active.tag, `${active.tag} ${active.count}`, true, () => {
          setState({ filter: { ...getState().filter, tag: null } });
          render();
        })
      );
    }
  }

  if (hiddenCount > 0 || tagsExpanded) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'pill pill--toggle';
    toggle.textContent = tagsExpanded ? 'Show less' : `Show ${hiddenCount} more`;
    toggle.setAttribute('aria-expanded', String(tagsExpanded));
    toggle.addEventListener('click', () => { tagsExpanded = !tagsExpanded; renderFilters(); });
    chips.push(toggle);
  }

  el.tags.replaceChildren(...chips);
}

/**
 * A filter pill built on a native radio input.
 * @param {string} group
 * @param {string} value
 * @param {string} label
 * @param {boolean} checked
 * @param {(value: string) => void} onPick
 * @returns {HTMLLabelElement}
 */
function pill(group, value, label, checked, onPick) {
  const wrap = document.createElement('label');
  wrap.className = 'pill';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = `filter-${group}`;
  input.value = value;
  input.checked = checked;
  input.className = 'pill__input';
  input.addEventListener('change', () => { if (input.checked) onPick(value); });

  const text = document.createElement('span');
  text.className = 'pill__text';
  text.textContent = label;

  wrap.append(input, text);
  return wrap;
}

function renderList() {
  const { setsStatus, favs, playing } = getState();

  if (setsStatus === 'loading') {
    el.list.replaceChildren(
      ...Array.from({ length: 6 }, () => {
        const row = document.createElement('li');
        row.className = 'skeleton';
        row.innerHTML = '<span class="skeleton__thumb"></span><span class="skeleton__lines"><span></span><span></span></span>';
        return row;
      })
    );
    return;
  }

  if (setsStatus === 'error') {
    el.list.replaceChildren(el.errorState);
    el.errorState.hidden = false;
    return;
  }

  let items = sets.visible();
  if (shuffled) {
    if (shuffleOrder.length !== items.length) {
      shuffleOrder = items.map((s) => s.id);
      for (let i = shuffleOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
      }
    }
    const byId = new Map(items.map((s) => [s.id, s]));
    items = shuffleOrder.map((id) => byId.get(id)).filter(Boolean);
  }

  if (!items.length) {
    el.emptyState.hidden = false;
    el.emptyState.querySelector('[data-empty-text]').textContent = getState().sets.length
      ? 'Nothing matches that filter.'
      : 'No sets yet. Run node scripts/update-sets.mjs.';
    el.list.replaceChildren(el.emptyState);
    return;
  }

  el.list.replaceChildren(...items.map((set) => row(set, favs.includes(set.id), playing === set.id)));
}

/**
 * @param {import('../state.js').DjSet} set
 * @param {boolean} isFav
 * @param {boolean} isPlaying
 * @returns {HTMLElement}
 */
function row(set, isFav, isPlaying) {
  const li = document.createElement('li');
  li.className = 'set' + (isPlaying ? ' is-playing' : '');

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'set__open';
  openBtn.addEventListener('click', () => openSet(set));

  const thumbUrl = sets.thumbOf(set);
  const thumb = document.createElement('span');
  thumb.className = 'set__thumb';
  if (thumbUrl) {
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    thumb.append(img);
  }
  const dur = sets.duration(set.durationMs);
  if (dur) {
    const badge = document.createElement('span');
    badge.className = 'set__duration';
    badge.textContent = dur;
    thumb.append(badge);
  }

  const body = document.createElement('span');
  body.className = 'set__body';
  const title = document.createElement('span');
  title.className = 'set__title';
  title.textContent = set.title;
  const meta = document.createElement('span');
  meta.className = 'set__meta';
  meta.textContent = [set.channel, sets.relativeDate(set.published)].filter(Boolean).join(' · ');
  body.append(title, meta);

  openBtn.append(thumb, body);

  const fav = document.createElement('button');
  fav.type = 'button';
  fav.className = 'set__fav' + (isFav ? ' is-on' : '');
  fav.setAttribute('aria-pressed', String(isFav));
  fav.setAttribute('aria-label', isFav ? `Remove ${set.title} from favourites` : `Add ${set.title} to favourites`);
  fav.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.6-7-9.3A4 4 0 0 1 12 7.8 4 4 0 0 1 19 10.7c0 4.7-7 9.3-7 9.3z"/></svg>';
  fav.addEventListener('click', () => { toggleFavourite(set.id); render(); });

  const ext = document.createElement('a');
  ext.className = 'set__ext';
  ext.href = player.externalUrl(set);
  ext.target = '_blank';
  ext.rel = 'noopener';
  ext.setAttribute('aria-label', `Open  on YouTube`);
  ext.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>';

  const actions = document.createElement('span');
  actions.className = 'set__actions';
  actions.append(fav, ext);

  li.append(openBtn, actions);
  return li;
}
