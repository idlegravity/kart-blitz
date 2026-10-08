/**
 * Shared math helpers. All functions are pure and allocation-free unless noted.
 * OWNER: orchestrator. Do not modify (add private helpers in your own module instead).
 *
 * Conventions (see ARCHITECTURE.md §3):
 *  - Y is up. Units are meters and seconds.
 *  - A kart with heading `yaw` faces forward = (sin yaw, 0, cos yaw); right = (-cos yaw, 0, sin yaw).
 *  - Positive steer (+1) turns RIGHT, which DECREASES yaw.
 *  - For any tangent t: right = normalize(cross(t, UP)).
 */
import * as THREE from 'three';

export const UP = Object.freeze(new THREE.Vector3(0, 1, 0));
export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v, a0, a1, b0, b1) => lerp(b0, b1, invLerp(a0, a1, v));
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Framerate-independent exponential smoothing factor. Use: x = lerp(x, target, dampFactor(lambda, dt)). */
export const dampFactor = (lambda, dt) => 1 - Math.exp(-lambda * dt);
/** Framerate-independent exponential approach of `current` to `target`. lambda ~ 1/response-time. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));

/** Move `current` toward `target` by at most `maxDelta`. */
export const moveTowards = (current, target, maxDelta) =>
  Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta;

/** Wrap an angle to (-PI, PI]. */
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
/** Shortest signed angular difference b - a in (-PI, PI]. */
export const angleDiff = (a, b) => wrapAngle(b - a);
export const dampAngle = (current, target, lambda, dt) => current + angleDiff(current, target) * (1 - Math.exp(-lambda * dt));

/** Heading → unit forward vector (writes into `out`). */
export function yawToForward(yaw, out = new THREE.Vector3()) {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}
/** Heading → unit right vector (writes into `out`). */
export function yawToRight(yaw, out = new THREE.Vector3()) {
  return out.set(-Math.cos(yaw), 0, Math.sin(yaw));
}
/** Direction (x,z) → heading. Inverse of yawToForward. */
export const forwardToYaw = (x, z) => Math.atan2(x, z);

/** Deterministic PRNG (mulberry32). Returns a function producing floats in [0,1). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randRange = (rng, lo, hi) => lo + (hi - lo) * rng();
export const randInt = (rng, lo, hiInclusive) => lo + Math.floor(rng() * (hiInclusive - lo + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/** Weighted random choice. weights: number[] (same length as items). */
export function weightedPick(rng, items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Cheap 2D value noise in [-1, 1] (deterministic, tileable-ish). Good for terrain/texture variation. */
export function valueNoise2D(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const h = (i, j) => {
    let n = (i * 374761393 + j * 668265263 + seed * 144269504) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (((n ^ (n >>> 16)) >>> 0) / 4294967295) * 2 - 1;
  };
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Fractal (fBm) value noise in roughly [-1, 1]. */
export function fbm2D(x, z, octaves = 4, seed = 0) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2D(x * freq, z * freq, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Ordinal suffix for places: 1 → '1st'. */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Format seconds as m:ss.mmm (e.g. 1:23.456). */
export function formatTime(t) {
  if (!Number.isFinite(t) || t < 0) return '-:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
