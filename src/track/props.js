/**
 * Procedural low-poly prop geometry (vertex coloured, merged per prop). Everything is built in code.
 * All builders return non-indexed BufferGeometry with position / normal / color / uv.
 * OWNER: World agent.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { displaceGeo, flatShade, merge, mat4, simplify } from './geo.js';
import { hash2, vnoise } from './noise.js';

const c3 = (hex) => new THREE.Color(hex);

/** Vertical gradient vertex colours with a little noise. */
export function grad(geo, bottom, top, y0, y1, jitter = 0.06, seed = 0) {
  const b = c3(bottom), t = c3(top);
  const p = geo.attributes.position;
  const arr = new Float32Array(p.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const k = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0 || 1)));
    col.copy(b).lerp(t, k);
    const n = 1 + jitter * vnoise(p.getX(i) * 1.7 + seed, p.getZ(i) * 1.7 - seed, seed + 5);
    arr[i * 3] = col.r * n; arr[i * 3 + 1] = col.g * n; arr[i * 3 + 2] = col.b * n;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function solid(geo, hex) {
  const c = c3(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

const T = (geo, x = 0, y = 0, z = 0) => geo.translate(x, y, z);

/** A puffy noise-displaced blob. */
function blob(r, detail, seed, cLow, cHigh, sy = 0.92, amp = 0.09) {
  let g = new THREE.IcosahedronGeometry(r, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4); // weld so that recomputed normals are smooth (round canopies)
  g.scale(1, sy, 1);
  displaceGeo(g, r * amp, 1.1 / r, seed);
  g.computeVertexNormals();
  return grad(g, cLow, cHigh, -r * sy, r * sy, 0.07, seed);
}

// ------------------------------------------------------------------------------------------------ trees
/** Round cartoon tree (canopy of 4–5 blobs on a trunk). ~450 tris. */
export function roundTree(seed = 1, pal = {}, lod = false) {
  const low = pal.low ?? '#1b6a16', high = pal.high ?? '#78c82a';
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.2, 0.36, 2.8, lod ? 5 : 7, 1);
  T(trunk, 0, 1.4, 0);
  grad(trunk, '#3b2412', '#6a4626', 0, 2.8, 0.1, seed);
  parts.push(trunk);
  const blobs = lod
    ? [[0, 4.3, 0, 2.5], [0.9, 3.4, 0.6, 1.6]]
    : [[0, 4.2, 0, 2.15, 2], [1.3, 3.55, 0.5, 1.5, 1], [-1.2, 3.75, -0.55, 1.45, 1], [0.1, 5.3, -0.15, 1.35, 1], [-0.35, 3.4, 1.35, 1.15, 1]];
  blobs.forEach(([x, y, z, r, det], i) => {
    const b = blob(r, lod ? 0 : det, seed * 11 + i, low, high, 0.92, lod ? 0.09 : 0.06);
    T(b, x, y, z);
    parts.push(b);
  });
  return merge(parts.map(simplify));
}

/** Slim poplar / cypress tree. */
export function poplar(seed = 1, pal = {}) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1.8, 6);
  T(trunk, 0, 0.9, 0);
  grad(trunk, '#3b2412', '#5a3b20', 0, 1.8, 0.1, seed);
  parts.push(trunk);
  const g = new THREE.SphereGeometry(1.1, 10, 8);
  g.scale(1, 3.4, 1);
  displaceGeo(g, 0.13, 1.4, seed);
  T(g, 0, 4.5, 0);
  grad(g, pal.low ?? '#1d5e1c', pal.high ?? '#6cb82c', 1.0, 8.2, 0.08, seed);
  parts.push(g);
  return merge(parts.map(simplify));
}

