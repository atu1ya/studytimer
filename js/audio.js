/**
 * Synthesised chimes and the repeating end-of-phase alarm.
 * No audio files, nothing copyrighted.
 * @module audio
 */

/** @type {AudioContext|null} */
let ctx = null;
let unavailable = false;

/** @returns {boolean} whether Web Audio exists in this browser */
export function isSupported() {
  return typeof (window.AudioContext || window.webkitAudioContext) === 'function';
}

/** @returns {AudioContext|null} */
function audio() {
  if (unavailable) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { unavailable = true; return null; }
    try { ctx = new Ctor(); } catch { unavailable = true; return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Unlock audio during a user gesture, so the alarm can sound later. */
export function warmUp() {
  audio();
}

/**
 * @param {AudioContext} ac
 * @param {number} gain
 * @returns {GainNode}
 */
function bus(ac, gain) {
  const out = ac.createGain();
  out.gain.value = gain;
  out.connect(ac.destination);
  return out;
}

/**
 * @typedef {(ac: AudioContext, t: number, out: GainNode) => number} Chime
 *   draws the sound and returns its length in seconds
 * @type {Record<import('./state.js').ChimeName, Chime>}
 */
export const CHIMES = {
  /**
   * Dub siren: a pitch sweep with vibrato through a resonant filter into a
   * feedback delay. Deliberately the loudest and longest option — this is
   * the default alarm, and it is meant to cut through music.
   */
  siren(ac, t, out) {
    const delay = ac.createDelay(1);
    delay.delayTime.value = 0.19;
    const fb = ac.createGain();
    fb.gain.value = 0.42;
    const wet = ac.createGain();
    wet.gain.value = 0.4;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(out);

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2800;
    lp.Q.value = 4;
    lp.connect(out);
    lp.connect(delay);

    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    const f = osc.frequency;
    f.setValueAtTime(420, t);
    f.exponentialRampToValueAtTime(1500, t + 0.18);
    f.exponentialRampToValueAtTime(880, t + 0.36);
    f.exponentialRampToValueAtTime(1700, t + 0.56);
    f.exponentialRampToValueAtTime(760, t + 0.8);
    f.exponentialRampToValueAtTime(1450, t + 1.0);

    /* vibrato gives it the hand-wobbled siren character */
    const lfo = ac.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 55;
    lfo.connect(lfoGain);
    lfoGain.connect(f);

    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.03);
    env.gain.setValueAtTime(0.5, t + 0.95);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    osc.connect(env);
    env.connect(lp);

    osc.start(t); osc.stop(t + 1.3);
    lfo.start(t); lfo.stop(t + 1.3);
    return 1.8; // including the echo tail
  },

  /** UK garage: syncopated drawbar-organ stabs over a sub, with a hat skip. */
  ukg(ac, t, out) {
    const chord = [185.0, 220.0, 277.18, 329.63]; // F#m add9
    const drawbars = [[1, 1], [2, 0.55], [3, 0.3], [4, 0.18]];

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 7;
    lp.connect(out);

    const stab = (t0, gain, cutoff) => {
      lp.frequency.setValueAtTime(cutoff, t0);
      lp.frequency.exponentialRampToValueAtTime(cutoff * 0.4, t0 + 0.3);
      const env = ac.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(gain, t0 + 0.007);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.33);
      env.connect(lp);
      for (const f of chord) {
        for (const [mult, amp] of drawbars) {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = 'sine';
          osc.frequency.value = f * mult;
          osc.detune.value = Math.random() * 9 - 4.5;
          g.gain.value = amp * 0.11;
          osc.connect(g); g.connect(env);
          osc.start(t0); osc.stop(t0 + 0.4);
        }
      }
    };
    const sub = (t0, gain) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = 92.5;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(g); g.connect(out);
      osc.start(t0); osc.stop(t0 + 0.3);
    };
    const hat = (t0, gain) => {
      const len = Math.floor(ac.sampleRate * 0.05);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ac.createBufferSource();
      src.buffer = buf;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7200;
      const g = ac.createGain();
      g.gain.value = gain;
      src.connect(hp); hp.connect(g); g.connect(out);
      src.start(t0);
    };

    stab(t, 0.85, 2600); sub(t, 0.5);
    hat(t + 0.145, 0.06);
    stab(t + 0.285, 0.5, 1900);
    hat(t + 0.4, 0.045);
    stab(t + 0.465, 0.8, 2400); sub(t + 0.465, 0.45);
    hat(t + 0.62, 0.055);
    return 1.0;
  },

  /** Soft bell: inharmonic partials over an exponential decay. */
  bell(ac, t, out) {
    const f0 = 587.33; // D5
    for (const [mult, amp, dur] of [[1, 1, 3.4], [2.02, 0.42, 2.4], [3.01, 0.22, 1.7], [4.18, 0.12, 1.1]]) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = f0 * mult;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * 0.5, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + dur + 0.05);
    }
    return 3.4;
  },

  /** Warm pad: detuned chord through a slowly opening lowpass. */
  pad(ac, t, out) {
    const chord = [174.61, 220, 261.63, 329.63];
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(1900, t + 1.1);
    lp.frequency.linearRampToValueAtTime(500, t + 3.4);
    lp.connect(out);

    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.26, t + 0.7);
    env.gain.setValueAtTime(0.26, t + 1.8);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    env.connect(lp);

    chord.forEach((f, i) => {
      for (const cents of [-5, 5]) {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = i % 2 ? 'triangle' : 'sawtooth';
        osc.frequency.value = f;
        osc.detune.value = cents;
        g.gain.value = 0.22 / chord.length;
        osc.connect(g); g.connect(env);
        osc.start(t); osc.stop(t + 3.7);
      }
    });
    return 3.6;
  },

  /** Two-tone marimba: fast-decaying sine plus a quiet 4th harmonic. */
  marimba(ac, t, out) {
    for (const [f, off] of [[523.25, 0], [783.99, 0.135]]) {
      const t0 = t + off;
      for (const [mult, amp, dur] of [[1, 0.5, 0.55], [4, 0.07, 0.18]]) {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = f * mult;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(amp, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(out);
        osc.start(t0); osc.stop(t0 + dur + 0.05);
      }
    }
    return 0.75;
  },

  /** Deep 808: pitch drops fast from 140 Hz to 45 Hz, soft-clipped. */
  sub(ac, t, out) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = i / 512 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.36);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.85, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    osc.connect(g); g.connect(shaper); shaper.connect(out);
    osc.start(t); osc.stop(t + 1.6);

    const click = ac.createOscillator();
    const cg = ac.createGain();
    click.type = 'triangle';
    click.frequency.value = 900;
    cg.gain.setValueAtTime(0.18, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    click.connect(cg); cg.connect(out);
    click.start(t); click.stop(t + 0.06);
    return 1.6;
  },
};

