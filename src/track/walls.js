/**
 * Wall / barrier meshes at the lateral wall coordinates stored on the centerline (cl.wallL / cl.wallR).
 * One merged mesh per style, built from runs of consecutive samples. OWNER: World agent.
 * Styles: fence (white rail fence), tire (stacked red/white tires), rail (neon glow rail + barrier),
 * snow (rounded snow bank), rock (jagged cliff face), hedge (low bushy hedge), barrier (concrete blocks).
 */
import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import { InstanceSet } from './scatter.js';
import { fbm, hash2 } from './noise.js';

/** ground height at lateral l on the road plane of sample i */
function groundAt(cl, i, l) {
  const k = ((i % cl.N) + cl.N) % cl.N;
  return cl.py[k] - l * cl.tanB[k];
}

/** Collect runs of samples that use the given style on a side. Returns [{ i0, i1 }] (i1 may wrap past N). */
function runs(cl, side, styleIdx) {
  const N = cl.N;
  const arr = side < 0 ? cl.wallStyleL : cl.wallStyleR;
  const res = [];
  let start = -1;
  // find a start index that is not inside a run to avoid wrap splitting
  let base = 0;
  for (let i = 0; i < N; i++) if (arr[i] !== styleIdx || cl.gap[i]) { base = i; break; }
  for (let q = 0; q <= N; q++) {
    const i = (base + q) % N;
    const on = q < N && arr[i] === styleIdx && !cl.gap[i];
    if (on && start < 0) start = q;
    if (!on && start >= 0) { res.push({ i0: base + start, i1: base + q - 1 }); start = -1; }
  }
  return res;
}

const at = (cl, i) => ((i % cl.N) + cl.N) % cl.N;

/** lateral wall coordinate at sample i (always defined inside runs) */
const wallLat = (cl, side, i) => (side < 0 ? cl.wallL[at(cl, i)] : cl.wallR[at(cl, i)]);

/** World position at sample i and lateral l */
function pos(cl, i, l, dy = 0) {
  const k = at(cl, i);
  return [cl.px[k] + cl.rx[k] * l, cl.py[k] - l * cl.tanB[k] + dy, cl.pz[k] + cl.rz[k] * l];
}

// ------------------------------------------------------------------------------------------------ fence
function fence(track, ctx, list, extra, palette = {}) {
  const cl = track.cl;
  const gb = new GeoBuilder();
  const post = rgb(palette.post ?? '#f2f2ee'), postTop = rgb(palette.top ?? '#ffffff'), rail = rgb(palette.rail ?? '#ffffff'), railShade = rgb(palette.shade ?? '#c9ced6');
  for (const { side, i0, i1 } of list) {
    let prev = null;
    let sinceSpost = 99;
    for (let i = i0; i <= i1; i++) {
      const l = wallLat(cl, side, i) + side * 0.18;
      const k = at(cl, i);
      const p = pos(cl, i, l);
      const rxn = side * cl.rx[k], rzn = side * cl.rz[k]; // outward normal (away from the road)
      if (sinceSpost >= 3.2) {
        gb.box(p[0], p[1] + 0.62, p[2], 0.17, 1.24, 0.17, post, Math.atan2(cl.hx[k], cl.hz[k]));
        gb.box(p[0], p[1] + 1.27, p[2], 0.24, 0.07, 0.24, postTop, Math.atan2(cl.hx[k], cl.hz[k]));
        sinceSpost = 0;
      }
      sinceSpost += cl.ds;
      // two rails as thin beams (front / back / top) between consecutive samples
      if (prev) {
        for (const [y0, y1, col] of [[0.34, 0.5, rail], [0.78, 0.94, rail]]) {
          const a = [prev.p[0], prev.p[1], prev.p[2]], b = p;
          const nF = [-prev.rxn, 0, -prev.rzn], nB = [prev.rxn, 0, prev.rzn];
          const off = 0.045;
          const fa0 = gb.v(a[0] - prev.rxn * off, a[1] + y0, a[2] - prev.rzn * off, ...nF, col, 0, 0);
          const fa1 = gb.v(a[0] - prev.rxn * off, a[1] + y1, a[2] - prev.rzn * off, ...nF, col, 0, 1);
          const fb1 = gb.v(b[0] - rxn * off, b[1] + y1, b[2] - rzn * off, ...nF, col, 1, 1);
          const fb0 = gb.v(b[0] - rxn * off, b[1] + y0, b[2] - rzn * off, ...nF, col, 1, 0);
          gb.quad(fa0, fb0, fb1, fa1);
          gb.quad(fa0, fa1, fb1, fb0);
          const ba0 = gb.v(a[0] + prev.rxn * off, a[1] + y0, a[2] + prev.rzn * off, ...nB, railShade, 0, 0);
          const ba1 = gb.v(a[0] + prev.rxn * off, a[1] + y1, a[2] + prev.rzn * off, ...nB, railShade, 0, 1);
          const bb1 = gb.v(b[0] + rxn * off, b[1] + y1, b[2] + rzn * off, ...nB, railShade, 1, 1);
          const bb0 = gb.v(b[0] + rxn * off, b[1] + y0, b[2] + rzn * off, ...nB, railShade, 1, 0);
          gb.quad(ba0, ba1, bb1, bb0);
          gb.quad(ba0, bb0, bb1, ba1);
          const ta = gb.v(a[0] - prev.rxn * off, a[1] + y1, a[2] - prev.rzn * off, 0, 1, 0, col, 0, 0);
          const tb = gb.v(a[0] + prev.rxn * off, a[1] + y1, a[2] + prev.rzn * off, 0, 1, 0, col, 1, 0);
          const tc = gb.v(b[0] + rxn * off, b[1] + y1, b[2] + rzn * off, 0, 1, 0, col, 1, 1);
          const td = gb.v(b[0] - rxn * off, b[1] + y1, b[2] - rzn * off, 0, 1, 0, col, 0, 1);
          gb.quad(ta, td, tc, tb);
          gb.quad(ta, tb, tc, td);
        }
      }
      prev = { p, rxn, rzn };
    }
  }
  if (gb.count) {
    track.addMesh(gb.build(), ctx.mats.vcolor({ roughness: palette.rough ?? 0.55, side: THREE.DoubleSide }), { cast: true, name: 'wall-fence' });
  }
}

