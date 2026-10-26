/* ==========================================================================
   Deep Work — focus timer + DJ sets (YouTube and SoundCloud)
   Plain ES2020, no dependencies, no build step.
   ========================================================================== */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- storage ----------------------------------------------------
   Every read and write is wrapped: localStorage throws in private windows,
   with site data blocked, and when the quota is full.                     */
const LS = {
  get(k, fallback) {
    try { const raw = localStorage.getItem(k); return raw === null ? fallback : JSON.parse(raw); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k)    { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const K = {
  settings:'dw.settings', task:'dw.task', subs:'dw.subs',
  timer:'dw.timer', stats:'dw.stats', favs:'dw.favs', seenSc:'dw.seenScHint',
};

const DEFAULTS = {
  focus:50, short:10, long:20, longEvery:4, autoStart:false,
  theme:'dark', accent:'violet',
  volume:0.6, focusChime:'bell', breakChime:'marimba', warn:true, notify:false,
};

let settings = { ...DEFAULTS, ...LS.get(K.settings, {}) };
const saveSettings = () => LS.set(K.settings, settings);

/* ---------- theme + accent --------------------------------------------- */
function applyTheme() {
  document.documentElement.dataset.theme  = settings.theme;
  document.documentElement.dataset.accent = settings.accent;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = settings.theme === 'dark' ? '#0a0a0c' : '#f4f4f7';
  $$('#accents .swatch').forEach(b => b.classList.toggle('is-on', b.dataset.accent === settings.accent));
}
function toggleTheme() {
  settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
  saveSettings(); applyTheme();
}

/* Hex of the current accent, for the SoundCloud widget's color param. */
function accentHex() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  if (v.startsWith('#')) return v.slice(1);
  const m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('') : '7c5cff';
}

/* ---------- toast ------------------------------------------------------- */
let toastTimer;
function toast(msg, ms = 3600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}

/* ==========================================================================
   AUDIO — every chime is synthesised, so there are no files and nothing
   copyrighted. One AudioContext, created lazily on first user gesture.
   ========================================================================== */
let actx = null;
function ac() {
  if (!actx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    actx = new C();
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {});
  return actx;
}

/** Shared output stage: master gain + a touch of stereo width. */
function bus(ctx, gain) {
  const out = ctx.createGain();
  out.gain.value = gain;
  out.connect(ctx.destination);
  return out;
}

const CHIMES = {
  /* Soft bell: inharmonic partials over an exponential decay. */
  bell(ctx, t, out) {
    const partials = [[1, 1, 3.4], [2.02, .42, 2.4], [3.01, .22, 1.7], [4.18, .12, 1.1]];
    const f0 = 587.33; // D5
    partials.forEach(([mult, amp, dur]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f0 * mult;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * .5, t + .006);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + .05);
    });
  },

  /* Warm synth pad: detuned chord through a slowly opening lowpass. */
  pad(ctx, t, out) {
    const chord = [174.61, 220, 261.63, 329.63]; // F / A / C / E
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = .8;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(1900, t + 1.1);
    lp.frequency.linearRampToValueAtTime(500, t + 3.4);
    lp.connect(out);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(.26, t + .7);
    env.gain.setValueAtTime(.26, t + 1.8);
    env.gain.exponentialRampToValueAtTime(.0001, t + 3.6);
    env.connect(lp);

    chord.forEach((f, i) => {
      [-5, 5].forEach(cents => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = i % 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = f; o.detune.value = cents;
        g.gain.value = .22 / chord.length;
        o.connect(g); g.connect(env); o.start(t); o.stop(t + 3.7);
      });
    });
  },

  /* Two-tone marimba: a fast-decaying sine plus a quiet 4th harmonic. */
  marimba(ctx, t, out) {
    [[523.25, 0], [783.99, .135]].forEach(([f, off]) => {
      const t0 = t + off;
      [[1, .5, .55], [4, .07, .18]].forEach(([mult, amp, dur]) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * mult;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(amp, t0 + .004);
        g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
        o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + .05);
      });
    });
  },

  /* Deep 808: pitch drops fast from 140 Hz to 45 Hz, soft-clipped. */
  sub(ctx, t, out) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;

    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + .36);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(.85, t + .012);
    g.gain.exponentialRampToValueAtTime(.0001, t + 1.5);

    o.connect(g); g.connect(shaper); shaper.connect(out);
    o.start(t); o.stop(t + 1.6);

    /* a little click so it reads on laptop speakers too */
    const c = ctx.createOscillator(); const cg = ctx.createGain();
    c.type = 'triangle'; c.frequency.value = 900;
    cg.gain.setValueAtTime(.18, t); cg.gain.exponentialRampToValueAtTime(.0001, t + .05);
    c.connect(cg); cg.connect(out); c.start(t); c.stop(t + .06);
  },
};

