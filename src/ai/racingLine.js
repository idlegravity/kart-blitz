/**
 * racingLine.js — a per-track racing line for the CPU drivers (computed once, cached on `track._aiLine`).
 * OWNER: Gameplay agent.
 *
 * The line is stored as lateral offsets from the centreline every ~2 m:
 *   1. every sample gets a usable lateral range (asphalt half width minus a margin; bigger margins next to
 *      open 'void' edges, tighter next to walls),
 *   2. a multigrid elastic-band relaxation finds the shortest path through that corridor (cuts apexes,
 *      swings wide on entry/exit),
 *   3. the kinks of that polygon are smoothed away and the line is pulled back from the edges a little,
 *   4. ramps are taken straight and centred, boost pads are favoured.
 * Everything is derived through the public Track API only (getFrameAt / query / boostPads / ramps).
 */
import * as THREE from 'three';
import { clamp, smoothstep, wrapAngle } from '../core/math.js';

const DS = 2.0; // target sample spacing (m)

export class RacingLine {
  /** @param {object} track a built Track */
  constructor(track) {
    const L = track.length;
    // N must be divisible by 16 so the multigrid strides divide it
    const N = Math.max(32, Math.round(L / DS / 16) * 16);
    this.N = N;
    this.L = L;
    this.ds = L / N;
    const F = (n) => new Float32Array(n);
    this.cx = F(N); this.cy = F(N); this.cz = F(N); //   centreline position
    this.rx = F(N); this.rz = F(N); //                   unit right (xz)
    this.tx = F(N); this.tz = F(N); //                   unit tangent (xz)
    this.hw = F(N); //                                   asphalt half width
    this.minLat = F(N); this.maxLat = F(N); //           usable lateral range
    this.lat = F(N); //                                  the line (lateral offset)
    this.curv = F(N); //                                 signed curvature of the line, + = right (1/m)
    this.yaw = F(N); //                                  heading along the line
    this.edgeRisk = new Uint8Array(N); //                bit0 left void edge, bit1 right void edge
    this.surf = new Uint8Array(N); //                    0 road, 1 ice, 2 boost, 3 ramp
    this.corners = [];
    this.cornerIdx = new Int16Array(N); //              index (into corners) of the next corner ending after i, or -1
    this._build(track);
  }

  // ------------------------------------------------------------------------------------ build
  _build(track) {
    this._sampleFrames(track);
    this._relax();
    this._smoothAndScale();
    this._applyFeatures(track);
    this._finalize(track);
  }

  _sampleFrames(track) {
    const { N, ds } = this;
    const f = {};
    const q = new THREE.Vector3();
    const qs = {};
    let hint = -1;
    const probe = (i, side, hw) => {
      // is the ground beyond this edge missing?
      const lat = side * (hw + 1.6);
      q.set(this.cx[i] + this.rx[i] * lat, this.cy[i], this.cz[i] + this.rz[i] * lat);
      let s;
      try {
        s = track.query(q, hint, qs);
      } catch {
        return false;
      }
      if (!s) return false;
      hint = s.index ?? -1;
      return s.surface === 'void' || (Number.isFinite(s.height) && s.height < this.cy[i] - 2.5);
    };
    for (let i = 0; i < N; i++) {
      track.getFrameAt(i * ds, f);
      this.cx[i] = f.position.x; this.cy[i] = f.position.y; this.cz[i] = f.position.z;
      let rx = f.right.x, rz = f.right.z;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      this.rx[i] = rx; this.rz[i] = rz;
      let tx = f.tangent.x, tz = f.tangent.z;
      const tl = Math.hypot(tx, tz) || 1;
      this.tx[i] = tx / tl; this.tz[i] = tz / tl;
      const hw = Number.isFinite(f.halfWidth) ? f.halfWidth : 8;
      this.hw[i] = hw;
      let mL = 1.8, mR = 1.8;
      const wl = f.wallLeft, wr = f.wallRight;
      let risk = 0;
      if (wl == null && probe(i, -1, hw)) { mL = 4.4; risk |= 1; }
      else if (wl == null) mL = 2.2;
      if (wr == null && probe(i, +1, hw)) { mR = 4.4; risk |= 2; }
      else if (wr == null) mR = 2.2;
      let lo = -(hw - mL), hi = hw - mR;
      if (wl != null) lo = Math.max(lo, wl + 3.2);
      if (wr != null) hi = Math.min(hi, wr - 3.2);
      if (lo > hi) lo = hi = (lo + hi) / 2;
      this.minLat[i] = lo;
      this.maxLat[i] = hi;
      this.edgeRisk[i] = risk;
    }
  }

