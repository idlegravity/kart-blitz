import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CHARACTERS, getCharacter } from '../../src/data/characters.js';
import { makePalette, buildChassis, buildWheelGeo, buildSteeringGeo, KART_CLASSES } from '../../src/visuals/karts.js';
import { createAtlas } from '../../src/visuals/atlas.js';
import { makeKartUniforms, createKartMaterial } from '../../src/visuals/material.js';

const q = new URLSearchParams(location.search);
const charId = q.get('char') || 'blaze';
const view = q.get('view') || '34';
const character = getCharacter(charId);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b3358);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 4);
sun.castShadow = true;
scene.add(sun, new THREE.HemisphereLight(0xcfe8ff, 0x445566, 0.8));
const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: 0x3a4266, roughness: 0.6 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
const views = { '34': [3.2, 1.8, 3.6], side: [4.4, 0.9, 0], back: [0, 1.6, -4.5], front: [0, 1.4, 4.5], top: [0.01, 6, 0.01] };
cam.position.set(...(views[view] || views['34']));
const controls = new OrbitControls(cam, renderer.domElement);
controls.target.set(0, 0.7, 0);
controls.update();

const C = makePalette(character);
const cn = character.weightClass;
const cls = KART_CLASSES[cn];
const atlas = createAtlas(character);
const uniforms = makeKartUniforms(atlas);
const mat = createKartMaterial(uniforms, { quality: 'high' });
const chassis = buildChassis(cn, C);
if (q.has('report')) console.log(JSON.stringify(chassis.log));
const group = new THREE.Group();
scene.add(group);
const mk = (geo) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
mk(chassis.geo);
let tris = chassis.tris;
for (const [key, spec] of Object.entries(cls.wheels)) {
  const w = buildWheelGeo(spec, cn, C);
  tris += w.tris * 2;
  for (const s of [1, -1]) {
    const m = mk(w.geo);
    m.position.set(s * spec.x, spec.r, spec.z);
    if (s < 0) m.rotation.y = Math.PI;
  }
}
const st = buildSteeringGeo(cn, C);
const sm = mk(st.geo);
sm.position.set(...cls.steer.pos);
sm.rotation.set(cls.steer.tilt, Math.PI, 0);
tris += st.tris;
document.getElementById('info').textContent = `${character.name} (${cn})  chassis tris ${chassis.tris}  total ${tris}`;

renderer.setAnimationLoop((t) => {
  uniforms.uTime.value = t / 1000;
  controls.update();
  renderer.render(scene, cam);
});
window.__ready = true;