function playChime(name, scale = 1) {
  const ctx = ac(); if (!ctx) return;
  const fn = CHIMES[name] || CHIMES.bell;
  fn(ctx, ctx.currentTime + .02, bus(ctx, Math.max(0, settings.volume) * scale));
}

/* ==========================================================================
   NOTIFICATIONS — permission is only ever requested when the toggle is
   switched on, never on page load.
   ========================================================================== */
async function enableNotifications() {
  if (!('Notification' in window)) { toast('This browser has no notification support.'); return false; }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    toast('Notifications are blocked for this site in your browser settings.');
    return false;
  }
  const res = await Notification.requestPermission();
  return res === 'granted';
}
function notify(title, body) {
  if (!settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, silent: true, tag: 'deep-work' }); } catch { /* ignore */ }
}

/* ==========================================================================
   TIMER
   The source of truth while running is `endsAt`, an absolute timestamp.
   Remaining time is always (endsAt - now), so throttled background tabs,
   sleep and tab switches cannot make the clock drift.
   ========================================================================== */
const MODE_LABEL = { focus:'Focus', short:'Short break', long:'Long break' };

const timer = Object.assign(
  { mode:'focus', running:false, endsAt:null, remaining:settings.focus * 60000, cycle:0, warned:false },
  LS.get(K.timer, {})
);
const saveTimer = () => LS.set(K.timer, timer);

const phaseMs = mode => Math.max(1, Math.min(600, Number(settings[mode]) || DEFAULTS[mode])) * 60000;
const remainingMs = () =>
  timer.running && timer.endsAt ? Math.max(0, timer.endsAt - Date.now()) : Math.max(0, timer.remaining);

function start() {
  if (timer.running) return;
  if (timer.remaining <= 0) timer.remaining = phaseMs(timer.mode);
  timer.endsAt = Date.now() + timer.remaining;
  timer.running = true;
  ac();                     // unlock audio while we still have the gesture
  saveTimer(); render();
}
function pause() {
  if (!timer.running) return;
  timer.remaining = remainingMs();
  timer.running = false; timer.endsAt = null;
  saveTimer(); render();
}
const toggle = () => (timer.running ? pause() : start());

function setMode(mode, { keepRunning = false } = {}) {
  timer.mode = mode;
  timer.remaining = phaseMs(mode);
  timer.warned = false;
  timer.running = keepRunning;
  timer.endsAt = keepRunning ? Date.now() + timer.remaining : null;
  saveTimer(); render();
}
function reset() { setMode(timer.mode); }

/** Move to the next phase. `completed` means the phase actually ran out. */
function advance(completed) {
  let next;
  if (timer.mode === 'focus') {
    if (completed) {
      stats.sessions += 1;
      stats.focusMs  += phaseMs('focus');
      timer.cycle    += 1;
      saveStats();
    }
    const every = Math.max(1, Number(settings.longEvery) || 4);
    next = (timer.cycle > 0 && timer.cycle % every === 0) ? 'long' : 'short';
  } else {
    next = 'focus';
  }
  setMode(next, { keepRunning: completed && settings.autoStart });
  renderStats();
}

