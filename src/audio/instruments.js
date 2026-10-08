/**
 * Synthesized instruments for the music engine: a drum kit and melodic voices.
 * Signature: DRUMS[name](ctx, out, t, { vel })   VOICES[name](ctx, out, t, midiNotes[], durSec, opts)
 * Everything is built from oscillators / filtered noise / FM — no samples. OWNER: Presentation.
 */
import { adsr, perc, blip, noiseHit, fmTone, setWave, midiToFreq, satCurve, clamp } from './synth.js';

const EPS = 0.0001;

function osc(ctx, type, freq, t, { detune = 0, stop = 0 } = {}) {
  const o = ctx.createOscillator();
  setWave(ctx, o, type);
  o.frequency.value = freq;
  if (detune) o.detune.value = detune;
  o.start(t);
  if (stop) o.stop(stop);
  return o;
}

// ==================================================================================================
// DRUMS
// ==================================================================================================
export const DRUMS = {
  kick(ctx, out, t, { vel = 1, pitch = 1, decay = 0.3 } = {}) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(165 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(58 * pitch, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(46 * pitch, t + decay);
    const g = ctx.createGain();
    perc(g.gain, t, { a: 0.001, decay: decay * 0.85, peak: 0.66 * vel });
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.03);
    noiseHit(ctx, out, t, { filter: 'highpass', f0: 2200, dur: 0.014, vol: 0.24 * vel, attack: 0.0005 });
  },
  snare(ctx, out, t, { vel = 1, tone = 190, decay = 0.17 } = {}) {
    noiseHit(ctx, out, t, { filter: 'bandpass', f0: 2600, q: 0.7, dur: decay, vol: 0.6 * vel, hp: 900 });
    blip(ctx, out, t, { type: 'triangle', f0: tone * 1.4, f1: tone * 0.8, dur: 0.1, vol: 0.5 * vel });
  },
  clap(ctx, out, t, { vel = 1 } = {}) {
    for (let i = 0; i < 3; i++) noiseHit(ctx, out, t + i * 0.011, { filter: 'bandpass', f0: 1400, q: 1.1, dur: 0.012, vol: 0.5 * vel });
    noiseHit(ctx, out, t + 0.033, { filter: 'bandpass', f0: 1300, q: 1, dur: 0.17, vol: 0.5 * vel });
  },
  hat(ctx, out, t, { vel = 1 } = {}) {
    noiseHit(ctx, out, t, { filter: 'highpass', f0: 7800, q: 0.5, dur: 0.045, vol: 0.36 * vel, attack: 0.001 });
  },
  ohat(ctx, out, t, { vel = 1 } = {}) {
    noiseHit(ctx, out, t, { filter: 'highpass', f0: 7000, q: 0.5, dur: 0.3, vol: 0.26 * vel, attack: 0.001 });
    noiseHit(ctx, out, t, { filter: 'bandpass', f0: 10500, q: 3, dur: 0.22, vol: 0.12 * vel, attack: 0.001 });
  },
  rim(ctx, out, t, { vel = 1 } = {}) {
    blip(ctx, out, t, { type: 'square', f0: 1750, f1: 1450, dur: 0.03, vol: 0.28 * vel, lp: 5000 });
    noiseHit(ctx, out, t, { filter: 'bandpass', f0: 3200, q: 2, dur: 0.02, vol: 0.3 * vel });
  },
  tom(ctx, out, t, { vel = 1, freq = 110, decay = 0.28 } = {}) {
    blip(ctx, out, t, { type: 'sine', f0: freq * 1.6, f1: freq, dur: decay, vol: 0.75 * vel });
    noiseHit(ctx, out, t, { filter: 'bandpass', f0: 900, q: 1, dur: 0.03, vol: 0.2 * vel });
  },
  cow(ctx, out, t, { vel = 1 } = {}) {
    blip(ctx, out, t, { type: 'square', f0: 562, dur: 0.2, vol: 0.2 * vel, lp: 3400 });
    blip(ctx, out, t, { type: 'square', f0: 845, dur: 0.16, vol: 0.2 * vel, lp: 3400 });
  },
  shaker(ctx, out, t, { vel = 1 } = {}) {
    noiseHit(ctx, out, t, { filter: 'highpass', f0: 5800, q: 0.5, dur: 0.06, vol: 0.2 * vel, attack: 0.014 });
  },
  tamb(ctx, out, t, { vel = 1 } = {}) {
    noiseHit(ctx, out, t, { filter: 'highpass', f0: 6500, q: 0.7, dur: 0.11, vol: 0.24 * vel, attack: 0.004 });
    noiseHit(ctx, out, t, { filter: 'bandpass', f0: 9200, q: 4, dur: 0.14, vol: 0.14 * vel, attack: 0.004 });
  },
  crash(ctx, out, t, { vel = 1 } = {}) {
    noiseHit(ctx, out, t, { filter: 'highpass', f0: 3600, q: 0.5, dur: 1.7, vol: 0.34 * vel, attack: 0.002 });
    noiseHit(ctx, out, t, { filter: 'bandpass', f0: 8200, q: 2.5, dur: 1.2, vol: 0.14 * vel, attack: 0.002 });
  },
};

