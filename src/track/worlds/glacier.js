/**
 * Frostbite Pass world: crisp alpine light, snowy peaks, snow-capped pines, snowbank walls, frozen lake
 * (ice surface), a curved crystal ice cave with glowing crystals, falling snow, snowmen and cabins with
 * warm lit windows. OWNER: World agent.
 */
import * as THREE from 'three';
import { fbm, ridged, smooth, mix, hash2, vnoise } from '../noise.js';
import { buildWalls } from '../walls.js';
import { Placer, InstanceSet, BlobShadows, SpacingGrid } from '../scatter.js';
import { GeoBuilder, rgb } from '../geo.js';
import { ribbonDecal } from '../roadmesh.js';
import * as props from '../props.js';
import { buildGantry, buildGrandstand } from '../landmarks.js';
import { makeIceTexture, makeDriftMask } from '../textures.js';
import { buildChevronSigns, turnArrowList, addCollider } from './common.js';
import { buildAmbient } from '../ambient.js';

const tint = (r, g, b) => new THREE.Color().setRGB(r, g, b);

function rangeWeight(s, s0, s1, fin, fout, L) {
  const a = ((s - s0) % L + L) % L, len = ((s1 - s0) % L + L) % L;
  if (a > len) {
    // just outside the range: soft skirts
    const before = ((s0 - s) % L + L) % L, after = ((s - s1) % L + L) % L;
    if (before < fin) return 1 - before / fin;
    if (after < fout) return 1 - after / fout;
    return 0;
  }
  return Math.min(1, a / Math.max(1, fin)) * Math.min(1, (len - a) / Math.max(1, fout));
}

function peakGeometry(seed, R, H) {
  const gb = new GeoBuilder({ aRoadD: 1, aM0: 1, aM1: 1 });
  const n = 11, tiers = 8;
  const rings = [];
  for (let t = 0; t <= tiers; t++) {
    const k = t / tiers;
    const y = -30 + (H + 30) * Math.pow(k, 1.15);
    const rr = R * Math.pow(1 - k, 0.85) * (1 + 0.12 * vnoise(k * 4 + seed, seed, seed + 1));
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.5;
      const w = rr * (0.75 + 0.5 * (vnoise(Math.cos(a) * 2 + seed, Math.sin(a) * 2 + k * 3, seed + 2) * 0.5 + 0.5));
      ring.push([Math.cos(a) * w, y + vnoise(i * 1.7 + seed, t * 2.1, seed + 4) * (H * 0.025), Math.sin(a) * w]);
    }
    rings.push(ring);
  }
  const tri = (a, b, c, hint) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const m = Math.hypot(nx, ny, nz) || 1;
    nx /= m; ny /= m; nz /= m;
    let p = [a, b, c];
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { p = [a, c, b]; nx = -nx; ny = -ny; nz = -nz; }
    const ids = p.map((q) => gb.v(q[0], q[1], q[2], nx, ny, nz, null, 0, 0, { aRoadD: 90 }));
    gb.tri(ids[0], ids[1], ids[2]);
  };
  for (let t = 0; t < tiers; t++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = rings[t][i], b = rings[t][j], c = rings[t + 1][j], d = rings[t + 1][i];
      const hint = [(a[0] + b[0] + c[0] + d[0]) / 4, 0.4, (a[2] + b[2] + c[2] + d[2]) / 4];
      tri(a, d, c, hint);
      tri(a, c, b, hint);
    }
  }
  return gb.build();
}

