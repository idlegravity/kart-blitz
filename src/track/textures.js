/**
 * Procedural texture generators (canvas / data textures). Everything is drawn in code.
 * OWNER: World agent.
 */
import * as THREE from 'three';
import { hash2, pfbm, pnoise } from './noise.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Wrap a drawn canvas into a texture. opts: { srgb = true, repeat = false, aniso = 8, mip = true, pixelated = false } */
export function canvasTexture(canvas, opts = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.mip === false) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  if (opts.pixelated) t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function dataTexture(data, size, srgb) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Tileable RGBA noise (4 independent fBm channels, values centered near 0.5). Used by terrain shaders. */
export function makeNoiseTexture(size = 256, seed = 1) {
  const data = new Uint8Array(size * size * 4);
  const per = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * per, v = (y / size) * per;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        const f = pfbm(u * (1 + c * 0.0), v, per, 5, seed + c * 101);
        // increase contrast around 0.5
        const g = Math.min(1, Math.max(0, (f - 0.5) * 1.9 + 0.5));
        data[o + c] = Math.round(g * 255);
      }
    }
  }
  return dataTexture(data, size, false);
}

function heightToNormal(h, size, strength) {
  const out = new Uint8Array(size * size * 4);
  const at = (x, y) => h[(((y + size) % size) * size + ((x + size) % size))];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const m = Math.hypot(nx, ny, nz);
      nx /= m; ny /= m; nz /= m;
      const o = (y * size + x) * 4;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Tileable asphalt: albedo (speckle, mottling, repair patches, hairline cracks), normal map and a roughness map.
 * base: [r,g,b] 0..255
 */
export function makeAsphalt(base = [62, 66, 74], speck = 1, size = 512, seed = 5) {
  const albedo = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const per = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * per, v = (y / size) * per;
      const macro = pfbm(u, v, per, 4, seed) - 0.5; // -0.5..0.5
      const mid = pfbm(u * 4, v * 4, per * 4, 3, seed + 9) - 0.5;
      const grain = hash2(x, y, seed + 3);
      const grain2 = hash2(x >> 1, y >> 1, seed + 4);
      // repair patches: thresholded low-freq noise gives blobs with hard edges
      const pn = pfbm(u * 0.5 + 3.1, v * 0.5 + 1.7, per, 3, seed + 21);
      const patch = pn > 0.66 ? 1 : 0;
      const patch2 = pn < 0.30 ? 1 : 0;
      let k = 1 + macro * 0.22 + mid * 0.10 + (grain - 0.5) * 0.22 * speck + (grain2 - 0.5) * 0.08 * speck;
      k *= 1 + patch * 0.035 - patch2 * 0.03;
      // aggregate sparkle
      const st = hash2(x * 3, y * 7, seed + 5);
      if (st > 0.985) k += 0.28 * speck;
      else if (st < 0.012) k -= 0.18 * speck;
      const o = (y * size + x) * 4;
      albedo[o] = Math.max(0, Math.min(255, base[0] * k));
      albedo[o + 1] = Math.max(0, Math.min(255, base[1] * k));
      albedo[o + 2] = Math.max(0, Math.min(255, base[2] * k));
      albedo[o + 3] = 255;
      const r = 0.82 + (grain - 0.5) * 0.18 - patch * 0.08 + macro * 0.15;
      rough[o] = 255; rough[o + 1] = Math.max(0, Math.min(255, r * 255)); rough[o + 2] = 0; rough[o + 3] = 255;
      height[y * size + x] = grain * 0.6 + grain2 * 0.3 + (st > 0.985 ? 0.6 : 0) + mid * 0.5;
    }
  }
  // hairline cracks (random walks, wrapped so the tile stays seamless)
  const stamp = (px, py, dk) => {
    const xi = ((Math.round(px) % size) + size) % size, yi = ((Math.round(py) % size) + size) % size;
    const o = (yi * size + xi) * 4;
    albedo[o] *= dk; albedo[o + 1] *= dk; albedo[o + 2] *= dk;
    height[yi * size + xi] -= 0.7;
  };
  const cracks = 14;
  for (let c = 0; c < cracks; c++) {
    let px = hash2(c, 1, seed + 40) * size, py = hash2(c, 2, seed + 40) * size;
    let ang = hash2(c, 3, seed + 40) * Math.PI * 2;
    const len = 60 + hash2(c, 4, seed + 40) * 160;
    for (let i = 0; i < len; i++) {
      ang += (hash2(c, i + 10, seed + 41) - 0.5) * 0.5;
      px += Math.cos(ang); py += Math.sin(ang);
      stamp(px, py, 0.62);
      if (hash2(c, i + 500, seed + 42) > 0.985) {
        // branch
        let bx = px, by = py, ba = ang + (hash2(c, i, seed + 43) > 0.5 ? 1 : -1) * 0.9;
        for (let j = 0; j < 22; j++) { ba += (hash2(i, j, seed + 44) - 0.5) * 0.6; bx += Math.cos(ba); by += Math.sin(ba); stamp(bx, by, 0.7); }
      }
    }
  }
  const normal = heightToNormal(height, size, 1.4);
  return {
    map: dataTexture(albedo, size, true),
    normalMap: dataTexture(normal, size, false),
    roughnessMap: dataTexture(rough, size, false),
  };
}

