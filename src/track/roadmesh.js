/**
 * Road geometry derived from the SAME centerline samples the query uses:
 * asphalt ribbon, shoulder ribbons, rumble-strip curbs, painted markings (edge lines, dashes, start
 * checker, grid boxes), boost pads, ramps, and deck skirts / gap end caps.
 * OWNER: World agent.
 *
 * Winding rule used everywhere: quad(low_i, high_i, high_next, low_next) is up-facing, where "low" is
 * the vertex with the smaller lateral coordinate and i → next runs along +s.
 */
import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import { canvasTexture, makeCanvas, makeStripeTexture } from './textures.js';

export const CURB_W = 1.7;
export const CURB_H = 0.075;
export const LINE_LIFT = 0.022;
export const PAD_LIFT = 0.034;

/** Height of the curb wedge at lateral distance e beyond the asphalt edge (0..CURB_W). */
export function curbHeight(e, amp) {
  return e <= 0 || e >= CURB_W ? 0 : CURB_H * amp * (1 - e / CURB_W);
}

function rampTexture() {
  const w = 256, h = 512;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#2a2d3a';
  g.fillRect(0, 0, w, h);
  const band = 34;
  for (let side = 0; side < 2; side++) {
    const x0 = side === 0 ? 0 : w - band;
    g.save();
    g.beginPath();
    g.rect(x0, 0, band, h);
    g.clip();
    g.fillStyle = '#ffc61a';
    g.fillRect(x0, 0, band, h);
    g.fillStyle = '#141414';
    for (let y = -band; y < h + band; y += 44) {
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + band, y - band);
      g.lineTo(x0 + band, y - band + 22);
      g.lineTo(x0, y + 22);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  g.fillStyle = '#ffd21f';
  for (let i = 0; i < 4; i++) {
    const y = 60 + i * 115;
    g.beginPath();
    g.moveTo(w * 0.5, y + 44);
    g.lineTo(w * 0.86, y - 20);
    g.lineTo(w * 0.86, y + 6);
    g.lineTo(w * 0.5, y + 70);
    g.lineTo(w * 0.14, y + 6);
    g.lineTo(w * 0.14, y - 20);
    g.closePath();
    g.globalAlpha = 0.25 + i * 0.22;
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#ffffff';
  g.fillRect(0, h - 14, w, 14);
  return canvasTexture(c, { aniso: 8 });
}

/**
 * Build all road meshes. Returns [{ name, geometry, material, cast, receive }].
 * @param {Centerline} cl
 * @param {MatLib} mats
 * @param {object} o options (see Track)
 */
export function buildRoad(cl, mats, o) {
  const N = cl.N, ds = cl.ds, L = cl.length;
  const out = [];
  const up = (k) => [cl.nx[k], cl.ny[k], cl.nz[k]];
  const pt = (i, l, dy = 0) => {
    const k = ((i % N) + N) % N;
    return [cl.px[k] + cl.rx[k] * l, cl.py[k] - l * cl.tanB[k] + dy, cl.pz[k] + cl.rz[k] * l];
  };
  const tmp = {};

  // ---------------------------------------------------------------- asphalt
  {
    const gb = new GeoBuilder();
    for (let i = 0; i <= N; i++) {
      const k = i % N, hw = cl.hw[k];
      const n = up(k);
      gb.v(...pt(i, -hw), ...n, null, -hw / 8, (i * ds) / 8);
      gb.v(...pt(i, hw), ...n, null, hw / 8, (i * ds) / 8);
    }
    for (let i = 0; i < N; i++) if (!cl.gap[i]) gb.quad(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    out.push({ name: 'asphalt', geometry: gb.build(), material: o.asphaltMat, cast: false, receive: true });
  }

  // ---------------------------------------------------------------- shoulder ribbons (terrain material)
  {
    const gb = new GeoBuilder({ aRoadD: 1, aM0: 1, aM1: 1 });
    for (let i = 0; i <= N; i++) {
      const k = i % N, hw = cl.hw[k];
      const n = up(k);
      const m0 = o.shoulderM0Fn ? o.shoulderM0Fn(i * ds) : (o.shoulderM0 ?? 0);
      gb.v(...pt(i, -cl.outerL[k]), ...n, null, 0, 0, { aRoadD: 0, aM0: m0 });
      gb.v(...pt(i, -hw), ...n, null, 0, 0, { aRoadD: -(cl.outerL[k] - hw), aM0: m0 });
      gb.v(...pt(i, hw), ...n, null, 0, 0, { aRoadD: -(cl.outerR[k] - hw), aM0: m0 });
      gb.v(...pt(i, cl.outerR[k]), ...n, null, 0, 0, { aRoadD: 0, aM0: m0 });
    }
    for (let i = 0; i < N; i++) {
      if (cl.gap[i]) continue;
      const a = i * 4, b = (i + 1) * 4;
      gb.quad(a, a + 1, b + 1, b); // left: (outer_i, inner_i, inner_next, outer_next)
      gb.quad(a + 2, a + 3, b + 3, b + 2); // right: (inner_i, outer_i, outer_next, inner_next)
    }
    out.push({ name: 'shoulder', geometry: gb.build(), material: o.shoulderMat, cast: false, receive: true });
  }

  // ---------------------------------------------------------------- curbs
  if (o.curbs !== false) {
    const gb = new GeoBuilder();
    const cRed = rgb(o.curbColors?.[0] ?? '#e01818'), cWhite = rgb(o.curbColors?.[1] ?? '#f4f4f4');
    const blockLen = 1.5, step = 0.5;
    for (const side of [-1, 1]) {
      const arr = side < 0 ? cl.curbL : cl.curbR;
      let s = 0;
      while (s < L) {
        const i = Math.floor(s / ds) % N;
        if (arr[i] < 0.01) { s += ds; continue; }
        const s0 = s;
        let e = s;
        while (e < L) {
          const j = Math.floor(e / ds) % N;
          if (arr[j] < 0.01) break;
          e += step;
        }
        let prev = null;
        for (let t = s0; t <= e + 1e-6; t += step) {
          const c = cl.sample(t, tmp);
          const idx = Math.floor(t / ds) % N;
          const amp = Math.min(1, Math.max(0, arr[idx] + (arr[(idx + 1) % N] - arr[idx]) * c.u));
          const hw = c.hw;
          const l0 = side * hw, l1 = side * (hw + CURB_W);
          const h = CURB_H * amp;
          const row = {
            t,
            inner0: [c.px + c.rx * l0, c.py - l0 * c.tanB, c.pz + c.rz * l0],
            innerTop: [c.px + c.rx * l0, c.py - l0 * c.tanB + h, c.pz + c.rz * l0],
            outer: [c.px + c.rx * l1, c.py - l1 * c.tanB, c.pz + c.rz * l1],
            n: cl._planeNormalFrom(c),
            faceN: [-side * c.rx, 0, -side * c.rz],
          };
          if (prev) {
            const segBlock = Math.floor(((prev.t + t) * 0.5) / blockLen);
            const cc = segBlock % 2 ? cWhite : cRed;
            const a = gb.v(...prev.innerTop, ...prev.n, cc, 0, 0);
            const b = gb.v(...prev.outer, ...prev.n, cc, 1, 0);
            const c2 = gb.v(...row.outer, ...row.n, cc, 1, 1);
            const d = gb.v(...row.innerTop, ...row.n, cc, 0, 1);
            if (side > 0) gb.quad(a, b, c2, d); else gb.quad(b, a, d, c2);
            const f0 = gb.v(...prev.inner0, ...prev.faceN, cc, 0, 0);
            const f1 = gb.v(...prev.innerTop, ...prev.faceN, cc, 0, 1);
            const f2 = gb.v(...row.innerTop, ...row.faceN, cc, 1, 1);
            const f3 = gb.v(...row.inner0, ...row.faceN, cc, 1, 0);
            if (side > 0) gb.quad(f0, f1, f2, f3); else gb.quad(f0, f3, f2, f1);
          }
          prev = row;
        }
        s = e + step;
      }
    }
    if (gb.count) out.push({ name: 'curbs', geometry: gb.build(), material: mats.vcolor({ roughness: 0.7 }), cast: false, receive: true });
  }

  // ---------------------------------------------------------------- markings (decals)
  {
    const white = rgb(o.lineColor ?? '#f2f2f2');
    const gbW = new GeoBuilder();
    const inGap = (s) => cl.gap[Math.floor(s / ds) % N] === 1;
    /**
     * Ribbon between lateral offsets l0..l1 from s0..s1. Offsets <= -900 mean "distance from the left edge"
     * (l = -hw + (l+1000)); offsets >= 900 mean "distance from the right edge" (l = hw - (1000-l)).
     */
    const resolve = (l, hw) => (l <= -900 ? -hw + (l + 1000) : l >= 900 ? hw - (1000 - l) : l);
    const lineStrip = (gb, l0, l1, col, s0, s1, stepS = 1.0, lift = LINE_LIFT) => {
      let prev = null;
      for (let s = s0; s <= s1 + 1e-6; s += stepS) {
        const sw = ((s % L) + L) % L;
        if (inGap(sw)) { prev = null; continue; }
        const c = cl.sample(sw, tmp);
        const ll0 = resolve(l0, c.hw), ll1 = resolve(l1, c.hw);
        const n = cl._planeNormalFrom(c);
        const a = gb.v(c.px + c.rx * ll0, c.py - ll0 * c.tanB + lift, c.pz + c.rz * ll0, ...n, col, 0, 0);
        const b = gb.v(c.px + c.rx * ll1, c.py - ll1 * c.tanB + lift, c.pz + c.rz * ll1, ...n, col, 1, 0);
        if (prev) gb.quad(prev[0], prev[1], b, a);
        prev = [a, b];
      }
    };
    if (o.edgeStyle !== 'neon') {
      lineStrip(gbW, -1000 + 0.55, -1000 + 0.95, white, 0, L, 1.0);
      lineStrip(gbW, 1000 - 0.95, 1000 - 0.55, white, 0, L, 1.0);
    }
    if (o.center && o.center !== 'none') {
      const dashC = rgb(o.centerColor ?? '#f4f4f4');
      if (o.center === 'double') {
        lineStrip(gbW, -0.42, -0.18, dashC, 0, L, 1.0);
        lineStrip(gbW, 0.18, 0.42, dashC, 0, L, 1.0);
      } else {
        const period = o.center === 'long' ? 14 : 8, dash = o.center === 'long' ? 6 : 3;
        for (let s0 = 0; s0 < L; s0 += period) lineStrip(gbW, -0.17, 0.17, dashC, s0, Math.min(L, s0 + dash), 1.0);
      }
    }
    // start / finish checker (two rows, straddling s = 0)
    {
      const black = rgb('#101010');
      const sq = 0.7;
      const c0 = cl.sample(0, tmp);
      const hw = c0.hw - 0.5;
      const cols = Math.round((hw * 2) / sq);
      const cw = (hw * 2) / cols;
      for (let r = 0; r < 2; r++) {
        for (let ci = 0; ci < cols; ci++) {
          const col = (r + ci) % 2 ? white : black;
          const l0 = -hw + ci * cw;
          lineStrip(gbW, l0, l0 + cw, col, (r - 1) * sq, r * sq, sq * 0.5, LINE_LIFT + 0.004);
        }
      }
    }
    // grid slot boxes behind the start line
    for (const slot of o.gridSlots ?? []) {
      const sFront = slot.s + 3.4, sBack = slot.s - 0.8;
      lineStrip(gbW, slot.lateral - 1.1, slot.lateral + 1.1, white, sFront - 0.16, sFront, 0.16, LINE_LIFT + 0.002);
      lineStrip(gbW, slot.lateral - 1.1, slot.lateral - 0.94, white, sBack + 1.6, sFront, 0.4, LINE_LIFT + 0.002);
      lineStrip(gbW, slot.lateral + 0.94, slot.lateral + 1.1, white, sBack + 1.6, sFront, 0.4, LINE_LIFT + 0.002);
    }
    if (o.turnArrows) {
      const arrowCol = rgb(o.arrowColor ?? '#ffd21f');
      for (const a of o.turnArrows) arrowsAt(gbW, cl, a.s, a.dir, arrowCol, tmp);
    }
    if (gbW.count) {
      out.push({
        name: 'markings', geometry: gbW.build(),
        material: mats.vcolor({ roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
        cast: false, receive: true,
      });
    }
    if (o.edgeStyle === 'neon') {
      const mk = (side, color) => {
        const gb = new GeoBuilder();
        if (side < 0) lineStrip(gb, -1000 + 0.5, -1000 + 0.9, [1, 1, 1], 0, L, 1.0, LINE_LIFT + 0.01);
        else lineStrip(gb, 1000 - 0.9, 1000 - 0.5, [1, 1, 1], 0, L, 1.0, LINE_LIFT + 0.01);
        if (gb.count) out.push({ name: `neonedge${side}`, geometry: gb.build(), material: mats.emissive(color, 3.2, { params: { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 } }), cast: false, receive: false });
      };
      mk(-1, o.neonLeft ?? '#22e6ff');
      mk(1, o.neonRight ?? '#ff2ee6');
      // light bleed: soft additive gradient on the asphalt beside each neon edge line
      const bleed = (side, color) => {
        const gb = new GeoBuilder();
        const c0 = rgb(color);
        let prev = null;
        for (let s = 0; s <= L + 1e-6; s += 1) {
          const sw = ((s % L) + L) % L;
          if (inGap(sw)) { prev = null; continue; }
          const c = cl.sample(sw, tmp);
          const n = cl._planeNormalFrom(c);
          const edge = side * (c.hw - 0.5), inner = side * (c.hw - 3.7);
          const a = gb.v(c.px + c.rx * edge, c.py - edge * c.tanB + LINE_LIFT + 0.006, c.pz + c.rz * edge, ...n, [c0[0] * 0.34, c0[1] * 0.34, c0[2] * 0.34], 0, 0);
          const b = gb.v(c.px + c.rx * inner, c.py - inner * c.tanB + LINE_LIFT + 0.006, c.pz + c.rz * inner, ...n, [0, 0, 0], 1, 0);
          if (prev) { if (side < 0) gb.quad(prev[0], prev[1], b, a); else gb.quad(prev[1], prev[0], a, b); }
          prev = [a, b];
        }
        if (gb.count) {
          const mat = mats.add(new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
          out.push({ name: `neonbleed${side}`, geometry: gb.build(), material: mat, cast: false, receive: false, order: 2 });
        }
      };
      bleed(-1, o.neonLeft ?? '#22e6ff');
      bleed(1, o.neonRight ?? '#ff2ee6');
    }
  }

  // ---------------------------------------------------------------- boost pads
  if (cl.features.boost.length) {
    const gb = new GeoBuilder({ aDim: 2 });
    for (const p of cl.features.boost) {
      const l0 = p.lateral - p.width / 2, l1 = p.lateral + p.width / 2;
      const nRows = Math.max(2, Math.round(p.length / 1.0));
      let prev = null;
      for (let r = 0; r <= nRows; r++) {
        const s = p.s + (r / nRows) * p.length;
        const c = cl.sample(s, tmp);
        const n = cl._planeNormalFrom(c);
        const y = (r / nRows) * p.length;
        const dim = { aDim: [p.width / 2, p.length] };
        const a = gb.v(c.px + c.rx * l0, c.py - l0 * c.tanB + PAD_LIFT, c.pz + c.rz * l0, ...n, null, -p.width / 2, y, dim);
        const b = gb.v(c.px + c.rx * l1, c.py - l1 * c.tanB + PAD_LIFT, c.pz + c.rz * l1, ...n, null, p.width / 2, y, dim);
        if (prev) gb.quad(prev[0], prev[1], b, a);
        prev = [a, b];
      }
    }
    out.push({ name: 'boostpads', geometry: gb.build(), material: mats.boostPad(), cast: false, receive: false });
  }

  // ---------------------------------------------------------------- ramps
  if (cl.features.ramps.length) {
    const top = new GeoBuilder();
    const side = new GeoBuilder();
    const white = [1, 1, 1];
    for (const r of cl.features.ramps) {
      if (r.height <= 0.02) continue;
      const l0 = r.lateral - r.width / 2, l1 = r.lateral + r.width / 2;
      const nRows = Math.max(2, Math.round(r.length / 1.0));
      let prev = null;
      for (let k = 0; k <= nRows; k++) {
        const t = k / nRows;
        const c = cl.sample(r.s + t * r.length, tmp);
        const h = r.height * t;
        const b0 = [c.px + c.rx * l0, c.py - l0 * c.tanB, c.pz + c.rz * l0];
        const b1 = [c.px + c.rx * l1, c.py - l1 * c.tanB, c.pz + c.rz * l1];
        const n = cl._planeNormalFrom(c, r.height / r.length);
        const a = top.v(b0[0], b0[1] + h, b0[2], ...n, white, 0, t);
        const b = top.v(b1[0], b1[1] + h, b1[2], ...n, white, 1, t);
        const sa0 = side.v(b0[0], b0[1] - 0.05, b0[2], -c.rx, 0, -c.rz, white, 0, 0);
        const sa1 = side.v(b0[0], b0[1] + h, b0[2], -c.rx, 0, -c.rz, white, 0, h * 0.5);
        const sb0 = side.v(b1[0], b1[1] - 0.05, b1[2], c.rx, 0, c.rz, white, 0, 0);
        const sb1 = side.v(b1[0], b1[1] + h, b1[2], c.rx, 0, c.rz, white, 0, h * 0.5);
        if (prev) {
          top.quad(prev.a, prev.b, b, a);
          side.quad(prev.sa0, prev.sa1, sa1, sa0);
          side.quad(prev.sb0, sb0, sb1, prev.sb1);
        }
        prev = { a, b, sa0, sa1, sb0, sb1 };
      }
      const c = cl.sample(r.s + r.length, tmp);
      const hgt = r.height;
      const n = [c.tx, 0, c.tz];
      const p0 = [c.px + c.rx * l0, c.py - l0 * c.tanB, c.pz + c.rz * l0];
      const p1 = [c.px + c.rx * l1, c.py - l1 * c.tanB, c.pz + c.rz * l1];
      const q0 = side.v(p0[0], p0[1] - 0.05, p0[2], ...n, white, 0, 0);
      const q1 = side.v(p1[0], p1[1] - 0.05, p1[2], ...n, white, r.width * 0.5, 0);
      const q2 = side.v(p1[0], p1[1] + hgt, p1[2], ...n, white, r.width * 0.5, hgt * 0.5);
      const q3 = side.v(p0[0], p0[1] + hgt, p0[2], ...n, white, 0, hgt * 0.5);
      side.quad(q0, q3, q2, q1);
    }
    if (top.count) {
      const tex = mats.add(rampTexture());
      const glow = o.rampGlow ?? 0;
      const mat = mats.add(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.05, emissiveMap: glow ? tex : null, emissive: glow ? new THREE.Color(0xffffff) : new THREE.Color(0x000000), emissiveIntensity: glow }));
      out.push({ name: 'ramps', geometry: top.build(), material: mat, cast: true, receive: true });
      const stripes = mats.add(makeStripeTexture());
      const smat = mats.add(new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.65, metalness: 0.05, emissiveMap: glow ? stripes : null, emissive: glow ? new THREE.Color(0xffffff) : new THREE.Color(0x000000), emissiveIntensity: glow }));
      out.push({ name: 'rampsides', geometry: side.build(), material: smat, cast: true, receive: true });
    }
  }

  // ---------------------------------------------------------------- deck skirts / gap end caps
  {
    const gb = new GeoBuilder();
    const t = o.deck?.thickness ?? 2.2;
    const col = rgb(o.deck?.color ?? '#3a3d4a');
    const dark = rgb(o.deck?.underColor ?? '#1c1d26');
    const hasDeck = !!o.deck;
    const ext = (k, side) => (hasDeck ? (side < 0 ? cl.outerL[k] : cl.outerR[k]) : cl.hw[k]);
    if (hasDeck) {
      for (let i = 0; i <= N; i++) {
        const k = i % N;
        const eL = ext(k, -1), eR = ext(k, 1);
        const nL = [-cl.rx[k], 0, -cl.rz[k]], nR = [cl.rx[k], 0, cl.rz[k]];
        gb.v(...pt(i, -eL), ...nL, col, 0, 0);
        gb.v(...pt(i, -eL, -t), ...nL, dark, 0, 1);
        gb.v(...pt(i, eR), ...nR, col, 0, 0);
        gb.v(...pt(i, eR, -t), ...nR, dark, 0, 1);
        gb.v(...pt(i, -eL, -t), 0, -1, 0, dark, 0, 0);
        gb.v(...pt(i, eR, -t), 0, -1, 0, dark, 1, 0);
      }
      for (let i = 0; i < N; i++) {
        if (cl.gap[i]) continue;
        const a = i * 6, b = (i + 1) * 6;
        gb.quad(a + 1, a, b, b + 1);
        gb.quad(a + 2, a + 3, b + 3, b + 2);
        gb.quad(a + 4, b + 4, b + 5, a + 5);
      }
    }
    for (const g of cl.gaps) {
      for (const [idx, dir] of [[g.i0, 1], [g.i1, -1]]) {
        const k = idx % N;
        const eL = ext(k, -1), eR = ext(k, 1);
        const capT = hasDeck ? t : 2.6;
        const n = [dir * cl.tx[k], dir * cl.ty[k], dir * cl.tz[k]];
        const a = gb.v(...pt(idx, -eL), ...n, col, 0, 0);
        const b = gb.v(...pt(idx, eR), ...n, col, 1, 0);
        const c = gb.v(...pt(idx, eR, -capT), ...n, dark, 1, 1);
        const d = gb.v(...pt(idx, -eL, -capT), ...n, dark, 0, 1);
        if (dir > 0) gb.quad(a, b, c, d); else gb.quad(a, d, c, b);
      }
    }
    if (gb.count) out.push({ name: 'deck', geometry: gb.build(), material: mats.vcolor({ roughness: 0.75, side: THREE.DoubleSide }), cast: true, receive: true });
  }
  return out;
}

/** Painted chevron arrows (a stack of 3) at distance s; dir = +1 right-hand turn, -1 left. */
function arrowsAt(gb, cl, s, dir, col, tmp) {
  for (let k = 0; k < 3; k++) {
    const ss = s + k * 2.1;
    const c = cl.sample(ss, tmp);
    const n = cl._planeNormalFrom(c);
    const w = 2.5;
    const at = (l, dz) => {
      const c2 = cl.sample(ss + dz, {});
      return [c2.px + c2.rx * l, c2.py - l * c2.tanB + LINE_LIFT + 0.006, c2.pz + c2.rz * l];
    };
    const off = dir * 0.7;
    const tip = gb.v(...at(off, 0.8), ...n, col, 0, 0);
    const l1 = gb.v(...at(off - w / 2, -0.3), ...n, col, 0, 0);
    const l2 = gb.v(...at(off - w / 2, -1.0), ...n, col, 0, 0);
    const mid = gb.v(...at(off, -0.2), ...n, col, 0, 0);
    const r1 = gb.v(...at(off + w / 2, -0.3), ...n, col, 0, 0);
    const r2 = gb.v(...at(off + w / 2, -1.0), ...n, col, 0, 0);
    // triangles (up-facing: low-lateral, high-lateral order)
    gb.tri(tip, l1, mid); gb.tri(tip, l1, l2); gb.tri(tip, l2, mid);
    gb.tri(tip, mid, r1); gb.tri(tip, mid, r2); gb.tri(tip, r2, r1);
  }
}


/**
 * Decal ribbons over the road for a list of ranges [{ s0, s1, l0, l1 }] (l0/l1 default to the full half-width).
 * Returns a BufferGeometry (uv = lateral/8, s/8) lifted slightly above the surface.
 */
export function ribbonDecal(cl, ranges, lift = 0.03, uvScale = 8) {
  const gb = new GeoBuilder({ uv1: 2 });
  const tmp = {};
  const L = cl.length;
  for (const r of ranges) {
    const len = (((r.s1 - r.s0) % L) + L) % L;
    let prev = null;
    for (let t = 0; t <= len + 1e-6; t += 1) {
      const s = (r.s0 + Math.min(t, len)) % L;
      if (cl.gap[Math.floor(s / cl.ds) % cl.N]) { prev = null; continue; }
      const c = cl.sample(s, tmp);
      const l0 = r.l0 ?? -c.hw, l1 = r.l1 ?? c.hw;
      const n = cl._planeNormalFrom(c);
      const v01 = len > 0 ? Math.min(1, t / len) : 0;
      // uv: world-scaled (repeating detail); uv1: 0..1 across the patch (edge masks)
      const a = gb.v(c.px + c.rx * l0, c.py - l0 * c.tanB + lift, c.pz + c.rz * l0, ...n, null, l0 / uvScale, (r.s0 + t) / uvScale, { uv1: [0, v01] });
      const b = gb.v(c.px + c.rx * l1, c.py - l1 * c.tanB + lift, c.pz + c.rz * l1, ...n, null, l1 / uvScale, (r.s0 + t) / uvScale, { uv1: [1, v01] });
      if (prev) gb.quad(prev[0], prev[1], b, a);
      prev = [a, b];
    }
  }
  return gb.count ? gb.build() : null;
}