// ------------------------------------------------------------------------------------------------ tire walls
function tires(track, ctx, list) {
  const cl = track.cl;
  const geo = new THREE.TorusGeometry(0.4, 0.16, 5, 10);
  geo.rotateX(Math.PI / 2);
  const mat = ctx.mats.vcolor({ roughness: 0.75, vertexColors: false, color: 0xffffff });
  const set = new InstanceSet(track, geo, mat, { cast: true, cull: 320, name: 'tires' });
  const cols = ['#d81818', '#f2f2f2'];
  let n = 0;
  for (const { side, i0, i1 } of list) {
    let acc = 0;
    for (let i = i0; i <= i1; i++) {
      acc += cl.ds;
      if (acc < 0.92) continue;
      acc = 0;
      const k = at(cl, i);
      const l = wallLat(cl, side, i) + side * 0.46;
      const p = pos(cl, i, l);
      const yaw = Math.atan2(cl.hx[k], cl.hz[k]);
      const col = cols[Math.floor(n / 3) % 2];
      set.add(p[0], p[1] + 0.2, p[2], yaw + (hash2(n, 3, 5) - 0.5) * 0.4, 1, 1, 1, col);
      set.add(p[0] + cl.rx[k] * side * 0.05, p[1] + 0.6, p[2] + cl.rz[k] * side * 0.05, yaw + 0.5 + hash2(n, 4, 5), 1, 1, 1, cols[Math.floor(n / 3 + 1) % 2]);
      if (n % 5 === 2) set.add(p[0], p[1] + 1.0, p[2], yaw + hash2(n, 6, 5), 1, 1, 1, col);
      n++;
    }
  }
  set.build();
}

