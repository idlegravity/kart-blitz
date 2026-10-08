/**
 * Centerline builder: closed centripetal Catmull-Rom through the def's control points, re-sampled
 * evenly (~1 m) by arc length, with per-sample frames, half-width, bank, curvature, wall / shoulder
 * extents and curb flags. Pure math (no meshes) so `getTrackOutline()` stays cheap.
 * OWNER: World agent.
 *
 * Conventions (ARCHITECTURE.md §3): Y up; right = normalize(cross(tangent, UP)) = (-tz, 0, tx)/|.|;
 * lateral > 0 = right of the centerline; bank > 0 = the RIGHT side is lower (inside of a right-hand bend);
 * curvature > 0 = bends right. Surface height at horizontal lateral offset l: py - l * tan(bank).
 */
import * as THREE from 'three';

const TAU = Math.PI * 2;

/** Uniform Catmull-Rom of a closed scalar list. */
function crScalar(vals, t) {
  const n = vals.length;
  const p = t * n;
  const i1 = Math.floor(p);
  const w = p - i1;
  const p0 = vals[(((i1 - 1) % n) + n) % n], p1 = vals[((i1 % n) + n) % n];
  const p2 = vals[(i1 + 1) % n], p3 = vals[(i1 + 2) % n];
  return 0.5 * (2 * p1 + (-p0 + p2) * w + (2 * p0 - 5 * p1 + 4 * p2 - p3) * w * w + (-p0 + 3 * p1 - 3 * p2 + p3) * w * w * w);
}

/** true when s lies in [s0, s1] (wrapping when s0 > s1). */
export function inRange(s, s0, s1, L) {
  s = ((s % L) + L) % L;
  s0 = ((s0 % L) + L) % L;
  s1 = ((s1 % L) + L) % L;
  return s0 <= s1 ? s >= s0 && s <= s1 : s >= s0 || s <= s1;
}

/** Signed circular distance from a to b in (-L/2, L/2]. */
export function circDelta(a, b, L) {
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  if (d < -L / 2) d += L;
  return d;
}

