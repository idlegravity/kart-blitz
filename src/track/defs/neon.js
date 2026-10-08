/**
 * Neon Skyway — track definition (data only). A figure-eight highway: pass 1 (low deck) runs under pass 2
 * (high deck) at the origin. Lobe A turns right and climbs, lobe B turns left and descends.
 * The straights of each lobe are solved so both lobes close exactly through the crossing.
 */
import { turtle } from './turtle.js';

const D2R = Math.PI / 180;
const fwd = (hDeg) => [Math.sin(hDeg * D2R), Math.cos(hDeg * D2R)];

/** Straight lengths (pre, post) so that `arcs` starting at `from` (heading hIn) end exactly at `target` heading hOut. */
function solveStraights(from, hIn, arcs, target, hOut) {
  const probe = turtle({ x: from[0], z: from[1], heading: hIn, segs: arcs, first: false });
  const D = [probe.end.x - from[0], probe.end.z - from[1]];
  const fi = fwd(hIn), fo = fwd(hOut);
  const rhs = [target[0] - from[0] - D[0], target[1] - from[1] - D[1]];
  const det = fi[0] * fo[1] - fi[1] * fo[0];
  return { pre: (rhs[0] * fo[1] - rhs[1] * fo[0]) / det, post: (fi[0] * rhs[1] - fi[1] * rhs[0]) / det };
}

const H1 = 135, H2 = 225; // headings of pass 1 / pass 2 through the crossing (forward = (sin h, cos h))
const START_BACK = 78; // the start line sits this far before the crossing
const f1 = fwd(H1);
const S0 = [-f1[0] * START_BACK, -f1[1] * START_BACK];

// arcs: [kind, radius, degrees, absolute y at arc end]; (A turns right and climbs, B turns left and descends)
const arcsA = [['R', 91.6, 105.6, 27], ['R', 114.8, 61.7, 32], ['R', 89.1, 102.7, 35]];
const arcsB = [['L', 106.5, 92.6, 41], ['L', 129.8, 82.8, 32], ['L', 58, 94.7, 26]];
const A = solveStraights([0, 0], H1, arcsA, [0, 0], H2);
const B = solveStraights([0, 0], H2, arcsB, S0, H1);

const seq = [
  ['S', START_BACK + A.pre, 24],
  ...arcsA,
  ['S', A.post + B.pre, 40],
  ...arcsB,
  ['S', B.post, 22],
];

const built = turtle({ x: S0[0], z: S0[1], y: 22, heading: H1, hw: 10.5, bankScale: 720, maxBank: 13, segs: seq, step: 20 });

export default {
  id: 'neon',
  theme: 'neon',
  seed: 41,
  laps: 3,
  halfWidth: 10.5,
  noGround: true,
  shoulder: 0.5,
  curbs: false,
  blend: 40,
  itemRows: [{ s: 150 }, { s: 420 }, { s: 690 }, { s: 900 }, { s: 1130 }],
  boost: [
    { s: 40, length: 14, lateral: 0, width: 8 },
    { s: 736, length: 14, lateral: 0, width: 8 },
    { s: 905, length: 14, lateral: 0, width: 8 },
    { s: 1225, length: 14, lateral: 0, width: 8 },
  ],
  ramps: [{ s: 769, length: 11, launch: 12, height: 1.5 }],
  gaps: [{ s0: 780, s1: 795 }],
  // neon rails, with deliberate rail-less stretches (lobe middles) where a mistake means a fall
  walls: [
    { side: 'both', s0: 1290, s1: 318, style: 'rail', offset: 0.55, margin: 0.35 },
    { side: 'both', s0: 472, s1: 774, style: 'rail', offset: 0.55, margin: 0.35 },
    { side: 'both', s0: 802, s1: 955, style: 'rail', offset: 0.55, margin: 0.35 },
    { side: 'both', s0: 1068, s1: 1284, style: 'rail', offset: 0.55, margin: 0.35 },
  ],
  railColors: ['#22e6ff', '#ff2ee6'],
  gates: [{ s: 132 }, { s: 296 }, { s: 640 }, { s: 862 }, { s: 1032 }, { s: 1236 }],
  billboards: [
    { s: 190, side: -1, offset: 34, up: 20, size: 30 }, { s: 410, side: 1, offset: 38, up: 22, size: 32 },
    { s: 600, side: -1, offset: 34, up: 18, size: 28 }, { s: 905, side: 1, offset: 36, up: 20, size: 30 },
    { s: 1090, side: -1, offset: 36, up: 20, size: 30 }, { s: 1245, side: 1, offset: 34, up: 20, size: 28 },
  ],
  points: built.points.slice(0, -1),
  _solve: { A, B },
};
