/**
 * Mochi — pink bunny: one very long upright ear, one flopped ear, chubby cheeks with blush, tiny nose,
 * star hairclip, fluffy pom tail.
 */
import * as THREE from 'three';
import { G, S2, PartBuilder, CHN, FUR, GLOSS, GLOW, SHINY, headBase, eyePair, smile, blush, pathTube, torsoAndArms, smooth, shade } from './common.js';

export function buildMochi(ctx) {
  const C = ctx.palette;
  const torso = new PartBuilder(), head = new PartBuilder();
  const pink = C.primary, white = C.secondary, pinkLight = C.accent;
  const cy = 0.275;

  const rest = torsoAndArms(torso, ctx, { body: pink, belly: white, sleeve: pink, glove: white, rx: 0.21, ry: 0.26, rz: 0.19 });
  torso.add(G.torus(0.14, 0.05, 14, 6), { p: [0, 0.4, 0], r: [Math.PI / 2, 0, 0], ...FUR(white, { rough: 0.9 }) });
  // fluffy pom tail
  const tf = { ch: CHN.TAIL, pivot: [0, 0.1, -0.2], dir: [0, 0.2, -1], len: 0.25, pow: 1 };
  torso.add(G.ell(0.13, 0.13, 0.13, 10, 8), { p: [0, 0.17, -0.27], ...FUR(white, { rough: 0.95 }), flex: tf });
  torso.add(G.ell(0.07, 0.07, 0.07, 7, 5), { p: [0.08, 0.13, -0.3], ...FUR(white, { rough: 0.95 }), flex: tf });
  torso.add(G.ell(0.07, 0.07, 0.07, 7, 5), { p: [-0.07, 0.24, -0.29], ...FUR(white, { rough: 0.95 }), flex: tf });

  // ---------------- head ----------------
  const h = headBase(head, { cy, rx: 0.335, ry: 0.27, rz: 0.295, color: pink });
  head.addSym(G.ell(0.11, 0.09, 0.1, 9, 6), { p: [0.225, 0.2, 0.09], ...FUR(shade(pink, 0.05)) });
  head.add(G.ell(0.115, 0.08, 0.1, 10, 7), { p: [0, 0.2, 0.255], ...FUR(white) });
  head.add(G.ell(0.03, 0.022, 0.022, 8, 5), { p: [0, 0.232, 0.345], ...GLOSS('#ff5a8f') });
  for (const s of [1, -1]) smile(head, h, { y: 0.19, w: 0.03, depth: 0.013, z: 0.345, thick: 0.007, color: '#b03a63' });
  eyePair(head, h, { x: 0.135, y: 0.295, rx: 0.06, ry: 0.08, tilt: 0.25 });
  blush(head, h, { x: 0.225, y: 0.2, color: '#ff5f97' });

  // ears: upright long ear on the kart-left, flopped ear on the right
  const earSurf = FUR(pink);
  const colorEar = (baseCol, inner) => {
    const out = new THREE.Color();
    return (p, n) => out.copy(baseCol).lerp(inner, smooth(0.15, 0.7, n.z));
  };
  const pinkL = new THREE.Color(pinkLight);
  pathTube(head, [[0.15, 0.44, -0.02], [0.17, 0.62, -0.04], [0.18, 0.8, -0.07], [0.175, 0.95, -0.1]], (t) => 0.078 - 0.022 * t * t, {
    segments: 6, ring: 8, flatX: 1, flatY: 0.5, up: [0, 0, 1], capStart: 0.05, capEnd: 0.05, capRings: 2,
    surf: earSurf,
    colorFn: colorEar(pink, pinkL),
    flex: { ch: CHN.EAR_L, pivot: [0.15, 0.42, -0.02], dir: [0.1, 1, -0.1], len: 0.55, pow: 1.1 },
  });
  pathTube(head, [[-0.15, 0.44, -0.02], [-0.18, 0.64, -0.05], [-0.27, 0.8, -0.08], [-0.42, 0.79, -0.1], [-0.5, 0.65, -0.12], [-0.52, 0.5, -0.12]], (t) => 0.078 - 0.02 * t * t, {
    segments: 8, ring: 8, flatX: 1, flatY: 0.5, up: [0, 0, 1], capStart: 0.05, capEnd: 0.05, capRings: 2,
    surf: earSurf,
    colorFn: colorEar(pink, pinkL),
    flex: { ch: CHN.EAR_R, pivot: [-0.15, 0.42, -0.02], dir: [-0.3, 0.8, -0.1], len: 0.55, pow: 1.1 },
  });
  // star hairclip (kart-right, near the flopped ear)
  head.add(G.extrude(S2.star(5, 1, 0.52), 0.4, 0.1, 1, 2), {
    p: [-0.2, 0.47, 0.19], r: [0.2, -0.5, 0.25], s: 0.075, ...SHINY('#ffd23a', { emis: 0.7, rough: 0.2 }), ao: 0,
  });

  return {
    torso: torso.build(),
    head: head.build(),
    tris: torso.tris + head.tris,
    neckY: 0.42,
    h,
    rest,
    channels: [
      { ch: CHN.EAR_L, kind: 'ear', side: 1 },
      { ch: CHN.EAR_R, kind: 'flop', side: -1 },
      { ch: CHN.TAIL, kind: 'tail', amp: 0.35 },
    ],
    blink: [2, 4.6],
    look: 0.45,
  };
}
