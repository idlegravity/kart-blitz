/**
 * Synthesized sound effects. Each entry is `(c) => void` where
 *   c = { ctx, out, t, v /*volume scalar*\/, p /*pitch scalar*\/, o /*options*\/ }
 * and builds its nodes starting at time `t` into `out`. SFX_META tunes reverb send, cooldown and polyphony.
 * OWNER: Presentation.
 */
import { blip, noiseHit, fmTone, clamp, midiToFreq, lerp } from './synth.js';

const n = (name) => {
  // 'C5' -> midi (small local parser to avoid an import cycle)
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + pc;
};
const hz = (name) => midiToFreq(n(name));

/** Brass-ish jingle notes: [[noteName, startOffset, duration, velocity?], ...] */
function jingle(c, notes, { wave = 'sawtooth', lp = 3400, vol = 0.32, attack = 0.012, tail = 0.08 } = {}) {
  for (const [name, off, dur, vel = 1] of notes) {
    const f = hz(name) * c.p;
    blip(c.ctx, c.out, c.t + off, { type: wave, f0: f, dur: dur + tail, vol: vol * vel * c.v, attack, lp, tail: 0.03 });
    blip(c.ctx, c.out, c.t + off, { type: 'square', f0: f * 1.003, dur: dur + tail, vol: vol * 0.5 * vel * c.v, attack, lp: lp * 0.7, tail: 0.03 });
  }
}

