/**
 * Canyon Rush — track definition (data only). Points: [x, y, z, halfWidth, bankDegrees].
 * Stations (s): start 0 · canyon sweeper 100-330 · S-bends 350-480 · chasm jump 632-661 · mesa U-turn 724-917 · arch ~985.
 */
export default {
  id: 'canyon',
  theme: 'canyon',
  seed: 23,
  laps: 3,
  halfWidth: 10,
  autoBank: { scale: 640, max: 11 },
  shoulder: 5,
  curbCurvature: 1 / 170,
  blend: 46,
  itemRows: [{ s: 140 }, { s: 338 }, { s: 572 }, { s: 812 }, { s: 1064 }],
  boost: [
    { s: 40, length: 14, lateral: 0, width: 8 },
    { s: 590, length: 14, lateral: 0, width: 8 },
    { s: 946, length: 14, lateral: 0, width: 8 },
  ],
  surfaces: [
    { type: 'offroad', look: 'sand', s0: 270, s1: 304, l0: -1.2, l1: 10 },
    { type: 'offroad', look: 'sand', s0: 852, s1: 884, l0: -10, l1: 1.2 },
  ],
  ramps: [{ s: 632, length: 11, launch: 11.5, height: 1.5 }],
  gaps: [{ s0: 643, s1: 660 }],
  // rock walls: cliffs rise right at the wall line (margin keeps the flat band tight)
  walls: [
    { side: 'both', s0: 142, s1: 505, style: 'rock', offset: 5.5, margin: 0.3 },
    { side: 'both', s0: 598, s1: 745, style: 'rock', offset: 5.5, margin: 0.3 },
    { side: 'left', s0: 745, s1: 915, style: 'rock', offset: 5.5, margin: 0.3 },
    { side: 'right', s0: 745, s1: 915, style: 'woodfence', offset: 4.5 },
    { side: 'both', s0: 950, s1: 1030, style: 'rock', offset: 5.5, margin: 0.3 },
    { side: 'both', s0: 1170, s1: 100, style: 'woodfence', offset: 4.5 },
  ],
  // terrain cliff height beside the road (metres above the road) by station range
  cliffs: [
    { s0: 142, s1: 505, height: 34 },
    { s0: 598, s1: 745, height: 30 },
    { s0: 745, s1: 915, height: 38, sides: 'left' },
    { s0: 950, s1: 1030, height: 30 },
  ],
  blendRanges: [
    { s0: 130, s1: 515, width: 9 },
    { s0: 588, s1: 755, width: 9 },
    { s0: 735, s1: 925, width: 12 },
    { s0: 940, s1: 1040, width: 9 },
  ],
  arch: { s: 990 },
  points: [
    [0, 0, 0, 11, 0],
    [95, 0, 0, 11, 0],
    [160, 2, -34, 10, -6],
    [200, 6, -100, 10, -8],
    [197, 8, -178, 10, -8],
    [160, 10, -235, 9, 6],
    [100, 11, -252, 9, 8],
    [50, 12, -294, 9, -6],
    [-15, 12, -323, 10, 0],
    [-92, 10, -323, 10, 0],
    [-168, 10, -315, 10, -6],
    [-218, 8, -269, 10, -8],
    [-206, 6, -202, 10, -8],
    [-150, 4.2, -160, 10, -4],
    [-98, 3.6, -124, 10, 4],
    [-88, 2.4, -66, 10, 4],
    [-80, 1.0, -22, 10, 2],
    [-52, 0.2, -3, 11, 0],
    [-26, 0, 0, 11, 0],
  ],
};
