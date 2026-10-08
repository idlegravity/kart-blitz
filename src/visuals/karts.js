/**
 * Kart chassis, wheel and steering-wheel builders for the three body styles:
 *   light  = compact buggy with an exposed tube frame, roll hoop and big rear tyres
 *   medium = classic sleek kart: pointed nose, side pods, front wing, rear spoiler
 *   heavy  = chunky muscle kart: big hood + scoop, fenders, chrome bumper, twin chrome exhaust stacks
 * Hull space: origin at the ground contact point under the kart, +Z forward, +X = kart LEFT, +Y up.
 * Triangle budget (high quality): chassis <= ~3.1k, wheel ~520, steering ~300 (see dev/visuals/tris.mjs).
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { G, PartBuilder, sweep, tube, orient, shade, mixColor, smooth, mix, TAU, getDetail } from './geo.js';
import { regionUV } from './atlas.js';

/** Layout constants shared by the chassis, driver and animation code. */
export const KART_CLASSES = {
  light: {
    wheels: { front: { x: 0.6, z: 0.72, r: 0.27, w: 0.2 }, rear: { x: 0.66, z: -0.62, r: 0.42, w: 0.4 } },
    seat: [0, 0.4, -0.32],
    steer: { pos: [0, 0.86, 0.1], tilt: 0.42, R: 0.16 },
    exhausts: [[0.17, 0.55, -1.23], [-0.17, 0.55, -1.23]],
    back: [0, 0.6, -1.2],
    nose: [0, 0.36, 1.05],
  },
  medium: {
    wheels: { front: { x: 0.62, z: 0.78, r: 0.3, w: 0.26 }, rear: { x: 0.63, z: -0.68, r: 0.35, w: 0.34 } },
    seat: [0, 0.55, -0.36],
    steer: { pos: [0, 0.9, 0.08], tilt: 0.4, R: 0.17 },
    exhausts: [[0.2, 0.31, -1.27], [-0.2, 0.31, -1.27]],
    back: [0, 0.5, -1.25],
    nose: [0, 0.34, 1.13],
  },
  heavy: {
    wheels: { front: { x: 0.64, z: 0.86, r: 0.35, w: 0.34 }, rear: { x: 0.64, z: -0.74, r: 0.41, w: 0.44 } },
    seat: [0, 0.64, -0.44],
    steer: { pos: [0, 1.0, -0.06], tilt: 0.4, R: 0.19 },
    exhausts: [[0.36, 1.2, -0.94], [-0.36, 1.2, -0.94]],
    back: [0, 0.75, -1.3],
    nose: [0, 0.5, 1.3],
  },
};

/** Character palette (THREE.Color, linear). */
export function makePalette(character) {
  const c = character.colors;
  const primary = new THREE.Color(c.primary), secondary = new THREE.Color(c.secondary), accent = new THREE.Color(c.accent);
  return {
    primary,
    secondary,
    accent,
    primaryDark: shade(primary, -0.16),
    primaryLight: shade(primary, 0.1),
  };
}

// ---- surface presets -------------------------------------------------------------------------------------------
const paint = (color, o = {}) => ({ color, rough: 0.26, clear: 1, ao: 0.28, ...o });
const chrome = (o = {}) => ({ color: '#f1f4fa', rough: 0.1, metal: 1, ao: 0.08, ...o });
const steel = (o = {}) => ({ color: '#5a6577', rough: 0.35, metal: 0.9, ao: 0.15, ...o });
const rubber = (o = {}) => ({ color: '#16171c', rough: 0.88, ao: 0.2, ...o });
const plastic = (color = '#242732', o = {}) => ({ color, rough: 0.48, ao: 0.25, ...o });
const lamp = (color, e = 2.2, o = {}) => ({ color, rough: 0.2, emis: e, ao: 0, ...o });

export const SURF = { paint, chrome, steel, rubber, plastic, lamp };

/**
 * Rounded rectangular prism between two points (rx along the frame side axis, ry along the frame up axis).
 * o: { e, ring, capS, capE, capRings, up }; capS/capE = 0 gives flat open ends (cheapest).
 */
