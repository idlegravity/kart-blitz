/**
 * Blaze — red-orange fox: big pointed dark-tipped ears, white muzzle & cheek fluff, bushy white-tipped tail
 * curling up behind the seat, aviator goggles pushed up on the forehead.
 */
import * as THREE from 'three';
import { G, PartBuilder, orient, smooth, blendFn, FUR, CLOTH, GLOSS, GLOW, SHINY, CHN, headBase, eyePair, smile, pathTube, torsoAndArms, frontZ, toColor } from './common.js';

export function buildBlaze(ctx) {
  const C = ctx.palette;
  const torso = new PartBuilder(), head = new PartBuilder();
  const fur = C.primary, cream = C.secondary;
  const tipDark = new THREE.Color('#2b120c');
  const cy = 0.275;

  // ---------------- torso ----------------
  const rest = torsoAndArms(torso, ctx, { body: fur, belly: cream, sleeve: fur, glove: cream, rx: 0.22, ry: 0.27, rz: 0.19 });
  // fluffy cream neck ruff
  torso.add(G.torus(0.15, 0.06, 16, 7), { p: [0, 0.4, 0.0], r: [Math.PI / 2, 0, 0], s: [1, 1.05, 1], ...FUR(cream, { rough: 0.85 }) });
  // bushy white-tipped tail curling up behind the seat
  pathTube(
    torso,
    [[0, 0.08, -0.16], [0, 0.04, -0.36], [0, 0.14, -0.54], [0, 0.36, -0.63], [0, 0.6, -0.55], [0, 0.76, -0.4]],
    (t) => (0.058 + 0.1 * Math.sin(Math.PI * Math.pow(t, 0.75))) * (1 - 0.55 * smooth(0.86, 1, t)),
    {
      segments: 15,
      ring: 10,
      capStart: 0.05,
      capEnd: 0.05,
      surf: FUR(fur, { rough: 0.8 }),
      colorAt: (t, out) => out.copy(fur).lerp(cream, smooth(0.74, 0.8, t)),
      flex: { ch: CHN.TAIL, pivot: [0, 0.08, -0.16], dir: [0, 0.68, -0.3], len: 0.75, pow: 1.1 },
    },
  );

  // ---------------- head ----------------
  const h = headBase(head, {
    color: fur,
    cy,
    colorFn: blendFn(fur, cream, (p) => smooth(-0.02, -0.13, p.y - cy) * smooth(0.04, 0.17, p.z)),
  });
  // muzzle, nose, cheek tufts
  head.add(G.ell(0.14, 0.1, 0.155, 14, 10), { p: [0, 0.19, 0.26], ...FUR(cream) });
  head.add(G.ell(0.043, 0.033, 0.035, 10, 8), { p: [0, 0.226, 0.417], ...GLOSS('#1a0c09') });
  smile(head, h, { y: 0.15, w: 0.07, depth: 0.02, z: 0.386, color: '#4a1d12' });
  head.addSym(G.ell(0.1, 0.075, 0.1, 9, 6), { p: [0.245, 0.19, 0.075], r: [0, 0.4, 0.2], ...FUR(cream) });
  head.addSym(G.cone(0.05, 0.12, 6), { p: [0.31, 0.16, 0.02], r: [0, 0, -1.95], ...FUR(cream) });
  eyePair(head, h, { x: 0.125, y: 0.3, rx: 0.06, ry: 0.079, iris: '#f1a51f', irisScale: 0.8 });

  // ears (pointed, dark tips, bend at the base)
  {
    const ang = { z: -0.26, x: -0.14 };
    const axisL = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(ang.x, 0, ang.z, 'XYZ'));
    const base = new THREE.Vector3(0.185, 0.45, -0.02);
    const len = 0.36;
    const c = base.clone().addScaledVector(axisL, len / 2);
    const tipCol = tipDark;
    const earFlex = { ch: CHN.EAR_L, chR: CHN.EAR_R, pivot: [base.x, base.y - 0.03, base.z], dir: [axisL.x, axisL.y, axisL.z], len: len + 0.02, pow: 1.3 };
    head.addSym(G.cone(0.125, len, 16), {
      p: [c.x, c.y, c.z],
      r: [ang.x, 0, ang.z],
      s: [1, 1, 0.6],
      ...FUR(fur),
      colorFn: (p) => {
        const t = ((p.x - base.x) * axisL.x + (p.y - base.y) * axisL.y + (p.z - base.z) * axisL.z) / len;
        return tmpMix(fur, tipCol, smooth(0.6, 0.72, t));
      },
      flex: earFlex,
    });
    // inner ear (cream-pink)
    const c2 = base.clone().addScaledVector(axisL, len * 0.46).add(new THREE.Vector3(-0.008, 0, 0.038));
    head.addSym(G.cone(0.08, len * 0.78, 12), { p: [c2.x, c2.y, c2.z], r: [ang.x, 0, ang.z], s: [1, 1, 0.4], ...FUR('#ffd9c9', { rough: 0.85 }), flex: earFlex });
  }

  // aviator goggles on the forehead: strap + two lenses
  head.add(G.torus(0.262, 0.02, 30, 6), { p: [0, 0.43, -0.005], r: [Math.PI / 2, 0, 0], s: [1, 0.95, 1], ...FUR('#5a3320', { rough: 0.6 }) });
  for (const s of [1, -1]) {
    const x = 0.088 * s, y = 0.478;
    const z = frontZ(h, x, y) + 0.012;
    const q = orient([s * 0.12, 0.5, 0.86], [0, 1, 0]);
    head.add(G.torus(0.064, 0.015, 16, 6), { p: [x, y, z], q, ...{ color: '#e6ebf5', rough: 0.12, metal: 1, ao: 0.05 } });
    head.add(G.ell(0.058, 0.058, 0.014, 12, 6), { p: [x, y, z + 0.004], q, color: '#7fd9ff', rough: 0.04, metal: 0.3, clear: 1, emis: 0.25, ao: 0 });
  }
  head.add(G.ell(0.028, 0.012, 0.012, 8, 5), { p: [0, 0.48, frontZ(h, 0, 0.48) + 0.015], color: '#e6ebf5', rough: 0.12, metal: 1, ao: 0 });

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
      { ch: CHN.TAIL, kind: 'tail', amp: 0.55 },
    ],
    blink: [2.2, 5],
    look: 0.4,
  };
}

const _c = new THREE.Color();
function tmpMix(a, b, t) {
  return _c.copy(toColor(a)).lerp(toColor(b), t);
}