function finishPhase() {
  const wasFocus = timer.mode === 'focus';
  playChime(wasFocus ? settings.focusChime : settings.breakChime);
  notify(
    wasFocus ? 'Focus session done' : 'Break over',
    wasFocus ? `${fmtMinutes(phaseMs('focus'))} logged. Time to step away.` : 'Back to it.'
  );
  advance(true);
}

/* ---------- today's stats, rolled over at local midnight ---------------- */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const stats = Object.assign({ date: todayKey(), sessions: 0, focusMs: 0 }, LS.get(K.stats, {}));
const saveStats = () => LS.set(K.stats, stats);
function rollOverIfNewDay() {
  if (stats.date !== todayKey()) {
    stats.date = todayKey(); stats.sessions = 0; stats.focusMs = 0;
    saveStats(); renderStats();
  }
}

/* ---------- formatting -------------------------------------------------- */
function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
const fmtMinutes = ms => `${Math.round(ms / 60000)} min`;
function fmtTimeOfDay(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* ---------- render ------------------------------------------------------ */
const el = {
  time: $('#time'), now: $('#now'), modeLabel: $('#modeLabel'), ring: $('#ringFill'),
  startLabel: $('#btnStartLabel'), cycle: $('#cycle'),
  statSessions: $('#statSessions'), statMinutes: $('#statMinutes'),
};

function renderStats() {
  el.statSessions.textContent = stats.sessions;
  el.statMinutes.textContent  = Math.round(stats.focusMs / 60000);
}

function renderCycle() {
  const every = Math.max(1, Number(settings.longEvery) || 4);
  const done  = timer.cycle % every;
  if (el.cycle.children.length !== every) {
    el.cycle.replaceChildren(...Array.from({ length: every }, () => {
      const d = document.createElement('span'); d.className = 'dot'; return d;
    }));
  }
  [...el.cycle.children].forEach((d, i) => d.classList.toggle('is-on', i < done));
}

function render() {
  const left  = remainingMs();
  const total = phaseMs(timer.mode);
  const label = MODE_LABEL[timer.mode];

  el.time.textContent      = fmtClock(left);
  el.modeLabel.textContent = label;
  el.startLabel.textContent = timer.running ? 'Pause' : (left < total ? 'Resume' : 'Start');

  /* pathLength="1" means the dash offset is simply 1 - progress */
  const progress = total > 0 ? 1 - (left / total) : 0;
  el.ring.setAttribute('stroke-dashoffset', String(Math.max(0, Math.min(1, 1 - progress))));

  document.body.classList.toggle('is-running', timer.running);
  document.body.classList.toggle('is-ending', timer.running && left > 0 && left <= 60000);

  $$('.modes .chip').forEach(c => c.classList.toggle('is-on', c.dataset.mode === timer.mode));

  document.title = timer.running || left < total
    ? `${fmtClock(left)} · ${label}`
    : 'Deep Work';

  renderCycle();
}

/* ---------- the loop ---------------------------------------------------
   250 ms is plenty: the display only needs 1 s resolution, and accuracy
   comes from the stored timestamp rather than from tick counting.        */
function tick() {
  rollOverIfNewDay();
  el.now.textContent = fmtTimeOfDay(new Date());

  if (timer.running) {
    const left = remainingMs();

    if (settings.warn && !timer.warned && left <= 60000 && left > 0) {
      timer.warned = true;
      playChime('bell', .35);
      saveTimer();
    }
    if (left <= 0) { finishPhase(); return; }
  }
  render();
}

/* Restore: if the stored end time has already passed, the phase finished
   while the tab was closed. Count it, but stay paused and stay quiet. */
function restoreTimer() {
  if (timer.running && timer.endsAt) {
    if (timer.endsAt <= Date.now()) {
      const wasFocus = timer.mode === 'focus';
      timer.running = false; timer.endsAt = null; timer.remaining = 0;
      advance(true);
      toast(wasFocus ? 'That focus session finished while you were away — logged.' : 'That break finished while you were away.');
      return;
    }
    timer.remaining = remainingMs();
  } else {
    timer.running = false; timer.endsAt = null;
    if (!(timer.remaining > 0)) timer.remaining = phaseMs(timer.mode);
    /* a duration change in settings should not leave a stale longer value */
    timer.remaining = Math.min(timer.remaining, phaseMs(timer.mode));
  }
  saveTimer();
}

/* ==========================================================================
   TASK + SUB-TASKS
   ========================================================================== */
const MAX_SUBS = 3;
function initTask() {
  const input = $('#task');
  input.value = LS.get(K.task, '');
  const commit = () => LS.set(K.task, input.value.trim());
  input.addEventListener('input', commit);
  input.addEventListener('change', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); input.blur(); } });

  const subs = LS.get(K.subs, []);
  const saveSubs = () => LS.set(K.subs, subs);
  const list = $('#subs');

  for (let i = 0; i < MAX_SUBS; i++) {
    subs[i] = subs[i] || { text: '', done: false };

    const li = document.createElement('li');
    li.className = 'sub' + (subs[i].done ? ' is-done' : '');

    const lab = document.createElement('label');
    lab.className = 'cb';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!subs[i].done;
    cb.setAttribute('aria-label', `Sub-task ${i + 1} done`);
    const ui = document.createElement('span'); ui.className = 'cb__ui';
    lab.append(cb, ui);

    const txt = document.createElement('input');
    txt.type = 'text'; txt.maxLength = 90; txt.value = subs[i].text;
    txt.placeholder = i === 0 ? 'Add a step…' : '';
    txt.setAttribute('aria-label', `Sub-task ${i + 1}`);

    cb.addEventListener('change', () => {
      subs[i].done = cb.checked;
      li.classList.toggle('is-done', cb.checked);
      saveSubs();
    });
    const commitSub = () => { subs[i].text = txt.value; saveSubs(); };
    txt.addEventListener('input', commitSub);
    txt.addEventListener('keydown', e => { if (e.key === 'Enter') { commitSub(); txt.blur(); } });

    li.append(lab, txt);
    list.append(li);
  }
  saveSubs();
}

