/**
 * Intro handoff test: the intro flight must end EXACTLY at the chase pose (no pop when the countdown starts).
 *   node dev/driving/introtest.mjs [trackId|test]
 */
import * as THREE from 'three';
import { makeGame, spawn, step, f2, realTrack, TestTrack, EVT } from './simlib.mjs';
import { CameraController } from '../../src/camera/CameraController.js';
import { INTRO_DURATION } from '../../src/core/constants.js';

const ids = process.argv[2] ? [process.argv[2]] : ['test', 'meadow', 'canyon', 'glacier', 'neon'];
const dt = 1 / 60;
for (const id of ids) {
  const track = id === 'test' ? new TestTrack({}) : await realTrack(id);
  const g = makeGame(track);
  g.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 5000);
  g.scene = new THREE.Scene();
  for (let i = 0; i < 8; i++) {
    const k = spawn(g, 'blaze', 0, 0, { locked: true });
    k.resetForRace(track.startGrid[i]);
    k.controlLocked = true;
  }
  const player = g.karts[7];
  g.player = player;
  const cam = new CameraController(g);
  cam.setupRace({ track, player, karts: g.karts });
  g.race.phase = 'intro';
  g.race.phaseTime = 0;
  g.events.emit(EVT.RACE_PHASE, { phase: 'intro', prev: 'idle' });
  let prev = g.camera.position.clone();
  let maxStep = 0, at = 0;
  const N = Math.round(INTRO_DURATION / dt);
  const positions = [];
  for (let i = 0; i < N; i++) {
    step(g);
    cam.update(dt);
    const p = g.camera.position;
    const d = p.distanceTo(prev);
    if (d > maxStep) { maxStep = d; at = i * dt; }
    prev.copy(p);
    positions.push(p.clone());
  }
  // now the countdown begins: chase mode
  g.race.phase = 'countdown';
  g.race.phaseTime = 0;
  g.events.emit(EVT.RACE_PHASE, { phase: 'countdown', prev: 'intro' });
  const endPos = prev.clone();
  const endQuat = g.camera.quaternion.clone();
  const endFov = g.camera.fov;
  step(g);
  cam.update(dt);
  const jump = g.camera.position.distanceTo(endPos);
  const angJump = g.camera.quaternion.angleTo(endQuat) * 57.3;
  // and a few more frames: should stay put (kart is stationary)
  let drift = 0;
  for (let i = 0; i < 30; i++) { step(g); cam.update(dt); drift = Math.max(drift, g.camera.position.distanceTo(endPos)); }
  console.log(`${id.padEnd(8)} intro max step ${f2(maxStep, 2)} m/frame (at t=${f2(at, 2)}); handoff jump ${f2(jump * 1000, 3)} mm, ${f2(angJump, 4)} deg, fov ${f2(endFov, 3)} -> ${f2(g.camera.fov, 3)}; drift over next 0.5 s ${f2(drift * 1000, 3)} mm; min camera height above ground along the path: ${f2(Math.min(...positions.map((p) => p.y - (track.query(p, -1, {}).height ?? 0))), 2)} m`);
}
