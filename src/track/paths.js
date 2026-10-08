/**
 * Dirt / gravel paths draped over the terrain (shortcuts, trails). OWNER: World agent.
 */
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { makeCanvas, canvasTexture } from './textures.js';
import { hash2, pfbm } from './noise.js';

function pathTexture(base = [128, 96, 58], rut = 0.78) {
  const w = 128, h = 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const n = pfbm((x / w) * 6, (y / h) * 12, 6, 3, 4);
      const edgeN = (pfbm((y / h) * 20, 3, 20, 2, 9) - 0.5) * 0.16;
      const a = Math.min(1, Math.max(0, (Math.min(u, 1 - u) + edgeN) / 0.2));
      const ruts = 1 - (Math.exp(-Math.pow((u - 0.3) / 0.07, 2)) + Math.exp(-Math.pow((u - 0.7) / 0.07, 2))) * (1 - rut);
      const k = (0.85 + n * 0.3) * ruts * (0.94 + hash2(x, y, 3) * 0.12);
      const o = (y * w + x) * 4;
      img.data[o] = Math.min(255, base[0] * k);
      img.data[o + 1] = Math.min(255, base[1] * k);
      img.data[o + 2] = Math.min(255, base[2] * k);
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, { repeat: true, aniso: 8 });
}

/**
 * @param {Track} track built track
 * @param {{mats: MatLib}} ctx
 * @param {{ points: number[][], width?: number, color?: number[], lift?: number }} o points are [x, z]
 */
export function buildPath(track, ctx, o) {
  const pts = o.points.map((p) => new THREE.Vector3(p[0], 0, p[1]));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(4, Math.round(len / 1.5));
  const width = o.width ?? 7;
  const gb = new GeoBuilder();
  let prev = null;
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    const rx = -t.z, rz = t.x;
    const m = Math.hypot(rx, rz) || 1;
    const nx = rx / m, nz = rz / m;
    const hw = (width / 2) * (0.85 + 0.15 * hash2(i, 2, 7));
    const ax = p.x - nx * hw, az = p.z - nz * hw, bx = p.x + nx * hw, bz = p.z + nz * hw;
    const ya = track.groundY(ax, az) + (o.lift ?? 0.07), yb = track.groundY(bx, bz) + (o.lift ?? 0.07);
    const row = [gb.v(ax, ya, az, 0, 1, 0, null, 0, (u * len) / 4), gb.v(bx, yb, bz, 0, 1, 0, null, 1, (u * len) / 4)];
    if (prev) gb.quad(prev[0], prev[1], row[1], row[0]);
    prev = row;
  }
  const g = gb.build(true);
  const tex = ctx.mats.add(pathTexture(o.color));
  const mat = ctx.mats.add(new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }));
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.renderOrder = 2;
  m.name = 'path';
  track.group.add(m);
  return m;
}
