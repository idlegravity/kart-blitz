/**
 * World viewer: pick a track (?track=meadow|canyon|glacier|neon), orbit / overview / drive-along cameras,
 * draw-call & triangle readout. Screenshot helpers are exposed on window.viewer for snap.mjs --actions=eval:...
 *   /dev/world/viewer.html?track=canyon&cam=drive&s=300
 *   window.viewer.drive(s, { back, height, lateral, look, fov })  window.viewer.overview()  window.viewer.orbit(x,y,z, tx,ty,tz)
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { Track } from '/src/track/Track.js';
import { TRACK_LIST } from '/src/track/index.js';
import { QUALITY } from '/src/core/constants.js';

const params = new URLSearchParams(location.search);
const trackId = params.get('track') || 'meadow';
const quality = ['low', 'medium', 'high'].includes(params.get('quality')) ? params.get('quality') : 'high';
const hud = document.getElementById('hud');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QUALITY[quality].pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(Number(params.get('fov') || 70), innerWidth / innerHeight, 0.1, 5000);
scene.add(camera);
const game = { scene, camera, renderer, settings: { quality }, debug: {}, events: { on() {}, emit() {} } };

let track = null;
let post = null;
const kartMarker = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 0.8, 2.2),
  new THREE.MeshStandardMaterial({ color: 0xff3b3b, roughness: 0.4 }),
);
kartMarker.castShadow = true;
kartMarker.visible = params.get('marker') !== '0';
scene.add(kartMarker);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
const fly = new FlyControls(camera, renderer.domElement);
fly.movementSpeed = 45;
fly.rollSpeed = 0.6;
fly.dragToLook = true;
fly.enabled = false;
let mode = params.get('cam') || 'orbit';
let driveS = Number(params.get('s') || 0);
let driveSpeed = Number(params.get('speed') || 0);
let driveOpts = { back: 9, height: 3.6, lateral: 0, look: 8, fov: 70 };
let paused = false;
let focus = new THREE.Vector3();
let tBuild = 0;

function loadTrack(id) {
  if (track) track.dispose();
  const info = TRACK_LIST.find((t) => t.id === id) ?? TRACK_LIST[0];
  return import(`/src/track/defs/${info.id}.js`).then((m) => {
    track = new Track({ ...info, ...m.default, id: info.id, name: info.name, theme: info.theme }, game);
    const t0 = performance.now();
    track.build();
    tBuild = performance.now() - t0;
    window.track = track;
    window.viewerTrack = track;
    if (mode === 'overview') overview();
    else if (mode === 'drive') drive(driveS);
    else orbit();
    window.__ready = true;
  });
}

function setFly(on) {
  fly.enabled = on;
  controls.enabled = !on;
  if (on) mode = 'fly'; else mode = 'orbit';
  refreshBar();
}

function overview(opts = {}) {
  mode = 'overview';
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const h = opts.height ?? span * 0.95;
  const back = opts.back ?? span * 0.55;
  camera.fov = opts.fov ?? 50;
  camera.updateProjectionMatrix();
  camera.position.set(cx, (b.minY + b.maxY) / 2 + h, cz + back);
  controls.target.set(cx, (b.minY + b.maxY) / 2, cz);
  camera.lookAt(controls.target);
  controls.update();
  kartMarker.visible = false;
  focus.set(cx, 0, cz);
}

function orbit(x, y, z, tx, ty, tz) {
  mode = 'orbit';
  if (x === undefined) {
    const f = track.getFrameAt(0);
    camera.position.set(f.position.x - f.tangent.x * 22, f.position.y + 9, f.position.z - f.tangent.z * 22);
    controls.target.copy(f.position).addScaledVector(f.tangent, 25);
  } else {
    camera.position.set(x, y, z);
    controls.target.set(tx, ty, tz);
  }
  camera.lookAt(controls.target);
  controls.update();
}

const _f = {};
function drive(s, opts = {}) {
  mode = 'drive';
  driveS = s;
  driveOpts = { ...driveOpts, ...opts };
  placeDrive();
}
function placeDrive() {
  const o = driveOpts;
  const fk = track.getFrameAt(driveS, _f);
  const lateral = o.lateral;
  const q = track.query(new THREE.Vector3(fk.position.x + fk.right.x * lateral, fk.position.y + 1, fk.position.z + fk.right.z * lateral), -1, {});
  kartMarker.visible = params.get('marker') !== '0';
  kartMarker.position.set(fk.position.x + fk.right.x * lateral, q.height + 0.4, fk.position.z + fk.right.z * lateral);
  kartMarker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.normal);
  kartMarker.rotateY(Math.atan2(fk.tangent.x, fk.tangent.z));
  const back = track.getFrameAt(driveS - o.back, {});
  const look = track.getFrameAt(driveS + o.look, {});
  camera.position.set(back.position.x + back.right.x * lateral * 0.7, back.position.y + o.height + (o.heightBias ?? 0), back.position.z + back.right.z * lateral * 0.7);
  const target = new THREE.Vector3(look.position.x + look.right.x * lateral, look.position.y + 1.0, look.position.z + look.right.z * lateral);
  camera.lookAt(target);
  camera.fov = o.fov;
  camera.updateProjectionMatrix();
  controls.target.copy(target);
  focus.copy(kartMarker.position);
}

/** Compare track.query() heights against ray casts on the rendered ribbon / terrain meshes. */
function probe(n = 3000, opts = {}) {
  const names = new Set(['asphalt', 'shoulder', 'terrain', 'ramps', 'curbs']);
  const meshes = [];
  track.group.traverse((o) => { if (o.isMesh && names.has(o.name)) meshes.push(o); });
  const rc = new THREE.Raycaster();
  rc.far = 900;
  const dir = new THREE.Vector3(0, -1, 0);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lat = opts.lateral ?? 30;
  const stats = { n: 0, miss: 0, maxErr: 0, sumErr: 0, bad: 0, badSamples: [], surfaces: {}, voidHits: 0 };
  const q = {};
  const cl = track.cl;
  for (let k = 0; k < n; k++) {
    const s = rnd() * track.length;
    const f = track.getFrameAt(s, {});
    const l = (rnd() * 2 - 1) * (f.halfWidth + lat);
    const x = f.position.x + f.right.x * l, z = f.position.z + f.right.z * l;
    const yTop = track.noGround ? f.position.y - l * Math.tan(f.bank) + 3 : 400;
    rc.set(new THREE.Vector3(x, yTop, z), dir);
    const hits = rc.intersectObjects(meshes, false);
    const p = new THREE.Vector3(x, track.noGround ? f.position.y - l * Math.tan(f.bank) + 1 : (hits[0]?.point.y ?? 0) + 0.5, z);
    track.query(p, -1, q);
    stats.surfaces[q.surface] = (stats.surfaces[q.surface] || 0) + 1;
    if (q.surface === 'void') { stats.voidHits++; continue; }
    if (!hits.length) { stats.miss++; continue; }
    const err = Math.abs(hits[0].point.y - q.height);
    stats.n++;
    stats.sumErr += err;
    if (err > stats.maxErr) stats.maxErr = err;
    if (err > 0.06) { stats.bad++; if (stats.badSamples.length < 8) stats.badSamples.push({ s: +s.toFixed(1), l: +l.toFixed(2), err: +err.toFixed(3), qh: +q.height.toFixed(2), mh: +hits[0].point.y.toFixed(2), surf: q.surface, mesh: hits[0].object.name }); }
  }
  stats.meanErr = stats.sumErr / Math.max(1, stats.n);
  return stats;
}