/* ==========================================================================
   DJ SETS PANEL — YouTube videos and SoundCloud tracks/playlists in one list
   ========================================================================== */
let allSets = [];
let view    = [];
let favs    = new Set(LS.get(K.favs, []));
let filter  = { tag: null, source: 'all' };
let playing = null;

const saveFavs = () => LS.set(K.favs, [...favs]);

const SRC_ICON = {
  youtube: '<svg viewBox="0 0 24 24"><path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.9 12 4.9 12 4.9s-6 0-7.7.4A2.7 2.7 0 0 0 2.4 7.2C2 8.9 2 12 2 12s0 3.1.4 4.8a2.7 2.7 0 0 0 1.9 1.9c1.7.4 7.7.4 7.7.4s6 0 7.7-.4a2.7 2.7 0 0 0 1.9-1.9c.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8z"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>',
  soundcloud: '<svg viewBox="0 0 24 24"><path d="M3 15v-4M6 16V9M9 16.5V7.5M12 16.5v-9a5 5 0 0 1 9 3"/><path d="M12 17h7.5a2.5 2.5 0 0 0 0-5H19"/></svg>',
};

/** Thumbnail URL. YouTube's is derivable; SoundCloud's comes from the data. */
function thumbOf(s) {
  if (s.thumb) return s.thumb;
  if (s.source === 'youtube') return `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`;
  return '';
}

