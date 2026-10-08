/**
 * Canyon Rush world: golden-hour desert, towering strata mesas, rock canyon walls, natural rock arch,
 * chasm jump, saguaro cacti, shrubs, cow skulls, rolling tumbleweeds. OWNER: World agent.
 */
import * as THREE from 'three';
import { fbm, ridged, smooth, mix, hash2, vnoise } from '../noise.js';
import { buildWalls } from '../walls.js';
import { Placer, InstanceSet, BlobShadows, SpacingGrid } from '../scatter.js';
import { GeoBuilder } from '../geo.js';
import * as props from '../props.js';
import { buildGantry, buildBirds } from '../landmarks.js';
import { buildChevronSigns, turnArrowList, addCollider } from './common.js';
import { buildAmbient } from '../ambient.js';
import { makeDriftTexture } from '../textures.js';

const tint = (r, g, b) => new THREE.Color().setRGB(r, g, b);

/** per-sample cliff height arrays (left / right) with smooth ramps at the range ends */
function cliffArrays(cl, def) {
  const N = cl.N;
  const hl = new Float32Array(N), hr = new Float32Array(N);
  for (const c of def.cliffs ?? []) {
    for (let i = 0; i < N; i++) {
      const s = i * cl.ds;
      const L = cl.length;
      const a = ((s - c.s0) % L + L) % L, len = ((c.s1 - c.s0) % L + L) % L;
      if (a > len) continue;
      if (c.sides !== 'right') hl[i] = Math.max(hl[i], c.height);
      if (c.sides !== 'left') hr[i] = Math.max(hr[i], c.height);
    }
  }
  cl._blur(hl, 22, 3);
  cl._blur(hr, 22, 3);
  return { hl, hr };
}

function mesaGeometry(seed, R, H) {
  const gb = new GeoBuilder({ aRoadD: 1, aM0: 1, aM1: 1 });
  const n = 15, tiers = 7;
  const rings = [];
  for (let t = 0; t <= tiers; t++) {
    const ring = [];
    const k = t / tiers;
    const y = -40 + (H + 40) * Math.pow(k, 0.85);
    // ledges: odd tiers pull in, even tiers stay (talus + cap-rock look)
    const inset = 1 - 0.05 * (t % 2 ? 1 : 0) - 0.13 * k * k - (t === tiers ? 0.03 : 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = R * (0.72 + 0.4 * (vnoise(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7, seed + 2) * 0.5 + 0.5)) * inset * (1 + 0.05 * vnoise(i * 3.1, t * 1.7, seed));
      ring.push([Math.cos(a) * rr, y + (t > 0 ? vnoise(i * 1.3, t, seed + 5) * 2.2 : 0), Math.sin(a) * rr]);
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
    const ex = { aRoadD: 90 };
    const i0 = gb.v(p[0][0], p[0][1], p[0][2], nx, ny, nz, null, 0, 0, ex);
    const i1 = gb.v(p[1][0], p[1][1], p[1][2], nx, ny, nz, null, 0, 0, ex);
    const i2 = gb.v(p[2][0], p[2][1], p[2][2], nx, ny, nz, null, 0, 0, ex);
    gb.tri(i0, i1, i2);
  };
  for (let t = 0; t < tiers; t++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = rings[t][i], b = rings[t][j], c = rings[t + 1][j], d = rings[t + 1][i];
      const mx = (a[0] + b[0] + c[0] + d[0]) / 4, mz = (a[2] + b[2] + c[2] + d[2]) / 4;
      const hint = [mx, 0.15, mz];
      tri(a, d, c, hint);
      tri(a, c, b, hint);
    }
  }
  const top = rings[tiers];
  const cy = top.reduce((s, p) => s + p[1], 0) / n;
  const centre = [0, cy + 1.2, 0];
  for (let i = 0; i < n; i++) tri(centre, top[(i + 1) % n], top[i], [0, 1, 0]);
  return gb.build();
}