  /** Multigrid SOR relaxation of the elastic band (shortest path inside the corridor). */
  _relax() {
    const { N, cx, cz, rx, rz, minLat, maxLat, lat } = this;
    const strides = [16, 8, 4, 2, 1];
    const iters = [420, 260, 160, 100, 60];
    const W = 1.75;
    for (let si = 0; si < strides.length; si++) {
      const st = strides[si];
      for (let it = 0; it < iters[si]; it++) {
        for (let i = 0; i < N; i += st) {
          const a = (i - st + N) % N, b = (i + st) % N;
          const mx = 0.5 * (cx[a] + rx[a] * lat[a] + cx[b] + rx[b] * lat[b]);
          const mz = 0.5 * (cz[a] + rz[a] * lat[a] + cz[b] + rz[b] * lat[b]);
          const target = (mx - cx[i]) * rx[i] + (mz - cz[i]) * rz[i];
          const l = lat[i] + W * (clamp(target, minLat[i], maxLat[i]) - lat[i]);
          lat[i] = clamp(l, minLat[i], maxLat[i]);
        }
      }
      if (st > 1) {
        // linear interpolation to the finer grid
        for (let i = 0; i < N; i += st) {
          const b = (i + st) % N;
          for (let j = 1; j < st; j++) lat[i + j] = lat[i] + (lat[b] - lat[i]) * (j / st);
        }
      }
    }
  }

  _smoothAndScale() {
    const { N, lat, minLat, maxLat } = this;
    const tmp = new Float32Array(N);
    // de-kink: repeated 1-2-1 smoothing (spreads ~±14 m)
    for (let pass = 0; pass < 14; pass++) {
      for (let i = 0; i < N; i++) tmp[i] = 0.25 * lat[(i - 1 + N) % N] + 0.5 * lat[i] + 0.25 * lat[(i + 1) % N];
      lat.set(tmp);
    }
    // shortest paths hug the inside a bit too much for a kart that has to actually steer it
    for (let i = 0; i < N; i++) lat[i] = clamp(lat[i] * 0.9, minLat[i], maxLat[i]);
  }

