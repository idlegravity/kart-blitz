/**
 * itemGeometry.js — procedural geometry for every item that exists in the world.
 * OWNER: Gameplay agent.
 *
 * All item meshes are merged into ONE geometry with baked vertex colours (so an InstancedMesh with a single
 * glossy material draws every instance of an item type in one call). Model conventions: +Z is the item's
 * "forward" (travel) axis, origin at the item centre (banana: at ground level).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** Clone + bake a colour attribute + bring to the common attribute set (position, normal, uv, color). */
function prep(geo, color, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (color) {
    const c = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      c[i * 3] = _c.r;
      c[i * 3 + 1] = _c.g;
      c[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}

function merge(list) {
  const g = mergeGeometries(list, false);
  list.forEach((l) => l.dispose());
  g.computeBoundingSphere();
  return g;
}

const mat = (pos, rot, scl) => _m.compose(pos ?? _v.set(0, 0, 0), rot ?? _q.identity(), scl ?? _one).clone();
const P = (x, y, z) => new THREE.Vector3(x, y, z);
const R = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

/**
 * Parametric grid surface. fn(u, v, outVec3) gives the position; colorFn(u, v, outColor) the colour.
 * closedV wraps the v direction (tubes). Triangle winding gives outward normals for tubes swept as documented below.
 */
function parametric(nu, nv, closedV, fn, colorFn) {
  const pos = [], col = [], idx = [];
  const p = new THREE.Vector3(), c = new THREE.Color();
  const vs = closedV ? nv : nv + 1;
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j < vs; j++) {
      fn(i / nu, j / nv, p);
      colorFn(i / nu, j / nv, c);
      pos.push(p.x, p.y, p.z);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const j1 = closedV ? (j + 1) % nv : j + 1;
      const a = i * vs + j, b = (i + 1) * vs + j, cc = (i + 1) * vs + j1, d = i * vs + j1;
      idx.push(a, b, d, b, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ==================================================================================================
// Banana (a peeled banana lying on the road: cream fruit crescent + three cupped yellow peel petals)
// ==================================================================================================
export function buildBananaGeometry() {
  const parts = [];
  const RAD = 0.56, HALF = 0.8, T = 0.118, Y0 = 0.12;
  const fruit = new THREE.Color('#ffd94f'), ridge = new THREE.Color('#f0a92a'), tip = new THREE.Color('#3a2412'), stem = new THREE.Color('#6d6a26');
  const peelIn = new THREE.Color('#ffe14a'), peelMid = new THREE.Color('#ffc814'), peelTip = new THREE.Color('#cf8a08');

  // ---- crescent fruit, swept along an arc in the XZ plane ----
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(0, 1, 0);
  const body = parametric(
    30, 14, true,
    (u, v, out) => {
      const a = (u - 0.5) * 2 * HALF;
      const prof = Math.pow(Math.max(Math.sin(Math.PI * Math.pow(u, 0.92)), 0), 0.5);
      const r = T * prof * (1 + 0.07 * Math.cos(v * Math.PI * 2 * 5));
      e1.set(Math.sin(a), 0, Math.cos(a));
      const th = v * Math.PI * 2;
      out.set(RAD * Math.sin(a), Y0, RAD * Math.cos(a) - RAD).addScaledVector(e1, r * Math.cos(th)).addScaledVector(e2, r * Math.sin(th) * 0.95);
    },
    (u, v, out) => {
      const ridgeAmt = Math.max(0, Math.cos(v * Math.PI * 2 * 5)) ** 6 * 0.55;
      out.copy(fruit).lerp(ridge, ridgeAmt);
      if (u < 0.1) out.lerp(tip, 1 - u / 0.1);
      if (u > 0.9) out.lerp(stem, Math.min(1, (u - 0.9) / 0.07));
    }
  );
  parts.push(prep(body));
  const a1 = HALF;
  const pStem = P(RAD * Math.sin(a1), Y0, RAD * Math.cos(a1) - RAD);
  const pTip = P(-RAD * Math.sin(a1), Y0, RAD * Math.cos(a1) - RAD);
  parts.push(prep(new THREE.SphereGeometry(0.032, 10, 8), tip, mat(pTip)));
  const stemDir = P(Math.cos(a1), 0, -Math.sin(a1)); // tangent at the stem end (pointing away from the fruit)
  const stemQ = new THREE.Quaternion().setFromUnitVectors(P(0, 1, 0), stemDir);
  parts.push(prep(new THREE.CylinderGeometry(0.034, 0.05, 0.12, 8), stem, mat(pStem.clone().addScaledVector(stemDir, 0.04), stemQ)));

  // ---- three peel petals splayed around the stem end ----
  const hub = pStem.clone().addScaledVector(stemDir, 0.02);
  const fruitDir = stemDir.clone().negate();
  const base = Math.atan2(fruitDir.z, fruitDir.x);
  const L = 0.5, W = 0.115;
  [1.85, 3.3, 4.75].forEach((off) => {
    const ang = base + off;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const petal = parametric(
      10, 5, false,
      (u, v, o) => {
        const w = W * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.9) * (v * 2 - 1);
        const a = u < 0.5 ? 0.085 * (1 - u / 0.5) ** 2 : 0.075 * ((u - 0.5) / 0.5) ** 2;
        const cup = 0.035 * (v * 2 - 1) ** 2 * Math.min(1, u * 3.5);
        o.set(hub.x + dx * L * u - dz * w, 0.028 + a + cup + (u < 0.15 ? 0.05 * (1 - u / 0.15) : 0), hub.z + dz * L * u + dx * w);
      },
      (u, v, c) => {
        c.copy(peelIn).lerp(peelMid, Math.min(1, u * 2.2));
        if (u > 0.72) c.lerp(peelTip, (u - 0.72) / 0.28);
      }
    );
    parts.push(prep(petal));
  });
  const g = merge(parts);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
  g.scale(0.85, 0.85, 0.85); // ~0.85 m overall (brief: banana ~0.7 m)
  return g;
}

// ==================================================================================================
// Orbs (bouncer = green, seeker = red)
// ==================================================================================================
function orbBase(colorHex, radius) {
  const parts = [];
  const body = new THREE.SphereGeometry(radius, 36, 24);
  body.rotateX(Math.PI / 2); // poles along Z
  parts.push(prep(body, colorHex));
  // meridian band (a great circle through both poles) — spins visibly about the travel axis
  const band = new THREE.TorusGeometry(radius * 1.003, radius * 0.115, 10, 56);
  band.rotateY(Math.PI / 2);
  parts.push(prep(band, '#f4f7ff'));
  // second, thinner band at 90° for a beach-ball look
  const band2 = new THREE.TorusGeometry(radius * 1.001, radius * 0.05, 8, 56);
  band2.rotateY(Math.PI / 2);
  band2.rotateZ(Math.PI / 2);
  parts.push(prep(band2, '#f4f7ff'));
  return parts;
}

export function buildBouncerGeometry(radius = 0.45) {
  const parts = orbBase('#2fd05a', radius);
  // pole studs
  for (const s of [1, -1]) {
    parts.push(prep(new THREE.CylinderGeometry(radius * 0.26, radius * 0.3, radius * 0.16, 16), '#f4f7ff', mat(P(0, 0, s * radius * 0.99), R(Math.PI / 2, 0, 0))));
    parts.push(prep(new THREE.SphereGeometry(radius * 0.15, 12, 8), '#1c8a3a', mat(P(0, 0, s * radius * 1.06))));
  }
  return merge(parts);
}

export function buildSeekerGeometry(radius = 0.45) {
  const parts = orbBase('#ff3b3b', radius);
  // targeting lens on the nose: dark glass, white ring, red pupil, crosshair ticks
  const z = radius * 0.985;
  parts.push(prep(new THREE.CylinderGeometry(radius * 0.36, radius * 0.4, radius * 0.14, 24), '#f4f7ff', mat(P(0, 0, z), R(Math.PI / 2, 0, 0))));
  parts.push(prep(new THREE.CylinderGeometry(radius * 0.29, radius * 0.29, radius * 0.16, 24), '#1a1626', mat(P(0, 0, z + radius * 0.02), R(Math.PI / 2, 0, 0))));
  parts.push(prep(new THREE.SphereGeometry(radius * 0.13, 14, 10), '#ff5a5a', mat(P(0, 0, z + radius * 0.09))));
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    parts.push(prep(new THREE.BoxGeometry(radius * 0.07, radius * 0.2, radius * 0.05), '#f4f7ff', mat(P(Math.sin(a) * radius * 0.5, Math.cos(a) * radius * 0.5, z + radius * 0.06), R(0, 0, -a))));
  }
  // tail fins
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    const fin = new THREE.ConeGeometry(radius * 0.22, radius * 0.75, 4, 1);
    // cone points +Y; lay it along -Z and tilt outward
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - 0.35, 0, 0));
    const qa = new THREE.Quaternion().setFromAxisAngle(P(0, 0, 1), a);
    const m = new THREE.Matrix4().compose(P(0, 0, 0), qa.multiply(q), P(1, 0.35, 1));
    m.setPosition(Math.sin(a + Math.PI / 2) * radius * 0.5 * -1, Math.cos(a + Math.PI / 2) * radius * 0.5, -radius * 1.0);
    parts.push(prep(fin, '#f4f7ff', m));
  }
  return merge(parts);
}