/** The page to open when you click ↗. */
function linkOf(s) {
  return s.url || (s.source === 'youtube' ? `https://www.youtube.com/watch?v=${s.videoId}` : '#');
}

/** The embed URL for the docked player. */
function embedOf(s) {
  if (s.source === 'youtube') {
    const p = new URLSearchParams({ autoplay:'1', rel:'0', modestbranding:'1', playsinline:'1' });
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(s.videoId)}?${p}`;
  }
  /* SoundCloud's widget. It is a real soundcloud.com page in an iframe, so if
     you are signed in to SoundCloud in this browser it plays as you — this
     site neither sees nor stores any SoundCloud credentials. */
  const p = new URLSearchParams({
    url: s.url, auto_play:'true', hide_related:'true', show_comments:'false',
    show_user:'true', show_reposts:'false', show_teaser:'false', visual:'false',
    color: `#${accentHex()}`,
  });
  return `https://w.soundcloud.com/player/?${p}`;
}

function fmtAgo(iso) {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30)  return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
function fmtDur(ms) {
  if (!ms) return '';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`;
}

function applyFilter() {
  view = allSets.filter(s => {
    if (filter.source === 'favs') { if (!favs.has(s.id)) return false; }
    else if (filter.source !== 'all' && s.source !== filter.source) return false;
    if (filter.tag && !(s.tags || []).includes(filter.tag)) return false;
    return true;
  });
  renderSets();
}

function renderSourceChips() {
  const counts = {
    youtube: allSets.filter(s => s.source === 'youtube').length,
    soundcloud: allSets.filter(s => s.source === 'soundcloud').length,
  };
  const defs = [
    { key:'all',        label:`All · ${allSets.length}` },
    { key:'youtube',    label:`YouTube · ${counts.youtube}`,       ico:'youtube' },
    { key:'soundcloud', label:`SoundCloud · ${counts.soundcloud}`, ico:'soundcloud' },
    { key:'favs',       label:`Favourites · ${favs.size}` },
  ];
  const wrap = $('#sources');
  wrap.replaceChildren(...defs.map(d => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (filter.source === d.key ? ' is-on' : '');
    b.innerHTML = (d.ico ? `<span class="chip__ico">${SRC_ICON[d.ico]}</span>` : '') + d.label;
    b.addEventListener('click', () => { filter.source = d.key; renderSourceChips(); applyFilter(); });
    return b;
  }));
}

function renderTagChips() {
  const counts = new Map();
  allSets.forEach(s => (s.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 18);

  const wrap = $('#chips');
  const mk = (key, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + ((filter.tag === key) ? ' is-on' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      filter.tag = (filter.tag === key) ? null : key;
      renderTagChips(); applyFilter();
    });
    return b;
  };
  wrap.replaceChildren(mk(null, 'Everything'), ...top.map(([t, n]) => mk(t, `${t} ${n}`)));
}

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.6-7-9.3A4 4 0 0 1 12 7.8 4 4 0 0 1 19 10.7c0 4.7-7 9.3-7 9.3z"/></svg>';
const EXT   = '<svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>';

function renderSets() {
  const wrap = $('#sets');

  if (!view.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.innerHTML = allSets.length
      ? 'Nothing matches that filter.'
      : `No sets yet.<br>Run the updater once to fill the list:<br><code>node scripts/update-sets.mjs</code>`;
    wrap.replaceChildren(d);
    $('#setsMeta').textContent = allSets.length ? '' : 'data/sets.json is empty';
    return;
  }

  wrap.replaceChildren(...view.map(s => {
    const row = document.createElement('div');
    row.className = 'set' + (playing === s.id ? ' is-playing' : '');

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'set';
    card.style.display = 'contents';          /* the grid lives on .set */
    card.setAttribute('aria-label', `Play ${s.title}`);

    const thumbUrl = thumbOf(s);
    const thumb = document.createElement('div');
    thumb.className = 'set__thumb';
    thumb.innerHTML =
      (thumbUrl ? `<img loading="lazy" decoding="async" alt="" src="${thumbUrl}">` : '') +
      `<span class="set__badge" title="${s.source}">${SRC_ICON[s.source] || ''}</span>` +
      (s.durationMs ? `<span class="set__dur">${fmtDur(s.durationMs)}</span>` : '');

    const body = document.createElement('div');
    body.className = 'set__body';
    const t = document.createElement('div'); t.className = 'set__title'; t.textContent = s.title;
    const sub = document.createElement('div'); sub.className = 'set__sub';
    const ago = fmtAgo(s.published);
    sub.innerHTML = `${escapeHtml(s.channel || '')}${ago ? ` · <span class="set__date">${ago}</span>` : ''}`;
    body.append(t, sub);

    const acts = document.createElement('div');
    acts.className = 'set__acts';

    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'set__fav' + (favs.has(s.id) ? ' is-on' : '');
    fav.innerHTML = HEART;
    fav.title = favs.has(s.id) ? 'Remove from favourites' : 'Add to favourites';
    fav.setAttribute('aria-label', fav.title);
    fav.addEventListener('click', e => {
      e.stopPropagation();
      favs.has(s.id) ? favs.delete(s.id) : favs.add(s.id);
      saveFavs();
      fav.classList.toggle('is-on', favs.has(s.id));
      renderSourceChips();
      if (filter.source === 'favs') applyFilter();
    });

    const ext = document.createElement('a');
    ext.className = 'set__ext';
    ext.href = linkOf(s); ext.target = '_blank'; ext.rel = 'noopener';
    ext.innerHTML = EXT;
    ext.title = `Open on ${s.source === 'youtube' ? 'YouTube' : 'SoundCloud'}`;
    ext.setAttribute('aria-label', ext.title);
    ext.addEventListener('click', e => e.stopPropagation());

    acts.append(fav, ext);

    row.append(thumb, body, acts);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Play ${s.title}`);
    row.addEventListener('click', () => play(s));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(s); }
    });
    return row;
  }));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function play(s) {
  playing = s.id;
  $('#player').hidden = false;
  $('#playerFrame').dataset.source = s.source;
  $('#playerIframe').src = embedOf(s);
  $('#playerTitle').textContent = s.title;
  const open = $('#playerOpen');
  open.href = linkOf(s);
  open.title = `Open on ${s.source === 'youtube' ? 'YouTube' : 'SoundCloud'}`;
  renderSets();

  /* Explain the third-party-cookie caveat once, the first time a
     SoundCloud set is played. */
  if (s.source === 'soundcloud' && !LS.get(K.seenSc, false)) {
    LS.set(K.seenSc, true);
    toast('Playing via the SoundCloud widget. Signed in at soundcloud.com in this browser? Then this plays as you. If not, allow third-party cookies for soundcloud.com, or use ↗ to open it in a tab.', 9000);
  }
}