/** Count draw calls per mesh name for the current camera (frustum + visibility) and estimate the shadow pass. */
function breakdown() {
  const frustum = new THREE.Frustum();
  const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(m);
  const res = {};
  const sphere = new THREE.Sphere();
  scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    let vis = true;
    if (o.frustumCulled) {
      if (o.isInstancedMesh) { if (!o.boundingSphere) o.computeBoundingSphere(); sphere.copy(o.boundingSphere).applyMatrix4(o.matrixWorld); }
      else { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld); }
      vis = frustum.intersectsSphere(sphere);
    }
    if (!vis) return;
    const n = o.name || o.type;
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    const e = res[n] || (res[n] = { calls: 0, tris: 0, shadowCalls: 0 });
    e.calls++; e.tris += Math.round(tris);
    if (o.castShadow) {
      // approximate: within the 60 m shadow box around the focus
      const d = sphere.center.distanceTo(focus) - sphere.radius;
      if (d < 85) e.shadowCalls++;
    }
  });
  const rows = Object.entries(res).sort((a, b) => b[1].calls - a[1].calls).map(([k, v]) => `${k}: ${v.calls} calls (${v.shadowCalls} sh) ${(v.tris / 1000).toFixed(0)}k tris`);
  return rows;
}

/** Camera relative to the track frame at s: pos = [along, up, right], target = [along, up, right]. */
function rel(s, pos, target, fov = 60) {
  const f = track.getFrameAt(s, {});
  const at = (v) => new THREE.Vector3(f.position.x + f.tangent.x * v[0] + f.right.x * v[2], f.position.y + v[1], f.position.z + f.tangent.z * v[0] + f.right.z * v[2]);
  const p = at(pos), t = at(target);
  mode = 'orbit';
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.position.copy(p);
  controls.target.copy(t);
  camera.lookAt(t);
  controls.update();
  kartMarker.visible = false;
  focus.copy(t);
}

