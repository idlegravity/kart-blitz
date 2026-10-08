/**
 * FX dev page: a fake game (renderer + PostFX + Effects + a few KartModels driving in a circle).
 *   ?burst=explosion|hit|boxBreak|sparks|dust|splash|confetti|smoke|ring|stars|lightning   trigger one-shot bursts (repeats every 2.5 s)
 *   ?emit=drift0|drift1|drift2|drift3|nitro|mini1|mini2|mini3|gold|pad|star|rocket|dust|skid   continuous emitter state on the player
 *   ?theme=meadow|canyon|glacier|neon   ?follow=1 chase camera   ?t=<sec>&freeze=1   ?char=<id>   ?quality=low|medium|high
 *   ?event=land|hit-explode|hit-spin|wall|trick|respawn|shrink   ?nopost=1
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CHARACTERS, getCharacter } from '../../src/data/characters.js';
import { KartModel } from '../../src/visuals/KartModel.js';
import { Effects } from '../../src/fx/Effects.js';
import { PostFX } from '../../src/fx/PostFX.js';
import { events } from '../../src/core/EventBus.js';
import { EVT } from '../../src/core/events.js';

const q = new URLSearchParams(location.search);
const quality = q.get('quality') || 'high';
const theme = q.get('theme') || 'meadow';
let emit = q.get('emit') || '';
const burst = q.get('burst') || '';
const follow = q.get('follow') === '1';
const freeze = q.get('freeze') === '1';
const still = q.get('still') === '1';
const dist = Number(q.get('dist') || 9);
const tStart = Number(q.get('t') || 0);
const THEMES = { meadow: 0x6fbf5a, canyon: 0xd9a066, glacier: 0xdff2ff, neon: 0x15122e };

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(theme === 'neon' ? 0x07051a : 0x7fb8ff);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = theme === 'neon' ? 0.25 : 0.55;
const sun = new THREE.DirectionalLight(0xfff2dd, theme === 'neon' ? 0.6 : 2.8);
sun.position.set(30, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
scene.add(sun, new THREE.HemisphereLight(0xcfe8ff, 0x556677, theme === 'neon' ? 0.4 : 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: THEMES[theme], roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// road ring
const road = new THREE.Mesh(new THREE.RingGeometry(10, 19, 96), new THREE.MeshStandardMaterial({ color: 0x2c2f38, roughness: 0.85 }));
road.rotation.x = -Math.PI / 2;
road.position.y = 0.02;
road.receiveShadow = true;
scene.add(road);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);
scene.add(camera);

// ---- fake game ----
const game = {
  renderer, scene, camera, events, settings: { quality }, state: 'race', paused: false,
  karts: [], player: null, track: { theme, waterLevel: 0 }, race: { phase: 'racing' },
};
game.postfx = new PostFX(game);
game.effects = new Effects(game);

function makeKart(c, i, isPlayer) {
  const k = {
    id: i, character: c, isPlayer,
    position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(),
    forward: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0),
    yaw: 0, speed: 24, topSpeed: 30, steerAmount: 0.4, throttleAmount: 1, grounded: true, airTime: 0, surface: 'road',
    drifting: false, driftDir: 0, driftCharge: 0, driftLevel: 0, boostTime: 0, boostPower: 0, boostSource: null,
    starTime: 0, shrinkTime: 0, hit: null, invulnTime: 0, trickTime: 0, respawnTime: 0, controlLocked: false,
    input: { throttle: 1, brake: 0, steer: 0, drift: false, item: false, lookBack: false, aimBack: false },
    finished: false, lastSample: null,
  };
  k.model = new KartModel(c, { isPlayer, quality });
  scene.add(k.model.root);
  return k;
}
const chars = [getCharacter(q.get('char') || 'blaze'), getCharacter('bolt'), getCharacter('rex'), getCharacter('mochi')];
chars.forEach((c, i) => {
  const k = makeKart(c, i, i === 0);
  k.phase = i * 1.5;
  game.karts.push(k);
  if (i === 0) game.player = k;
});
game.effects.setupRace({});

const P = game.player;
function applyEmit(k, t) {
  const m = emit;
  k.drifting = false; k.driftDir = 0; k.driftLevel = 0; k.driftCharge = 0; k.boostTime = 0; k.boostPower = 0; k.boostSource = null;
  k.starTime = 0; k.surface = 'road'; k.drafting = false; k.draftCharge = 0; k.stallTime = 0; k.slipAmount = 0;
  if (m.startsWith('drift')) { k.drifting = true; k.driftDir = 1; k.driftLevel = Number(m.slice(5)) || 0; k.driftCharge = 0.2 + k.driftLevel; k.steerAmount = 0.9; }
  else if (m === 'nitro') { k.boostTime = 3; k.boostPower = 1; k.boostSource = 'nitro'; }
  else if (m.startsWith('mini')) { k.boostTime = 3; k.boostPower = 1; k.boostSource = 'miniturbo'; k.__lvl = Number(m.slice(4)); }
  else if (m === 'gold') { k.boostTime = 3; k.boostPower = 1.5; k.boostSource = 'goldnitro'; }
  else if (m === 'pad') { k.boostTime = 3; k.boostPower = 1; k.boostSource = 'pad'; }
  else if (m === 'rocket') { k.boostTime = 3; k.boostPower = 2; k.boostSource = 'rocketstart'; }
  else if (m === 'star') { k.starTime = 8; k.boostTime = 3; k.boostPower = 1; k.boostSource = 'star'; }
  else if (m === 'dust') k.surface = 'offroad';
  else if (m === 'draft') { k.drafting = true; k.draftCharge = 1.3; }
  else if (m === 'draftboost') { k.boostTime = 3; k.boostPower = 0.6; k.boostSource = 'draft'; }
  else if (m === 'stall') { k.stallTime = 1; k.speed = 2; }
  else if (m === 'slip') { k.slipAmount = 0.9; }
  else if (m === 'skid') { k.drifting = true; k.driftDir = -1; k.driftCharge = 0.1; k.steerAmount = -0.8; }
}

let simT = 0;
let lastBurst = -10;
function step(dt) {
  simT += dt;
  // drive around the ring
  game.karts.forEach((k, i) => {
    const R = 14.5 + i * 0.0;
    const w = 24 / R;
    const a = (still ? 0 : simT) * w + (k.phase ?? 0) * 0.3 + (still ? i * 0.25 : 0);
    if (i === 0) applyEmit(k, simT);
    const px = Math.sin(a) * R, pz = Math.cos(a) * R;
    const dir = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(-1); // tangent (clockwise)
    k.position.set(px, 0, pz);
    const yaw = Math.atan2(-dir.x * -1, -dir.z * -1);
    const heading = Math.atan2(Math.cos(a) * -1 * -1, -Math.sin(a) * -1);
    // tangent of (sin a, cos a) is (cos a, -sin a)
    const tx = Math.cos(a), tz = -Math.sin(a);
    k.yaw = Math.atan2(tx, tz);
    const slide = k.drifting ? -0.32 * k.driftDir : 0;
    k.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), k.yaw + slide);
    k.forward.set(Math.sin(k.yaw), 0, Math.cos(k.yaw));
    k.right.set(-Math.cos(k.yaw), 0, Math.sin(k.yaw));
    k.velocity.copy(k.forward).multiplyScalar(k.speed);
    if (i > 0) { k.speed = still ? 0 : 24; k.steerAmount = 0.3; }
    if (i === 0) k.speed = emit === 'stall' ? 2 : 24;
    if (still && i === 0 && !emit) k.speed = 0;
    k.model.update(dt, k);
  });
  if (burst && simT - lastBurst > 2.5 && simT > (Number(q.get('at') || 0.4))) {
    lastBurst = simT;
    const p = P.position.clone().add(new THREE.Vector3(0, 0.8, 0)).addScaledVector(P.forward, dist);
    game.effects.burst(burst, burst === 'confetti' ? p.clone().setY(3) : p, { owner: P });
  }
  const ev = q.get('event');
  if (ev && simT - lastBurst > 2.5 && simT > 0.4) {
    lastBurst = simT;
    const kk = P;
    if (ev === 'land') events.emit(EVT.KART_LAND, { kart: kk, impact: 12 });
    if (ev === 'hit-explode') { kk.hit = { type: 'explode', t: 0, duration: 2 }; events.emit(EVT.KART_HIT, { kart: kk, type: 'explode', source: null }); }
    if (ev === 'wall') events.emit(EVT.KART_WALL, { kart: kk, impact: 12, point: kk.position.clone().addScaledVector(kk.right, -1).add(new THREE.Vector3(0, 0.4, 0)) });
    if (ev === 'trick') events.emit(EVT.KART_TRICK, { kart: kk });
  }
  if (P.hit) { P.hit.t += dt; if (P.hit.t > P.hit.duration) P.hit = null; }
  // mini-turbo colour comes from drift level tracking inside Effects (feed events)
  if (emit.startsWith('mini') && simT < dt * 2 + 0.02) events.emit(EVT.KART_DRIFT_END, { kart: P, level: P.__lvl });
  game.effects.update(dt);
  // camera
  if (follow) {
    const cp = P.position.clone().addScaledVector(P.forward, -6.5).add(new THREE.Vector3(0, 3.0, 0));
    camera.position.lerp(cp, 0.35);
    camera.lookAt(P.position.clone().addScaledVector(P.forward, 3).add(new THREE.Vector3(0, 0.8, 0)));
  } else {
    camera.position.set(q.has('cam') ? Number(q.get('cam').split(',')[0]) : 0, q.has('cam') ? Number(q.get('cam').split(',')[1]) : 11, q.has('cam') ? Number(q.get('cam').split(',')[2]) : 30);
    camera.lookAt(0, 1.2, 8);
  }
}
for (let i = 0; i < Math.round(tStart * 60); i++) step(1 / 60);

// buttons
const ui = document.getElementById('ui');
for (const b of ['explosion', 'hit', 'boxBreak', 'sparks', 'dust', 'splash', 'confetti', 'smoke', 'ring', 'stars', 'lightning']) {
  const btn = document.createElement('button');
  btn.textContent = b;
  btn.onclick = () => {
    const p = P.position.clone().add(new THREE.Vector3(0, 0.8, 0)).addScaledVector(P.forward, dist);
    game.effects.burst(b, b === 'confetti' ? p.setY(3) : p, { owner: P });
  };
  ui.appendChild(btn);
}

// live emitter state buttons
const ui2 = document.createElement('div');
ui2.style.cssText = 'position:fixed;left:8px;bottom:8px;display:flex;flex-wrap:wrap;gap:4px;max-width:90vw';
for (const e of ['', 'drift0', 'drift1', 'drift2', 'drift3', 'nitro', 'mini1', 'mini2', 'mini3', 'gold', 'pad', 'star', 'rocket', 'dust', 'skid', 'draft', 'draftboost', 'stall', 'slip']) {
  const b = document.createElement('button');
  b.textContent = 'emit:' + (e || 'none');
  b.style.cssText = 'font:11px monospace;padding:3px 6px;background:#223;color:#fff;border:1px solid #556;border-radius:4px;cursor:pointer';
  b.onclick = () => { emit = e; if (e.startsWith('mini')) events.emit(EVT.KART_DRIFT_END, { kart: P, level: Number(e.slice(4)) }); };
  ui2.appendChild(b);
}
document.body.appendChild(ui2);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (!freeze) step(dt);
  else step(0);
  if (q.has('nopost')) renderer.render(scene, camera);
  else game.postfx.render(scene, camera, dt);
  document.getElementById('info').textContent = `emit=${emit} burst=${burst} calls ${renderer.info.render.calls} tris ${renderer.info.render.triangles}`;
});
window.__game = game;
window.__ready = true;