function stopPlayer() {
  playing = null;
  $('#playerIframe').src = 'about:blank';
  $('#player').hidden = true;
  renderSets();
}

function shuffleView() {
  for (let i = view.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [view[i], view[j]] = [view[j], view[i]];
  }
  renderSets();
  $('#sets').scrollTop = 0;
}

function surprise() {
  const pool = view.length ? view : allSets;
  if (!pool.length) { toast('No sets loaded yet.'); return; }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  play(pick);
  openPanel(true);
}

/* ---------- load data/sets.json ---------------------------------------- */
async function loadSets() {
  try {
    const res = await fetch('data/sets.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status}`);
    const json = await res.json();

    /* Accept either {updatedAt, sets:[…]} or a bare array. */
    const list = Array.isArray(json) ? json : (json.sets || []);
    const updatedAt = Array.isArray(json) ? null : json.updatedAt;

    allSets = list.filter(s => s && s.id && s.title && (s.videoId || s.url));
    allSets.sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0));

    const ago = fmtAgo(updatedAt);
    $('#setsMeta').textContent = updatedAt
      ? `${allSets.length} sets · updated ${ago}`
      : `${allSets.length} sets`;

    renderSourceChips(); renderTagChips(); applyFilter();
  } catch (err) {
    allSets = [];
    renderSourceChips(); renderTagChips(); applyFilter();
    $('#setsMeta').textContent = 'could not load data/sets.json';
    console.warn('[deep work] sets.json failed to load:', err);
  }
}