/** Text on a transparent or filled canvas texture (signs, billboards). */
export function makeTextTexture(text, opts = {}) {
  const w = opts.width ?? 1024, h = opts.height ?? 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  if (opts.background) {
    g.fillStyle = opts.background;
    g.fillRect(0, 0, w, h);
  } else g.clearRect(0, 0, w, h);
  if (opts.border) {
    g.strokeStyle = opts.border;
    g.lineWidth = opts.borderWidth ?? 10;
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  }
  const size = opts.size ?? Math.round(h * 0.6);
  g.font = `${opts.weight ?? 'normal'} ${size}px ${opts.font ?? "'Lilita One', 'Arial Black', Impact, sans-serif"}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = String(text).split('\n');
  const lh = size * 1.05;
  const y0 = h / 2 - ((lines.length - 1) * lh) / 2 + (opts.dy ?? 0);
  lines.forEach((ln, i) => {
    const y = y0 + i * lh;
    if (opts.shadow) {
      g.fillStyle = opts.shadow;
      g.fillText(ln, w / 2 + size * 0.04, y + size * 0.05);
    }
    if (opts.stroke) {
      g.lineWidth = opts.strokeWidth ?? size * 0.09;
      g.strokeStyle = opts.stroke;
      g.lineJoin = 'round';
      g.strokeText(ln, w / 2, y);
    }
    if (opts.glow) {
      g.shadowColor = opts.glow;
      g.shadowBlur = size * 0.35;
    }
    g.fillStyle = opts.color ?? '#fff';
    g.fillText(ln, w / 2, y);
    g.shadowBlur = 0;
  });
  return canvasTexture(c, { aniso: 8 });
}

/** Checkered flag / banner texture. */
export function makeCheckerTexture(cols = 8, rows = 2, a = '#ffffff', b = '#111111', px = 32) {
  const c = makeCanvas(cols * px, rows * px);
  const g = c.getContext('2d');
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    g.fillStyle = (x + y) % 2 ? a : b;
    g.fillRect(x * px, y * px, px, px);
  }
  const t = canvasTexture(c, { mip: true });
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Diagonal warning stripes (yellow/black by default). */
export function makeStripeTexture(a = '#ffcf1a', b = '#161616', size = 128) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = a;
  g.fillRect(0, 0, size, size);
  g.fillStyle = b;
  for (let i = -2; i < 4; i++) {
    g.beginPath();
    g.moveTo(i * size * 0.5, 0);
    g.lineTo(i * size * 0.5 + size * 0.25, 0);
    g.lineTo(i * size * 0.5 + size * 0.25 + size, size);
    g.lineTo(i * size * 0.5 + size, size);
    g.closePath();
    g.fill();
  }
  return canvasTexture(c, { repeat: true });
}

export { pnoise };

/** Yellow chevron warning sign (arrow pointing right). */
export function makeChevronSignTexture() {
  const w = 256, h = 150;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rr = (x, y, ww, hh, r) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + ww, y, x + ww, y + hh, r);
    g.arcTo(x + ww, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r);
    g.arcTo(x, y, x + ww, y, r);
    g.closePath();
  };
  g.fillStyle = '#111';
  rr(0, 0, w, h, 16);
  g.fill();
  g.fillStyle = '#ffc61a';
  rr(8, 8, w - 16, h - 16, 10);
  g.fill();
  g.fillStyle = '#141414';
  for (let i = 0; i < 3; i++) {
    const x = 52 + i * 52;
    g.beginPath();
    g.moveTo(x, 30);
    g.lineTo(x + 34, 75);
    g.lineTo(x, 120);
    g.lineTo(x - 16, 120);
    g.lineTo(x + 18, 75);
    g.lineTo(x - 16, 30);
    g.closePath();
    g.fill();
  }
  return canvasTexture(c, { aniso: 8 });
}


/** Frosted ice with a network of hairline cracks (RGBA, alpha carries the frost / opacity). */
export function makeIceTexture(size = 512, seed = 3) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const per = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * per, v = (y / size) * per;
      const n = pfbm(u, v, per, 4, seed);
      const n2 = pfbm(u * 3, v * 3, per * 3, 3, seed + 5);
      const o = (y * size + x) * 4;
      const k = 0.78 + n * 0.28 + (n2 - 0.5) * 0.12;
      img.data[o] = Math.min(255, 168 * k);
      img.data[o + 1] = Math.min(255, 218 * k);
      img.data[o + 2] = Math.min(255, 250 * k);
      img.data[o + 3] = Math.round(225 + (n - 0.5) * 60);
    }
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  const walk = (x, y, ang, len, w, alpha) => {
    g.strokeStyle = `rgba(245,252,255,${alpha})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < len; i++) {
      ang += (hash2(i + Math.floor(x), Math.floor(y), seed + 3) - 0.5) * 0.7;
      x += Math.cos(ang) * 3.2; y += Math.sin(ang) * 3.2;
      g.lineTo(x, y);
    }
    g.stroke();
    return [x, y, ang];
  };
  for (let k = 0; k < 26; k++) {
    let x = hash2(k, 1, seed) * size, y = hash2(k, 2, seed) * size, ang = hash2(k, 3, seed) * 6.28;
    const len = 30 + hash2(k, 4, seed) * 70;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) walk(x + ox, y + oy, ang, len, 1.4, 0.75);
    if (k % 2 === 0) {
      x += Math.cos(ang) * len * 1.6; y += Math.sin(ang) * len * 1.6;
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) walk(x + ox, y + oy, ang + 0.8, len * 0.6, 1.0, 0.6);
    }
  }
  return canvasTexture(c, { repeat: true, aniso: 8 });
}

