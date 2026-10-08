/**
 * Procedural geometry toolkit for the KART BLITZ visuals.
 *
 * Everything in a kart (chassis, driver, wheels...) is authored with `PartBuilder`: each primitive is placed,
 * painted (per-vertex colour + surface params) and optionally tagged with a GPU "flex" channel (ears, tails,
 * antennae, arms...) and then merged into ONE BufferGeometry. See material.js for the shader that reads
 *   color   vec3  (linear) albedo
 *   aSurf   vec4  roughness, metalness, emissive amount, clearcoat
 *   aFlex   vec3  weight (0..1), channel id, wave phase
 *   aPivot  vec3  rotation pivot for the flex channel
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const TAU = Math.PI * 2;

/** Special flex channels (see material.js). 0..11 are rotation channels. */
export const CH = { BLINK: 12, BEACON: 13, BRAKE: 14 };

/** Global tessellation multiplier applied by the helpers (quality: low 0.7, medium/high 1). */
let DETAIL = 1;
export function setDetail(f) {
  DETAIL = f;
}
export const getDetail = () => DETAIL;
const seg = (n, min = 4) => Math.max(min, Math.round(n * DETAIL));

const _c = new THREE.Color();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _fp = new THREE.Vector3();
const _fn = new THREE.Vector3();

/** Atlas UV of the plain white swatch (set by atlas.js layout; kept here to avoid import cycles). */
export const WHITE_UV = [0.02, 0.98];

export const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a, b, t) => a + (b - a) * t;

/** Convert hex / css string / THREE.Color / [r,g,b] (linear) into a THREE.Color (linear working space). */
export function toColor(c, out = new THREE.Color()) {
  if (c && c.isColor) return out.copy(c);
  if (Array.isArray(c)) return out.setRGB(c[0], c[1], c[2]);
  return out.set(c);
}

/** Return `hex` lightened (+) or darkened (-) by `amt` in HSL lightness, optionally shifting hue / saturation. */
export function shade(hex, amt = 0, dh = 0, ds = 0) {
  const c = toColor(hex);
  const hsl = {};
  c.getHSL(hsl);
  return new THREE.Color().setHSL((hsl.h + dh + 1) % 1, clamp01(hsl.s + ds), clamp01(hsl.l + amt));
}

/** Mix two colours (returns new Color). */
export function mixColor(a, b, t) {
  return toColor(a).clone().lerp(toColor(b), t);
}

// ---------------------------------------------------------------------------------------------------------------
// Primitive geometry factories (all return fresh BufferGeometry, not yet merged/painted)
// ---------------------------------------------------------------------------------------------------------------
export const G = {
  /** Ellipsoid. */
  ell(rx, ry = rx, rz = rx, ws = 24, hs = 16, thetaLen = Math.PI, phiStart = 0, phiLen = TAU) {
    const g = new THREE.SphereGeometry(1, seg(ws), seg(hs, 3), phiStart, phiLen, 0, thetaLen);
    g.scale(rx, ry, rz);
    return g;
  },
  /** Plain 12-triangle box (sharp edges) for tiny details. */
  cube(w, h, d) {
    return new THREE.BoxGeometry(w, h, d);
  },
  /** Rounded box (w,h,d) with bevel radius r. */
  box(w, h, d, r = 0.03, s = 3) {
    return new RoundedBoxGeometry(w, h, d, seg(s, 1), Math.min(r, Math.min(w, h, d) / 2 - 1e-4));
  },
  /** Cylinder along Y. */
  cyl(rt, rb, h, rs = 16, hs = 1, open = false) {
    return new THREE.CylinderGeometry(rt, rb, h, seg(rs, 5), hs, open);
  },
  cone(r, h, rs = 16) {
    return new THREE.ConeGeometry(r, h, seg(rs, 5), 1);
  },
  /** Capsule along Y: total length = len + 2r. */
  capsule(r, len, cs = 6, rs = 14) {
    return new THREE.CapsuleGeometry(r, len, seg(cs, 2), seg(rs, 6));
  },
  torus(R, r, tubular = 24, radial = 8, arc = TAU) {
    return new THREE.TorusGeometry(R, r, seg(radial, 4), seg(tubular, 6), arc);
  },
  plane(w, h) {
    return new THREE.PlaneGeometry(w, h);
  },
  /** Lathe from [radius, y] pairs. */
  lathe(pts, rs = 20) {
    return new THREE.LatheGeometry(
      pts.map((p) => new THREE.Vector2(p[0], p[1])),
      seg(rs, 6),
    );
  },
  /** Extrude a 2D shape along +Z with a rounded bevel. */
  extrude(shape, depth, bevel = 0.02, bevelSeg = 2, curveSeg = 8) {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: seg(bevelSeg, 1),
      curveSegments: seg(curveSeg, 3),
    });
    g.translate(0, 0, -depth / 2);
    return g;
  },
};

