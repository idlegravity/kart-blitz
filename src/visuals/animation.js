/**
 * Small animation toolkit for KartModel: 1D springs and "flex channels" that drive the GPU-bent appendages
 * (ears, antennae, tails, scarves, pom-poms...). See material.js for how uFlex/uWave are consumed.
 * OWNER: Visuals.
 */
import { clamp } from '../core/math.js';

/** Semi-implicit spring x'' = -k (x - target) - c x'. Sub-stepped so dt up to 1/20 stays stable. */
export class Spring {
  constructor(k = 120, c = 10, x = 0) {
    this.k = k;
    this.c = c;
    this.x = x;
    this.v = 0;
  }
  update(dt, target = 0) {
    if (dt <= 0) return this.x;
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.k * (this.x - target) - this.c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(v) {
    this.v += v;
  }
  reset(x = 0) {
    this.x = x;
    this.v = 0;
  }
}

/** Critically damped follow. */
export function follow(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

/** ease helpers */
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOutCubic = (t) => {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutQuad = (t) => 1 - (1 - clamp(t, 0, 1)) * (1 - clamp(t, 0, 1));

/**
 * One GPU flex channel. Reads a shared "drive" struct D each frame and writes uFlex[ch] / uWave[ch].
 * D: { t, speed, boost, accelZ, accelX, accelY, yawRate, excite, chaos, idle }
 */
export class FlexChannel {
  constructor(desc) {
    this.ch = desc.ch;
    this.kind = desc.kind;
    this.side = desc.side ?? 1;
    this.amp = desc.amp ?? 1;
    this.base = desc.base ?? [0, 0, 0];
    this.phase = (desc.ch * 1.7 + (desc.side ?? 1) * 0.9) % 6.28;
    const K = KINDS[desc.kind] ?? KINDS.ear;
    this.K = K;
    this.sx = new Spring(K.k, K.c);
    this.sz = new Spring(K.k * 0.9, K.c);
    this.twitchT = 1 + Math.random() * 3;
  }

  update(dt, D, uni) {
    const K = this.K;
    const u = uni.uFlex.value[this.ch];
    const w = uni.uWave.value[this.ch];
    const t = D.t + this.phase;
    let tx = this.base[0], ty = this.base[1], tz = this.base[2];
    let wax = 0, way = 0, waz = 0, wf = 0;
    const wind = Math.min(1.2, D.speed + D.boost * 0.4);

    if (this.kind === 'tail') {
      const wagAmt = (0.35 + 0.65 * D.excite) * this.amp;
      const freq = 3.2 + 6 * D.excite;
      ty = this.base[1] + Math.sin(t * freq) * 0.42 * wagAmt - D.accelX * 0.012;
      tx = this.base[0] - 0.22 * wind;
      tz = this.base[2] + Math.sin(t * freq * 0.5 + 1.3) * 0.08 * wagAmt;
    } else if (this.kind === 'scarf') {
      tx = this.base[0] + (0.25 + 1.1 * wind) * this.amp;
      ty = D.accelX * -0.02;
      wax = 0.16 + 0.25 * wind;
      way = 0.35 * wind;
      wf = 9 + 10 * wind;
    } else if (this.kind === 'ear' || this.kind === 'flop') {
      tx = this.base[0] - K.wind * wind;
      tz = this.base[2] + this.side * (-0.04 - 0.1 * D.chaos);
      waz = K.wave[2] * (0.2 + wind);
      wax = K.wave[0] * (0.2 + wind);
      wf = K.wave[3];
      // idle twitches
      if (D.idle) {
        this.twitchT -= D.dt;
        if (this.twitchT <= 0) {
          this.twitchT = 2.5 + Math.random() * 4;
          this.sx.kick(-6 - Math.random() * 4);
          this.sz.kick(this.side * (4 + Math.random() * 3));
        }
      }
    } else if (this.kind === 'antenna' || this.kind === 'pom') {
      tx = this.base[0] - K.wind * wind;
      wax = 0.03 + 0.04 * (D.idle ? 1 : wind);
      waz = 0.04 + 0.05 * (D.idle ? 1 : wind);
      wf = 3.5;
    }

    // forces from motion
    const fx = -D.accelZ * K.gAcc - D.accelY * K.gVert * 0.6 + D.yawRate * 0.0;
    const fz = -D.accelX * K.gLat * this.side * 0.3 + D.yawRate * -0.05 * this.side;
    this.sx.v += fx * D.dt * 40;
    this.sz.v += fz * D.dt * 40;
    // chaos shakes everything
    if (D.chaos > 0.01) {
      this.sx.v += Math.sin(t * 31) * D.chaos * 3 * D.dt * 60;
      this.sz.v += Math.cos(t * 27) * D.chaos * 3 * D.dt * 60;
    }
    this.sx.update(D.dt, tx);
    this.sz.update(D.dt, tz);
    u.set(clamp(this.sx.x, -1.4, 1.4), ty, clamp(this.sz.x, -1.4, 1.4));
    w.set(wax, way, waz, wf);
  }
}

const KINDS = {
  ear: { k: 110, c: 8.5, gAcc: 0.012, gVert: 0.035, gLat: 0.05, wind: 0.5, wave: [0.05, 0, 0.06, 20] },
  flop: { k: 55, c: 4.2, gAcc: 0.018, gVert: 0.05, gLat: 0.08, wind: 0.3, wave: [0.05, 0, 0.06, 15] },
  antenna: { k: 42, c: 2.3, gAcc: 0.02, gVert: 0.08, gLat: 0.09, wind: 0.3, wave: [0, 0, 0, 0] },
  pom: { k: 55, c: 3.2, gAcc: 0.02, gVert: 0.09, gLat: 0.09, wind: 0.2, wave: [0, 0, 0, 0] },
  tail: { k: 60, c: 5, gAcc: 0.01, gVert: 0.03, gLat: 0.04, wind: 0.2, wave: [0, 0, 0, 0] },
  scarf: { k: 30, c: 2.6, gAcc: 0.02, gVert: 0.07, gLat: 0.05, wind: 1, wave: [0, 0, 0, 0] },
};