// ==================================================================================================
// Bomb (glossy black ball, steel cap, fuse, red band, wind-up key)
// ==================================================================================================
export const BOMB_FUSE_TIP = new THREE.Vector3(0.24, 0.98, 0); // where the spark sits (bomb-local, y up)

export function buildBombGeometry(radius = 0.5) {
  const parts = [];
  const black = '#23232f', steel = '#9aa3b6';
  const body = new THREE.SphereGeometry(radius, 36, 24);
  parts.push(prep(body, black, mat(P(0, radius, 0))));
  // red equator band
  const band = new THREE.TorusGeometry(radius * 1.004, radius * 0.075, 10, 48);
  band.rotateX(Math.PI / 2);
  parts.push(prep(band, '#e5352b', mat(P(0, radius, 0))));
  // cap: collar + ring
  parts.push(prep(new THREE.CylinderGeometry(radius * 0.32, radius * 0.4, radius * 0.3, 20), steel, mat(P(0, radius * 2 - radius * 0.06, 0))));
  parts.push(prep(new THREE.TorusGeometry(radius * 0.33, radius * 0.06, 8, 20), '#c9d0df', mat(P(0, radius * 2 + radius * 0.1, 0), R(Math.PI / 2, 0, 0))));
  // fuse
  const yb = radius * 2;
  const curve = new THREE.CatmullRomCurve3([P(0, yb + 0.02, 0), P(0.005, yb + 0.17, 0), P(0.07, yb + 0.29, 0), P(0.19, yb + 0.35, 0), P(0.31, yb + 0.33, 0)]);
  const fuse = new THREE.TubeGeometry(curve, 18, 0.034, 6, false);
  parts.push(prep(fuse, '#d3ab6d'));
  BOMB_FUSE_TIP.copy(curve.getPoint(1));
  // wind-up key on the side
  parts.push(prep(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8), '#ffc928', mat(P(radius + 0.06, radius * 1.05, 0), R(0, 0, Math.PI / 2))));
  // butterfly key: two loops
  for (const sgn of [1, -1]) {
    const loop = new THREE.TorusGeometry(0.1, 0.034, 8, 20);
    loop.scale(1, 1.25, 1);
    loop.rotateY(Math.PI / 2);
    parts.push(prep(loop, '#ffc928', mat(P(radius + 0.2, radius * 1.05, sgn * 0.11))));
  }
  const g = merge(parts);
  g.translate(0, -radius, 0); // origin = sphere centre (so tumbling in the air looks right)
  BOMB_FUSE_TIP.y -= radius;
  return g;
}

