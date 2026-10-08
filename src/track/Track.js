/**
 * Track — data-driven generated racing circuit (see ARCHITECTURE.md §6.1).
 *
 * API additions beyond the contract (all optional for consumers):
 *   - TrackSample.ceiling: world y of overhead geometry (cave roof, rock arch, gantry, bridge deck above a lower
 *     road) or null under open sky. Surfaces: 'road' | 'offroad' (grass/sand/snow, also the shoulder) | 'boost' |
 *     'ramp' | 'ice' | 'void' (jump gap, water, off the neon deck).
 *   - itemBoxSlots[i].hover (1.3): suggested float height above the ground-contact position.
 *   - track.groundY(x, z): ribbon-aware ground height (for placing props). track.landmarks: named points of interest.
 *   - track.positions/tangents/rights/halfWidths/count/spacing: views of the centerline samples (as in the old stub).
 *   - startGrid[i].s/lateral, boostPads/ramps[i].height (ramp wedge height in metres), track.cl (Centerline).
 * The Centerline (samples every ~1 m) is the single source of truth: road/shoulder/curb/ramp meshes and
 * query() are all derived from it; ground outside the ribbon comes from the terrain grid, so the
 * query matches the rendered geometry.
 * OWNER: World agent.
 */
import * as THREE from 'three';
import { forwardToYaw } from '../core/math.js';
import { QUALITY } from '../core/constants.js';
import { Centerline, circDelta, inRange } from './centerline.js';
import { RoadField, Terrain } from './terrain.js';
import { MatLib } from './materials.js';
import { THEMES, sunVector } from './themes.js';
import { createSky, createEnvironment } from './sky.js';
import { buildRoad, curbHeight, CURB_W } from './roadmesh.js';
import { WORLDS } from './worlds/index.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fr = {};
const _y = new THREE.Vector3();

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Track {
  /**
   * @param {object} def track definition (defs/*.js merged with registry info)
   * @param {object|null} game Game (null for outline-only use)
   */
  constructor(def, game) {
    this.def = def;
    this.game = game;
    this.id = def.id;
    this.name = def.name;
    this.theme = def.theme;
    this.laps = def.laps ?? 3;
    this.startS = 0;
    this.cl = new Centerline(def);
    const cl = this.cl;
    this.length = cl.length;
    this.count = cl.N;
    this.spacing = cl.ds;
    this.themeDef = THEMES[def.theme] ?? THEMES.meadow;
    this.sunDirection = sunVector(this.themeDef.sun.azimuth, this.themeDef.sun.elevation, new THREE.Vector3());
    this.waterLevel = def.lake?.level ?? def.waterLevel ?? null;
    this.noGround = !!def.noGround;
    const b = cl.bounds();
    this.bounds = b;
    this.killY = (def.killY ?? b.minY - 30);
    this.group = new THREE.Group();
    this.group.name = `track:${this.id}`;
    this.terrain = null;
    this.colliders = [];
    this.scatters = [];
    this.animators = [];
    this.disposers = [];
    /** Named points of interest [{ type, position: Vector3, s? }] (debug / intro cameras). */
    this.landmarks = [];
    /** Overhead structures reported as TrackSample.ceiling: [{ s0, s1, fn(s, lateral, baseY) -> y | null }]. */
    this.ceilings = [];
    this.built = false;
    this._sunFocus = new THREE.Vector3();
    this._hasFocus = false;

    this.overlaps = this._detectOverlap();
    this._buildFeatureLists();
  }

  /** true when two distant stretches of road share the same plan-view position (over/under-pass). */
  _detectOverlap() {
    const cl = this.cl, N = cl.N;
    const minSep = Math.round(80 / cl.ds);
    this.hasAbove = new Uint8Array(N);
    let any = false;
    for (let i = 0; i < N; i += 2) {
      for (let j = i + minSep; j < N; j += 2) {
        const gap = Math.min(j - i, N - (j - i));
        if (gap < minSep) continue;
        const dx = cl.px[i] - cl.px[j], dz = cl.pz[i] - cl.pz[j];
        if (dx * dx + dz * dz < 26 * 26 && Math.abs(cl.py[i] - cl.py[j]) > 4) {
          any = true;
          const lo = cl.py[i] < cl.py[j] ? i : j;
          for (let k = -14; k <= 14; k++) this.hasAbove[(lo + k + N) % N] = 1;
        }
      }
    }
    return any;
  }

  /** Register an overhead structure: fn(s, lateral, baseY) returns the world y of its underside, or null. */
  addCeiling(s0, s1, fn) {
    this.ceilings.push({ s0, s1, fn });
  }

  /** Underside of a road section passing above (px,py,pz); NaN when none. */
  _ceilingAbove(px, py, pz, skipIdx) {
    const cl = this.cl, N = cl.N;
    const far = Math.round(50 / cl.ds);
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      const d = Math.abs(i - skipIdx);
      if (Math.min(d, N - d) < far) continue;
      const dx = px - cl.px[i], dz = pz - cl.pz[i];
      if (dx * dx + dz * dz > 900) continue;
      const l = dx * cl.rx[i] + dz * cl.rz[i];
      const along = dx * cl.hx[i] + dz * cl.hz[i];
      if (Math.abs(along) > 0.75 || Math.abs(l) > (l < 0 ? cl.outerL[i] : cl.outerR[i])) continue;
      if (cl.gap[i]) continue;
      const h = cl.py[i] - l * cl.tanB[i];
      if (h > py + 1.2 && h < best) best = h;
    }
    return best === Infinity ? NaN : best - (this.def.deckThickness ?? 2.7) - 0.1;
  }

  /**
   * Over/under-passes: find the highest road surface below (px,py,pz) belonging to a section other than the one
   * around sample `skipIdx`. Returns a sample index to re-query from, or -1.
   */
  _surfaceBelow(px, py, pz, skipIdx) {
    const cl = this.cl, N = cl.N;
    const far = Math.round(50 / cl.ds);
    let best = -1, bestH = -Infinity;
    for (let i = 0; i < N; i++) {
      const d = Math.abs(i - skipIdx);
      if (Math.min(d, N - d) < far) continue;
      const dx = px - cl.px[i], dz = pz - cl.pz[i];
      if (dx * dx + dz * dz > 900) continue;
      const l = dx * cl.rx[i] + dz * cl.rz[i];
      const along = dx * cl.hx[i] + dz * cl.hz[i];
      if (Math.abs(along) > 0.75 || Math.abs(l) > (l < 0 ? cl.outerL[i] : cl.outerR[i])) continue;
      if (cl.gap[i]) continue;
      const h = cl.py[i] - l * cl.tanB[i];
      if (h <= py + 0.6 && h > bestH) { bestH = h; best = i; }
    }
    return best;
  }

  // ------------------------------------------------------------------------------ static lists
  _buildFeatureLists() {
    const cl = this.cl, L = this.length;
    this.boostPads = cl.features.boost.map((p) => ({ s: p.s, lateral: p.lateral, length: p.length, width: p.width }));
    this.ramps = cl.features.ramps.map((r) => ({ s: r.s, lateral: r.lateral, length: r.length, width: r.width, launch: r.launch, height: r.height }));

    // start grid: 8 slots, 2-wide staggered rows behind the line, facing the track direction
    this.startGrid = [];
    this.gridSlots = [];
    const tmp = {};
    for (let k = 0; k < 8; k++) {
      const row = Math.floor(k / 2);
      const side = k % 2 === 0 ? -1 : 1; // slot 0 = pole on the left
      const s = L - 7.5 - row * 8 - (side > 0 ? 3.8 : 0);
      const lateral = side * 3.2;
      const c = cl.sample(s, tmp);
      const position = new THREE.Vector3(c.px + c.rx * lateral, c.py - lateral * c.tanB, c.pz + c.rz * lateral);
      const hx = c.tx, hz = c.tz;
      this.startGrid.push({ position, yaw: forwardToYaw(hx, hz), s: s % L, lateral });
      this.gridSlots.push({ s: s - L, lateral });
    }

    // item box rows: positions only (Gameplay renders boxes). Ground contact points on the road surface.
    this.itemBoxSlots = [];
    for (const row of this.def.itemRows ?? []) {
      const count = row.count ?? 5;
      const c = cl.sample(row.s, tmp);
      const span = c.hw - 2.8;
      for (let k = 0; k < count; k++) {
        const lateral = count === 1 ? 0 : -span + (k / (count - 1)) * span * 2;
        const cc = cl.sample(row.s, {});
        const position = new THREE.Vector3(cc.px + cc.rx * lateral, cc.py - lateral * cc.tanB, cc.pz + cc.rz * lateral);
        this.itemBoxSlots.push({ position, s: row.s, lateral, hover: 1.3 });
      }
    }

    // minimap
    const pts = [];
    for (let i = 0; i < cl.N; i += 4) pts.push([cl.px[i], cl.pz[i]]);
    this.minimap = { points: pts, bounds: { minX: this.bounds.minX, maxX: this.bounds.maxX, minZ: this.bounds.minZ, maxZ: this.bounds.maxZ } };
  }

  // Backwards-compatible views of the sample arrays (the stub exposed these).
  get positions() {
    if (!this._positions) {
      const cl = this.cl;
      this._positions = Array.from({ length: cl.N }, (_, i) => new THREE.Vector3(cl.px[i], cl.py[i], cl.pz[i]));
    }
    return this._positions;
  }
  get tangents() {
    if (!this._tangents) {
      const cl = this.cl;
      this._tangents = Array.from({ length: cl.N }, (_, i) => new THREE.Vector3(cl.tx[i], cl.ty[i], cl.tz[i]));
    }
    return this._tangents;
  }
  get rights() {
    if (!this._rights) {
      const cl = this.cl;
      this._rights = Array.from({ length: cl.N }, (_, i) => new THREE.Vector3(cl.rx[i], 0, cl.rz[i]));
    }
    return this._rights;
  }
  get halfWidths() {
    return this.cl.hw;
  }

  // ------------------------------------------------------------------------------ build
  build() {
    const game = this.game;
    const scene = game.scene;
    const quality = QUALITY[game.settings?.quality] ?? QUALITY.high;
    this.quality = quality;
    this.density = quality.decorDensity ?? 1;
    const th = this.themeDef;
    const cl = this.cl;
    const world = WORLDS[this.theme] ?? WORLDS.meadow;
    this.world = world;
    const mats = (this.mats = new MatLib());
    this.matTime = mats.time;

    // ---- atmosphere ----
    scene.background = new THREE.Color(th.fog.color);
    scene.fog = new THREE.Fog(th.fog.color, th.fog.near, th.fog.far);
    const sky = createSky(th.sky, this.sunDirection);
    this.sky = sky;
    this.group.add(sky.mesh);
    try {
      this.envRT = createEnvironment(game.renderer, th.sky, this.sunDirection);
      scene.environment = this.envRT.texture;
      scene.environmentIntensity = th.envIntensity ?? 1;
    } catch (e) {
      console.warn('[Track] environment map failed', e);
    }

    // ---- lights ----
    const hemi = new THREE.HemisphereLight(new THREE.Color(th.hemi.sky), new THREE.Color(th.hemi.ground), th.hemi.intensity);
    const sun = new THREE.DirectionalLight(new THREE.Color(th.sun.color), th.sun.intensity);
    sun.castShadow = true;
    const size = quality.shadowMapSize ?? 2048;
    sun.shadow.mapSize.set(size, size);
    this.shadowHalf = 60;
    const sc = sun.shadow.camera;
    sc.left = -this.shadowHalf; sc.right = this.shadowHalf; sc.top = this.shadowHalf; sc.bottom = -this.shadowHalf;
    sc.near = 5; sc.far = 340;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.06;
    sun.shadow.radius = 2.2;
    this.sun = sun;
    this.hemi = hemi;
    this.group.add(hemi, sun, sun.target);

    // ---- terrain ----
    this.roadField = new RoadField(cl, 16);
    const tOpts = world.terrain?.(this);
    const terrainMat = tOpts ? mats.terrain(this.theme) : null;
    this.terrainMat = terrainMat;
    if (tOpts) {
      this.terrain = new Terrain(cl, this.roadField, { def: this.def, ...tOpts });
      const g = this.terrain.buildGeometry();
      const mesh = new THREE.Mesh(g, terrainMat);
      mesh.receiveShadow = true;
      mesh.name = 'terrain';
      this.group.add(mesh);
    }

    // ---- road ----
    const roadStyle = world.road?.(this, mats) ?? {};
    const asphaltMat = mats.asphalt(th.asphalt.base, th.asphalt.speck, { roughness: th.asphalt.rough ?? 1, metalness: th.asphalt.metal ?? 0 });
    const shoulderMat = roadStyle.shoulderMat ?? terrainMat ?? mats.vcolor({ roughness: 0.9 });
    const parts = buildRoad(cl, mats, {
      asphaltMat, shoulderMat, gridSlots: this.gridSlots, ...roadStyle,
    });
    for (const p of parts) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.name = p.name;
      m.castShadow = !!p.cast;
      m.receiveShadow = !!p.receive;
      if (p.order != null) m.renderOrder = p.order;
      this.group.add(m);
    }

    // ---- theme world (walls, decor, landmarks) ----
    world.build?.(this, { mats, quality, density: this.density, scene });

    scene.add(this.group);
    this.built = true;
    this.update(0, null);
  }

  /** Add a mesh to the track group with shadow flags. */
  addMesh(geometry, material, opts = {}) {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = !!opts.cast;
    m.receiveShadow = opts.receive !== false;
    if (opts.name) m.name = opts.name;
    if (opts.order != null) m.renderOrder = opts.order;
    this.group.add(m);
    return m;
  }

  // ------------------------------------------------------------------------------ update
  update(dt, focus) {
    if (!this.built) return;
    const game = this.game;
    this.matTime.value += dt;
    this.sky.uniforms.uTime.value += dt;
    if (focus) {
      this._sunFocus.copy(focus);
      this._hasFocus = true;
    } else if (!this._hasFocus) {
      const c = game?.camera?.position;
      if (c) this._sunFocus.copy(c);
    }
    // shadow camera follows the focus, texel-snapped in light space to avoid shimmering
    const dir = this.sunDirection;
    const z = _v.copy(dir);
    const x = _v2.set(0, 1, 0).cross(z).normalize();
    const y = _y.crossVectors(z, x);
    const half = this.shadowHalf;
    const texel = (half * 2) / (this.sun.shadow.mapSize.x || 2048);
    // bias the shadow box ahead of the kart (along the track) so shadows are present where the camera looks
    const f = this._shFocus ?? (this._shFocus = new THREE.Vector3());
    f.copy(this._sunFocus);
    if (this._hasFocus) {
      this._shHint = this._nearest(f.x, f.y, f.z, this._shHint ?? -1);
      const ti = this._shHint;
      const cl = this.cl;
      f.x += cl.hx[ti] * 24;
      f.z += cl.hz[ti] * 24;
    }
    const fx = Math.round(f.dot(x) / texel) * texel;
    const fy = Math.round(f.dot(y) / texel) * texel;
    const fz = f.dot(z);
    const sx = x.x * fx + y.x * fy + z.x * fz, sy = x.y * fx + y.y * fy + z.y * fz, sz = x.z * fx + y.z * fy + z.z * fz;
    this.sun.target.position.set(sx, sy, sz);
    this.sun.position.set(sx + dir.x * 170, sy + dir.y * 170, sz + dir.z * 170);
    this.sun.target.updateMatrixWorld();
    // chunk culling / animators
    for (const s of this.scatters) s.update?.(this._sunFocus);
    for (const a of this.animators) a(dt, this.matTime.value, this._sunFocus);
  }

  // ------------------------------------------------------------------------------ dispose
  dispose() {
    const game = this.game;
    if (!game) return;
    const scene = game.scene;
    scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
      if (o.isInstancedMesh) o.dispose?.();
    });
    for (const s of this.scatters) s.dispose?.();
    for (const d of this.disposers) { try { d(); } catch (e) { console.warn(e); } }
    this.disposers.length = 0;
    this.mats?.dispose();
    this.envRT?.dispose();
    this.sun?.shadow?.map?.dispose?.();
    this.sky?.geometry?.dispose();
    this.sky?.material?.dispose();
    scene.fog = null;
    scene.background = null;
    scene.environment = null;
    scene.environmentIntensity = 1;
    this.built = false;
  }

  // ------------------------------------------------------------------------------ queries
  wrapS(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  deltaS(a, b) {
    return circDelta(a, b, this.length);
  }

  curvatureAt(s) {
    const cl = this.cl;
    const f = cl.fIndex(s);
    const i0 = Math.floor(f) % cl.N, i1 = (i0 + 1) % cl.N, u = f - Math.floor(f);
    return cl.curv[i0] + (cl.curv[i1] - cl.curv[i0]) * u;
  }

  /** Frame at distance s (centerline, banked up vector). */
  getFrameAt(s, out = {}) {
    const cl = this.cl;
    const c = cl.sample(s, _fr);
    out.s = this.wrapS(s);
    (out.position = out.position ?? new THREE.Vector3()).set(c.px, c.py, c.pz);
    (out.tangent = out.tangent ?? new THREE.Vector3()).set(c.tx, c.ty, c.tz);
    (out.right = out.right ?? new THREE.Vector3()).set(c.rx, 0, c.rz);
    const n = cl._planeNormalFrom(c);
    (out.up = out.up ?? new THREE.Vector3()).set(n[0], n[1], n[2]);
    out.halfWidth = c.hw;
    const i = Math.round(cl.fIndex(s)) % cl.N;
    out.wallLeft = Number.isNaN(cl.wallL[i]) ? null : cl.wallL[i];
    out.wallRight = Number.isNaN(cl.wallR[i]) ? null : cl.wallR[i];
    out.bank = c.bank;
    return out;
  }

  /** Exact ground height (ribbon-aware) at x,z — for placing props. Uses the plan-view projection. */
  groundY(x, z) {
    if (this.roadField) {
      const P = this._gp ?? (this._gp = { i0: 0, u: 0, s: 0, d: 0, l: 0, fx: 0, fz: 0, y: 0 });
      if (this.roadField.project(x, z, 60, P)) {
        const outer = P.l < 0 ? this.roadField.lerpAt(this.cl.outerL, P) : this.roadField.lerpAt(this.cl.outerR, P);
        if (P.d <= outer) return P.y - P.l * this.roadField.lerpAt(this.cl.tanB, P);
      }
    }
    return this.terrain ? this.terrain.heightAt(x, z) : this.killY - 10;
  }

  _nearest(px, py, pz, hint) {
    const cl = this.cl, N = cl.N;
    let best = 0, bestD = Infinity, bestDy = 0;
    const local = hint >= 0 && hint < N;
    const n = local ? 81 : N;
    const base = local ? hint - 40 : 0;
    for (let o = 0; o < n; o++) {
      let i = base + o;
      if (i < 0) i += N; else if (i >= N) i -= N;
      const dx = px - cl.px[i], dz = pz - cl.pz[i];
      const l = dx * cl.rx[i] + dz * cl.rz[i];
      const dyRaw = py - (cl.py[i] - l * cl.tanB[i]);
      // vertical weight, capped so a kart far above/below the road is still classified by its plan position
      const dy = (dyRaw > 9 ? 9 : dyRaw < -9 ? -9 : dyRaw) * 2;
      const d = dx * dx + dz * dz + dy * dy;
      if (d < bestD) { bestD = d; best = i; bestDy = dyRaw; }
    }
    this._lastBestD = bestD;
    this._lastDy = bestDy;
    return best;
  }

  /**
   * Ground query. See ARCHITECTURE.md §6.1 for the TrackSample fields.
   * @param {THREE.Vector3} position
   * @param {number} [hint] previous `index` (local search) or -1 (global search)
   * @param {object} [out]
   */
  query(position, hint = -1, out = {}) {
    const cl = this.cl, N = cl.N, L = cl.length;
    const px = position.x, py = position.y, pz = position.z;
    let i = this._nearest(px, py, pz, hint);
    // stale / wrong hint (teleport, respawn, other level of a crossover): fall back to the global search
    if (hint >= 0 && (this._lastBestD > 1600 || Math.abs(this._lastDy) > 9)) i = this._nearest(px, py, pz, -1);
    // choose the segment containing the projection
    const dx0 = px - cl.px[i], dz0 = pz - cl.pz[i];
    const along = dx0 * cl.hx[i] + dz0 * cl.hz[i];
    let a, b;
    if (along >= 0) { a = i; b = i + 1 === N ? 0 : i + 1; } else { a = i === 0 ? N - 1 : i - 1; b = i; }
    const ex = cl.px[b] - cl.px[a], ez = cl.pz[b] - cl.pz[a];
    const e2 = ex * ex + ez * ez || 1e-9;
    const u = clamp01(((px - cl.px[a]) * ex + (pz - cl.pz[a]) * ez) / e2);
    const fx = cl.px[a] + ex * u, fz = cl.pz[a] + ez * u;
    let rx = cl.rx[a] + (cl.rx[b] - cl.rx[a]) * u, rz = cl.rz[a] + (cl.rz[b] - cl.rz[a]) * u;
    const rm = Math.hypot(rx, rz) || 1;
    rx /= rm; rz /= rm;
    const lateral = (px - fx) * rx + (pz - fz) * rz;
    const s = ((a + u) * cl.ds) % L;
    const lerp = (arr) => arr[a] + (arr[b] - arr[a]) * u;
    const hw = lerp(cl.hw);
    const tanB = lerp(cl.tanB);
    const py0 = lerp(cl.py);
    let tx = lerp(cl.tx), ty = lerp(cl.ty), tz = lerp(cl.tz);
    const tm = Math.hypot(tx, ty, tz) || 1;
    tx /= tm; ty /= tm; tz /= tm;
    const outerL = lerp(cl.outerL), outerR = lerp(cl.outerR);
    const outer = lateral < 0 ? outerL : outerR;
    const al = Math.abs(lateral);

    out.index = i;
    out.s = s;
    out.lateral = lateral;
    out.halfWidth = hw;
    out.launch = 0;
    out.ceiling = null;
    const wl = cl.wallL[i], wr = cl.wallR[i];
    out.wallLeft = Number.isNaN(wl) ? null : wl;
    out.wallRight = Number.isNaN(wr) ? null : wr;
    const normal = (out.normal = out.normal ?? new THREE.Vector3());
    (out.tangent = out.tangent ?? new THREE.Vector3()).set(tx, ty, tz);
    (out.right = out.right ?? new THREE.Vector3()).set(rx, 0, rz);

    const inGap = cl.gap[a] === 1;
    if (inGap && al <= outer) {
      if (this.overlaps && !this._inFallback) {
        const j = this._surfaceBelow(px, py, pz, i);
        if (j >= 0) { this._inFallback = true; this.query(position, j, out); this._inFallback = false; return out; }
      }
      out.surface = 'void';
      out.height = this.killY - 10;
      normal.set(0, 1, 0);
      return out;
    }

    let slope = 0;
    if (al <= outer) {
      let h = py0 - lateral * tanB;
      let surface = al <= hw ? 'road' : 'offroad';
      if (al > hw) {
        const sf = cl.features.surfaces;
        for (let k = 0; k < sf.length; k++) {
          const q = sf[k];
          if (q.type === 'ice' && q.l0 == null && inRange(s, q.s0, q.s1, L)) { surface = 'ice'; break; }
        }
        // rumble-strip curb wedge (rendered geometry includes it)
        const camp = lateral < 0 ? lerp(cl.curbL) : lerp(cl.curbR);
        if (camp > 0.01) {
          const e = al - hw;
          if (e < CURB_W) { h += curbHeight(e, camp); surface = 'road'; }
        }
      } else {
        const f = cl.features;
        // ramps (wedge geometry)
        let onRamp = false;
        for (let k = 0; k < f.ramps.length; k++) {
          const r = f.ramps[k];
          const ds = circDelta(r.s, s, L);
          if (ds >= 0 && ds <= r.length && Math.abs(lateral - r.lateral) <= r.width / 2) {
            const t = ds / r.length;
            h += r.height * t;
            slope = r.height / r.length;
            surface = 'ramp';
            out.launch = r.launch;
            onRamp = true;
            break;
          }
        }
        if (!onRamp) {
          for (let k = 0; k < f.boost.length; k++) {
            const p = f.boost[k];
            const ds = circDelta(p.s, s, L);
            if (ds >= 0 && ds <= p.length && Math.abs(lateral - p.lateral) <= p.width / 2) { surface = 'boost'; break; }
          }
          if (surface === 'road') {
            for (let k = 0; k < f.surfaces.length; k++) {
              const q = f.surfaces[k];
              if (inRange(s, q.s0, q.s1, L) && lateral >= (q.l0 ?? -hw) && lateral <= (q.l1 ?? hw)) { surface = q.type; break; }
            }
          }
        }
      }
      out.height = h;
      out.surface = surface;
      // overhead geometry (cave roof, arch, gantry, bridge deck above a lower road)
      if (this.ceilings.length) {
        const base = py0 - lateral * tanB;
        for (let k = 0; k < this.ceilings.length; k++) {
          const c = this.ceilings[k];
          if (!inRange(s, c.s0, c.s1, L)) continue;
          const y = c.fn(s, lateral, base, hw);
          if (y != null && (out.ceiling == null || y < out.ceiling)) out.ceiling = y;
        }
      }
      if (this.overlaps && this.hasAbove[i]) {
        const y = this._ceilingAbove(px, py, pz, i);
        if (!Number.isNaN(y) && (out.ceiling == null || y < out.ceiling)) out.ceiling = y;
      }
      // plane normal
      const cx = rx, cy = -tanB, cz = rz;
      const ty2 = ty + slope;
      let nx = cy * tz - cz * ty2, ny = cz * tx - cx * tz, nz = cx * ty2 - cy * tx;
      const nm = Math.hypot(nx, ny, nz) || 1;
      nx /= nm; ny /= nm; nz /= nm;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      normal.set(nx, ny, nz);
      return out;
    }

    // outside the ribbon: terrain grid
    if (!this.terrain) {
      if (this.overlaps && !this._inFallback) {
        const j = this._surfaceBelow(px, py, pz, i);
        if (j >= 0) { this._inFallback = true; this.query(position, j, out); this._inFallback = false; return out; }
      }
      out.surface = 'void';
      out.height = this.killY - 10;
      normal.set(0, 1, 0);
      return out;
    }
    const h = this.terrain.sample(px, pz, out);
    if (this.waterLevel != null && h < this.waterLevel - 0.2) {
      out.surface = 'void';
      out.height = this.killY - 10;
      normal.set(0, 1, 0);
      return out;
    }
    out.height = h;
    out.surface = this.iceTerrain && this.terrain.maskAt(px, pz) > 0.6 ? 'ice' : 'offroad';
    return out;
  }
}
