/**
 * Showroom dev page (fake game).  ?mode=title|menu|select|track|podium  ?char=<id>  ?track=<id>  ?t=<sec>  ?freeze=1
 *   ?quality=low|medium|high   ?mock=1 shows dashed boxes where the UI sits
 *   buttons switch modes live; select mode: left/right arrows cycle characters
 */
import * as THREE from 'three';
import { CHARACTERS } from '../../src/data/characters.js';
import { TRACK_LIST } from '../../src/track/index.js';
import { Showroom } from '../../src/visuals/Showroom.js';
import { PostFX } from '../../src/fx/PostFX.js';
import { events } from '../../src/core/EventBus.js';

const q = new URLSearchParams(location.search);
const quality = q.get('quality') || 'high';
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const game = { renderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), events, settings: { quality }, state: 'menu', paused: false, karts: [], player: null, race: { phase: 'menu' } };
game.postfx = new PostFX(game);
const showroom = new Showroom(game);
game.showroom = showroom;

let ci = Math.max(0, CHARACTERS.findIndex((c) => c.id === (q.get('char') || 'blaze')));
function apply(mode) {
  if (mode === 'select') showroom.setMode('select', { characterId: CHARACTERS[ci].id });
  else if (mode === 'track') showroom.setMode('track', { trackId: q.get('track') || TRACK_LIST[0].id });
  else if (mode === 'podium') showroom.setMode('podium', { characterIds: [CHARACTERS[ci].id, CHARACTERS[(ci + 3) % 8].id, CHARACTERS[(ci + 5) % 8].id] });
  else showroom.setMode(mode);
}
apply(q.get('mode') || 'title');
const ui = document.getElementById('ui');
for (const m of ['title', 'menu', 'select', 'track', 'podium']) {
  const b = document.createElement('button');
  b.textContent = m;
  b.onclick = () => apply(m);
  ui.appendChild(b);
}
for (const t of TRACK_LIST) {
  const b = document.createElement('button');
  b.textContent = 'track:' + t.id;
  b.onclick = () => showroom.setMode('track', { trackId: t.id });
  ui.appendChild(b);
}
window.addEventListener('keydown', (e) => {
  if (showroom.getMode() !== 'select') return;
  if (e.key === 'ArrowRight') ci = (ci + 1) % CHARACTERS.length;
  else if (e.key === 'ArrowLeft') ci = (ci + CHARACTERS.length - 1) % CHARACTERS.length;
  else return;
  showroom.showCharacter(CHARACTERS[ci].id);
});
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  game.postfx.setSize(innerWidth, innerHeight);
  showroom.resize(innerWidth, innerHeight);
});
if (q.get('mock') === '1') {
  const m = document.getElementById('mock');
  m.querySelector('.panel').style.display = ['menu', 'select', 'track'].includes(q.get('mode')) ? 'block' : 'none';
  m.querySelector('.logo').style.display = ['title'].includes(q.get('mode')) ? 'block' : 'none';
}
// scripted char switching for screenshots: ?swap=blaze>rex@1.5
const swaps = (q.get('swap') || '').split(',').filter(Boolean).map((s) => { const [id, t] = s.split('@'); return { id, t: Number(t) }; });

let simT = 0;
const step = (dt) => {
  simT += dt;
  for (const s of swaps) if (!s.done && simT >= s.t) { s.done = true; showroom.showCharacter(s.id); }
  showroom.update(dt);
};
for (let i = 0; i < Math.round(Number(q.get('t') || 0) * 60); i++) step(1 / 60);
let last = performance.now();
const freeze = q.get('freeze') === '1';
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  step(freeze ? 0 : dt);
  game.postfx.render(showroom.scene, showroom.camera, dt);
  document.getElementById('info').textContent = `${showroom.getMode()}  calls ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k`;
});
window.__game = game;
window.__ready = true;
