/**
 * Nova — mint alien: big dome head with three glossy black eyes, two bobbing antennae with glowing yellow tips,
 * purple space suit with mint collar, glowing badge and back pack.
 */
import * as THREE from 'three';
import { G, PartBuilder, CHN, FUR, CLOTH, GLOSS, GLOW, SHINY, headBase, eyePair, eyeAt, smile, pathTube, torsoAndArms, shade } from './common.js';
import { PATTERN_RECTS, regionUV } from '../atlas.js';

export function buildNova(ctx) {
  const C = ctx.palette;
  const torso = new PartBuilder(), head = new PartBuilder();
  const purple = C.primary, mint = C.secondary, yellow = C.accent;
  const cy = 0.31;

  // ---------------- torso (space suit) ----------------
  const rest = torsoAndArms(torso, ctx, {
    body: purple, sleeve: purple, glove: mint, rx: 0.21, ry: 0.26, rz: 0.19,
    bodySurf: { color: purple, rough: 0.42, clear: 0.35, ao: 0.3 },
    armSurf: { color: purple, rough: 0.5, clear: 0.3, ao: 0.3 },
    gloveSurf: SHINY(mint, { rough: 0.35 }),
    uvRegion: regionUV(PATTERN_RECTS.body),
  });
  torso.add(G.torus(0.145, 0.05, 16, 6), { p: [0, 0.4, 0], r: [Math.PI / 2, 0, 0], s: [1, 1.05, 1], ...SHINY(mint, { rough: 0.35 }) });
  torso.add(G.torus(0.19, 0.03, 16, 5), { p: [0, 0.07, 0], r: [Math.PI / 2, 0, 0], s: [1, 1.0, 0.94], ...CLOTH(shade(purple, -0.22), { rough: 0.5 }) });
  torso.add(G.ell(0.036, 0.03, 0.012, 8, 5), { p: [0, 0.07, 0.19], ...GLOW('#ffe45c', 2.4) });
  torso.add(G.ell(0.055, 0.055, 0.02, 10, 6), { p: [0, 0.28, 0.185], ...GLOW('#ffe45c', -2.8) });
  // back pack (pill) with glow strip
  torso.add(G.capsule(0.075, 0.12, 4, 8), { p: [0, 0.2, -0.24], ...SHINY(shade(purple, -0.12), { rough: 0.4 }) });
  torso.add(G.cube(0.03, 0.2, 0.012), { p: [0, 0.2, -0.318], ...GLOW('#ffe45c', 2.6) });

  // ---------------- head ----------------
  const h = headBase(head, { cy, rx: 0.3, ry: 0.34, rz: 0.28, color: mint, surf: { rough: 0.5, clear: 0.5 }, uvRegion: regionUV(PATTERN_RECTS.head) });
  eyePair(head, h, { x: 0.125, y: 0.25, rx: 0.068, ry: 0.09, depth: 0.045, tilt: 0.35, roll: -0.32 });
  eyeAt(head, h, 0, 0.43, { rx: 0.046, ry: 0.06, depth: 0.04 });
  smile(head, h, { y: 0.135, w: 0.045, depth: 0.014, thick: 0.007, color: '#1f7c62' });

  // antennae (thin, bobbing) with glowing tips
  for (const s of [1, -1]) {
    const fl = { ch: s > 0 ? CHN.ANT_A : CHN.ANT_B, pivot: [0.08 * s, 0.6, -0.03], dir: [0.5 * s, 1, 0], len: 0.42, pow: 1 };
    pathTube(head, [[0.08 * s, 0.6, -0.03], [0.14 * s, 0.77, -0.04], [0.18 * s, 0.92, -0.02]], () => 0.012, {
      segments: 4, ring: 5, capStart: 0.012, capEnd: 0.012, capRings: 1, surf: FUR(shade(mint, -0.1), { rough: 0.5 }), flex: fl,
    });
    head.add(G.ell(0.052, 0.052, 0.052, 8, 6), { p: [0.18 * s, 0.965, -0.02], ...GLOW('#ffe45c', -3.8), flex: fl });
  }

  return {
    torso: torso.build(),
    head: head.build(),
    tris: torso.tris + head.tris,
    neckY: 0.42,
    h,
    rest,
    channels: [
      { ch: CHN.ANT_A, kind: 'antenna', side: 1 },
      { ch: CHN.ANT_B, kind: 'antenna', side: -1 },
    ],
    blink: [2.8, 6.5],
    look: 0.5,
  };
}
