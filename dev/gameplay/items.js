/**
 * Dev page: every item mesh + a row of item boxes, lit like the game (ACES, env reflections, bloom).
 * ?focus=banana|bouncer|seeker|bomb|comet|box|all   ?angle=deg   ?t=seconds (freeze time)   ?bloom=0
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ItemRenderer, CometVisual } from '/src/items/ItemRenderer.js';
import { ItemBoxes } from '/src/items/ItemBoxes.js';

const params = new URLSearchParams(location.search);
if (params.get('focus') === 'tex') {
  const { buildBoxFaceTexture } = await import('/src/items/itemGeometry.js');
  const t = buildBoxFaceTexture();
  t.image.style.cssText = 'position:fixed;left:0;top:0;width:512px;height:512px;background:#000;z-index:9';
  document.body.appendChild(t.image);
}
const focus = params.get('focus') || 'all';
const angleDeg = Number(params.get('angle') ?? 25);
const freeze = params.has('t') ? Number(params.get('t')) : null;
const useBloom = params.get('bloom') !== '0';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c5ff);
scene.fog = new THREE.Fog(0x87c5ff, 60, 400);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x557744, 0.9);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
scene.add(hemi, sun);

// asphalt with a dashed line
const cv = document.createElement('canvas');
cv.width = cv.height = 512;
const g = cv.getContext('2d');
g.fillStyle = '#3d424c';
g.fillRect(0, 0, 512, 512);
for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},255,0.03)`; g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
g.fillStyle = '#b8b8b8';
g.fillRect(250, 0, 12, 200);
g.fillRect(250, 300, 12, 200);
const asphalt = new THREE.CanvasTexture(cv);
asphalt.colorSpace = THREE.SRGBColorSpace;
asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
asphalt.repeat.set(4, 4);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.85 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const group = new THREE.Group();
scene.add(group);
const items = new ItemRenderer(group);
const comet = new CometVisual(group);

const slots = [];
for (let i = 0; i < 7; i++) slots.push({ position: new THREE.Vector3((i - 3) * 2.6, 0, -7), s: 0, lateral: 0 });
const boxes = new ItemBoxes(group, slots);
// show a shattered + respawning one for the pop animation
boxes.collect(boxes.list[6]);
boxes.list[6].timer = 1.5;

const POS = {
  banana: new THREE.Vector3(-6, 0, 0),
  bouncer: new THREE.Vector3(-3.4, 0.5, 0),
  seeker: new THREE.Vector3(-1.4, 0.5, 0),
  bomb: new THREE.Vector3(1.4, 0.5, 0),
  comet: new THREE.Vector3(5, 1.6, 0),
};
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const eul = new THREE.Euler();
const fwd = new THREE.Vector3(0, 0, 1);

let t = freeze ?? 0;
function updateItems(dt) {
  items.begin();
  // three bananas at different yaws
  for (let i = 0; i < 3; i++) {
    p.copy(POS.banana).add(new THREE.Vector3(i * 0.9 - 0.6 * (i === 1 ? -1 : 0), 0, i * 0.8 - 0.8));
    items.addBanana(p, i * 1.7 + 0.4, 1);
  }
  // orbs spin about their travel axis
  eul.set(0, 0.5, t * 6, 'YXZ');
  q.setFromEuler(eul);
  items.addOrb(0, POS.bouncer, q, 1);
  items.addGlow(POS.bouncer, 0.3, 1.1, 0.4, 1.0, 0);
  eul.set(0, -0.4, t * 5, 'YXZ');
  q.setFromEuler(eul);
  items.addOrb(1, POS.seeker, q, 1);
  items.addGlow(POS.seeker, 1.2, 0.25, 0.25, 1.0, 0);
  // bomb
  eul.set(0.1, t * 0.8, 0);
  q.setFromEuler(eul);
  items.addBomb(POS.bomb, q, 1);
  items.bombFuseWorld(POS.bomb, q, 1, p);
  const fl = 0.75 + 0.25 * Math.sin(t * 40);
  items.addGlow(p, 3.2 * fl, 1.6 * fl, 0.4 * fl, 0.28 + 0.06 * fl);
  items.end();
  fwd.set(Math.sin(t * 0.6), 0, Math.cos(t * 0.6));
  comet.place(POS.comet, fwd, dt);
}

const cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
function placeCamera() {
  const a = (angleDeg * Math.PI) / 180;
  let target, dist, height;
  switch (focus) {
    case 'banana': target = new THREE.Vector3(-5.6, 0.15, 0); dist = 2.6; height = 1.6; break;
    case 'bouncer': target = POS.bouncer.clone(); dist = 2.2; height = 0.5; break;
    case 'seeker': target = POS.seeker.clone(); dist = 2.2; height = 0.5; break;
    case 'bomb': target = POS.bomb.clone().add(new THREE.Vector3(0, 0.3, 0)); dist = 2.6; height = 0.6; break;
    case 'comet': target = POS.comet.clone(); dist = 4.2; height = 0.6; break;
    case 'box': target = new THREE.Vector3(0, 1.4, -7); dist = 5.5; height = 0.8; break;
    default: target = new THREE.Vector3(0, 0.9, -2.5); dist = 15; height = 4.5;
  }
  cam.position.set(target.x + Math.sin(a) * dist, target.y + height, target.z + Math.cos(a) * dist);
  cam.lookAt(target);
}
placeCamera();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, cam));
if (useBloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.45, 1.1));
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  cam.aspect = innerWidth / innerHeight;
  cam.updateProjectionMatrix();
});

document.getElementById('label').textContent = `focus=${focus}  banana | bouncer | seeker | bomb | comet   ·   item boxes (last one re-spawning)`;
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = freeze != null ? 0.0001 : Math.min(0.05, (now - last) / 1000);
  last = now;
  if (freeze == null) t += dt;
  updateItems(Math.max(dt, 1e-4));
  boxes.update(freeze != null ? 0 : dt);
  if (freeze != null) boxes.time = freeze;
  if (focus === 'box' || focus === 'all') { /* rotate the camera slowly for the overview in live mode */ }
  composer.render();
  window.__ready = true;
});
window.__items = { items, comet, boxes, scene, cam, renderer };