/** Balanced-rock spires (stacked, necked, cap-rocked) using the strata shader material. */
function hoodooGeometry(seed, H) {
  const gb = new GeoBuilder({ aRoadD: 1, aM0: 1, aM1: 1 });
  const rings = [];
  const n = 11;
  const prof = [[0, 3.6], [0.22, 3.1], [0.42, 2.2], [0.58, 1.55], [0.72, 1.7], [0.82, 2.9], [0.9, 3.2], [1.0, 2.2]];
  prof.forEach(([t, r], k) => {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.85 + 0.3 * (vnoise(Math.cos(a) * 2 + seed, k * 1.7, seed + 3) * 0.5 + 0.5));
      ring.push([Math.cos(a) * rr, -3 + t * (H + 3), Math.sin(a) * rr]);
    }
    rings.push(ring);
  });
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
  for (let t = 0; t < rings.length - 1; t++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = rings[t][i], b = rings[t][j], c = rings[t + 1][j], d = rings[t + 1][i];
      const hint = [(a[0] + b[0] + c[0] + d[0]) / 4, 0.05, (a[2] + b[2] + c[2] + d[2]) / 4];
      tri(a, d, c, hint);
      tri(a, c, b, hint);
    }
  }
  const top = rings[rings.length - 1];
  const cy = top.reduce((sum, q) => sum + q[1], 0) / n + 0.5;
  for (let i = 0; i < n; i++) tri([0, cy, 0], top[(i + 1) % n], top[i], [0, 1, 0]);
  return gb.build();
}

function archGeometry(hw, seed = 3) {
  const gb = new GeoBuilder({ aRoadD: 1, aM0: 1, aM1: 1 });
  const steps = 28;
  const inner = [], outer = [];
  const Rix = hw + 7.2, Riy = 15.5;
  for (let i = 0; i <= steps; i++) {
    const th = -0.3 + ((Math.PI + 0.6) * i) / steps;
    const c = Math.cos(th), s = Math.sin(th);
    const thick = 5.2 + 6.5 * Math.pow(Math.abs(c), 1.6) + vnoise(i * 0.7, seed, seed) * 1.2; // thin at the crown, massive at the legs
    inner.push([c * Rix, s * Riy]);
    outer.push([c * (Rix + thick), s * (Riy + thick * 0.85)]);
  }
  const rough = (x, y, z) => {
    const k = 0.9;
    return [x + vnoise(x * 0.22 + seed, y * 0.22 + z * 0.1, seed) * k, y + vnoise(y * 0.22 + seed * 2, z * 0.22 + x * 0.1, seed + 1) * k, z + vnoise(z * 0.22 - seed, x * 0.22 + y * 0.1, seed + 2) * k];
  };
  const zf = (i) => 6.5 + 2.2 * Math.sin((i / steps) * Math.PI) + vnoise(i * 0.5, 9, seed) * 0.8;
  const tri = (a, b, c, hint) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const m = Math.hypot(nx, ny, nz) || 1;
    nx /= m; ny /= m; nz /= m;
    let p = [a, b, c];
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { p = [a, c, b]; nx = -nx; ny = -ny; nz = -nz; }
    const ex = { aRoadD: 90 };
    const ids = p.map((q) => gb.v(q[0], q[1], q[2], nx, ny, nz, null, 0, 0, ex));
    gb.tri(ids[0], ids[1], ids[2]);
  };
  const quad = (a, b, c, d, hint) => { tri(a, b, c, hint); tri(a, c, d, hint); };
  for (let i = 0; i < steps; i++) {
    const zi = zf(i), zj = zf(i + 1);
    const p = (pt, z) => rough(pt[0], pt[1], z);
    // soffit (inner surface, faces down/inward)
    const ia = p(inner[i], -zi), ib = p(inner[i + 1], -zj), ic = p(inner[i + 1], zj), id = p(inner[i], zi);
    const midIn = [-(inner[i][0] + inner[i + 1][0]) / 2, -(inner[i][1] + inner[i + 1][1]) / 2 + 2, 0];
    quad(ia, ib, ic, id, midIn);
    // top (outer surface)
    const oa = p(outer[i], -zi), ob = p(outer[i + 1], -zj), oc = p(outer[i + 1], zj), od = p(outer[i], zi);
    const midOut = [(outer[i][0] + outer[i + 1][0]) / 2, (outer[i][1] + outer[i + 1][1]) / 2, 0];
    quad(oa, ob, oc, od, midOut);
    // front and back faces
    quad(p(inner[i], zi), p(inner[i + 1], zj), p(outer[i + 1], zj), p(outer[i], zi), [0, 0, 1]);
    quad(p(inner[i], -zi), p(inner[i + 1], -zj), p(outer[i + 1], -zj), p(outer[i], -zi), [0, 0, -1]);
  }
  return gb.build();
}

