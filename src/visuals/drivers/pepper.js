/**
 * Pepper — orange tabby cat: dark stripes (atlas pattern), white paws/chest, green slit-pupil eyes, whiskers,
 * pointed ears, long striped tail with a dark tip, red bandana with a fluttering knot.
 */
import * as THREE from 'three';
import { G, S2, PartBuilder, CHN, FUR, CLOTH, GLOSS, headBase, eyePair, smile, pathTube, torsoAndArms, orient, shade, smooth } from './common.js';
import { PATTERN_RECTS, regionUV } from '../atlas.js';
import { strut } from '../karts.js';

export function buildPepper(ctx) {
  const C = ctx.palette;
  const torso = new PartBuilder(), head = new PartBuilder();
  const orange = C.primary, dark = new THREE.Color('#3a1a08'), white = new THREE.Color('#ffffff');
  const red = '#d81f26';
  const cy = 0.27;

  // ---------------- torso ----------------
  const rest = torsoAndArms(torso, ctx, { body: orange, belly: white, sleeve: orange, glove: white, rx: 0.2, ry: 0.26, rz: 0.18, uvRegion: regionUV(PATTERN_RECTS.body) });
  // long striped tail curling up in an S
  const tp = [[0, 0.08, -0.2], [0, 0.03, -0.42], [0, 0.16, -0.62], [0, 0.42, -0.66], [0, 0.66, -0.54], [0, 0.84, -0.38], [0, 0.9, -0.22]];
  pathTube(torso, tp, (t) => (0.05 + 0.014 * Math.sin(Math.PI * t)) * (1 - 0.3 * smooth(0.88, 1, t)), {
    segments: 12, ring: 7, capStart: 0.05, capEnd: 0.05, capRings: 2,
    surf: FUR(orange), uvRegion: regionUV(PATTERN_RECTS.tail),
    colorAt: (t, out) => out.copy(orange).lerp(dark, smooth(0.9, 0.95, t)),
    flex: { ch: CHN.TAIL, pivot: tp[0], dir: [0, 0.75, -0.2], len: 1.0, pow: 1.0 },
  });
  // bandana: neck band + front triangle + knot with fluttering tails
  torso.add(G.torus(0.165, 0.045, 16, 5), { p: [0, 0.41, 0], r: [Math.PI / 2, 0, 0], s: [1, 1.05, 1], ...CLOTH(red, { rough: 0.7 }) });
  torso.add(G.extrude(S2.polygon([[-0.13, 0], [0.13, 0], [0, -0.19]]), 0.02, 0.012, 1, 2), { p: [0, 0.4, 0.16], q: orient([0, 0.3, 0.95], [0, 1, 0]), ...CLOTH(red, { rough: 0.7 }) });
  torso.add(G.ell(0.045, 0.045, 0.045, 7, 5), { p: [0, 0.42, -0.165], ...CLOTH(red, { rough: 0.7 }) });
  const knotFlex = { ch: CHN.SCARF, pivot: [0, 0.42, -0.165], dir: [0, -0.4, -1], len: 0.2, pow: 0.8, phase: 1 };
  for (const s of [1, -1]) {
    pathTube(torso, [[0.02 * s, 0.42, -0.17], [0.07 * s, 0.37, -0.25], [0.1 * s, 0.29, -0.31]], () => 0.036, {
      segments: 4, ring: 6, flatX: 1, flatY: 0.22, up: [0, 1, 0], capStart: 0.015, capEnd: 0.015, capRings: 1, surf: CLOTH(red, { rough: 0.7 }), flex: knotFlex,
    });
  }

  // ---------------- head ----------------
  const h = headBase(head, { cy, rx: 0.3, ry: 0.26, rz: 0.28, color: orange, uvRegion: regionUV(PATTERN_RECTS.head) });
  head.add(G.ell(0.115, 0.085, 0.1, 10, 7), { p: [0, 0.185, 0.25], ...FUR(white, { rough: 0.8 }) });
  head.addSym(G.ell(0.09, 0.07, 0.09, 8, 6), { p: [0.13, 0.18, 0.2], ...FUR(white, { rough: 0.8 }) });
  head.add(G.ell(0.03, 0.022, 0.022, 8, 5), { p: [0, 0.215, 0.335], ...GLOSS('#ff7a8c', { rough: 0.3 }) });
  for (const s of [1, -1]) smile(head, h, { y: 0.178, w: 0.032, depth: 0.014, z: 0.33, thick: 0.006, color: '#5b2a1a', frown: false });
  eyePair(head, h, { x: 0.125, y: 0.285, rx: 0.062, ry: 0.079, tilt: 0.25, roll: 0.12 });
  // whiskers
  for (const s of [1, -1]) {
    for (const [dy, dz] of [[0.035, 0.05], [0, 0], [-0.03, -0.06]]) {
      head.add(strut([0.1 * s, 0.19 + dy * 0.4, 0.31], [0.3 * s, 0.19 + dy + 0.02, 0.29 + dz], 0.0035), { color: '#fff8ee', rough: 0.5, ao: 0 });
    }
  }
  // ears: pointed, dark tip, pink inner
  {
    const ang = { z: -0.32, x: -0.1 };
    const axis = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(ang.x, 0, ang.z, 'XYZ'));
    const base = new THREE.Vector3(0.175, 0.42, -0.01);
    const len = 0.3;
    const c = base.clone().addScaledVector(axis, len / 2);
    const pinkC = new THREE.Color('#ff9fb0');
    const out = new THREE.Color();
    const fl = { ch: CHN.EAR_L, chR: CHN.EAR_R, pivot: [base.x, base.y - 0.03, base.z], dir: [axis.x, axis.y, axis.z], len: len + 0.02, pow: 1.3 };
    head.addSym(G.cone(0.12, len, 5), {
      p: [c.x, c.y, c.z], r: [ang.x, 0, ang.z], s: [1, 1, 0.5], ...FUR(orange),
      colorFn: (p, n) => {
        const t = ((p.x - base.x) * axis.x + (p.y - base.y) * axis.y + (p.z - base.z) * axis.z) / len;
        out.copy(orange).lerp(pinkC, smooth(0.2, 0.7, n.z) * (1 - smooth(0.55, 0.8, t)) * 0.9);
        return out.lerp(dark, smooth(0.72, 0.9, t));
      },
      flex: fl,
    });
  }

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
      { ch: CHN.TAIL, kind: 'tail', amp: 0.7 },
      { ch: CHN.SCARF, kind: 'scarf', amp: 0.5 },
    ],
    blink: [1.8, 4.4],
    look: 0.5,
  };
}