/* ---------- panel open/close (drawer on narrow and portrait) ----------- */
function panelIsDrawer() {
  return window.matchMedia('(max-width:1080px), (orientation:portrait)').matches;
}
function openPanel(force) {
  const p = $('#panel');
  const next = force !== undefined ? force : !p.classList.contains('is-open');
  p.classList.toggle('is-open', next);
  $('#btnPanel').classList.toggle('is-on', next && panelIsDrawer());
}

/* ==========================================================================
   FOCUS MODE
   ========================================================================== */
let nudgeTimer;
function toggleFocusMode(force) {
  const on = force !== undefined ? force : !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode', on);
  $('#btnFull').classList.toggle('is-on', on);

  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }
}
/* Reveal the controls briefly on any pointer movement in focus mode. */
document.addEventListener('pointermove', () => {
  if (!document.body.classList.contains('focus-mode')) return;
  document.body.classList.add('is-nudged');
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => document.body.classList.remove('is-nudged'), 2200);
}, { passive: true });

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) toggleFocusMode(false);
});

/* ==========================================================================
   SETTINGS MODAL
   ========================================================================== */
function syncSettingsForm() {
  $('#setFocus').value     = settings.focus;
  $('#setShort').value     = settings.short;
  $('#setLong').value      = settings.long;
  $('#setLongEvery').value = settings.longEvery;
  $('#setAuto').checked    = !!settings.autoStart;
  $('#setVolume').value    = settings.volume;
  $('#setFocusChime').value = settings.focusChime;
  $('#setBreakChime').value = settings.breakChime;
  $('#setWarn').checked    = !!settings.warn;
  $('#setNotify').checked  = !!settings.notify;
}

function initSettings() {
  syncSettingsForm();

  const num = (id, key, min, max) => {
    $(id).addEventListener('change', () => {
      const v = Math.round(Number($(id).value));
      settings[key] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULTS[key];
      $(id).value = settings[key];
      saveSettings();
      /* a duration change takes effect immediately on an idle phase */
      if (!timer.running && ['focus','short','long'].includes(key) && key === timer.mode) reset();
      render();
    });
  };
  num('#setFocus', 'focus', 1, 240);
  num('#setShort', 'short', 1, 120);
  num('#setLong',  'long',  1, 180);
  num('#setLongEvery', 'longEvery', 1, 12);

  $('#setAuto').addEventListener('change', e => { settings.autoStart = e.target.checked; saveSettings(); });

  $('#setVolume').addEventListener('input', e => { settings.volume = Number(e.target.value); saveSettings(); });
  $('#setVolume').addEventListener('change', () => playChime(settings.focusChime, .6));

  $('#setFocusChime').addEventListener('change', e => {
    settings.focusChime = e.target.value; saveSettings(); playChime(settings.focusChime);
  });
  $('#setBreakChime').addEventListener('change', e => {
    settings.breakChime = e.target.value; saveSettings(); playChime(settings.breakChime);
  });
  $$('[data-preview]').forEach(b => b.addEventListener('click', () => {
    playChime($('#' + b.dataset.preview).value);
  }));

  $('#setWarn').addEventListener('change', e => { settings.warn = e.target.checked; saveSettings(); });

  $('#setNotify').addEventListener('change', async e => {
    if (e.target.checked) {
      const ok = await enableNotifications();
      settings.notify = ok;
      e.target.checked = ok;
      $('#notifyHint').hidden = ok;
      if (!ok) $('#notifyHint').textContent = 'Permission was not granted, so notifications stay off.';
    } else {
      settings.notify = false;
      $('#notifyHint').hidden = true;
    }
    saveSettings();
  });

  $$('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const [f, s, l] = b.dataset.preset.split(',').map(Number);
    Object.assign(settings, { focus:f, short:s, long:l });
    saveSettings(); syncSettingsForm();
    if (!timer.running) reset(); else render();
  }));

  $$('#accents .swatch').forEach(b => b.addEventListener('click', () => {
    settings.accent = b.dataset.accent; saveSettings(); applyTheme();
    /* keep an open SoundCloud player in the new accent colour */
    if (playing) {
      const s = allSets.find(x => x.id === playing);
      if (s && s.source === 'soundcloud') $('#playerIframe').src = embedOf(s);
    }
  }));

  $('#btnWipe').addEventListener('click', () => {
    if (!confirm('Clear the task, settings, favourites and today\'s totals?')) return;
    Object.values(K).forEach(LS.del);
    location.reload();
  });
}