// ------------------------------------------------------------------------------------------------ neon rail
function rail(track, ctx, list) {
  const cl = track.cl;
  const gbSolid = new GeoBuilder();
  const gbGlowA = new GeoBuilder(), gbGlowB = new GeoBuilder();
  const dark = rgb('#151327'), dark2 = rgb('#221d3d');
  for (const { side, i0, i1 } of list) {
    let prev = null;
    let postAcc = 99;
    for (let i = i0; i <= i1; i++) {
      const k = at(cl, i);
      const l = wallLat(cl, side, i) + side * 0.2;
      const p = pos(cl, i, l);
      const rxn = side * cl.rx[k], rzn = side * cl.rz[k];
      if (postAcc >= 5) {
        gbSolid.box(p[0], p[1] + 0.6, p[2], 0.3, 1.2, 0.3, dark2, Math.atan2(cl.hx[k], cl.hz[k]));
        postAcc = 0;
      }
      postAcc += cl.ds;
      if (prev) {
        // low concrete barrier (front / top / back)
        const a = prev.p, b = p;
        const hgt = 0.62, wOff = 0.32;
        const nF = [-prev.rxn, 0, -prev.rzn];
        const q = (px, py, pz, n, c) => gbSolid.v(px, py, pz, n[0], n[1], n[2], c, 0, 0);
        const f0 = q(a[0] - prev.rxn * wOff, a[1], a[2] - prev.rzn * wOff, nF, dark);
        const f1 = q(a[0] - prev.rxn * wOff * 0.7, a[1] + hgt, a[2] - prev.rzn * wOff * 0.7, nF, dark2);
        const g1 = q(b[0] - rxn * wOff * 0.7, b[1] + hgt, b[2] - rzn * wOff * 0.7, nF, dark2);
        const g0 = q(b[0] - rxn * wOff, b[1], b[2] - rzn * wOff, nF, dark);
        gbSolid.quad(f0, g0, g1, f1); gbSolid.quad(f0, f1, g1, g0);
        const t0 = q(a[0] - prev.rxn * wOff * 0.7, a[1] + hgt, a[2] - prev.rzn * wOff * 0.7, [0, 1, 0], dark2);
        const t1 = q(a[0] + prev.rxn * wOff * 0.7, a[1] + hgt, a[2] + prev.rzn * wOff * 0.7, [0, 1, 0], dark2);
        const t2 = q(b[0] + rxn * wOff * 0.7, b[1] + hgt, b[2] + rzn * wOff * 0.7, [0, 1, 0], dark2);
        const t3 = q(b[0] - rxn * wOff * 0.7, b[1] + hgt, b[2] - rzn * wOff * 0.7, [0, 1, 0], dark2);
        gbSolid.quad(t0, t3, t2, t1); gbSolid.quad(t0, t1, t2, t3);
        // glowing strips: one on the barrier face, one high rail
        const glow = (gb, y0, y1, off) => {
          const w = [-prev.rxn, 0, -prev.rzn];
          const v0 = gb.v(a[0] - prev.rxn * off, a[1] + y0, a[2] - prev.rzn * off, ...w, [1, 1, 1], 0, 0);
          const v1 = gb.v(a[0] - prev.rxn * off, a[1] + y1, a[2] - prev.rzn * off, ...w, [1, 1, 1], 0, 1);
          const v2 = gb.v(b[0] - rxn * off, b[1] + y1, b[2] - rzn * off, ...w, [1, 1, 1], 1, 1);
          const v3 = gb.v(b[0] - rxn * off, b[1] + y0, b[2] - rzn * off, ...w, [1, 1, 1], 1, 0);
          gb.quad(v0, v3, v2, v1); gb.quad(v0, v1, v2, v3);
        };
        glow(gbGlowA, 0.36, 0.5, wOff * 0.85 + 0.02);
        glow(gbGlowB, 1.05, 1.13, 0.3);
      }
      prev = { p, rxn, rzn };
    }
  }
  if (gbSolid.count) track.addMesh(gbSolid.build(), ctx.mats.vcolor({ roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }), { cast: true, name: 'wall-rail' });
  const c1 = track.def.railColors?.[0] ?? '#22e6ff', c2 = track.def.railColors?.[1] ?? '#ff2ee6';
  if (gbGlowA.count) track.addMesh(gbGlowA.build(), ctx.mats.emissive(c1, 3.2, { params: { side: THREE.DoubleSide } }), { receive: false, name: 'rail-glowA' });
  if (gbGlowB.count) track.addMesh(gbGlowB.build(), ctx.mats.emissive(c2, 3.2, { params: { side: THREE.DoubleSide } }), { receive: false, name: 'rail-glowB' });
}

