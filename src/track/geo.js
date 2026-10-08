/**
 * Geometry helpers: a fast triangle-soup builder, vertex-colour utilities, merge & displacement helpers.
 * OWNER: World agent.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { vnoise } from './noise.js';

/** Accumulates indexed geometry with position / normal / color / uv (+ optional float attributes). */
export class GeoBuilder {
  /** @param {Record<string, number>} [extra] extra attributes name → itemSize, e.g. { aRoadD: 1 } */
  constructor(extra = {}) {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
    this.extraSizes = extra;
    this.extra = {};
    for (const k of Object.keys(extra)) this.extra[k] = [];
    this.count = 0;
    this.defaultColor = [1, 1, 1];
  }

  /** Add a vertex; returns its index. c: [r,g,b] (defaults to white). extras: { name: number | number[] } */
  v(x, y, z, nx = 0, ny = 1, nz = 0, c = null, u = 0, v = 0, extras = null) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    const cc = c ?? this.defaultColor;
    this.col.push(cc[0], cc[1], cc[2]);
    this.uv.push(u, v);
    for (const k in this.extraSizes) {
      const val = extras?.[k];
      if (this.extraSizes[k] === 1) this.extra[k].push(val ?? 0);
      else for (let i = 0; i < this.extraSizes[k]; i++) this.extra[k].push(val?.[i] ?? 0);
    }
    return this.count++;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  /** Quad a,b,c,d (counter-clockwise seen from the front). */
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Append a flat-shaded oriented box (rotated about Y). */
  box(cx, cy, cz, sx, sy, sz, color, rotY = 0) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const N = (x, y, z) => [x * c + z * s, y, -x * s + z * c];
    const faces = [
      [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz], [1, 0, 0]],
      [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz], [-1, 0, 0]],
      [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [0, 1, 0]],
      [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [0, -1, 0]],
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1]],
      [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1]],
    ];
    for (const f of faces) {
      const n = N(...f[4]);
      const i0 = this.v(...P(...f[0]), n[0], n[1], n[2], color, 0, 0);
      const i1 = this.v(...P(...f[1]), n[0], n[1], n[2], color, 0, 1);
      const i2 = this.v(...P(...f[2]), n[0], n[1], n[2], color, 1, 1);
      const i3 = this.v(...P(...f[3]), n[0], n[1], n[2], color, 1, 0);
      this.quad(i0, i1, i2, i3);
    }
  }

  build(computeNormals = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    for (const k in this.extraSizes) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(this.extra[k]), this.extraSizes[k]));
    g.setIndex(this.count > 65535 ? new THREE.BufferAttribute(new Uint32Array(this.idx), 1) : new THREE.BufferAttribute(new Uint16Array(this.idx), 1));
    if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _c = new THREE.Color();
/** Convert '#rrggbb' | number | Color to a linear [r,g,b] array (vertex colours are linear). */
export function rgb(hex) {
  _c.set(hex);
  return [_c.r, _c.g, _c.b];
}

/** Set a uniform vertex colour on a geometry (linear). */
export function colorGeo(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** Multiply existing vertex colours by fn(x,y,z) → [r,g,b] or number. */
export function tintGeo(geo, fn) {
  const p = geo.attributes.position, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const k = fn(p.getX(i), p.getY(i), p.getZ(i));
    if (typeof k === 'number') c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
    else c.setXYZ(i, c.getX(i) * k[0], c.getY(i) * k[1], c.getZ(i) * k[2]);
  }
  return geo;
}

/** Noise displacement of every vertex (welded by position) — for rocks, canopies, snow drifts. */
export function displaceGeo(geo, amp, freq, seed = 0, yScale = 1) {
  const p = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let d = map.get(key);
    if (!d) {
      const nx = vnoise(x * freq + seed, y * freq + z * freq * 0.7, seed + 1);
      const ny = vnoise(y * freq + seed * 2.1, z * freq + x * freq * 0.6, seed + 2);
      const nz = vnoise(z * freq - seed, x * freq + y * freq * 0.5, seed + 3);
      d = [nx * amp, ny * amp * yScale, nz * amp];
      map.set(key, d);
    }
    p.setXYZ(i, x + d[0], y + d[1], z + d[2]);
  }
  return geo;
}

/** Non-indexed + flat normals (faceted low-poly look). */
export function flatShade(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

/** Bake a transform into a geometry (returns the same geometry). */
export function bake(geo, matrix) {
  geo.applyMatrix4(matrix);
  return geo;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
/** Matrix from position / euler rotation / scale numbers. */
export function mat4(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _p.set(px, py, pz);
  _q.setFromEuler(_e.set(rx, ry, rz));
  _s.set(sx, sy, sz);
  return _m.compose(_p, _q, _s).clone();
}

/** Merge geometries (all must expose the same attribute set); non-indexed everything for safety. */
export function merge(list) {
  const geos = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  // keep only shared attributes
  const keys = Object.keys(geos[0].attributes).filter((k) => geos.every((g) => g.attributes[k]));
  for (const g of geos) for (const k of Object.keys(g.attributes)) if (!keys.includes(k)) g.deleteAttribute(k);
  const out = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return out;
}

/** Ensure geometry has a color attribute (white) so merged sets are compatible. */
export function ensureColor(geo, hex = 0xffffff) {
  if (!geo.attributes.color) colorGeo(geo, hex);
  return geo;
}

/** Ensure uv exists (zeros). */
export function ensureUV(geo) {
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  return geo;
}

/** Strip index & keep position/normal/color/uv only. */
export function simplify(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
  ensureUV(g);
  ensureColor(g);
  return g;
}
