/**
 * Per-character texture atlas (512x512 canvas) shared by all meshes of a kart.
 * Regions (canvas px): white swatch (plain paint), racing roundel (emblem + number decal),
 * flannel plaid, black/white checker.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { toColor } from './geo.js';

export const ATLAS_SIZE = 512;
/** x, y, w, h in canvas pixels (origin top-left). */
export const REGIONS = {
  white: [0, 0, 16, 16],
  /** per-character alpha-mask overlay (panel lines, tabby stripes...) split into PATTERN_RECTS */
  pattern: [16, 0, 224, 128],
  roundel: [256, 0, 256, 256],
  flannel: [0, 256, 128, 128],
  checker: [128, 256, 128, 128],
  stripes: [0, 128, 128, 64],
  eye: [128, 128, 128, 128],
};

/** Eye artwork per character (planar-projected onto the eyeball ellipsoids, see drivers/common.js eyePair). */
export const EYE_STYLES = {
  blaze: { base: '#1c0e08', iris: '#f5a623', irisR: 0.68, pupilR: 0.3 },
  bolt: { base: '#0c1219', iris: '#26d9ff', irisR: 0.5, pupilR: 0.0 },
  mochi: { base: '#1d0d1a', iris: '#ff8fc0', irisR: 0.62, pupilR: 0.33 },
  rex: { sclera: '#fff7d6', base: '#20301a', iris: '#ffb61f', irisR: 0.55, pupilR: 0.3, slit: true },
  frost: { base: '#0a1020', iris: null },
  nova: { base: '#03030a', iris: null },
  grizz: { base: '#120a06', iris: null },
  pepper: { base: '#0a1a0c', iris: '#5df05b', irisR: 0.78, pupilR: 0.22, slit: true },
};

