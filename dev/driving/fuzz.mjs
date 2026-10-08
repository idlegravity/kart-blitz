/**
 * Robustness fuzz (Node): random inputs for several minutes on every real track + the test track.
 * Invariants: no NaN / Infinity, no exceptions, speed bounded, the kart never stays lost forever (respawns work),
 * trackS continuity, no runaway velocities. Also exercises hits/boost/star/shrink/launch randomly.
 *   node dev/driving/fuzz.mjs [seconds] [seed]
 */
import { makeGame, spawn, step, f2, realTrack, TestTrack, EVT, CHARACTERS } from './simlib.mjs';
import * as THREE from 'three';
import { makeRng } from '../../src/core/math.js';
import { CameraController } from '../../src/camera/CameraController.js';

const seconds = +(process.argv[2] ?? 120);
const seed = +(process.argv[3] ?? 7);
const dt0 = 1 / 60;
const VARDT = process.argv.includes('--vardt');
const tracks = { test: new TestTrack({}) };
for (const id of ['meadow', 'canyon', 'glacier', 'neon']) tracks[id] = await realTrack(id);
let failures = 0;
for (const [id, track] of Object.entries(tracks)) {
  const rng = makeRng(seed + id.length * 31);
  const g = makeGame(track);
  const karts = [];
  for (let i = 0; i < 8; i++) {
    const k = spawn(g, CHARACTERS[i].id, 0, 0);
    k.resetForRace(track.startGrid[Math.min(i, track.startGrid.length - 1)]);
    k.controlLocked = false;
    karts.push(k);
  }
  // camera on kart 0: must never produce NaN / absurd poses, whatever the kart does
  g.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 5000);
  g.scene = new THREE.Scene();
  g.player = karts[0];
  const cam = new CameraController(g);
  cam.setupRace({ track, player: karts[0], karts });
  let camBad = 0, camFar = 0, fovMin = 999, fovMax = 0;
  const counts = {};
  for (const name of Object.values(EVT)) g.events.on(name, () => (counts[name] = (counts[name] ?? 0) + 1));
  let maxSpeed = 0, maxY = -1e9, minY = 1e9, nan = 0, stuck = 0, worstStuck = 0, maxDs = 0;
  const lastS = karts.map((k) => k.trackS);
  const plan = karts.map(() => ({ t: 0, steer: 0, thr: 1, brk: 0, drift: false }));
  const stuckT = karts.map(() => 0);
  const lastPos = karts.map((k) => k.position.clone());
  let simT = 0;
  for (let i = 0; simT < seconds; i++) {
    // --vardt: random frame times (1/240 .. 1/20) with occasional dt = 0 (paused) frames
    const dt = VARDT ? (rng() < 0.03 ? 0 : 1 / 240 + rng() * (1 / 20 - 1 / 240)) : dt0;
    simT += dt || 1 / 60;
    karts.forEach((k, n) => {
      const p = plan[n];
      p.t -= dt;
      if (p.t <= 0) {
        p.t = 0.2 + rng() * 1.5;
        p.steer = rng() < 0.3 ? 0 : (rng() * 2 - 1);
        p.thr = rng() < 0.85 ? 1 : 0;
        p.brk = rng() < 0.1 ? 1 : 0;
        p.drift = rng() < 0.4;
      }
      Object.assign(k.input, { throttle: p.thr, brake: p.brk, steer: p.steer, drift: p.drift });
      const r = rng();
      if (r < 0.0004) k.applyHit(['spin', 'tumble', 'explode', 'squish'][Math.floor(rng() * 4)], karts[(n + 1) % 8]);
      else if (r < 0.0007) k.applyBoost(0.5 + rng(), 0.8 + rng() * 0.4, 'nitro');
      else if (r < 0.0008) k.startStar(2 + rng() * 3);
      else if (r < 0.0009) k.startShrink(2 + rng() * 3);
      else if (r < 0.0011) k.launch(4 + rng() * 10);
      else if (r < 0.00113) k.respawn();
      else if (r < 0.00125) k.applyImpulse((rng() - 0.5) * 8, (rng() - 0.5) * 8);
      else if (r < 0.00135) k.nudgeYaw((rng() - 0.5) * 0.3);
      else if (r < 0.00140) k.controlLocked = !k.controlLocked;
    });
    try {
      step(g, dt);
      cam.update(dt);
      const cp = g.camera.position, cq = g.camera.quaternion;
      if (![cp.x, cp.y, cp.z, cq.x, cq.y, cq.z, cq.w, g.camera.fov].every(Number.isFinite)) camBad++;
      if (cp.distanceTo(karts[0].position) > 40 && cam.mode === 'chase' && cam._blendT >= 1 && !cam._falling) camFar++;
      fovMin = Math.min(fovMin, g.camera.fov); fovMax = Math.max(fovMax, g.camera.fov);
    } catch (e) {
      console.log(id, 'EXCEPTION', e.stack.split('\n').slice(0, 4).join('\n'));
      failures++;
      break;
    }
    karts.forEach((k, n) => {
      const v = k.velocity, p = k.position;
      if (![p.x, p.y, p.z, v.x, v.y, v.z, k.yaw, k.speed].every(Number.isFinite)) nan++;
      maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z));
      maxY = Math.max(maxY, p.y);
      minY = Math.min(minY, p.y);
      const d = Math.abs(track.deltaS(lastS[n], k.trackS));
      if (k.respawnTime <= 0 && k.grounded) maxDs = Math.max(maxDs, d);
      lastS[n] = k.trackS;
      if (VARDT && dt === 0) return;
      // stuck: barely moved for a long time while trying to drive
      if (p.distanceTo(lastPos[n]) < 0.02 && k.respawnTime <= 0 && k.input.throttle > 0.5 && !k.hit && !k.controlLocked && k.stallTime <= 0) stuckT[n] += dt; else stuckT[n] = 0;
      worstStuck = Math.max(worstStuck, stuckT[n]);
      lastPos[n].copy(p);
    });
  }
  const ok = nan === 0 && maxSpeed < 100 && failures === 0 && camBad === 0;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(8)} nan ${nan}  maxSpeed ${f2(maxSpeed, 1)}  y ${f2(minY, 1)}..${f2(maxY, 1)}  camera: bad ${camBad} far ${camFar} fov ${f2(fovMin, 1)}..${f2(fovMax, 1)}  worst pinned time ${f2(worstStuck, 1)}s  max grounded |ds|/frame ${f2(maxDs, 2)}  events: ${['kart:wall', 'kart:hit', 'kart:bump', 'kart:driftStart', 'kart:driftEnd', 'kart:fall', 'kart:respawn', 'kart:land', 'kart:boost', 'kart:trick'].map((n) => `${n.split(':')[1]}=${counts[n] ?? 0}`).join(' ')}`);
}
console.log(failures ? `\n${failures} FAILURES` : '\nFUZZ PASSED');
process.exit(failures ? 1 : 0);