// ==================================================================================================
// Comet: spiked core + two feathered wings (wings are separate so they can flap)
// ==================================================================================================
export function buildCometCoreGeometry(radius = 0.62) {
  const parts = [];
  const blue = new THREE.Color('#1b45d6'), pale = new THREE.Color('#dcecff');
  const core = new THREE.SphereGeometry(radius, 32, 22);
  const n = core.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = core.attributes.position.getY(i) / radius;
    _c.copy(blue).lerp(_c2.set('#4a86ff'), Math.max(0, y) * 0.5);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  core.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.push(prep(core));
  const NS = 14;
  const dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < NS; i++) {
    const y = 1 - ((i + 0.5) / NS) * 2, rr = Math.sqrt(1 - y * y), phi = i * 2.399963;
    dir.set(Math.cos(phi) * rr, y, Math.sin(phi) * rr);
    const h = 0.5 + (i % 3) * 0.06;
    const cone = new THREE.ConeGeometry(0.16, h, 12, 1);
    cone.translate(0, h / 2, 0);
    const cn = cone.attributes.position.count;
    const cc = new Float32Array(cn * 3);
    for (let j = 0; j < cn; j++) {
      const t = Math.min(1, Math.max(0, cone.attributes.position.getY(j) / h));
      _c.copy(blue).lerp(pale, t ** 1.4);
      cc[j * 3] = _c.r; cc[j * 3 + 1] = _c.g; cc[j * 3 + 2] = _c.b;
    }
    cone.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const m = new THREE.Matrix4().compose(dir.clone().multiplyScalar(radius * 0.9), q, _one);
    parts.push(prep(cone, null, m));
  }
  return merge(parts);
}