export class Centerline {
  /**
   * @param {object} def track definition (see defs/*.js)
   * @param {object} [opts] { spacing }
   */
  constructor(def, opts = {}) {
    this.def = def;
    const spacing = opts.spacing ?? 1.0;
    const raw = def.points;
    const pts = raw.map((p) => new THREE.Vector3(p[0], p[1] ?? 0, p[2]));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 6000;
    const L0 = curve.getLength();
    const N = Math.max(64, Math.round(L0 / spacing));
    this.N = N;
    this.length = L0;
    this.ds = L0 / N;
    const hwList = raw.map((p) => p[3] ?? def.halfWidth ?? 10);
    const bankList = raw.map((p) => ((p[4] ?? 0) * Math.PI) / 180);

    const f32 = () => new Float32Array(N);
    this.px = f32(); this.py = f32(); this.pz = f32();
    this.tx = f32(); this.ty = f32(); this.tz = f32();
    this.hx = f32(); this.hz = f32(); // horizontal unit tangent
    this.rx = f32(); this.rz = f32(); // horizontal unit right
    this.hw = f32(); this.bank = f32(); this.tanB = f32(); this.curv = f32();
    this.nx = f32(); this.ny = f32(); this.nz = f32(); // plane normal at the centerline
    this.wallL = f32().fill(NaN); this.wallR = f32().fill(NaN); // lateral coordinate of wall faces (L negative)
    this.outerL = f32(); this.outerR = f32(); // shoulder (flat band) extents, positive distances
    this.blend = f32().fill(def.blend ?? 40); // terrain blend width beyond the flat band
    this.curbL = f32(); this.curbR = f32(); // curb amplitude 0..1
    this.gap = new Uint8Array(N);
    this.wallStyleL = new Uint8Array(N); this.wallStyleR = new Uint8Array(N); // index into this.wallStyles (0 = none)
    this.wallStyles = [null];

    // ---- positions, half-width, bank ----
    const tv = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const t = curve.getUtoTmapping(i / N);
      curve.getPoint(t, tv);
      this.px[i] = tv.x; this.py[i] = tv.y; this.pz[i] = tv.z;
      this.hw[i] = Math.max(6, crScalar(hwList, t));
      this.bank[i] = crScalar(bankList, t);
    }
    // ---- tangents / frames ----
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = this.px[b] - this.px[a], dy = this.py[b] - this.py[a], dz = this.pz[b] - this.pz[a];
      const m = Math.hypot(dx, dy, dz) || 1;
      dx /= m; dy /= m; dz /= m;
      this.tx[i] = dx; this.ty[i] = dy; this.tz[i] = dz;
      const hm = Math.hypot(dx, dz) || 1;
      this.hx[i] = dx / hm; this.hz[i] = dz / hm;
      this.rx[i] = -dz / hm; this.rz[i] = dx / hm;
    }
    // ---- curvature (+ = bends right) ----
    const yaw = new Float32Array(N);
    for (let i = 0; i < N; i++) yaw[i] = Math.atan2(this.hx[i], this.hz[i]);
    for (let i = 0; i < N; i++) {
      let d = yaw[(i + 1) % N] - yaw[i];
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      this.curv[i] = -d / this.ds;
    }
    this._blur(this.curv, 6, 2);
    // ---- bank: explicit control-point banks (lightly smoothed) or automatic from curvature ----
    if (def.autoBank) {
      const ab = def.autoBank;
      const kc = Float32Array.from(this.curv);
      this._blur(kc, ab.blur ?? 14, 2);
      const maxB = ((ab.max ?? 11) * Math.PI) / 180;
      for (let i = 0; i < N; i++) {
        const v = ((kc[i] * (ab.scale ?? 560)) * Math.PI) / 180; // + = bank to the right (inside of a right-hand bend)
        this.bank[i] = v > maxB ? maxB : v < -maxB ? -maxB : v;
      }
    } else {
      this._blur(this.bank, 4, 2);
    }
    for (let i = 0; i < N; i++) this.tanB[i] = Math.tan(this.bank[i]);
    // ---- plane normals ----
    for (let i = 0; i < N; i++) this._planeNormal(i, i, 0);

    this._applyFeatures(def);
    this._computeCurbs(def);
  }

  _blur(arr, radius, passes) {
    const N = this.N;
    const tmp = new Float32Array(N);
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += arr[(i + k + N * 4) % N];
        tmp[i] = s / (radius * 2 + 1);
      }
      arr.set(tmp);
    }
  }

  _planeNormal(i, out, extraSlope) {
    // N = normalize(cross(C, T)), C = (rx, -tanB, rz)
    const cx = this.rx[i], cy = -this.tanB[i], cz = this.rz[i];
    const tx = this.tx[i], ty = this.ty[i] + extraSlope, tz = this.tz[i];
    let x = cy * tz - cz * ty, y = cz * tx - cx * tz, z = cx * ty - cy * tx;
    const m = Math.hypot(x, y, z) || 1;
    x /= m; y /= m; z /= m;
    if (y < 0) { x = -x; y = -y; z = -z; }
    if (typeof out === 'number') { this.nx[out] = x; this.ny[out] = y; this.nz[out] = z; }
    return [x, y, z];
  }

  /** Plane normal from an interpolated sample object (see sample()); optional extra vertical tangent slope (ramps). */
  _planeNormalFrom(c, extraSlope = 0) {
    const cx = c.rx, cy = -c.tanB, cz = c.rz;
    const tx = c.tx, ty = c.ty + extraSlope, tz = c.tz;
    let x = cy * tz - cz * ty, y = cz * tx - cx * tz, z = cx * ty - cy * tx;
    const m = Math.hypot(x, y, z) || 1;
    x /= m; y /= m; z /= m;
    if (y < 0) { x = -x; y = -y; z = -z; }
    return [x, y, z];
  }

  /** Index (fractional) for a distance along the lap. */
  fIndex(s) {
    const L = this.length;
    s = ((s % L) + L) % L;
    return s / this.ds;
  }

  /** Nearest sample index for distance s. */
  indexAt(s) {
    return Math.round(this.fIndex(s)) % this.N;
  }

  _applyFeatures(def) {
    const N = this.N, L = this.length, ds = this.ds;
    const shoulder = def.shoulder ?? 4;
    // ---- walls ----
    const needL = new Float32Array(N), needR = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      needL[i] = this.hw[i] + (def.openShoulderL ?? shoulder);
      needR[i] = this.hw[i] + (def.openShoulderR ?? shoulder);
    }
    const styleIndex = (name) => {
      let k = this.wallStyles.indexOf(name);
      if (k < 0) { this.wallStyles.push(name); k = this.wallStyles.length - 1; }
      return k;
    };
    for (const w of def.walls ?? []) {
      const off = w.offset ?? 4;
      const st = styleIndex(w.style ?? 'fence');
      for (let i = 0; i < N; i++) {
        const s = i * ds;
        if (!inRange(s, w.s0, w.s1, L)) continue;
        if (w.side !== 'right') {
          this.wallL[i] = -(this.hw[i] + off);
          this.wallStyleL[i] = st;
          needL[i] = this.hw[i] + off + (w.margin ?? 1.6);
        }
        if (w.side !== 'left') {
          this.wallR[i] = this.hw[i] + off;
          this.wallStyleR[i] = st;
          needR[i] = this.hw[i] + off + (w.margin ?? 1.6);
        }
      }
    }
    // ---- gaps ----
    this.gaps = [];
    for (const g of def.gaps ?? []) {
      const i0 = Math.round(g.s0 / ds) % N, i1 = Math.round(g.s1 / ds) % N;
      let i = i0;
      while (i !== i1) { this.gap[i] = 1; i = (i + 1) % N; }
      this.gaps.push({ i0, i1, s0: i0 * ds, s1: i1 * ds });
    }
    // ---- smooth ribbon extents so they never step, then enforce the required minimum ----
    const smoothMax = (need) => {
      const out = new Float32Array(N);
      const R = 14;
      for (let i = 0; i < N; i++) {
        let m = 0;
        for (let k = -R; k <= R; k++) {
          const v = need[(i + k + N * 4) % N];
          const fall = v - Math.abs(k) * 0.12; // slope limit: 0.12 m of extent per metre of s
          if (fall > m) m = fall;
        }
        out[i] = m;
      }
      return out;
    };
    const sl = smoothMax(needL), sr = smoothMax(needR);
    for (let i = 0; i < N; i++) {
      this.outerL[i] = Math.max(sl[i], needL[i]);
      this.outerR[i] = Math.max(sr[i], needR[i]);
    }
    for (const b of def.blendRanges ?? []) {
      for (let i = 0; i < N; i++) if (inRange(i * ds, b.s0, b.s1, L)) this.blend[i] = b.width;
    }
    this._blur(this.blend, 24, 2);
    this.features = {
      boost: (def.boost ?? []).map((b) => ({ ...b, lateral: b.lateral ?? 0, width: b.width ?? 8 })),
      ramps: (def.ramps ?? []).map((r) => ({ launch: 11, height: null, ...r, lateral: r.lateral ?? 0 })),
      surfaces: def.surfaces ?? [],
    };
    for (const r of this.features.ramps) {
      if (r.height == null) r.height = Math.min(2.4, 0.1 * r.length + 0.15 * (r.launch - 9));
      if (r.width == null) r.width = 2 * this.hw[this.indexAt(r.s)] - 0.2;
    }
  }

  _computeCurbs(def) {
    const N = this.N, ds = this.ds, L = this.length;
    const thr = def.curbCurvature ?? 1 / 200;
    const flag = (sign) => {
      const on = new Float32Array(N);
      for (let i = 0; i < N; i++) if (this.curv[i] * sign > thr) on[i] = 1;
      // close small holes, drop tiny runs, extend & fade
      const closeHoles = Math.round(28 / ds);
      let last = -1e9;
      for (let i = 0; i < N * 2; i++) {
        const k = i % N;
        if (on[k] > 0.5) {
          if (i - last <= closeHoles && i - last > 1) for (let j = last + 1; j < i; j++) on[j % N] = 1;
          last = i;
        }
      }
      // runs
      const amp = new Float32Array(N);
      let start = -1;
      const runs = [];
      // rotate to begin outside a run
      let base = 0;
      for (let i = 0; i < N; i++) if (on[i] < 0.5) { base = i; break; }
      for (let q = 0; q <= N; q++) {
        const i = (base + q) % N;
        const isOn = q < N && on[i] > 0.5;
        if (isOn && start < 0) start = q;
        if (!isOn && start >= 0) { runs.push([start, q - 1]); start = -1; }
      }
      const ext = Math.round(6 / ds), fade = Math.round(5 / ds), minLen = Math.round(18 / ds);
      for (const [a, b] of runs) {
        if (b - a < minLen) continue;
        for (let q = a - ext - fade; q <= b + ext + fade; q++) {
          const i = (((base + q) % N) + N) % N;
          let v = 1;
          if (q < a - ext) v = (q - (a - ext - fade)) / fade;
          else if (q > b + ext) v = ((b + ext + fade) - q) / fade;
          amp[i] = Math.max(amp[i], Math.max(0, Math.min(1, v)));
        }
      }
      return amp;
    };
    const R = flag(1), Lf = flag(-1);
    const banned = (i, side) => {
      const s = i * ds;
      if (this.gap[i]) return true;
      for (const g of this.gaps) if (inRange(s, g.s0 - 6, g.s1 + 6, L)) return true;
      for (const r of this.features.ramps) if (inRange(s, r.s - 4, r.s + r.length + 4, L)) return true;
      const wl = side < 0 ? this.wallL[i] : this.wallR[i];
      if (!Number.isNaN(wl) && Math.abs(wl) - this.hw[i] < 3.6) return true;
      return false;
    };
    for (let i = 0; i < N; i++) {
      this.curbR[i] = def.curbs === false || banned(i, 1) ? 0 : R[i];
      this.curbL[i] = def.curbs === false || banned(i, -1) ? 0 : Lf[i];
    }
  }

  /** Fractional-index frame lookup. Fills `o` with interpolated scalar/vec data. */
  sample(s, o = {}) {
    const N = this.N;
    const f = this.fIndex(s);
    const i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, u = f - Math.floor(f);
    const l = (a) => a[i0] + (a[i1] - a[i0]) * u;
    o.i0 = i0; o.i1 = i1; o.u = u;
    o.px = l(this.px); o.py = l(this.py); o.pz = l(this.pz);
    o.tx = l(this.tx); o.ty = l(this.ty); o.tz = l(this.tz);
    const tm = Math.hypot(o.tx, o.ty, o.tz) || 1;
    o.tx /= tm; o.ty /= tm; o.tz /= tm;
    o.rx = l(this.rx); o.rz = l(this.rz);
    const rm = Math.hypot(o.rx, o.rz) || 1;
    o.rx /= rm; o.rz /= rm;
    o.hw = l(this.hw);
    o.bank = l(this.bank);
    o.tanB = l(this.tanB);
    o.curv = l(this.curv);
    return o;
  }

  /** Height of the flat road plane at distance s and horizontal lateral offset l. */
  planeHeight(s, l) {
    const f = this.fIndex(s);
    const i0 = Math.floor(f) % this.N, i1 = (i0 + 1) % this.N, u = f - Math.floor(f);
    const py = this.py[i0] + (this.py[i1] - this.py[i0]) * u;
    const tb = this.tanB[i0] + (this.tanB[i1] - this.tanB[i0]) * u;
    return py - l * tb;
  }

  /** World position at (s, l) on the road plane (no ramps/curbs). */
  pointAt(s, l, out = new THREE.Vector3()) {
    const c = this.sample(s, this._tmp ?? (this._tmp = {}));
    return out.set(c.px + c.rx * l, c.py - l * c.tanB, c.pz + c.rz * l);
  }

  /** Runs of tight curvature: [{ s0, s1, dir (+1 right), minR }] for radius below maxR. */
  curveRuns(maxR = 120) {
    const runs = [];
    let run = null;
    const N = this.N;
    for (let i = 0; i < N; i++) {
      const k = this.curv[i];
      const R = Math.abs(k) > 1e-5 ? 1 / Math.abs(k) : 1e5;
      const on = R < maxR;
      if (on && !run) run = { s0: i * this.ds, dir: Math.sign(k), minR: R };
      if (on && run) run.minR = Math.min(run.minR, R);
      if (!on && run) { run.s1 = i * this.ds; runs.push(run); run = null; }
    }
    if (run) { run.s1 = this.length; runs.push(run); }
    return runs;
  }

  /** Cheap outline: [[x, z], ...] every `step` metres. */
  outline(step = 8) {
    const pts = [];
    const n = Math.max(24, Math.round(this.length / step));
    for (let k = 0; k < n; k++) {
      const i = Math.floor((k / n) * this.N);
      pts.push([this.px[i], this.pz[i]]);
    }
    return pts;
  }

  bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
      minY = Math.min(minY, this.py[i]); maxY = Math.max(maxY, this.py[i]);
    }
    return { minX, maxX, minZ, maxZ, minY, maxY };
  }
}
