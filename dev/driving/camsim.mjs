/**
 * Headless camera analysis: a DriverBot drives while the real CameraController follows; we measure how
 * smoothly the kart sits in the frame (screen-space jitter) and how the camera moves.
 *   node dev/driving/camsim.mjs [trackId|test] [seconds] [--nodrift]
 */
import * as THREE from 'three';
import { makeGame, spawn, step, f2, realTrack, TestTrack, EVT } from './simlib.mjs';
import { DriverBot } from './bot.js';
import { CameraController, CAM } from '../../src/camera/CameraController.js';

const id = process.argv[2] ?? 'meadow';
const seconds = +(process.argv[3] ?? 40);
const drift = !process.argv.includes('--nodrift');
const dt = 1 / 60;
const track = id === 'test' ? new TestTrack({}) : await realTrack(id);
const g = makeGame(track);
g.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 5000);
g.scene = new THREE.Scene();
const k = spawn(g, 'blaze', 0, 0);
k.resetForRace(track.startGrid[track.startGrid.length - 1]);
k.controlLocked = false;
g.player = k;
const bot = new DriverBot(g, k, { drift });
k.controller = bot;
const cam = new CameraController(g);
cam.setupRace({ track, player: k, karts: g.karts });

const W = 1920, H = 1080;
const ndc = [];
const camRel = [];
const fovs = [];
const v = new THREE.Vector3();
const proj = new THREE.Vector3();
let maxShake = 0;
for (let i = 0; i < seconds * 60; i++) {
  bot.update(dt);
  step(g);
  cam.update(dt);
  g.camera.updateMatrixWorld(true);
  g.camera.updateProjectionMatrix();
  proj.copy(k.position).setY(k.position.y + 0.8).project(g.camera);
  ndc.push([proj.x * W * 0.5, proj.y * H * 0.5]);
  camRel.push(v.copy(g.camera.position).sub(k.position).clone());
  fovs.push(g.camera.fov);
  maxShake = Math.max(maxShake, cam._trauma);
}
// high-frequency jitter of the kart's screen position: subtract a centered moving average (window 11 frames)
function hf(series, win = 11) {
  const half = (win - 1) / 2;
  let sum2 = 0, n = 0, max = 0;
  for (let i = half; i < series.length - half; i++) {
    let mx = 0, my = 0;
    for (let j = -half; j <= half; j++) { mx += series[i + j][0]; my += series[i + j][1]; }
    mx /= win; my /= win;
    const dx = series[i][0] - mx, dy = series[i][1] - my;
    const d = Math.hypot(dx, dy);
    sum2 += d * d; n++; max = Math.max(max, d);
  }
  return { rms: Math.sqrt(sum2 / n), max };
}
const j = hf(ndc);
// frame-to-frame screen motion outliers (sudden jumps)
let maxStep = 0, sumStep = 0;
for (let i = 1; i < ndc.length; i++) { const d = Math.hypot(ndc[i][0] - ndc[i - 1][0], ndc[i][1] - ndc[i - 1][1]); maxStep = Math.max(maxStep, d); sumStep += d; }
// camera acceleration (kart-relative offset second difference)
let maxAcc = 0;
for (let i = 2; i < camRel.length; i++) {
  const a = camRel[i].clone().sub(camRel[i - 1].clone().multiplyScalar(2)).add(camRel[i - 2]);
  maxAcc = Math.max(maxAcc, a.length());
}
console.log(`track ${id}, drift ${drift}: kart screen-position jitter (px @1080p): rms ${f2(j.rms, 3)}  max ${f2(j.max, 2)};  frame-step avg ${f2(sumStep / ndc.length, 2)} max ${f2(maxStep, 1)};  cam-offset accel max ${f2(maxAcc, 3)} m/frame^2;  fov ${f2(Math.min(...fovs), 1)}..${f2(Math.max(...fovs), 1)}  bot stats drifts ${bot.stats.drifts} walls ${bot.stats.walls}`);
// position of the kart on screen range
const xs = ndc.map((p) => p[0]), ys = ndc.map((p) => p[1]);
console.log(`kart screen offset from centre: x ${f2(Math.min(...xs), 0)}..${f2(Math.max(...xs), 0)}  y ${f2(Math.min(...ys), 0)}..${f2(Math.max(...ys), 0)} px`);
