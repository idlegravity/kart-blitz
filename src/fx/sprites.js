/**
 * Procedural particle sprite atlas (4x4 cells of 128px, canvas → texture). White/grey shapes with alpha; the
 * particle shader tints them per particle. Cell index = row * 4 + col (row 0 at the top of the canvas).
 * Streak / flame cells have their long axis along the cell's vertical axis (tip at the top) so the stretched
 * billboard mode can point them along the velocity.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { fbm2D } from '../core/math.js';

export const CELL = {
  DOT: 0, STREAK: 1, SMOKE: 2, STAR: 3, CONFETTI: 4, FLAME: 5, RING: 6, SHARD: 7,
  BURST: 8, GLOW: 9, SPARKLE: 10, SMOKE2: 11, CHUNK: 12, DROPLET: 13, BOKEH: 14, SQUARE: 15,
};

const C = 128;
const sm = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Fill one cell from a per-pixel function f(x, y, r, a) → alpha or [lum, alpha] with x,y in [-1,1] (y up). */
function pixels(g, cx, cy, fn) {
  const img = g.createImageData(C, C);
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      const x = ((i + 0.5) / C) * 2 - 1;
      const y = 1 - ((j + 0.5) / C) * 2;
      const r = Math.hypot(x, y);
      const a = Math.atan2(y, x);
      let v = fn(x, y, r, a);
      let lum = 255, al;
      if (Array.isArray(v)) {
        lum = Math.max(0, Math.min(255, v[0] * 255));
        al = v[1];
      } else al = v;
      const k = (j * C + i) * 4;
      img.data[k] = lum;
      img.data[k + 1] = lum;
      img.data[k + 2] = lum;
      img.data[k + 3] = Math.max(0, Math.min(255, al * 255));
    }
  }
  g.putImageData(img, cx, cy);
}

