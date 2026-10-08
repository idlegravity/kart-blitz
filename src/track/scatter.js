/**
 * Instanced decoration: chunked InstancedMeshes (per-chunk frustum culling + distance cull) and helpers to
 * place props along the road / over the terrain with rules (distance from the road, slope, spacing).
 * OWNER: World agent.
 */
import * as THREE from 'three';
import { makeRng } from '../core/math.js';
import { smooth } from './noise.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

/** A set of instances of one geometry/material, split into spatial chunks. */
export class InstanceSet {
  /**
   * @param {Track} track
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @param {{ chunk?: number, cull?: number, cast?: boolean, receive?: boolean, name?: string, colors?: boolean }} opts
   */
  constructor(track, geometry, material, opts = {}) {
    this.track = track;
    this.geometry = geometry;
    this.material = material;
    this.opts = { chunk: 110, cull: Infinity, cast: false, receive: true, ...opts };
    this.items = [];
    this.meshes = [];
    this.count = 0;
    track.scatters.push(this);
  }

  /** Add an instance. rotations in radians. color: hex / Color / null. */
  add(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, color = null, rx = 0, rz = 0) {
    this.items.push(x, y, z, ry, sx, sy, sz, rx, rz, color);
    this.count++;
  }

  build() {
    const K = 10;
    const { chunk, cull, cast, receive, name } = this.opts;
    const groups = new Map();
    for (let i = 0; i < this.items.length; i += K) {
      const cx = Math.floor(this.items[i] / chunk), cz = Math.floor(this.items[i + 2] / chunk);
      const key = cx * 100003 + cz;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { cx, cz, idx: [] }));
      g.idx.push(i);
    }
    const anyColor = this.items.some((v, i) => i % K === 9 && v != null);
    for (const g of groups.values()) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, g.idx.length);
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      let sx = 0, sz = 0;
      g.idx.forEach((i, n) => {
        const it = this.items;
        _p.set(it[i], it[i + 1], it[i + 2]);
        _q.setFromEuler(_e.set(it[i + 7], it[i + 3], it[i + 8]));
        _s.set(it[i + 4], it[i + 5], it[i + 6]);
        mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
        if (anyColor) mesh.setColorAt(n, it[i + 9] != null ? _c.set(it[i + 9]) : _c.set(0xffffff));
        sx += it[i]; sz += it[i + 2];
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      mesh.name = name ?? 'instances';
      mesh.computeBoundingSphere();
      mesh.userData.center = new THREE.Vector3(sx / g.idx.length, 0, sz / g.idx.length);
      mesh.userData.radius = mesh.boundingSphere.radius;
      this.track.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.items = null;
    return this;
  }

  /** Distance-cull chunks around the focus. */
  update(focus) {
    if (!focus || this.opts.cull === Infinity) return;
    const cull = this.opts.cull;
    for (const m of this.meshes) {
      const c = m.userData.center;
      const d = Math.hypot(c.x - focus.x, c.z - focus.z) - m.userData.radius;
      m.visible = d < cull;
    }
  }

  dispose() {
    for (const m of this.meshes) m.dispose?.();
    this.meshes.length = 0;
  }
}

/** Minimum-distance rejection grid (2D). */
export class SpacingGrid {
  constructor(cell = 4) {
    this.cell = cell;
    this.map = new Map();
  }
  _key(cx, cz) {
    return cx * 73856093 ^ cz * 19349663;
  }
  /** true when no existing point lies within r. */
  free(x, z, r) {
    const c = this.cell, rr = Math.ceil(r / c);
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    for (let dz = -rr; dz <= rr; dz++) {
      for (let dx = -rr; dx <= rr; dx++) {
        const arr = this.map.get(this._key(cx + dx, cz + dz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i += 3) {
          const ex = arr[i] - x, ez = arr[i + 1] - z;
          const rad = Math.max(r, arr[i + 2]);
          if (ex * ex + ez * ez < rad * rad) return false;
        }
      }
    }
    return true;
  }
  add(x, z, r = 0) {
    const k = this._key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let arr = this.map.get(k);
    if (!arr) this.map.set(k, (arr = []));
    arr.push(x, z, r);
  }
}

/**
 * Placement helper bound to a built track (needs track.roadField + track.terrain).
 */
export class Placer {
  constructor(track, seed = 1) {
    this.track = track;
    this.cl = track.cl;
    this.rf = track.roadField;
    this.rng = makeRng(seed);
    this.P = { i0: 0, u: 0, s: 0, d: 0, l: 0, fx: 0, fz: 0, y: 0 };
    this.spacing = new SpacingGrid(5);
    this.excl = new SpacingGrid(8);
  }

  /** Keep decoration away from a point (radius r). */
  exclude(x, z, r) {
    this.excl.add(x, z, r);
  }

