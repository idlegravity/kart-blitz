/**
 * Terrain: a spatial index over the centerline (RoadField) and a non-uniform heightfield grid that is
 * flattened to meet the road shoulders. The grid is the ONLY source of ground height outside the
 * ribbon, so Track.query() and the rendered mesh agree exactly (triangle-accurate interpolation).
 * OWNER: World agent.
 */
import * as THREE from 'three';
import { smooth, mix, clamp } from './noise.js';

/** Plan-view spatial hash of centerline samples + polyline projection. */
export class RoadField {
  constructor(cl, cell = 16) {
    this.cl = cl;
    this.cell = cell;
    const b = cl.bounds();
    this.minX = b.minX - 2;
    this.minZ = b.minZ - 2;
    this.W = Math.ceil((b.maxX - b.minX + 4) / cell) + 1;
    this.H = Math.ceil((b.maxZ - b.minZ + 4) / cell) + 1;
    const counts = new Int32Array(this.W * this.H + 1);
    const cellOf = new Int32Array(cl.N);
    for (let i = 0; i < cl.N; i++) {
      const cx = Math.floor((cl.px[i] - this.minX) / cell), cz = Math.floor((cl.pz[i] - this.minZ) / cell);
      cellOf[i] = cx + cz * this.W;
      counts[cellOf[i] + 1]++;
    }
    for (let i = 0; i < this.W * this.H; i++) counts[i + 1] += counts[i];
    this.start = counts;
    this.items = new Int32Array(cl.N);
    const fill = counts.slice(0, this.W * this.H);
    for (let i = 0; i < cl.N; i++) this.items[fill[cellOf[i]]++] = i;
    this.bounds = b;
  }

  /**
   * Nearest point on the centerline polyline in plan view within maxR.
   * out: { i0, u, s, d, l, fx, fz, y }.  Returns false when nothing within maxR.
   */
  project(x, z, maxR, out) {
    const cl = this.cl, cell = this.cell;
    const b = this.bounds;
    if (x < b.minX - maxR || x > b.maxX + maxR || z < b.minZ - maxR || z > b.maxZ + maxR) return false;
    const r = Math.ceil(maxR / cell);
    const cx = Math.floor((x - this.minX) / cell), cz = Math.floor((z - this.minZ) / cell);
    let best = -1, bd = maxR * maxR;
    const x0 = Math.max(0, cx - r), x1 = Math.min(this.W - 1, cx + r);
    const z0 = Math.max(0, cz - r), z1 = Math.min(this.H - 1, cz + r);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const c = gx + gz * this.W;
        for (let k = this.start[c]; k < this.start[c + 1]; k++) {
          const i = this.items[k];
          const dx = x - cl.px[i], dz = z - cl.pz[i];
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = i; }
        }
      }
    }
    if (best < 0) return false;
    return this._refine(x, z, best, out);
  }

  _refine(x, z, i, out) {
    const cl = this.cl, N = cl.N;
    let bestD = Infinity, a = i, u = 0, fx = 0, fz = 0;
    for (let q = 0; q < 2; q++) {
      const s0 = q === 0 ? (i - 1 + N) % N : i;
      const s1 = (s0 + 1) % N;
      const ex = cl.px[s1] - cl.px[s0], ez = cl.pz[s1] - cl.pz[s0];
      const e2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - cl.px[s0]) * ex + (z - cl.pz[s0]) * ez) / e2, 0, 1);
      const qx = cl.px[s0] + ex * t, qz = cl.pz[s0] + ez * t;
      const d = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d < bestD) { bestD = d; a = s0; u = t; fx = qx; fz = qz; }
    }
    const b = (a + 1) % N;
    let rx = cl.rx[a] + (cl.rx[b] - cl.rx[a]) * u, rz = cl.rz[a] + (cl.rz[b] - cl.rz[a]) * u;
    const rm = Math.hypot(rx, rz) || 1;
    rx /= rm; rz /= rm;
    out.i0 = a;
    out.u = u;
    out.s = ((a + u) * cl.ds) % cl.length;
    out.d = Math.sqrt(bestD);
    out.l = (x - fx) * rx + (z - fz) * rz;
    out.fx = fx;
    out.fz = fz;
    out.y = cl.py[a] + (cl.py[b] - cl.py[a]) * u;
    return true;
  }

  /** Interpolated per-sample scalar at a projection. */
  lerpAt(arr, p) {
    const b = (p.i0 + 1) % this.cl.N;
    return arr[p.i0] + (arr[b] - arr[p.i0]) * p.u;
  }
}