/** Soft round snow-flake sprite. */
export function makeFlakeTexture() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c, { srgb: true, mip: false });
}


/** Soft-edged drift/patch texture (sand, dirt, gravel). Alpha fades irregularly toward all four edges (uv 0..1). */
export function makeDriftTexture(base = [222, 168, 96], seed = 5, ripple = true) {
  const size = 256;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1), v = y / (size - 1);
      const n = pfbm(u * 6, v * 6, 6, 4, seed);
      const n2 = pfbm(u * 24, v * 24, 24, 2, seed + 4);
      const d = Math.min(u, 1 - u, v, 1 - v);
      const a = Math.max(0, Math.min(1, (d + (n - 0.5) * 0.22) / 0.13));
      const rip = ripple ? 0.5 + 0.5 * Math.sin(v * 70 + n * 9) : 0.5;
      const k = 0.86 + n * 0.22 + rip * 0.07 + (hash2(x, y, seed) - 0.5) * 0.07 + (n2 - 0.5) * 0.06;
      const o = (y * size + x) * 4;
      img.data[o] = Math.min(255, base[0] * k);
      img.data[o + 1] = Math.min(255, base[1] * k);
      img.data[o + 2] = Math.min(255, base[2] * k);
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, { aniso: 8 });
}


/** Greyscale edge mask (white inside, irregular soft fall-off to black at the uv borders) for use as an alphaMap. */
export function makeDriftMask(seed = 7, feather = 0.12, wobble = 0.24) {
  const size = 256;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1), v = y / (size - 1);
      const n = pfbm(u * 5, v * 5, 5, 4, seed);
      const d = Math.min(u, 1 - u, v, 1 - v);
      const a = Math.max(0, Math.min(1, (d + (n - 0.5) * wobble) / feather));
      const o = (y * size + x) * 4;
      const k = Math.round(a * 255);
      img.data[o] = img.data[o + 1] = img.data[o + 2] = k;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = canvasTexture(c, { srgb: false, aniso: 4 });
  return t;
}
