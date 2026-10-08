/**
 * Landmarks shared across themes: start gantry (sign, banners, countdown lamps), grandstand with a bobbing crowd
 * and flags, windmills, hot-air balloons. Everything is built from merged vertex-coloured geometry and canvas
 * textures. OWNER: World agent.
 */
import * as THREE from 'three';
import { EVT } from '../core/events.js';
import { GeoBuilder, rgb, merge, simplify } from './geo.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeCanvas, canvasTexture, makeCheckerTexture } from './textures.js';
import { InstanceSet } from './scatter.js';
import * as props from './props.js';
import { hash2 } from './noise.js';

// ------------------------------------------------------------------------------------------------ textures
function drawSign(c, opts = {}) {
  const w = c.width, h = c.height;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, opts.top ?? '#2a52ff');
  grd.addColorStop(1, opts.bottom ?? '#0c1a8c');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  // checker strips top / bottom
  const cell = h * 0.075;
  for (let i = 0; i < w / cell; i++) {
    for (let r = 0; r < 2; r++) {
      g.fillStyle = (i + r) % 2 ? '#ffffff' : '#111111';
      g.fillRect(i * cell, r * cell, cell, cell);
      g.fillStyle = (i + r) % 2 ? '#111111' : '#ffffff';
      g.fillRect(i * cell, h - (r + 1) * cell, cell, cell);
    }
  }
  // speed stripes
  g.fillStyle = 'rgba(255,255,255,0.10)';
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    g.moveTo(w * (0.02 + i * 0.12), cell * 2);
    g.lineTo(w * (0.08 + i * 0.12), cell * 2);
    g.lineTo(w * (0.02 + i * 0.12) - h * 0.2, h - cell * 2);
    g.lineTo(w * (-0.04 + i * 0.12) - h * 0.2, h - cell * 2);
    g.closePath();
    g.fill();
  }
  const text = opts.text ?? 'KART BLITZ';
  const size = h * 0.47;
  g.font = `${size}px 'Lilita One', 'Arial Black', Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.16;
  g.strokeStyle = '#0a0f4a';
  g.strokeText(text, w * 0.5 + 6, h * 0.53 + 8);
  g.fillStyle = '#0a0f4a';
  g.fillText(text, w * 0.5 + 6, h * 0.53 + 8);
  g.strokeStyle = '#ff7a10';
  g.lineWidth = size * 0.12;
  g.strokeText(text, w * 0.5, h * 0.52);
  const tg = g.createLinearGradient(0, h * 0.25, 0, h * 0.8);
  tg.addColorStop(0, '#fff7c2');
  tg.addColorStop(0.5, '#ffe14a');
  tg.addColorStop(1, '#ffb01a');
  g.fillStyle = tg;
  g.fillText(text, w * 0.5, h * 0.52);
  // bolt
  g.fillStyle = '#ffffff';
  const bx = w * 0.035, by = h * 0.25, bs = h * 0.5;
  g.beginPath();
  g.moveTo(bx + bs * 0.55, by);
  g.lineTo(bx + bs * 0.05, by + bs * 0.58);
  g.lineTo(bx + bs * 0.42, by + bs * 0.58);
  g.lineTo(bx + bs * 0.25, by + bs);
  g.lineTo(bx + bs * 0.85, by + bs * 0.38);
  g.lineTo(bx + bs * 0.46, by + bs * 0.38);
  g.closePath();
  g.fill();
  const bx2 = w - bx - bs * 0.9;
  g.beginPath();
  g.moveTo(bx2 + bs * 0.55, by);
  g.lineTo(bx2 + bs * 0.05, by + bs * 0.58);
  g.lineTo(bx2 + bs * 0.42, by + bs * 0.58);
  g.lineTo(bx2 + bs * 0.25, by + bs);
  g.lineTo(bx2 + bs * 0.85, by + bs * 0.38);
  g.lineTo(bx2 + bs * 0.46, by + bs * 0.38);
  g.closePath();
  g.fill();
}

/** Big "KART BLITZ" sign texture; redraws itself once the display font has loaded. */
export function makeSignTexture(opts = {}) {
  const c = makeCanvas(1024, 280);
  drawSign(c, opts);
  const tex = canvasTexture(c, { aniso: 8 });
  try {
    document.fonts?.load("100px 'Lilita One'").then(() => {
      drawSign(c, opts);
      tex.needsUpdate = true;
    }).catch(() => {});
  } catch {}
  return tex;
}

/** Sponsor board atlas: 4 columns x 2 rows of bright ad panels (original fictional brands). */
export function makeSponsorAtlas() {
  const c = makeCanvas(1024, 256);
  const draw = () => {
    const g = c.getContext('2d');
    const names = [
      ['TURBO TIRES', '#ff3b30', '#ffffff'], ['NITRO FIZZ', '#19b8ff', '#ffffff'],
      ['SPEEDY SNACKS', '#ffd21f', '#1a1a1a'], ['BLITZ BOLTS', '#7a3cff', '#ffffff'],
      ['GO-GO GEAR', '#1fd36a', '#ffffff'], ['MEGA MOTORS', '#ff8a1a', '#ffffff'],
      ['ZAP ENERGY', '#ff3fa8', '#ffffff'], ['KART BLITZ', '#1a2cff', '#ffe14a'],
    ];
    names.forEach(([t, bg, fg], i) => {
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 128;
      g.fillStyle = bg;
      g.fillRect(x, y, 256, 128);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, y, 256, 20);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x, y + 108, 256, 20);
      g.font = "46px 'Lilita One', 'Arial Black', Impact, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = 46;
      while (g.measureText(t).width > 232 && size > 20) { size -= 2; g.font = `${size}px 'Lilita One', 'Arial Black', Impact, sans-serif`; }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillText(t, x + 130, y + 68);
      g.fillStyle = fg;
      g.fillText(t, x + 128, y + 64);
    });
  };
  draw();
  const tex = canvasTexture(c, { aniso: 8 });
  try {
    document.fonts?.load("40px 'Lilita One'").then(() => { draw(); tex.needsUpdate = true; }).catch(() => {});
  } catch {}
  return tex;
}

/** Local → world helper for a group placed at a track frame. */
function frameGroup(track, s, lateral = 0) {
  const cl = track.cl;
  const c = cl.sample(s, {});
  const g = new THREE.Group();
  const yaw = Math.atan2(cl.hx[cl.indexAt(s)], cl.hz[cl.indexAt(s)]);
  g.position.set(c.px + c.rx * lateral, c.py - lateral * c.tanB, c.pz + c.rz * lateral);
  g.rotation.y = yaw;
  return { group: g, yaw, frame: c };
}

// ------------------------------------------------------------------------------------------------ start gantry
export function buildGantry(track, ctx, opts = {}) {
  const cl = track.cl;
  const mats = ctx.mats;
  const { group, frame } = frameGroup(track, 0, 0);
  const hw = frame.hw;
  const px = hw + 2.1;
  const gb = new GeoBuilder();
  const navy = rgb(opts.color ?? '#1c2a6e'), navy2 = rgb(opts.trim ?? '#2c3f9a'), white = rgb('#f2f4ff'), red = rgb('#e8322a'), dark = rgb('#0d1233');
  const H = 10.2;
  const groundLocal = (x) => {
    const wx = frame.px + Math.cos(group.rotation.y) * x, wz = frame.pz - Math.sin(group.rotation.y) * x;
    return track.groundY(wx, wz) - frame.py;
  };
  for (const sx of [-1, 1]) {
    const x = sx * px;
    const g0 = groundLocal(x) - 1.2;
    gb.box(x, g0 + 0.5, 0, 2.0, 1.0, 2.0, dark);
    gb.box(x, g0 + H / 2 + 0.6, 0, 1.15, H, 1.15, navy);
    gb.box(x, g0 + 3.2, 0, 1.3, 0.35, 1.3, white);
    gb.box(x, g0 + 4.0, 0, 1.3, 0.35, 1.3, red);
    gb.box(x, g0 + H + 1.35, 0, 1.6, 0.5, 1.6, navy2);
  }
  const beamW = px * 2 + 1.8;
  gb.box(0, 9.15, 0, beamW, 1.5, 1.7, navy);
  gb.box(0, 9.98, 0, beamW - 0.4, 0.22, 1.9, navy2);
  gb.box(0, 8.3, 0, beamW - 0.4, 0.22, 1.9, navy2);
  // sign frame
  gb.box(0, 12.5, 0.0, 18.6, 5.0, 0.7, dark);
  gb.box(0, 12.5, 0.0, 18.2, 4.7, 0.9, navy2);
  // struts between beam and sign frame
  for (const sx of [-1, 1]) gb.box(sx * 7.5, 10.9, 0, 0.5, 2.0, 0.6, navy);
  for (const sx of [-1, 1]) gb.box(sx * px, H + 2.0, 0, 0.12, 3, 0.12, rgb('#dddddd'), 0);
  const body = gb.build();
  const bodyMesh = new THREE.Mesh(body, mats.vcolor({ roughness: 0.6, metalness: 0.15 }));
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // sign faces (both directions)
  const signTex = mats.add(makeSignTexture(opts.sign ?? {}));
  const signMat = mats.add(new THREE.MeshStandardMaterial({
    map: signTex, emissiveMap: signTex, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.55, roughness: 0.5, metalness: 0,
  }));
  const plane = new THREE.PlaneGeometry(17.6, 4.6);
  const front = new THREE.Mesh(plane, signMat); // faces +z (seen from ahead)
  front.position.set(0, 12.5, 0.46);
  const back = new THREE.Mesh(plane, signMat); // faces -z (seen by racers approaching)
  back.rotation.y = Math.PI;
  back.position.set(0, 12.5, -0.46);
  group.add(front, back);

  // countdown lamps (mounted under the sign, facing racers)
  const lamps = [];
  const housing = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.9, 0.6), mats.vcolor({ roughness: 0.5 }));
  {
    const c = new THREE.Color('#0b0e26');
    const n = housing.geometry.attributes.position.count;
    housing.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3])), 3));
  }
  housing.position.set(0, 7.15, -0.95);
  group.add(housing);
  for (let i = 0; i < 3; i++) {
    const m = mats.add(new THREE.MeshStandardMaterial({ color: 0x1a0505, emissive: new THREE.Color(0xff1a1a), emissiveIntensity: 0, roughness: 0.3 }));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 12), m);
    lamp.position.set((i - 1) * 2.0, 7.15, -1.35);
    group.add(lamp);
    lamps.push(m);
  }
  // checkered banners (one merged mesh) + pennants on the pillar tops (one merged mesh) + poles baked into the body
  const checker = mats.add(makeCheckerTexture(4, 8, '#ffffff', '#141414', 32));
  const bannerMat = mats.flag({ map: checker, vertexColors: false, vertical: true });
  {
    const geos = [];
    for (const sx of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(2.5, 4.6, 5, 12);
      geo.translate(sx * (hw - 3.4), 8.0 - 2.3, 0.2);
      geos.push(geo);
    }
    const merged = mergeGeometries(geos, false);
    const m = new THREE.Mesh(merged, bannerMat);
    group.add(m);
  }
  {
    const flagMat = mats.flag({ vertical: false });
    const geos = [];
    for (const [sx, col] of [[-1, '#ff3b30'], [1, '#ffd21f']]) {
      const g = new THREE.PlaneGeometry(2.6, 1.5, 8, 3);
      g.translate(1.3, 0, 0);
      if (sx < 0) g.rotateY(Math.PI);
      g.translate(sx * px, H + 2.8, 0);
      const c = new THREE.Color(col);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      geos.push(g);
    }
    group.add(new THREE.Mesh(mergeGeometries(geos, false), flagMat));
  }
  track.group.add(group);
  track.landmarks.push({ type: 'gantry', position: group.position.clone(), s: 0 });
  // the two pillars stand inside the drivable band: give them colliders
  for (const sx of [-1, 1]) {
    const wx = frame.px + Math.cos(group.rotation.y) * sx * px, wz = frame.pz - Math.sin(group.rotation.y) * sx * px;
    track.colliders.push({ x: wx, z: wz, radius: 1.0 });
  }
  track.addCeiling(-1.6, 1.6, (s2, l, base, hwHere) => (Math.abs(l) <= hwHere + 1.6 ? base + (Math.abs(l) < 3.6 && s2 > 1e9 ? 6.2 : 8.3) : null));

  // countdown lamp logic
  let goTimer = 0;
  const setLamps = (count) => {
    if (count > 0) {
      const on = 4 - count; // 3 → 1 lamp, 2 → 2, 1 → 3
      lamps.forEach((m, i) => {
        m.emissive.set(0xff0a06);
        m.emissiveIntensity = i < on ? 3.6 : 0;
      });
    } else {
      lamps.forEach((m) => {
        m.emissive.set(0x22ff55);
        m.emissiveIntensity = 5;
      });
      goTimer = 3.0;
    }
  };
  const offs = [];
  const bus = track.game?.events;
  if (bus?.on) {
    offs.push(bus.on(EVT.RACE_COUNTDOWN, ({ count }) => setLamps(count)));
    offs.push(bus.on(EVT.RACE_TEARDOWN, () => lamps.forEach((m) => (m.emissiveIntensity = 0))));
  }
  track.disposers.push(() => offs.forEach((f) => f?.()));
  track.animators.push((dt) => {
    if (goTimer > 0) {
      goTimer -= dt;
      if (goTimer <= 0) lamps.forEach((m) => (m.emissiveIntensity = 0));
    }
  });
  return { group, lamps };
}

// ------------------------------------------------------------------------------------------------ grandstand + crowd
/**
 * @param {{ s:number, side:1|-1, length?:number, tiers?:number, offset?:number, density?:number }} o
 */
export function buildGrandstand(track, ctx, o) {
  const cl = track.cl;
  const mats = ctx.mats;
  const side = o.side ?? 1;
  const length = o.length ?? 74;
  const tiers = o.tiers ?? 5;
  const step = 2.1, riser = 1.05;
  const c = cl.sample(o.s, {});
  const hw = c.hw;
  const yaw = Math.atan2(cl.hx[cl.indexAt(o.s)], cl.hz[cl.indexAt(o.s)]);
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const v0 = (o.offset ?? 9.5); // distance from the asphalt edge to the stand front
  const baseY = c.py; // start straight is flat
  // stand local (u along track, v away from the road, y up) → world
  const world = (u, v, y) => {
    const lx = -side * (hw + v0 + v); // local x (+x = left)
    const lz = u;
    return [c.px + cosY * lx + sinY * lz, baseY + y, c.pz - sinY * lx + cosY * lz];
  };
  const gb = new GeoBuilder();
  const pal = o.palette ?? {};
  const conc = rgb(pal.conc ?? '#9aa1b8'), concDark = rgb(pal.concDark ?? '#6d7590'), seatA = rgb(pal.seatA ?? '#3a5bd9'), seatB = rgb(pal.seatB ?? '#f2f2f8');
  const roofCol = rgb(pal.roofA ?? '#e8322a'), roofWhite = rgb(pal.roofB ?? '#fafafa'), pillar = rgb(pal.pillar ?? '#2c3760');
  const u0 = -length / 2 + (o.uShift ?? 0), u1 = u0 + length;
  // Add a world-space oriented box in stand-local coordinates.
  const lbox = (uc, vc, yc, su, sv, sy, col) => {
    const [x, y, z] = world(uc, vc, yc);
    gb.box(x, y, z, sv, sy, su, col, yaw + (side > 0 ? 0 : 0));
  };
  // foundation + tiers
  lbox((u0 + u1) / 2, (tiers * step) / 2, -0.9, length + 2, tiers * step + 2, 2.0, concDark);
  for (let k = 0; k < tiers; k++) {
    const vc = k * step + step / 2;
    const top = riser * (k + 1);
    lbox((u0 + u1) / 2, vc, top / 2 - 0.05, length, step, top, conc);
    // seat stripes on the tier tops
    const bands = Math.floor(length / 3);
    for (let b = 0; b < bands; b++) {
      lbox(u0 + b * 3 + 1.5, vc + 0.2, top + 0.02, 2.9, step * 0.5, 0.06, b % 2 ? seatA : seatB);
    }
  }
  // roof: sloped slab with stripes + pillars
  const roofY0 = riser * tiers + 4.6, roofY1 = roofY0 + 1.6;
  const stripeW = 3.0;
  for (let b = 0; b < Math.ceil(length / stripeW); b++) {
    const uc = u0 + b * stripeW + stripeW / 2;
    const col = b % 2 ? roofWhite : roofCol;
    const pts = [
      world(uc - stripeW / 2, -1.6, roofY0), world(uc + stripeW / 2, -1.6, roofY0),
      world(uc + stripeW / 2, tiers * step + 1.2, roofY1), world(uc - stripeW / 2, tiers * step + 1.2, roofY1),
    ];
    const n = [0, 1, 0];
    const ids = pts.map((p, i) => gb.v(p[0], p[1], p[2], n[0], n[1], n[2], col, i % 2, i > 1 ? 1 : 0));
    // top + underside (double-sided via two windings)
    gb.quad(ids[0], ids[1], ids[2], ids[3]);
    gb.quad(ids[0], ids[3], ids[2], ids[1]);
    // front face
    const lo = pts.map((p) => [p[0], p[1] - 0.4, p[2]]);
    const f = [pts[0], pts[1], lo[1], lo[0]].map((p, i) => gb.v(p[0], p[1], p[2], -side * cosY * -1, 0, 0, col, i % 2, i > 1 ? 1 : 0));
    gb.quad(f[0], f[1], f[2], f[3]);
    gb.quad(f[0], f[3], f[2], f[1]);
  }
  const nPill = Math.floor(length / 12) + 1;
  for (let i = 0; i < nPill; i++) {
    const u = u0 + 1 + i * ((length - 2) / Math.max(1, nPill - 1));
    lbox(u, -1.2, roofY0 / 2 - 0.2, 0.55, 0.55, roofY0 + 0.4, pillar);
    lbox(u, tiers * step + 0.6, (roofY1) / 2, 0.6, 0.6, roofY1, pillar);
  }
  // ad boards along the front of the first tier are added as a textured mesh below
  const mesh = new THREE.Mesh(gb.build(), mats.vcolor({ roughness: 0.8, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  track.group.add(mesh);

  // sponsor boards (textured quads facing the road)
  {
    const atlas = mats.add(makeSponsorAtlas());
    const sb = new GeoBuilder();
    const boardH = 1.3, boardW = 6.0;
    const nB = Math.floor(length / boardW);
    for (let i = 0; i < nB; i++) {
      const uA = u0 + i * boardW + 0.1, uB = uA + boardW - 0.2;
      const idx = Math.floor(hash2(i, 5, 2) * 8) % 8;
      const cx = idx % 4, cy = Math.floor(idx / 4);
      const uv0 = [cx * 0.25, 1 - (cy + 1) * 0.5], uv1 = [(cx + 1) * 0.25, 1 - cy * 0.5];
      const yB = 0.15;
      const A = world(uA, -0.25, yB), B = world(uB, -0.25, yB), C = world(uB, -0.25, yB + boardH), D = world(uA, -0.25, yB + boardH);
      const i0 = sb.v(A[0], A[1], A[2], 0, 0, 1, null, uv0[0], uv0[1]);
      const i1 = sb.v(B[0], B[1], B[2], 0, 0, 1, null, uv1[0], uv0[1]);
      const i2 = sb.v(C[0], C[1], C[2], 0, 0, 1, null, uv1[0], uv1[1]);
      const i3 = sb.v(D[0], D[1], D[2], 0, 0, 1, null, uv0[0], uv1[1]);
      sb.quad(i0, i1, i2, i3);
      sb.quad(i0, i3, i2, i1);
    }
    const g = sb.build();
    // normals face the road: the stand's front points along -side * local x, i.e. (cosY, 0, -sinY) * side in world
    const nrm = g.attributes.normal;
    const toRoad = [side * cosY, 0, -side * sinY];
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, toRoad[0], 0, toRoad[2]);
    const boards = new THREE.Mesh(g, mats.add(new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.5, metalness: 0, side: THREE.DoubleSide, emissiveMap: atlas, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.25 })));
    boards.receiveShadow = true;
    track.group.add(boards);
  }

  // crowd (bodies + heads), bouncing in the vertex shader
  const density = (o.density ?? 0.82) * Math.min(1, 0.55 + 0.45 * (ctx.density ?? 1));
  const bodyGeo = (() => {
    const b = new THREE.CylinderGeometry(0.24, 0.3, 0.72, 6);
    b.translate(0, 0.36, 0);
    const n = b.attributes.position.count;
    b.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const arms = new THREE.CylinderGeometry(0.07, 0.07, 0.55, 4);
    arms.rotateZ(0.5);
    arms.translate(0.3, 0.95, 0);
    arms.setAttribute('color', new THREE.BufferAttribute(new Float32Array(arms.attributes.position.count * 3).fill(1), 3));
    const arms2 = arms.clone();
    arms2.scale(-1, 1, 1);
    return merge([simplify(b), simplify(arms), simplify(arms2)]);
  })();
  const headGeo = (() => {
    const h = new THREE.SphereGeometry(0.21, 8, 6);
    h.translate(0, 0.98, 0);
    const n = h.attributes.position.count;
    h.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    return simplify(h);
  })();
  const crowdMat = mats.crowd();
  const bodies = new InstanceSet(track, bodyGeo, crowdMat, { chunk: 200, cull: 260, cast: false, name: 'crowd-bodies' });
  const heads = new InstanceSet(track, headGeo, crowdMat, { chunk: 200, cull: 260, cast: false, name: 'crowd-heads' });
  const shirts = ['#ff3b30', '#ffd21f', '#1fd3ff', '#7cff3a', '#ff3fa8', '#ffffff', '#ff8a1a', '#8a5cff', '#2aa8ff'];
  const skins = ['#f4c9a0', '#e2a877', '#c68642', '#8d5524', '#ffdfc4', '#a9683a'];
  let n = 0;
  for (let k = 0; k < tiers; k++) {
    const vc = k * step + step * 0.55;
    const top = riser * (k + 1);
    for (let u = u0 + 1; u < u1 - 1; u += 0.86) {
      const seed = n++;
      if (hash2(seed, 7, 3) > density) continue;
      const uu = u + (hash2(seed, 8, 3) - 0.5) * 0.25;
      const vv = vc + (hash2(seed, 9, 3) - 0.5) * 0.3;
      const p = world(uu, vv, top);
      const face = yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2) * 1;
      const sc = 0.92 + hash2(seed, 10, 3) * 0.28;
      bodies.add(p[0], p[1], p[2], face, sc, sc, sc, shirts[Math.floor(hash2(seed, 11, 3) * shirts.length)]);
      heads.add(p[0], p[1], p[2], face, sc, sc, sc, skins[Math.floor(hash2(seed, 12, 3) * skins.length)]);
    }
  }
  bodies.build();
  heads.build();

  // roof flags (instanced waving cloth)
  {
    const flagGeo = new THREE.PlaneGeometry(2.0, 1.2, 8, 3);
    flagGeo.translate(1.0, 0, 0);
    flagGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(flagGeo.attributes.position.count * 3).fill(1), 3));
    const flags = new InstanceSet(track, flagGeo, mats.flag(), { chunk: 200, cull: 300, name: 'stand-flags' });
    const poles = new GeoBuilder();
    const cols = ['#ff3b30', '#ffd21f', '#1a6bff', '#2fd36a', '#ff3fa8', '#ffffff'];
    const nF = Math.floor(length / 9);
    for (let i = 0; i < nF; i++) {
      const u = u0 + 3 + i * ((length - 6) / Math.max(1, nF - 1));
      const p = world(u, -1.2, roofY0 + 0.1);
      poles.box(p[0], p[1] + 2.0, p[2], 0.1, 4.0, 0.1, rgb('#d9d9e0'), 0);
      flags.add(p[0], p[1] + 3.3, p[2], yaw + (side > 0 ? 0 : Math.PI) + Math.PI / 2 * 0, 1, 1, 1, cols[i % cols.length]);
    }
    flags.build();
    if (poles.count) track.addMesh(poles.build(), mats.vcolor({ roughness: 0.5 }), { cast: true, name: 'stand-poles' });
  }
  track.landmarks.push({ type: 'grandstand', position: new THREE.Vector3(...world((u0 + u1) / 2, 4, 3)), s: o.s });
  return { u0, u1, side };
}

// ------------------------------------------------------------------------------------------------ windmills
export function buildWindmill(track, ctx, x, z, yaw = 0, scale = 1.4, seed = 1) {
  const mats = ctx.mats;
  const wm = props.windmill(seed);
  const y = track.groundY(x, z) - 0.6;
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.y = yaw;
  grp.scale.setScalar(scale);
  const body = new THREE.Mesh(wm.body, mats.vcolor({ roughness: 0.8 }));
  body.castShadow = true;
  body.receiveShadow = true;
  grp.add(body);
  const rotor = new THREE.Mesh(wm.rotor, mats.vcolor({ roughness: 0.8, side: THREE.DoubleSide }));
  rotor.position.set(0, wm.hubY, wm.hubZ);
  rotor.castShadow = true;
  grp.add(rotor);
  track.group.add(grp);
  const speed = 0.55 + hash2(seed, 3, 3) * 0.3;
  const phase = hash2(seed, 4, 3) * 6.28;
  track.animators.push((dt, t) => {
    rotor.rotation.z = phase + t * speed;
  });
  track.colliders.push({ x, z, radius: 3.4 * scale });
  track.landmarks.push({ type: 'windmill', position: grp.position.clone() });
  return grp;
}

// ------------------------------------------------------------------------------------------------ balloons
export function buildBalloons(track, ctx, list) {
  const mats = ctx.mats;
  const mat = mats.vcolor({ roughness: 0.55, side: THREE.DoubleSide });
  const entries = [];
  list.forEach((b, i) => {
    const geo = props.balloon(b.colors, i + 3);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.scale.setScalar(b.scale ?? 1.6);
    track.group.add(m);
    entries.push({ m, ...b, phase: hash2(i, 1, 9) * 6.28 });
  });
  track.animators.push((dt, t) => {
    for (const e of entries) {
      const a = e.phase + t * (e.speed ?? 0.02);
      const r = e.orbit ?? 30;
      e.m.position.set(e.x + Math.cos(a) * r, e.y + Math.sin(t * 0.45 + e.phase) * 1.8, e.z + Math.sin(a * 0.9) * r * 0.6);
      e.m.rotation.y = a * 0.7;
    }
  });
}


// ------------------------------------------------------------------------------------------------ bunting
/**
 * Strings of triangular pennants along one or both sides of a stretch of road, hung between poles.
 * @param {{ s0:number, s1:number, sides?:number[], offset?:number, height?:number, colors?:string[] }} o
 */
export function buildBunting(track, ctx, o) {
  const cl = track.cl, mats = ctx.mats, L = cl.length;
  const sides = o.sides ?? [-1, 1];
  const height = o.height ?? 5.2;
  const cols = (o.colors ?? ['#ff3b30', '#ffd21f', '#1a8cff', '#2fd36a', '#ff3fa8', '#ffffff']).map((c) => new THREE.Color(c));
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.24, 0, 0, 0.24, 0, 0, 0, -0.62, 0], 3));
  tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  tri.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  const flags = new InstanceSet(track, tri, mats.flag({ vertical: true }), { chunk: 200, cull: 260, name: 'bunting' });
  const poles = new GeoBuilder();
  const poleCol = rgb('#e6e6ee');
  const span = 22;
  const len = (((o.s1 - o.s0) % L) + L) % L;
  const n = Math.max(1, Math.floor(len / span));
  for (const side of sides) {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const s = o.s0 + (k / n) * len;
      const c = cl.sample(s, {});
      const idx = cl.indexAt(s);
      const w = side < 0 ? cl.wallL[idx] : cl.wallR[idx];
      const lat = side * ((Number.isNaN(w) ? c.hw + 4.5 : Math.abs(w)) + (o.offset ?? 1.2));
      const x = c.px + c.rx * lat, z = c.pz + c.rz * lat, y = track.groundY(x, z);
      pts.push({ x, y, z, top: y + height, tx: c.tx, tz: c.tz });
      poles.box(x, y + height / 2, z, 0.22, height, 0.22, poleCol, 0);
      poles.box(x, y + height + 0.1, z, 0.34, 0.2, 0.34, rgb('#c0392b'), 0);
    }
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const m = Math.max(2, Math.floor(d / 1.05));
      const yaw = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      for (let j = 1; j < m; j++) {
        const t = j / m;
        const sag = Math.sin(t * Math.PI) * 0.9;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.top + (b.top - a.top) * t - sag;
        flags.add(x, y, z, yaw, 1, 1, 1, cols[(k * m + j) % cols.length]);
      }
    }
  }
  flags.build();
  if (poles.count) track.addMesh(poles.build(), mats.vcolor({ roughness: 0.5 }), { cast: true, name: 'bunting-poles' });
}


// ------------------------------------------------------------------------------------------------ birds
/**
 * Flocks of flapping birds circling over given centres.
 * @param {{ count:number, x:number, z:number, radius:number, alt:number, scale?:number, color?:string, speed?:number }[]} flocks
 */
export function buildBirds(track, ctx, flocks) {
  const mats = ctx.mats;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.55, -0.13, 0, -0.32, 0.13, 0, -0.32,
    -0.1, 0, 0.25, -1.05, 0, -0.12, -0.1, 0, -0.3,
    0.1, 0, 0.25, 0.1, 0, -0.3, 1.05, 0, -0.12,
  ], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(27).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const mat = mats.bird({ color: 0xffffff });
  const total = flocks.reduce((n, f) => n + f.count, 0);
  const im = new THREE.InstancedMesh(g, mat, total);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false;
  im.name = 'birds';
  const col = new THREE.Color();
  const items = [];
  let n = 0;
  flocks.forEach((f, fi) => {
    for (let i = 0; i < f.count; i++) {
      col.set(f.color ?? '#20242e').multiplyScalar(0.8 + hash2(i, fi, 6) * 0.5);
      im.setColorAt(n, col);
      items.push({ f, a0: hash2(i, fi, 1) * 6.283, r: f.radius * (0.7 + hash2(i, fi, 2) * 0.6), y: f.alt * (0.85 + hash2(i, fi, 3) * 0.3), sp: (f.speed ?? 0.09) * (0.85 + hash2(i, fi, 4) * 0.3) * (hash2(i, fi, 5) > 0.5 ? 1 : 1), sc: (f.scale ?? 1) * (0.8 + hash2(i, fi, 7) * 0.5), ph: hash2(i, fi, 8) * 6.28 });
      n++;
    }
  });
  im.instanceColor.needsUpdate = true;
  track.group.add(im);
  const q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), p = new THREE.Vector3(), s3 = new THREE.Vector3(), e = new THREE.Euler();
  track.animators.push((dt, t) => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const a = it.a0 + t * it.sp;
      p.set(it.f.x + Math.cos(a) * it.r, it.y + Math.sin(t * 0.6 + it.ph) * 2.2, it.f.z + Math.sin(a) * it.r * 0.8);
      e.set(0.12, -a + Math.PI, Math.cos(t * 0.5 + it.ph) * 0.35, 'YXZ');
      q.setFromEuler(e);
      m4.compose(p, q, s3.setScalar(it.sc));
      im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  });
}
