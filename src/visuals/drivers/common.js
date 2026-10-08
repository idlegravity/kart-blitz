/**
 * Shared building blocks for the eight chibi drivers.
 * Frames: torso geometry lives in DRIVER space (origin = seat surface point under the driver, +Z forward, +X left, +Y up);
 * head geometry lives in HEAD space (origin = neck pivot).
 * Flex channels: torso mesh 0/1 = arms L/R (rigid, aimed at the wheel), 2 = tail, 3 = scarf / cape, 4..5 spare;
 * head mesh 6/7 = ears L/R, 8/9 = antennae / pom / hat bob, 10/11 spare. 12 blink, 13 beacon.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { G, S2, PartBuilder, sweep, tube, orient, smooth, mix, clamp01, toColor, shade, mixColor } from '../geo.js';
import { regionUV } from '../atlas.js';

export const CHN = { ARM_L: 0, ARM_R: 1, TAIL: 2, SCARF: 3, TAIL2: 4, EAR_L: 6, EAR_R: 7, ANT_A: 8, ANT_B: 9, TOP_A: 10, TOP_B: 11 };

// ---- surface presets for creatures ------------------------------------------------------------------------------
export const FUR = (color, o = {}) => ({ color, rough: 0.84, ao: 0.32, ...o });
export const CLOTH = (color, o = {}) => ({ color, rough: 0.82, ao: 0.3, ...o });
export const GLOSS = (color, o = {}) => ({ color, rough: 0.1, clear: 1, ao: 0, ...o });
export const GLOW = (color, e = 2, o = {}) => ({ color, rough: 0.3, emis: e, ao: 0, ...o });
export const SHINY = (color, o = {}) => ({ color, rough: 0.28, clear: 1, ao: 0.25, ...o });

const tmpC = new THREE.Color();

/** Front (+Z) surface z of an ellipsoid head at (x, y). h = { rx, ry, rz, cy, cz } */
export function frontZ(h, x, y) {
  const nx = x / h.rx, ny = (y - h.cy) / h.ry;
  const t = 1 - nx * nx - ny * ny;
  return h.rz * Math.sqrt(Math.max(0, t)) + (h.cz ?? 0);
}

/** Point on the ellipsoid surface for direction angles (azimuth around Y from +Z, elevation from equator). */
export function surfacePoint(h, az, el) {
  return [
    h.rx * Math.cos(el) * Math.sin(az),
    h.cy + h.ry * Math.sin(el),
    (h.cz ?? 0) + h.rz * Math.cos(el) * Math.cos(az),
  ];
}

/** Colour function: blend `a` → `b` by mask(p, n) in 0..1. */
export function blendFn(a, b, mask) {
  const A = toColor(a, new THREE.Color()), B = toColor(b, new THREE.Color());
  const out = new THREE.Color();
  return (p, n) => out.copy(A).lerp(B, clamp01(mask(p, n)));
}

/**
 * One glossy eye on the front of an ellipsoid head. The iris / pupil / highlights are painted into the character atlas
 * (atlas.js EYE_STYLES) and planar-projected onto a single ellipsoid (~140 triangles).
 * o: { rx, ry, depth, yaw, roll }. Flagged with the blink channel (pivot = eye centre).
 */
export function eyeAt(head, h, x, y, o = {}) {
  const rx = o.rx ?? 0.06, ry = o.ry ?? 0.078;
  const depth = o.depth ?? 0.045;
  const [u0, v0, u1, v1] = regionUV('eye', 1.5);
  const z = frontZ(h, x, y) - depth * 0.3;
  const piv = [x, y, z];
  head.add(G.ell(rx, ry, depth, 10, 8), {
    p: [x, y, z],
    r: [0, o.yaw ?? 0, o.roll ?? 0],
    color: '#ffffff',
    rough: 0.08,
    clear: 1,
    ao: 0,
    blink: piv,
    uvFn: (p) => [mix(u0, u1, clamp01(0.5 + (p.x - x) / (2 * rx))), mix(v0, v1, clamp01(0.5 + (p.y - y) / (2 * ry)))],
  });
}

