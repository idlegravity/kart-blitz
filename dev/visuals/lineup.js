/**
 * Lineup dev page: all 8 karts side by side, OrbitControls, URL-selectable animation states with a fake kart.
 *   ?anim=idle|drive|drift|boost|hit-spin|hit-tumble|hit-explode|hit-squish|star|shrink|respawn|victory|trick|lookback|brake
 *   ?only=<characterId>   single kart          ?view=front|back|side|top|34|close   camera preset
 *   ?t=<sec>&freeze=1     fast-forward the animation clock and freeze it (deterministic screenshots)
 *   ?quality=low|medium|high   ?post=1  render through PostFX    ?tris=1  print triangle counts
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CHARACTERS, getCharacter } from '../../src/data/characters.js';
import { KartModel, kartTriangleCount } from '../../src/visuals/KartModel.js';
import { events } from '../../src/core/EventBus.js';
import { createAtlas } from '../../src/visuals/atlas.js';
import { EVT } from '../../src/core/events.js';

const q = new URLSearchParams(location.search);
const anim = q.get('anim') || 'idle';
const only = q.get('only');
const view = q.get('view') || 'front';
const quality = q.get('quality') || 'high';
const tStart = Number(q.get('t') || 0);
const freeze = q.get('freeze') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b3358);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 8, bottom: -8, near: 1, far: 40 });
sun.shadow.bias = -0.0004;
scene.add(sun, new THREE.HemisphereLight(0xcfe8ff, 0x556677, 0.85));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ color: 0x4a5482, roughness: 0.7 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const cam = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 200);
const chars = only ? [getCharacter(only)] : CHARACTERS;
const spacing = 2.7;
const span = (chars.length - 1) * spacing;
const presets = {
  front: [0, 1.9, 9 + span * 0.55],
  '34': [span * 0.35 + 4, 2.4, 8 + span * 0.45],
  back: [0, 2.4, -(7 + span * 0.5)],
  side: [9 + span * 0.5, 1.4, 0],
  top: [0.01, 14 + span, 0.01],
  close: [3.2, 1.7, 3.6],
  closeback: [1.2, 2.0, -4.4],
  frontclose: [2.6, 1.5, 4.2],
};
cam.position.set(...(presets[view] || presets.front));
const controls = new OrbitControls(cam, renderer.domElement);
controls.target.set(0, 0.8, 0);
if (q.has('cam')) cam.position.set(...q.get('cam').split(',').map(Number));
if (q.has('target')) controls.target.set(...q.get('target').split(',').map(Number));
if (q.has('fov')) { cam.fov = Number(q.get('fov')); cam.updateProjectionMatrix(); }
controls.update();

const models = [];
const karts = [];
chars.forEach((c, i) => {
  const m = new KartModel(c, { quality });
  const x = (i - (chars.length - 1) / 2) * spacing;
  m.root.position.set(x, 0, 0);
  scene.add(m.root);
  models.push(m);
  const k = {
    id: i, character: c,
    position: new THREE.Vector3(x, 0, 0), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(),
    speed: 0, topSpeed: 30, steerAmount: 0, throttleAmount: 0, grounded: true, airTime: 0, surface: 'road',
    drifting: false, driftDir: 0, driftLevel: 0, boostTime: 0, boostPower: 0, boostSource: null,
    starTime: 0, shrinkTime: 0, hit: null, invulnTime: 0, trickTime: 0, respawnTime: 0, controlLocked: false,
    input: { throttle: 1, brake: 0, steer: 0, drift: false, item: false, lookBack: false, aimBack: false },
    finished: false, lastSample: null,
  };
  karts.push(k);
});

if (q.has('atlas')) {
  const cv = createAtlas(chars[0]).image;
  cv.style.cssText = 'position:fixed;right:0;top:0;width:512px;height:512px;background:#456;border:1px solid #fff;z-index:9';
  document.body.appendChild(cv);
}
if (q.has('tris')) {
  for (const c of CHARACTERS) console.log(`[tris] ${c.id} ${kartTriangleCount(c, quality)}`);
}

let simT = 0;
function drive(k, i, t) {
  const ph = i * 0.6;
  k.hit = null; k.drifting = false; k.driftDir = 0; k.driftLevel = 0; k.boostTime = 0; k.starTime = 0; k.shrinkTime = 0;
  k.invulnTime = 0; k.respawnTime = 0; k.finished = false; k.speed = 0; k.steerAmount = 0; k.throttleAmount = 0;
  k.input.lookBack = false; k.input.brake = 0; k.trickTime = 0;
  switch (anim) {
    case 'idle': return null;
    case 'drive': k.speed = 26; k.topSpeed = 30; k.steerAmount = Math.sin(t * 0.9 + ph); k.throttleAmount = 1; break;
    case 'steerleft': k.speed = 20; k.steerAmount = -1; break;
    case 'steerright': k.speed = 20; k.steerAmount = 1; break;
    case 'drift': k.speed = 27; k.steerAmount = 0.8; k.drifting = true; k.driftDir = 1; k.driftLevel = 1 + (Math.floor(t / 1.5) % 3); k.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.32); break;
    case 'boost': k.speed = 33; k.boostTime = 2; k.boostPower = 1; k.throttleAmount = 1; break;
    case 'brake': k.speed = 14; k.input.brake = 1; break;
    case 'lookback': k.speed = 24; k.input.lookBack = true; break;
    case 'hit-spin': k.speed = 8; k.hit = { type: 'spin', t: t % 2.2, duration: 1.0 }; if (k.hit.t > 1) k.hit = null; break;
    case 'hit-tumble': k.speed = 8; k.hit = { type: 'tumble', t: t % 2.6, duration: 1.4 }; if (k.hit.t > 1.4) k.hit = null; break;
    case 'hit-explode': k.speed = 8; k.hit = { type: 'explode', t: t % 3.4, duration: 2.0 }; if (k.hit.t > 2) k.hit = null; break;
    case 'hit-squish': k.speed = 8; k.hit = { type: 'squish', t: t % 3, duration: 1.5 }; if (k.hit.t > 1.5) k.hit = null; break;
    case 'star': k.speed = 24; k.starTime = 8; k.steerAmount = Math.sin(t + ph) * 0.5; break;
    case 'shrink': k.speed = 20; k.shrinkTime = (Math.floor(t / 2.5) % 2) ? 0 : 5; break;
    case 'respawn': k.speed = 0; k.respawnTime = 3; break;
    case 'victory': k.speed = 12; k.finished = true; k.steerAmount = Math.sin(t * 0.5 + ph) * 0.4; break;
    case 'invuln': k.speed = 20; k.invulnTime = 5; break;
    case 'trick': k.speed = 24; k.trickTime = (t % 2.4) < 0.1 ? 0.5 : 0; if ((t % 2.4) < 0.05) events.emit(EVT.KART_TRICK, { kart: k }); break;
    default: k.speed = 10;
  }
  return k;
}

function step(dt) {
  simT += dt;
  models.forEach((m, i) => {
    const k = drive(karts[i], i, simT);
    m.update(dt, k);
  });
}
// fast forward
for (let i = 0; i < Math.round(tStart * 60); i++) step(1 / 60);

let last = performance.now();
document.getElementById('info').textContent = `anim=${anim}  view=${view}  quality=${quality}`;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (!freeze) step(dt);
  else step(0);
  controls.update();
  renderer.render(scene, cam);
});
window.__ready = true;
window.__models = models;
