/**
 * Fast deterministic noise helpers for the track generator (no allocation, no closures).
 * OWNER: World agent.
 */

/** Integer hash → [0, 1). */
export function hash2(ix, iz, seed = 0) {
  let n = Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
export function vnoise(x, z, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Fractal noise, roughly [-1, 1]. */
export function fbm(x, z, oct = 4, seed = 0, gain = 0.5, lac = 2.03) {
  let amp = 0.5, sum = 0, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(x * f + o * 13.7, z * f - o * 7.3, seed + o * 31);
    norm += amp;
    amp *= gain;
    f *= lac;
  }
  return sum / norm;
}

/** Ridged multifractal, roughly [0, 1] (sharp crests). */
export function ridged(x, z, oct = 4, seed = 0) {
  let amp = 0.5, sum = 0, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    const n = 1 - Math.abs(vnoise(x * f + o * 5.1, z * f + o * 9.7, seed + o * 17));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

/** Periodic value noise (tileable with `period` cells) in [0, 1]. */
export function pnoise(x, z, period, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const x0 = ((xi % period) + period) % period, x1 = (x0 + 1) % period;
  const z0 = ((zi % period) + period) % period, z1 = (z0 + 1) % period;
  const a = hash2(x0, z0, seed), b = hash2(x1, z0, seed);
  const c = hash2(x0, z1, seed), d = hash2(x1, z1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Periodic fBm in [0, 1] (tileable over `period` cells at base frequency). */
export function pfbm(x, z, period, oct = 4, seed = 0) {
  let amp = 0.5, sum = 0, norm = 0, f = 1, p = period;
  for (let o = 0; o < oct; o++) {
    sum += amp * pnoise(x * f, z * f, p, seed + o * 19);
    norm += amp;
    amp *= 0.5;
    f *= 2;
    p *= 2;
  }
  return sum / norm;
}

export const smooth = (e0, e1, x) => {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