/** Swept ice-cave shell along the centerline. Returns { outer, inner } geometries. */
function caveGeometry(track, s0, s1, seed) {
  const cl = track.cl;
  const outer = new GeoBuilder({ aRoadD: 1, aM0: 1, aM1: 1 });
  const inner = new GeoBuilder();
  const step = 2.0;
  const len = s1 - s0;
  const rows = Math.ceil(len / step);
  const nθ = 26;
  const tmp = {};
  const rowsOuter = [], rowsInner = [];
  for (let r = 0; r <= rows; r++) {
    const s = s0 + Math.min(len, r * step);
    const c = cl.sample(s, tmp);
    const t01 = Math.min(1, Math.max(0, (s - s0) / len));
    const bell = Math.pow(Math.sin(Math.PI * t01), 0.55);
    const Wi = c.hw + 7.2, Hi = 12.6 + vnoise(s * 0.05, 3, seed) * 1.2;
    const Wo = Wi + 7 + 26 * bell, Ho = Hi + 2.6 + (14 + vnoise(s * 0.03, 8, seed) * 3.5) * bell;
    const ro = [], ri = [];
    for (let k = 0; k <= nθ; k++) {
      const th = (k / nθ) * Math.PI;
      const cs = Math.cos(th), sn = Math.sin(th);
      const wob = vnoise(s * 0.11 + seed, th * 2.6, seed + 1);
      // inner: vertical walls that round over into a dome
      const li = cs * (Wi + wob * 0.9), yi = Hi * Math.pow(sn, 0.7) + wob * 0.8;
      const lo = cs * (Wo + wob * 2.4), yo = Ho * Math.pow(sn, 0.72) - 3 + vnoise(s * 0.07, th * 3.3, seed + 3) * (1.2 + 2.0 * bell);
      const pI = [c.px + c.rx * li, c.py - li * c.tanB + yi, c.pz + c.rz * li];
      const pO = [c.px + c.rx * lo, c.py - lo * c.tanB + yo, c.pz + c.rz * lo];
      ro.push(pO);
      ri.push({ p: pI, th });
    }
    rowsOuter.push(ro);
    rowsInner.push(ri);
  }
  const addQuad = (gb, a, b, c, d, hint, cols, extra) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const m = Math.hypot(nx, ny, nz) || 1;
    nx /= m; ny /= m; nz /= m;
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const ids = [a, b, c, d].map((q, i) => gb.v(q[0], q[1], q[2], nx, ny, nz, cols ? cols[i] : null, 0, 0, extra));
    if (flip) gb.quad(ids[0], ids[3], ids[2], ids[1]); else gb.quad(ids[0], ids[1], ids[2], ids[3]);
  };
  for (let r = 0; r < rows; r++) {
    const f = cl.sample(s0 + (r + 0.5) * step, tmp);
    for (let k = 0; k < nθ; k++) {
      // outer skin: normal points away from the tunnel axis
      const a = rowsOuter[r][k], b = rowsOuter[r][k + 1], c = rowsOuter[r + 1][k + 1], d = rowsOuter[r + 1][k];
      const th = ((k + 0.5) / nθ) * Math.PI;
      const hintO = [f.rx * Math.cos(th), Math.sin(th), f.rz * Math.cos(th)];
      addQuad(outer, a, d, c, b, hintO, null, { aRoadD: 90 });
      // inner skin: normal points into the tunnel
      const ia = rowsInner[r][k], ib = rowsInner[r][k + 1], ic = rowsInner[r + 1][k + 1], id = rowsInner[r + 1][k];
      const hintI = [-f.rx * Math.cos(th), -Math.sin(th), -f.rz * Math.cos(th)];
      const shade = 0.75 + 0.25 * Math.sin(th);
      const wobc = 0.9 + 0.2 * vnoise(r * 0.7, k * 0.9, seed + 6);
      const col = (kk) => {
        const t = kk / nθ;
        const up = Math.sin(t * Math.PI);
        return [(0.035 + 0.11 * up) * wobc * shade, (0.13 + 0.24 * up) * wobc * shade, (0.42 + 0.30 * up) * wobc];
      };
      addQuad(inner, ia.p, id.p, ic.p, ib.p, hintI, [col(k), col(k), col(k + 1), col(k + 1)]);
    }
  }
  // portal rings at both ends (between inner and outer curves)
  for (const [row, dir] of [[0, -1], [rows, 1]]) {
    const cEnd = cl.sample(s0 + Math.min(len, row * step), tmp);
    const hint = [dir * cEnd.tx, 0, dir * cEnd.tz];
    for (let k = 0; k < nθ; k++) {
      const a = rowsInner[row][k].p, b = rowsInner[row][k + 1].p, c = rowsOuter[row][k + 1], d = rowsOuter[row][k];
      addQuad(outer, a, b, c, d, hint, null, { aRoadD: 90 });
    }
  }
  return { outer: outer.build(), inner: inner.build() };
}

