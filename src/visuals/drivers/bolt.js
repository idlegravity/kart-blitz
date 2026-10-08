/**
 * Bolt — round yellow robot: riveted panel head (atlas pattern), glowing cyan LED visor-face (emissive, blinks),
 * antenna with a pulsing red beacon ball, speaker ears, steel claw hands, battery pack with glow strips.
 */
import * as THREE from 'three';
import { G, PartBuilder, CHN, SHINY, GLOSS, GLOW, headBase, eyeAt, smile, torsoAndArms, frontZ } from './common.js';
import { PATTERN_RECTS, regionUV } from '../atlas.js';
import { SURF, bar } from '../karts.js';

export function buildBolt(ctx) {
  const C = ctx.palette;
  const torso = new PartBuilder(), head = new PartBuilder();
  const yel = C.primary;
  const steel = (c = '#3b414e', o = {}) => SURF.steel({ color: c, rough: 0.32, ...o });
  const cy = 0.28;

  // ---------------- torso ----------------
  const rest = torsoAndArms(torso, ctx, {
    body: yel, rx: 0.21, ry: 0.25, rz: 0.19, cy: 0.17,
    bodySurf: { color: yel, rough: 0.24, clear: 1, metal: 0.2, ao: 0.3 },
    armSurf: steel('#454c5a'), gloveSurf: steel('#a3adbf', { rough: 0.25 }), gloveR: 0.068, armR: 0.055,
    uvRegion: regionUV(PATTERN_RECTS.body),
  });
  // chest plate + pulsing chest light, neck collar, shoulder caps
  torso.add(G.ell(0.12, 0.1, 0.03, 10, 7), { p: [0, 0.2, 0.172], ...steel('#4a5262', { rough: 0.3 }) });
  torso.add(G.ell(0.036, 0.036, 0.014, 8, 5), { p: [0, 0.215, 0.2], ...GLOW('#26d9ff', -3.2) });
  torso.add(G.cyl(0.1, 0.12, 0.06, 8), { p: [0, 0.43, 0], ...steel('#2a2f3a') });
  torso.addSym(G.ell(0.07, 0.07, 0.07, 8, 6), { p: [rest.shoulders.L[0], rest.shoulders.L[1], rest.shoulders.L[2]], ...SHINY(yel, { metal: 0.2, rough: 0.25 }), flex: { ch: CHN.ARM_L, chR: CHN.ARM_R, pivot: rest.shoulders.L, len: 0 } });
  // battery pack on the back with glow strips
  torso.add(bar([0, 0.2, -0.2], [0, 0.2, -0.27], 0.15, 0.17, { ring: 8, capS: 0.03 }), steel('#2f3541'));
  for (const y of [0.14, 0.2, 0.26]) torso.add(G.cube(0.16, 0.022, 0.012), { p: [0, y, -0.305], ...GLOW('#26d9ff', 2.4) });

  // ---------------- head ----------------
  const h = headBase(head, {
    cy, rx: 0.3, ry: 0.27, rz: 0.28,
    color: yel,
    surf: { rough: 0.22, clear: 1, metal: 0.2, ao: 0.3 },
    uvRegion: regionUV(PATTERN_RECTS.head),
  });
  // dark visor + LED face
  head.add(G.ell(0.235, 0.165, 0.1, 14, 9), { p: [0, 0.3, 0.222], ...GLOSS('#0b1626', { rough: 0.06, metal: 0.3 }) });
  for (const s of [1, -1]) {
    const x = 0.085 * s, y = 0.33, z = 0.305;
    head.add(G.ell(0.05, 0.066, 0.022, 8, 6), { p: [x, y, z], r: [0, s * 0.12, 0], ...GLOW('#26d9ff', 3.4), blink: [x, y, z] });
  }
  smile(head, h, { y: 0.262, w: 0.075, depth: 0.022, z: 0.322, thick: 0.011, surf: { ...GLOW('#26d9ff', 3.2) } });
  // speaker ears
  head.addSym(G.cyl(0.085, 0.085, 0.07, 10), { p: [0.31, 0.28, 0], r: [0, 0, Math.PI / 2], ...steel('#3b414e') });
  head.addSym(G.cyl(0.05, 0.05, 0.012, 8), { p: [0.348, 0.28, 0], r: [0, 0, Math.PI / 2], ...GLOW('#26d9ff', 2.2) });
  // antenna
  const antFlex = { ch: CHN.ANT_A, pivot: [0, 0.5, -0.03], dir: [0, 1, -0.15], len: 0.3, pow: 1.0 };
  head.add(G.cyl(0.011, 0.014, 0.22, 6), { p: [0, 0.6, -0.02], r: [-0.15, 0, 0], ...steel('#8b95a7'), flex: antFlex });
  head.add(G.ell(0.05, 0.05, 0.05, 8, 6), { p: [0, 0.745, -0.05], ...GLOW('#ff1e1e', -2.4), flex: antFlex });

  return {
    torso: torso.build(),
    head: head.build(),
    tris: torso.tris + head.tris,
    neckY: 0.42,
    h,
    rest,
    channels: [{ ch: CHN.ANT_A, kind: 'antenna' }],
    blink: [2.4, 5.8],
    look: 0.35,
  };
}