  _applyFeatures(track) {
    const { N, L, ds, lat, minLat, maxLat, surf } = this;
    const wrapD = (a, b) => {
      let d = (b - a) % L;
      if (d > L / 2) d -= L;
      if (d < -L / 2) d += L;
      return d;
    };
    const pull = (s0, s1, latTarget, weight, lead, tail) => {
      // pull the line toward latTarget over [s0 - lead, s1 + tail] (full weight inside [s0, s1])
      const i0 = Math.floor((s0 - lead) / ds), i1 = Math.ceil((s1 + tail) / ds);
      for (let i = i0; i <= i1; i++) {
        const idx = ((i % N) + N) % N;
        const s = i * ds;
        let w = 1;
        if (s < s0) w = smoothstep(s0 - lead, s0, s);
        else if (s > s1) w = 1 - smoothstep(s1, s1 + tail, s);
        w *= weight;
        const t = clamp(latTarget, minLat[idx], maxLat[idx]);
        lat[idx] = lat[idx] + (t - lat[idx]) * w;
      }
    };
    // boost pads: favour them when they are within reach
    for (const p of track.boostPads ?? []) {
      const s0 = p.s, s1 = p.s + (p.length ?? 12);
      const mid = wrapD(0, s0);
      const idx = ((Math.round(((mid + L) % L) / ds) % N) + N) % N;
      const reach = 6.5 + (p.width ?? 8) * 0.5;
      if (Math.abs((p.lateral ?? 0) - lat[idx]) < reach) pull(mid, mid + (s1 - s0), p.lateral ?? 0, 0.9, 22, 2);
      for (let s = s0; s <= s1; s += ds) surf[((Math.round(s / ds) % N) + N) % N] = 2;
    }
    // static round obstacles standing on / next to the asphalt: keep the line clear of them
    const cols = track.colliders;
    if (cols && cols.length) {
      const q = new THREE.Vector3();
      const qs = {};
      for (const c of cols) {
        if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
        // two-step lookup: a rough s from a flat query, then again at the centreline height there
        let smp = track.query(q.set(c.x, 0, c.z), -1, qs);
        if (!smp || !Number.isFinite(smp.s)) continue;
        q.set(c.x, this.cy[((Math.round(smp.s / ds) % N) + N) % N], c.z);
        smp = track.query(q, -1, qs);
        if (!smp || !Number.isFinite(smp.s)) continue;
        const r = (c.radius ?? 1) + 2.8;
        if (Math.abs(smp.lateral) > (smp.halfWidth ?? 10) + r) continue;
        const idx = ((Math.round(smp.s / ds) % N) + N) % N;
        const here = lat[idx];
        if (Math.abs(here - smp.lateral) >= r) continue; // already clear
        let side = here >= smp.lateral ? 1 : -1;
        let want = smp.lateral + side * r;
        if (want > this.maxLat[idx] || want < this.minLat[idx]) {
          side = -side;
          want = smp.lateral + side * r;
        }
        pull(smp.s - 6, smp.s + 6, want, 1, 18, 10);
      }
    }
    // ramps: straight and centred on the ramp
    for (const r of track.ramps ?? []) {
      const s0 = r.s, s1 = r.s + (r.length ?? 10);
      const mid = wrapD(0, s0);
      pull(mid - 6, mid + (s1 - s0) + 4, r.lateral ?? 0, 1, 24, 16);
      for (let s = s0 - 2; s <= s1 + 2; s += ds) surf[((Math.round(s / ds) % N) + N) % N] = 3;
    }
  }