/** Eye pair: o: { x, y, rx, ry, depth, tilt, roll } (roll tilts the outer corners: + = outer corners down). */
export function eyePair(head, h, o = {}) {
  const ex = o.x ?? 0.12;
  const ey = o.y ?? h.cy + 0.03;
  for (const s of [1, -1]) eyeAt(head, h, ex * s, ey, { rx: o.rx, ry: o.ry, depth: o.depth, yaw: s * (o.tilt ?? 0.22), roll: s * (o.roll ?? 0) });
}

/** Smile / mouth curve on the front of a head. o: { y, w, depth, thick, color, z } */
export function smile(head, h, o = {}) {
  const y0 = o.y ?? h.cy - 0.11;
  const w = o.w ?? 0.08;
  const d = o.depth ?? 0.03;
  const pts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    const x = u * w;
    const y = y0 - d * (1 - u * u) * (o.frown ? -1 : 1);
    pts.push([x, y, (o.zFn ? o.zFn(x, y) : o.z ?? frontZ(h, x, y)) + 0.004]);
  }
  const th = o.thick ?? 0.009;
  head.add(tube(pts, (t) => th * (0.45 + 0.55 * Math.sin(Math.PI * t)), { segments: 8, ring: 5, capStart: th * 0.5, capEnd: th * 0.5, capRings: 1 }), o.surf ?? { ...FUR(o.color ?? '#3a1810', { rough: 0.5 }), ao: 0 });
}

/** Rounded blush oval on a cheek. */
export function blush(head, h, o = {}) {
  const x = o.x ?? 0.19, y = o.y ?? h.cy - 0.04;
  for (const s of [1, -1]) {
    const z = frontZ(h, x * s, y) - 0.008;
    head.add(G.ell(o.rx ?? 0.05, o.ry ?? 0.03, 0.012, 10, 6), { p: [x * s, y, z], r: [0, s * 0.55, 0], ...FUR(o.color ?? '#ff6f9c', { rough: 0.6 }), ao: 0 });
  }
}

/** Ellipsoid head with optional colour function. Returns the descriptor `h` used by the helpers above. */
export function headBase(head, o = {}) {
  const h = { rx: o.rx ?? 0.31, ry: o.ry ?? 0.275, rz: o.rz ?? 0.3, cy: o.cy ?? 0.275, cz: o.cz ?? 0 };
  head.add(G.ell(h.rx, h.ry, h.rz, o.ws ?? 20, o.hs ?? 14), { p: [0, h.cy, h.cz], ...FUR(o.color ?? '#ffffff', o.surf ?? {}), colorFn: o.colorFn, uvRegion: o.uvRegion });
  return h;
}

/** Bendable path helper: sweeps a round tube along a Catmull-Rom path with a radius profile, colour by path parameter. */
export function pathTube(b, pts, radiusFn, o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const n = o.segments ?? 14;
  const st = [];
  const samples = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    samples.push(p.clone());
    const r = radiusFn(t);
    st.push({ p: [p.x, p.y, p.z], rx: r * (o.flatX ?? 1), ry: r * (o.flatY ?? 1), e: 2 });
  }
  const geo = sweep(st, { ring: o.ring ?? 10, up: o.up, capStart: o.capStart ?? 0.04, capEnd: o.capEnd ?? 0.05, capRings: o.capRings ?? 3 });
  // nearest-sample parameter for colouring
  const paramOf = (p) => {
    let best = 0, bd = 1e9;
    for (let i = 0; i < samples.length; i++) {
      const d = samples[i].distanceToSquared(p);
      if (d < bd) { bd = d; best = i; }
    }
    return best / n;
  };
  const colorFn = o.colorFn
    ? o.colorFn
    : o.colorAt
    ? (() => {
        const out = new THREE.Color();
        return (p) => o.colorAt(paramOf(p), out);
      })()
    : undefined;
  const f = o.flex ? { ...o.flex } : null;
  b.add(geo, { ...o.surf, colorFn, flex: f, uvRegion: o.uvRegion });
  return { curve, paramOf, samples };
}