export function bar(p0, p1, rx, ry = rx, o = {}) {
  const e = o.e ?? 3;
  const capS = o.capS ?? Math.min(rx, ry) * 0.9;
  const capE = o.capE ?? capS;
  return sweep(
    [
      { p: p0, rx, ry, e },
      { p: p1, rx, ry, e },
    ],
    { ring: o.ring ?? 8, capStart: capS, capEnd: capE, capRings: o.capRings ?? 1, up: o.up },
  );
}
/** Thin strut: 6-sided, open ends. */
export const strut = (p0, p1, r, ry = r) => bar(p0, p1, r, ry, { ring: 6, capS: 0, e: 2 });

/** Arc of a curved plate over a wheel (fender). */
function fenderArc(cx, cy, cz, R, thick, width, a0 = -1.2, a1 = 1.2, n = 7) {
  const st = [];
  for (let i = 0; i < n; i++) {
    const a = mix(a0, a1, i / (n - 1));
    st.push({ p: [cx, cy + Math.cos(a) * R, cz + Math.sin(a) * R], rx: thick, ry: width, e: 3 });
  }
  return sweep(st, { ring: 6, up: [1, 0, 0], capStart: thick, capEnd: thick, capRings: 1 });
}

function roundel(b, pos, normal, up, radius) {
  b.add(new THREE.CircleGeometry(radius, 16), {
    q: orient(normal, up),
    p: pos,
    uvRegion: regionUV('roundel', 3),
    ao: 0,
    rough: 0.32,
    clear: 1,
  });
}

/** Exhaust tip cap (dark disc) facing `dir`. */
function pipeCap(b, p, r, dir = [0, 0, -1]) {
  b.add(new THREE.CircleGeometry(r, 8), { p, q: orient(dir), ...plastic('#050505', { ao: 0 }) });
}