/** Snow-capped pine: 4 tiers with white snow caps. */
export function pine(seed = 1, pal = {}, lod = false) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 1.6, 6);
  T(trunk, 0, 0.8, 0);
  grad(trunk, '#3a2616', '#5a3d24', 0, 1.6, 0.08, seed);
  parts.push(trunk);
  const tiers = lod ? 3 : 4;
  for (let i = 0; i < tiers; i++) {
    const k = lod ? 1.33 : 1;
    const r = 2.25 - i * 0.42 * k, h = 2.5 - i * 0.2 * k, y = 1.5 + i * 1.5 * k;
    const cone = new THREE.ConeGeometry(r, h, lod ? 6 : 9, 1);
    displaceGeo(cone, 0.06, 1.5, seed + i);
    T(cone, 0, y + h / 2, 0);
    grad(cone, pal.low ?? '#0f4a3a', pal.high ?? '#2c8060', y, y + h, 0.08, seed + i);
    parts.push(cone);
    // snow layer: slightly smaller cone hugging the upper part
    const sn = new THREE.ConeGeometry(r * 0.86, h * 0.72, lod ? 6 : 9, 1);
    displaceGeo(sn, 0.09, 1.3, seed + i + 9);
    T(sn, 0, y + h * 0.66, 0);
    grad(sn, '#dfeaf7', '#ffffff', y + h * 0.3, y + h, 0.04, seed);
    parts.push(sn);
  }
  return merge(parts.map(simplify));
}

/** Bare-ish dead / small tree for canyon & glacier (twisted trunk + a couple of blobs). */
export function scrubTree(seed = 1, pal = {}) {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.22, 2.0, 5);
  trunk.rotateZ(0.12);
  T(trunk, 0, 1.0, 0);
  grad(trunk, '#4a3320', '#6b4a2c', 0, 2, 0.1, seed);
  parts.push(trunk);
  for (let i = 0; i < 3; i++) {
    const b = blob(0.9 - i * 0.12, 1, seed + i, pal.low ?? '#4e6a2a', pal.high ?? '#8aa848');
    T(b, (i - 1) * 0.75, 2.4 + i * 0.35 * (i % 2 ? 1 : -0.4), (i % 2) * 0.4);
    parts.push(b);
  }
  return merge(parts.map(simplify));
}

// ------------------------------------------------------------------------------------------------ bushes, rocks, flowers
export function bush(seed = 1, pal = {}) {
  const parts = [];
  const spec = [[0, 0.62, 0, 0.85], [0.75, 0.5, 0.2, 0.6], [-0.7, 0.5, -0.15, 0.62], [0.1, 0.5, 0.7, 0.55]];
  spec.forEach(([x, y, z, r], i) => {
    const b = blob(r, 1, seed * 5 + i, pal.low ?? '#1e6a1a', pal.high ?? '#6cbc2a', 0.85);
    T(b, x, y, z);
    parts.push(b);
  });
  if (pal.flowers) {
    const cols = pal.flowers;
    for (let i = 0; i < 9; i++) {
      const a = hash2(i, seed, 3) * Math.PI * 2, h = 0.5 + hash2(i, seed, 4) * 0.55;
      const f = new THREE.IcosahedronGeometry(0.13, 0);
      solid(f, cols[i % cols.length]);
      T(f, Math.cos(a) * 0.8, h + 0.35, Math.sin(a) * 0.8);
      parts.push(f);
    }
  }
  return merge(parts.map(simplify));
}

export function rock(seed = 1, pal = {}) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  g.scale(1.15, 0.8, 1);
  displaceGeo(g, 0.24, 1.3, seed);
  const f = flatShade(g);
  grad(f, pal.low ?? '#5d5a58', pal.high ?? '#a29b92', -0.7, 0.8, 0.12, seed);
  T(f, 0, 0.5, 0);
  return simplify(f);
}

