/**
 * Kart engine voices: layered oscillators through a moving low-pass with cylinder-pulse AM, plus (for the
 * player) boost whine/whoosh, tyre squeal and off-road rumble. Voices are pooled by AudioManager.
 * OWNER: Presentation.
 */
import { noiseSource, startNoise, satCurve, clamp } from './synth.js';

const EPS = 0.0001;

/** RPM (0..1) target for a kart: gear-shift sawtooth, idle revving on the grid, lift-off dip, air wheelspin. */
export function rpmTarget(kart) {
  const top = Math.max(kart.topSpeed || 30, 10);
  const spd = Math.abs(kart.speed || 0);
  const ratio = clamp(spd / top, 0, 1.25);
  const G = 5;
  const x = ratio * G * 0.92;
  const gi = Math.min(G - 1, Math.floor(x));
  const frac = clamp(x - gi, 0, 1.15);
  let t = gi === 0 ? 0.2 + 0.78 * frac : 0.47 + 0.55 * frac;
  const thr = kart.throttleAmount ?? kart.input?.throttle ?? 0;
  if (kart.controlLocked || ratio < 0.05) t = 0.2 + thr * 0.74;
  else if (thr < 0.15) t = Math.max(0.18, t - 0.15);
  if (kart.airborne ?? kart.grounded === false) t = Math.min(1.05, t + 0.16 + thr * 0.2);
  if (kart.hit) t *= 0.55;
  return clamp(t, 0.12, 1.08);
}