// =================================================================================================================
// MEDIUM — classic sleek kart
// =================================================================================================================
function buildMedium(C, cls) {
  const b = new PartBuilder();
  const P1 = paint(C.primary), P2 = paint(C.secondary);
  const dark = plastic('#1d2029');

  // main hull
  b.add(
    sweep(
      [
        { p: [0, 0.36, -0.9], rx: 0.3, ry: 0.13, e: 2.6 },
        { p: [0, 0.38, -0.78], rx: 0.38, ry: 0.17, e: 2.7 },
        { p: [0, 0.38, -0.55], rx: 0.44, ry: 0.19, e: 2.8 },
        { p: [0, 0.37, -0.2], rx: 0.46, ry: 0.18, e: 2.8 },
        { p: [0, 0.36, 0.15], rx: 0.43, ry: 0.16, e: 2.7 },
        { p: [0, 0.34, 0.5], rx: 0.36, ry: 0.13, e: 2.6 },
        { p: [0, 0.32, 0.85], rx: 0.24, ry: 0.1, e: 2.4 },
        { p: [0, 0.31, 1.02], rx: 0.15, ry: 0.08, e: 2.2 },
      ],
      { ring: 24, capStart: 0.16, capEnd: 0.1, capRings: 3 },
    ),
    { ...P1, uvRegion: regionUV('stripes') },
  );

  // side pods (secondary) + vents
  b.addSym(
    sweep(
      [
        { p: [0.55, 0.34, -0.28], rx: 0.1, ry: 0.1, e: 2.4 },
        { p: [0.55, 0.34, 0.04], rx: 0.11, ry: 0.11, e: 2.4 },
        { p: [0.55, 0.33, 0.32], rx: 0.09, ry: 0.09, e: 2.4 },
      ],
      { ring: 10, capStart: 0.09, capEnd: 0.14, capRings: 2 },
    ),
    P2,
  );
  for (const z of [-0.14, -0.03]) b.addSym(G.cube(0.014, 0.07, 0.05), { p: [0.655, 0.37, z], ...dark, ao: 0 });

  // cockpit coaming + dash cowl + steering column
  b.add(G.torus(0.27, 0.03, 18, 5), { p: [0, 0.58, -0.36], r: [Math.PI / 2, 0, 0], s: [1, 1.18, 1], ...paint(C.secondary, { ao: 0.15 }) });
  b.add(
    sweep(
      [
        { p: [0, 0.55, 0.12], rx: 0.26, ry: 0.08, e: 3 },
        { p: [0, 0.57, 0.3], rx: 0.22, ry: 0.07, e: 3 },
      ],
      { ring: 10, capStart: 0.06, capEnd: 0.1, capRings: 1 },
    ),
    { ...P1 },
  );
  b.add(strut([0, 0.62, 0.24], [0, 0.88, 0.09], 0.022), steel());

  // seat back + headrest
  const seatCol = plastic(mixColor(C.primary, '#0d1016', 0.7), { rough: 0.4, clear: 0.5 });
  b.add(bar([0, 0.58, -0.6], [0, 0.8, -0.64], 0.2, 0.05, { ring: 10 }), seatCol);
  b.add(bar([0, 0.77, -0.62], [0, 0.81, -0.635], 0.17, 0.055, { ring: 8 }), { ...P2 });

  // front wing + end plates + pylons
  b.add(bar([-0.73, 0.2, 1.0], [0.73, 0.2, 1.0], 0.12, 0.018, { ring: 10, capS: 0.05 }), { ...P2 });
  b.addSym(G.cube(0.03, 0.13, 0.28), { p: [0.745, 0.205, 1.0], ...P1 });
  b.addSym(strut([0.14, 0.24, 0.98], [0.14, 0.3, 0.96], 0.02, 0.03), steel());

  // rear spoiler (kept low & slim so the driver stays readable from behind)
  b.add(bar([-0.44, 0.64, -1.0], [0.44, 0.64, -1.0], 0.11, 0.016, { ring: 10, capS: 0.04 }), { ...P2 });
  b.addSym(G.cube(0.022, 0.13, 0.25), { p: [0.455, 0.64, -1.0], ...P1 });
  b.addSym(strut([0.28, 0.46, -0.96], [0.28, 0.63, -1.0], 0.02, 0.028), steel());

  // tail lamps + bumper + exhaust
  b.addSym(G.ell(0.055, 0.035, 0.03, 8, 5), { p: [0.17, 0.4, -1.0], ...lamp('#ff2a2a', 2.6), brake: true });
  b.add(bar([-0.32, 0.25, -1.02], [0.32, 0.25, -1.02], 0.05, 0.035, { ring: 8 }), dark);
  for (const s of [1, -1]) {
    b.add(G.cyl(0.043, 0.05, 0.3, 8), { p: [0.2 * s, 0.31, -1.12], r: [Math.PI / 2, 0, 0], ...chrome() });
    pipeCap(b, [0.2 * s, 0.31, -1.268], 0.032);
  }

  // headlamps
  b.addSym(G.ell(0.05, 0.035, 0.04, 6, 4), { p: [0.11, 0.35, 1.02], ...lamp('#fff2c8', 2.2) });

  // decals: nose roundel, tail plate, side roundels
  roundel(b, [0, 0.445, 0.62], [0, 1, 0.16], [0, 0, -1], 0.15);
  // tail number plate
  b.add(bar([0, 0.45, -1.0], [0, 0.45, -1.035], 0.15, 0.085, { ring: 10, capS: 0.02 }), { ...P2 });
  roundel(b, [0, 0.45, -1.064], [0, 0, -1], [0, 1, 0], 0.078);
  roundel(b, [0.655, 0.335, 0.22], [1, 0.02, 0], [0, 1, 0], 0.07);
  roundel(b, [-0.655, 0.335, 0.22], [-1, 0.02, 0], [0, 1, 0], 0.07);

  return { geo: b.build(), tris: b.tris, log: b.log };
}