/** Vertical rock faces closing the chasm slot at both gap ends (strata via the terrain shader). */
function chasmFaces(track, ctx) {
  const cl = track.cl;
  const seed = track.def.seed ?? 1;
  const depth = 50;
  for (const g of cl.gaps) {
    for (const [idx, dir] of [[g.i0, 1], [g.i1, -1]]) {
      const c = cl.sample(idx * cl.ds, {});
      const k = idx % cl.N;
      const W = Math.max(cl.outerL[k], cl.outerR[k]) + 6.5;
      const cols = 22, rows = 12;
      const gb = new GeoBuilder({ aRoadD: 1, aM0: 1, aM1: 1 });
      const yTop = c.py - 2.6, yBot = c.py - depth - 8;
      const nrm = [dir * c.tx, 0, dir * c.tz];
      const grid = [];
      for (let r = 0; r <= rows; r++) {
        const row = [];
        for (let q = 0; q <= cols; q++) {
          const l = -W + (q / cols) * 2 * W;
          const y = yTop + (yBot - yTop) * (r / rows);
          const jag = (vnoise(l * 0.35 + seed, y * 0.25, seed + idx) + vnoise(l * 0.9, y * 0.6, seed) * 0.4) * 0.9;
          const off = -dir * 0.05 + dir * jag * (r > 0 ? 1 : 0);
          const x = c.px + c.rx * l + c.tx * off, z = c.pz + c.rz * l + c.tz * off;
          const shade = 1 - 0.85 * Math.pow(r / rows, 0.8);
          row.push(gb.v(x, y + c.tanB * -l * 0, z, nrm[0], 0, nrm[2], [shade, shade, shade], 0, 0, { aRoadD: 90 }));
        }
        grid.push(row);
      }
      for (let r = 0; r < rows; r++) {
        for (let q = 0; q < cols; q++) {
          const a = grid[r][q], b = grid[r][q + 1], c2 = grid[r + 1][q + 1], d = grid[r + 1][q];
          if (dir > 0) gb.quad(a, d, c2, b); else gb.quad(a, b, c2, d);
        }
      }
      const g2 = gb.build(true);
      const mesh = new THREE.Mesh(g2, track.terrainMat);
      mesh.receiveShadow = true;
      mesh.name = 'chasm-face';
      track.group.add(mesh);
    }
  }
}

