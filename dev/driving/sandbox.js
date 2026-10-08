/**
 * Driving sandbox — a self-contained playground for the Driving agent (physics, input, camera) that does NOT
 * depend on any other agent's code except (optionally) a real track for its query/geometry.
 *
 *   /dev/driving/sandbox.html?track=test            own test stadium with ramp/gap/ice/pad/hill/crest/open edge
 *   /dev/driving/sandbox.html?track=meadow          a real track (physics only unless its build() works)
 *   &bots=3   &char=blaze   &hud=0   &lock=1 (start locked)   &timescale=0.5
 * window.sandbox exposes { game, kart, bots, cam, step(dt) } for --eval in scripts/snap.mjs.
 */
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus.js';
import { EVT } from '../../src/core/events.js';
import { CC_CLASSES } from '../../src/core/constants.js';
import { CHARACTERS, getCharacter } from '../../src/data/characters.js';
import { Kart } from '../../src/kart/Kart.js';
import { resolveKartCollisions } from '../../src/kart/collisions.js';
import { InputManager } from '../../src/input/InputManager.js';
import { PlayerController } from '../../src/input/PlayerController.js';
import { CameraController } from '../../src/camera/CameraController.js';
import { TestTrack } from './TestTrack.js';
import { DriverBot } from './bot.js';

const params = new URLSearchParams(location.search);
const trackId = params.get('track') ?? 'test';
const nBots = Number(params.get('bots') ?? 0);
const charId = params.get('char') ?? 'blaze';
const timeScale = Number(params.get('timescale') ?? 1);

// ---------------------------------------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c5ff);
scene.fog = new THREE.Fog(0x87c5ff, 200, 900);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 3000);
scene.add(camera);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x557744, 1.5);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(80, 140, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
scene.add(hemi, sun, sun.target);

// ---------------------------------------------------------------------------------------------- game shell
const events = new EventBus();
const game = {
  scene, camera, renderer, events,
  state: 'race', paused: false, time: 0,
  settings: { quality: 'high', rumble: true },
  raceConfig: { cc: 150, ccClass: CC_CLASSES[150] },
  karts: [], player: null, track: null,
  race: { phase: 'racing', phaseTime: 0, time: 0, isRacing: true },
  params,
};
game.input = new InputManager(game);

// ---------------------------------------------------------------------------------------------- track
let track;
let builtByTrack = false;
if (trackId === 'test') {
  track = new TestTrack({});
} else {
  const { createTrack } = await import('../../src/track/index.js');
  game.track = null;
  track = createTrack(trackId, game);
  try {
    game.track = track;
    track.build();
    builtByTrack = true;
  } catch (e) {
    console.warn('[sandbox] real track build failed, drawing a debug surface instead:', e.message);
  }
}
game.track = track;

/** Draw the ground exactly as the physics sees it: sample track.query() on a grid. */
function buildDebugTrackMesh(tr) {
  const group = new THREE.Group();
  const step = 2, latStep = 1.6;
  const hw = tr.hw ?? 9;
  const extent = hw + (tr.wallOff ?? 5) + 1;
  const nLat = Math.ceil((2 * extent) / latStep) + 1;
  const nS = Math.floor(tr.length / step);
  const pos = [], col = [], idx = [];
  const tmp = { index: -1 };
  const p = new THREE.Vector3();
  const C = { road: [0.22, 0.24, 0.28], offroad: [0.35, 0.55, 0.25], boost: [1.0, 0.85, 0.1], ramp: [0.95, 0.5, 0.15], ice: [0.6, 0.85, 1.0], void: [0, 0, 0] };
  const isVoid = [];
  let hint = -1;
  for (let i = 0; i <= nS; i++) {
    const f = tr.getFrameAt(i * step);
    for (let j = 0; j < nLat; j++) {
      const lat = -extent + j * latStep;
      p.copy(f.position).addScaledVector(f.right, lat);
      p.y += 0.5;
      const q = tr.query(p, hint, tmp);
      hint = q.index;
      const y = q.surface === 'void' ? f.position.y - 0.0 : q.height;
      pos.push(p.x, y, p.z);
      const c = C[q.surface] ?? C.road;
      const stripe = (Math.floor((i * step) / 6) % 2) * 0.05;
      col.push(c[0] + stripe, c[1] + stripe, c[2] + stripe);
      isVoid.push(q.surface === 'void');
    }
  }
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nLat - 1; j++) {
      const a = i * nLat + j, b = a + 1, c = a + nLat, d = c + 1;
      if (isVoid[a] || isVoid[b] || isVoid[c] || isVoid[d]) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
  m.receiveShadow = true;
  group.add(m);
  // walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd94a3a, roughness: 0.7 });
  const wallGeo = new THREE.BoxGeometry(0.6, 1.6, step * 1.02);
  for (const side of [-1, 1]) {
    const inst = new THREE.InstancedMesh(wallGeo, wallMat, nS);
    let n = 0;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < nS; i++) {
      const s = i * step;
      const q = tr.query(tr.getFrameAt(s).position, i, tmp);
      const w = side < 0 ? q.wallLeft : q.wallRight;
      if (w == null) continue;
      const f = tr.getFrameAt(s);
      p.copy(f.position).addScaledVector(f.right, w + side * 0.3);
      p.y += 0.8;
      m4.makeRotationY(Math.atan2(f.tangent.x, f.tangent.z));
      m4.setPosition(p);
      inst.setMatrixAt(n++, m4);
    }
    inst.count = n;
    inst.castShadow = true;
    group.add(inst);
  }
  // colliders
  for (const c of tr.colliders ?? []) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(c.radius, c.radius, 3, 16), new THREE.MeshStandardMaterial({ color: 0x8a5a33 }));
    const q = tr.query(new THREE.Vector3(c.x, 5, c.z), -1, {});
    cyl.position.set(c.x, q.height + 1.5, c.z);
    cyl.castShadow = true;
    group.add(cyl);
  }
  // deep ground
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0x2a5a2a }));
  gr.rotation.x = -Math.PI / 2;
  gr.position.y = (tr.killY ?? -30) - 8;
  group.add(gr);
  return group;
}
if (!builtByTrack) scene.add(buildDebugTrackMesh(track));
else if (params.get('debugmesh')) scene.add(buildDebugTrackMesh(track));