/** Build non-uniform grid axis: fine inside [min, max], geometric growth beyond, to +-limit. */
function buildAxis(min, max, cell, growth, limit, maxStep) {
  const inner = [];
  const n = Math.ceil((max - min) / cell);
  const c0 = (min + max) / 2 - (n * cell) / 2;
  for (let i = 0; i <= n; i++) inner.push(c0 + i * cell);
  const lo = [], hi = [];
  let step = cell, x = inner[0];
  while (x > -limit) { step = Math.min(step * growth, maxStep); x -= step; lo.push(x); }
  step = cell; x = inner[inner.length - 1];
  while (x < limit) { step = Math.min(step * growth, maxStep); x += step; hi.push(x); }
  return Float32Array.from([...lo.reverse(), ...inner, ...hi]);
}

const SINK = 0.35; // grid is sunk this far under the ribbon so nothing z-fights

export class Terrain {
  /**
   * @param {Centerline} cl
   * @param {RoadField} road
   * @param {object} opts { cell, natural: (x,z,ctx)=>h, follow: 0..1, maxR, gapDepth, def }
   */
  constructor(cl, road, opts) {
    this.cl = cl;
    this.road = road;
    this.opts = opts;
    const b = cl.bounds();
    const margin = opts.margin ?? 120;
    const cell = opts.cell ?? 3.5;
    const limit = opts.limit ?? 3600;
    this.xs = buildAxis(b.minX - margin, b.maxX + margin, cell, opts.growth ?? 1.14, limit, opts.maxStep ?? 220);
    this.zs = buildAxis(b.minZ - margin, b.maxZ + margin, cell, opts.growth ?? 1.14, limit, opts.maxStep ?? 220);
    this.nx = this.xs.length;
    this.nz = this.zs.length;
    this.h = new Float32Array(this.nx * this.nz);
    this.roadD = new Float32Array(this.nx * this.nz);
    this.m0 = new Float32Array(this.nx * this.nz);
    this.m1 = new Float32Array(this.nx * this.nz);
    this.dark = new Float32Array(this.nx * this.nz).fill(1);
    this._computeFollow();
    this._computeHeights();
  }

  /** Coarse "road-following" baseline: gaussian-weighted average of nearby road heights. */
  _computeFollow() {
    const cl = this.cl;
    const b = cl.bounds();
    const pad = 900, cs = 40;
    this.fMinX = b.minX - pad; this.fMinZ = b.minZ - pad;
    this.fW = Math.ceil((b.maxX - b.minX + pad * 2) / cs) + 1;
    this.fH = Math.ceil((b.maxZ - b.minZ + pad * 2) / cs) + 1;
    this.fCell = cs;
    this.follow = new Float32Array(this.fW * this.fH);
    const step = 6;
    const sigma = this.opts.followSigma ?? 260;
    const inv = 1 / (sigma * sigma);
    for (let gz = 0; gz < this.fH; gz++) {
      for (let gx = 0; gx < this.fW; gx++) {
        const x = this.fMinX + gx * cs, z = this.fMinZ + gz * cs;
        let sw = 0, sy = 0;
        for (let i = 0; i < cl.N; i += step) {
          const dx = x - cl.px[i], dz = z - cl.pz[i];
          const w = Math.exp(-(dx * dx + dz * dz) * inv);
          sw += w; sy += w * cl.py[i];
        }
        const base = this.opts.baseLevel ?? 0;
        this.follow[gx + gz * this.fW] = (sy + base * 0.03) / (sw + 0.03);
      }
    }
  }

  followAt(x, z) {
    const fx = (x - this.fMinX) / this.fCell, fz = (z - this.fMinZ) / this.fCell;
    const gx = clamp(Math.floor(fx), 0, this.fW - 2), gz = clamp(Math.floor(fz), 0, this.fH - 2);
    const tx = clamp(fx - gx, 0, 1), tz = clamp(fz - gz, 0, 1);
    const i = gx + gz * this.fW;
    const a = this.follow[i], bq = this.follow[i + 1], c = this.follow[i + this.fW], d = this.follow[i + this.fW + 1];
    return a + (bq - a) * tx + (c - a) * tz + (a - bq - c + d) * tx * tz;
  }