// ==================================================================================================
// MELODIC VOICES  (notes = midi numbers)
// ==================================================================================================
function bassVoice(kind) {
  return (ctx, out, t, notes, dur, { vel = 1, cutoff = 1 } = {}) => {
    const f = midiToFreq(notes[0]);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    let stopAt;
    if (kind === 'funk') {
      const a = osc(ctx, 'sawtooth', f, t);
      const b = osc(ctx, 'square', f, t);
      const s = osc(ctx, 'sine', f, t);
      const ga = ctx.createGain(), gb = ctx.createGain(), gs = ctx.createGain();
      ga.gain.value = 0.6; gb.gain.value = 0.4; gs.gain.value = 0.42;
      a.connect(ga).connect(lp); b.connect(gb).connect(lp); s.connect(gs).connect(lp);
      lp.Q.value = 5;
      lp.frequency.setValueAtTime(Math.min(f * 10 * cutoff, 6000), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2.4 * cutoff, 80), t + 0.1);
      stopAt = adsr(g.gain, t, dur * 0.9, { a: 0.003, d: 0.1, s: 0.6, r: 0.05, peak: 0.46 * vel });
      [a, b, s].forEach((o) => o.stop(stopAt + 0.05));
    } else if (kind === 'sub') {
      const a = osc(ctx, 'sine', f, t);
      const b = osc(ctx, 'triangle', f * 2, t);
      const gb = ctx.createGain();
      gb.gain.value = 0.25;
      a.connect(lp); b.connect(gb).connect(lp);
      lp.frequency.value = 320 * cutoff;
      stopAt = adsr(g.gain, t, dur * 0.96, { a: 0.012, d: 0.1, s: 0.85, r: 0.12, peak: 0.5 * vel });
      a.stop(stopAt + 0.05); b.stop(stopAt + 0.05);
    } else if (kind === 'saw') {
      const a = osc(ctx, 'sawtooth', f, t, { detune: -7 });
      const b = osc(ctx, 'sawtooth', f, t, { detune: 7 });
      const c = osc(ctx, 'square', f / 2, t);
      const gc = ctx.createGain();
      gc.gain.value = 0.5;
      a.connect(lp); b.connect(lp); c.connect(gc).connect(lp);
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(Math.min(f * 12 * cutoff, 5000), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 3.2 * cutoff, 100), t + Math.min(0.14, dur));
      stopAt = adsr(g.gain, t, dur * 0.85, { a: 0.002, d: 0.06, s: 0.8, r: 0.03, peak: 0.38 * vel });
      [a, b, c].forEach((o) => o.stop(stopAt + 0.05));
    } else if (kind === 'square') {
      const a = osc(ctx, 'square', f, t);
      const s = osc(ctx, 'sine', f, t);
      const gs = ctx.createGain();
      gs.gain.value = 0.6;
      a.connect(lp); s.connect(gs).connect(lp);
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(Math.min(f * 8 * cutoff, 3000), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 3 * cutoff, 100), t + 0.12);
      stopAt = adsr(g.gain, t, dur * 0.8, { a: 0.003, d: 0.1, s: 0.5, r: 0.05, peak: 0.42 * vel });
      a.stop(stopAt + 0.05); s.stop(stopAt + 0.05);
    } else {
      // 'pluck'
      const a = osc(ctx, 'triangle', f, t);
      const s = osc(ctx, 'sine', f / 2, t);
      const gs = ctx.createGain();
      gs.gain.value = 0.5;
      a.connect(lp); s.connect(gs).connect(lp);
      lp.frequency.setValueAtTime(Math.min(f * 8, 3500), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 80), t + 0.25);
      stopAt = perc(g.gain, t, { a: 0.004, decay: Math.max(dur, 0.25), peak: 0.5 * vel });
      a.stop(stopAt + 0.05); s.stop(stopAt + 0.05);
    }
    lp.connect(g).connect(out);
  };
}