  _finalize(track) {
    const { N, ds, cx, cz, rx, rz, lat, yaw, curv } = this;
    const px = new Float32Array(N), pz = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      px[i] = cx[i] + rx[i] * lat[i];
      pz[i] = cz[i] + rz[i] * lat[i];
    }
    this.px = px;
    this.pz = pz;
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      yaw[i] = Math.atan2(px[b] - px[a], pz[b] - pz[a]);
    }
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      raw[i] = -wrapAngle(yaw[b] - yaw[a]) / (2 * ds); // + = right (yaw decreases when turning right)
    }
    for (let i = 0; i < N; i++) {
      let sum = 0, wsum = 0;
      for (let j = -3; j <= 3; j++) {
        const w = 4 - Math.abs(j);
        sum += raw[(i + j + N) % N] * w;
        wsum += w;
      }
      curv[i] = sum / wsum;
    }
    // ice patches along the line
    const q = new THREE.Vector3();
    const qs = {};
    let hint = -1;
    for (let i = 0; i < N; i += 2) {
      q.set(px[i], this.cy[i] + 0.5, pz[i]);
      try {
        const s = track.query(q, hint, qs);
        hint = s?.index ?? -1;
        if (s?.surface === 'ice') this.surf[i] = this.surf[i + 1 < N ? i + 1 : i] = 1;
      } catch {
        /* ignore */
      }
    }
    this._findCorners();
  }

  /** Contiguous same-sign stretches of noticeable curvature ("corners"). */
  _findCorners() {
    const { N, ds, curv } = this;
    const TH = 0.0065; // 1/m (R ~ 155 m)
    // start scanning at the straightest spot so a corner is never split across the array seam
    let origin = 0, best = Infinity;
    for (let i = 0; i < N; i++) {
      const a = Math.abs(curv[i]);
      if (a < best) { best = a; origin = i; }
    }
    const corners = [];
    let cur = null;
    let gapN = 0;
    const flush = () => {
      if (cur) {
        const count = cur.e - cur.s + 1;
        const len = count * ds;
        if (len >= 14 && cur.angle >= 0.35) {
          corners.push({ i0: (origin + cur.s) % N, i1: (origin + cur.e) % N, count, dir: cur.dir, angle: cur.angle, len, kmax: cur.kmax, mean: cur.angle / len });
        }
      }
      cur = null;
      gapN = 0;
    };
    for (let n = 0; n < N; n++) {
      const k = curv[(origin + n) % N];
      const a = Math.abs(k);
      const sg = k > TH ? 1 : k < -TH ? -1 : 0;
      if (!cur) {
        if (sg !== 0) cur = { s: n, e: n, dir: sg, angle: a * ds, kmax: a };
        gapN = 0;
      } else if (sg === cur.dir) {
        cur.angle += a * ds;
        cur.kmax = Math.max(cur.kmax, a);
        cur.e = n;
        gapN = 0;
      } else if (sg === 0) {
        cur.angle += a * ds;
        gapN++;
        if (gapN * ds > 14) flush();
      } else {
        flush();
        cur = { s: n, e: n, dir: sg, angle: a * ds, kmax: a };
      }
    }
    flush();
    corners.sort((p, q) => p.i0 - q.i0);
    this.corners = corners;
    for (let i = 0; i < N; i++) {
      let bestC = -1, bestD = Infinity;
      for (let c = 0; c < corners.length; c++) {
        const cn = corners[c];
        const inside = (i - cn.i0 + N) % N < cn.count;
        const d = inside ? 0 : (cn.i0 - i + N) % N;
        if (d < bestD) { bestD = d; bestC = c; }
      }
      this.cornerIdx[i] = bestC;
    }
  }

  // ------------------------------------------------------------------------------------ queries
  /** Fill `out` with the line data at track distance s (linear interpolation between samples). */
  at(s, out) {
    const { N, ds } = this;
    let f = s / ds;
    f = ((f % N) + N) % N;
    const i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    const mix = (a) => a[i] + (a[j] - a[i]) * t;
    out.i = i;
    out.cx = mix(this.cx);
    out.cz = mix(this.cz);
    out.rx = mix(this.rx);
    out.rz = mix(this.rz);
    const rl = Math.hypot(out.rx, out.rz) || 1;
    out.rx /= rl;
    out.rz /= rl;
    out.lat = mix(this.lat);
    out.minLat = mix(this.minLat);
    out.maxLat = mix(this.maxLat);
    out.curv = mix(this.curv);
    out.hw = mix(this.hw);
    out.tx = mix(this.tx);
    out.tz = mix(this.tz);
    out.surf = this.surf[i];
    out.risk = this.edgeRisk[i] | this.edgeRisk[j];
    return out;
  }

  /** Heading (yaw) of the line at distance s. */
  yawAt(s) {
    const { N, ds } = this;
    const f = (((s / ds) % N) + N) % N;
    const i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
    const a = this.yaw[i], b = this.yaw[j];
    return a + wrapAngle(b - a) * t;
  }

  /** Index of the sample nearest to distance s. */
  indexAt(s) {
    const { N, ds } = this;
    return ((Math.round(s / ds) % N) + N) % N;
  }
}

/** Get (or build once) the racing line of a track. */
export function getRacingLine(track) {
  if (!track) return null;
  if (!track._aiLine || track._aiLine.L !== track.length) track._aiLine = new RacingLine(track);
  return track._aiLine;
}
