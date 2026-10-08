/**
 * Low-level WebAudio synthesis helpers. Every function takes a BaseAudioContext (real or Offline)
 * so the same code renders in the game, in the dev jukebox and in headless level tests.
 * OWNER: Presentation.
 */

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'C4' → 60, 'F#3' → 54, 'Bb2' → 46. Returns NaN for bad names. */
export function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) return NaN;
  const pc = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + pc;
}

/** Deterministic PRNG so generated buffers are identical every run. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------
// per-context caches
// ------------------------------------------------------------------------------------------------
const cache = new WeakMap();
function store(ctx) {
  let s = cache.get(ctx);
  if (!s) cache.set(ctx, (s = { noise: null, pink: null, waves: new Map(), curves: new Map() }));
  return s;
}

/** 3 s of white noise (mono), cached per context. */
export function noiseBuffer(ctx) {
  const s = store(ctx);
  if (s.noise) return s.noise;
  const len = Math.floor(ctx.sampleRate * 3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(7);
  for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
  return (s.noise = buf);
}

/** 3 s of pink-ish noise (Paul Kellet filter), cached. */
export function pinkBuffer(ctx) {
  const s = store(ctx);
  if (s.pink) return s.pink;
  const len = Math.floor(ctx.sampleRate * 3);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const r = rng(11);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < len; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return (s.pink = buf);
}

/** Looping/one-shot noise source starting at a random offset. */
export function noiseSource(ctx, { pink = false, loop = false, seed = 0 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = pink ? pinkBuffer(ctx) : noiseBuffer(ctx);
  src.loop = loop;
  return src;
}

/** Start a noise source at `t` from a pseudo-random offset (avoids identical hits). */
export function startNoise(src, t, dur, seedOffset = Math.random()) {
  const len = src.buffer.duration;
  const off = seedOffset * Math.max(0, len - dur - 0.05);
  if (src.loop) src.start(t, off);
  else src.start(t, off, dur + 0.05);
}

/** Exponentially decaying stereo impulse response for ConvolverNode reverbs. */
export function impulseResponse(ctx, seconds = 2, decay = 3, { preDelay = 0.012, damp = 0.5 } = {}) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const r = rng(101 + ch * 17);
    let lp = 0;
    const pre = Math.floor(rate * preDelay * (ch ? 1.3 : 1));
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const env = Math.pow(1 - t, decay);
      // progressively darker tail
      const k = lerp(0.9, damp * 0.35, t);
      lp += (r() * 2 - 1 - lp) * k;
      d[i] = lp * env;
    }
  }
  return buf;
}

/** Soft-clip / saturation curve for WaveShaper (cached by amount). */
export function satCurve(ctx, amount = 2) {
  const s = store(ctx);
  const key = amount.toFixed(2);
  let c = s.curves.get(key);
  if (c) return c;
  const n = 1024;
  c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  s.curves.set(key, c);
  return c;
}

/**
 * Pulse wave with duty cycle `d` (0..1) as a PeriodicWave. Fourier: a_n = sin(2πnd)/(nπ), b_n = 2 sin²(πnd)/(nπ).
 */
export function pulseWave(ctx, duty = 0.5) {
  const s = store(ctx);
  const key = `p${duty.toFixed(3)}`;
  let w = s.waves.get(key);
  if (w) return w;
  const N = 64;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    real[n] = Math.sin(2 * Math.PI * n * duty) / (n * Math.PI);
    imag[n] = (2 * Math.sin(Math.PI * n * duty) ** 2) / (n * Math.PI);
  }
  w = ctx.createPeriodicWave(real, imag);
  s.waves.set(key, w);
  return w;
}

/** Set an oscillator's waveform: standard names, or 'pulse:0.25'. */
export function setWave(ctx, osc, type) {
  if (typeof type === 'string' && type.startsWith('pulse')) {
    const d = Number(type.split(':')[1] ?? 0.5);
    osc.setPeriodicWave(pulseWave(ctx, d));
  } else osc.type = type;
}

// ------------------------------------------------------------------------------------------------
// envelope helpers
// ------------------------------------------------------------------------------------------------
const EPS = 0.0001;