export const SFX = {
  // ---------------------------------------------------------------- UI
  uiTick(c) {
    blip(c.ctx, c.out, c.t, { type: 'triangle', f0: 1500 * c.p, f1: 1150 * c.p, dur: 0.05, vol: 0.28 * c.v, attack: 0.001 });
    noiseHit(c.ctx, c.out, c.t, { filter: 'highpass', f0: 5000, dur: 0.02, vol: 0.05 * c.v });
  },
  uiConfirm(c) {
    blip(c.ctx, c.out, c.t, { type: 'triangle', f0: 660 * c.p, dur: 0.09, vol: 0.34 * c.v });
    blip(c.ctx, c.out, c.t + 0.07, { type: 'triangle', f0: 990 * c.p, dur: 0.2, vol: 0.36 * c.v });
    fmTone(c.ctx, c.out, c.t + 0.07, { fc: 1980 * c.p, ratio: 3.5, index0: 1.4, dur: 0.35, vol: 0.12 * c.v });
  },
  uiBack(c) {
    blip(c.ctx, c.out, c.t, { type: 'triangle', f0: 560 * c.p, f1: 470 * c.p, dur: 0.09, vol: 0.32 * c.v });
    blip(c.ctx, c.out, c.t + 0.07, { type: 'triangle', f0: 380 * c.p, f1: 300 * c.p, dur: 0.14, vol: 0.32 * c.v });
  },
  uiScreen(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 500, f1: 3200, q: 0.9, dur: 0.24, vol: 0.14 * c.v, shape: 'swell' });
  },
  pauseOn(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 900 * c.p, f1: 420 * c.p, dur: 0.22, vol: 0.32 * c.v });
    blip(c.ctx, c.out, c.t + 0.02, { type: 'triangle', f0: 450 * c.p, f1: 210 * c.p, dur: 0.22, vol: 0.2 * c.v });
  },
  pauseOff(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 420 * c.p, f1: 900 * c.p, dur: 0.2, vol: 0.32 * c.v });
    blip(c.ctx, c.out, c.t + 0.02, { type: 'triangle', f0: 210 * c.p, f1: 450 * c.p, dur: 0.2, vol: 0.2 * c.v });
  },
  resultsIn(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 300, f1: 4000, q: 0.8, dur: 0.5, vol: 0.2 * c.v, shape: 'swell' });
    fmTone(c.ctx, c.out, c.t + 0.3, { fc: 1046 * c.p, ratio: 3.5, index0: 2, dur: 0.8, vol: 0.22 * c.v });
    fmTone(c.ctx, c.out, c.t + 0.38, { fc: 1568 * c.p, ratio: 3.5, index0: 2, dur: 1.0, vol: 0.2 * c.v });
  },

  // ---------------------------------------------------------------- race flow
  countdownBeep(c) {
    blip(c.ctx, c.out, c.t, { type: 'square', f0: 440 * c.p, dur: 0.3, vol: 0.28 * c.v, attack: 0.004, lp: 2600 });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 220 * c.p, dur: 0.3, vol: 0.3 * c.v, attack: 0.004 });
  },
  countdownGo(c) {
    blip(c.ctx, c.out, c.t, { type: 'square', f0: 880 * c.p, dur: 0.75, vol: 0.3 * c.v, attack: 0.004, lp: 3800 });
    blip(c.ctx, c.out, c.t, { type: 'square', f0: 1320 * c.p, dur: 0.75, vol: 0.16 * c.v, attack: 0.004, lp: 3800 });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 440 * c.p, dur: 0.75, vol: 0.32 * c.v, attack: 0.004 });
    fmTone(c.ctx, c.out, c.t, { fc: 1760 * c.p, ratio: 3.5, index0: 1.5, dur: 1.1, vol: 0.14 * c.v });
  },
  lap(c) {
    fmTone(c.ctx, c.out, c.t, { fc: 784 * c.p, ratio: 3.5, index0: 2, dur: 0.6, vol: 0.34 * c.v });
    fmTone(c.ctx, c.out, c.t + 0.11, { fc: 1175 * c.p, ratio: 3.5, index0: 2, dur: 0.9, vol: 0.36 * c.v });
  },
  finalLap(c) {
    jingle(c, [['C5', 0, 0.1], ['E5', 0.11, 0.1], ['G5', 0.22, 0.1], ['C6', 0.33, 0.12], ['G5', 0.48, 0.09], ['C6', 0.58, 0.09], ['E6', 0.68, 0.7]], { vol: 0.3 });
    jingle(c, [['C5', 0.68, 0.7, 0.7], ['G5', 0.68, 0.7, 0.7]], { vol: 0.22 });
    noiseHit(c.ctx, c.out, c.t + 0.68, { filter: 'highpass', f0: 4000, dur: 0.9, vol: 0.14 * c.v, attack: 0.002 });
  },
  finishWin(c) {
    jingle(c, [['G4', 0, 0.09], ['C5', 0.1, 0.09], ['E5', 0.2, 0.09], ['G5', 0.3, 0.09], ['C6', 0.42, 0.14], ['B5', 0.58, 0.1], ['C6', 0.7, 0.9]], { vol: 0.22 });
    jingle(c, [['E5', 0.7, 0.9, 0.7], ['G5', 0.7, 0.9, 0.7]], { vol: 0.15 });
    noiseHit(c.ctx, c.out, c.t + 0.7, { filter: 'highpass', f0: 3500, dur: 1.4, vol: 0.14 * c.v, attack: 0.002 });
    blip(c.ctx, c.out, c.t + 0.7, { type: 'sine', f0: 130, f1: 60, dur: 0.6, vol: 0.4 * c.v });
  },
  finishLose(c) {
    // "wah-wah" trombone slide
    const dur = 0.42;
    for (const [off, from, to] of [[0, 'G4', 'F4'], [0.5, 'E4', 'D4'], [1.0, 'C4', 'A3']]) {
      const o = c.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(hz(from) * c.p, c.t + off);
      o.frequency.exponentialRampToValueAtTime(hz(to) * c.p, c.t + off + dur * 0.9);
      const f = c.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 3;
      f.frequency.setValueAtTime(500, c.t + off);
      f.frequency.linearRampToValueAtTime(1500, c.t + off + dur * 0.35);
      f.frequency.linearRampToValueAtTime(350, c.t + off + dur);
      const g = c.ctx.createGain();
      g.gain.setValueAtTime(0.0001, c.t + off);
      g.gain.linearRampToValueAtTime(0.32 * c.v, c.t + off + 0.04);
      g.gain.linearRampToValueAtTime(0.0001, c.t + off + dur);
      o.connect(f).connect(g).connect(c.out);
      o.start(c.t + off);
      o.stop(c.t + off + dur + 0.05);
    }
  },
  placeUp(c) {
    blip(c.ctx, c.out, c.t, { type: 'triangle', f0: 660 * c.p, dur: 0.07, vol: 0.2 * c.v });
    blip(c.ctx, c.out, c.t + 0.06, { type: 'triangle', f0: 880 * c.p, dur: 0.12, vol: 0.22 * c.v });
  },
  placeDown(c) {
    blip(c.ctx, c.out, c.t, { type: 'triangle', f0: 620 * c.p, dur: 0.07, vol: 0.16 * c.v });
    blip(c.ctx, c.out, c.t + 0.06, { type: 'triangle', f0: 440 * c.p, dur: 0.14, vol: 0.16 * c.v });
  },
  wrongWay(c) {
    for (let i = 0; i < 2; i++) blip(c.ctx, c.out, c.t + i * 0.2, { type: 'square', f0: 233 * c.p, dur: 0.13, vol: 0.22 * c.v, lp: 1800, attack: 0.004 });
  },

  // ---------------------------------------------------------------- items
  boxHit(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 2600, q: 0.9, dur: 0.09, vol: 0.4 * c.v });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 500 * c.p, f1: 1500 * c.p, dur: 0.12, vol: 0.34 * c.v });
    fmTone(c.ctx, c.out, c.t + 0.03, { fc: 1760 * c.p, ratio: 3.5, index0: 1.6, dur: 0.5, vol: 0.2 * c.v });
    fmTone(c.ctx, c.out, c.t + 0.08, { fc: 2637 * c.p, ratio: 3.5, index0: 1.2, dur: 0.45, vol: 0.14 * c.v });
  },
  rouletteTick(c) {
    blip(c.ctx, c.out, c.t, { type: 'triangle', f0: (950 + (c.o.index ?? 0) * 55) * c.p, dur: 0.035, vol: 0.2 * c.v, attack: 0.001 });
  },
  itemGet(c) {
    fmTone(c.ctx, c.out, c.t, { fc: 1319 * c.p, ratio: 3.5, index0: 2, dur: 0.6, vol: 0.32 * c.v });
    fmTone(c.ctx, c.out, c.t + 0.09, { fc: 1760 * c.p, ratio: 3.5, index0: 2, dur: 0.9, vol: 0.34 * c.v });
    noiseHit(c.ctx, c.out, c.t + 0.09, { filter: 'highpass', f0: 6500, dur: 0.25, vol: 0.08 * c.v });
  },
  throw(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 450, f1: 2600, q: 1, dur: 0.26, vol: 0.34 * c.v, shape: 'swell' });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 300 * c.p, f1: 700 * c.p, dur: 0.14, vol: 0.14 * c.v });
  },
  throwBack(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 2200, f1: 400, q: 1, dur: 0.24, vol: 0.28 * c.v, shape: 'swell' });
  },
  drop(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 420 * c.p, f1: 170 * c.p, dur: 0.1, vol: 0.34 * c.v });
    noiseHit(c.ctx, c.out, c.t, { filter: 'lowpass', f0: 900, dur: 0.05, vol: 0.2 * c.v });
  },
  slip(c) {
    // cartoon banana slide-whistle
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 1500 * c.p, f1: 260 * c.p, dur: 0.55, vol: 0.28 * c.v, vibrato: 50, vibRate: 11, curve: 'exp' });
    blip(c.ctx, c.out, c.t + 0.02, { type: 'triangle', f0: 750 * c.p, f1: 130 * c.p, dur: 0.55, vol: 0.16 * c.v });
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 2000, q: 1.5, dur: 0.06, vol: 0.14 * c.v });
  },
  orbHit(c) {
    blip(c.ctx, c.out, c.t, { type: 'square', f0: 1100 * c.p, f1: 120 * c.p, dur: 0.28, vol: 0.22 * c.v, lp: 4000 });
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 1800, q: 0.8, dur: 0.16, vol: 0.34 * c.v });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 140 * c.p, f1: 50, dur: 0.24, vol: 0.45 * c.v });
  },
  explosion(c) {
    const s = clamp(c.o.size ?? 1, 0.5, 1.6);
    noiseHit(c.ctx, c.out, c.t, { filter: 'lowpass', f0: 4200, f1: 180, q: 0.8, dur: 1.15 * s, vol: 0.6 * c.v, attack: 0.002 });
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 1400, f1: 300, q: 0.7, dur: 0.5, vol: 0.32 * c.v, attack: 0.001 });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 120 * c.p, f1: 28, dur: 0.95 * s, vol: 0.62 * c.v, attack: 0.002 });
    for (let i = 0; i < 6; i++) noiseHit(c.ctx, c.out, c.t + 0.12 + i * 0.07 + Math.random() * 0.03, { filter: 'highpass', f0: 3500, dur: 0.05, vol: 0.14 * c.v * (1 - i / 7) });
  },
  lightning(c) {
    blip(c.ctx, c.out, c.t, { type: 'sawtooth', f0: 180, f1: 3400, dur: 0.11, vol: 0.3 * c.v, lp: 6000, curve: 'exp' });
    for (let i = 0; i < 9; i++) {
      noiseHit(c.ctx, c.out, c.t + i * 0.035 + Math.random() * 0.02, { filter: 'bandpass', f0: 2500 + Math.random() * 3500, q: 1.4, dur: 0.05 + Math.random() * 0.05, vol: (0.5 - i * 0.04) * c.v, attack: 0.0008 });
    }
    // thunder
    noiseHit(c.ctx, c.out, c.t + 0.28, { filter: 'lowpass', f0: 420, f1: 120, q: 0.6, dur: 2.3, vol: 0.75 * c.v, shape: 'swell', pink: true });
    blip(c.ctx, c.out, c.t + 0.3, { type: 'sine', f0: 70, f1: 34, dur: 1.5, vol: 0.5 * c.v, attack: 0.05 });
  },
  shrink(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 1100 * c.p, f1: 140 * c.p, dur: 0.55, vol: 0.34 * c.v, vibrato: 35, vibRate: 13 });
    blip(c.ctx, c.out, c.t, { type: 'triangle', f0: 550 * c.p, f1: 90 * c.p, dur: 0.55, vol: 0.2 * c.v });
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 3000, f1: 400, q: 1, dur: 0.4, vol: 0.14 * c.v });
  },
  grow(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 180 * c.p, f1: 1000 * c.p, dur: 0.36, vol: 0.3 * c.v, vibrato: 25, vibRate: 12 });
    blip(c.ctx, c.out, c.t + 0.34, { type: 'sine', f0: 700, f1: 300, dur: 0.1, vol: 0.28 * c.v });
    fmTone(c.ctx, c.out, c.t + 0.34, { fc: 1568, ratio: 3.5, index0: 1.5, dur: 0.4, vol: 0.14 * c.v });
  },
  starStart(c) {
    [['C6', 0], ['E6', 0.05], ['G6', 0.1], ['C7', 0.15], ['E7', 0.2], ['G6', 0.3], ['C7', 0.35]].forEach(([nm, off], i) => {
      fmTone(c.ctx, c.out, c.t + off, { fc: hz(nm) * c.p, ratio: 3.5, index0: 1.5, dur: 0.5 + i * 0.05, vol: 0.2 * c.v });
    });
    noiseHit(c.ctx, c.out, c.t, { filter: 'highpass', f0: 6000, dur: 0.6, vol: 0.1 * c.v, shape: 'swell' });
  },
  siren(c) {
    const dur = c.o.dur ?? 3.2;
    const o = c.ctx.createOscillator();
    o.type = 'square';
    const f = c.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2200;
    const g = c.ctx.createGain();
    g.gain.setValueAtTime(0.0001, c.t);
    g.gain.linearRampToValueAtTime(0.2 * c.v, c.t + 0.03);
    g.gain.setValueAtTime(0.2 * c.v, c.t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, c.t + dur);
    for (let i = 0; i * 0.32 < dur; i++) o.frequency.setValueAtTime(i % 2 ? 640 : 880, c.t + i * 0.32);
    o.connect(f).connect(g).connect(c.out);
    o.start(c.t);
    o.stop(c.t + dur + 0.05);
  },

  // ---------------------------------------------------------------- kart
  hop(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 240 * c.p, f1: 520 * c.p, dur: 0.09, vol: 0.32 * c.v });
    blip(c.ctx, c.out, c.t + 0.08, { type: 'sine', f0: 520 * c.p, f1: 330 * c.p, dur: 0.12, vol: 0.28 * c.v, vibrato: 30, vibRate: 16 });
  },
  land(c) {
    const k = clamp((c.o.impact ?? 6) / 14, 0.15, 1);
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 120, f1: 48, dur: 0.16, vol: 0.55 * k * c.v });
    noiseHit(c.ctx, c.out, c.t, { filter: 'lowpass', f0: 500, dur: 0.1, vol: 0.28 * k * c.v });
  },
  wall(c) {
    const k = clamp((c.o.impact ?? 8) / 20, 0.2, 1);
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 1300, q: 0.7, dur: 0.26, vol: 0.6 * k * c.v });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 100, f1: 42, dur: 0.22, vol: 0.55 * k * c.v });
    blip(c.ctx, c.out, c.t, { type: 'square', f0: 220 * c.p, f1: 150, dur: 0.06, vol: 0.14 * k * c.v, lp: 1500 });
  },
  bump(c) {
    const k = clamp((c.o.impulse ?? 0.5), 0.25, 1);
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 160 * c.p, f1: 80, dur: 0.11, vol: 0.4 * k * c.v });
    noiseHit(c.ctx, c.out, c.t, { filter: 'lowpass', f0: 800, dur: 0.06, vol: 0.2 * k * c.v });
  },
  fall(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 1300, f1: 200, dur: 0.95, vol: 0.24 * c.v });
    blip(c.ctx, c.out, c.t, { type: 'triangle', f0: 650, f1: 100, dur: 0.95, vol: 0.14 * c.v });
  },
  respawn(c) {
    [['G5', 0], ['C6', 0.06], ['E6', 0.12], ['G6', 0.18]].forEach(([nm, off]) => fmTone(c.ctx, c.out, c.t + off, { fc: hz(nm), ratio: 3.5, index0: 1.2, dur: 0.4, vol: 0.18 * c.v }));
  },
  trick(c) {
    [['A5', 0], ['C#6', 0.045], ['E6', 0.09], ['A6', 0.135]].forEach(([nm, off]) => blip(c.ctx, c.out, c.t + off, { type: 'triangle', f0: hz(nm) * c.p, dur: 0.12, vol: 0.24 * c.v }));
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 700, f1: 3500, q: 1, dur: 0.22, vol: 0.14 * c.v, shape: 'swell' });
  },
  stall(c) {
    for (let i = 0; i < 7; i++) {
      noiseHit(c.ctx, c.out, c.t + i * 0.055, { filter: 'bandpass', f0: 1500, q: 1.2, dur: 0.05, vol: 0.32 * c.v });
      blip(c.ctx, c.out, c.t + i * 0.055, { type: 'sawtooth', f0: 110 + i * 6, dur: 0.05, vol: 0.2 * c.v, lp: 900 });
    }
  },
  spin(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 500 * c.p, f1: 1250 * c.p, dur: 0.22, vol: 0.28 * c.v, vibrato: 60, vibRate: 15 });
    blip(c.ctx, c.out, c.t + 0.2, { type: 'sine', f0: 1250 * c.p, f1: 260 * c.p, dur: 0.32, vol: 0.28 * c.v, vibrato: 60, vibRate: 15 });
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 2400, q: 1.5, dur: 0.05, vol: 0.14 * c.v });
  },
  tumble(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 200, f1: 60, dur: 0.22, vol: 0.5 * c.v });
    for (let i = 0; i < 4; i++) noiseHit(c.ctx, c.out, c.t + 0.1 + i * 0.11, { filter: 'lowpass', f0: 700, dur: 0.07, vol: 0.3 * c.v });
    blip(c.ctx, c.out, c.t + 0.1, { type: 'triangle', f0: 900, f1: 300, dur: 0.5, vol: 0.14 * c.v, vibrato: 40, vibRate: 12 });
  },
  squish(c) {
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 1700 * c.p, f1: 500 * c.p, dur: 0.22, vol: 0.3 * c.v });
    blip(c.ctx, c.out, c.t + 0.02, { type: 'square', f0: 900, f1: 200, dur: 0.15, vol: 0.12 * c.v, lp: 2500 });
    noiseHit(c.ctx, c.out, c.t + 0.18, { filter: 'lowpass', f0: 600, dur: 0.06, vol: 0.3 * c.v });
  },
  block(c) {
    fmTone(c.ctx, c.out, c.t, { fc: 680 * c.p, ratio: 5.4, index0: 2.2, dur: 0.35, vol: 0.34 * c.v });
    noiseHit(c.ctx, c.out, c.t, { filter: 'highpass', f0: 3000, dur: 0.04, vol: 0.3 * c.v });
  },
  destroy(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 3000, q: 1, dur: 0.09, vol: 0.3 * c.v });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 420, f1: 190, dur: 0.09, vol: 0.28 * c.v });
  },

  // ---------------------------------------------------------------- boosts & drift
  boostPad(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'highpass', f0: 700, f1: 6500, q: 0.8, dur: 0.55, vol: 0.34 * c.v, shape: 'swell' });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 280 * c.p, f1: 980 * c.p, dur: 0.42, vol: 0.2 * c.v });
    blip(c.ctx, c.out, c.t + 0.05, { type: 'triangle', f0: 560 * c.p, f1: 1500 * c.p, dur: 0.3, vol: 0.1 * c.v });
  },
  draft(c) {
    // subtle slipstream "whoosh": airy swell with a faint rising tone
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 650, f1: 1700, q: 0.8, dur: 0.5, vol: 0.2 * c.v, shape: 'swell', pink: true });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 220 * c.p, f1: 360 * c.p, dur: 0.4, vol: 0.07 * c.v });
  },
  nitro(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 380, f1: 1500, q: 0.9, dur: 0.95, vol: 0.5 * c.v, shape: 'swell' });
    blip(c.ctx, c.out, c.t, { type: 'sawtooth', f0: 85 * c.p, f1: 190 * c.p, dur: 0.85, vol: 0.32 * c.v, lp: 1400 });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 70, f1: 45, dur: 0.5, vol: 0.5 * c.v });
  },
  goldnitro(c) {
    SFX.nitro(c);
    [['C6', 0.05], ['E6', 0.12], ['G6', 0.19], ['C7', 0.26]].forEach(([nm, off]) => fmTone(c.ctx, c.out, c.t + off, { fc: hz(nm), ratio: 3.5, index0: 1.4, dur: 0.6, vol: 0.14 * c.v }));
  },
  rocketStart(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 300, f1: 2400, q: 0.8, dur: 1.1, vol: 0.55 * c.v, shape: 'swell' });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 90, f1: 40, dur: 0.6, vol: 0.85 * c.v });
    blip(c.ctx, c.out, c.t, { type: 'sawtooth', f0: 160, f1: 900, dur: 0.9, vol: 0.24 * c.v, lp: 2600 });
    [['G5', 0.1], ['C6', 0.17], ['E6', 0.24]].forEach(([nm, off]) => fmTone(c.ctx, c.out, c.t + off, { fc: hz(nm), ratio: 3.5, index0: 1.4, dur: 0.5, vol: 0.14 * c.v }));
  },
  miniturbo(c) {
    const lv = clamp(c.o.level ?? 1, 1, 3);
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 500, f1: 3000 + lv * 500, q: 0.9, dur: 0.3 + lv * 0.05, vol: 0.3 * c.v, shape: 'swell' });
    blip(c.ctx, c.out, c.t, { type: 'sine', f0: 130, f1: 46, dur: 0.22, vol: (0.4 + lv * 0.1) * c.v });
    const f = [880, 1108, 1480][lv - 1] * c.p;
    blip(c.ctx, c.out, c.t + 0.02, { type: 'sawtooth', f0: f * 0.5, f1: f, dur: 0.22, vol: 0.12 * c.v, lp: 3200 });
  },
  driftLevel(c) {
    const lv = clamp(c.o.level ?? 1, 1, 3);
    const f = [1046, 1319, 1760][lv - 1] * c.p;
    fmTone(c.ctx, c.out, c.t, { fc: f, ratio: 3.5, index0: 1.6, dur: 0.32 + lv * 0.08, vol: 0.3 * c.v });
    fmTone(c.ctx, c.out, c.t + 0.04, { fc: f * 1.5, ratio: 3.5, index0: 1.1, dur: 0.26, vol: 0.14 * c.v });
    if (lv === 3) noiseHit(c.ctx, c.out, c.t, { filter: 'highpass', f0: 6500, dur: 0.3, vol: 0.12 * c.v });
  },
  driftStart(c) {
    noiseHit(c.ctx, c.out, c.t, { filter: 'bandpass', f0: 2600, f1: 1800, q: 4, dur: 0.14, vol: 0.14 * c.v });
  },
};