/** Cluster of small flowers: stems + coloured petals, ~80 tris. */
export function flowers(petal = '#ffffff', seed = 1, count = 6) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = hash2(i, seed, 8) * Math.PI * 2, r = 0.12 + hash2(i, seed, 9) * 0.55;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.38 + hash2(i, seed, 10) * 0.3;
    const stem = new THREE.CylinderGeometry(0.016, 0.02, h, 3, 1, true);
    T(stem, x, h / 2, z);
    solid(stem, '#2f7a24');
    parts.push(stem);
    const head = new THREE.ConeGeometry(0.16, 0.07, 5, 1);
    head.rotateX(Math.PI);
    T(head, x, h + 0.03, z);
    solid(head, petal);
    parts.push(head);
  }
  return merge(parts.map(simplify));
}

/** Reeds + cattails for lake shores. */
export function reeds(seed = 1) {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const a = hash2(i, seed, 1) * Math.PI * 2, r = hash2(i, seed, 2) * 0.5;
    const h = 1.3 + hash2(i, seed, 3) * 1.0;
    const st = new THREE.CylinderGeometry(0.018, 0.035, h, 4);
    st.rotateZ((hash2(i, seed, 4) - 0.5) * 0.25);
    T(st, Math.cos(a) * r, h / 2, Math.sin(a) * r);
    grad(st, '#3f7a26', '#8ab848', 0, h, 0.05, seed);
    parts.push(st);
    if (i % 3 === 0) {
      const tip = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 5);
      T(tip, Math.cos(a) * r, h * 0.86, Math.sin(a) * r);
      solid(tip, '#5a3a1e');
      parts.push(tip);
    }
  }
  return merge(parts.map(simplify));
}

export function hayBale(seed = 1) {
  const g = new THREE.CylinderGeometry(0.85, 0.85, 1.25, 12, 1);
  g.rotateZ(Math.PI / 2);
  grad(g, '#c99c3a', '#e6c25a', -0.85, 0.85, 0.08, seed);
  T(g, 0, 0.85, 0);
  const rings = new THREE.TorusGeometry(0.85, 0.03, 4, 14);
  rings.rotateY(Math.PI / 2);
  solid(rings, '#8a6a20');
  T(rings, 0.32, 0.85, 0);
  const r2 = rings.clone();
  T(r2, -0.64, 0, 0);
  return merge([g, rings, r2].map(simplify));
}

// ------------------------------------------------------------------------------------------------ desert
export function saguaro(seed = 1) {
  const parts = [];
  const green = '#2f6a2a', dark = '#1f4d1f';
  const ridge = (g, y0, y1) => {
    const p = g.attributes.position, n = p.count;
    const a = new Float32Array(n * 3);
    const c1 = c3(green), c2 = c3(dark);
    for (let i = 0; i < n; i++) {
      const ang = Math.atan2(p.getZ(i), p.getX(i));
      const k = 0.5 + 0.5 * Math.cos(ang * 7);
      const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0 || 1)));
      const col = c1.clone().lerp(c2, (1 - k) * 0.55).multiplyScalar(0.85 + 0.25 * t);
      a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const trunk = new THREE.CylinderGeometry(0.42, 0.5, 5.2, 14, 3);
  T(trunk, 0, 2.6, 0);
  parts.push(ridge(trunk, 0, 5.2));
  const top = new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  T(top, 0, 5.2, 0);
  parts.push(ridge(top, 4.9, 5.7));
  const arm = (dir, y, len) => {
    const h = new THREE.CylinderGeometry(0.27, 0.3, 1.5, 10, 1);
    h.rotateZ(Math.PI / 2);
    T(h, dir * 0.95, y, 0);
    parts.push(ridge(h, y - 0.3, y + 0.3));
    const v = new THREE.CylinderGeometry(0.26, 0.28, len, 10, 2);
    T(v, dir * 1.65, y + len / 2, 0);
    parts.push(ridge(v, y, y + len));
    const t = new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    T(t, dir * 1.65, y + len, 0);
    parts.push(ridge(t, y + len - 0.2, y + len + 0.3));
    const e = new THREE.SphereGeometry(0.28, 8, 6);
    T(e, dir * 1.6, y, 0);
    parts.push(ridge(e, y - 0.3, y + 0.3));
  };
  arm(1, 2.4, 1.9);
  arm(-1, 3.2, 1.5);
  return merge(parts.map(simplify));
}