export default {
  terrain(track) {
    const def = track.def;
    const seed = def.seed ?? 1;
    const cl = track.cl;
    const L = cl.length;
    const b = track.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const lake = def.frozenLake;
    return {
      cell: 4.2,
      baseLevel: 0,
      maxR: 200,
      natural(x, z, c) {
        const dRoad = Math.min(c.dFar, 900);
        const nearAmp = mix(0.28, 1, smooth(25, 300, dRoad));
        let h = c.follow + fbm(x * 0.006, z * 0.006, 4, seed) * 11 * nearAmp + fbm(x * 0.02, z * 0.02, 3, seed + 3) * 2.4 * nearAmp;
        const rr = ridged(x * 0.0024, z * 0.0024, 4, seed + 5);
        h += Math.pow(rr, 1.8) * 130 * smooth(150, 720, dRoad);
        const dc = Math.hypot(x - cx, z - cz);
        h += Math.pow(ridged(x * 0.0009 + 2, z * 0.0009 - 4, 5, seed + 9), 1.6) * 560 * smooth(900, 2300, dc);
        if (lake && c.d < Infinity) {
          const w = rangeWeight(c.s, lake.s0, lake.s1, 40, 40, L) * (1 - smooth(lake.width * 0.7, lake.width * 1.35, c.e));
          if (w > 0) {
            h = mix(h, c.refH - 0.35, w);
            c.m0 = w;
          }
        }
        return h;
      },
    };
  },

  road(track) {
    const def = track.def;
    const L = track.cl.length;
    const lake = def.frozenLake;
    return {
      center: 'dash', curbColors: ['#2c7be0', '#ffffff'], turnArrows: turnArrowList(track.cl, 75, 26), arrowColor: '#ffd21f',
      shoulderM0Fn: lake ? (s) => rangeWeight(s, lake.s0, lake.s1, 30, 30, L) : null,
    };
  },

  build(track, ctx) {
    const { mats, density } = ctx;
    const def = track.def;
    const seed = def.seed ?? 1;
    const cl = track.cl;
    const b = track.bounds;
    const L = cl.length;
    const foliage = mats.foliage();
    const placer = new Placer(track, seed * 19 + 5);
    const blobs = new BlobShadows(track, ctx, { alpha: 0.2, color: 0x1a2a4a });
    const terrainMat = track.terrainMat;
    track.iceTerrain = true;

    buildWalls(track, ctx);
    buildGantry(track, ctx, { color: '#1b4a7a', trim: '#2f79b8', sign: { top: '#2a9bff', bottom: '#0b3f9e' } });
    if (def.grandstand) buildGrandstand(track, ctx, def.grandstand);
    buildChevronSigns(track, ctx, { maxR: 72 });

    // ---------------------------------------------------------------- ice overlays (lake + patches)
    {
      const ranges = (def.surfaces ?? []).filter((q) => q.type === 'ice').map((q) => ({ s0: q.s0, s1: q.s1, l0: q.l0, l1: q.l1 }));
      if (ranges.length) {
        const tex = mats.add(makeIceTexture());
        const mask = mats.add(makeDriftMask(seed + 3, 0.1, 0.3));
        mask.channel = 1; // sample the per-patch uv1 set
        const mat = mats.add(new THREE.MeshStandardMaterial({
          map: tex, alphaMap: mask, roughness: 0.07, metalness: 0.28, transparent: true, opacity: 0.94, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        }));
        // each patch is its own mesh so uv1 spans exactly that patch
        for (const q of ranges) {
          // extend the decal by its feather so the fully opaque core covers exactly the gameplay range
          const len = q.s1 - q.s0, wid = q.l0 != null ? q.l1 - q.l0 : 20;
          const es = 0.12 * len + 0.5, el = q.l0 != null ? 0.12 * wid + 0.4 : 0;
          const r = { s0: q.s0 - es, s1: q.s1 + es, l0: q.l0 != null ? q.l0 - el : undefined, l1: q.l1 != null ? q.l1 + el : undefined };
          const g = ribbonDecal(cl, [r], 0.028, 8);
          if (!g) continue;
          const m = track.addMesh(g, mat, { receive: true, name: 'ice' });
          m.renderOrder = 3;
        }
      }
    }

    // ---------------------------------------------------------------- distant snow peaks
    {
      const geos = [];
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const rng = placer.rng;
      const placed = [];
      for (let n = 0; n < 500 && placed.length < 30; n++) {
        const a = rng() * Math.PI * 2, r = 700 + rng() * 2000;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.9;
        const R = 160 + rng() * 260, H = 150 + rng() * 300 + r * 0.05;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.R + R) * 0.75)) continue;
        placed.push({ x, z, R });
        const g = peakGeometry(seed + placed.length * 5, R, H);
        g.translate(x, track.terrain.heightAt(Math.max(-3000, Math.min(3000, x)), Math.max(-3000, Math.min(3000, z))) - 8, z);
        geos.push(g);
      }
      if (geos.length) track.addMesh(mergeSame(geos), terrainMat, { cast: false, name: 'peaks' });
    }

    // ---------------------------------------------------------------- ice cave
    if (def.cave) {
      const { s0, s1 } = def.cave;
      const { outer, inner } = caveGeometry(track, s0, s1, seed);
      { const c = cl.sample((s0 + s1) / 2, {}); track.landmarks.push({ type: 'cave', position: new THREE.Vector3(c.px, c.py, c.pz), s: (s0 + s1) / 2 }); }
      track.addCeiling(s0, s1, (s2, l, base, hwHere) => {
        const Wi = hwHere + 7.2;
        const t = l / Wi;
        if (Math.abs(t) > 0.985) return null;
        const Hi = 12.6 + vnoise(s2 * 0.05, 3, seed) * 1.2;
        return base + Hi * Math.pow(Math.sqrt(1 - t * t), 0.7) - 1.0;
      });
      const om = track.addMesh(outer, terrainMat, { cast: true, receive: true, name: 'cave-mound' });
      om.frustumCulled = true;
      const im = track.addMesh(inner, mats.glow(0.85, { roughness: 0.22, metalness: 0.12, side: THREE.DoubleSide }), { cast: false, receive: true, name: 'cave-inner' });
      im.frustumCulled = true;
      // glowing crystals & icicles
      const glow = mats.glow(2.6, { roughness: 0.15 });
      const crystalGeo = props.crystals(4, '#9df2ff');
      const crystals = new InstanceSet(track, crystalGeo, glow, { chunk: 220, cull: 320, cast: false, name: 'crystals' });
      const palette = [tint(0.5, 0.95, 1.0), tint(0.35, 0.65, 1.0), tint(0.7, 0.55, 1.0), tint(0.55, 1.0, 0.95)];
      const step = 5.5;
      for (let s = s0 + 3; s < s1 - 2; s += step) {
        for (const side of [-1, 1]) {
          const jit = hash2(Math.floor(s), side, 4);
          const c = cl.sample(s + jit * 3, {});
          const lat = side * (c.hw + 6.3 + jit * 0.8);
          const x = c.px + c.rx * lat, z = c.pz + c.rz * lat, y = c.py - lat * c.tanB;
          const sc = 0.7 + jit * 1.3;
          crystals.add(x, y - 0.2, z, jit * 6.28, sc, sc * (0.9 + jit), sc, palette[Math.floor(jit * 4) % 4], 0, side * 0.1);
        }
        if (hash2(Math.floor(s), 9, 4) > 0.4) {
          const c = cl.sample(s + 2, {});
          const lat = (hash2(Math.floor(s), 5, 4) - 0.5) * 2 * (c.hw + 3);
          const x = c.px + c.rx * lat, z = c.pz + c.rz * lat;
          const sc = 0.5 + hash2(Math.floor(s), 6, 4) * 0.6;
          // ceiling crystals hang down
          crystals.add(x, c.py - lat * c.tanB + 12.6, z, hash2(Math.floor(s), 7, 4) * 6.28, sc, sc * 1.4, sc, palette[Math.floor(hash2(Math.floor(s), 8, 4) * 4) % 4], Math.PI, 0);
        }
      }
      crystals.build();
      // a cool crystal glow that follows the focus while inside the cave (constant light count: no shader recompiles)
      const glowLight = new THREE.PointLight(0x58d8ff, 0, 34, 1.6);
      const glowLight2 = new THREE.PointLight(0x9a6bff, 0, 26, 1.8);
      track.group.add(glowLight, glowLight2);
      // darken the world while the camera is inside the cave
      track.cave = { s0, s1 };
      const hemiBase = track.hemi.intensity, envBase = ctx.scene.environmentIntensity, sunBase = track.sun.intensity;
      let hint = -1, f = 0;
      track.animators.push((dt, t, focus) => {
        if (!focus) return;
        hint = track._nearest(focus.x, focus.y, focus.z, hint);
        const s = hint * cl.ds;
        const target = rangeWeight(s, s0, s1, 14, 14, L) > 0.001 && Math.abs(focus.y - cl.py[hint]) < 14 && Math.hypot(focus.x - cl.px[hint], focus.z - cl.pz[hint]) < 38 ? Math.min(1, rangeWeight(s, s0 + 6, s1 - 6, 22, 22, L) * 1.6) : 0;
        f += (target - f) * Math.min(1, dt * 5);
        track.caveF = f;
        track.hemi.intensity = hemiBase * (1 - 0.72 * f);
        ctx.scene.environmentIntensity = envBase * (1 - 0.8 * f);
        track.sun.intensity = sunBase * (1 - 0.82 * f);
        glowLight.intensity = 90 * f;
        glowLight2.intensity = 55 * f;
        const ci = hint;
        glowLight.position.set(cl.px[ci] + cl.rx[ci] * -4, cl.py[ci] + 5.5, cl.pz[ci] + cl.rz[ci] * -4);
        glowLight2.position.set(cl.px[ci] + cl.rx[ci] * 5 + cl.hx[ci] * 12, cl.py[ci] + 6.5, cl.pz[ci] + cl.rz[ci] * 5 + cl.hz[ci] * 12);
      });
      track.disposers.push(() => {
        track.hemi.intensity = hemiBase;
        ctx.scene.environmentIntensity = envBase;
      });
    }

    const iceMask = (x, z) => track.terrain.maskAt(x, z);
    const inLakeZone = (x, z) => iceMask(x, z) > 0.15;
    const nearFlat = (inf, x, z) => !inLakeZone(x, z);
    const propGrid = new SpacingGrid(10);
    const snowmen = new InstanceSet(track, props.snowman(1), mats.vcolor({ roughness: 0.85 }), { chunk: 260, cull: 300, cast: true, name: 'snowmen' });
    placer.along(Math.round(10 * density), { edgeMin: 5.5, edgeMax: 22, minGap: 40, slopeMax: 0.25, group: propGrid, filter: nearFlat }, (x, y, z, inf, rng) => {
      const sc = 0.9 + rng() * 0.5;
      // face the road
      const c = cl.sample(inf.s, {});
      const dx = c.px - x, dz = c.pz - z;
      snowmen.add(x, y - 0.1, z, Math.atan2(dx, dz), sc, sc, sc);
      track.landmarks.push({ type: 'snowman', position: new THREE.Vector3(x, y + 2, z), s: inf.s });
      placer.exclude(x, z, 5);
      addCollider(track, x, z, 1.0 * sc, inf);
    });
    snowmen.build();

    const cab = props.cabin(2);
    const cabins = new InstanceSet(track, cab.body, mats.vcolor({ roughness: 0.8 }), { chunk: 320, cull: 420, cast: true, name: 'cabins' });
    const cabinWin = new InstanceSet(track, cab.windows, mats.glow(1.9, { roughness: 0.4 }), { chunk: 320, cull: 420, cast: false, name: 'cabin-windows' });
    const cabinSpots = [];
    placer.along(14, { edgeMin: 16, edgeMax: 70, minGap: 26, slopeMax: 0.16, tries: 200, group: propGrid, filter: (inf, x, z) => nearFlat(inf, x, z) && !(inf.s > 470 && inf.s < 600) }, (x, y, z, inf, rng) => {
      const c = cl.sample(inf.s, {});
      const yaw = Math.atan2(c.px - x, c.pz - z) + (rng() - 0.5) * 0.5;
      const sc = 1.0 + rng() * 0.35;
      cabins.add(x, y - 0.35, z, yaw, sc, sc, sc);
      cabinWin.add(x, y - 0.35, z, yaw, sc, sc, sc);
      cabinSpots.push([x, z, sc]);
      track.landmarks.push({ type: 'cabin', position: new THREE.Vector3(x, y + 2, z), s: inf.s });
      placer.exclude(x, z, 11);
      addCollider(track, x, z, 3.6 * sc, inf);
    });
    cabins.build();
    cabinWin.build();

    // ---------------------------------------------------------------- trees / rocks / crystals / snowmen / cabins
    const pineGeo = props.pine(1);
    const pines = new InstanceSet(track, pineGeo, foliage, { chunk: 220, cull: 520, cast: true, name: 'pines' });
    const pinesFar = new InstanceSet(track, props.pine(2, {}, true), foliage, { chunk: 260, cull: 560, cast: false, name: 'pines-far' });
    const placePine = (x, y, z, inf, rng, far = false) => {
      const sc = 0.8 + rng() * 1.0;
      (far ? pinesFar : pines).add(x, y - 0.15, z, rng() * 6.28, sc, sc * (0.9 + rng() * 0.4), sc, tint(0.82 + rng() * 0.3, 0.9 + rng() * 0.25, 0.85 + rng() * 0.3));
      blobs.add(x, y, z, 2.3 * sc);
      if (inf) addCollider(track, x, z, 0.8 * sc, inf);
    };
    const clump = (x, z) => fbm(x * 0.017 + 4, z * 0.017, 3, seed + 21);
    placer.along(Math.round(330 * density), { edgeMin: 6.5, edgeMax: 75, minGap: 6.4, bias: 1.4, slopeMax: 0.55, filter: (inf, x, z) => nearFlat(inf, x, z) && clump(x, z) > -0.2 }, (x, y, z, inf, rng) => placePine(x, y, z, inf, rng, false));
    const pad = 420;
    const bounds = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
    placer.area(Math.round(700 * density), { bounds, edgeMin: 40, minGap: 8, slopeMax: 0.6, tries: 10, filter: (inf, x, z) => nearFlat(inf, x, z) && clump(x + 300, z - 100) > -0.05 }, (x, y, z, inf, rng) => placePine(x, y, z, null, rng, true));
    pines.build();
    pinesFar.build();
    blobs.build();

    const rockSet = new InstanceSet(track, props.rock(3, { low: '#7f8ea3', high: '#eef6ff' }), mats.vcolor({ roughness: 0.85 }), { chunk: 200, cull: 380, cast: true, name: 'rocks' });
    placer.along(Math.round(80 * density), { edgeMin: 5, edgeMax: 50, minGap: 6, slopeMax: 0.7, filter: nearFlat }, (x, y, z, inf, rng) => {
      const sc = 0.7 + rng() * 1.9;
      rockSet.add(x, y - 0.15, z, rng() * 6.28, sc * 1.1, sc * 0.85, sc, tint(0.85 + rng() * 0.25, 0.9 + rng() * 0.2, 0.95 + rng() * 0.15), (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3);
      if (sc > 1.5) addCollider(track, x, z, 1.1 * sc, inf);
    });
    rockSet.build();

    // ice crystals scattered around the lake shore and along the pass
    const glowSmall = mats.glow(2.0, { roughness: 0.2 });
    const shardSet = new InstanceSet(track, props.crystals(7, '#a8f0ff'), glowSmall, { chunk: 240, cull: 300, cast: false, name: 'ice-shards' });
    placer.along(Math.round(60 * density), { edgeMin: 4, edgeMax: 60, minGap: 9, slopeMax: 0.8, filter: (inf, x, z) => inf.y - cl.py[Math.floor(inf.s / cl.ds) % cl.N] < 6, avoidWater: false }, (x, y, z, inf, rng) => {
      const sc = 0.55 + rng() * 1.1;
      shardSet.add(x, y - 0.1, z, rng() * 6.28, sc, sc * (1 + rng() * 0.6), sc, [tint(0.5, 0.95, 1), tint(0.6, 0.8, 1), tint(0.8, 0.7, 1)][Math.floor(rng() * 3)]);
    });
    shardSet.build();

    // ---------------------------------------------------------------- falling snow (camera-local points)
    const snow = buildAmbient(track, ctx, { count: 2600, box: [80, 46, 80], size: 5.5, color: 0xffffff, intensity: 1.0, vel: [1.6, -3.1, 0.5], wobble: 1, alpha: 0.85, name: 'snowfall' });
    track.animators.push(() => { snow.material.uniforms.uAlpha.value = 0.85 * (1 - (track.caveF ?? 0)); });
  },
};

function mergeSame(list) {
  let total = 0;
  const gs = list.map((g) => (g.index ? g.toNonIndexed() : g));
  gs.forEach((g) => (total += g.attributes.position.count));
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(gs[0].attributes)) {
    const size = gs[0].attributes[name].itemSize;
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of gs) { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