/** One engine (+ tyre + boost) voice. */
export class EngineVoice {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} dest
   * @param {{ player?: boolean }} o
   */
  constructor(ctx, dest, { player = false } = {}) {
    this.ctx = ctx;
    this.player = player;
    const t = ctx.currentTime;
    this.rpm = 0.2;
    this.active = false;

    // ---- output chain
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = 18000;
    this.out.connect(this.air);
    if (this.pan) {
      this.air.connect(this.pan);
      this.pan.connect(dest);
    } else this.air.connect(dest);

    // ---- engine core
    const mk = (type, gain) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      return { o, g };
    };
    this.osc = [mk('sawtooth', 0.5), mk('sawtooth', 0.4), mk('square', 0.42)];
    if (player) this.osc.push(mk('triangle', 0.3));
    this.osc[1].o.detune.value = 13;
    this.core = ctx.createGain();
    this.core.gain.value = 0.36;
    for (const { g } of this.osc) g.connect(this.core);
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 1.6;
    this.lp.frequency.value = 600;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = satCurve(ctx, 2.2);
    this.am = ctx.createGain();
    this.am.gain.value = 0.78;
    this.core.connect(this.lp).connect(this.shaper).connect(this.am).connect(this.out);
    // cylinder pulses
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle';
    this.lfo.frequency.value = 12;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0.2;
    this.lfo.connect(this.lfoDepth).connect(this.am.gain);

    // ---- intake hiss
    this.hiss = noiseSource(ctx, { loop: true });
    this.hissF = ctx.createBiquadFilter();
    this.hissF.type = 'bandpass';
    this.hissF.frequency.value = 900;
    this.hissF.Q.value = 0.8;
    this.hissG = ctx.createGain();
    this.hissG.gain.value = 0.02;
    this.hiss.connect(this.hissF).connect(this.hissG).connect(this.out);

    // ---- tyre squeal (drifting)
    this.skidN = noiseSource(ctx, { loop: true });
    this.skidF = ctx.createBiquadFilter();
    this.skidF.type = 'bandpass';
    this.skidF.frequency.value = 2100;
    this.skidF.Q.value = 9;
    this.skidG = ctx.createGain();
    this.skidG.gain.value = 0;
    this.skidN.connect(this.skidF).connect(this.skidG).connect(this.out);
    this.skidO = ctx.createOscillator();
    this.skidO.type = 'triangle';
    this.skidO.frequency.value = 1350;
    this.skidOG = ctx.createGain();
    this.skidOG.gain.value = 0;
    this.skidO.connect(this.skidOG).connect(this.out);
    this.skidLfo = ctx.createOscillator();
    this.skidLfo.frequency.value = 23;
    this.skidLfoG = ctx.createGain();
    this.skidLfoG.gain.value = 40;
    this.skidLfo.connect(this.skidLfoG).connect(this.skidO.detune);

    if (player) {
      // ---- boost whine + whoosh
      this.whine = ctx.createOscillator();
      this.whine.type = 'sine';
      this.whine.frequency.value = 900;
      this.whineG = ctx.createGain();
      this.whineG.gain.value = 0;
      this.whine.connect(this.whineG).connect(this.out);
      this.whoosh = noiseSource(ctx, { loop: true, pink: true });
      this.whooshF = ctx.createBiquadFilter();
      this.whooshF.type = 'highpass';
      this.whooshF.frequency.value = 1400;
      this.whooshG = ctx.createGain();
      this.whooshG.gain.value = 0;
      this.whoosh.connect(this.whooshF).connect(this.whooshG).connect(this.out);
      // ---- off-road rumble
      this.rumble = noiseSource(ctx, { loop: true, pink: true });
      this.rumbleF = ctx.createBiquadFilter();
      this.rumbleF.type = 'lowpass';
      this.rumbleF.frequency.value = 320;
      this.rumbleG = ctx.createGain();
      this.rumbleG.gain.value = 0;
      this.rumble.connect(this.rumbleF).connect(this.rumbleG).connect(this.out);
    }

    // start everything
    for (const { o } of this.osc) o.start(t);
    this.lfo.start(t);
    this.skidO.start(t);
    this.skidLfo.start(t);
    const startLoop = (n) => n.start(t, Math.random() * 1.5);
    startLoop(this.hiss);
    startLoop(this.skidN);
    if (player) {
      this.whine.start(t);
      startLoop(this.whoosh);
      startLoop(this.rumble);
    }
    void startNoise;
    this._level = 0;
    this._disposed = false;
  }

  /**
   * @param {number} dt seconds
   * @param {{ rpm: number, throttle: number, boost: number, skid: number, skidLevel: number, offroad: number, gain: number, pan: number, air: number, pitch: number }} s
   */
  update(dt, s) {
    if (this._disposed) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const tc = 0.035;
    const rpm = s.rpm;
    const pitch = s.pitch ?? 1;
    const f0 = (44 + rpm * 134) * pitch;
    this.osc[0].o.frequency.setTargetAtTime(f0, now, tc);
    this.osc[1].o.frequency.setTargetAtTime(f0, now, tc);
    this.osc[2].o.frequency.setTargetAtTime(f0 * 0.5, now, tc);
    if (this.player) this.osc[3].o.frequency.setTargetAtTime(f0 * 2, now, tc);
    const thr = s.throttle;
    this.lp.frequency.setTargetAtTime((420 + rpm * 2300 + thr * 1000 + (s.boost || 0) * 700) * (s.air ?? 1), now, tc);
    this.lfo.frequency.setTargetAtTime(9 + rpm * 26, now, tc);
    this.lfoDepth.gain.setTargetAtTime(0.22 - rpm * 0.1, now, tc);
    const level = (this.player ? 0.4 : 0.22) * (0.42 + 0.58 * (0.35 + 0.65 * thr)) * (0.6 + 0.4 * rpm);
    this.core.gain.setTargetAtTime(level, now, 0.05);
    this.hissF.frequency.setTargetAtTime(700 + rpm * 1800, now, tc);
    this.hissG.gain.setTargetAtTime((0.015 + 0.05 * thr) * (this.player ? 1 : 0.5), now, 0.05);

    // tyre squeal
    const sk = s.skid;
    this.skidG.gain.setTargetAtTime(sk * (this.player ? 0.11 : 0.06), now, 0.04);
    this.skidOG.gain.setTargetAtTime(sk * (this.player ? 0.035 : 0.02), now, 0.04);
    const lvl = 1 + (s.skidLevel || 0) * 0.07;
    this.skidF.frequency.setTargetAtTime(2100 * lvl, now, 0.08);
    this.skidO.frequency.setTargetAtTime(1350 * lvl, now, 0.08);

    if (this.player) {
      const b = s.boost || 0;
      this.whineG.gain.setTargetAtTime(b * 0.05, now, 0.06);
      this.whine.frequency.setTargetAtTime(760 + rpm * 500 + b * 900, now, 0.06);
      this.whooshG.gain.setTargetAtTime(b * 0.13, now, 0.08);
      this.whooshF.frequency.setTargetAtTime(1000 + b * 1800, now, 0.08);
      this.rumbleG.gain.setTargetAtTime((s.offroad || 0) * 0.42, now, 0.08);
      this.rumbleF.frequency.setTargetAtTime(220 + rpm * 200, now, 0.08);
    }

    this.out.gain.setTargetAtTime(s.gain, now, 0.06);
    if (this.pan) this.pan.pan.setTargetAtTime(s.pan ?? 0, now, 0.05);
    this.air.frequency.setTargetAtTime(s.airCut ?? 18000, now, 0.08);
    this._level = s.gain;
  }

  /** Fade out and free. */
  dispose(fade = 0.12) {
    if (this._disposed) return;
    this._disposed = true;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setValueAtTime(this.out.gain.value, now);
      this.out.gain.linearRampToValueAtTime(0, now + fade);
    } catch {
      /* context closed */
    }
    const stopAt = now + fade + 0.05;
    const srcs = [...this.osc.map((x) => x.o), this.lfo, this.hiss, this.skidN, this.skidO, this.skidLfo];
    if (this.player) srcs.push(this.whine, this.whoosh, this.rumble);
    for (const s of srcs) {
      try {
        s.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    setTimeout(() => {
      try {
        this.out.disconnect();
        this.air.disconnect();
        this.pan?.disconnect();
      } catch {
        /* ignore */
      }
    }, (fade + 0.3) * 1000);
  }
}

export { EPS };