export default {
  terrain(track) {
    const def = track.def;
    const seed = def.seed ?? 1;
    const cl = track.cl;
    const b = track.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const { hl, hr } = cliffArrays(cl, def);
    track.cliffL = hl;
    track.cliffR = hr;
    return {
      cell: 3.4,
      baseLevel: 0,
      gapDepth: 50,
      maxR: 240,
      natural(x, z, c) {
        // open desert: low dunes that follow the road elevation, buttes further out
        const dRoad = Math.min(c.dFar, 700);
        let open = c.follow + fbm(x * 0.012, z * 0.012, 3, seed) * 2.4 + fbm(x * 0.05, z * 0.05, 2, seed + 3) * 0.6;
        const m = fbm(x * 0.0021 + 3, z * 0.0021 - 1, 3, seed + 7);
        const far = smooth(220, 620, dRoad);
        open += (smooth(0.12, 0.18, m) * 48 + smooth(0.27, 0.32, m) * 40) * far;
        const dc = Math.hypot(x - cx, z - cz);
        open += Math.pow(ridged(x * 0.0009 + 5, z * 0.0009, 4, seed + 11), 2.0) * 240 * smooth(1300, 2600, dc);
        if (c.d === Infinity) return open;
        const i = Math.floor(c.s / cl.ds) % cl.N;
        const H = c.l < 0 ? hl[i] : hr[i];
        if (H < 0.5) return open;
        const e = c.e;
        const t1 = smooth(0, 2.6, e), t2 = smooth(1.8, 11, e);
        const prof = 0.16 * t1 + 0.84 * Math.pow(t2, 0.85);
        const rough = (fbm(x * 0.07, z * 0.07, 3, seed + 5) * 3.4 + ridged(x * 0.16, z * 0.16, 2, seed + 6) * 3.6) * t2 + fbm(x * 0.3, z * 0.3, 2, seed + 8) * 0.9 * t1;
        const plateau = fbm(x * 0.02, z * 0.02, 3, seed + 12) * 5 * t2;
        const cliff = c.refH + H * prof + rough + plateau;
        return mix(open, Math.max(cliff, open), smooth(0, 1, Math.min(1, H / 6)));
      },
    };
  },

  road(track) {
    return {
      center: 'dash', centerColor: '#ffd23f', curbColors: ['#d63a12', '#f6ead2'],
      turnArrows: turnArrowList(track.cl, 75, 26), arrowColor: '#ffd23f',
    };
  },

  build(track, ctx) {
    const { mats, density } = ctx;
    const def = track.def;
    const seed = def.seed ?? 1;
    const cl = track.cl;
    const b = track.bounds;
    const foliage = mats.foliage();
    const placer = new Placer(track, seed * 17 + 3);
    const blobs = new BlobShadows(track, ctx, { alpha: 0.24, color: 0x3a1408 });
    const terrainMat = track.terrainMat;

    buildWalls(track, ctx);
    chasmFaces(track, ctx);
    buildGantry(track, ctx, { color: '#6b3a1a', trim: '#a5622e', sign: { top: '#e2731d', bottom: '#8f2f0f' } });
    buildChevronSigns(track, ctx, { maxR: 72 });

    // ---------------------------------------------------------------- wind-blown sand drifts across the road (offroad surface override)
    {
      const patches = (def.surfaces ?? []).filter((q) => q.type === 'offroad' && q.look === 'sand');
      if (patches.length) {
        const tex = mats.add(makeDriftTexture([226, 170, 98], seed));
        const mat = mats.add(new THREE.MeshStandardMaterial({
          map: tex, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
          polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        }));
        const tmp = {};
        for (const q0 of patches) {
          // extend by the feather so the opaque core covers exactly the gameplay range
          const wid0 = (q0.l1 ?? 10) - (q0.l0 ?? -10);
          const es = 0.13 * (q0.s1 - q0.s0) + 0.5, el = 0.13 * wid0 + 0.4;
          const q = { s0: q0.s0 - es, s1: q0.s1 + es, l0: q0.l0 != null ? q0.l0 - el : undefined, l1: q0.l1 != null ? q0.l1 + el : undefined };
          const gb = new GeoBuilder();
          const len = q.s1 - q.s0;
          let prev = null;
          for (let t = 0; t <= len + 1e-6; t += 1) {
            const c = cl.sample(q.s0 + t, tmp);
            const l0 = Math.max(-c.hw, q.l0 ?? -c.hw), l1 = Math.min(c.hw, q.l1 ?? c.hw);
            const n = cl._planeNormalFrom(c);
            const a = gb.v(c.px + c.rx * l0, c.py - l0 * c.tanB + 0.03, c.pz + c.rz * l0, ...n, null, 0, t / len);
            const b2 = gb.v(c.px + c.rx * l1, c.py - l1 * c.tanB + 0.03, c.pz + c.rz * l1, ...n, null, 1, t / len);
            if (prev) gb.quad(prev[0], prev[1], b2, a);
            prev = [a, b2];
          }
          const m = track.addMesh(gb.build(), mat, { receive: true, name: 'sand-drift' });
          m.renderOrder = 3;
        }
      }
    }

    // ---------------------------------------------------------------- far mesas (crisp silhouettes)
    {
      const geos = [];
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const rng = placer.rng;
      const placed = [];
      for (let n = 0; n < 400 && placed.length < 26; n++) {
        const a = rng() * Math.PI * 2, r = 620 + rng() * 2100;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.9;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.R * 1.5 + 140)) continue;
        const R = 90 + rng() * 210, H = 55 + rng() * 150 + r * 0.03;
        placed.push({ x, z, R });
        const g = mesaGeometry(seed + placed.length * 7, R, H);
        g.translate(x, track.terrain.heightAt(Math.max(-3000, Math.min(3000, x)), Math.max(-3000, Math.min(3000, z))) - 6, z);
        geos.push(g);
      }
      if (geos.length) {
        const merged = mergeSame(geos);
        const m = track.addMesh(merged, terrainMat, { cast: false, name: 'mesas' });
        m.frustumCulled = true;
      }
    }

    // ---------------------------------------------------------------- rock arch over the road
    if (def.arch) {
      const s = def.arch.s;
      const c = cl.sample(s, {});
      const geo = archGeometry(c.hw, seed);
      const mesh = new THREE.Mesh(geo, terrainMat);
      const idx = cl.indexAt(s);
      mesh.position.set(c.px, c.py, c.pz);
      mesh.rotation.y = Math.atan2(cl.hx[idx], cl.hz[idx]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'arch';
      track.group.add(mesh);
      track.landmarks.push({ type: 'arch', position: mesh.position.clone(), s });
      const Rix = c.hw + 7.2;
      track.addCeiling(s - 6.0, s + 6.0, (s2, l, base) => {
        const t = l / Rix;
        return Math.abs(t) < 0.98 ? base + 15.5 * Math.sqrt(1 - t * t) - 1.3 : null;
      });
    }

    // ---------------------------------------------------------------- desert decor
    const cactusSet = new InstanceSet(track, props.saguaro(1), mats.vcolor({ roughness: 0.85 }), { chunk: 220, cull: 420, cast: true, name: 'saguaro' });
    const barrelSet = new InstanceSet(track, props.barrelCactus(2), mats.vcolor({ roughness: 0.85 }), { chunk: 220, cull: 260, cast: false, name: 'barrel' });
    const shrubSet = new InstanceSet(track, props.desertShrub(3), foliage, { chunk: 200, cull: 300, cast: false, name: 'shrub' });
    const deadTree = new InstanceSet(track, props.scrubTree(4, { low: '#5d6a2a', high: '#a9b04e' }), foliage, { chunk: 220, cull: 380, cast: true, name: 'scrubtree' });
    const rockSet = new InstanceSet(track, props.rock(6, { low: '#7a3a22', high: '#c98a58' }), mats.vcolor({ roughness: 0.92 }), { chunk: 200, cull: 400, cast: true, name: 'rocks' });
    const skulls = new InstanceSet(track, props.cowSkull(1), mats.vcolor({ roughness: 0.8 }), { chunk: 260, cull: 220, cast: false, name: 'skulls' });
    const nearFlat = (inf, x, z) => {
      const ry = cl.py[Math.floor(inf.s / cl.ds) % cl.N];
      return Math.abs(inf.y - ry) < 5.5;
    };
    placer.along(Math.round(120 * density), { edgeMin: 6.5, edgeMax: 75, minGap: 11, bias: 1.4, slopeMax: 0.3, filter: nearFlat }, (x, y, z, inf, rng) => {
      const sc = 0.8 + rng() * 0.9;
      cactusSet.add(x, y - 0.1, z, rng() * 6.28, sc, sc * (0.85 + rng() * 0.4), sc, tint(0.85 + rng() * 0.3, 0.9 + rng() * 0.2, 0.8 + rng() * 0.3));
      blobs.add(x, y, z, 1.7 * sc);
      addCollider(track, x, z, 0.75 * sc, inf);
    });
    placer.along(Math.round(180 * density), { edgeMin: 5.5, edgeMax: 40, minGap: 4, slopeMax: 0.4, filter: nearFlat }, (x, y, z, inf, rng) => {
      const sc = 0.7 + rng() * 0.8;
      if (rng() < 0.35) barrelSet.add(x, y - 0.05, z, rng() * 6.28, sc, sc, sc);
      else shrubSet.add(x, y - 0.05, z, rng() * 6.28, sc * 1.1, sc * (0.8 + rng() * 0.5), sc * 1.1, tint(0.8 + rng() * 0.4, 0.85 + rng() * 0.3, 0.7 + rng() * 0.3));
    });
    placer.along(Math.round(46 * density), { edgeMin: 8, edgeMax: 60, minGap: 12, slopeMax: 0.35, filter: nearFlat }, (x, y, z, inf, rng) => {
      const sc = 0.9 + rng() * 0.9;
      deadTree.add(x, y - 0.1, z, rng() * 6.28, sc, sc, sc, tint(0.8 + rng() * 0.4, 0.85 + rng() * 0.25, 0.7 + rng() * 0.3));
      addCollider(track, x, z, 0.5 * sc, inf);
    });
    placer.along(Math.round(120 * density), { edgeMin: 5, edgeMax: 60, minGap: 6, slopeMax: 0.6, filter: nearFlat }, (x, y, z, inf, rng) => {
      const sc = 0.6 + rng() * 1.8;
      rockSet.add(x, y - 0.12, z, rng() * 6.28, sc * 1.1, sc * 0.85, sc, tint(0.85 + rng() * 0.3, 0.85 + rng() * 0.3, 0.85 + rng() * 0.3), (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3);
      blobs.add(x, y, z, 1.6 * sc);
      if (sc > 1.5) addCollider(track, x, z, 1.1 * sc, inf);
    });
    // big boulders piled at the cliff foot (behind the walls)
    placer.along(Math.round(110 * density), { edgeMin: 0.8, edgeMax: 3.2, minGap: 6, slopeMax: 1.0, avoidWater: false, filter: (inf) => { const i = Math.floor(inf.s / cl.ds) % cl.N; return (inf.l < 0 ? track.cliffL[i] : track.cliffR[i]) > 8; } }, (x, y, z, inf, rng) => {
      const sc = 2 + rng() * 3.2;
      rockSet.add(x, y - sc * 0.42, z, rng() * 6.28, sc * 1.1, sc * 0.8, sc, tint(0.6 + rng() * 0.3, 0.6 + rng() * 0.3, 0.6 + rng() * 0.3), (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.4);
    });
    placer.along(Math.round(18 * density), { edgeMin: 3, edgeMax: 16, minGap: 30, slopeMax: 0.3, group: new SpacingGrid(10), filter: nearFlat }, (x, y, z, inf, rng) => {
      const sc = 1.5 + rng() * 0.6;
      skulls.add(x, y - 0.05, z, rng() * 6.28, sc, sc, sc, null, 0, (rng() - 0.5) * 0.3);
    });
    [cactusSet, barrelSet, shrubSet, deadTree, rockSet, skulls].forEach((s) => s.build());
    blobs.build();

    // ---------------------------------------------------------------- hoodoos + eagles
    {
      const geos = [];
      const P = { i0: 0, u: 0, s: 0, d: 0, l: 0, fx: 0, fz: 0, y: 0 };
      let placedH = 0;
      const rng = placer.rng;
      for (let n = 0; n < 300 && placedH < Math.round(14 * Math.max(0.6, density)); n++) {
        const s = rng() * cl.length;
        const c = cl.sample(s, {});
        const idx = cl.indexAt(s);
        const side = rng() < 0.5 ? -1 : 1;
        const lat = side * (c.hw + 30 + rng() * 150);
        const x = c.px + c.rx * lat, z = c.pz + c.rz * lat;
        if (!track.roadField.project(x, z, 220, P)) continue;
        if (P.d - Math.max(cl.outerL[idx], cl.outerR[idx]) < 26) continue;
        const y = track.terrain.heightAt(x, z);
        if (Math.abs(y - cl.py[idx]) > 5) continue; // stay on the desert floor
        const H = 9 + rng() * 16;
        const g = hoodooGeometry(seed + placedH * 3, H);
        const sc = 0.8 + rng() * 0.7;
        g.scale(sc, sc, sc);
        g.rotateY(rng() * 6.28);
        g.translate(x, y, z);
        geos.push(g);
        track.colliders.push({ x, z, radius: 3.2 * sc });
        placedH++;
      }
      if (geos.length) track.addMesh(mergeSame(geos), terrainMat, { cast: true, name: 'hoodoos' });
      const cxm = (b.minX + b.maxX) / 2, czm = (b.minZ + b.maxZ) / 2;
      buildBirds(track, ctx, [
        { count: 4, x: cxm, z: czm, radius: 140, alt: 130, scale: 3.2, speed: 0.045, color: '#2b1c14' },
        { count: 3, x: cxm - 160, z: czm - 120, radius: 110, alt: 100, scale: 2.8, speed: -0.05, color: '#3a2418' },
      ]);
    }

    // ---------------------------------------------------------------- drifting dust
    buildAmbient(track, ctx, { count: 1100, box: [90, 26, 90], size: 5.5, color: '#ffd9a0', intensity: 1.0, vel: [3.4, 0.15, -2.2], wobble: 1.2, alpha: 0.42, sizeClamp: [1.4, 14], name: 'dust' });

    // ---------------------------------------------------------------- tumbleweeds
    {
      const n = 9;
      const geo = props.tumbleweed(2);
      const im = new THREE.InstancedMesh(geo, mats.vcolor({ roughness: 0.95 }), n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true;
      im.frustumCulled = false;
      im.name = 'tumbleweeds';
      track.group.add(im);
      const wind = new THREE.Vector3(0.83, 0, -0.55).normalize();
      const items = [];
      for (let i = 0; i < n; i++) {
        const s = (i / n) * cl.length + hash2(i, 3, 3) * 60;
        const f = cl.sample(s, {});
        items.push({ x: f.px + f.rx * (hash2(i, 4, 3) - 0.5) * 30, z: f.pz + f.rz * (hash2(i, 5, 3) - 0.5) * 30, sp: 5 + hash2(i, 6, 3) * 4, r: 0.7 + hash2(i, 7, 3) * 0.5, ph: hash2(i, 8, 3) * 6.28, rot: 0 });
      }
      const q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), p = new THREE.Vector3(), sc = new THREE.Vector3(), axis = new THREE.Vector3(), qs = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
      const cxm = (b.minX + b.maxX) / 2, czm = (b.minZ + b.maxZ) / 2;
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.65;
      track.animators.push((dt) => {
        for (let i = 0; i < n; i++) {
          const it = items[i];
          it.x += wind.x * it.sp * dt;
          it.z += wind.z * it.sp * dt;
          if ((it.x - cxm) * wind.x + (it.z - czm) * wind.z > span) { it.x -= wind.x * span * 2; it.z -= wind.z * span * 2; }
          it.rot += (it.sp / it.r) * dt;
          const y = track.groundY(it.x, it.z) + it.r * 0.8 + Math.abs(Math.sin(it.rot * 0.7 + it.ph)) * 0.35;
          axis.set(-wind.z, 0, wind.x);
          q.setFromAxisAngle(axis, it.rot);
          qs.setFromAxisAngle(yAxis, it.ph);
          q.multiply(qs);
          m4.compose(p.set(it.x, y, it.z), q, sc.set(it.r, it.r, it.r));
          im.setMatrixAt(i, m4);
        }
        im.instanceMatrix.needsUpdate = true;
      });
    }
  },
};

/** merge geometries that share the same attribute set (indexed → non-indexed) */
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
