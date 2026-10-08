import * as THREE from 'three';
import { CHARACTERS } from '../../src/data/characters.js';
import { getPortrait } from '../../src/visuals/portraits.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(64, 64);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const game = { renderer };
const size = Number(new URLSearchParams(location.search).get('size') || 256);
const t0 = performance.now();
const grid = document.getElementById('grid');
for (const c of CHARACTERS) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  const img = new Image();
  img.src = getPortrait(game, c.id, size);
  cell.append(img, Object.assign(document.createElement('div'), { textContent: c.name }));
  const small = document.createElement('div');
  small.className = 'small';
  for (const s of [48, 64]) {
    const i2 = new Image();
    i2.src = getPortrait(game, c.id, s);
    i2.style.width = i2.style.height = s + 'px';
    small.append(i2);
  }
  cell.append(small);
  grid.append(cell);
}
console.log('portraits ms', Math.round(performance.now() - t0));
window.__ready = true;