/** Detuned-saw pad chord with slow filter swell. */
function padVoice(ctx, out, t, notes, dur, { vel = 1, cutoff = 1800, attack = 0.35, release = 0.7, detune = 9, type = 'sawtooth', tremolo = 0 } = {}) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.7;
  lp.frequency.setValueAtTime(cutoff * 0.35, t);
  lp.frequency.linearRampToValueAtTime(cutoff, t + attack + 0.3);
  const g = ctx.createGain();
  const oscs = [];
  const per = 0.5 / Math.sqrt(notes.length * 3);
  const sum = ctx.createGain();
  sum.gain.value = per;
  for (const m of notes) {
    const f = midiToFreq(m);
    for (const d of [-detune, 0, detune]) oscs.push(osc(ctx, type, f, t, { detune: d }));
  }
  oscs.forEach((o) => o.connect(sum));
  sum.connect(lp).connect(g).connect(out);
  const stopAt = adsr(g.gain, t, dur, { a: attack, d: 0, s: 1, r: release, peak: vel });
  oscs.forEach((o) => o.stop(stopAt + 0.05));
  if (tremolo) {
    const lfo = osc(ctx, 'sine', 5.2, t);
    const lg = ctx.createGain();
    lg.gain.value = tremolo;
    lfo.connect(lg).connect(sum.gain);
    lfo.stop(stopAt + 0.05);
  }
}

/** Monophonic lead with delayed vibrato. */
function leadVoice(defaults) {
  return (ctx, out, t, notes, dur, o = {}) => {
    const p = { ...defaults, ...o };
    const f = midiToFreq(notes[0]);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = p.q ?? 0.8;
    const voices = [osc(ctx, p.wave, f, t, { detune: 0 })];
    if (p.thick) voices.push(osc(ctx, p.wave, f, t, { detune: p.thick }));
    if (p.sub) voices.push(osc(ctx, p.subWave ?? 'sine', f / 2, t));
    if (p.glide && p.from) {
      const f0 = midiToFreq(p.from);
      voices.forEach((v) => {
        v.frequency.setValueAtTime(f0, t);
        v.frequency.exponentialRampToValueAtTime(f, t + p.glide);
      });
    }
    const mix = ctx.createGain();
    mix.gain.value = 1 / voices.length;
    voices.forEach((v) => v.connect(mix));
    mix.connect(lp).connect(g).connect(out);
    const c0 = Math.min(p.cutoff * (p.env ?? 1), 12000);
    lp.frequency.setValueAtTime(p.env ? c0 : p.cutoff, t);
    if (p.env) lp.frequency.exponentialRampToValueAtTime(Math.max(p.cutoff, 200), t + (p.envTime ?? 0.12));
    const stopAt = adsr(g.gain, t, dur, { a: p.attack, d: p.decay ?? 0.05, s: p.sustain, r: p.release, peak: p.gain * (o.vel ?? 1) });
    if (p.vibrato) {
      const lfo = osc(ctx, 'sine', p.vibRate ?? 5.5, t);
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(p.vibrato, t + (p.vibDelay ?? 0.18) + 0.2);
      lfo.connect(lg);
      voices.forEach((v) => lg.connect(v.detune));
      lfo.stop(stopAt + 0.05);
    }
    if (p.breath) noiseHit(ctx, out, t, { filter: 'bandpass', f0: f * 2, q: 2, dur: Math.max(dur, 0.1), vol: p.breath * (o.vel ?? 1), attack: 0.03, shape: 'swell' });
    voices.forEach((v) => v.stop(stopAt + 0.05));
  };
}

