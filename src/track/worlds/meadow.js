/**
 * Sunshine Circuit world: rolling green hills, flower meadows, round-canopy trees, lake, windmills,
 * hot-air balloons, grandstand, fences & tire walls, grass shortcut. OWNER: World agent.
 */
import * as THREE from 'three';
import { fbm, ridged, smooth, mix, hash2 } from '../noise.js';
import { inRange } from '../centerline.js';
import { buildWalls } from '../walls.js';
import { Placer, InstanceSet, BlobShadows } from '../scatter.js';
import * as props from '../props.js';
import { buildGantry, buildGrandstand, buildWindmill, buildBalloons, buildBunting, buildBirds } from '../landmarks.js';
import { GeoBuilder, rgb } from '../geo.js';
import { buildWater } from '../water.js';
import { buildPath } from '../paths.js';
import { buildChevronSigns, turnArrowList, addCollider } from './common.js';
import { buildAmbient } from '../ambient.js';

const tint = (r, g, b) => new THREE.Color().setRGB(r, g, b);

export default {
  terrain(track) {
    const def = track.def;
    const seed = def.seed ?? 1;
    const b = track.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const lake = def.lake;
    return {
      cell: 4.4,
      baseLevel: 0,
      natural(x, z, c) {
        const dRoad = Math.min(c.dFar, 900);
        const amp = mix(0.34, 1, smooth(20, 240, dRoad));
        const hills = fbm(x * 0.0045, z * 0.0045, 4, seed) * 17 + fbm(x * 0.0095 + 5, z * 0.0095 - 3, 3, seed + 6) * 9 + fbm(x * 0.016, z * 0.016, 3, seed + 4) * 3.4;
        // broad far-away rolling hills (long wavelength => smooth silhouettes, no faceted streaks)
        const far = fbm(x * 0.0021 + 11, z * 0.0021 - 7, 3, seed + 13) * 46 * smooth(160, 720, dRoad);
        let h = c.follow + hills * amp + far;
        const dc = Math.hypot(x - cx, z - cz);
        const m = ridged(x * 0.0012 + 3, z * 0.0012 - 5, 4, seed + 9);
        h += Math.pow(m, 2.2) * 330 * smooth(700, 2000, dc);
        if (lake) {
          const q = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz);
          const basin = 1 - smooth(0.55, 1.2, q);
          h = mix(h, lake.level - lake.depth, basin);
        }
        return h;
      },
    };
  },

  road(track) {
    return { center: 'dash', turnArrows: turnArrowList(track.cl, 80, 26) };
  },

  build(track, ctx) {
    const { mats, density } = ctx;
    const def = track.def;
    const seed = def.seed ?? 1;
    const cl = track.cl;
    const b = track.bounds;
    const foliage = mats.foliage();
    const placer = new Placer(track, seed * 31 + 7);
    const blobs = new BlobShadows(track, ctx, { alpha: 0.26, color: 0x0b2206 });

    buildWalls(track, ctx);
    buildGantry(track, ctx);
    if (def.grandstand) buildGrandstand(track, ctx, def.grandstand);
    buildChevronSigns(track, ctx, { maxR: 78 });
    buildBunting(track, ctx, { s0: 1030, s1: 128, sides: [-1] });

    // ---------------------------------------------------------------- grass shortcut (built first so decor avoids it)
    if (def.shortcut) {
      const sc = def.shortcut;
      const a = cl.sample(sc.s0, {}), c2 = cl.sample(sc.s1, {});
      const side = sc.side ?? 1;
      const o = (f, extra) => [f.px + f.rx * side * (f.hw + extra), f.pz + f.rz * side * (f.hw + extra)];
      const p0 = o(a, 3.0), p3 = o(c2, 3.0);
      const dx = p3[0] - p0[0], dz = p3[1] - p0[1];
      const len = Math.hypot(dx, dz);
      const nrm = [-dz / len, dx / len];
      const bend = sc.bend ?? 5;
      const pts = [p0, [p0[0] + dx * 0.33 + nrm[0] * bend, p0[1] + dz * 0.33 + nrm[1] * bend], [p0[0] + dx * 0.68 + nrm[0] * bend * 0.6, p0[1] + dz * 0.68 + nrm[1] * bend * 0.6], p3];
      buildPath(track, ctx, { points: pts, width: sc.width ?? 7 });
      // sample the curve for the exclusion zone
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
      const poly = curve.getSpacedPoints(Math.round(curve.getLength() / 5)).map((v) => [v.x, v.z]);
      placer.excludePath(poly, (sc.width ?? 7) / 2 + 3.5);
      track.shortcutPath = poly;
    }

    // ---------------------------------------------------------------- lake
    if (def.lake) {
      buildWater(track, ctx, def.lake, { deep: '#0a4fa0', shallow: '#34d6d0' });
      track.landmarks.push({ type: 'lake', position: new THREE.Vector3(def.lake.x, def.lake.level, def.lake.z) });
      // reeds & rocks around the shore
      const lake = def.lake;
      const reeds = new InstanceSet(track, props.reeds(3), foliage, { chunk: 200, cull: 260, name: 'reeds' });
      const shoreRocks = new InstanceSet(track, props.rock(5), mats.vcolor({ roughness: 0.9 }), { chunk: 200, cull: 300, cast: true, name: 'shore-rocks' });
      const nSteps = Math.round(110 * density);
      for (let k = 0; k < nSteps; k++) {
        const a = (k / nSteps) * Math.PI * 2 + hash2(k, 1, 4) * 0.05;
        let hit = null;
        for (let r = 0.25; r < 1.7; r += 0.02) {
          const x = lake.x + Math.cos(a) * lake.rx * r, z = lake.z + Math.sin(a) * lake.rz * r;
          if (track.terrain.heightAt(x, z) > lake.level + 0.05) { hit = [x, z, r]; break; }
        }
        if (!hit) continue;
        const [sx, sz] = hit;
        const nx = Math.cos(a), nz = Math.sin(a);
        if (hash2(k, 2, 4) > 0.35) {
          const off = 0.4 + hash2(k, 3, 4) * 2.2;
          const x = sx + nx * off * 0.6 - nx * 0.8, z = sz + nz * off * 0.6 - nz * 0.8;
          reeds.add(x, track.terrain.heightAt(x, z) - 0.08, z, hash2(k, 5, 4) * 6.28, 1.0 + hash2(k, 6, 4) * 0.7, 1.0 + hash2(k, 7, 4) * 0.9, 1.0);
        }
        if (hash2(k, 8, 4) > 0.86) {
          const x = sx + nx * 1.2, z = sz + nz * 1.2;
          const sc = 0.7 + hash2(k, 9, 4) * 1.1;
          shoreRocks.add(x, track.terrain.heightAt(x, z) - 0.15, z, hash2(k, 10, 4) * 6.28, sc, sc * 0.8, sc);
        }
      }
      reeds.build();
      shoreRocks.build();
    }

    // ---------------------------------------------------------------- pier & sailboat on the lake
    if (def.lake) {
      const lake = def.lake;
      // the shore point facing the road with the longest clear approach: scan directions, pick the one nearest to the start straight
      let shore = null;
      for (let a = -Math.PI / 2 - 0.9; a < -Math.PI / 2 + 0.9 && !shore; a += 0.05) {
        for (let r = 0.25; r < 1.7; r += 0.02) {
          const x = lake.x + Math.cos(a) * lake.rx * r, z = lake.z + Math.sin(a) * lake.rz * r;
          if (track.terrain.heightAt(x, z) > lake.level + 0.05) { shore = { x, z, a }; break; }
        }
      }
      if (shore) {
        const gb = new GeoBuilder();
        const wood = rgb('#a8763e'), dark = rgb('#6b4523');
        const dx = -Math.cos(shore.a), dz = -Math.sin(shore.a); // pointing into the lake (toward centre)
        const yaw = Math.atan2(dx, dz);
        const len = 15;
        for (let k = 0; k < len; k++) {
          const px = shore.x + dx * (k + 0.5 - 2), pz = shore.z + dz * (k + 0.5 - 2);
          gb.box(px, lake.level + 0.62 + (k % 2) * 0.004, pz, 2.6, 0.14, 0.92, k % 2 ? wood : rgb('#b98448'), yaw);
        }
        for (let k = 0; k < len; k += 3) {
          for (const sd of [-1, 1]) {
            const px = shore.x + dx * (k - 1.5) - dz * sd * 1.2, pz = shore.z + dz * (k - 1.5) + dx * sd * 1.2;
            gb.box(px, lake.level - 0.6, pz, 0.28, 2.6, 0.28, dark, yaw);
          }
        }
        track.addMesh(gb.build(), mats.vcolor({ roughness: 0.85 }), { cast: true, name: 'pier' });
        // sailboat bobbing beside the pier
        const boat = new THREE.Group();
        const hullG = new THREE.BoxGeometry(1.5, 0.7, 4.2);
        const hp = hullG.attributes.position;
        for (let i = 0; i < hp.count; i++) if (hp.getZ(i) > 0) hp.setX(i, hp.getX(i) * (1 - (hp.getZ(i) / 2.1) * 0.9));
        hullG.translate(0, 0.25, 0);
        const col = (g, c) => { const cc = new THREE.Color(c); const n = g.attributes.position.count; g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Array.from({ length: n * 3 }, (_, i) => [cc.r, cc.g, cc.b][i % 3])), 3)); return g; };
        col(hullG, '#e8322a');
        const mast = col(new THREE.CylinderGeometry(0.05, 0.06, 4.6, 6), '#f2f2f2');
        mast.translate(0, 2.6, 0.2);
        const sailShape = new THREE.Shape();
        sailShape.moveTo(0, 0); sailShape.lineTo(0, 4.0); sailShape.lineTo(-1.9, 0.2); sailShape.closePath();
        const sail = col(new THREE.ShapeGeometry(sailShape), '#fffaf0');
        sail.translate(0.1, 0.9, 0.2);
        const sail2 = col(new THREE.ShapeGeometry((() => { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, 3.2); sh.lineTo(1.5, 0.2); sh.closePath(); return sh; })()), '#ffd23f');
        sail2.translate(0.1, 0.9, 0.2);
        [hullG, mast, sail, sail2].forEach((g) => {
          const m = new THREE.Mesh(g, mats.vcolor({ roughness: 0.6, side: THREE.DoubleSide }));
          m.castShadow = true;
          m.rotation.y = 0;
          boat.add(m);
        });
        const bx = shore.x + dx * 9 - dz * 3.6, bz = shore.z + dz * 9 + dx * 3.6;
        boat.position.set(bx, lake.level + 0.05, bz);
        track.group.add(boat);
        track.animators.push((dt, t) => {
          boat.position.y = lake.level + 0.05 + Math.sin(t * 1.3) * 0.07;
          boat.rotation.set(Math.sin(t * 0.9) * 0.03, yaw + Math.sin(t * 0.25) * 0.15, Math.sin(t * 1.1) * 0.05);
        });
        track.landmarks.push({ type: 'pier', position: new THREE.Vector3(shore.x, lake.level, shore.z) });
      }
    }

    // ---------------------------------------------------------------- floating pollen
    buildAmbient(track, ctx, { count: 520, box: [70, 22, 70], size: 1.7, color: '#ffe680', intensity: 1.0, vel: [0.5, 0.25, 0.2], wobble: 1.6, alpha: 0.75, additive: true, twinkle: 0.6, sizeClamp: [1.2, 9], name: 'pollen' });

    // ---------------------------------------------------------------- birds
    {
      const cxm = (b.minX + b.maxX) / 2, czm = (b.minZ + b.maxZ) / 2;
      buildBirds(track, ctx, [
        { count: 9, x: cxm + 40, z: czm - 40, radius: 90, alt: 55, scale: 1.2, speed: 0.11, color: '#2a2f3c' },
        { count: 7, x: cxm - 120, z: czm + 90, radius: 70, alt: 42, scale: 1.1, speed: -0.13, color: '#ffffff' },
        { count: 6, x: def.lake ? def.lake.x : cxm, z: def.lake ? def.lake.z : czm, radius: 45, alt: 22, scale: 1.0, speed: 0.15, color: '#f4f4f4' },
      ]);
    }

    // ---------------------------------------------------------------- trees
    const treeSet = new InstanceSet(track, props.roundTree(1), foliage, { chunk: 220, cull: 500, cast: true, name: 'trees' });
    const treeFar = new InstanceSet(track, props.roundTree(1, {}, true), foliage, { chunk: 380, cull: 600, cast: false, name: 'trees-far' });
    const poplarSet = new InstanceSet(track, props.poplar(2), foliage, { chunk: 320, cull: 500, cast: true, name: 'poplars' });
    const placeTree = (x, y, z, inf, rng, far = false) => {
      const r = rng();
      const sc = 0.85 + rng() * 0.9;
      // hue variation through the instance colour (greens .. yellow-greens .. blue-greens)
      const t = tint(0.72 + rng() * 0.5, 0.86 + rng() * 0.26, 0.62 + rng() * 0.5);
      if (r < 0.12) poplarSet.add(x, y - 0.1, z, rng() * 6.28, sc * 0.9, sc * (0.9 + rng() * 0.5), sc * 0.9, t);
      else (far ? treeFar : treeSet).add(x, y - 0.15, z, rng() * 6.28, sc, sc * (0.9 + rng() * 0.3), sc, t);
      blobs.add(x, y, z, 2.7 * sc);
      if (inf) addCollider(track, x, z, 0.85 * sc, inf);
    };
    const clump = (x, z) => fbm(x * 0.018, z * 0.018, 3, seed + 21);
    const zone = (s) => {
      for (const z of def.zones ?? []) if (inRange(s, z.s0, z.s1, cl.length)) return z.kind;
      return null;
    };
    // general scatter along the road (thinned out in the open-vista zones)
    placer.along(Math.round(330 * density), { edgeMin: 7.5, edgeMax: 70, minGap: 7.5, bias: 1.5, slopeMax: 0.42, filter: (inf, x, z) => { const k = zone(inf.s); return clump(x, z) > -0.12 && k !== 'open' && k !== 'forest'; } }, (x, y, z, inf, rng) => placeTree(x, y, z, inf, rng, false));
    // dense forest sections close to the road
    for (const z of (def.zones ?? []).filter((q) => q.kind === 'forest')) {
      placer.along(Math.round(160 * density), { s0: z.s0, s1: z.s1, edgeMin: 6.2, edgeMax: 46, minGap: 6.4, bias: 1.2, slopeMax: 0.5 }, (x, y, zz, inf, rng) => placeTree(x, y, zz, inf, rng, false));
    }
    // open vistas: keep a wide clear corridor (trees only far away)
    // poplar avenues: two straight rows of cypress trees just outside the fence
    for (const z of (def.zones ?? []).filter((q) => q.kind === 'avenue')) {
      const len = (((z.s1 - z.s0) % cl.length) + cl.length) % cl.length;
      for (let t = 0; t <= len; t += z.gap ?? 13) {
        for (const side of [-1, 1]) {
          const c = cl.sample(z.s0 + t, {});
          const idx = cl.indexAt(z.s0 + t);
          const w = side < 0 ? cl.wallL[idx] : cl.wallR[idx];
          const lat = side * ((Number.isNaN(w) ? cl.outerL[idx] : Math.abs(w)) + (z.offset ?? 4.2));
          const x = c.px + c.rx * lat, zz = c.pz + c.rz * lat;
          const y = track.groundY(x, zz);
          const sc = 1.15 + hash2(Math.floor(t), side, 3) * 0.3;
          poplarSet.add(x, y - 0.1, zz, hash2(Math.floor(t), side, 4) * 6.28, sc, sc * 1.25, sc, tint(0.9, 1.0, 0.85));
          blobs.add(x, y, zz, 2.0 * sc);
          placer.exclude(x, zz, 4.5);
          track.colliders.push({ x, z: zz, radius: 0.6 * sc });
        }
      }
    }
    const pad = 420;
    const bounds = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
    placer.area(Math.round(760 * density), { bounds, edgeMin: 42, minGap: 9, slopeMax: 0.4, tries: 10, filter: (inf, x, z) => clump(x + 500, z - 300) > 0.02 }, (x, y, z, inf, rng) => placeTree(x, y, z, null, rng, true));
    treeSet.build();
    treeFar.build();
    poplarSet.build();

    // ---------------------------------------------------------------- bushes
    const bushSet = new InstanceSet(track, props.bush(1), foliage, { chunk: 230, cull: 280, cast: true, name: 'bushes' });
    placer.along(Math.round(280 * density), { edgeMin: 5.6, edgeMax: 26, minGap: 4.2, slopeMax: 0.45 }, (x, y, z, inf, rng) => {
      const sc = 0.8 + rng() * 0.9;
      bushSet.add(x, y - 0.1, z, rng() * 6.28, sc, sc * 0.9, sc, tint(0.7 + rng() * 0.5, 0.86 + rng() * 0.26, 0.6 + rng() * 0.5));
      blobs.add(x, y, z, 1.5 * sc);
    });
    bushSet.build();

    // ---------------------------------------------------------------- flowers + grass tufts
    const fcols = ['#ffd21f', '#ff5fa0', '#f6f6ff', '#9a5cff', '#ff7a2a'].map((c) => new THREE.Color(c));
    const flowerSet = new InstanceSet(track, props.flowers('#ffffff', 1, 5), foliage, { chunk: 210, cull: 125, name: 'flowers' });
    const patchMask = (x, z) => fbm(x * 0.045 + 9, z * 0.045 - 4, 2, seed + 30);
    placer.along(Math.round(1800 * density), { edgeMin: 1.4, edgeMax: 30, minGap: 1.1, slopeMax: 0.4, tries: 8, filter: (inf, x, z) => patchMask(x, z) > 0.05 }, (x, y, z, inf, rng) => {
      const sc = 0.8 + rng() * 0.8;
      flowerSet.add(x, y - 0.03, z, rng() * 6.28, sc, sc, sc, fcols[Math.floor(hash2(Math.floor(x / 7), Math.floor(z / 7), 11) * fcols.length) % fcols.length]);
    });
    for (const z of (def.zones ?? []).filter((q) => q.kind === 'flowers')) {
      placer.along(Math.round(1400 * density), { s0: z.s0, s1: z.s1, edgeMin: 1.2, edgeMax: 34, minGap: 0.9, slopeMax: 0.4, tries: 6 }, (x, y, zz, inf, rng) => {
        const sc = 0.9 + rng() * 0.9;
        flowerSet.add(x, y - 0.03, zz, rng() * 6.28, sc, sc, sc, fcols[Math.floor(hash2(Math.floor(x / 5), Math.floor(zz / 5), 17) * fcols.length) % fcols.length]);
      });
    }
    flowerSet.build();
    const tufts = new InstanceSet(track, props.grassTuft(3), foliage, { chunk: 170, cull: 100, name: 'grass' });
    placer.along(Math.round(5200 * density), { edgeMin: 0.6, edgeMax: 22, minGap: 0.55, slopeMax: 0.45, tries: 3 }, (x, y, z, inf, rng) => {
      const sc = 0.9 + rng() * 1.1;
      tufts.add(x, y - 0.02, z, rng() * 6.28, sc, sc * (0.8 + rng() * 0.7), sc, tint(0.8 + rng() * 0.4, 0.9 + rng() * 0.2, 0.7 + rng() * 0.3));
    });
    tufts.build();

    // ---------------------------------------------------------------- rocks
    const rocks = new InstanceSet(track, props.rock(9), mats.vcolor({ roughness: 0.92 }), { chunk: 260, cull: 320, cast: true, name: 'rocks' });
    placer.along(Math.round(70 * density), { edgeMin: 6, edgeMax: 45, minGap: 6, slopeMax: 0.6 }, (x, y, z, inf, rng) => {
      const sc = 0.7 + rng() * 1.6;
      rocks.add(x, y - 0.12, z, rng() * 6.28, sc * 1.1, sc * 0.8, sc, null, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3);
      if (sc > 1.4) addCollider(track, x, z, 1.1 * sc, inf);
    });
    rocks.build();
    blobs.build();

    // ---------------------------------------------------------------- farms on the gentle far slopes
    {
      const farmGeo = props.farm(2);
      const chosenFarms = [];
      const dummyF = {};
      const nrm = { normal: new THREE.Vector3() };
      for (let n = 0; n < 900 && chosenFarms.length < 4; n++) {
        const x = b.minX - 300 + placer.rng() * (b.maxX - b.minX + 600), z = b.minZ - 300 + placer.rng() * (b.maxZ - b.minZ + 600);
        placer.info(x, z, dummyF);
        if (dummyF.e < 90 || dummyF.e > 360) continue;
        if (track.waterLevel != null && dummyF.y < track.waterLevel + 3) continue;
        if (placer.slopeAt(x, z, nrm) > 0.05) continue;
        if (chosenFarms.some((f) => Math.hypot(f.x - x, f.z - z) < 190)) continue;
        // needs a flat pad: sample around
        let flat = true;
        for (let k = 0; k < 8 && flat; k++) if (Math.abs(track.terrain.heightAt(x + Math.cos(k * 0.785) * 20, z + Math.sin(k * 0.785) * 20) - dummyF.y) > 1.6) flat = false;
        if (!flat) continue;
        chosenFarms.push({ x, z, y: dummyF.y });
      }
      chosenFarms.forEach((f, i) => {
        const m = new THREE.Mesh(farmGeo, mats.vcolor({ roughness: 0.85 }));
        m.position.set(f.x, f.y - 0.3, f.z);
        m.rotation.y = hash2(i, 7, 9) * 6.28;
        m.castShadow = true;
        m.receiveShadow = true;
        m.name = 'farm';
        track.group.add(m);
        placer.exclude(f.x, f.z, 24);
        track.landmarks.push({ type: 'farm', position: m.position.clone() });
      });
    }

    // ---------------------------------------------------------------- windmills, hay, balloons
    const spots = [];
    const dummy = {};
    for (let n = 0; n < 500 && spots.length < 12; n++) {
      const x = b.minX - 260 + placer.rng() * (b.maxX - b.minX + 520), z = b.minZ - 260 + placer.rng() * (b.maxZ - b.minZ + 520);
      placer.info(x, z, dummy);
      if (dummy.e < 70 || dummy.e > 320) continue;
      if (track.waterLevel != null && dummy.y < track.waterLevel + 1) continue;
      let avg = 0;
      for (let k = 0; k < 8; k++) avg += track.terrain.heightAt(x + Math.cos(k * 0.785) * 45, z + Math.sin(k * 0.785) * 45);
      spots.push({ x, z, y: dummy.y, prom: dummy.y - avg / 8 });
    }
    spots.sort((a, b2) => b2.prom - a.prom);
    const chosen = [];
    for (const sp of spots) {
      if (chosen.length >= 3) break;
      if (chosen.every((c) => Math.hypot(c.x - sp.x, c.z - sp.z) > 170)) chosen.push(sp);
    }
    const hay = new InstanceSet(track, props.hayBale(1), mats.vcolor({ roughness: 0.9 }), { chunk: 200, cull: 300, cast: true, name: 'hay' });
    chosen.forEach((sp, i) => {
      buildWindmill(track, ctx, sp.x, sp.z, hash2(i, 4, 7) * 6.28, 1.5, i + 2);
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3 + i, r = 9 + hash2(k, i, 5) * 5;
        const x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
        hay.add(x, track.groundY(x, z) - 0.05, z, hash2(k, i, 6) * 6.28, 1, 1, 1);
      }
    });
    hay.build();
    const cxm = (b.minX + b.maxX) / 2, czm = (b.minZ + b.maxZ) / 2;
    const bl = [
      { colors: ['#ff3b3b', '#ffd23f', '#ffffff'], x: cxm - 40, y: 105, z: czm - 40, orbit: 55, speed: 0.018, scale: 1.7 },
      { colors: ['#2a8cff', '#ffffff', '#ff3fa8'], x: cxm + 150, y: 130, z: czm + 90, orbit: 40, speed: -0.022, scale: 1.5 },
      { colors: ['#22d37a', '#ffe14a'], x: cxm - 190, y: 90, z: czm + 130, orbit: 34, speed: 0.026, scale: 1.4 },
      { colors: ['#9a5cff', '#ffd23f', '#ff7a2a'], x: cxm + 40, y: 150, z: czm - 200, orbit: 60, speed: 0.015, scale: 1.9 },
      { colors: ['#ff8a1a', '#ffffff'], x: cxm - 90, y: 120, z: czm + 240, orbit: 38, speed: -0.02, scale: 1.5 },
    ];
    bl.forEach((e) => { e.y += track.terrain.heightAt(e.x, e.z) * 0.5; });
    buildBalloons(track, ctx, bl);

  },
};