export function barrelCactus(seed = 1) {
  const g = new THREE.SphereGeometry(0.62, 12, 8);
  g.scale(1, 0.9, 1);
  const p = g.attributes.position;
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const ang = Math.atan2(p.getZ(i), p.getX(i));
    const k = 0.75 + 0.25 * Math.cos(ang * 9);
    a[i * 3] = 0.16 * k; a[i * 3 + 1] = 0.38 * k; a[i * 3 + 2] = 0.13 * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  T(g, 0, 0.5, 0);
  const fl = new THREE.IcosahedronGeometry(0.16, 0);
  solid(fl, '#ff5fa0');
  T(fl, 0, 1.05, 0);
  return merge([g, fl].map(simplify));
}

export function desertShrub(seed = 1) {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + hash2(i, seed, 2);
    const b = blob(0.5 + hash2(i, seed, 3) * 0.3, 1, seed + i, '#4a5a25', '#93a04e', 0.75);
    T(b, Math.cos(a) * 0.65, 0.38, Math.sin(a) * 0.65);
    parts.push(b);
  }
  const c = blob(0.75, 1, seed, '#586b2c', '#a6b35a', 0.8);
  T(c, 0, 0.5, 0);
  parts.push(c);
  return merge(parts.map(simplify));
}

export function tumbleweed(seed = 1) {
  const g = new THREE.IcosahedronGeometry(0.75, 1);
  displaceGeo(g, 0.22, 2.2, seed);
  const f = flatShade(g);
  grad(f, '#5e4726', '#b58e4e', -0.8, 0.8, 0.2, seed);
  return simplify(f);
}

export function cowSkull(seed = 1) {
  const parts = [];
  const bone = '#efe6d2', shade = '#cbbea2';
  const skull = new THREE.BoxGeometry(0.55, 0.42, 0.85, 2, 2, 2);
  displaceGeo(skull, 0.03, 4, seed);
  grad(skull, shade, bone, -0.2, 0.25, 0.04, seed);
  T(skull, 0, 0.35, 0);
  parts.push(skull);
  const snout = new THREE.BoxGeometry(0.34, 0.3, 0.4);
  solid(snout, bone);
  T(snout, 0, 0.3, 0.55);
  parts.push(snout);
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.1, 6, 5);
    solid(eye, '#241a12');
    T(eye, s * 0.24, 0.45, 0.2);
    parts.push(eye);
    const horn = new THREE.TorusGeometry(0.55, 0.07, 5, 10, Math.PI * 0.7);
    horn.rotateY(Math.PI / 2);
    horn.rotateZ(s > 0 ? 0.35 : Math.PI - 0.35);
    solid(horn, bone);
    T(horn, s * 0.3, 0.5, -0.1);
    parts.push(horn);
    const nostril = new THREE.SphereGeometry(0.05, 5, 4);
    solid(nostril, '#241a12');
    T(nostril, s * 0.09, 0.32, 0.76);
    parts.push(nostril);
  }
  return merge(parts.map(simplify));
}