/** Chord stab / brass hit: detuned saws with a fast filter opening. */
function stabVoice(ctx, out, t, notes, dur, { vel = 1, cutoff = 3200, attack = 0.012, release = 0.08, detune = 7, type = 'sawtooth', bright = 3, decay = 0.12, sustain = 0.6 } = {}) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.4;
  lp.frequency.setValueAtTime(cutoff * 0.2, t);
  lp.frequency.exponentialRampToValueAtTime(cutoff * bright * 0.5 + 200, t + attack + 0.03);
  lp.frequency.exponentialRampToValueAtTime(cutoff, t + attack + 0.03 + decay);
  const g = ctx.createGain();
  const sum = ctx.createGain();
  sum.gain.value = 0.42 / Math.sqrt(notes.length * 2);
  const oscs = [];
  for (const m of notes) {
    const f = midiToFreq(m);
    oscs.push(osc(ctx, type, f, t, { detune: -detune }), osc(ctx, type, f, t, { detune }));
  }
  oscs.forEach((o) => o.connect(sum));
  sum.connect(lp).connect(g).connect(out);
  const stopAt = adsr(g.gain, t, dur, { a: attack, d: decay, s: sustain, r: release, peak: vel });
  oscs.forEach((o) => o.stop(stopAt + 0.05));
}

/** Filtered saw pluck (arps, marimba-ish, ukulele chords). Plays every note passed. */
function pluckVoice(defaults) {
  return (ctx, out, t, notes, dur, o = {}) => {
    const p = { ...defaults, ...o };
    const n = notes.length;
    notes.forEach((m, i) => {
      const t0 = t + i * (p.strum ?? 0);
      const f = midiToFreq(m);
      const a = osc(ctx, p.wave, f, t0, { detune: p.detune ?? 0 });
      const b = p.thick ? osc(ctx, p.wave, f, t0, { detune: -p.thick }) : null;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = p.q ?? 1;
      lp.frequency.setValueAtTime(Math.min(f * p.bright, 12000), t0);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * p.floor, 150), t0 + p.decay * 0.8);
      const g = ctx.createGain();
      a.connect(lp);
      b?.connect(lp);
      lp.connect(g).connect(out);
      const stopAt = perc(g.gain, t0, { a: 0.003, decay: Math.min(p.decay, Math.max(dur * 1.6, 0.12)), peak: (p.gain * (o.vel ?? 1)) / Math.sqrt(n) });
      a.stop(stopAt + 0.05);
      b?.stop(stopAt + 0.05);
    });
  };
}