export function createSpriteAtlas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = C * 4;
  const g = cv.getContext('2d');
  const at = (i) => [(i % 4) * C, Math.floor(i / 4) * C];

  // 0 soft dot
  pixels(g, ...at(CELL.DOT), (x, y, r) => Math.pow(1 - sm(0, 1, r), 1.6));
  // 1 spark streak (vertical capsule: hot core + soft halo, fades toward both ends)
  pixels(g, ...at(CELL.STREAK), (x, y, r) => {
    const ax = Math.abs(x), ay = Math.abs(y);
    const core = Math.exp(-Math.pow(ax / 0.1, 2)) * (1 - sm(0.55, 1, ay));
    const halo = Math.exp(-Math.pow(ax / 0.32, 2)) * (1 - sm(0.2, 1, ay)) * 0.35;
    return Math.min(1, core + halo);
  });
  // 2 / 11 smoke puffs
  for (const [cell, seed] of [[CELL.SMOKE, 3], [CELL.SMOKE2, 11]]) {
    pixels(g, ...at(cell), (x, y, r) => {
      const n = fbm2D(x * 2.2 + seed, y * 2.2 - seed, 4, seed) * 0.5 + 0.5;
      const edge = 1 - sm(0.25, 0.98, r + (n - 0.5) * 0.55);
      const shade = 0.72 + 0.28 * (0.5 + 0.5 * fbm2D(x * 3 + 9, y * 3, 3, seed + 1));
      return [shade * (0.85 + 0.15 * y), Math.pow(edge, 1.15) * (0.55 + 0.45 * n)];
    });
  }
  // 3 star (5 point, soft glow)
  {
    const [cx, cy] = at(CELL.STAR);
    g.save();
    g.beginPath();
    g.rect(cx, cy, C, C);
    g.clip();
    g.translate(cx + C / 2, cy + C / 2);
    const star = (R, r0) => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? R : r0;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
    };
    const glow = g.createRadialGradient(0, 0, 4, 0, 0, 62);
    glow.addColorStop(0, 'rgba(255,255,255,0.55)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(-64, -64, 128, 128);
    g.fillStyle = 'rgba(255,255,255,1)';
    g.shadowColor = 'rgba(255,255,255,0.9)';
    g.shadowBlur = 8;
    star(46, 20);
    g.fill();
    g.shadowBlur = 0;
    g.restore();
  }
  // 4 confetti (rounded rectangle)
  {
    const [cx, cy] = at(CELL.CONFETTI);
    g.save();
    g.translate(cx + C / 2, cy + C / 2);
    const gr = g.createLinearGradient(0, -34, 0, 34);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(210,210,210,1)');
    g.fillStyle = gr;
    g.beginPath();
    g.roundRect(-40, -26, 80, 52, 10);
    g.fill();
    g.restore();
  }
  // 5 flame (teardrop, tip at the top)
  pixels(g, ...at(CELL.FLAME), (x, y, r) => {
    const y01 = (y + 1) / 2;
    const n = fbm2D(x * 3, y * 2.2, 3, 5) * 0.12;
    const hw = 0.62 * Math.pow(Math.max(0, 1 - y01), 0.72) * (0.35 + 0.65 * sm(0, 0.35, y01)) + n * 0.5;
    const d = Math.abs(x) / Math.max(0.02, hw);
    const a = (1 - sm(0.35, 1, d)) * sm(0.0, 0.12, y01) * (1 - Math.pow(y01, 3));
    const core = Math.exp(-Math.pow(x / 0.16, 2)) * (1 - sm(0.1, 0.85, y01));
    return [0.75 + 0.25 * core, Math.min(1, a * 0.95)];
  });
  // 6 ring
  pixels(g, ...at(CELL.RING), (x, y, r) => (Math.exp(-Math.pow((r - 0.78) / 0.07, 2)) * 0.95 + Math.exp(-Math.pow((r - 0.78) / 0.18, 2)) * 0.25) * (1 - sm(0.86, 1.0, r)));
  // 7 shard (diamond)
  {
    const [cx, cy] = at(CELL.SHARD);
    g.save();
    g.translate(cx + C / 2, cy + C / 2);
    const gr = g.createLinearGradient(-30, -50, 30, 50);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.55, 'rgba(235,235,235,1)');
    gr.addColorStop(1, 'rgba(180,180,180,1)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, -56);
    g.lineTo(34, -6);
    g.lineTo(6, 54);
    g.lineTo(-30, 8);
    g.closePath();
    g.fill();
    g.restore();
  }
  // 8 flash burst (rays + core)
  pixels(g, ...at(CELL.BURST), (x, y, r, a) => {
    const core = Math.exp(-r * r * 9);
    const rays = Math.pow(Math.abs(Math.cos(a * 4 + 0.4)), 28) * Math.exp(-r * 2.4) + Math.pow(Math.abs(Math.cos(a * 6 + 1.1)), 60) * Math.exp(-r * 3.2) * 0.7;
    return Math.min(1, (core + rays) * (1 - sm(0.8, 1, r)));
  });
  // 9 glow
  pixels(g, ...at(CELL.GLOW), (x, y, r) => (1 / (1 + Math.pow(r * 3.4, 2))) * (1 - sm(0.6, 1, r)));
  // 10 sparkle (four point twinkle)
  pixels(g, ...at(CELL.SPARKLE), (x, y, r) => {
    const t = Math.exp(-Math.abs(x * y) * 55) * Math.exp(-r * 1.7);
    return Math.min(1, t * 1.3 + Math.exp(-r * r * 40) * 0.6) * (1 - sm(0.7, 1.0, r));
  });
  // 12 debris chunk
  {
    const [cx, cy] = at(CELL.CHUNK);
    g.save();
    g.translate(cx + C / 2, cy + C / 2);
    const gr = g.createLinearGradient(-40, -40, 40, 40);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(120,120,120,1)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(-42, -10);
    g.lineTo(-14, -44);
    g.lineTo(30, -32);
    g.lineTo(46, 6);
    g.lineTo(18, 42);
    g.lineTo(-26, 34);
    g.closePath();
    g.fill();
    g.restore();
  }
  // 13 droplet
  pixels(g, ...at(CELL.DROPLET), (x, y, r) => {
    const rr = r / 0.82;
    const rim = sm(0.55, 0.96, rr);
    const edge = 1 - sm(0.94, 1.0, rr);
    const hl = Math.exp(-(Math.pow((x + 0.28) / 0.16, 2) + Math.pow((y - 0.3) / 0.11, 2)));
    return [Math.min(1, 0.55 + hl), (0.35 + 0.55 * rim) * edge];
  });
  // 14 bokeh disc
  pixels(g, ...at(CELL.BOKEH), (x, y, r) => (0.3 + 0.7 * sm(0.72, 0.94, r)) * (1 - sm(0.94, 1.0, r)));
  // 15 soft square
  pixels(g, ...at(CELL.SQUARE), (x, y) => (1 - sm(0.7, 1, Math.abs(x))) * (1 - sm(0.7, 1, Math.abs(y))));

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace; // tint math happens in linear space in the shader
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return tex;
}