// ------------------------------------------------------------------------------------------------ snow & ice
export function snowman(seed = 1) {
  const parts = [];
  const mk = (r, y, sy = 1) => {
    const g = new THREE.SphereGeometry(r, 14, 10);
    g.scale(1, sy, 1);
    grad(g, '#c6d6ec', '#ffffff', -r, r, 0.03, seed);
    T(g, 0, y, 0);
    parts.push(g);
  };
  mk(1.05, 1.0);
  mk(0.78, 2.35);
  mk(0.56, 3.35);
  const nose = new THREE.ConeGeometry(0.09, 0.5, 6);
  nose.rotateX(Math.PI / 2);
  solid(nose, '#ff7a1a');
  T(nose, 0, 3.38, 0.7);
  parts.push(nose);
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.07, 6, 5);
    solid(eye, '#101018');
    T(eye, s * 0.2, 3.5, 0.5);
    parts.push(eye);
    const arm = new THREE.CylinderGeometry(0.035, 0.05, 1.4, 5);
    arm.rotateZ(s * 1.1);
    solid(arm, '#5a3a1e');
    T(arm, s * 1.15, 2.55, 0);
    parts.push(arm);
  }
  for (let i = 0; i < 3; i++) {
    const b = new THREE.SphereGeometry(0.07, 6, 5);
    solid(b, '#101018');
    T(b, 0, 2.6 - i * 0.32, 0.74 - i * 0.06);
    parts.push(b);
  }
  const brim = new THREE.CylinderGeometry(0.62, 0.62, 0.06, 12);
  solid(brim, '#242c4a');
  T(brim, 0, 3.85, 0);
  parts.push(brim);
  const hat = new THREE.CylinderGeometry(0.36, 0.4, 0.5, 12);
  solid(hat, '#242c4a');
  T(hat, 0, 4.1, 0);
  parts.push(hat);
  const band = new THREE.CylinderGeometry(0.405, 0.405, 0.1, 12);
  solid(band, '#e0304a');
  T(band, 0, 3.95, 0);
  parts.push(band);
  // scarf
  const sc = new THREE.TorusGeometry(0.5, 0.11, 6, 14);
  sc.rotateX(Math.PI / 2);
  solid(sc, '#e0304a');
  T(sc, 0, 2.9, 0);
  parts.push(sc);
  return merge(parts.map(simplify));
}

/** Cluster of ice crystals (hex prisms with pointed tops). For emissive cave decor. */
export function crystals(seed = 1, color = '#7fe8ff') {
  const parts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash2(i, seed, 1) * 0.6;
    const tilt = 0.15 + hash2(i, seed, 2) * 0.45;
    const h = 1.4 + hash2(i, seed, 3) * 2.4;
    const r = 0.22 + hash2(i, seed, 4) * 0.22;
    const g = new THREE.CylinderGeometry(r * 0.75, r, h, 6, 1);
    const tip = new THREE.ConeGeometry(r * 0.75, r * 2.4, 6);
    T(tip, 0, h / 2 + r * 1.2, 0);
    const shaft = merge([simplify(g), simplify(tip)]);
    grad(shaft, '#3ba7e8', color, -h / 2, h / 2 + r * 2.4, 0.05, seed + i);
    shaft.translate(0, h / 2, 0);
    shaft.rotateZ(Math.cos(a) * tilt);
    shaft.rotateX(Math.sin(a) * tilt);
    parts.push(shaft);
  }
  return merge(parts.map(simplify));
}