// =================================================================================================================
// HEAVY — chunky muscle kart
// =================================================================================================================
function buildHeavy(C, cls) {
  const b = new PartBuilder();
  const P1 = paint(C.primary), P2 = paint(C.secondary);
  const dark = plastic('#1b1d24');
  const W = cls.wheels;

  // fat hull
  b.add(
    sweep(
      [
        { p: [0, 0.42, -1.0], rx: 0.32, ry: 0.17, e: 2.8 },
        { p: [0, 0.44, -0.86], rx: 0.44, ry: 0.22, e: 3.0 },
        { p: [0, 0.44, -0.5], rx: 0.5, ry: 0.24, e: 3.2 },
        { p: [0, 0.44, -0.05], rx: 0.5, ry: 0.23, e: 3.2 },
        { p: [0, 0.42, 0.4], rx: 0.49, ry: 0.21, e: 3.2 },
        { p: [0, 0.4, 0.9], rx: 0.47, ry: 0.18, e: 3.0 },
        { p: [0, 0.38, 1.14], rx: 0.42, ry: 0.15, e: 2.8 },
      ],
      { ring: 22, capStart: 0.12, capEnd: 0.08, capRings: 3 },
    ),
    { ...P1, uvRegion: regionUV('stripes') },
  );

  // big hood (raised) with twin stripes + scoop
  b.add(
    sweep(
      [
        { p: [0, 0.62, 0.05], rx: 0.34, ry: 0.1, e: 3.2 },
        { p: [0, 0.64, 0.5], rx: 0.34, ry: 0.11, e: 3.2 },
        { p: [0, 0.6, 0.98], rx: 0.31, ry: 0.09, e: 3.0 },
      ],
      { ring: 14, capStart: 0.08, capEnd: 0.1, capRings: 2 },
    ),
    { ...P1, uvRegion: regionUV('stripes') },
  );
  b.add(bar([0, 0.76, 0.28], [0, 0.78, 0.62], 0.14, 0.05, { ring: 10 }), dark);
  for (const z of [0.38, 0.5]) b.add(G.cube(0.22, 0.012, 0.03), { p: [0, 0.812, z], ...chrome(), ao: 0 });

  // fenders over the wheels (primary)
  for (const s of [1, -1]) {
    const f = W.front, r = W.rear;
    b.add(fenderArc(s * f.x, f.r, f.z, f.r + 0.06, 0.026, f.w / 2 + 0.05), { ...P1 });
    b.add(fenderArc(s * r.x, r.r, r.z, r.r + 0.06, 0.028, r.w / 2 + 0.05), { ...P1 });
  }

  // side skirts (secondary) + roundels
  b.addSym(bar([0.53, 0.3, -0.42], [0.53, 0.3, 0.5], 0.03, 0.07, { ring: 8 }), P2);
  roundel(b, [0.562, 0.44, -0.52], [1, 0.04, 0], [0, 1, 0], 0.13);
  roundel(b, [-0.562, 0.44, -0.52], [-1, 0.04, 0], [0, 1, 0], 0.13);

  // chrome bumper + grille + headlights
  b.add(bar([-0.44, 0.33, 1.24], [0.44, 0.33, 1.24], 0.05, 0.055, { ring: 10, capS: 0.05 }), chrome());
  b.add(bar([-0.28, 0.5, 1.22], [0.28, 0.5, 1.22], 0.05, 0.1, { ring: 8, capS: 0.04 }), dark);
  for (const x of [-0.1, 0, 0.1]) b.add(G.cube(0.02, 0.15, 0.02), { p: [x, 0.5, 1.29], ...chrome(), ao: 0 });
  b.addSym(G.ell(0.075, 0.075, 0.05, 8, 6), { p: [0.34, 0.52, 1.16], ...lamp('#fff2c8', 2.4) });

  // cockpit coaming, dash, steering column
  b.add(G.torus(0.3, 0.035, 18, 5), { p: [0, 0.66, -0.44], r: [Math.PI / 2, 0, 0], s: [1, 1.2, 1], ...paint(C.secondary, { ao: 0.15 }) });
  b.add(strut([0, 0.66, 0.24], [0, 0.98, -0.04], 0.027), steel());
  b.add(bar([-0.28, 0.72, 0.16], [0.28, 0.72, 0.16], 0.1, 0.06, { ring: 8 }), { ...P1 });

  // seat back (chunky) + headrest
  b.add(bar([0, 0.66, -0.72], [0, 0.9, -0.77], 0.25, 0.07, { ring: 10 }), plastic(mixColor(C.primary, '#0d1016', 0.7), { rough: 0.4, clear: 0.5 }));
  b.add(bar([0, 0.87, -0.74], [0, 0.91, -0.755], 0.21, 0.075, { ring: 8 }), { ...P2 });

  // twin chrome exhaust stacks (tips at cls.exhausts)
  for (const s of [1, -1]) {
    const x = 0.36 * s;
    b.add(
      tube([[x, 0.6, -0.76], [x, 0.85, -0.84], [x, 1.08, -0.9], [x, 1.2, -0.94]], (t) => 0.055 + 0.04 * smooth(0.65, 1, t), { segments: 8, ring: 8, capStart: 0.03, capEnd: 0.0, capRings: 1 }),
      chrome(),
    );
    pipeCap(b, [x, 1.205, -0.94], 0.075, [0, 1, -0.3]);
    b.add(bar([x, 0.58, -0.7], [x, 0.7, -0.76], 0.07, 0.03, { ring: 6, capS: 0 }), steel());
  }

  // rear: bumper, lamps, small ducktail, tail roundel
  b.add(bar([-0.42, 0.3, -1.06], [0.42, 0.3, -1.06], 0.05, 0.055, { ring: 8 }), chrome());
  b.addSym(G.ell(0.075, 0.04, 0.03, 8, 5), { p: [0.24, 0.5, -1.02], ...lamp('#ff2a2a', 2.6), brake: true });
  b.add(bar([-0.34, 0.66, -1.0], [0.34, 0.66, -1.0], 0.1, 0.02, { ring: 8 }), P2);
  roundel(b, [0, 0.52, -1.02], [0, 0.05, -1], [0, 1, 0], 0.1);

  return { geo: b.build(), tris: b.tris, log: b.log };
}

