/**
 * Rex — chunky green T-rex: big grin with little teeth, row of dark-green spikes (head + back + tail), cream belly,
 * thick tapering tail, tiny thin arms gripping the wheel, yellow slit eyes with heavy brow ridges.
 */
import * as THREE from 'three';
import { G, PartBuilder, CHN, FUR, GLOSS, headBase, eyePair, smile, pathTube, torsoAndArms, orient, shade, smooth } from './common.js';
import { PATTERN_RECTS, regionUV } from '../atlas.js';

export function buildRex(ctx) {
  const C = ctx.palette;
  const torso = new PartBuilder(), head = new PartBuilder();
  const green = C.primary, cream = C.secondary, dk = C.accent;
  const greenL = shade(green, 0.06);
  const cy = 0.28;
  const up = new THREE.Vector3(0, 1, 0);
  const quatTo = (dir) => new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(...dir).normalize());

  // ---------------- torso ----------------
  const R = { rx: 0.3, ry: 0.3, rz: 0.26, cy: 0.18 };
  const rest = torsoAndArms(torso, ctx, {
    body: green, belly: cream, sleeve: green, glove: greenL, ...R, armR: 0.05, gloveR: 0.07, shoulderZ: 0.06,
    uvRegion: regionUV(PATTERN_RECTS.body),
  });
  // back spikes following the spine
  [[15, 0.15], [35, 0.14], [55, 0.12], [72, 0.1], [84, 0.08]].forEach(([deg, len]) => {
    const el = (deg * Math.PI) / 180;
    const p = [0, R.cy + R.ry * Math.sin(el) * 0.98, -R.rz * Math.cos(el) * 0.98];
    const n = [0, Math.sin(el) / R.ry, -Math.cos(el) / R.rz];
    const c = new THREE.Vector3(...p).addScaledVector(new THREE.Vector3(...n).normalize(), len * 0.4);
    torso.add(G.cone(len * 0.5, len, 5), { p: [c.x, c.y, c.z], q: quatTo(n), ...FUR(dk, { rough: 0.6 }) });
  });
  // thick tapering tail with spikes
  const tp = [[0, 0.07, -0.22], [0, 0.03, -0.5], [0, 0.1, -0.78], [0, 0.24, -1.0]];
  const rad = (t) => 0.035 + 0.16 * Math.pow(1 - t, 0.9);
  const tailFlex = { ch: CHN.TAIL, pivot: tp[0], dir: [0, 0.17, -0.78], len: 0.85, pow: 1.0 };
  const tail = pathTube(torso, tp, rad, {
    segments: 8, ring: 8, capStart: 0.08, capEnd: 0.04, capRings: 2,
    surf: FUR(green), uvRegion: regionUV(PATTERN_RECTS.tail), flex: tailFlex,
  });
  for (const t of [0.12, 0.3, 0.48, 0.66]) {
    const p = tail.curve.getPointAt(t);
    const r = rad(t);
    torso.add(G.cone(0.05 * (1 - t * 0.6), 0.11 * (1 - t * 0.5), 5), { p: [p.x, p.y + r * 0.92 + 0.03, p.z], q: quatTo([0, 1, 0.1]), ...FUR(dk, { rough: 0.6 }), flex: tailFlex });
  }

  // ---------------- head ----------------
  const h = headBase(head, { cy, rx: 0.33, ry: 0.28, rz: 0.31, color: green, uvRegion: regionUV(PATTERN_RECTS.head) });
  // snout (upper jaw) + cream lower jaw; the grin hugs the snout surface, little white teeth hang from the upper lip
  const sn = { cx: 0, cy: 0.215, cz: 0.29, rx: 0.19, ry: 0.115, rz: 0.215 };
  const snoutZ = (x, y) => sn.cz + sn.rz * Math.sqrt(Math.max(0.03, 1 - (x / sn.rx) ** 2 - ((y - sn.cy) / sn.ry) ** 2));
  head.add(G.ell(sn.rx, sn.ry, sn.rz, 14, 10), { p: [sn.cx, sn.cy, sn.cz], ...FUR(greenL) });
  head.add(G.ell(0.17, 0.09, 0.2, 10, 6), { p: [0, 0.122, 0.262], ...FUR(cream) });
  head.addSym(G.ell(0.017, 0.012, 0.012, 6, 4), { p: [0.055, 0.28, snoutZ(0.055, 0.28) - 0.004], ...GLOSS('#0c1a0c') });
  const gy = 0.226, gd = 0.058, gw = 0.15;
  const gyAt = (x) => gy - gd * (1 - (x / gw) ** 2);
  smile(head, h, { y: gy, w: gw, depth: gd, zFn: snoutZ, thick: 0.012, color: '#241016' });
  for (let i = 0; i < 7; i++) {
    const x = ((i / 6) * 2 - 1) * 0.125;
    const y = gyAt(x) - 0.006;
    head.add(G.cone(0.02, 0.058, 5), { p: [x, y - 0.02, snoutZ(x, y) - 0.004], r: [Math.PI, 0, 0], color: '#fffbe8', rough: 0.35, ao: 0 });
  }
  eyePair(head, h, { x: 0.165, y: 0.385, rx: 0.058, ry: 0.066, tilt: 0.6 });
  head.addSym(G.ell(0.095, 0.028, 0.055, 8, 5), { p: [0.165, 0.455, 0.235], r: [0, 0.5, -0.32], ...FUR(dk) });
  // head crest spikes
  [[-0.06, 0.55, 0.11], [-0.19, 0.5, 0.1], [-0.28, 0.4, 0.09]].forEach(([z, y, len]) => {
    head.add(G.cone(len * 0.5, len, 5), { p: [0, y + 0.01, z], q: quatTo([0, 1, -0.55]), ...FUR(dk, { rough: 0.6 }) });
  });

  return {
    torso: torso.build(),
    head: head.build(),
    tris: torso.tris + head.tris,
    neckY: 0.42,
    h,
    rest,
    channels: [{ ch: CHN.TAIL, kind: 'tail', amp: 0.4 }],
    blink: [2.6, 6],
    look: 0.3,
  };
}
