/**
 * Frost — penguin: navy body, white heart face & belly, orange beak, blue knit beanie with a bobbing pom-pom,
 * long striped scarf trailing behind (flutters with speed).
 */
import * as THREE from 'three';
import { G, PartBuilder, CHN, FUR, CLOTH, GLOSS, headBase, eyePair, blush, pathTube, torsoAndArms, shade, smooth, mix } from './common.js';

export function buildFrost(ctx) {
  const C = ctx.palette;
  const torso = new PartBuilder(), head = new PartBuilder();
  const blue = C.primary, navy = C.secondary, white = new THREE.Color('#ffffff');
  const orange = '#ff9a1f';
  const cy = 0.275;

  // ---------------- torso ----------------
  const rest = torsoAndArms(torso, ctx, { body: navy, belly: white, sleeve: navy, glove: shade(navy, 0.05), rx: 0.235, ry: 0.28, rz: 0.215, cy: 0.17, gloveR: 0.072, armR: 0.058 });
  // scarf: neck wrap + two trailing ribbons (striped)
  torso.add(G.torus(0.165, 0.058, 16, 6), { p: [0, 0.41, 0.0], r: [Math.PI / 2, 0, 0], s: [1, 1.05, 1], ...CLOTH(white, { rough: 0.9 }) });
  torso.add(G.ell(0.06, 0.06, 0.06, 8, 6), { p: [0.05, 0.4, -0.16], ...CLOTH(blue, { rough: 0.9 }) });
  const stripe = (t, out) => out.copy(Math.floor(t * 7) % 2 ? blue : white);
  const scarfFlex = { ch: CHN.SCARF, pivot: [0.05, 0.4, -0.15], dir: [0, -0.3, -1], len: 0.7, pow: 0.9, phase: 1 };
  pathTube(torso, [[0.06, 0.4, -0.16], [0.11, 0.33, -0.34], [0.14, 0.23, -0.55], [0.13, 0.1, -0.78]], () => 0.055, {
    segments: 8, ring: 6, flatX: 1, flatY: 0.22, up: [0, 1, 0], capStart: 0.02, capEnd: 0.02, capRings: 1, surf: CLOTH(white, { rough: 0.9 }), colorAt: stripe, flex: scarfFlex,
  });
  pathTube(torso, [[0.03, 0.4, -0.16], [-0.02, 0.34, -0.3], [-0.06, 0.27, -0.46]], () => 0.05, {
    segments: 6, ring: 6, flatX: 1, flatY: 0.22, up: [0, 1, 0], capStart: 0.02, capEnd: 0.02, capRings: 1, surf: CLOTH(white, { rough: 0.9 }), colorAt: stripe, flex: { ...scarfFlex, len: 0.55, phase: 1.3 },
  });

  // ---------------- head ----------------
  const h = headBase(head, { cy, rx: 0.31, ry: 0.27, rz: 0.29, color: navy });
  const hf = { ...h, rz: h.rz + 0.035 }; // face mask protrudes a little
  head.addSym(G.ell(0.16, 0.16, 0.1, 10, 8), { p: [0.1, 0.27, 0.2], ...FUR(white, { rough: 0.7 }) });
  head.add(G.ell(0.2, 0.12, 0.14, 10, 7), { p: [0, 0.17, 0.17], ...FUR(white, { rough: 0.7 }) });
  eyePair(head, hf, { x: 0.105, y: 0.3, rx: 0.046, ry: 0.06, depth: 0.04, tilt: 0.2 });
  blush(head, hf, { x: 0.19, y: 0.2, color: '#ff8fa8', rx: 0.045, ry: 0.028 });
  // beak
  head.add(G.cone(0.062, 0.15, 8), { p: [0, 0.22, 0.355], r: [Math.PI / 2, 0, 0], s: [1.25, 1, 0.55], ...FUR(orange, { rough: 0.45, clear: 0.4 }) });
  head.add(G.cone(0.05, 0.11, 8), { p: [0, 0.185, 0.335], r: [Math.PI / 2, 0, 0], s: [1.1, 1, 0.4], ...FUR(shade(orange, -0.06), { rough: 0.45, clear: 0.4 }) });

  // beanie (tilted back so the eyes stay visible): dome + cuff + pom-pom
  const tilt = -0.3;
  const dc = new THREE.Vector3(0, 0.395, -0.03);
  const rot = new THREE.Euler(tilt, 0, 0);
  const at = (x, y, z) => new THREE.Vector3(x, y, z).applyEuler(rot).add(dc);
  head.add(G.ell(0.312, 0.23, 0.3, 16, 8, Math.PI * 0.5), { p: [dc.x, dc.y, dc.z], r: [tilt, 0, 0], ...FUR(blue, { rough: 0.95 }) });
  head.add(G.torus(0.305, 0.05, 18, 5), { p: [dc.x, dc.y, dc.z], r: [tilt + Math.PI / 2, 0, 0], s: [1, 0.98, 1], ...FUR(shade(blue, 0.14), { rough: 0.95 }) });
  const top = at(0, 0.23 + 0.02, 0);
  const pomFlex = { ch: CHN.ANT_A, pivot: [top.x, top.y - 0.04, top.z], dir: [0, 1, 0], len: 0.14, pow: 1 };
  head.add(G.ell(0.09, 0.09, 0.09, 10, 8), { p: [top.x, top.y + 0.06, top.z], ...FUR(white, { rough: 0.95 }), flex: pomFlex });

  return {
    torso: torso.build(),
    head: head.build(),
    tris: torso.tris + head.tris,
    neckY: 0.42,
    h,
    rest,
    channels: [
      { ch: CHN.SCARF, kind: 'scarf', amp: 1 },
      { ch: CHN.ANT_A, kind: 'pom' },
    ],
    blink: [2.2, 5.5],
    look: 0.4,
  };
}