/** One wing (right side, extends along +X, feathers fan in the XY plane). Mirror with scale.x = -1. */
export function buildCometWingGeometry() {
  const parts = [];
  const feathers = [
    { ang: -0.55, len: 0.75, w: 0.17 },
    { ang: -0.22, len: 0.92, w: 0.2 },
    { ang: 0.12, len: 1.05, w: 0.22 },
    { ang: 0.46, len: 1.0, w: 0.21 },
    { ang: 0.82, len: 0.82, w: 0.19 },
    { ang: 1.16, len: 0.6, w: 0.15 },
  ];
  for (const f of feathers) {
    const shp = new THREE.Shape();
    shp.moveTo(0, 0);
    shp.bezierCurveTo(f.len * 0.2, f.w * 0.9, f.len * 0.7, f.w * 0.75, f.len, 0);
    shp.bezierCurveTo(f.len * 0.7, -f.w * 0.5, f.len * 0.25, -f.w * 0.45, 0, 0);
    const g = new THREE.ExtrudeGeometry(shp, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, curveSegments: 10 });
    g.translate(0, 0, -0.015);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, Math.max(0, g.attributes.position.getX(i) / f.len));
      _c.set('#f4fbff').lerp(_c2.set('#4f9dff'), t ** 1.1);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Matrix4().compose(P(0.42, 0.05, 0), new THREE.Quaternion().setFromAxisAngle(P(0, 0, 1), f.ang), _one);
    parts.push(prep(g, null, m));
  }
  return merge(parts);
}

// ==================================================================================================
// Item box (rounded cube) + inner gem
// ==================================================================================================
export function buildBoxGeometry(size = 1.5) {
  return new RoundedBoxGeometry(size, size, size, 3, size * 0.1);
}

export function buildBoxCoreGeometry(size = 1.5) {
  return new THREE.IcosahedronGeometry(size * 0.2, 1);
}

/** Face texture for the item box. Channels: R = "?" glyph, G = frame, B = soft glow around the glyph. */
export function buildBoxFaceTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  const qmark = (ctx, width) => {
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(128, 98, 42, Math.PI * 1.12, Math.PI * 2.12, false); // hook: left -> over the top -> right
    ctx.bezierCurveTo(159.6, 132.1, 128, 132, 128, 156); // S-curve down to the stem
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(128, 206, width * 0.5, 0, Math.PI * 2);
    ctx.fill();
  };
  // glow (blue channel)
  g.save();
  g.strokeStyle = g.fillStyle = 'rgb(0,0,255)';
  g.shadowColor = 'rgb(0,0,255)';
  g.shadowBlur = 26;
  qmark(g, 30);
  g.restore();
  // glyph (red channel)
  g.strokeStyle = g.fillStyle = 'rgb(255,0,0)';
  qmark(g, 26);
  // frame (green channel)
  g.strokeStyle = 'rgb(0,255,0)';
  g.lineWidth = 12;
  const r = 30, m = 12;
  g.beginPath();
  g.moveTo(m + r, m);
  g.arcTo(S - m, m, S - m, S - m, r);
  g.arcTo(S - m, S - m, m, S - m, r);
  g.arcTo(m, S - m, m, m, r);
  g.arcTo(m, m, S - m, m, r);
  g.closePath();
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}
