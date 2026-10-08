/**
 * Track outline art for menus (cards, loading screen) built from getTrackOutline(id).
 * Screen x = world x, screen y = world z (un-mirrored top view, ARCHITECTURE §3). OWNER: Presentation.
 */
import { getTrackOutline } from '../track/index.js';

const cache = new Map();
const INK = '#0c0625';

/**
 * Normalised outline for a track id: points scaled into [pad, 100-pad] preserving aspect ratio.
 * @returns {{ pts: number[][], d: string, start: number[], dir: number[] }}
 */
export function normalizedOutline(id, pad = 11) {
  const key = `${id}:${pad}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let pts = [];
  try {
    pts = getTrackOutline(id) || [];
  } catch (e) {
    console.warn('[ui] getTrackOutline failed for', id, e);
  }
  if (pts.length < 3) {
    pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([Math.cos(a) * 100 * (1 + 0.25 * Math.cos(a * 2)), Math.sin(a) * 60]);
    }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const size = Math.max(maxX - minX, maxZ - minZ) || 1;
  const k = (100 - pad * 2) / size;
  const ox = 50 - ((minX + maxX) / 2) * k;
  const oz = 50 - ((minZ + maxZ) / 2) * k;
  const norm = pts.map(([x, z]) => [x * k + ox, z * k + oz]);
  const d = norm.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z';
  const a = norm[0], b = norm[Math.min(3, norm.length - 1)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const out = { pts: norm, d, start: a, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len] };
  cache.set(key, out);
  return out;
}

/**
 * SVG markup for a track map thumbnail.
 * @param {string} id track id
 * @param {{ road?: string, line?: string, cls?: string, width?: number }} [o]
 */
export function trackMapSvg(id, { road = '#5fd35a', line = '#ffffff', cls = '', width = 6.4 } = {}) {
  const o = normalizedOutline(id);
  const ang = (Math.atan2(o.dir[1], o.dir[0]) * 180) / Math.PI;
  return `<svg class="tmap ${cls}" viewBox="0 0 100 100" aria-hidden="true">
    <path d="${o.d}" fill="none" stroke="${INK}" stroke-width="${width + 4.6}" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${o.d}" fill="none" stroke="${road}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${o.d}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="${width * 0.28}" stroke-linejoin="round" stroke-dasharray="1.6 2.2" transform="translate(0 -.4)"/>
    <g transform="translate(${o.start[0].toFixed(2)} ${o.start[1].toFixed(2)}) rotate(${ang.toFixed(1)})">
      <rect x="-1.1" y="${(-width * 0.9).toFixed(1)}" width="2.2" height="${(width * 1.8).toFixed(1)}" fill="${INK}" rx=".5"/>
      <rect x="-0.6" y="${(-width * 0.8).toFixed(1)}" width="1.2" height="${(width * 1.6).toFixed(1)}" fill="${line}" rx=".3"/>
    </g>
  </svg>`;
}