/** Small log cabin with gabled snow roof. windows are a separate emissive geometry. */
export function cabin(seed = 1) {
  const parts = [], windows = [];
  const w = 6.2, d = 5.0, h = 3.0;
  const walls = new THREE.BoxGeometry(w, h, d);
  grad(walls, '#5e3d22', '#9a6a3a', -h / 2, h / 2, 0.1, seed);
  T(walls, 0, h / 2, 0);
  parts.push(walls);
  // log stripes
  for (let i = 0; i < 6; i++) {
    const s = new THREE.BoxGeometry(w + 0.12, 0.09, d + 0.12);
    solid(s, '#3f2814');
    T(s, 0, 0.35 + i * 0.5, 0);
    parts.push(s);
  }
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w / 2 - 0.5, 0);
  roofShape.lineTo(0, 2.0);
  roofShape.lineTo(w / 2 + 0.5, 0);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.9, bevelEnabled: false });
  roofGeo.translate(0, h, -(d + 0.9) / 2);
  solid(roofGeo, '#8a3a26');
  parts.push(roofGeo);
  const snow = new THREE.ExtrudeGeometry(roofShape, { depth: d + 1.0, bevelEnabled: false });
  snow.scale(0.985, 0.55, 1);
  snow.translate(0, h + 0.95, -(d + 1.0) / 2);
  solid(snow, '#f4f9ff');
  parts.push(snow);
  const chim = new THREE.BoxGeometry(0.7, 1.8, 0.7);
  solid(chim, '#6b5a52');
  T(chim, 1.6, h + 1.4, -0.8);
  parts.push(chim);
  const cap = new THREE.BoxGeometry(0.85, 0.2, 0.85);
  solid(cap, '#f4f9ff');
  T(cap, 1.6, h + 2.35, -0.8);
  parts.push(cap);
  const door = new THREE.BoxGeometry(1.0, 1.9, 0.12);
  solid(door, '#3c2410');
  T(door, -1.3, 0.95, d / 2 + 0.03);
  parts.push(door);
  for (const x of [1.2, -1.3 + 2.6]) {
    const f = new THREE.BoxGeometry(1.25, 1.0, 0.14);
    solid(f, '#2a1808');
    T(f, x + (x === 1.2 ? 0.5 : 0.6), 1.7, d / 2 + 0.02);
    parts.push(f);
    const wgl = new THREE.BoxGeometry(1.0, 0.78, 0.1);
    solid(wgl, '#ffd88a');
    T(wgl, x + (x === 1.2 ? 0.5 : 0.6), 1.7, d / 2 + 0.11);
    windows.push(wgl);
  }
  const side = new THREE.BoxGeometry(0.1, 0.78, 1.0);
  solid(side, '#ffd88a');
  T(side, w / 2 + 0.03, 1.7, 0);
  windows.push(side);
  return { body: merge(parts.map(simplify)), windows: merge(windows.map(simplify)) };
}

// ------------------------------------------------------------------------------------------------ misc landmarks
/** Windmill: static body + a separate rotor geometry (rotate about +Z at hub height). */
export function windmill(seed = 1) {
  const parts = [];
  const h = 11;
  const tower = new THREE.CylinderGeometry(2.0, 3.3, h, 12, 3);
  grad(tower, '#e8dcc0', '#fbf5e6', 0, h, 0.03, seed);
  T(tower, 0, h / 2, 0);
  parts.push(tower);
  const base = new THREE.CylinderGeometry(3.5, 3.7, 1.6, 12);
  grad(base, '#7a6c60', '#a69688', 0, 1.6, 0.1, seed);
  T(base, 0, 0.8, 0);
  parts.push(base);
  const band = new THREE.CylinderGeometry(2.7, 2.75, 0.5, 12);
  solid(band, '#c0483a');
  T(band, 0, 4.6, 0);
  parts.push(band);
  const roof = new THREE.ConeGeometry(2.55, 3.4, 12);
  grad(roof, '#8f2f22', '#c9503a', h, h + 3.4, 0.04, seed);
  T(roof, 0, h + 1.7, 0);
  parts.push(roof);
  const door = new THREE.BoxGeometry(1.3, 2.1, 0.4);
  solid(door, '#4a2c16');
  T(door, 0, 1.6, 3.2);
  parts.push(door);
  for (const [y, s] of [[6.5, 1], [8.6, 1]]) {
    const win = new THREE.BoxGeometry(0.85, 1.1, 0.3);
    solid(win, '#2e3a55');
    T(win, 0, y, 2.35 * s);
    parts.push(win);
    const trim = new THREE.BoxGeometry(1.1, 1.35, 0.2);
    solid(trim, '#c0483a');
    T(trim, 0, y, 2.3 * s);
    parts.push(trim);
  }
  const hub = new THREE.CylinderGeometry(0.55, 0.7, 1.4, 10);
  hub.rotateX(Math.PI / 2);
  solid(hub, '#6b4a2c');
  T(hub, 0, h - 0.6, 2.7);
  parts.push(hub);
  const body = merge(parts.map(simplify));
  // rotor: 4 blades (spar + sail panels)
  const blades = [];
  for (let k = 0; k < 4; k++) {
    const arm = [];
    const spar = new THREE.BoxGeometry(0.35, 9.6, 0.22);
    solid(spar, '#6b4a2c');
    T(spar, 0, 5.2, 0);
    arm.push(spar);
    for (let j = 0; j < 6; j++) {
      const slat = new THREE.BoxGeometry(2.0, 0.55, 0.08);
      solid(slat, j % 2 ? '#f6efe0' : '#e9dfc8');
      T(slat, 1.25, 2.6 + j * 1.15, 0.15);
      arm.push(slat);
    }
    const frame = new THREE.BoxGeometry(0.12, 6.6, 0.1);
    solid(frame, '#7a5a38');
    T(frame, 2.3, 5.6, 0.17);
    arm.push(frame);
    const g = merge(arm.map(simplify));
    g.rotateZ((k * Math.PI) / 2);
    blades.push(g);
  }
  const rotor = merge(blades.map(simplify));
  const cap = new THREE.SphereGeometry(0.62, 10, 8);
  solid(cap, '#c0483a');
  cap.translate(0, 0, 0.5);
  const rotor2 = merge([rotor, simplify(cap)]);
  return { body, rotor: rotor2, hubY: h - 0.6, hubZ: 3.5 };
}