/** Menu labels, in menu order. */
export const CHIME_LABELS = {
  siren: 'Dub siren',
  ukg: 'UKG organ stab',
  bell: 'Soft bell',
  pad: 'Warm synth pad',
  marimba: 'Two-tone marimba',
  sub: 'Deep 808 hit',
};

/**
 * Play a chime once.
 * @param {import('./state.js').ChimeName} name
 * @param {number} volume 0–1
 * @param {number} [scale] relative level, for the quieter warning chime
 * @returns {number} the sound's length in seconds, or 0 if it could not play
 */
export function play(name, volume, scale = 1) {
  const ac = audio();
  if (!ac) return 0;
  const fn = CHIMES[name] || CHIMES.siren;
  try {
    return fn(ac, ac.currentTime + 0.02, bus(ac, Math.max(0, volume) * scale)) || 1;
  } catch {
    return 0;
  }
}

/* ---- repeating alarm ------------------------------------------------
   A single chime is easy to miss over music, so the end of a phase rings
   repeatedly until it is dismissed or the run finishes.                 */

/** @type {number|null} */
let alarmTimer = null;
let ringing = false;
/** @type {Array<() => void>} */
const ringListeners = [];

/** @returns {boolean} */
export function isRinging() {
  return ringing;
}

/** @param {() => void} fn called whenever the ringing state changes */
export function onRingChange(fn) {
  ringListeners.push(fn);
}

function emitRingChange() {
  ringListeners.forEach((fn) => fn());
}

/**
 * Ring until dismissed or `repeats` is reached.
 * @param {import('./state.js').ChimeName} name
 * @param {number} volume
 * @param {{repeats?: number, gapMs?: number}} [opts]
 * @returns {boolean} whether the alarm started
 */
export function startAlarm(name, volume, { repeats = 9, gapMs = 2000 } = {}) {
  stopAlarm();
  if (!isSupported()) return false;

  let fired = 0;
  const fire = () => {
    const length = play(name, volume);
    if (!length) { stopAlarm(); return; }
    fired += 1;
    if (fired >= repeats) { stopAlarm(); return; }
    /* leave a gap after the sound itself, so repeats never overlap */
    alarmTimer = window.setTimeout(fire, Math.max(gapMs, length * 1000 + 250));
  };

  ringing = true;
  emitRingChange();
  fire();
  return ringing;
}

/** Stop the alarm immediately. Safe to call when nothing is ringing. */
export function stopAlarm() {
  if (alarmTimer !== null) {
    clearTimeout(alarmTimer);
    alarmTimer = null;
  }
  if (ringing) {
    ringing = false;
    emitRingChange();
  }
}