/** Look at the nth landmark of a type from a given offset [dx, dy, dz] (world axes). */
function landmark(type, n = 0, off = [30, 14, 30], fov = 60) {
  const l = track.landmarks.filter((x) => x.type === type)[n];
  if (!l) return false;
  mode = 'orbit';
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.position.set(l.position.x + off[0], l.position.y + off[1], l.position.z + off[2]);
  controls.target.copy(l.position);
  camera.lookAt(l.position);
  controls.update();
  kartMarker.visible = false;
  focus.copy(l.position);
  return true;
}

/** Sweep the drive camera along the lap, reporting draw calls / triangles per frame (max & mean). */
async function sweep(n = 48, opts = {}) {
  const res = [];
  const L = track.length;
  const saveMode = mode;
  for (let k = 0; k < n; k++) {
    drive((k / n) * L, opts);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    res.push([Math.round((k / n) * L), renderer.info.render.calls, Math.round(renderer.info.render.triangles / 1000)]);
  }
  mode = saveMode;
  const calls = res.map((r) => r[1]), tris = res.map((r) => r[2]);
  const worst = res.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { maxCalls: Math.max(...calls), meanCalls: Math.round(calls.reduce((a, b) => a + b, 0) / n), maxKTris: Math.max(...tris), meanKTris: Math.round(tris.reduce((a, b) => a + b, 0) / n), worstAt: worst };
}

window.viewer = { sweep, landmark, rel, breakdown, probe, overview, orbit, drive, get track() { return track; }, camera, renderer, scene, loadTrack, setPaused: (p) => (paused = p) };

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
addEventListener('keydown', (e) => {
  // in fly mode the letter keys belong to the fly camera (only F / Escape leave it)
  if (mode === 'fly' && !(e.key === 'f' || e.key === 'Escape' || (e.key >= '1' && e.key <= '4'))) return;
  if (e.key === 'Escape') { setFly(false); return; }
  if (e.key >= '1' && e.key <= '4') loadTrack(TRACK_LIST[Number(e.key) - 1].id);
  else if (e.key === 'o') orbit();
  else if (e.key === 'f') setFly(mode !== 'fly');
  else if (e.key === 'z') { const qs = ['low', 'medium', 'high']; const u = new URL(location.href); u.searchParams.set('quality', qs[(qs.indexOf(quality) + 1) % 3]); location.href = u.toString(); }
  else if (e.key === 'v') overview();
  else if (e.key === 'd') { mode = 'drive'; driveSpeed = driveSpeed || 30; }
  else if (e.key === ' ') paused = !paused;
  else if (e.key === '[') driveSpeed = Math.max(0, driveSpeed - 10);
  else if (e.key === ']') driveSpeed += 10;
});

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fps = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (!track) return;
  if (mode === 'drive') {
    if (!paused && driveSpeed) driveS += driveSpeed * dt;
    placeDrive();
  } else if (mode === 'fly') {
    fly.update(dt);
    focus.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 25);
  } else {
    controls.update();
    if (mode === 'orbit') focus.copy(controls.target);
  }
  track.update(paused ? 0 : dt, focus);
  renderer.render(scene, camera);
  const info = renderer.info;
  hud.textContent = `${track.id}  L ${track.length.toFixed(0)} m  build ${tBuild.toFixed(0)} ms\n${fps.toFixed(0)} fps  calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  geoms ${info.memory.geometries}  tex ${info.memory.textures}\ncam ${mode}  s ${driveS.toFixed(0)}`;
});

const bar = document.getElementById('bar');
function refreshBar() {
  bar.innerHTML = '';
  const mk = (label, fn, on) => { const b = document.createElement('button'); b.textContent = label; if (on) b.className = 'on'; b.onclick = fn; bar.appendChild(b); };
  for (const t of TRACK_LIST) mk(t.id, () => { const u = new URL(location.href); u.searchParams.set('track', t.id); location.href = u.toString(); }, track && track.id === t.id);
  mk('orbit', () => { setFly(false); orbit(); }, mode === 'orbit');
  mk('fly', () => setFly(true), mode === 'fly');
  mk('overview', () => { setFly(false); overview(); }, mode === 'overview');
  mk('drive', () => { setFly(false); mode = 'drive'; driveSpeed = driveSpeed || 30; refreshBar(); }, mode === 'drive');
  mk('q:' + quality, () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' })), false);
}
setInterval(refreshBar, 1000);

loadTrack(trackId);