/** 2D shapes. */
export const S2 = {
  star(points = 5, outer = 1, inner = 0.45, round = 0) {
    const s = new THREE.Shape();
    const n = points * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.PI / 2;
      const r = i % 2 === 0 ? outer : inner;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  },
  roundRect(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    r = Math.min(r, w / 2, h / 2);
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  },
  polygon(pts) {
    const s = new THREE.Shape();
    pts.forEach((p, i) => (i === 0 ? s.moveTo(p[0], p[1]) : s.lineTo(p[0], p[1])));
    s.closePath();
    return s;
  },
};

/**
 * Sweep a (super)elliptic cross-section along a polyline path (rotation-minimising frames).
 * stations: [{ p:[x,y,z], rx, ry, e = 2, roll = 0 }]  — rx along the frame's "side" axis, ry along its "up" axis.
 * opts: { ring = 16, up = [0,1,0], capStart = 0, capEnd = 0, capRings = 4 } (cap* = dome length in metres)
 */
export function sweep(stations, opts = {}) {
  const ring = seg(opts.ring ?? 16, 6);
  const up = new THREE.Vector3(...(opts.up ?? [0, 1, 0]));
  const capRings = seg(opts.capRings ?? 4, 2);
  let st = stations.map((s) => ({ p: new THREE.Vector3(...s.p), rx: s.rx, ry: s.ry ?? s.rx, e: s.e ?? 2, roll: s.roll ?? 0 }));

  // tangents
  const n0 = st.length;
  const tang = st.map((_, i) => {
    const a = st[Math.max(0, i - 1)].p, b = st[Math.min(n0 - 1, i + 1)].p;
    return new THREE.Vector3().subVectors(b, a).normalize();
  });
  // dome caps expand the station list
  const build = (list, tangs, dir, len) => {
    // dir = -1 => before first, +1 => after last
    const base = dir < 0 ? list[0] : list[list.length - 1];
    const T = dir < 0 ? tangs[0] : tangs[tangs.length - 1];
    const extra = [];
    for (let k = 0; k <= capRings; k++) {
      const phi = (Math.PI / 2) * (k / (capRings + 1));
      const sc = Math.sin(phi);
      extra.push({
        p: base.p.clone().addScaledVector(T, dir * len * Math.cos(phi)),
        rx: base.rx * sc,
        ry: base.ry * sc,
        e: base.e,
        roll: base.roll,
        pole: k === 0,
        T,
      });
    }
    return dir < 0 ? extra : extra.reverse();
  };
  let frames = tang;
  if (opts.capStart > 0) {
    const ex = build(st, tang, -1, opts.capStart);
    st = [...ex, ...st];
    frames = [...ex.map((x) => x.T), ...frames];
  }
  if (opts.capEnd > 0) {
    const ex = build(st, frames, +1, opts.capEnd);
    st = [...st, ...ex];
    frames = [...frames, ...ex.map((x) => x.T)];
  }

  // rotation minimising frames: A = "side", B = "up"
  const n = st.length;
  const A = [], B = [];
  {
    let a = new THREE.Vector3().crossVectors(up, frames[0]);
    if (a.lengthSq() < 1e-6) a.set(1, 0, 0);
    a.normalize();
    for (let i = 0; i < n; i++) {
      const T = frames[i];
      a = a.clone().addScaledVector(T, -a.dot(T)).normalize();
      A.push(a);
      B.push(new THREE.Vector3().crossVectors(T, a).normalize());
    }
  }

  const pos = [], uv = [], idx = [];
  const rowStart = [], poleRow = [];
  const R1 = ring + 1; // seam vertex duplicated so uv.u can run 0..1
  for (let i = 0; i < n; i++) {
    const s = st[i];
    rowStart.push(pos.length / 3);
    if (s.pole || (s.rx < 1e-5 && s.ry < 1e-5)) {
      pos.push(s.p.x, s.p.y, s.p.z);
      uv.push(0.5, i / (n - 1));
      poleRow.push(true);
      continue;
    }
    poleRow.push(false);
    const cr = Math.cos(s.roll), sr = Math.sin(s.roll);
    for (let j = 0; j <= ring; j++) {
      const a = ((j % ring) / ring) * TAU;
      const c = Math.cos(a), sn = Math.sin(a);
      const ex = 2 / s.e;
      const x0 = s.rx * Math.sign(c) * Math.pow(Math.abs(c), ex);
      const y0 = s.ry * Math.sign(sn) * Math.pow(Math.abs(sn), ex);
      const x = x0 * cr - y0 * sr, y = x0 * sr + y0 * cr;
      pos.push(
        s.p.x + A[i].x * x + B[i].x * y,
        s.p.y + A[i].y * x + B[i].y * y,
        s.p.z + A[i].z * x + B[i].z * y,
      );
      uv.push(j / ring, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const p0 = poleRow[i], p1 = poleRow[i + 1];
    const r0 = rowStart[i], r1 = rowStart[i + 1];
    if (p0 && p1) continue;
    for (let j = 0; j < ring; j++) {
      const j1 = j + 1;
      if (p0) idx.push(r0, r1 + j1, r1 + j);
      else if (p1) idx.push(r0 + j, r0 + j1, r1);
      else {
        idx.push(r0 + j, r0 + j1, r1 + j1);
        idx.push(r0 + j, r1 + j1, r1 + j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // average normals across the duplicated uv seam so shading stays smooth
  {
    const nor = g.attributes.normal;
    for (let i = 0; i < n; i++) {
      if (poleRow[i]) continue;
      const a = rowStart[i], b = rowStart[i] + ring;
      const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b);
      const l = Math.hypot(x, y, z) || 1;
      nor.setXYZ(a, x / l, y / l, z / l);
      nor.setXYZ(b, x / l, y / l, z / l);
    }
  }
  // NOTE: winding is outward by construction (frame is right-handed: side x up = tangent).
  return g;
}

export function flipWinding(g, flipNormals = false) {
  const idx = g.index;
  for (let i = 0; i < idx.count; i += 3) {
    const b = idx.getX(i + 1), c = idx.getX(i + 2);
    idx.setX(i + 1, c);
    idx.setX(i + 2, b);
  }
  idx.needsUpdate = true;
  if (flipNormals) {
    const nor = g.attributes.normal;
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  }
}

/** Convenience: tube (constant / profiled radius) along a Catmull-Rom path through `pts`. */
export function tube(pts, radius = 0.03, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(
    pts.map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal',
  );
  const segs = seg(opts.segments ?? Math.max(6, pts.length * 4), 4);
  const stations = [];
  const radFn = typeof radius === 'function' ? radius : () => radius;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const r = radFn(t);
    const ry = opts.flat ? r * opts.flat : r;
    stations.push({ p: [p.x, p.y, p.z], rx: r, ry, e: opts.e ?? 2, roll: opts.roll ?? 0 });
  }
  return sweep(stations, {
    ring: opts.ring ?? 8,
    up: opts.up ?? [0, 1, 0],
    capStart: opts.capStart ?? (typeof radius === 'function' ? 0 : radFn(0)),
    capEnd: opts.capEnd ?? (typeof radius === 'function' ? 0 : radFn(1)),
    capRings: opts.capRings ?? 2,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// PartBuilder
// ---------------------------------------------------------------------------------------------------------------
function ensureIndexed(g) {
  if (!g.index) {
    const n = g.attributes.position.count;
    const arr = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    g.setIndex(new THREE.BufferAttribute(arr, 1));
  }
}

/**
 * Collects primitives, paints them and merges them into one geometry.
 * add(geometry, opts):
 *   p:[x,y,z]  r:[rx,ry,rz] (euler XYZ radians)  s:number|[sx,sy,sz]
 *   color | colorFn(p, n) -> THREE.Color (kart/head-local final position & normal)
 *   rough, metal, emis, clear      surface params (defaults 0.55, 0, 0, 0)
 *   ao   baked underside darkening 0..1 (default 0.3)
 *   uv:[u,v] constant atlas uv (default white swatch) | uvRegion:[u0,v0,u1,v1] remap the source uvs into an atlas region
 *   flex:{ ch, pivot:[x,y,z], dir:[x,y,z], len, pow=1, phase=1 }  GPU bend about `pivot`; weight grows along `dir`
 *   blink:[px,py,pz] (eye squash pivot) | beacon:true | brake:true   special flex channels
 */
export class PartBuilder {
  constructor() {
    this.geos = [];
    this.tris = 0;
    /** [{ name, tris }] — per-part triangle log for budgeting (see report()). */
    this.log = [];
  }

  /** Console table of triangle counts per named part (dev aid). */
  report(title = 'parts') {
    const rows = this.log.map((r) => `${String(r.tris).padStart(5)}  ${r.name}`);
    console.log(`[tris] ${title} total ${this.tris}\n` + rows.join('\n'));
  }

  _prepare(src, o) {
    const g = src.clone();
    g.userData.srcType = src.type;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    ensureIndexed(g);
    const hasT = o.p || o.r || o.s || o.q;
    if (hasT) {
      _t.set(...(o.p ?? [0, 0, 0]));
      if (o.q) _q.copy(o.q);
      else _q.setFromEuler(_e.set(...(o.r ?? [0, 0, 0]), o.ro ?? 'XYZ'));
      const s = o.s == null ? [1, 1, 1] : typeof o.s === 'number' ? [o.s, o.s, o.s] : o.s;
      _s.set(...s);
      _m.compose(_t, _q, _s);
      g.applyMatrix4(_m);
      if (_m.determinant() < 0) flipWinding(g);
    }
    return g;
  }

  /** Add a primitive. */
  add(src, o = {}) {
    const g = this._prepare(src, o);
    this._commit(g, o, false);
    return this;
  }

  /** Add a primitive and its X-mirrored twin (mirror plane x = 0). o.flexR overrides the mirrored flex channel. */
  addSym(src, o = {}) {
    const g = this._prepare(src, o);
    const g2 = g.clone();
    this._commit(g, o, false);
    const pos = g2.attributes.position, nor = g2.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, -pos.getX(i));
      nor.setX(i, -nor.getX(i));
    }
    flipWinding(g2);
    this._commit(g2, o, true);
    return this;
  }

  _commit(g, o, mirrored) {
    const pos = g.attributes.position, nor = g.attributes.normal, uvA = g.attributes.uv;
    const n = pos.count;
    const col = new Float32Array(n * 3), surf = new Float32Array(n * 4), flex = new Float32Array(n * 3), piv = new Float32Array(n * 3);
    const base = o.color != null ? toColor(o.color, new THREE.Color()) : new THREE.Color(1, 1, 1);
    const rough = o.rough ?? 0.55, metal = o.metal ?? 0, emis = o.emis ?? 0, clear = o.clear ?? 0;
    const ao = o.ao ?? 0.3;
    const sgn = mirrored ? -1 : 1;
    let fpx = 0, fpy = 0, fpz = 0, fdx = 0, fdy = 1, fdz = 0, flen = 0, fpow = 1, fph = 1, fch = -1;
    if (o.flex) {
      const f = o.flex;
      fch = mirrored && f.chR != null ? f.chR : f.ch;
      fpx = f.pivot[0] * sgn; fpy = f.pivot[1]; fpz = f.pivot[2];
      fdx = (f.dir?.[0] ?? 0) * sgn; fdy = f.dir?.[1] ?? 1; fdz = f.dir?.[2] ?? 0;
      const dl = Math.hypot(fdx, fdy, fdz) || 1;
      fdx /= dl; fdy /= dl; fdz /= dl;
      flen = f.len ?? 0;
      fpow = f.pow ?? 1;
      fph = f.phase ?? 1;
    }
    const uvc = o.uv ?? WHITE_UV;
    for (let i = 0; i < n; i++) {
      _p.fromBufferAttribute(pos, i);
      _n.fromBufferAttribute(nor, i);
      const fnp = mirrored ? _fp.set(-_p.x, _p.y, _p.z) : _p;
      const fnn = mirrored ? _fn.set(-_n.x, _n.y, _n.z) : _n;
      let r, gg, b;
      if (o.colorFn) {
        const c = o.colorFn(fnp, fnn, i) ?? base;
        r = c.r; gg = c.g; b = c.b;
      } else {
        r = base.r; gg = base.g; b = base.b;
      }
      if (ao > 0) {
        const k = 1 - ao * (1 - smooth(-0.9, 0.45, _n.y));
        r *= k; gg *= k; b *= k;
      }
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      let ro = rough, me = metal, em = emis, cl = clear;
      if (o.surfFn) {
        const s = o.surfFn(fnp, fnn, i);
        ro = s.rough ?? ro; me = s.metal ?? me; em = s.emis ?? em; cl = s.clear ?? cl;
      }
      surf[i * 4] = ro; surf[i * 4 + 1] = me; surf[i * 4 + 2] = em; surf[i * 4 + 3] = cl;
      if (o.blink) {
        flex[i * 3] = 1; flex[i * 3 + 1] = CH.BLINK; flex[i * 3 + 2] = 0;
        piv[i * 3] = o.blink[0] * sgn; piv[i * 3 + 1] = o.blink[1]; piv[i * 3 + 2] = o.blink[2];
      } else if (o.beacon) {
        flex[i * 3] = 1; flex[i * 3 + 1] = CH.BEACON;
      } else if (o.brake) {
        flex[i * 3] = 1; flex[i * 3 + 1] = CH.BRAKE;
      } else if (fch >= 0) {
        const t = flen > 0 ? ((_p.x - fpx) * fdx + (_p.y - fpy) * fdy + (_p.z - fpz) * fdz) / flen : 1;
        const w = Math.pow(clamp01(t), fpow);
        flex[i * 3] = w; flex[i * 3 + 1] = fch; flex[i * 3 + 2] = t * fph;
        piv[i * 3] = fpx; piv[i * 3 + 1] = fpy; piv[i * 3 + 2] = fpz;
      } else {
        flex[i * 3 + 1] = -1;
      }
    }
    if (o.uvRegion) {
      const [u0, v0, u1, v1] = o.uvRegion;
      for (let i = 0; i < n; i++) uvA.setXY(i, mix(u0, u1, uvA.getX(i)), mix(v0, v1, uvA.getY(i)));
    } else if (o.uvFn) {
      for (let i = 0; i < n; i++) {
        _p.fromBufferAttribute(pos, i);
        _n.fromBufferAttribute(nor, i);
        const fnp = mirrored ? _fp.set(-_p.x, _p.y, _p.z) : _p;
        const fnn = mirrored ? _fn.set(-_n.x, _n.y, _n.z) : _n;
        const r = o.uvFn(fnp, fnn, i);
        uvA.setXY(i, r[0], r[1]);
      }
    } else {
      for (let i = 0; i < n; i++) uvA.setXY(i, uvc[0], uvc[1]);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4));
    g.setAttribute('aFlex', new THREE.BufferAttribute(flex, 3));
    g.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
    this.tris += g.index.count / 3;
    this.log.push({ name: o.name ?? g.userData.srcType ?? '?', tris: g.index.count / 3 });
    this.geos.push(g);
  }

  /** Merge everything into one geometry (or null when empty). */
  build() {
    if (!this.geos.length) return null;
    const merged = mergeGeometries(this.geos, false);
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    return merged;
  }
}

/** Apply a per-vertex deformation to a geometry (in place); recompute normals afterwards if smooth. */
export function deform(g, fn, recomputeNormals = true) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    fn(_p);
    pos.setXYZ(i, _p.x, _p.y, _p.z);
  }
  pos.needsUpdate = true;
  if (recomputeNormals) g.computeVertexNormals();
  return g;
}

/** Colour helper: vertical (or axial) gradient colorFn. axis 'x'|'y'|'z'. */
export function gradientFn(cA, cB, axis, a, b, curve = 1) {
  const A = toColor(cA, new THREE.Color()), B = toColor(cB, new THREE.Color());
  const out = new THREE.Color();
  return (p) => {
    const t = Math.pow(clamp01((p[axis] - a) / (b - a)), curve);
    return out.copy(A).lerp(B, t);
  };
}

/** Colour helper: blend between a base colour and a second colour with an arbitrary 0..1 mask function. */
export function maskFn(cA, cB, mask) {
  const A = toColor(cA, new THREE.Color()), B = toColor(cB, new THREE.Color());
  const out = new THREE.Color();
  return (p, n) => out.copy(A).lerp(B, clamp01(mask(p, n)));
}

/** Deterministic tiny PRNG for builders. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Quaternion whose +Z axis is `normal` and +Y axis is (as close as possible to) `up`. Handy for decals. */
export function orient(normal, up = [0, 1, 0]) {
  const z = new THREE.Vector3(...normal).normalize();
  const u = new THREE.Vector3(...up);
  const x = new THREE.Vector3().crossVectors(u, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