/** Hot-air balloon: teardrop envelope with coloured gores + basket. */
export function balloon(colors = ['#ff3b3b', '#ffd23f', '#ffffff'], seed = 1) {
  const pts = [];
  const R = 4.4;
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const y = t * 11.5;
    // teardrop profile
    const r = R * Math.sin(Math.pow(t, 0.72) * Math.PI) * (0.95 + 0.15 * (1 - t)) + (t < 0.06 ? 0.55 * (1 - t / 0.06) : 0);
    pts.push(new THREE.Vector2(Math.max(0.05, r), y));
  }
  const env = new THREE.LatheGeometry(pts, 24);
  const p = env.attributes.position;
  const cols = colors.map(c3);
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const ang = Math.atan2(p.getZ(i), p.getX(i));
    const gore = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 12);
    const c = cols[gore % cols.length];
    const k = 0.78 + 0.22 * Math.min(1, p.getY(i) / 8);
    a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k;
  }
  env.setAttribute('color', new THREE.BufferAttribute(a, 3));
  env.translate(0, 3.0, 0);
  const parts = [env];
  const basket = new THREE.BoxGeometry(1.7, 1.2, 1.7);
  grad(basket, '#5a3a1a', '#9a6a34', -0.6, 0.6, 0.08, seed);
  T(basket, 0, 0.6, 0);
  parts.push(basket);
  const burner = new THREE.CylinderGeometry(0.2, 0.3, 0.5, 6);
  solid(burner, '#777');
  T(burner, 0, 2.2, 0);
  parts.push(burner);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    const rope = new THREE.CylinderGeometry(0.02, 0.02, 2.1, 3);
    solid(rope, '#d8c9a0');
    rope.rotateZ(-x * 0.06);
    T(rope, x * 0.85, 2.0, z * 0.85);
    parts.push(rope);
  }
  const m = merge(parts.map(simplify));
  return m;
}

/** Simple pole with an angled signboard: for chevron turn signs. */
export function signBoard() {
  const parts = [];
  const post = new THREE.CylinderGeometry(0.08, 0.1, 2.6, 6);
  solid(post, '#dedede');
  T(post, 0, 1.3, 0);
  parts.push(post);
  const board = new THREE.BoxGeometry(2.6, 1.5, 0.1);
  solid(board, '#ffffff');
  T(board, 0, 2.9, 0);
  parts.push(board);
  return { post: merge([simplify(post)]), board: simplify(board) };
}

