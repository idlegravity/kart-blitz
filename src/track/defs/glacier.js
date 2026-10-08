/**
 * Frostbite Pass — track definition (data only).
 * Stations (s): start 0 · right sweeper ~130-240 · S-bends 300-350 · hairpin ~370-470 · ice cave 500-590 ·
 * frozen lake ~600-760 · downhill jump ~830-870 · final sweep 1100+.
 */
import { turtle, closer } from './turtle.js';

const seg = turtle({
  x: 0, z: 0, y: 0, heading: 90, hw: 11,
  segs: [
    ['S', 125, 0],
    ['R', 62, 100, 4],
    ['S', 50, 8],
    ['L', 42, 75, 12],
    ['S', 28, 14],
    ['R', 30, 160, 18],
    ['S', 140, 23],
    ['L', 50, 60, 24],
    ['S', 70, 23],
    ['R', 48, 100, 17],
    ['S', 95, 8],
    ['L', 60, 40, 3],
  ],
});
const extra = closer(seg.end, { x: -50, z: 0, y: 0, heading: 90 }, { count: 5, tension: 0.8, hw: 11 });

export default {
  id: 'glacier',
  theme: 'glacier',
  seed: 37,
  laps: 3,
  halfWidth: 10,
  autoBank: { scale: 520, max: 9 },
  shoulder: 4.5,
  curbCurvature: 1 / 150,
  blend: 44,
  itemRows: [{ s: 150 }, { s: 420 }, { s: 660 }, { s: 780 }, { s: 990 }],
  boost: [
    { s: 60, length: 14, lateral: 0, width: 8 },
    { s: 798, length: 14, lateral: 0, width: 8 },
    { s: 1010, length: 14, lateral: 0, width: 8 },
  ],
  ramps: [{ s: 838, length: 11, launch: 10, height: 1.4 }],
  walls: [
    { side: 'both', s0: 1235, s1: 484, style: 'snow', offset: 4.6 },
    { side: 'both', s0: 486, s1: 578, style: 'cave', offset: 6.6, margin: 0.3 },
    { side: 'both', s0: 782, s1: 1230, style: 'snow', offset: 4.6 },
  ],
  cave: { s0: 494, s1: 574 },
  frozenLake: { s0: 596, s1: 772, width: 105 },
  surfaces: [
    { type: 'ice', s0: 606, s1: 760 },
    { type: 'ice', s0: 388, s1: 444, l0: 1.5, l1: 12 },
    { type: 'ice', s0: 930, s1: 985, l0: -12, l1: -1.5 },
  ],
  grandstand: { s: 4, side: 1, length: 62, palette: { conc: '#a9b8d0', concDark: '#7a8bab', seatA: '#4a8fe0', seatB: '#f4f8ff', roofA: '#2c7be0', roofB: '#ffffff', pillar: '#26466f' } },
  points: [...seg.points, ...extra, [-25, 0, 0, 11, 0]],
};