/** Per-SFX behaviour: reverb send, cooldown between plays (s), max simultaneous, and default volume. */
export const SFX_META = {
  uiTick: { rev: 0.05, cool: 0.03, max: 3 },
  uiConfirm: { rev: 0.12, cool: 0.05, max: 2 },
  uiBack: { rev: 0.1, cool: 0.05, max: 2 },
  uiScreen: { rev: 0.1, cool: 0.12, max: 1 },
  pauseOn: { rev: 0.1, max: 1 },
  pauseOff: { rev: 0.1, max: 1 },
  resultsIn: { rev: 0.3, max: 1 },
  countdownBeep: { rev: 0.05, max: 1 },
  countdownGo: { rev: 0.18, max: 1 },
  lap: { rev: 0.25, max: 1 },
  finalLap: { rev: 0.22, max: 1 },
  finishWin: { rev: 0.32, max: 1 },
  finishLose: { rev: 0.25, max: 1 },
  placeUp: { rev: 0.1, cool: 0.2, max: 1 },
  placeDown: { rev: 0.1, cool: 0.2, max: 1 },
  wrongWay: { rev: 0.05, cool: 1, max: 1 },
  boxHit: { rev: 0.2, cool: 0.04, max: 3 },
  rouletteTick: { rev: 0.04, cool: 0.02, max: 2 },
  itemGet: { rev: 0.3, max: 1 },
  throw: { rev: 0.1, cool: 0.05, max: 3 },
  throwBack: { rev: 0.1, cool: 0.05, max: 3 },
  drop: { rev: 0.08, cool: 0.05, max: 2 },
  slip: { rev: 0.2, cool: 0.2, max: 2 },
  orbHit: { rev: 0.25, cool: 0.08, max: 2 },
  explosion: { rev: 0.5, cool: 0.1, max: 3 },
  lightning: { rev: 0.5, cool: 0.5, max: 1 },
  shrink: { rev: 0.2, cool: 0.3, max: 2 },
  grow: { rev: 0.2, cool: 0.3, max: 2 },
  starStart: { rev: 0.3, cool: 0.3, max: 2 },
  siren: { rev: 0.1, max: 1 },
  hop: { rev: 0.06, cool: 0.08, max: 3 },
  land: { rev: 0.05, cool: 0.06, max: 3 },
  wall: { rev: 0.12, cool: 0.08, max: 3 },
  bump: { rev: 0.08, cool: 0.07, max: 3 },
  fall: { rev: 0.2, cool: 0.3, max: 1 },
  respawn: { rev: 0.3, cool: 0.3, max: 2 },
  trick: { rev: 0.15, cool: 0.2, max: 2 },
  stall: { rev: 0.1, cool: 0.4, max: 1 },
  spin: { rev: 0.15, cool: 0.2, max: 2 },
  tumble: { rev: 0.15, cool: 0.2, max: 2 },
  squish: { rev: 0.15, cool: 0.2, max: 2 },
  block: { rev: 0.2, cool: 0.1, max: 2 },
  destroy: { rev: 0.1, cool: 0.05, max: 3 },
  boostPad: { rev: 0.15, cool: 0.15, max: 2 },
  draft: { rev: 0.1, cool: 0.9, max: 1 },
  nitro: { rev: 0.2, cool: 0.2, max: 2 },
  goldnitro: { rev: 0.25, cool: 0.3, max: 1 },
  rocketStart: { rev: 0.2, cool: 0.5, max: 1 },
  miniturbo: { rev: 0.15, cool: 0.15, max: 2 },
  driftLevel: { rev: 0.25, cool: 0.08, max: 2 },
  driftStart: { rev: 0.05, cool: 0.2, max: 2 },
};

export const SFX_NAMES = Object.keys(SFX);
void lerp;
