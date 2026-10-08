/**
 * TestTrack — a self-contained implementation of the Track query contract (ARCHITECTURE.md §6.1) used by the
 * Driving agent's Node simulations (dev/driving/sim.mjs) and the browser sandbox (dev/driving/sandbox.html).
 *
 * A stadium loop (two straights + two right-hand 180° turns) with test features along it:
 * boost pad, ramp + jump gap, ice patch, smooth hill, sharp crest, open (rail-less) edge with void, banking,
 * round colliders. It does not depend on any other agent's track code.
 */
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class TestTrack {
  /**
   * @param {object} [o]
   * @param {number} [o.straight] straight length (m)
   * @param {number} [o.radius] turn radius (m)
   * @param {number} [o.hw] asphalt half width (m)
   * @param {number} [o.wall] wall offset beyond the asphalt (m)
   * @param {boolean} [o.features] enable the test features
   */
  constructor(o = {}) {
    this.id = 'test';
    this.name = 'Test Stadium';
    this.laps = 3;
    this.startS = 0;
    this.killY = -30;
    this.waterLevel = null;
    this.sunDirection = new THREE.Vector3(0.4, 1, 0.3).normalize();
    this.group = new THREE.Group();
    this.hw = o.hw ?? 9;
    this.wallOff = o.wall ?? 5;
    this.Ls = o.straight ?? 600;
    this.R = o.radius ?? 60;
    this.features = o.features !== false;
    this.length = 2 * this.Ls + 2 * Math.PI * this.R;
    this.spacing = 1;
    this.count = Math.round(this.length / this.spacing);
    this.spacing = this.length / this.count;

    // ---- feature layout (s ranges) ----
    this.F = {
      pad: { s0: 120, s1: 134 },
      ramp: { s0: 200, len: 14, height: 1.6, launch: 11 },
      gap: { s0: 214, s1: 242 },
      ice: { s0: 300, s1: 370 },
      hill: { s0: 400, s1: 530, amp: 4 },
      // second straight starts at s = Ls + PI*R (~788 for the defaults)
      crest: { s0: 820, s1: 860, slope: 0.27 },
      openEdge: { s0: 900, s1: 960 },
      bank: { s0: 1000, s1: 1100, tan: 0.16 },
    };
    this.colliders = this.features
      ? [
          { x: -6.5, z: 60, radius: 1.6 },
          { x: 7.4, z: 100, radius: 1.6 },
        ]
      : [];
    this.boostPads = [{ s: this.F.pad.s0, lateral: 0, length: 14, width: 10 }];
    this.ramps = [{ s: this.F.ramp.s0, lateral: 0, length: this.F.ramp.len, width: 2 * this.hw, launch: this.F.ramp.launch }];

    // ---- centerline samples ----
    this.pos = [];
    this.tan = [];
    this.rgt = [];
    const tmp = { x: 0, z: 0, yaw: 0 };
    for (let i = 0; i < this.count; i++) {
      this._center(i * this.spacing, tmp);
      const y = this._centerHeight(i * this.spacing);
      this.pos.push(new THREE.Vector3(tmp.x, y, tmp.z));
      this.tan.push(new THREE.Vector3(Math.sin(tmp.yaw), 0, Math.cos(tmp.yaw)));
      this.rgt.push(new THREE.Vector3(-Math.cos(tmp.yaw), 0, Math.sin(tmp.yaw)));
    }
    this.startGrid = [];
    for (let k = 0; k < 8; k++) {
      // (the sandbox grid sits at the start of the first straight, not behind s = 0, so it always faces a straight)
      const f = this.getFrameAt(60 - Math.floor(k / 2) * 6 - (k % 2) * 3);
      const side = k % 2 === 0 ? -1 : 1;
      this.startGrid.push({ position: f.position.clone().addScaledVector(f.right, side * 3.2), yaw: Math.atan2(f.tangent.x, f.tangent.z) });
    }
    this.itemBoxSlots = [];
    this.minimap = { points: [], bounds: { minX: -130, maxX: 10, minZ: -10, maxZ: this.Ls + 10 } };
    this._fr = {};
  }

  // ------------------------------------------------------------------------------------ geometry
  _center(s, out) {
    const { Ls, R } = this;
    const Lc = Math.PI * R;
    s = ((s % this.length) + this.length) % this.length;
    if (s < Ls) {
      out.x = 0; out.z = s; out.yaw = 0;
    } else if (s < Ls + Lc) {
      const psi = -(s - Ls) / R;
      out.x = R * (Math.cos(psi) - 1);
      out.z = Ls - R * Math.sin(psi);
      out.yaw = psi;
    } else if (s < 2 * Ls + Lc) {
      out.x = -2 * R; out.z = Ls - (s - Ls - Lc); out.yaw = -Math.PI;
    } else {
      const psi = -Math.PI - (s - 2 * Ls - Lc) / R;
      out.x = -2 * R + R * (Math.cos(psi) + 1);
      out.z = -R * Math.sin(psi);
      out.yaw = psi;
    }
    return out;
  }

  /** Height of the centerline at s. */
  _centerHeight(s) {
    if (!this.features) return 0;
    const F = this.F;
    let h = 0;
    // ramp: linear incline to the lip, then a gap (void), then the landing at road level
    if (s >= F.ramp.s0 && s < F.ramp.s0 + F.ramp.len) h += F.ramp.height * ((s - F.ramp.s0) / F.ramp.len);
    // smooth hill
    if (s >= F.hill.s0 && s < F.hill.s1) h += F.hill.amp * Math.sin((Math.PI * (s - F.hill.s0)) / (F.hill.s1 - F.hill.s0));
    // sharp crest: up at `slope`, abrupt kink at the top, down at `slope`
    if (s >= F.crest.s0 && s < F.crest.s1) {
      const mid = 0.5 * (F.crest.s0 + F.crest.s1);
      const d = s < mid ? s - F.crest.s0 : F.crest.s1 - s;
      h += F.crest.slope * d;
    }
    return h;
  }

  _zone(s, lateral) {
    // returns surface name (+ launch) at (s, lateral)
    const F = this.F, hw = this.hw;
    const al = Math.abs(lateral);
    if (!this.features) return al <= hw ? 'road' : 'offroad';
    if (s >= F.gap.s0 && s < F.gap.s1) return 'void';
    if (s >= F.openEdge.s0 && s < F.openEdge.s1 && al > hw + 3) return 'void';
    if (al > hw) return 'offroad';
    if (s >= F.ramp.s0 && s < F.ramp.s0 + F.ramp.len) return 'ramp';
    if (s >= F.pad.s0 && s < F.pad.s1 && al < 5) return 'boost';
    if (s >= F.ice.s0 && s < F.ice.s1) return 'ice';
    return 'road';
  }

  _bankTan(s) {
    if (!this.features) return 0;
    const B = this.F.bank;
    if (s < B.s0 || s >= B.s1) return 0;
    const u = (s - B.s0) / (B.s1 - B.s0);
    return B.tan * Math.sin(Math.PI * Math.min(1, Math.max(0, u))); // banked into a right turn (right side lower)
  }

  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  deltaS(a, b) {
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  getFrameAt(s, out = {}) {
    s = this.wrapS(s);
    const f = s / this.spacing;
    const i = Math.floor(f) % this.count, j = (i + 1) % this.count, t = f - Math.floor(f);
    out.position = (out.position ?? new THREE.Vector3()).lerpVectors(this.pos[i], this.pos[j], t);
    out.tangent = (out.tangent ?? new THREE.Vector3()).lerpVectors(this.tan[i], this.tan[j], t).normalize();
    out.right = (out.right ?? new THREE.Vector3()).lerpVectors(this.rgt[i], this.rgt[j], t).normalize();
    out.up = (out.up ?? new THREE.Vector3()).copy(UP);
    out.halfWidth = this.hw;
    out.wallLeft = -(this.hw + this.wallOff);
    out.wallRight = this.hw + this.wallOff;
    out.bank = Math.atan(this._bankTan(s));
    out.s = s;
    return out;
  }

  curvatureAt(s) {
    const a = this.getFrameAt(s - 4).tangent.clone(), b = this.getFrameAt(s + 4).tangent;
    return Math.asin(Math.max(-1, Math.min(1, a.x * b.z - a.z * b.x))) / 8;
  }

  query(position, hint = -1, out = {}) {
    const n = this.count;
    let best = -1, bestD = Infinity;
    const scan = (i) => {
      const p = this.pos[i];
      const dx = position.x - p.x, dy = (position.y - p.y) * 1.5, dz = position.z - p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    };
    if (hint >= 0 && hint < n) for (let o = -40; o <= 40; o++) scan((hint + o + n) % n);
    else for (let i = 0; i < n; i++) scan(i);

    const p = this.pos[best], t = this.tan[best];
    const along = (position.x - p.x) * t.x + (position.z - p.z) * t.z;
    const s = this.wrapS(best * this.spacing + along);
    const fr = this.getFrameAt(s, this._fr);
    const dx = position.x - fr.position.x, dz = position.z - fr.position.z;
    const lateral = dx * fr.right.x + dz * fr.right.z;
    const surface = this._zone(s, lateral);
    const bt = this._bankTan(s);
    // banking: the right side is lower (positive lateral => lower) for a right-hand turn
    const bankDh = -lateral * bt;
    let height = this._centerHeight(s) + bankDh;
    if (surface === 'void') height = this.killY - 10;
    // normal from finite differences of height along s and lateral
    const e = 0.5;
    const hs = (this._centerHeight(s + e) - this._centerHeight(s - e)) / (2 * e);
    const hl = -bt;
    const nx = -hl * fr.right.x - hs * fr.tangent.x;
    const ny = 1;
    const nz = -hl * fr.right.z - hs * fr.tangent.z;
    const inv = 1 / Math.hypot(nx, ny, nz);
    out.index = best;
    out.s = s;
    out.lateral = lateral;
    out.halfWidth = this.hw;
    out.height = height;
    out.normal = (out.normal ?? new THREE.Vector3()).set(nx * inv, ny * inv, nz * inv);
    out.tangent = (out.tangent ?? new THREE.Vector3()).copy(fr.tangent);
    out.right = (out.right ?? new THREE.Vector3()).copy(fr.right);
    out.surface = surface;
    const openHere = this.features && s >= this.F.openEdge.s0 && s < this.F.openEdge.s1;
    out.wallLeft = openHere ? null : -(this.hw + this.wallOff);
    out.wallRight = openHere ? null : this.hw + this.wallOff;
    out.launch = surface === 'ramp' ? this.F.ramp.launch : 0;
    return out;
  }
}