// =================================================================================================================
// LIGHT — exposed tube-frame buggy
// =================================================================================================================
function buildLight(C, cls) {
  const b = new PartBuilder();
  const P1 = paint(C.primary), P2 = paint(C.secondary);
  const W = cls.wheels;

  // floor pan + nose cone (primary) with roundel
  b.add(bar([0, 0.27, -0.82], [0, 0.27, 0.62], 0.36, 0.045, { ring: 10 }), { ...P2 });
  b.add(
    sweep(
      [
        { p: [0, 0.36, 0.36], rx: 0.28, ry: 0.11, e: 2.6 },
        { p: [0, 0.36, 0.72], rx: 0.2, ry: 0.09, e: 2.4 },
        { p: [0, 0.35, 0.95], rx: 0.12, ry: 0.07, e: 2.2 },
      ],
      { ring: 16, capStart: 0.12, capEnd: 0.09, capRings: 3 },
    ),
    { ...P1, uvRegion: regionUV('stripes') },
  );
  roundel(b, [0, 0.462, 0.62], [0, 1, 0.16], [0, 0, -1], 0.13);

  // side number plates (primary) with roundels
  b.addSym(bar([0.42, 0.44, -0.32], [0.42, 0.44, 0.28], 0.024, 0.1, { ring: 8 }), P1);
  roundel(b, [0.446, 0.44, -0.02], [1, 0, 0], [0, 1, 0], 0.085);
  roundel(b, [-0.446, 0.44, -0.02], [-1, 0, 0], [0, 1, 0], 0.085);

  // tube frame (chrome)
  const T = (pts, r, o = {}) => b.add(tube(pts, r, { ring: 6, segments: o.segments ?? Math.max(6, pts.length * 2), capRings: 1, ...o }), chrome({ ao: 0.05 }));
  T(
    [
      [0.36, 0.32, -0.5], [0.35, 0.8, -0.66], [0.28, 1.28, -0.8], [0.13, 1.56, -0.87], [0, 1.62, -0.88],
      [-0.13, 1.56, -0.87], [-0.28, 1.28, -0.8], [-0.35, 0.8, -0.66], [-0.36, 0.32, -0.5],
    ],
    0.03,
    { segments: 20 },
  );
  for (const s of [1, -1]) {
    T([[0.34 * s, 1.0, -0.7], [0.4 * s, 0.7, -0.95], [0.32 * s, 0.4, -1.02]], 0.022, { segments: 6 });
    T([[0.37 * s, 0.46, 0.8], [0.4 * s, 0.5, 0.2], [0.39 * s, 0.48, -0.5]], 0.024, { segments: 6 });
  }
  T([[0.34, 0.42, 0.7], [0.37, 0.36, 0.95], [0.2, 0.32, 1.1], [0, 0.31, 1.14], [-0.2, 0.32, 1.1], [-0.37, 0.36, 0.95], [-0.34, 0.42, 0.7]], 0.024, { segments: 14 });
  // axles (steel) — visible in the open frame
  b.add(bar([-0.62, W.front.r, W.front.z], [0.62, W.front.r, W.front.z], 0.03, 0.03, { e: 2, ring: 6, capS: 0 }), steel());
  b.add(bar([-0.66, W.rear.r, W.rear.z], [0.66, W.rear.r, W.rear.z], 0.038, 0.038, { e: 2, ring: 6, capS: 0 }), steel());
  // steering column + dash
  b.add(strut([0, 0.5, 0.3], [0, 0.84, 0.12], 0.02), steel());
  b.add(bar([-0.16, 0.52, 0.34], [0.16, 0.52, 0.34], 0.06, 0.05, { ring: 8 }), P1);

  // seat: cushion + shell (dark) with trim
  const seatCol = plastic(mixColor(C.primary, '#0d1016', 0.7), { rough: 0.4, clear: 0.5 });
  b.add(bar([0, 0.4, -0.5], [0, 0.42, -0.18], 0.21, 0.05, { ring: 8 }), seatCol);
  b.add(bar([0, 0.44, -0.5], [0, 0.74, -0.56], 0.2, 0.05, { ring: 8 }), seatCol);
  b.add(bar([0, 0.71, -0.55], [0, 0.75, -0.565], 0.16, 0.055, { ring: 8 }), { ...P2 });

  // rear engine block with fins + twin exhausts (tips at cls.exhausts)
  b.add(bar([0, 0.5, -1.07], [0, 0.5, -0.77], 0.23, 0.13, { e: 4, ring: 12, capS: 0.04 }), steel({ color: '#3d4452' }));
  for (const y of [0.44, 0.5, 0.56]) b.add(G.cube(0.5, 0.012, 0.32), { p: [0, y, -0.92], ...chrome({ rough: 0.25 }), ao: 0 });
  b.add(G.cyl(0.07, 0.07, 0.03, 8), { p: [0, 0.5, -0.76], r: [Math.PI / 2, 0, 0], ...paint(C.accent) });
  for (const s of [1, -1]) {
    b.add(tube([[0.14 * s, 0.5, -1.04], [0.16 * s, 0.52, -1.14], [0.17 * s, 0.55, -1.22]], 0.04, { segments: 4, ring: 6, capStart: 0.02, capEnd: 0.02, capRings: 1 }), chrome());
    pipeCap(b, [0.17 * s, 0.55, -1.228], 0.03);
  }
  b.addSym(G.ell(0.05, 0.035, 0.025, 8, 5), { p: [0.2, 0.42, -1.08], ...lamp('#ff2a2a', 2.6), brake: true });
  roundel(b, [0, 0.72, -1.0], [0, 0, -1], [0, 1, 0], 0.09);

  // headlamps
  b.addSym(G.ell(0.05, 0.04, 0.04, 6, 4), { p: [0.1, 0.36, 0.98], ...lamp('#fff2c8', 2.2) });

  return { geo: b.build(), tris: b.tris, log: b.log };
}