  _computeHeights() {
    const { cl, road, opts } = this;
    const maxR = opts.maxR ?? 150;
    const P = { i0: 0, u: 0, s: 0, d: 0, l: 0, fx: 0, fz: 0, y: 0 };
    const ctx = { x: 0, z: 0, d: Infinity, dFar: Infinity, s: 0, l: 0, refH: 0, e: 0, follow: 0, m0: 0, m1: 0, gap: 0, cl, terrain: this };
    // coarse polyline (every 6th sample) for a finite, continuous distance-to-road even beyond maxR
    const cpx = [], cpz = [];
    for (let i = 0; i < cl.N; i += 6) { cpx.push(cl.px[i]); cpz.push(cl.pz[i]); }
    const farDist = (x, z) => {
      let best = Infinity;
      for (let k = 0; k < cpx.length; k++) {
        const dx = x - cpx[k], dz = z - cpz[k];
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      return Math.sqrt(best);
    };
    const sigma = 4;
    for (let j = 0; j < this.nz; j++) {
      const z = this.zs[j];
      for (let i = 0; i < this.nx; i++) {
        const x = this.xs[i];
        const idx = i + j * this.nx;
        ctx.x = x; ctx.z = z; ctx.m0 = 0; ctx.m1 = 0;
        ctx.follow = this.followAt(x, z);
        const has = road.project(x, z, maxR, P);
        let H, e = 60;
        if (!has) {
          ctx.d = Infinity; ctx.dFar = farDist(x, z); ctx.e = 60; ctx.s = 0; ctx.l = 0; ctx.refH = ctx.follow; ctx.gap = 0;
          H = opts.natural(x, z, ctx);
        } else {
          const outer = P.l < 0 ? road.lerpAt(cl.outerL, P) : road.lerpAt(cl.outerR, P);
          const blendW = Math.max(6, road.lerpAt(cl.blend, P));
          e = Math.max(0, P.d - outer);
          const tanB = road.lerpAt(cl.tanB, P);
          const exact = P.y - clamp(P.l, -road.lerpAt(cl.outerL, P), outer) * tanB;
          let ref = exact;
          const gapZone = this._gapMask(P.s);
          if (e > 2) {
            // smooth reference: distance-weighted average of nearby frames (continuous over the medial axis)
            let sw = 0, sy = 0;
            const rad = P.d + 3 * sigma;
            const cell = road.cell, r = Math.ceil(rad / cell);
            const cx = Math.floor((x - road.minX) / cell), cz = Math.floor((z - road.minZ) / cell);
            for (let gz = Math.max(0, cz - r); gz <= Math.min(road.H - 1, cz + r); gz++) {
              for (let gx = Math.max(0, cx - r); gx <= Math.min(road.W - 1, cx + r); gx++) {
                const c = gx + gz * road.W;
                for (let k = road.start[c]; k < road.start[c + 1]; k++) {
                  const q = road.items[k];
                  const dx = x - cl.px[q], dz = z - cl.pz[q];
                  const dd = Math.sqrt(dx * dx + dz * dz);
                  if (dd > P.d + 3 * sigma) continue;
                  const w = Math.exp(-(((dd - P.d) / sigma) ** 2));
                  const lq = dx * cl.rx[q] + dz * cl.rz[q];
                  const oq = lq < 0 ? cl.outerL[q] : cl.outerR[q];
                  sw += w;
                  sy += w * (cl.py[q] - clamp(lq, -cl.outerL[q], oq) * cl.tanB[q]);
                }
              }
            }
            if (sw > 0) ref = mix(exact, sy / sw, smooth(2, 8, e));
          }
          ctx.d = P.d; ctx.dFar = P.d; ctx.e = e; ctx.s = P.s; ctx.l = P.l; ctx.refH = ref; ctx.gap = gapZone;
          const nat = opts.natural(x, z, ctx);
          const I = 1 - smooth(0, blendW, e);
          H = mix(nat, ref, I);
          if (gapZone > 0) {
            // chasm: a slot as wide as the ribbon (plus a little), sharp along s
            const latMask = 1 - smooth(outer + 1.5, outer + 5.5, P.d);
            const m = gapZone * latMask;
            H = mix(H, ref - (opts.gapDepth ?? 46), m);
            this.dark[idx] = 1 - 0.8 * m;
          }
          // sink under the ribbon (never inside gaps, where there is no ribbon)
          if (!gapZone) H -= SINK * (1 - smooth(outer - 4, outer, P.d));
        }
        this.h[idx] = H;
        this.roadD[idx] = e;
        this.m0[idx] = ctx.m0;
        this.m1[idx] = ctx.m1;
      }
    }
  }

  /** 0..1 weight for being inside (or right at the ends of) a jump gap. */
  _gapMask(s) {
    const cl = this.cl, L = cl.length;
    let m = 0;
    for (const g of cl.gaps) {
      const a = ((s - g.s0) % L + L) % L; // distance past the gap start
      const len = ((g.s1 - g.s0) % L + L) % L;
      if (a <= len) m = Math.max(m, smooth(0, 0.9, a) * (1 - smooth(len - 0.9, len, a)));
    }
    return m;
  }

  /** Exact triangle-interpolated height (matches the mesh). */
  heightAt(x, z) {
    const { xs, zs, nx, nz, h } = this;
    let i = this._find(xs, nx, x), j = this._find(zs, nz, z);
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    const fx = clamp((x - x0) / (x1 - x0), 0, 1), fz = clamp((z - z0) / (z1 - z0), 0, 1);
    const h00 = h[i + j * nx], h10 = h[i + 1 + j * nx], h01 = h[i + (j + 1) * nx], h11 = h[i + 1 + (j + 1) * nx];
    // diagonal from (i+1,j) to (i,j+1): triangle A when fx + fz <= 1
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Height + face normal (written to out.normal Vector3). */
  sample(x, z, out) {
    const { xs, zs, nx, nz, h } = this;
    const i = this._find(xs, nx, x), j = this._find(zs, nz, z);
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const fx = clamp((x - x0) / dx, 0, 1), fz = clamp((z - z0) / dz, 0, 1);
    const h00 = h[i + j * nx], h10 = h[i + 1 + j * nx], h01 = h[i + (j + 1) * nx], h11 = h[i + 1 + (j + 1) * nx];
    let y, gx, gz;
    if (fx + fz <= 1) {
      y = h00 + (h10 - h00) * fx + (h01 - h00) * fz;
      gx = (h10 - h00) / dx; gz = (h01 - h00) / dz;
    } else {
      y = h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
      gx = (h11 - h01) / dx; gz = (h11 - h10) / dz;
    }
    if (out?.normal) {
      const m = Math.hypot(gx, 1, gz);
      out.normal.set(-gx / m, 1 / m, -gz / m);
    }
    return y;
  }

  /** Theme mask 0 (e.g. ice) at the nearest grid vertex. */
  maskAt(x, z) {
    const i = this._find(this.xs, this.nx, x), j = this._find(this.zs, this.nz, z);
    const fx = (x - this.xs[i]) / (this.xs[i + 1] - this.xs[i]), fz = (z - this.zs[j]) / (this.zs[j + 1] - this.zs[j]);
    const a = this.m0[i + j * this.nx], b = this.m0[i + 1 + j * this.nx], c = this.m0[i + (j + 1) * this.nx], d = this.m0[i + 1 + (j + 1) * this.nx];
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  }

  _find(axis, n, v) {
    if (v <= axis[0]) return 0;
    if (v >= axis[n - 1]) return n - 2;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (axis[mid] <= v) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Build the render geometry (positions, normals, vertex AO color, aRoadD, aM0, aM1). */
  buildGeometry() {
    const { xs, zs, nx, nz, h } = this;
    const count = nx * nz;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const rd = new Float32Array(count);
    const m0 = new Float32Array(count), m1 = new Float32Array(count);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = i + j * nx;
        pos[k * 3] = xs[i]; pos[k * 3 + 1] = h[k]; pos[k * 3 + 2] = zs[j];
        const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1), jl = Math.max(0, j - 1), jr = Math.min(nz - 1, j + 1);
        const gx = (h[ir + j * nx] - h[il + j * nx]) / (xs[ir] - xs[il]);
        const gz = (h[i + jr * nx] - h[i + jl * nx]) / (zs[jr] - zs[jl]);
        const m = Math.hypot(gx, 1, gz);
        nor[k * 3] = -gx / m; nor[k * 3 + 1] = 1 / m; nor[k * 3 + 2] = -gz / m;
        const avg = (h[il + j * nx] + h[ir + j * nx] + h[i + jl * nx] + h[i + jr * nx]) * 0.25;
        const cur = clamp(h[k] - avg, -3, 3);
        const ao = clamp(1 + cur * 0.05, 0.82, 1.06) * this.dark[k];
        col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao;
        rd[k] = Math.min(this.roadD[k], 80);
        m0[k] = this.m0[k]; m1[k] = this.m1[k];
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = i + j * nx, b = i + 1 + j * nx, c = i + (j + 1) * nx, d = i + 1 + (j + 1) * nx;
        idx[q++] = a; idx[q++] = c; idx[q++] = b; // A: (i,j) (i,j+1) (i+1,j)
        idx[q++] = b; idx[q++] = c; idx[q++] = d; // B: (i+1,j) (i,j+1) (i+1,j+1)
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aRoadD', new THREE.BufferAttribute(rd, 1));
    g.setAttribute('aM0', new THREE.BufferAttribute(m0, 1));
    g.setAttribute('aM1', new THREE.BufferAttribute(m1, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
