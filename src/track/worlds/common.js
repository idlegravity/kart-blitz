/**
 * Helpers shared by the theme worlds. OWNER: World agent.
 */
import * as THREE from 'three';
import { InstanceSet } from '../scatter.js';
import { GeoBuilder, rgb, merge, simplify } from '../geo.js';
import { makeChevronSignTexture } from '../textures.js';
import { smooth } from '../noise.js';

/** Painted arrows before tight curves: [{ s, dir }]. */
export function turnArrowList(cl, maxR = 80, lead = 26) {
  return cl.curveRuns(maxR).map((r) => ({ s: r.s0 - lead, dir: r.dir }));
}

/** Add a static round collider when the spot is reachable (no wall between it and the road). */
export function addCollider(track, x, z, radius, info) {
  if (info && info.e != null && info.e > 26) return false;
  if (info && info.s != null) {
    const cl = track.cl;
    const i = Math.floor(info.s / cl.ds) % cl.N;
    const w = info.l < 0 ? cl.wallL[i] : cl.wallR[i];
    if (!Number.isNaN(w)) return false;
  }
  track.colliders.push({ x, z, radius });
  return true;
}

/** Chevron warning boards on the outside of tight corners. */
export function buildChevronSigns(track, ctx, opts = {}) {
  const cl = track.cl;
  const maxR = opts.maxR ?? 80;
  const boardGeo = new THREE.PlaneGeometry(2.6, 1.5);
  boardGeo.translate(0, 2.9, 0);
  const n = boardGeo.attributes.position.count;
  boardGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  const tex = ctx.mats.add(makeChevronSignTexture());
  const boardMat = ctx.mats.add(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, side: THREE.DoubleSide, vertexColors: true }));
  const boards = new InstanceSet(track, boardGeo, boardMat, { chunk: 160, cull: 260, cast: false, name: 'chevrons' });
  const posts = new InstanceSet(track, (() => {
    const g = new THREE.CylinderGeometry(0.07, 0.09, 2.7, 6);
    g.translate(0, 1.35, 0);
    const c = new Float32Array(g.attributes.position.count * 3).fill(0.75);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return simplify(g);
  })(), ctx.mats.vcolor({ roughness: 0.6 }), { chunk: 160, cull: 260, cast: false, name: 'chevron-posts' });
  let count = 0;
  for (const run of cl.curveRuns(maxR)) {
    const side = -run.dir; // outside of the bend
    const len = ((run.s1 - run.s0) + cl.length) % cl.length;
    const gap = opts.gap ?? 13;
    const k = Math.max(2, Math.floor(len / gap));
    for (let j = 0; j <= k; j++) {
      const s = run.s0 + (j / k) * len;
      const c = cl.sample(s, {});
      const idx = cl.indexAt(s);
      const w = side < 0 ? cl.wallL[idx] : cl.wallR[idx];
      const outer = side < 0 ? cl.outerL[idx] : cl.outerR[idx];
      const lat = side * (Number.isNaN(w) ? outer + 1.2 : Math.abs(w) + 1.3);
      const x = c.px + c.rx * lat, z = c.pz + c.rz * lat;
      const y = track.groundY(x, z);
      // face the racers approaching along the track direction, angled slightly toward the bend
      const yaw = Math.atan2(c.tx, c.tz) + Math.PI + side * 0.25;
      const flip = run.dir > 0 ? 1 : -1; // arrow points toward the turn
      boards.add(x, y, z, yaw, flip, 1, 1);
      posts.add(x, y, z, yaw);
      count++;
    }
  }
  boards.build();
  posts.build();
  return count;
}

/** Simple cluster mask helper: noise-based patchiness in [0,1]. */
export function patch(noiseFn, lo = 0.0, hi = 0.35) {
  return (x, z) => smooth(lo, hi, noiseFn(x, z));
}

/** Merge helper re-exports so worlds import from one place. */
export { rgb, merge, simplify, GeoBuilder };