  /** Keep decoration away from a polyline [[x,z],...] (half-width r). */
  excludePath(pts, r, step = 5) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = 0; k <= n; k++) this.excl.add(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, r);
    }
  }

  blocked(x, z) {
    return !this.excl.free(x, z, 0.01);
  }

  /** Info about a plan position: distance beyond the ribbon edge (e), station, lateral, ground height. */
  info(x, z, out = {}) {
    const P = this.P;
    const has = this.rf ? this.rf.project(x, z, 220, P) : false;
    if (has) {
      const outer = P.l < 0 ? this.rf.lerpAt(this.cl.outerL, P) : this.rf.lerpAt(this.cl.outerR, P);
      out.e = P.d - outer;
      out.s = P.s;
      out.l = P.l;
      out.d = P.d;
      out.side = P.l < 0 ? -1 : 1;
    } else {
      out.e = Infinity; out.s = 0; out.l = 0; out.d = Infinity; out.side = 1;
    }
    out.y = this.track.groundY(x, z);
    return out;
  }

  slopeAt(x, z, out = null) {
    const t = this.track;
    if (!t.terrain) return 0;
    const o = out ?? { normal: new THREE.Vector3() };
    t.terrain.sample(x, z, o);
    return 1 - o.normal.y;
  }

  /**
   * Scatter `count` points along the road. opts: { edgeMin, edgeMax, sides: [-1,1], s0, s1, minGap, slopeMax,
   * filter(info), tries, group: SpacingGrid }
   * Calls fn(x, y, z, info, rnd) for each accepted point.
   */
  along(count, opts, fn) {
    const rng = this.rng, cl = this.cl, L = cl.length;
    const { edgeMin = 1, edgeMax = 20, minGap = 3, slopeMax = 0.5, tries = 40 } = opts;
    const sides = opts.sides ?? [-1, 1];
    const s0 = opts.s0 ?? 0, s1 = opts.s1 ?? L;
    const span = ((s1 - s0) % L + L) % L || L;
    const grid = opts.group ?? this.spacing;
    const inf = {};
    const nrm = { normal: new THREE.Vector3() };
    let placed = 0;
    for (let n = 0; n < count * tries && placed < count; n++) {
      const s = (s0 + rng() * span) % L;
      const side = sides[Math.floor(rng() * sides.length)];
      const c = cl.sample(s, this._tmp ?? (this._tmp = {}));
      const idx = Math.floor(s / cl.ds) % cl.N;
      const outer = side < 0 ? cl.outerL[idx] : cl.outerR[idx];
      const e = edgeMin + Math.pow(rng(), opts.bias ?? 1) * (edgeMax - edgeMin);
      const lat = side * (outer + e);
      const x = c.px + c.rx * lat, z = c.pz + c.rz * lat;
      this.info(x, z, inf);
      if (inf.e < edgeMin - 0.5) continue; // too close to (another part of) the road
      if (opts.maxE != null && inf.e > opts.maxE) continue;
      if (!grid.free(x, z, minGap)) continue;
      if (this.blocked(x, z)) continue;
      if (opts.avoidWater !== false && this.track.waterLevel != null && inf.y < this.track.waterLevel + 0.6) continue;
      if (slopeMax < 1 && this.slopeAt(x, z, nrm) > slopeMax) continue;
      if (opts.filter && !opts.filter(inf, x, z)) continue;
      grid.add(x, z, minGap);
      fn(x, inf.y, z, inf, rng, side);
      placed++;
    }
    return placed;
  }

  /** Scatter inside a rectangle / everywhere. opts: { bounds:{minX,maxX,minZ,maxZ}, edgeMin, minGap, slopeMax, filter } */
  area(count, opts, fn) {
    const rng = this.rng;
    const { bounds, edgeMin = 8, minGap = 4, slopeMax = 0.5, tries = 30 } = opts;
    const grid = opts.group ?? this.spacing;
    const inf = {};
    const nrm = { normal: new THREE.Vector3() };
    let placed = 0;
    for (let n = 0; n < count * tries && placed < count; n++) {
      const x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
      const z = bounds.minZ + rng() * (bounds.maxZ - bounds.minZ);
      this.info(x, z, inf);
      if (inf.e < edgeMin) continue;
      if (opts.minE != null && inf.e < opts.minE) continue;
      if (opts.maxE != null && inf.e > opts.maxE) continue;
      if (!grid.free(x, z, minGap)) continue;
      if (this.blocked(x, z)) continue;
      if (opts.avoidWater !== false && this.track.waterLevel != null && inf.y < this.track.waterLevel + 0.6) continue;
      if (slopeMax < 1 && this.slopeAt(x, z, nrm) > slopeMax) continue;
      if (opts.filter && !opts.filter(inf, x, z)) continue;
      grid.add(x, z, minGap);
      fn(x, inf.y, z, inf, rng);
      placed++;
    }
    return placed;
  }
}

export { smooth };


/** Soft round contact-shadow decals under props (they ground objects beyond the real shadow-map range). */
export class BlobShadows {
  constructor(track, ctx, opts = {}) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.42)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    ctx.mats.add(tex);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    const mat = ctx.mats.add(new THREE.MeshBasicMaterial({
      map: tex, color: opts.color ?? 0x0a1a05, transparent: true, opacity: opts.alpha ?? 0.3, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.set = new InstanceSet(track, geo, mat, { chunk: 320, cull: opts.cull ?? 260, cast: false, receive: false, name: 'blob-shadows' });
    this.set.opts.order = 1;
  }
  add(x, y, z, radius) {
    this.set.add(x, y + 0.06, z, 0, radius, 1, radius);
  }
  build() {
    this.set.build();
    for (const m of this.set.meshes) m.renderOrder = 1;
  }
}
