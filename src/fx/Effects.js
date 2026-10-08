/**
 * Effects — every particle effect in the game. Contract (ARCHITECTURE.md §6.6):
 *   new Effects(game); setupRace(ctx); teardownRace(); update(dt)
 *   burst(type, position, opts)  types: 'explosion','hit','boxBreak','sparks','dust','splash','confetti','smoke','ring','stars','lightning'
 * Continuous emitters are driven from game.karts state through the KartModel anchors: drift sparks (blue / orange /
 * purple by driftLevel, faint white while charging), tire smoke, boost flames by boostSource (+ shock ring on mini-turbo),
 * offroad dust tinted by track theme, star sparkle trail, pooled skid-mark ribbons.
 * Subscribes to the kart / item / race events itself. Draw calls: additive layer + alpha layer + skid marks + lightning = 4.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { EVT } from '../core/events.js';
import { QUALITY } from '../core/constants.js';
import { clamp } from '../core/math.js';
import { ParticleSystem } from './ParticleSystem.js';
import { CELL } from './sprites.js';
import { SkidMarks } from './skid.js';
import { LightningBolts } from './lightning.js';

const R = Math.random;
const rr = (a, b) => a + (b - a) * R();
const col = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const hue = (h, s = 1, l = 0.55) => {
  const c = new THREE.Color().setHSL(h % 1, s, l, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
};

const DRIFT = { 1: col('#3fa9ff'), 2: col('#ff8a1c'), 3: col('#d14bff') };
const DUST = { meadow: col('#8a7048'), canyon: col('#e0b070'), glacier: col('#f4faff'), neon: col('#33e8ff') };
const WHITE = [1, 1, 1];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _cf = new THREE.Vector3();
const _hc = new THREE.Color();
const _FC = { c0: [1, 1, 1], c1: [1, 1, 1] };

export class Effects {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.qscale = (QUALITY[game.settings?.quality] ?? QUALITY.high).particles;
    this.active = false;
    this.ps = new ParticleSystem({ additive: 7000, alpha: 3500, overlay: 700 });
    this.add = this.ps.additive;
    this.alpha = this.ps.alpha;
    this.ov = this.ps.overlay;
    this.skid = new SkidMarks(this.ps.uTime, 1100);
    this.lightning = new LightningBolts();
    this.light = new THREE.PointLight(0xffaa55, 0, 38, 2);
    this.light.castShadow = false;
    this.lightI = 0;
    this._ks = new WeakMap();
    this._camPos = [];
    this._lastExplode = { t: -9, p: new THREE.Vector3() };
    this._fins = []; // finish-line confetti cannons that follow each human who finishes
    this._bind();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------------------------------------------
  setupRace() {
    const scene = this.game.scene;
    scene.add(this.ps.group, this.skid.mesh, this.lightning.mesh, this.light);
    this.clear();
    this.active = true;
  }

  teardownRace() {
    this.active = false;
    const scene = this.game.scene;
    scene.remove(this.ps.group, this.skid.mesh, this.lightning.mesh, this.light);
    this.clear();
    this._ks = new WeakMap();
  }

  clear() {
    this.ps.clear();
    this.skid.clear();
    this.lightning.clear();
    this.light.intensity = 0;
    this.lightI = 0;
    this._fins = [];
  }

  dispose() {
    for (const off of this._offs ?? []) off();
    this.ps.dispose();
    this.skid.dispose();
    this.lightning.dispose();
  }

  _st(k) {
    let s = this._ks.get(k);
    if (!s) {
      s = { acc: { spark: 0, smoke: 0, flame: 0, dust: 0, star: 0, stall: 0, wind: 0 }, maxLevel: 0, mtLevel: 0, skid: [null, null], lastGround: true };
      this._ks.set(k, s);
    }
    return s;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // per-frame
  // ---------------------------------------------------------------------------------------------------------------
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.qscale = (QUALITY[g.settings?.quality] ?? QUALITY.high).particles;
    const cams = this._cams();
    for (const k of g.karts) if (k.model) this._emitKart(dt, k, cams);
    // pooled point light flash
    if (this.lightI > 0.5) {
      this.lightI *= Math.exp(-dt * 8.5);
      this.light.intensity = this.lightI;
    } else if (this.light.intensity !== 0) {
      this.lightI = 0;
      this.light.intensity = 0;
    }
    this._finishCannon(dt);
    this.lightning.update(dt);
    this.ps.update(dt);
    this.skid.flush();
  }

  /** Positions of every view camera (split-screen) or just the main camera; LOD uses the nearest one. */
  _cams() {
    const g = this.game;
    const out = this._camPos;
    out.length = 0;
    const views = g.views;
    if (views && views.length > 1) for (const v of views) out.push(v.camera.position);
    else out.push(g.camera.position);
    return out;
  }

  /** Human karts (split-screen aware). */
  _humans() {
    const g = this.game;
    return g.players?.length ? g.players : g.player ? [g.player] : [];
  }

  /** After a human finishes: a few seconds of confetti raining down ahead of / around the kart. */
  _finishCannon(dt) {
    for (let i = this._fins.length - 1; i >= 0; i--) {
      const f = this._fins[i];
      f.t -= dt;
      if (f.t <= 0) this._fins.splice(i, 1);
      else this._cannon(f, dt);
    }
  }

  _cannon(f, dt) {
    const k = f.kart;
    f.acc += dt * 170 * (0.5 + 0.5 * this.qscale);
    const fw = k.forward, rt = k.right, kv = k.velocity;
    while (f.acc >= 1) {
      f.acc -= 1;
      const ahead = rr(-2, 16), side = rr(-6, 6), h = rr(2.5, 8);
      _hc.setHSL(R(), 0.95, 0.58, THREE.SRGBColorSpace);
      this.alpha.add({
        x: k.position.x + fw.x * ahead + rt.x * side, y: k.position.y + h, z: k.position.z + fw.z * ahead + rt.z * side,
        vx: (kv ? kv.x * 0.55 : 0) + rr(-2, 2), vy: rr(-1, 4), vz: (kv ? kv.z * 0.55 : 0) + rr(-2, 2),
        life: rr(2.4, 4), s0: rr(0.3, 0.5), s1: rr(0.3, 0.5), cell: CELL.CONFETTI, mode: 3, rot: R() * 6.28, spin: rr(6, 14), grav: 6, drag: 1.4,
        r0: _hc.r * 1.15, g0: _hc.g * 1.15, b0: _hc.b * 1.15, a0: 1, a1: 1,
      });
    }
  }

  _emitKart(dt, k, cams) {
    const m = k.model;
    const st = this._st(k);
    const acc = st.acc;
    let d2 = Infinity;
    for (let i = 0; i < cams.length; i++) d2 = Math.min(d2, k.position.distanceToSquared(cams[i]));
    let lod = d2 < 484 ? 1 : d2 < 3025 ? 0.55 : d2 < 12100 ? 0.25 : 0;
    if (k.isPlayer) lod = Math.max(lod, 0.9);
    const q = this.qscale;
    const rate = (r) => r * lod * q * dt;
    const grounded = k.grounded !== false;
    const speed = Math.abs(k.speed ?? 0);
    const top = Math.max(8, k.topSpeed || 30);
    const drifting = !!k.drifting && grounded;
    const level = k.driftLevel | 0;

    if (drifting) st.maxLevel = Math.max(st.maxLevel, level);
    else if ((k.boostTime ?? 0) <= 0) st.maxLevel = 0;
    if ((k.boostTime ?? 0) <= 0) st.mtLevel = 0;

    // ---------------- skid marks (drifting or any hard slide) ----------------
    const slip = k.slipAmount ?? 0;
    const skidding = (drifting || slip > 0.45) && grounded && speed > 6;
    const skidInt = drifting ? clamp(0.65 + 0.35 * slip, 0.65, 1) : clamp((slip - 0.4) * 1.8, 0.2, 0.8);
    for (let i = 0; i < 2; i++) {
      const wheel = m.getAnchor(i === 0 ? 'wheelRL' : 'wheelRR', _a);
      this._skid(st, i, wheel, k, skidding, skidInt);
    }

    // ---------------- drift sparks + glow + tire smoke ----------------
    if (drifting && lod > 0 && (k.driftCharge > 0.04 || level > 0)) {
      const c = level > 0 ? DRIFT[level] : WHITE;
      const bright = level === 0 ? 1.15 : level === 1 ? 3.1 : level === 2 ? 3.5 : 4.0;
      acc.spark += rate(level === 0 ? 30 : level === 1 ? 80 : level === 2 ? 115 : 150);
      while (acc.spark >= 1) {
        acc.spark -= 1;
        const w = R() < 0.5 ? 'wheelRL' : 'wheelRR';
        m.getAnchor(w, _b);
        this._spark(_b, k, c, bright, w === 'wheelRL' ? 1 : -1);
      }
      for (const w of ['wheelRL', 'wheelRR']) {
        m.getAnchor(w, _b);
        this.add.add({
          x: _b.x, y: _b.y + 0.12, z: _b.z, life: 0.075, s0: 0.5 + (level > 0 ? 0.25 : 0), s1: 0.3, cell: CELL.GLOW,
          r0: c[0] * (bright * 0.7), g0: c[1] * (bright * 0.7), b0: c[2] * (bright * 0.7), a0: level > 0 ? 0.95 : 0.5, a1: 0,
        });
      }
    }
    const smokeRate = drifting ? (level > 0 ? 30 : 22) : slip > 0.35 ? 26 * slip : 0;
    if (smokeRate > 0 && grounded && speed > 8 && lod > 0) {
      acc.smoke += rate(smokeRate);
      while (acc.smoke >= 1) {
        acc.smoke -= 1;
        m.getAnchor(R() < 0.5 ? 'wheelRL' : 'wheelRR', _b);
        this._smoke(_b, k, 0.28 + 0.12 * slip);
      }
    }

    // ---------------- burnout (botched rocket start): heavy rear-wheel smoke ----------------
    if ((k.stallTime ?? 0) > 0 && lod > 0) {
      acc.stall += rate(85);
      while (acc.stall >= 1) {
        acc.stall -= 1;
        m.getAnchor(R() < 0.5 ? 'wheelRL' : 'wheelRR', _b);
        this._smoke(_b, k, 0.5, 1.9);
      }
    }

    // ---------------- slipstream: wind streaks rushing past the drafting kart ----------------
    if (k.drafting && grounded && speed > 8 && lod >= 0.5) {
      const dc = clamp((k.draftCharge ?? 0) / 1.6, 0.25, 1);
      acc.wind += rate(100 * dc);
      while (acc.wind >= 1) {
        acc.wind -= 1;
        const f = k.forward, r = k.right;
        const ahead = rr(-1, 5.5), side = rr(-2, 2), up = rr(0.25, 1.7);
        this.add.add({
          x: k.position.x + f.x * ahead + r.x * side, y: k.position.y + up, z: k.position.z + f.z * ahead + r.z * side,
          vx: -f.x * speed * 1.25, vy: 0, vz: -f.z * speed * 1.25,
          life: rr(0.24, 0.36), s0: rr(0.03, 0.06), s1: 0.012, cell: CELL.STREAK, mode: 1, stretch: rr(12, 24),
          r0: 1.5, g0: 2.0, b0: 2.5, a0: 0.75 * dc + 0.2, a1: 0,
        });
      }
    }

    // ---------------- boost flames ----------------
    if ((k.boostTime ?? 0) > 0 && lod > 0) {
      acc.flame += rate(72) * (k.boostSource === 'rocketstart' ? 1.4 : k.boostSource === 'draft' ? 0.4 : 1);
      while (acc.flame >= 1) {
        acc.flame -= 1;
        m.getAnchor(R() < 0.5 ? 'exhaustL' : 'exhaustR', _b);
        this._flame(_b, k, st);
      }
      // hot glow at the pipes
      if (lod >= 0.5) {
        for (const a of ['exhaustL', 'exhaustR']) {
          m.getAnchor(a, _b);
          const fc = this._flameColors(k, st, 0);
          this.add.add({ x: _b.x, y: _b.y, z: _b.z, life: 0.08, s0: 0.85, s1: 0.5, cell: CELL.GLOW, r0: fc.c0[0] * 0.9, g0: fc.c0[1] * 0.9, b0: fc.c0[2] * 0.9, a0: 0.9, a1: 0 });
        }
      }
    }

    // ---------------- offroad dust ----------------
    if (k.surface === 'offroad' && grounded && speed > 4 && lod > 0) {
      acc.dust += rate(84 * clamp(speed / top, 0.15, 1.2));
      while (acc.dust >= 1) {
        acc.dust -= 1;
        m.getAnchor(['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'][(R() * 4) | 0], _b);
        this._dust(_b, k, this.game.track?.theme);
      }
    }

    // ---------------- star sparkle trail ----------------
    if ((k.starTime ?? 0) > 0 && lod > 0) {
      acc.star += rate(48);
      while (acc.star >= 1) {
        acc.star -= 1;
        this._sparkle(k);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // emitters
  // ---------------------------------------------------------------------------------------------------------------
  _spark(p, k, c, bright, side) {
    const f = k.forward, right = k.right;
    const back = 2.5 + R() * 5;
    const out = side * (0.6 + R() * 2.6);
    const up = 1.5 + R() * 3.8;
    this.add.add({
      x: p.x, y: p.y + 0.08, z: p.z,
      vx: -f.x * back + right.x * -out + (R() - 0.5) * 1.2 + (k.velocity ? k.velocity.x * 0.35 : 0),
      vy: up,
      vz: -f.z * back + right.z * -out + (R() - 0.5) * 1.2 + (k.velocity ? k.velocity.z * 0.35 : 0),
      life: rr(0.26, 0.56), s0: rr(0.05, 0.1), s1: 0.02, cell: CELL.STREAK, mode: 1, stretch: rr(3.5, 6.5), grav: 11, drag: 0.5,
      r0: c[0] * bright, g0: c[1] * bright, b0: c[2] * bright, a0: 1,
      r1: c[0] * bright * 0.3, g1: c[1] * bright * 0.3, b1: c[2] * bright * 0.3, a1: 0,
    });
  }

  _smoke(p, k, alpha = 0.36, size = 1.3) {
    const f = k.forward;
    this.alpha.add({
      x: p.x, y: p.y + 0.15, z: p.z,
      vx: -f.x * rr(0.5, 2.5) + (R() - 0.5) * 1.2, vy: rr(0.5, 1.5), vz: -f.z * rr(0.5, 2.5) + (R() - 0.5) * 1.2,
      life: rr(0.8, 1.3), s0: rr(0.25, 0.4), s1: size * rr(0.8, 1.2), cell: R() < 0.5 ? CELL.SMOKE : CELL.SMOKE2, rot: R() * 6.28, spin: rr(-0.7, 0.7),
      drag: 1.4, r0: 0.86, g0: 0.86, b0: 0.9, a0: alpha, r1: 0.7, g1: 0.7, b1: 0.75, a1: 0,
    });
  }

  _flameColors(k, st, i) {
    // fills shared scratch arrays (used immediately by the caller)
    const c0 = _FC.c0, c1 = _FC.c1;
    const set = (a, r, g, b) => {
      a[0] = r; a[1] = g; a[2] = b;
    };
    const src = k.boostSource;
    if (src === 'miniturbo') {
      const L = DRIFT[st.mtLevel || st.maxLevel || 1] ?? DRIFT[1];
      set(c0, L[0] * 0.5 + 1.4, L[1] * 0.5 + 1.4, L[2] * 0.5 + 1.4);
      set(c1, L[0] * 1.3, L[1] * 1.3, L[2] * 1.3);
    } else if (src === 'nitro') {
      if (i % 3 === 2) { set(c0, 1.4, 2.5, 4.2); set(c1, 0.25, 0.55, 1.7); }
      else { set(c0, 4.0, 2.8, 1.2); set(c1, 1.5, 0.38, 0.05); }
    } else if (src === 'goldnitro') { set(c0, 4.2, 3.4, 1.3); set(c1, 1.6, 0.8, 0.1); }
    else if (src === 'pad') { set(c0, 1.4, 3.2, 3.8); set(c1, 0.15, 0.85, 1.7); }
    else if (src === 'rocketstart') { set(c0, 4.4, 3.2, 1.5); set(c1, 1.6, 0.42, 0.06); }
    else if (src === 'trick') { set(c0, 3.0, 3.4, 4.0); set(c1, 0.6, 1.0, 1.8); }
    else if (src === 'draft') { set(c0, 1.6, 2.4, 3.0); set(c1, 0.45, 0.9, 1.4); }
    else { set(c0, 3.8, 2.6, 1.1); set(c1, 1.4, 0.35, 0.05); }
    if ((k.starTime ?? 0) > 0) {
      _hc.setHSL((this.ps.time * 1.6 + i * 0.13 + R() * 0.2) % 1, 1, 0.55, THREE.SRGBColorSpace);
      set(c0, _hc.r * 3.4 + 0.5, _hc.g * 3.4 + 0.5, _hc.b * 3.4 + 0.5);
      set(c1, _hc.r * 1.4, _hc.g * 1.4, _hc.b * 1.4);
    }
    return _FC;
  }

  _flame(p, k, st) {
    const i = (R() * 6) | 0;
    const { c0, c1 } = this._flameColors(k, st, i);
    const big = k.boostSource === 'rocketstart' ? 1.35 : k.boostSource === 'goldnitro' ? 1.15 : k.boostSource === 'draft' ? 0.62 : 1;
    const blue = k.boostSource === 'nitro' && i % 3 === 2;
    const sp = 7.5 + R() * 4;
    const kv = k.velocity;
    // exhausts point along the CHASSIS (k.forward is the travel heading; the drift slide only lives in k.quaternion)
    const cf = _cf.set(0, 0, 1).applyQuaternion(k.quaternion);
    this.add.add({
      x: p.x, y: p.y, z: p.z,
      vx: -cf.x * sp + (kv ? kv.x * 0.6 : 0) + (R() - 0.5) * 1.1,
      vy: (R() - 0.5) * 0.9 + 0.3,
      vz: -cf.z * sp + (kv ? kv.z * 0.6 : 0) + (R() - 0.5) * 1.1,
      life: rr(0.2, 0.34), s0: (blue ? 0.17 : 0.38) * big * rr(0.85, 1.15), s1: 0.05, cell: CELL.FLAME, mode: 1, stretch: blue ? 5 : rr(3, 4.2), grav: -1.5, drag: 0.6,
      r0: c0[0], g0: c0[1], b0: c0[2], a0: 1, r1: c1[0], g1: c1[1], b1: c1[2], a1: 0.6,
    });
  }

  _dust(p, k, theme) {
    const f = k.forward;
    const c = DUST[theme] ?? DUST.meadow;
    if (theme === 'neon') {
      this.add.add({
        x: p.x, y: p.y + 0.05, z: p.z,
        vx: -f.x * rr(1, 4) + (R() - 0.5) * 3, vy: rr(1, 3.5), vz: -f.z * rr(1, 4) + (R() - 0.5) * 3,
        life: rr(0.25, 0.5), s0: 0.07, s1: 0.02, cell: CELL.STREAK, mode: 1, stretch: 4, grav: 10, drag: 0.6,
        r0: c[0] * 3, g0: c[1] * 3, b0: c[2] * 3, a0: 1, a1: 0,
      });
      return;
    }
    const snow = theme === 'glacier';
    this.alpha.add({
      x: p.x, y: p.y + 0.08, z: p.z,
      vx: -f.x * rr(1, 3.2) + (R() - 0.5) * 2.4, vy: rr(0.8, 2.4), vz: -f.z * rr(1, 3.2) + (R() - 0.5) * 2.4,
      life: rr(0.7, 1.2), s0: rr(0.35, 0.55), s1: rr(1.5, 2.3), cell: R() < 0.5 ? CELL.SMOKE : CELL.SMOKE2, rot: R() * 6.28, spin: rr(-1, 1),
      drag: 1.7, grav: snow ? 1.5 : 0.5, r0: c[0], g0: c[1], b0: c[2], a0: snow ? 0.7 : 0.6, r1: c[0] * 0.85, g1: c[1] * 0.85, b1: c[2] * 0.85, a1: 0,
    });
  }

  _sparkle(k) {
    const f = k.forward, r = k.right, u = k.up;
    const x = (R() - 0.5) * 1.5, y = 0.1 + R() * 1.6, z = (R() - 0.5) * 2.0;
    const c = hue(R() + this.ps.time * 0.5, 1, 0.6);
    const b = 2.6;
    this.add.add({
      x: k.position.x + r.x * x + u.x * y + f.x * z, y: k.position.y + r.y * x + u.y * y + f.y * z, z: k.position.z + r.z * x + u.z * y + f.z * z,
      vx: (R() - 0.5) * 0.8 - f.x * Math.abs(k.speed) * 0.12, vy: rr(0.4, 1.6), vz: (R() - 0.5) * 0.8 - f.z * Math.abs(k.speed) * 0.12,
      life: rr(0.45, 0.85), s0: rr(0.16, 0.34), s1: 0, cell: R() < 0.6 ? CELL.SPARKLE : CELL.STAR, rot: R() * 6.28, spin: rr(-4, 4), grav: 0.5,
      r0: c[0] * b, g0: c[1] * b, b0: c[2] * b, a0: 1, a1: 0,
    });
  }

  _skid(st, i, contact, k, active, intensity = 1) {
    const prev = st.skid[i];
    if (!active) {
      st.skid[i] = null;
      return;
    }
    const right = k.right, up = k.up;
    const hw = 0.13;
    const nl = [contact.x - right.x * hw + up.x * 0.03, contact.y - right.y * hw + up.y * 0.03, contact.z - right.z * hw + up.z * 0.03];
    const nr = [contact.x + right.x * hw + up.x * 0.03, contact.y + right.y * hw + up.y * 0.03, contact.z + right.z * hw + up.z * 0.03];
    if (!prev) {
      st.skid[i] = { l: nl, r: nr, c: [contact.x, contact.y, contact.z] };
      return;
    }
    const dx = contact.x - prev.c[0], dz = contact.z - prev.c[2];
    if (dx * dx + dz * dz < 0.16) return;
    this.skid.addQuad(prev.l, prev.r, nr, nl, intensity);
    st.skid[i] = { l: nl, r: nr, c: [contact.x, contact.y, contact.z] };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // bursts
  // ---------------------------------------------------------------------------------------------------------------
  /**
   * Fire a one-shot effect.
   * @param {'explosion'|'hit'|'boxBreak'|'sparks'|'dust'|'splash'|'confetti'|'smoke'|'ring'|'stars'|'lightning'} type
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position world position
   * @param {object} [opts] { scale, count, color: [r,g,b] | hex, normal, owner, flat, size, ... }
   */
  burst(type, position, opts = {}) {
    if (!this.active && !opts.force) return;
    const p = position;
    const s = opts.scale ?? 1;
    switch (type) {
      case 'explosion': return this._explosion(p, s, opts);
      case 'hit': return this._hit(p, s, opts);
      case 'boxBreak': return this._boxBreak(p, s);
      case 'sparks': return this._sparks(p, s, opts);
      case 'dust': return this._dustBurst(p, s, opts);
      case 'splash': return this._splash(p, s);
      case 'confetti': return this._confetti(p, s, opts);
      case 'smoke': return this._smokeBurst(p, s, opts);
      case 'ring': return this._ring(p, s, opts);
      case 'stars': return this._stars(p, s, opts);
      case 'lightning': return this._lightning(p, opts);
      default: return undefined;
    }
  }

  _n(count) {
    return Math.max(1, Math.round(count * (0.5 + 0.5 * this.qscale)));
  }

  _explosion(p, s, opts) {
    const add = this.add, al = this.alpha;
    // flash + glow
    this.ov.add({ x: p.x, y: p.y + 0.4 * s, z: p.z, life: 0.18, s0: 1.6 * s, s1: 5.2 * s, cell: CELL.BURST, r0: 3.2, g0: 2.5, b0: 1.6, a0: 1, a1: 0, rot: R() * 6 });
    this.ov.add({ x: p.x, y: p.y + 0.5 * s, z: p.z, life: 0.4, s0: 2.2 * s, s1: 5.5 * s, cell: CELL.GLOW, r0: 2.2, g0: 1.0, b0: 0.3, a0: 0.75, a1: 0 });
    // fireball
    for (let i = 0; i < this._n(16); i++) {
      const a = R() * 6.283, e = rr(-0.1, 1.0), sp = rr(2, 8.5) * s;
      add.add({
        x: p.x + (R() - 0.5) * 0.6 * s, y: p.y + 0.4 * s, z: p.z + (R() - 0.5) * 0.6 * s,
        vx: Math.cos(a) * sp * (1 - e * 0.5), vy: Math.sin(e * 1.4) * sp * 0.9 + 1.5, vz: Math.sin(a) * sp * (1 - e * 0.5),
        life: rr(0.45, 0.85), s0: rr(0.9, 1.5) * s, s1: rr(1.8, 3.0) * s, cell: R() < 0.5 ? CELL.DOT : CELL.SMOKE, rot: R() * 6, spin: rr(-2, 2), drag: 2.2, grav: -1,
        r0: 2.6, g0: 1.05, b0: 0.25, a0: 0.8, r1: 0.7, g1: 0.09, b1: 0.015, a1: 0,
      });
    }
    // smoke
    for (let i = 0; i < this._n(14); i++) {
      const a = R() * 6.283, sp = rr(0.5, 3.5) * s;
      al.add({
        x: p.x + (R() - 0.5) * s, y: p.y + rr(0.2, 1.0) * s, z: p.z + (R() - 0.5) * s,
        vx: Math.cos(a) * sp, vy: rr(1.5, 4.5) * s, vz: Math.sin(a) * sp,
        life: rr(1.3, 2.3), s0: rr(1.2, 2) * s, s1: rr(3.2, 5.2) * s, cell: R() < 0.5 ? CELL.SMOKE : CELL.SMOKE2, rot: R() * 6, spin: rr(-0.6, 0.6), drag: 1.5,
        r0: 0.16, g0: 0.14, b0: 0.13, a0: 0.75, r1: 0.42, g1: 0.4, b1: 0.4, a1: 0,
      });
    }
    // debris chunks + sparks
    for (let i = 0; i < this._n(14); i++) {
      const a = R() * 6.283, sp = rr(4, 11) * s;
      al.add({
        x: p.x, y: p.y + 0.5 * s, z: p.z, vx: Math.cos(a) * sp, vy: rr(6, 14) * Math.sqrt(s), vz: Math.sin(a) * sp,
        life: rr(0.9, 1.5), s0: rr(0.16, 0.36) * s, s1: rr(0.1, 0.24) * s, cell: CELL.CHUNK, rot: R() * 6, spin: rr(-12, 12), grav: 24, drag: 0.15,
        r0: 0.14, g0: 0.11, b0: 0.09, a0: 1, r1: 0.1, g1: 0.08, b1: 0.06, a1: 1,
      });
    }
    for (let i = 0; i < this._n(26); i++) {
      const a = R() * 6.283, sp = rr(4, 14) * s;
      add.add({
        x: p.x, y: p.y + 0.5 * s, z: p.z, vx: Math.cos(a) * sp, vy: rr(3, 12), vz: Math.sin(a) * sp,
        life: rr(0.4, 0.9), s0: rr(0.06, 0.12), s1: 0.02, cell: CELL.STREAK, mode: 1, stretch: rr(4, 8), grav: 16, drag: 0.4,
        r0: 4, g0: 2.6, b0: 0.9, a0: 1, r1: 1.4, g1: 0.5, b1: 0.1, a1: 0,
      });
    }
    // shock rings (flat + billboard)
    add.add({ x: p.x, y: p.y + 0.06, z: p.z, life: 0.55, s0: 1.2 * s, s1: 9 * s, cell: CELL.RING, mode: 2, r0: 3, g0: 1.9, b0: 0.8, a0: 0.9, a1: 0 });
    this.ov.add({ x: p.x, y: p.y + 0.6 * s, z: p.z, life: 0.4, s0: 1 * s, s1: 8 * s, cell: CELL.RING, r0: 2.4, g0: 1.4, b0: 0.6, a0: 0.7, a1: 0 });
    this.flashLight(p, 0xff9040, 1100 * Math.min(2, s), 3.5 * s);
    this._lastExplode.t = this.ps.time;
    this._lastExplode.p.set(p.x, p.y, p.z);
    // screen flash when it goes off near the player
    const pfx = this.game.postfx;
    if (pfx?.flash) {
      for (const pl of this._humans()) {
        const d = Math.hypot(pl.position.x - p.x, pl.position.z - p.z);
        if (d < 14 * s) pfx.flash(clamp(0.34 - d * 0.02, 0.08, 0.3), 0xffc070, 0.22, pl);
      }
    }
  }

  _hit(p, s, opts) {
    const add = this.add;
    this.ov.add({ x: p.x, y: p.y, z: p.z, life: 0.22, s0: 1.4 * s, s1: 4.2 * s, cell: CELL.BURST, r0: 3.6, g0: 3.0, b0: 2.0, a0: 1, a1: 0, rot: R() * 6 });
    this.ov.add({ x: p.x, y: p.y, z: p.z, life: 0.3, s0: 0.8 * s, s1: 4.6 * s, cell: CELL.RING, r0: 3, g0: 2.6, b0: 1.6, a0: 0.85, a1: 0 });
    const cols = [[3.2, 2.6, 0.5], [3.4, 3.2, 2.4], [3.0, 1.2, 2.2], [1.0, 2.6, 3.4]];
    for (let i = 0; i < this._n(9); i++) {
      const a = R() * 6.283, sp = rr(2.5, 6.5) * s;
      const c = cols[i % cols.length];
      add.add({
        x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp, vy: rr(1, 5) * s, vz: Math.sin(a) * sp,
        life: rr(0.6, 1.0), s0: rr(0.3, 0.48) * s, s1: 0.06, cell: CELL.STAR, rot: R() * 6, spin: rr(-6, 6), drag: 2.0, grav: 3,
        r0: c[0], g0: c[1], b0: c[2], a0: 1, a1: 0,
      });
    }
    for (let i = 0; i < this._n(8); i++) {
      const a = R() * 6.283, sp = rr(3, 8) * s;
      add.add({
        x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp, vy: rr(1, 6), vz: Math.sin(a) * sp,
        life: rr(0.25, 0.5), s0: 0.07, s1: 0.02, cell: CELL.STREAK, mode: 1, stretch: 5, grav: 12, drag: 0.5, r0: 4, g0: 3.2, b0: 1.4, a0: 1, a1: 0,
      });
    }
  }

  _boxBreak(p, s) {
    const add = this.add;
    this.ov.add({ x: p.x, y: p.y, z: p.z, life: 0.24, s0: 1.6 * s, s1: 4.6 * s, cell: CELL.GLOW, r0: 2.6, g0: 2.6, b0: 3, a0: 0.9, a1: 0 });
    this.ov.add({ x: p.x, y: p.y, z: p.z, life: 0.38, s0: 0.8 * s, s1: 5 * s, cell: CELL.RING, r0: 2.4, g0: 2.4, b0: 3, a0: 0.8, a1: 0 });
    const n = this._n(20);
    for (let i = 0; i < n; i++) {
      const c = hue(i / n + R() * 0.05, 1, 0.58);
      const a = R() * 6.283, e = R(), sp = rr(3, 7.5) * s;
      add.add({
        x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp * (0.4 + e), vy: rr(1.5, 7), vz: Math.sin(a) * sp * (0.4 + e),
        life: rr(0.8, 1.3), s0: rr(0.34, 0.52) * s, s1: 0.08, cell: CELL.SHARD, rot: R() * 6, spin: rr(-14, 14), grav: 14, drag: 0.7,
        r0: c[0] * 2.4, g0: c[1] * 2.4, b0: c[2] * 2.4, a0: 1, a1: 0.3,
      });
    }
    for (let i = 0; i < this._n(12); i++) {
      const c = hue(R(), 0.7, 0.75);
      const a = R() * 6.283, sp = rr(1, 4) * s;
      add.add({
        x: p.x + (R() - 0.5) * 0.6, y: p.y + (R() - 0.5) * 0.6, z: p.z + (R() - 0.5) * 0.6, vx: Math.cos(a) * sp, vy: rr(0.5, 3), vz: Math.sin(a) * sp,
        life: rr(0.5, 1.0), s0: rr(0.4, 0.7) * s, s1: 0, cell: CELL.SPARKLE, rot: R() * 6, spin: rr(-3, 3), drag: 1.5, grav: 1,
        r0: c[0] * 3, g0: c[1] * 3, b0: c[2] * 3, a0: 1, a1: 0,
      });
    }
  }

  _sparks(p, s, o) {
    const n = this._n(o.count ?? 16);
    const nrm = o.normal ?? { x: 0, y: 1, z: 0 };
    const c = o.color ? (Array.isArray(o.color) ? o.color : col(o.color)) : [4, 2.8, 1.0];
    for (let i = 0; i < n; i++) {
      const sp = rr(3, 10) * s;
      this.add.add({
        x: p.x, y: p.y, z: p.z,
        vx: nrm.x * sp * 0.7 + (R() - 0.5) * sp * 0.9, vy: nrm.y * sp * 0.7 + rr(0.5, sp * 0.6), vz: nrm.z * sp * 0.7 + (R() - 0.5) * sp * 0.9,
        life: rr(0.22, 0.5), s0: rr(0.05, 0.1), s1: 0.02, cell: CELL.STREAK, mode: 1, stretch: rr(4, 7), grav: 13, drag: 0.7,
        r0: c[0], g0: c[1], b0: c[2], a0: 1, r1: c[0] * 0.3, g1: c[1] * 0.3, b1: c[2] * 0.3, a1: 0,
      });
    }
    this.add.add({ x: p.x, y: p.y, z: p.z, life: 0.09, s0: 0.5 * s, s1: 0.9 * s, cell: CELL.GLOW, r0: c[0] * 0.9, g0: c[1] * 0.9, b0: c[2] * 0.9, a0: 0.8, a1: 0 });
  }

  _dustBurst(p, s, o) {
    const c = o.color ? (Array.isArray(o.color) ? o.color : col(o.color)) : DUST[this.game.track?.theme] ?? DUST.meadow;
    const n = this._n(o.count ?? 10);
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283, sp = rr(1.2, 4) * s;
      this.alpha.add({
        x: p.x + Math.cos(a) * 0.3, y: p.y + 0.1, z: p.z + Math.sin(a) * 0.3, vx: Math.cos(a) * sp, vy: rr(0.4, 2) * s, vz: Math.sin(a) * sp,
        life: rr(0.6, 1.1), s0: rr(0.35, 0.55) * s, s1: rr(1.3, 2.2) * s, cell: R() < 0.5 ? CELL.SMOKE : CELL.SMOKE2, rot: R() * 6, spin: rr(-1, 1), drag: 2.2,
        r0: c[0], g0: c[1], b0: c[2], a0: 0.55, r1: c[0] * 0.85, g1: c[1] * 0.85, b1: c[2] * 0.85, a1: 0,
      });
    }
  }

  _splash(p, s) {
    const n = this._n(26);
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283, sp = rr(0.5, 3.2) * s;
      this.alpha.add({
        x: p.x, y: p.y + 0.05, z: p.z, vx: Math.cos(a) * sp, vy: rr(4.5, 10) * Math.sqrt(s), vz: Math.sin(a) * sp,
        life: rr(0.8, 1.3), s0: rr(0.14, 0.28) * s, s1: rr(0.1, 0.2) * s, cell: CELL.DROPLET, grav: 20, drag: 0.1,
        r0: 0.85, g0: 0.95, b0: 1, a0: 0.95, r1: 0.7, g1: 0.85, b1: 1, a1: 0.7,
      });
    }
    for (let i = 0; i < this._n(8); i++) {
      const a = R() * 6.283, sp = rr(0.6, 2.2) * s;
      this.alpha.add({
        x: p.x, y: p.y + 0.2, z: p.z, vx: Math.cos(a) * sp, vy: rr(1.5, 3.5), vz: Math.sin(a) * sp,
        life: rr(0.7, 1.2), s0: 0.5 * s, s1: rr(1.8, 2.8) * s, cell: CELL.SMOKE, rot: R() * 6, drag: 1.6, r0: 0.9, g0: 0.97, b0: 1, a0: 0.4, a1: 0,
      });
    }
    this.alpha.add({ x: p.x, y: p.y + 0.04, z: p.z, life: 0.75, s0: 0.6 * s, s1: 5.5 * s, cell: CELL.RING, mode: 2, r0: 0.95, g0: 1, b0: 1, a0: 0.85, a1: 0 });
    this.add.add({ x: p.x, y: p.y + 0.04, z: p.z, life: 0.4, s0: 0.5 * s, s1: 3.5 * s, cell: CELL.RING, mode: 2, r0: 1.2, g0: 1.6, b0: 2, a0: 0.5, a1: 0 });
  }

  _confetti(p, s, o) {
    const n = this._n(o.count ?? 130);
    for (let i = 0; i < n; i++) {
      const c = hue(R(), 0.95, 0.58);
      const a = R() * 6.283, sp = rr(2, 8) * s, up = rr(6, 13) * s;
      this.alpha.add({
        x: p.x + (R() - 0.5) * 2, y: p.y, z: p.z + (R() - 0.5) * 2, vx: Math.cos(a) * sp, vy: up, vz: Math.sin(a) * sp,
        life: rr(2.4, 4.2), s0: rr(0.2, 0.34), s1: rr(0.2, 0.34), cell: CELL.CONFETTI, mode: 3, rot: R() * 6.28, spin: rr(6, 14), grav: 7, drag: 1.5,
        r0: c[0] * 1.15, g0: c[1] * 1.15, b0: c[2] * 1.15, a0: 1, a1: 1,
      });
    }
  }

  _smokeBurst(p, s, o) {
    const c = o.color ? (Array.isArray(o.color) ? o.color : col(o.color)) : [0.6, 0.6, 0.62];
    for (let i = 0; i < this._n(o.count ?? 8); i++) {
      const a = R() * 6.283, sp = rr(0.3, 1.6) * s;
      this.alpha.add({
        x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp, vy: rr(0.8, 2.4) * s, vz: Math.sin(a) * sp,
        life: rr(1, 1.8), s0: rr(0.4, 0.7) * s, s1: rr(1.6, 2.6) * s, cell: R() < 0.5 ? CELL.SMOKE : CELL.SMOKE2, rot: R() * 6, spin: rr(-0.5, 0.5), drag: 1.3,
        r0: c[0], g0: c[1], b0: c[2], a0: 0.5, r1: c[0] * 0.85, g1: c[1] * 0.85, b1: c[2] * 0.85, a1: 0,
      });
    }
  }

  _ring(p, s, o) {
    const c = o.color ? (Array.isArray(o.color) ? o.color : col(o.color)) : [2.2, 2.2, 2.6];
    const size = (o.size ?? 3.5) * s;
    (o.flat ? this.add : this.ov).add({ x: p.x, y: p.y + (o.flat ? 0.06 : 0), z: p.z, life: o.life ?? 0.4, s0: size * 0.15, s1: size, cell: CELL.RING, mode: o.flat ? 2 : 0, r0: c[0], g0: c[1], b0: c[2], a0: 0.9, a1: 0 });
  }

  _stars(p, s, o) {
    const cols = [[3.4, 2.8, 0.5], [3.4, 3.2, 2.6], [3.2, 1.4, 2.4]];
    for (let i = 0; i < this._n(o.count ?? 10); i++) {
      const a = R() * 6.283, sp = rr(1.5, 4.5) * s;
      const c = cols[i % 3];
      this.add.add({
        x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * sp, vy: rr(1.5, 5) * s, vz: Math.sin(a) * sp,
        life: rr(0.7, 1.2), s0: rr(0.4, 0.66) * s, s1: 0.08, cell: CELL.STAR, rot: R() * 6, spin: rr(-6, 6), drag: 1.8, grav: 4,
        r0: c[0], g0: c[1], b0: c[2], a0: 1, a1: 0,
      });
    }
  }

  _lightning(p, o) {
    const g = this.game;
    const owner = o.owner ?? null;
    const targets = o.targets ?? g.karts.filter((k) => k !== owner);
    const pfx = g.postfx;
    for (const k of targets) {
      const top = k.model ? k.model.getAnchor('top', _c) : _c.copy(k.position).setY(k.position.y + 1.6);
      const hit = _b.copy(top);
      const from = _a.set(hit.x + (R() - 0.5) * 7, hit.y + 42, hit.z + (R() - 0.5) * 7);
      this.lightning.strike(from, hit, { life: rr(0.45, 0.6), width: 0.34 });
      this._hitFlashAt(hit);
    }
    this.flashLight(p, 0xb8c8ff, 900, 6);
    if (pfx?.flash) pfx.flash(0.7, 0xd6e2ff, 0.3);
  }

  _hitFlashAt(p) {
    this.ov.add({ x: p.x, y: p.y, z: p.z, life: 0.25, s0: 1.5, s1: 4.5, cell: CELL.BURST, r0: 3.5, g0: 3.8, b0: 5, a0: 1, a1: 0, rot: R() * 6 });
    this._sparks(p, 0.9, { count: 14, color: [2.4, 3, 4.6] });
  }

  /** Pooled point-light flash. */
  flashLight(pos, color, intensity, distScale = 3) {
    this.light.position.set(pos.x, pos.y + 1.2, pos.z);
    this.light.color.set(color);
    this.light.distance = 14 * distScale;
    if (intensity > this.lightI) this.lightI = intensity;
    this.light.intensity = this.lightI;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // event wiring
  // ---------------------------------------------------------------------------------------------------------------
  _bind() {
    const ev = this.events;
    const on = (name, fn) => ev.on(name, (e) => this.active && fn(e));
    const at = (k, name, out) => (k.model ? k.model.getAnchor(name, out) : out.copy(k.position));
    this._offs = [
      on(EVT.KART_BOOST, ({ kart: k, source, duration }) => {
        if (!k.model) return;
        const st = this._st(k);
        if (source === 'miniturbo') st.mtLevel = st.mtLevel || st.maxLevel || 1;
        const L = DRIFT[st.mtLevel] ?? [2, 2, 2.4];
        for (const a of ['exhaustL', 'exhaustR']) {
          at(k, a, _a);
          const nn = source === 'rocketstart' ? 14 : 8;
          for (let i = 0; i < nn; i++) this._flame(_a, k, st);
          if (source === 'miniturbo') this.add.add({ x: _a.x, y: _a.y, z: _a.z, life: 0.25, s0: 1.2, s1: 2.2, cell: CELL.GLOW, r0: L[0] * 3, g0: L[1] * 3, b0: L[2] * 3, a0: 1, a1: 0 });
        }
        at(k, 'back', _b);
        const rc = source === 'miniturbo' ? L : source === 'pad' || source === 'draft' ? [0.4, 1.8, 2.4] : source === 'goldnitro' ? [2.6, 2, 0.5] : source === 'star' ? [2, 1.6, 2.2] : [2.6, 1.4, 0.5];
        this.ov.add({ x: _b.x, y: _b.y, z: _b.z, life: 0.36, s0: 0.4, s1: 2.7, cell: CELL.RING, r0: rc[0] * 1.35, g0: rc[1] * 1.35, b0: rc[2] * 1.35, a0: 0.7, a1: 0 });
        this.add.add({ x: k.position.x, y: k.position.y + 0.06, z: k.position.z, life: 0.34, s0: 1.0, s1: 4.0, cell: CELL.RING, mode: 2, r0: rc[0] * 1.1, g0: rc[1] * 1.1, b0: rc[2] * 1.1, a0: 0.6, a1: 0 });
        if (source === 'rocketstart' || source === 'nitro') this._smokeBurst(_b, 0.8, { count: 6 });
      }),
      on(EVT.KART_DRIFT_END, ({ kart: k, level }) => {
        if (level > 0) this._st(k).mtLevel = level; // level 0 = cancelled, no boost follows
      }),
      on(EVT.KART_DRIFT_LEVEL, ({ kart: k, level }) => {
        if (!k.model) return;
        const L = DRIFT[level] ?? WHITE;
        for (const w of ['wheelRL', 'wheelRR']) {
          at(k, w, _a);
          this.add.add({ x: _a.x, y: _a.y + 0.15, z: _a.z, life: 0.18, s0: 0.8, s1: 1.9, cell: CELL.GLOW, r0: L[0] * 4, g0: L[1] * 4, b0: L[2] * 4, a0: 1, a1: 0 });
          this.add.add({ x: _a.x, y: _a.y + 0.15, z: _a.z, life: 0.26, s0: 0.3, s1: 1.7, cell: CELL.RING, r0: L[0] * 3, g0: L[1] * 3, b0: L[2] * 3, a0: 0.9, a1: 0 });
          for (let i = 0; i < this._n(14); i++) this._spark(_a, k, L, 4.2, w === 'wheelRL' ? 1 : -1);
        }
      }),
      on(EVT.KART_LAND, ({ kart: k, impact }) => {
        if (!k.model || impact <= 6) return;
        const n = clamp(Math.round(impact * 0.5), 3, 9);
        for (const w of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR']) {
          at(k, w, _a);
          this._dustBurst(_a, clamp(impact / 12, 0.6, 1.4), { count: n, color: this.game.track?.theme === 'neon' ? [0.4, 0.5, 0.6] : undefined });
        }
      }),
      on(EVT.KART_WALL, ({ kart: k, impact, point }) => {
        if (!point || impact < 3) return;
        const v = k.velocity;
        const nrm = v ? { x: -v.x * 0.05, y: 0.6, z: -v.z * 0.05 } : { x: 0, y: 1, z: 0 };
        this._sparks(point, clamp(impact / 12, 0.5, 1.3), { count: clamp(Math.round(impact * 1.6), 8, 30), normal: nrm });
        if (impact > 9) this._dustBurst(point, 0.7, { count: 4 });
      }),
      on(EVT.KART_HIT, ({ kart: k, type }) => {
        if (!k.model) return;
        at(k, 'head', _a);
        this._hit(_a, type === 'explode' ? 1.6 : 1.1, {});
        const g = this.game;
        if (k.isPlayer && g.postfx?.hitPulse) g.postfx.hitPulse(type === 'explode' ? 1 : 0.7, k);
        if (type === 'explode') {
          const recent = this.ps.time - this._lastExplode.t < 0.4 && this._lastExplode.p.distanceToSquared(k.position) < 100;
          if (!recent) this._explosion(_b.copy(k.position), 0.7, {});
        } else if (type === 'squish') {
          this._dustBurst(k.position, 1.3, { count: 10 });
          this._ring(_b.set(k.position.x, k.position.y, k.position.z), 1, { flat: true, size: 4, life: 0.4 });
        } else if (type === 'tumble') this._dustBurst(k.position, 1, { count: 7 });
      }),
      on(EVT.KART_BUMP, ({ point, impulse }) => {
        if (!point || (impulse ?? 0) < 3) return;
        this._sparks(point, clamp(impulse / 22, 0.5, 1.3), { count: clamp(Math.round(impulse * 0.7), 6, 26), color: [3, 3, 3.4] });
        this._smokeBurst(point, 0.4, { count: 2 });
      }),
      on(EVT.KART_TRICK, ({ kart: k }) => {
        if (!k.model) return;
        at(k, 'center', _a);
        for (let i = 0; i < 16; i++) this._sparkle(k);
        this._ring(_a, 1, { size: 4.5, life: 0.5, color: [2.2, 2.6, 3] });
      }),
      on(EVT.KART_STAR, ({ kart: k, active }) => {
        if (!active || !k.model) return;
        at(k, 'center', _a);
        for (let i = 0; i < 24; i++) this._sparkle(k);
        this._ring(_a, 1, { size: 3.4, life: 0.45, color: [1.5, 1.4, 0.6] });
      }),
      on(EVT.KART_SHRINK, ({ kart: k }) => {
        if (!k.model) return;
        at(k, 'center', _a);
        this._smokeBurst(_a, 0.7, { count: 6, color: [0.9, 0.9, 1] });
        this._ring(_a, 1, { size: 3.5, life: 0.4, color: [1.6, 2, 3] });
      }),
      on(EVT.KART_RESPAWN, ({ kart: k }) => {
        if (!k.model) return;
        at(k, 'center', _a);
        for (let i = 0; i < 18; i++) this._sparkle(k);
        this._ring(_a, 1, { size: 5, life: 0.55, color: [1.4, 2.6, 3.2] });
        this.ov.add({ x: _a.x, y: _a.y, z: _a.z, life: 0.4, s0: 2, s1: 4.5, cell: CELL.GLOW, r0: 1.6, g0: 2.6, b0: 3.4, a0: 0.8, a1: 0 });
      }),
      on(EVT.KART_STALL, ({ kart: k }) => {
        if (!k.model) return;
        for (const w of ['wheelRL', 'wheelRR']) {
          at(k, w, _a);
          for (let i = 0; i < 8; i++) this._smoke(_a, k, 0.5, 1.7);
        }
      }),
      on(EVT.KART_HOP, ({ kart: k }) => {
        if (!k.model) return;
        for (const w of ['wheelRL', 'wheelRR']) {
          at(k, w, _a);
          this._dustBurst(_a, 0.5, { count: 2 });
        }
      }),
      on(EVT.ITEM_BOX_HIT, ({ position }) => position && this._boxBreak(position, 1)),
      on(EVT.ITEM_EXPLODE, ({ position, radius }) => position && this._explosion(position, clamp((radius ?? 4) / 4.5, 0.6, 2.2), {})),
      on(EVT.ITEM_HIT, ({ position, item }) => {
        if (!position || item === 'bomb') return;
        this._hit(position, 0.9, {});
      }),
      on(EVT.ITEM_LIGHTNING, ({ owner }) => this._lightning(owner?.position ?? this._humans()[0]?.position ?? _a.set(0, 0, 0), { owner })),
      on(EVT.KART_FALL, ({ kart: k }) => {
        const wl = this.game.track?.waterLevel;
        if (wl == null) return;
        if (k.position.y - wl < 4) this._splash(_a.set(k.position.x, wl, k.position.z), 1.2);
      }),
      on(EVT.RACE_FINISH, ({ kart: k }) => {
        if (!k.isPlayer && k !== this.game.player) return;
        this._fins = this._fins.filter((f) => f.kart !== k);
        this._fins.push({ kart: k, t: 4.5, acc: 0 });
        this.game.postfx?.flash?.(0.22, 0xfff2c8, 0.3, k);
      }),
    ];
  }
}