// ------------------------------------------------------------------------------------------------ snow bank
function snow(track, ctx, list) {
  const cl = track.cl;
  const gb = new GeoBuilder();
  const white = rgb('#f4f9ff'), shade = rgb('#b9cfe8');
  const seed = track.def.seed ?? 3;
  for (const { side, i0, i1 } of list) {
    let prev = null;
    for (let i = i0; i <= i1; i++) {
      const k = at(cl, i);
      const s = i * cl.ds;
      const lat0 = wallLat(cl, side, i);
      const bump = 0.85 + 0.35 * fbm(s * 0.08, side * 3.1, 3, seed);
      const height = 1.7 * bump + 0.15 * fbm(s * 0.5, 0, 2, seed + 2);
      // cross-section: inner foot, inner shoulder, crown, outer shoulder, outer foot
      const prof = [[0, 0], [-0.15, height * 0.55], [0.55, height], [1.5, height * 0.62], [3.0, 0]];
      const row = prof.map(([o, h]) => {
        const l = lat0 + side * o;
        const p = pos(cl, i, l, 0);
        return { p: [p[0], p[1] + h - (o === 0 ? 0.05 : 0), p[2]], h, o };
      });
      const tints = [[0.70, 0.83, 1.0], [0.86, 0.93, 1.0], [1.0, 1.0, 1.0], [0.93, 0.97, 1.0], [0.84, 0.91, 1.0]];
      const ids = row.map((r, j) => {
        const tn = tints[j];
        const c = [white[0] * tn[0], white[1] * tn[1], white[2] * tn[2]];
        return gb.v(r.p[0], r.p[1], r.p[2], 0, 1, 0, c, j / 4, s * 0.1);
      });
      if (prev) {
        for (let j = 0; j < ids.length - 1; j++) {
          if (side > 0) gb.quad(prev[j], prev[j + 1], ids[j + 1], ids[j]);
          else gb.quad(prev[j + 1], prev[j], ids[j], ids[j + 1]);
        }
      }
      prev = ids;
    }
  }
  if (gb.count) {
    const g = gb.build(true);
    track.addMesh(g, ctx.mats.vcolor({ roughness: 0.9, side: THREE.DoubleSide }), { cast: false, name: 'wall-snow' });
  }
  // striped delineator poles on top of the banks (readable in white-out conditions)
  const pg = new GeoBuilder();
  const blue = rgb('#2f7be0'), cream = rgb('#f4f8ff'), tip = rgb('#ff6a1a');
  for (const { side, i0, i1 } of list) {
    let acc = 99;
    for (let i = i0; i <= i1; i++) {
      acc += cl.ds;
      if (acc < 11) continue;
      acc = 0;
      const k = at(cl, i);
      const p = pos(cl, i, wallLat(cl, side, i) + side * 0.35);
      const base = p[1] + 0.9;
      pg.box(p[0], base + 0.5, p[2], 0.12, 1.0, 0.12, blue, Math.atan2(cl.hx[k], cl.hz[k]));
      pg.box(p[0], base + 1.15, p[2], 0.13, 0.32, 0.13, cream, Math.atan2(cl.hx[k], cl.hz[k]));
      pg.box(p[0], base + 1.42, p[2], 0.14, 0.22, 0.14, tip, Math.atan2(cl.hx[k], cl.hz[k]));
    }
  }
  if (pg.count) track.addMesh(pg.build(), ctx.mats.vcolor({ roughness: 0.6 }), { cast: true, name: 'snow-poles' });
}

// ------------------------------------------------------------------------------------------------ concrete/jersey barrier
function barrier(track, ctx, list) {
  const cl = track.cl;
  const gb = new GeoBuilder();
  const a = rgb(track.def.barrierColors?.[0] ?? '#d9d4c8'), b = rgb(track.def.barrierColors?.[1] ?? '#b0342a');
  let n = 0;
  for (const { side, i0, i1 } of list) {
    let acc = 99;
    for (let i = i0; i <= i1; i++) {
      acc += cl.ds;
      if (acc < 3.0) continue;
      acc = 0;
      const k = at(cl, i);
      const l = wallLat(cl, side, i) + side * 0.4;
      const p = pos(cl, i, l);
      gb.box(p[0], p[1] + 0.5, p[2], 0.8, 1.0, 2.9, n % 4 === 0 ? b : a, Math.atan2(cl.hx[k], cl.hz[k]));
      n++;
    }
  }
  if (gb.count) track.addMesh(gb.build(), ctx.mats.vcolor({ roughness: 0.85 }), { cast: true, name: 'wall-barrier' });
}

const woodfence = (t, c, l, e) => fence(t, c, l, e, { post: '#7a4a26', top: '#5a3318', rail: '#9a6a3a', shade: '#6a4526', rough: 0.85 });
const STYLES = { fence, woodfence, tire: tires, rail, snow, barrier, rock: () => {}, cave: () => {} };

/** Build every wall style used by the def. `custom` lets a world override/add styles (e.g. rock). */
export function buildWalls(track, ctx, custom = {}) {
  const cl = track.cl;
  cl.wallStyles.forEach((name, idx) => {
    if (idx === 0 || !name) return;
    const list = [];
    for (const side of [-1, 1]) for (const r of runs(cl, side, idx)) list.push({ side, ...r });
    if (!list.length) return;
    const fn = custom[name] ?? STYLES[name];
    if (fn) fn(track, ctx, list, { runs, pos, at, wallLat, groundAt });
    else console.warn(`[Track] unknown wall style "${name}"`);
  });
}

export { runs, pos, at, wallLat, groundAt };