// ---------------------------------------------------------------------------------------------- karts
function makeKartMesh(character) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: character.colors.primary, roughness: 0.35, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.2), paint);
  body.position.y = 0.55;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 0.7), paint);
  nose.position.set(0, 0.45, 1.3);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), new THREE.MeshStandardMaterial({ color: character.colors.secondary }));
  head.position.set(0, 1.25, -0.15);
  g.add(body, nose, head);
  for (const [x, z] of [[-0.75, 0.75], [0.75, 0.75], [-0.75, -0.75], [0.75, -0.75]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.32, 16), dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.34, z);
    g.add(w);
  }
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

function addKart(character, slotIndex, isPlayer) {
  const kart = new Kart(game, { id: game.karts.length, character, isPlayer });
  const slot = track.startGrid[Math.min(slotIndex, track.startGrid.length - 1)];
  kart.resetForRace(slot);
  kart.controlLocked = params.get('lock') === '1';
  kart.mesh = makeKartMesh(character);
  scene.add(kart.mesh);
  game.karts.push(kart);
  return kart;
}

const chosen = getCharacter(charId);
const player = addKart(chosen, 7, true);
game.player = player;
player.controller = new PlayerController(game, player);
const others = CHARACTERS.filter((c) => c.id !== chosen.id);
const bots = [];
for (let i = 0; i < nBots; i++) {
  const k = addKart(others[i % others.length], 6 - i, false);
  const bot = new DriverBot(game, k, { drift: i % 2 === 0, lineOffset: (i % 3 - 1) * 2.5 });
  k.controller = bot;
  bots.push(bot);
}
const cam = new CameraController(game);
cam.setupRace({ track, player, karts: game.karts });
// optional intro / countdown via ?phase=intro
if (params.get('phase') === 'intro') {
  game.race.phase = 'intro';
  game.race.phaseTime = 0;
  for (const k of game.karts) k.controlLocked = true;
  events.emit(EVT.RACE_PHASE, { phase: 'intro', prev: 'idle' });
}

