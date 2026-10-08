/**
 * Headless physics harness for the Driving agent: builds a fake `game`, spawns real Kart instances on the
 * TestTrack and steps them at a fixed dt with scripted input. Pure Node (no browser / GPU).
 */
import * as THREE from 'three';
import { Kart } from '../../src/kart/Kart.js';
import { resolveKartCollisions } from '../../src/kart/collisions.js';
import { EventBus } from '../../src/core/EventBus.js';
import { EVT } from '../../src/core/events.js';
import { CC_CLASSES } from '../../src/core/constants.js';
import { CHARACTERS } from '../../src/data/characters.js';
import { TestTrack } from './TestTrack.js';

export { THREE, Kart, EVT, CHARACTERS, TestTrack, resolveKartCollisions };

/** trackOpts: a Track instance (real or TestTrack) or TestTrack options. */
export function makeGame(trackOpts = {}, cc = 150) {
  const events = new EventBus();
  const track = typeof trackOpts?.query === 'function' ? trackOpts : new TestTrack(trackOpts);
  const game = {
    events,
    track,
    raceConfig: { cc, ccClass: CC_CLASSES[cc] },
    karts: [],
    race: { phase: 'racing', phaseTime: 0 },
    time: 0,
    log: [],
  };
  for (const name of Object.values(EVT)) events.on(name, (p) => game.log.push({ t: game.time, name, p }));
  return game;
}

/** Spawn a kart at track distance s (lateral offset in m). Controls are unlocked. */
export function spawn(game, charId = 'blaze', s = 10, lateral = 0, opts = {}) {
  const character = CHARACTERS.find((c) => c.id === charId) ?? CHARACTERS[0];
  const k = new Kart(game, { id: game.karts.length, character, isPlayer: true });
  const f = game.track.getFrameAt(s);
  k.resetForRace({ position: f.position.clone().addScaledVector(f.right, lateral), yaw: Math.atan2(f.tangent.x, f.tangent.z) });
  k.controlLocked = opts.locked ?? false;
  game.karts.push(k);
  return k;
}

/** Build one of the real tracks (World agent) headlessly: no scene, so no meshes. Only query/getFrameAt/etc. are used. */
export async function realTrack(id) {
  const { createTrack } = await import('../../src/track/index.js');
  return createTrack(id, { scene: null, params: new URLSearchParams(''), settings: { quality: 'low' }, events: null });
}

export function step(game, dt = 1 / 60) {
  for (const k of game.karts) k.update(dt);
  resolveKartCollisions(game.karts, dt, game);
  game.time += dt;
  game.race.phaseTime += dt;
}

/** Run `seconds`, calling fn(t, i) before every step. */
export function run(game, seconds, fn, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    fn?.(game.time, i);
    step(game, dt);
  }
}

export const events = (game, name) => game.log.filter((e) => e.name === name);
export const clearLog = (game) => (game.log.length = 0);
export const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/** Put a kart at a given s / lateral with a given speed along the track (velocity set along the yaw). */
export function place(kart, s, lateral = 0, speed = 0, yawOffset = 0) {
  const tr = kart.game.track;
  const f = tr.getFrameAt(s);
  kart.position.copy(f.position).addScaledVector(f.right, lateral);
  kart.yaw = Math.atan2(f.tangent.x, f.tangent.z) + yawOffset;
  kart.velocity.set(Math.sin(kart.yaw) * speed, 0, Math.cos(kart.yaw) * speed);
  kart.speed = speed;
  kart.trackIndex = -1;
  kart._querySample();
  kart.position.y = kart.lastSample.height;
  kart.grounded = true;
  kart.airTime = 0;
  kart.up.copy(kart.lastSample.normal);
  kart._lastGroundY = kart.position.y;
  return kart;
}

export function setInput(k, o) {
  Object.assign(k.input, { throttle: 0, brake: 0, steer: 0, drift: false, item: false, lookBack: false, aimBack: false }, o);
}