/* ==========================================================================
   KEYBOARD
   ========================================================================== */
function isTyping(e) {
  const t = e.target;
  return t instanceof HTMLElement &&
    (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'Escape') {
    if (document.body.classList.contains('focus-mode')) { toggleFocusMode(false); return; }
    if ($('#panel').classList.contains('is-open') && panelIsDrawer()) { openPanel(false); return; }
  }
  if (isTyping(e)) return;
  if ($('#dlgSettings').open || $('#dlgHelp').open) return;

  switch (e.key) {
    case ' ': case 'Spacebar': e.preventDefault(); toggle(); break;
    case 'r': case 'R': reset(); break;
    case 's': case 'S': advance(false); break;
    case 'f': case 'F': toggleFocusMode(); break;
    case 't': case 'T': toggleTheme(); break;
    case 'd': case 'D': openPanel(); break;
    case 'x': case 'X': surprise(); break;
    case '?': $('#dlgHelp').showModal(); break;
    default: break;
  }
});

/* ==========================================================================
   WIRE UP + START
   ========================================================================== */
function init() {
  applyTheme();
  initTask();
  initSettings();

  restoreTimer();
  renderStats();
  render();
  tick();
  setInterval(tick, 250);

  /* Catch up immediately when the tab becomes visible again. */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  $('#btnStart').addEventListener('click', toggle);
  $('#btnReset').addEventListener('click', reset);
  $('#btnSkip').addEventListener('click', () => advance(false));
  $('#btnTheme').addEventListener('click', toggleTheme);
  $('#btnFull').addEventListener('click', () => toggleFocusMode());
  $('#btnHelp').addEventListener('click', () => $('#dlgHelp').showModal());
  $('#btnSettings').addEventListener('click', () => { syncSettingsForm(); $('#dlgSettings').showModal(); });

  $$('.modes .chip').forEach(c => c.addEventListener('click', () => setMode(c.dataset.mode)));

  $('#btnPanel').addEventListener('click', () => openPanel());
  $('#btnPanelClose').addEventListener('click', () => openPanel(false));
  $('#btnShuffle').addEventListener('click', shuffleView);
  $('#btnSurprise').addEventListener('click', surprise);
  $('#btnStop').addEventListener('click', stopPlayer);

  /* On wide screens the panel is always visible; the class only drives the drawer. */
  if (!panelIsDrawer()) $('#panel').classList.add('is-open');
  window.addEventListener('resize', () => {
    if (!panelIsDrawer()) { $('#panel').classList.add('is-open'); $('#btnPanel').classList.remove('is-on'); }
  });

  /* Persist on the way out, so a crash or a close never loses the phase. */
  window.addEventListener('pagehide', saveTimer);
  window.addEventListener('beforeunload', saveTimer);

  loadSets();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();