/** Build the (static) chassis geometry for a weight class. */
export function buildChassis(className, palette) {
  const cls = KART_CLASSES[className];
  const r = className === 'light' ? buildLight(palette, cls) : className === 'heavy' ? buildHeavy(palette, cls) : buildMedium(palette, cls);
  return { ...r, cls };
}

// =================================================================================================================
// WHEELS
// =================================================================================================================
/** Tyre: lathe with tread lugs. Axis = Y (outer side +Y). */
function tireGeometry(R, hw, rimR, segs, lugs) {
  const prof = [
    [rimR * 0.97, -hw * 0.9],
    [R * 0.84, -hw * 1.0],
    [R * 0.965, -hw * 0.85],
    [R * 1.0, -hw * 0.4],
    [R * 0.99, 0],
    [R * 1.0, hw * 0.4],
    [R * 0.965, hw * 0.85],
    [R * 0.84, hw * 1.0],
    [rimR * 0.97, hw * 0.9],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const g = new THREE.LatheGeometry(prof, segs);
  const pos = g.attributes.position;
  const np = prof.length;
  for (let i = 0; i <= segs; i++) {
    const phi = (i / segs) * TAU;
    const lug = smooth(-0.2, 0.3, Math.sin(phi * lugs));
    for (const j of [3, 4, 5]) {
      const k = i * np + j;
      const s = 1 + 0.032 * lug * (j === 4 ? 0.5 : 1);
      pos.setX(k, pos.getX(k) * s);
      pos.setZ(k, pos.getZ(k) * s);
    }
  }
  g.computeVertexNormals();
  const nor = g.attributes.normal;
  for (let j = 0; j < np; j++) {
    const a = j, bIdx = segs * np + j;
    const x = nor.getX(a) + nor.getX(bIdx), y = nor.getY(a) + nor.getY(bIdx), z = nor.getZ(a) + nor.getZ(bIdx);
    const l = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / l, y / l, z / l);
    nor.setXYZ(bIdx, x / l, y / l, z / l);
  }
  return g;
}