/** Bell / mallet via FM. */
function bellVoice(defaults) {
  return (ctx, out, t, notes, dur, o = {}) => {
    const p = { ...defaults, ...o };
    const vel = o.vel ?? 1;
    const f = midiToFreq(notes[0]);
    fmTone(ctx, out, t, { fc: f, ratio: p.ratio, index0: p.index, index1: 0.02, dur: p.decay, decay: p.decay, indexDecay: p.decay * p.idxDecay, vol: p.gain * vel, attack: 0.002 });
    if (p.partial) fmTone(ctx, out, t, { fc: f * p.partial, ratio: 1, index0: 0, dur: p.decay * 0.5, decay: p.decay * 0.5, vol: p.gain * vel * 0.25, attack: 0.002 });
  };
}

/** Rhodes-ish electric piano. */
function epianoVoice(ctx, out, t, notes, dur, { vel = 1, decay = 1.1, tine = 1 } = {}) {
  for (const m of notes) {
    const f = midiToFreq(m);
    const v = vel / Math.sqrt(notes.length);
    fmTone(ctx, out, t, { fc: f, ratio: 1, index0: 1.5, index1: 0.12, dur: decay, decay, indexDecay: decay * 0.5, vol: 0.5 * v, attack: 0.003 });
    fmTone(ctx, out, t, { fc: f, ratio: 14, index0: 0.55 * tine, index1: 0.01, dur: 0.12, decay: 0.12, indexDecay: 0.08, vol: 0.13 * v, attack: 0.001 });
  }
}

/** Surf/western guitar: picked saw+square, springy scoop, bright→dark filter. Chords strum; `trem` re-picks long notes. */
function twangVoice(ctx, out, t, notes, dur, { vel = 1, decay = 0.5, bright = 7, trem = false, strum = 0.011 } = {}) {
  const pick = (m, t0, v, d) => {
    const f = midiToFreq(m);
    const a = osc(ctx, 'sawtooth', f, t0, { detune: -20 });
    const b = osc(ctx, 'square', f, t0, { detune: 4 });
    a.detune.setValueAtTime(-45, t0);
    a.detune.linearRampToValueAtTime(0, t0 + 0.03);
    const ga = ctx.createGain(), gb = ctx.createGain();
    ga.gain.value = 0.62;
    gb.gain.value = 0.3;
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 2300;
    pk.Q.value = 1.6;
    pk.gain.value = 6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(Math.min(f * bright, 9000), t0);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2.2, 500), t0 + d * 0.7);
    const g = ctx.createGain();
    a.connect(ga).connect(pk);
    b.connect(gb).connect(pk);
    pk.connect(lp).connect(g).connect(out);
    const stopAt = perc(g.gain, t0, { a: 0.002, decay: d, peak: 0.5 * v });
    a.stop(stopAt + 0.05);
    b.stop(stopAt + 0.05);
  };
  const n = notes.length;
  if (trem && n === 1 && dur > 0.2) {
    const step = 0.052;
    const count = Math.floor(dur / step);
    for (let i = 0; i < count; i++) pick(notes[0], t + i * step, vel * (0.55 + 0.45 * Math.max(0, 1 - i / (count * 1.4))), 0.14);
    return;
  }
  notes.forEach((m, i) => pick(m, t + i * strum, (vel / Math.sqrt(n)) * 1.1, decay));
}

/** Detuned supersaw lead. */
function superSaw(ctx, out, t, notes, dur, { vel = 1, detune = 22, cutoff = 6500, attack = 0.008, release = 0.12, sustain = 0.9, gain = 0.5 } = {}) {
  const f = midiToFreq(notes[0]);
  const spread = [-1, -0.5, 0, 0.5, 1];
  const oscs = spread.map((s) => osc(ctx, 'sawtooth', f, t, { detune: s * detune }));
  const sub = osc(ctx, 'square', f / 2, t);
  const sg = ctx.createGain();
  sg.gain.value = 0.25;
  const mix = ctx.createGain();
  mix.gain.value = 0.24;
  oscs.forEach((o) => o.connect(mix));
  sub.connect(sg).connect(mix);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.9;
  lp.frequency.value = cutoff;
  const g = ctx.createGain();
  mix.connect(lp).connect(g).connect(out);
  const stopAt = adsr(g.gain, t, dur, { a: attack, d: 0.05, s: sustain, r: release, peak: gain * vel });
  oscs.forEach((o) => o.stop(stopAt + 0.05));
  sub.stop(stopAt + 0.05);
}

