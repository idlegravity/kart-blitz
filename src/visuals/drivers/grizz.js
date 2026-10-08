/**
 * Grizz — brown bear: round ears, tan muzzle, black nose, small beady eyes, leather racing cap with a paw badge,
 * red-and-black flannel vest (open front), big belly.
 */
import * as THREE from 'three';
import { G, PartBuilder, CHN, FUR, CLOTH, GLOSS, headBase, eyePair, smile, torsoAndArms, orient, shade, mix, clamp01 } from './common.js';
import { PATTERN_RECTS, regionUV } from '../atlas.js';

export function buildGrizz(ctx) {
  const C = ctx.palette;
  const torso = new PartBuilder(), head = new PartBuilder();
  const brown = C.primary, tan = C.secondary;
  const cy = 0.28;
  const R = { rx: 0.3, ry: 0.3, rz: 0.26, cy: 0.18 };

  // ---------------- torso + flannel vest ----------------
  const rest = torsoAndArms(torso, ctx, { body: brown, belly: tan, sleeve: brown, glove: brown, ...R, armR: 0.07, gloveR: 0.088, shoulderZ: 0.06 });
  const [fu0, fv0, fu1, fv1] = regionUV('flannel', 3);
  torso.add(G.ell(R.rx * 1.045, R.ry * 1.03, R.rz * 1.05, 16, 11, Math.PI * 0.74, Math.PI / 2 + 0.6, Math.PI * 2 - 1.2), {
    p: [0, R.cy, 0],
    ...CLOTH('#ffffff', { rough: 0.9 }),
    ao: 0.15,
    uvFn: (p) => [mix(fu0, fu1, clamp01(0.5 + p.x / (2 * R.rx * 1.05))), mix(fv0, fv1, clamp01(0.5 + (p.y - R.cy) / (2 * R.ry)))],
  });
  // little stub tail
  torso.add(G.ell(0.09, 0.09, 0.09, 8, 6), { p: [0, 0.07, -0.29], ...FUR(brown), flex: { ch: CHN.TAIL, pivot: [0, 0.06, -0.24], dir: [0, 0, -1], len: 0.12 } });

  // ---------------- head ----------------
  const h = headBase(head, { cy, rx: 0.34, ry: 0.27, rz: 0.3, color: brown });
  head.add(G.ell(0.165, 0.12, 0.15, 12, 8), { p: [0, 0.165, 0.265], ...FUR(tan) });
  head.add(G.ell(0.057, 0.042, 0.042, 8, 6), { p: [0, 0.215, 0.405], ...GLOSS('#0e0c0c', { rough: 0.15 }) });
  smile(head, h, { y: 0.135, w: 0.055, depth: 0.02, z: 0.392, thick: 0.009, color: '#2a1408' });
  eyePair(head, h, { x: 0.135, y: 0.3, rx: 0.044, ry: 0.054, depth: 0.04, tilt: 0.25 });
  // ears
  const earFlex = { ch: CHN.EAR_L, chR: CHN.EAR_R, pivot: [0.245, 0.47, -0.02], dir: [0.3, 1, 0], len: 0.14, pow: 1.2 };
  head.addSym(G.ell(0.115, 0.115, 0.06, 10, 7), { p: [0.245, 0.5, -0.02], r: [0, -0.3, 0], ...FUR(brown), flex: earFlex });
  head.addSym(G.ell(0.07, 0.07, 0.03, 8, 6), { p: [0.245, 0.5, 0.022], r: [0, -0.3, 0], ...FUR(tan), flex: earFlex });
  // leather racing cap: dome + brim + band + paw badge
  const leather = { color: '#4b2a17', rough: 0.5, clear: 0.35, ao: 0.28 };
  head.add(G.ell(0.35, 0.235, 0.34, 16, 9, Math.PI * 0.5), { p: [0, 0.4, -0.005], r: [-0.08, 0, 0], ...leather });
  head.add(G.torus(0.345, 0.03, 18, 5), { p: [0, 0.4, -0.005], r: [Math.PI / 2 - 0.08, 0, 0], ...{ ...leather, color: '#33190d' } });
  head.add(G.ell(0.21, 0.03, 0.17, 10, 4), { p: [0, 0.405, 0.3], r: [0.28, 0, 0], ...leather });
  head.add(new THREE.CircleGeometry(0.052, 12), { p: [0, 0.5, 0.325], q: orient([0, 0.42, 1], [0, 1, 0]), uvRegion: regionUV('roundel', 3), ao: 0, rough: 0.4 });

  return {
    torso: torso.build(),
    head: head.build(),
    tris: torso.tris + head.tris,
    neckY: 0.42,
    h,
    rest,
    channels: [
      { ch: CHN.EAR_L, kind: 'ear', side: 1 },
      { ch: CHN.EAR_R, kind: 'ear', side: -1 },
      { ch: CHN.TAIL, kind: 'tail', amp: 0.25 },
    ],
    blink: [2.8, 6],
    look: 0.3,
  };
}