function drawEye(g, x, y, S, st) {
  g.save();
  g.beginPath();
  g.rect(x, y, S, S);
  g.clip();
  g.translate(x + S / 2, y + S / 2);
  g.fillStyle = st.sclera ?? st.base;
  g.fillRect(-S / 2, -S / 2, S, S);
  if (st.sclera) {
    const rg = g.createRadialGradient(0, 0, S * 0.28, 0, 0, S * 0.5);
    rg.addColorStop(0, 'rgba(30,20,10,0)');
    rg.addColorStop(1, 'rgba(30,20,10,0.6)');
    g.fillStyle = rg;
    g.fillRect(-S / 2, -S / 2, S, S);
  }
  let R = 0;
  if (st.iris) {
    R = S * 0.5 * st.irisR;
    const ic = toColor(st.iris);
    const dk = ic.clone().multiplyScalar(0.45), md = ic.clone(), lt = ic.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
    const ig = g.createRadialGradient(0, -R * 0.25, R * 0.1, 0, R * 0.1, R * 1.05);
    ig.addColorStop(0, css(dk));
    ig.addColorStop(0.55, css(md));
    ig.addColorStop(0.9, css(lt));
    ig.addColorStop(1, css(dk));
    g.fillStyle = ig;
    g.beginPath();
    g.ellipse(0, 0, R, R * 1.06, 0, 0, Math.PI * 2);
    g.fill();
    // dark limbal ring
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = S * 0.028;
    g.beginPath();
    g.ellipse(0, 0, R, R * 1.06, 0, 0, Math.PI * 2);
    g.stroke();
    // pupil
    g.fillStyle = '#040406';
    g.beginPath();
    if (st.slit) g.ellipse(0, 0, S * 0.5 * st.pupilR * 0.42, R * 0.98, 0, 0, Math.PI * 2);
    else g.ellipse(0, 0, S * 0.5 * st.pupilR, S * 0.5 * st.pupilR * 1.08, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    // glossy bead: subtle lighter gradient at the bottom
    const bg = g.createRadialGradient(0, S * 0.18, S * 0.02, 0, S * 0.1, S * 0.5);
    bg.addColorStop(0, 'rgba(120,150,200,0.28)');
    bg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = bg;
    g.fillRect(-S / 2, -S / 2, S, S);
  }
  // highlights (upper right big, lower left small)
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(S * 0.14, -S * 0.17, S * 0.105, S * 0.125, -0.25, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(-S * 0.14, S * 0.13, S * 0.045, S * 0.05, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Sub-rectangles of the pattern region: head sphere UVs, tail sweep UVs, torso UVs. */
export const PATTERN_RECTS = { head: [16, 0, 112, 128], tail: [128, 0, 112, 64], body: [128, 64, 112, 64] };

/** UV rectangle [u0, v0, u1, v1] for a region name or an [x, y, w, h] pixel rect (three.js uv origin is bottom-left). */
export function regionUV(name, inset = 0) {
  const [x, y, w, h] = Array.isArray(name) ? name : REGIONS[name];
  const S = ATLAS_SIZE;
  return [(x + inset) / S, 1 - (y + h - inset) / S, (x + w - inset) / S, 1 - (y + inset) / S];
}

export const RACE_NUMBERS = { blaze: 7, bolt: 1, mochi: 8, rex: 5, frost: 3, nova: 9, grizz: 4, pepper: 6 };

const cache = new Map();

function css(c) {
  return '#' + toColor(c).getHexString();
}

/** Emblem glyphs drawn centred at (0,0) in a ~60px radius, fill already set by caller. */
const GLYPHS = {
  fox(g) {
    // flame
    g.beginPath();
    g.moveTo(0, -58);
    g.bezierCurveTo(30, -30, 46, -4, 30, 28);
    g.bezierCurveTo(24, 42, 8, 50, 0, 50);
    g.bezierCurveTo(-8, 50, -26, 42, -30, 26);
    g.bezierCurveTo(-40, 2, -18, -14, -14, -40);
    g.bezierCurveTo(-4, -30, 2, -46, 0, -58);
    g.closePath();
    g.fill();
  },
  robot(g) {
    // lightning bolt
    g.beginPath();
    g.moveTo(14, -58);
    g.lineTo(-30, 8);
    g.lineTo(-4, 8);
    g.lineTo(-14, 56);
    g.lineTo(32, -12);
    g.lineTo(6, -12);
    g.closePath();
    g.fill();
  },
  bunny(g) {
    // star
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 58 : 26;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  },
  dino(g) {
    // three spikes
    for (const [x, s] of [[-34, 0.75], [0, 1], [34, 0.75]]) {
      g.beginPath();
      g.moveTo(x - 24 * s, 46);
      g.lineTo(x, 46 - 100 * s);
      g.lineTo(x + 24 * s, 46);
      g.closePath();
      g.fill();
    }
  },
  penguin(g) {
    // snowflake
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.strokeStyle = g.fillStyle;
    for (let i = 0; i < 3; i++) {
      g.save();
      g.rotate((i * Math.PI) / 3);
      g.beginPath();
      g.moveTo(0, -56);
      g.lineTo(0, 56);
      g.moveTo(-16, -38);
      g.lineTo(0, -26);
      g.lineTo(16, -38);
      g.moveTo(-16, 38);
      g.lineTo(0, 26);
      g.lineTo(16, 38);
      g.stroke();
      g.restore();
    }
  },
  alien(g) {
    // ringed planet
    g.beginPath();
    g.arc(0, 0, 32, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 9;
    g.strokeStyle = g.fillStyle;
    g.beginPath();
    g.ellipse(0, 0, 62, 20, -0.4, 0, Math.PI * 2);
    g.stroke();
  },
  bear(g) {
    // paw print
    g.beginPath();
    g.ellipse(0, 22, 32, 26, 0, 0, Math.PI * 2);
    g.fill();
    for (const [x, y, r] of [[-38, -6, 13], [-14, -34, 14], [14, -34, 14], [38, -6, 13]]) {
      g.beginPath();
      g.ellipse(x, y, r, r * 1.25, x * 0.01, 0, Math.PI * 2);
      g.fill();
    }
  },
  cat(g) {
    // cat head with ears
    g.beginPath();
    g.moveTo(-50, -52);
    g.lineTo(-24, -30);
    g.quadraticCurveTo(0, -38, 24, -30);
    g.lineTo(50, -52);
    g.lineTo(52, -4);
    g.quadraticCurveTo(52, 44, 0, 50);
    g.quadraticCurveTo(-52, 44, -52, -4);
    g.closePath();
    g.fill();
  },
};

/** Alpha-mask patterns painted per character (u around / v along in each sub-rect). */
function drawPattern(g, ch) {
  const rect = (r, fn) => {
    const [x, y, w, h] = r;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.translate(x, y);
    fn(w, h);
    g.restore();
  };
  const dark = (c, k) => css(toColor(c).clone().multiplyScalar(k));
  if (ch.id === 'bolt') {
    const yel = ch.colors.primary;
    rect(PATTERN_RECTS.head, (w, h) => {
      // horizontal seam (equator) + vertical seams front/back, rivets along the seam
      g.strokeStyle = dark(yel, 0.42);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, h * 0.5);
      g.lineTo(w, h * 0.5);
      g.stroke();
      g.beginPath();
      g.moveTo(0, h * 0.3);
      g.lineTo(w, h * 0.3);
      g.stroke();
      for (let i = 0; i < 8; i++) {
        const cx = (i + 0.5) * (w / 8);
        for (const cy of [h * 0.4]) {
          g.fillStyle = dark(yel, 0.55);
          g.beginPath();
          g.arc(cx, cy, 3.2, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#fff6b8';
          g.beginPath();
          g.arc(cx - 0.8, cy - 0.9, 1.2, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.strokeStyle = dark(yel, 0.42);
      for (const u of [0, 0.25, 0.5, 0.75]) {
        g.beginPath();
        g.moveTo(u * w, h * 0.3);
        g.lineTo(u * w, h * 0.5);
        g.stroke();
      }
    });
    rect(PATTERN_RECTS.body, (w, h) => {
      g.strokeStyle = dark(yel, 0.42);
      g.lineWidth = 3;
      g.strokeRect(w * 0.04, h * 0.2, w * 0.92, h * 0.6);
      g.beginPath();
      g.moveTo(0, h * 0.5);
      g.lineTo(w, h * 0.5);
      g.stroke();
    });
  } else if (ch.id === 'pepper') {
    const st = '#4a2208';
    rect(PATTERN_RECTS.head, (w, h) => {
      g.fillStyle = st;
      // forehead "M" tabby marking: three tapered stripes converging on the crown (front = u .25)
      for (const du of [-0.055, 0, 0.055]) {
        g.beginPath();
        const cx = (0.25 + du) * w;
        g.moveTo(cx - 3.5, h * 0.03);
        g.lineTo(cx + 3.5, h * 0.03);
        g.lineTo(cx + 1.2, h * 0.3);
        g.lineTo(cx - 1.2, h * 0.3);
        g.closePath();
        g.fill();
      }
      // cheek stripes
      for (const side of [0.25 - 0.19, 0.25 + 0.19]) {
        for (const k of [0, 1]) {
          const cx = side * w, cy = h * (0.5 + k * 0.07);
          g.beginPath();
          g.ellipse(cx, cy, w * 0.045, 2.2, side < 0.25 ? -0.15 : 0.15, 0, Math.PI * 2);
          g.fill();
        }
      }
      // back-of-head stripes
      for (const u of [0.72, 0.78, 0.84, 0.9, 0.66]) {
        g.fillRect(u * w - 2.5, h * 0.12, 5, h * 0.3);
      }
    });
    rect(PATTERN_RECTS.tail, (w, h) => {
      g.fillStyle = st;
      for (let i = 0; i < 6; i++) g.fillRect(0, h * (0.08 + i * 0.16), w, h * 0.075);
    });
    rect(PATTERN_RECTS.body, (w, h) => {
      g.fillStyle = st;
      for (const u of [0.55, 0.65, 0.75, 0.85, 0.95]) g.fillRect(u * w - 3, 0, 6, h * 0.6);
    });
  } else if (ch.id === 'rex') {
    const dk = ch.colors.accent;
    rect(PATTERN_RECTS.head, (w, h) => {
      g.fillStyle = dk;
      for (const u of [0.72, 0.78, 0.84, 0.9]) g.fillRect(u * w - 3, h * 0.08, 6, h * 0.34);
      for (const u of [0.1, 0.16, 0.34, 0.4]) g.fillRect(u * w - 3, h * 0.05, 6, h * 0.16);
    });
    rect(PATTERN_RECTS.tail, (w, h) => {
      g.fillStyle = dk;
      for (let i = 0; i < 5; i++) g.fillRect(0, h * (0.1 + i * 0.19), w, h * 0.09);
    });
    rect(PATTERN_RECTS.body, (w, h) => {
      g.fillStyle = dk;
      for (const u of [0.55, 0.68, 0.81, 0.94]) g.fillRect(u * w - 4, 0, 8, h * 0.6);
    });
  } else if (ch.id === 'nova') {
    rect(PATTERN_RECTS.head, (w, h) => {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      const r = (n) => {
        let a = n * 9301 + 49297;
        return () => ((a = (a * 9301 + 49297) % 233280) / 233280);
      };
      const rand = r(7);
      for (let i = 0; i < 26; i++) {
        g.beginPath();
        g.arc(rand() * w, h * (0.1 + rand() * 0.45), 1.6 + rand() * 1.8, 0, Math.PI * 2);
        g.fill();
      }
    });
    rect(PATTERN_RECTS.body, (w, h) => {
      // suit panel lines
      g.strokeStyle = dark(ch.colors.primary, 0.5);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(w * 0.25, 0);
      g.lineTo(w * 0.25, h);
      g.moveTo(w * 0.75, 0);
      g.lineTo(w * 0.75, h);
      g.stroke();
    });
  }
}

/**
 * Build (or fetch) the atlas texture for a character.
 * @returns {THREE.CanvasTexture}
 */
export function createAtlas(character) {
  if (cache.has(character.id)) return cache.get(character.id);
  const S = ATLAS_SIZE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S); // alpha 0 = "no override": the vertex colour shows through (see material.js)

  // ---- roundel ----
  {
    const [rx, ry, rw, rh] = REGIONS.roundel;
    g.save();
    g.translate(rx + rw / 2, ry + rh / 2);
    g.fillStyle = '#ffffff';
    g.fillRect(-rw / 2, -rh / 2, rw, rh);
    const col = character.colors;
    // outer ring
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(0, 0, 126, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = css(col.secondary === '#ffffff' ? col.primary : col.secondary);
    // dark-ish disc so the white glyph pops: accent if it is deep enough, otherwise a darkened primary
    const acc = toColor(col.accent).clone();
    const hsl = {};
    acc.getHSL(hsl);
    if (hsl.l > 0.72) toColor(col.primary).getHSL(hsl);
    const discCol = new THREE.Color().setHSL(hsl.h, Math.min(1, Math.max(0.45, hsl.s * 0.95)), Math.min(0.4, Math.max(0.2, hsl.l * 0.55)));
    g.fillStyle = css(discCol);
    g.beginPath();
    g.arc(0, 0, 112, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = css(col.primary);
    g.beginPath();
    g.arc(0, 0, 100, 0, Math.PI * 2);
    g.stroke();
    // glyph
    g.save();
    g.translate(0, -26);
    g.scale(0.62, 0.62);
    g.fillStyle = '#ffffff';
    (GLYPHS[character.species] ?? GLYPHS.robot)(g);
    g.restore();
    // number
    g.fillStyle = '#ffffff';
    g.strokeStyle = css(discCol.clone().multiplyScalar(0.5));
    g.lineWidth = 8;
    g.font = 'italic 900 88px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const num = String(RACE_NUMBERS[character.id] ?? 0);
    g.strokeText(num, 0, 62);
    g.fillText(num, 0, 62);
    g.restore();
  }

  // ---- eye artwork ----
  {
    const [x, y, w] = REGIONS.eye;
    drawEye(g, x, y, w, EYE_STYLES[character.id] ?? EYE_STYLES.blaze);
  }

  // ---- flannel plaid ----
  {
    const [x, y, w, h] = REGIONS.flannel;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = '#c4271f';
    g.fillRect(x, y, w, h);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = 'rgba(20,10,10,0.72)';
      g.fillRect(x + i * 32 + 8, y, 16, h);
      g.fillRect(x, y + i * 32 + 8, w, 16);
      g.fillStyle = 'rgba(255,190,160,0.45)';
      g.fillRect(x + i * 32 + 2, y, 3, h);
      g.fillRect(x, y + i * 32 + 2, w, 3);
    }
    g.restore();
  }

  // ---- checker ----
  {
    const [x, y, w, h] = REGIONS.checker;
    const n = 8, cs = w / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? '#111111' : '#f4f4f4';
        g.fillRect(x + i * cs, y + j * cs, cs, cs);
      }
  }

  // ---- stripes (two-tone racing stripes, u across) ----
  {
    const [x, y, w, h] = REGIONS.stripes;
    g.fillStyle = css(character.colors.secondary);
    // sweeps put the top-centre of the body at u = 0.25 (see geo.sweep); twin racing stripes around it
    g.fillRect(x + w * 0.198, y, w * 0.038, h);
    g.fillRect(x + w * 0.264, y, w * 0.038, h);
    // stop the stripes before the tail / nose poles (v = 0 tail .. 1 nose, canvas y is flipped)
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip(); // destination-in would otherwise wipe the whole canvas
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, y, 0, y + h);
    fade.addColorStop(0.0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.06, 'rgba(0,0,0,1)');
    fade.addColorStop(0.9, 'rgba(0,0,0,1)');
    fade.addColorStop(1.0, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(x, y, w, h);
    g.restore();
  }

  // ---- per-character pattern overlay ----
  drawPattern(g, character);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  cache.set(character.id, tex);
  return tex;
}