/** Clump of grass blades (thin double-sided triangles), gradient coloured. */
export function grassTuft(seed = 1, pal = {}) {
  const pos = [], col = [], nor = [];
  const lo = c3(pal.low ?? '#1f5a12'), hi = c3(pal.high ?? '#8fd93a');
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = hash2(i, seed, 1) * Math.PI * 2, r = hash2(i, seed, 2) * 0.22;
    const h = 0.38 + hash2(i, seed, 3) * 0.42, w = 0.05 + hash2(i, seed, 4) * 0.04;
    const lean = (hash2(i, seed, 5) - 0.3) * 0.35;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const dx = Math.cos(a + 1.57) * w, dz = Math.sin(a + 1.57) * w;
    const tx = cx + Math.cos(a) * lean, tz = cz + Math.sin(a) * lean;
    pos.push(cx - dx, 0, cz - dz, cx + dx, 0, cz + dz, tx, h, tz);
    col.push(lo.r, lo.g, lo.b, lo.r, lo.g, lo.b, hi.r, hi.g, hi.b);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
  return g;
}

/** Small farm: red barn, silo, farmhouse (one merged, vertex-coloured geometry, origin at ground level). */
export function farm(seed = 1) {
  const parts = [];
  const box = (w, h, d, x, y, z, hex, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    solid(g, hex);
    g.rotateY(ry);
    T(g, x, y, z);
    parts.push(g);
  };
  const prism = (w, h, d, x, y, z, hex) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0); sh.lineTo(0, h); sh.lineTo(w / 2, 0); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false });
    solid(g, hex);
    T(g, x, y, z - d / 2);
    parts.push(g);
  };
  // barn
  box(9, 5.2, 13, 0, 2.6, 0, '#b3281f');
  prism(9.8, 3.6, 13.8, 0, 5.2, 0, '#7f1b16');
  box(3.6, 3.7, 0.25, 0, 1.85, 6.6, '#f6efe0');
  box(0.4, 3.8, 0.28, -1.5, 1.9, 6.62, '#7f1b16'); box(0.4, 3.8, 0.28, 1.5, 1.9, 6.62, '#7f1b16');
  box(3.8, 0.35, 0.3, 0, 3.6, 6.64, '#f6efe0');
  box(1.2, 1.0, 0.3, 0, 7.0, 6.9, '#f6efe0');
  // silo
  const silo = new THREE.CylinderGeometry(1.9, 1.9, 11, 14);
  grad(silo, '#c9cfd6', '#eef1f5', 0, 11, 0.04, seed);
  T(silo, 8.2, 5.5, -2.5);
  parts.push(silo);
  const cap = new THREE.SphereGeometry(1.95, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  solid(cap, '#b34a3a');
  T(cap, 8.2, 11, -2.5);
  parts.push(cap);
  // farmhouse
  box(6.4, 3.4, 5.6, -13, 1.7, 3, '#f4ecd8');
  prism(7.2, 2.6, 6.2, -13, 3.4, 3, '#8a3a2a');
  box(1.0, 1.9, 0.2, -13.9, 0.95, 5.85, '#5a3a22');
  box(1.2, 1.0, 0.2, -11.5, 1.9, 5.85, '#6aa6d6');
  box(0.9, 1.6, 0.9, -11.2, 5.6, 2.2, '#8a5a4a');
  // fence posts round the yard
  for (let i = 0; i < 9; i++) box(0.16, 1.1, 0.16, -6 + i * 1.6, 0.55, 12, '#f2f2ee');
  box(13.6, 0.12, 0.1, 0, 0.9, 12, '#ffffff'); box(13.6, 0.12, 0.1, 0, 0.5, 12, '#ffffff');
  return merge(parts.map(simplify));
}

/** Mat helper re-export for callers that need transforms. */
export { mat4 };