/** Attack/decay/sustain/release on a GainNode param. Returns the time the note is fully silent. */
export function adsr(param, t, dur, { a = 0.005, d = 0.1, s = 0.6, r = 0.1, peak = 1 } = {}) {
  const end = t + Math.max(dur, a + 0.002);
  param.cancelScheduledValues(t);
  param.setValueAtTime(EPS, t);
  param.linearRampToValueAtTime(Math.max(peak, EPS), t + a);
  if (d > 0 && s < 1) param.exponentialRampToValueAtTime(Math.max(peak * s, EPS), t + a + d);
  param.setValueAtTime(Math.max(peak * s, EPS), Math.max(end, t + a + d));
  param.exponentialRampToValueAtTime(EPS, Math.max(end, t + a + d) + r);
  return Math.max(end, t + a + d) + r;
}

/** Percussive envelope: fast attack, exponential decay to silence. */
export function perc(param, t, { a = 0.002, decay = 0.2, peak = 1 } = {}) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(EPS, t);
  param.linearRampToValueAtTime(Math.max(peak, EPS), t + a);
  param.exponentialRampToValueAtTime(EPS, t + a + decay);
  return t + a + decay;
}

// ------------------------------------------------------------------------------------------------
// one-shot building blocks used by the SFX library
// ------------------------------------------------------------------------------------------------
/**
 * A single oscillator blip with optional pitch sweep.
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} out
 * @param {number} t start time
 */
export function blip(ctx, out, t, {
  type = 'sine', f0 = 440, f1 = f0, dur = 0.2, vol = 0.5, attack = 0.003, curve = 'exp', detune = 0, lp = 0, vibrato = 0, vibRate = 8, tail = 0.02,
} = {}) {
  const o = ctx.createOscillator();
  setWave(ctx, o, type);
  o.detune.value = detune;
  const g = ctx.createGain();
  o.frequency.setValueAtTime(Math.max(20, f0), t);
  if (f1 !== f0) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    else o.frequency.linearRampToValueAtTime(Math.max(20, f1), t + dur);
  }
  perc(g.gain, t, { a: attack, decay: dur, peak: vol });
  let node = o;
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(out);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = vibRate;
    const lg = ctx.createGain();
    lg.gain.value = vibrato;
    lfo.connect(lg).connect(o.detune);
    lfo.start(t);
    lfo.stop(t + dur + tail);
  }
  o.start(t);
  o.stop(t + dur + attack + tail);
  return o;
}

/** Filtered noise burst with optional filter sweep. */
export function noiseHit(ctx, out, t, {
  filter = 'bandpass', f0 = 1000, f1 = f0, q = 1, dur = 0.2, vol = 0.5, attack = 0.002, hp = 0, pink = false, tail = 0.02, shape = 'exp',
} = {}) {
  const src = noiseSource(ctx, { pink });
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  if (shape === 'swell') {
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  } else perc(g.gain, t, { a: attack, decay: dur, peak: vol });
  let node = src.connect(f);
  if (hp) {
    const h = ctx.createBiquadFilter();
    h.type = 'highpass';
    h.frequency.value = hp;
    node.connect(h);
    node = h;
  }
  node.connect(g).connect(out);
  startNoise(src, t, dur + tail);
  src.stop(t + dur + tail + attack);
  return src;
}

/** Two-operator FM tone (bells, e-piano, metallic hits). */
export function fmTone(ctx, out, t, {
  fc = 440, ratio = 2, index0 = 3, index1 = 0, dur = 1, vol = 0.4, attack = 0.002, decay = dur, indexDecay = dur * 0.6, carrier = 'sine', modType = 'sine', detune = 0,
} = {}) {
  const c = ctx.createOscillator();
  setWave(ctx, c, carrier);
  c.frequency.value = fc;
  c.detune.value = detune;
  const m = ctx.createOscillator();
  setWave(ctx, m, modType);
  m.frequency.value = fc * ratio;
  const mg = ctx.createGain();
  const i0 = index0 * fc * ratio * 0.5;
  const i1 = Math.max(index1 * fc * ratio * 0.5, EPS);
  mg.gain.setValueAtTime(Math.max(i0, EPS), t);
  mg.gain.exponentialRampToValueAtTime(i1, t + indexDecay);
  m.connect(mg).connect(c.frequency);
  const g = ctx.createGain();
  perc(g.gain, t, { a: attack, decay, peak: vol });
  c.connect(g).connect(out);
  c.start(t);
  m.start(t);
  const end = t + attack + decay + 0.05;
  c.stop(end);
  m.stop(end);
  return c;
}