/**
 * Wheel geometry: axis = X, outer face toward +X, centred at the origin. ~520 triangles.
 */
export function buildWheelGeo(spec, className, C) {
  const { r: R, w } = spec;
  const hw = w / 2;
  const rimR = R * (className === 'light' ? 0.6 : 0.64);
  const b = new PartBuilder();
  const lugs = 10;
  const detail = getDetail();
  const tireSeg = Math.max(10, Math.round(20 * detail));
  b.add(tireGeometry(R, hw, rimR, tireSeg, lugs), { r: [0, 0, -Math.PI / 2], ...rubber() });

  // rim (outer face): lip -> dish -> centre
  const face = hw * 0.9;
  const rimGeo = new THREE.LatheGeometry(
    [
      [rimR * 1.0, face * 0.98],
      [rimR * 0.86, face * 1.03],
      [rimR * 0.66, face * 0.82],
      [0, face * 0.88],
    ].map((p) => new THREE.Vector2(p[0], p[1])),
    Math.max(8, Math.round(16 * detail)),
  );
  const rimCol = new THREE.Color(className === 'heavy' ? '#20232b' : className === 'light' ? C.accent : '#2a2f3a');
  const RIM_CHROME = new THREE.Color('#f1f4fa');
  b.add(rimGeo, {
    r: [0, 0, -Math.PI / 2],
    colorFn: (p) => (Math.hypot(p.y, p.z) / rimR > 0.84 ? RIM_CHROME : rimCol),
    surfFn: (p) => (Math.hypot(p.y, p.z) / rimR > 0.84 ? { rough: 0.1, metal: 1 } : { rough: 0.4, metal: className === 'light' ? 0.2 : 0.7 }),
    ao: 0.1,
  });
  // inner face (hidden most of the time, closes the hole)
  b.add(new THREE.CircleGeometry(rimR * 0.98, 10), { p: [-hw * 0.86, 0, 0], r: [0, -Math.PI / 2, 0], ...rubber({ color: '#2a2d36' }) });
  // spokes
  const n = className === 'heavy' ? 6 : 5;
  const sk = R / 0.3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.3;
    const rc = rimR * 0.52;
    b.add(G.cube(0.026 * sk, rimR * 0.78, 0.05 * sk), { p: [face * 1.0, Math.cos(a) * rc, Math.sin(a) * rc], r: [a, 0, 0], ...chrome({ color: '#eef1f8', rough: 0.14 }), ao: 0.05 });
  }
  // hub cap
  b.add(G.cyl(rimR * 0.2, rimR * 0.24, hw * 0.34, 8), { p: [face * 1.0, 0, 0], r: [0, 0, -Math.PI / 2], ...paint(className === 'light' ? C.primary : C.accent, { ao: 0.1 }) });
  return { geo: b.build(), tris: b.tris };
}

// =================================================================================================================
// STEERING WHEEL (axis Z, centred)  ~300 triangles
// =================================================================================================================
export function buildSteeringGeo(className, C) {
  const cls = KART_CLASSES[className];
  const R = cls.steer.R;
  const b = new PartBuilder();
  b.add(G.torus(R, R * 0.14, 18, 6), { ...plastic('#1c1e26', { rough: 0.45 }), ao: 0.15 });
  b.add(G.cyl(R * 0.26, R * 0.3, 0.05, 10), { r: [Math.PI / 2, 0, 0], ...chrome({ rough: 0.2 }) });
  b.add(G.cyl(R * 0.16, R * 0.16, 0.06, 8), { p: [0, 0, 0.005], r: [Math.PI / 2, 0, 0], ...paint(C.accent, { ao: 0.05 }) });
  for (const a of [Math.PI * 0.5, Math.PI * 1.17, Math.PI * 1.83]) {
    const len = R * 0.72;
    b.add(G.cube(0.04, len, 0.026), { p: [Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56, 0], r: [0, 0, a - Math.PI / 2], ...steel({ color: '#8c96a8' }) });
  }
  // top marker (12 o'clock) so turning reads clearly
  b.add(G.cube(0.03, R * 0.3, 0.032), { p: [0, R, 0], ...paint(C.primary, { ao: 0 }) });
  return { geo: b.build(), tris: b.tris };
}