// ---------------------------------------------------------------------------------------------- loop
const hud = document.getElementById('hud');
if (params.get('hud') === '0') hud.style.display = 'none';
let last = performance.now();
let hudT = 0;

function simulate(dt) {
  game.time += dt;
  const race = game.race;
  race.phaseTime += dt;
  if (race.phase === 'intro' && race.phaseTime >= 4) {
    race.phase = 'countdown';
    race.phaseTime = 0;
    events.emit(EVT.RACE_PHASE, { phase: 'countdown', prev: 'intro' });
  } else if (race.phase === 'countdown' && race.phaseTime >= 3) {
    race.phase = 'racing';
    race.phaseTime = 0;
    for (const k of game.karts) { k.controlLocked = false; k.onRaceStart(); }
    events.emit(EVT.RACE_START, {});
  }
  game.input.update(dt);
  if (game.input.pressed('pause')) game.paused = !game.paused;
  if (game.input.pressed('confirm') && race.phase === 'intro') race.phaseTime = 4; // skip the intro
  if (game.paused) return;
  for (const k of game.karts) k.controller?.update(dt);
  for (const k of game.karts) k.update(dt);
  resolveKartCollisions(game.karts, dt, game);
  track.update?.(dt, player.position);
  cam.update(dt);
  for (const k of game.karts) {
    k.mesh.position.copy(k.position);
    k.mesh.quaternion.copy(k.quaternion);
    k.mesh.scale.setScalar(k.radius / 1.1);
    k.mesh.visible = k.respawnTime <= 0 || (k.respawnTime > 0 && Math.floor(game.time * 12) % 2 === 0);
  }
}

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt > 0 ? dt : 0, 1 / 20) * timeScale;
  simulate(dt);
  renderer.render(scene, camera);
  hudT += dt;
  if (hudT > 0.1 && hud.style.display !== 'none') {
    hudT = 0;
    const k = player;
    hud.textContent =
      `spd ${k.speed.toFixed(1)} / top ${k.topSpeed.toFixed(1)}  ${k.surface}  s ${k.trackS.toFixed(0)}  lat ${k.lateral.toFixed(1)}\n` +
      `${k.grounded ? 'ground' : 'AIR ' + k.airTime.toFixed(2)}  drift ${k.drifting ? k.driftDir : 0} lvl ${k.driftLevel} charge ${k.driftCharge.toFixed(2)}  boost ${k.boostTime.toFixed(2)}/${k.boostPower.toFixed(2)} ${k.boostSource ?? ''}\n` +
      `hit ${k.hit ? k.hit.type : '-'}  star ${k.starTime.toFixed(1)} shrink ${k.shrinkTime.toFixed(1)}  resp ${k.respawnTime.toFixed(2)}  trick ${k.trickTime.toFixed(2)}  dev ${game.input.lastDevice}  fov ${camera.fov.toFixed(1)}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// keyboard helpers for the sandbox: R = respawn
addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') player.respawn();
  if (e.code === 'KeyT') player.applyHit('spin');
  if (e.code === 'KeyY') player.applyHit('explode');
  if (e.code === 'KeyG') player.startStar(6);
  if (e.code === 'KeyH') player.startShrink(6);
  if (e.code === 'KeyB') player.applyBoost(1.0, 1, 'nitro');
});

window.sandbox = {
  game, kart: player, bots, cam, track, THREE,
  /** Advance the simulation manually (deterministic) without waiting for real time. */
  step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) simulate(dt); },
  place(s, lateral = 0, speed = 0, yawOffset = 0) {
    const f = track.getFrameAt(s);
    player.position.copy(f.position).addScaledVector(f.right, lateral);
    player.yaw = Math.atan2(f.tangent.x, f.tangent.z) + yawOffset;
    player.velocity.set(Math.sin(player.yaw) * speed, 0, Math.cos(player.yaw) * speed);
    player.speed = speed;
    player.trackIndex = -1;
    player._querySample();
    player.position.y = player.lastSample.height;
    player.grounded = true;
    player.up.copy(player.lastSample.normal);
    cam._acquire(0.01);
  },
};
console.log('[sandbox] ready', trackId);