/** Standard chibi torso + arms + gloves. Returns rest-pose info for animation. */
export function torsoAndArms(b, ctx, o = {}) {
  const { cls } = ctx;
  const R = cls.steer.R;
  const hub = [cls.steer.pos[0] - cls.seat[0], cls.steer.pos[1] - cls.seat[1], cls.steer.pos[2] - cls.seat[2]];
  const rx = o.rx ?? 0.215, ry = o.ry ?? 0.27, rz = o.rz ?? 0.19, cy = o.cy ?? 0.17;
  const bodyCol = o.body ?? '#ffffff';
  const bellyCol = o.belly ?? null;
  // main body
  b.add(G.ell(rx, ry, rz, o.ws ?? 16, o.hs ?? 11, Math.PI * 0.76), {
    p: [0, cy, 0],
    ...(o.bodySurf ?? FUR(bodyCol)),
    colorFn: bellyCol
      ? blendFn(bodyCol, bellyCol, (p) => smooth(0.03, 0.12, p.z) * smooth(0.0, 0.14, p.y) * (1 - smooth(rx * 0.75, rx * 1.05, Math.abs(p.x))))
      : o.colorFn,
    uvRegion: o.uvRegion,
  });
  // arms
  const shX = o.shoulderX ?? rx * 0.94, shY = o.shoulderY ?? cy + 0.13, shZ = o.shoulderZ ?? 0.0;
  const hands = { L: [hub[0] + R * 0.98, hub[1], hub[2]], R: [hub[0] - R * 0.98, hub[1], hub[2]] };
  const shoulders = { L: [shX, shY, shZ], R: [-shX, shY, shZ] };
  const ar = o.armR ?? 0.062;
  const gr = o.gloveR ?? 0.076;
  for (const [side, s, ch] of [['L', 1, CHN.ARM_L], ['R', -1, CHN.ARM_R]]) {
    const S = shoulders[side], H = hands[side];
    const mid = [(S[0] + H[0]) / 2 + s * 0.05, (S[1] + H[1]) / 2 - 0.06, (S[2] + H[2]) / 2];
    const flex = { ch, pivot: S, len: 0 };
    const armSurf = o.armSurf ?? CLOTH(o.sleeve ?? bodyCol);
    b.add(
      sweep(
        [
          { p: S, rx: ar * 1.05, ry: ar * 1.05, e: 2 },
          { p: mid, rx: ar, ry: ar, e: 2 },
          { p: [H[0] - (H[0] - mid[0]) * 0.12, H[1] - (H[1] - mid[1]) * 0.12, H[2] - (H[2] - mid[2]) * 0.12], rx: ar * 0.92, ry: ar * 0.92, e: 2 },
        ],
        { ring: 7, capStart: ar * 1.05, capEnd: 0.01, capRings: 1 },
      ),
      { ...armSurf, flex },
    );
    b.add(G.ell(gr, gr * 0.95, gr, 8, 6), { p: H, ...(o.gloveSurf ?? SHINY(o.glove ?? '#ffffff', { rough: 0.5 })), flex });
  }
  return { shoulders, hands, hub };
}

/** Round pom-pom / tuft helper. */
export function ball(b, p, r, surf, o = {}) {
  b.add(G.ell(r, r * (o.sy ?? 1), r, o.ws ?? 10, o.hs ?? 8), { p, ...surf, ...o.extra });
}

export { PartBuilder, G, S2, sweep, tube, orient, smooth, mix, clamp01, toColor, shade, mixColor };