/** Simple sine-ish whistle/flute lead with breath. */
const whistle = leadVoice({ wave: 'sine', cutoff: 8000, attack: 0.03, decay: 0.05, sustain: 0.9, release: 0.09, gain: 0.55, vibrato: 16, vibDelay: 0.12, vibRate: 5.6, breath: 0.05 });

export const VOICES = {
  bassFunk: bassVoice('funk'),
  bassSub: bassVoice('sub'),
  bassSaw: bassVoice('saw'),
  bassSquare: bassVoice('square'),
  bassPluck: bassVoice('pluck'),
  pad: padVoice,
  padSoft: (ctx, out, t, n, d, o = {}) => padVoice(ctx, out, t, n, d, { cutoff: 1100, attack: 0.6, release: 1.0, detune: 6, type: 'triangle', ...o }),
  stab: stabVoice,
  brass: (ctx, out, t, n, d, o = {}) => stabVoice(ctx, out, t, n, d, { cutoff: 2400, bright: 4, attack: 0.03, decay: 0.16, sustain: 0.75, release: 0.1, ...o }),
  pulse: leadVoice({ wave: 'pulse:0.25', cutoff: 5200, attack: 0.008, decay: 0.05, sustain: 0.85, release: 0.07, gain: 0.5, vibrato: 12, vibDelay: 0.16, thick: 5 }),
  pulse12: leadVoice({ wave: 'pulse:0.125', cutoff: 4800, attack: 0.006, decay: 0.05, sustain: 0.8, release: 0.06, gain: 0.48, vibrato: 10, vibDelay: 0.16 }),
  saw: leadVoice({ wave: 'sawtooth', cutoff: 3600, attack: 0.01, decay: 0.06, sustain: 0.85, release: 0.09, gain: 0.45, vibrato: 14, vibDelay: 0.2, thick: 8, env: 2.2 }),
  trumpet: leadVoice({ wave: 'sawtooth', cutoff: 2600, attack: 0.03, decay: 0.08, sustain: 0.85, release: 0.1, gain: 0.5, vibrato: 18, vibDelay: 0.25, vibRate: 5.2, thick: 5, env: 2.6, envTime: 0.09, q: 1.2 }),
  whistle,
  super: superSaw,
  twang: twangVoice,
  epiano: epianoVoice,
  pluck: pluckVoice({ wave: 'triangle', bright: 9, floor: 2, decay: 0.28, gain: 0.5, q: 1.2 }),
  pluckSaw: pluckVoice({ wave: 'sawtooth', bright: 8, floor: 1.6, decay: 0.22, gain: 0.4, q: 2, thick: 6 }),
  marimba: pluckVoice({ wave: 'sine', bright: 6, floor: 3, decay: 0.34, gain: 0.7, q: 0.5 }),
  glock: bellVoice({ ratio: 3.5, index: 2.2, decay: 0.9, idxDecay: 0.35, gain: 0.5, partial: 2 }),
  bell: bellVoice({ ratio: 3.5, index: 2.6, decay: 1.9, idxDecay: 0.5, gain: 0.5, partial: 2 }),
  chime: bellVoice({ ratio: 2.41, index: 1.7, decay: 2.6, idxDecay: 0.45, gain: 0.46, partial: 3 }),
  mallet: bellVoice({ ratio: 4, index: 1.1, decay: 0.55, idxDecay: 0.2, gain: 0.6 }),
};

/** Utility used by callers that want a quick saturation on a bus. */
export function makeSaturator(ctx, amount = 2) {
  const s = ctx.createWaveShaper();
  s.curve = satCurve(ctx, amount);
  s.oversample = '2x';
  return s;
}

export { clamp, EPS };
