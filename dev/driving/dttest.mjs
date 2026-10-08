/**
 * Frame-rate independence: the same scripted drive at different frame rates must end in (nearly) the same place.
 *   node dev/driving/dttest.mjs
 */
import { makeGame, spawn, step, f2, place, setInput, EVT } from './simlib.mjs';

function scenario(dt) {
  const g = makeGame({ features: false, hw: 2000, wall: 2000 }); // open plane: no walls in the way
  const k = spawn(g, 'blaze', 20, 0);
  place(k, 20, 0, 0);
  const n = Math.round(11 / dt);
  const events = [];
  g.events.on(EVT.KART_DRIFT_LEVEL, (p) => events.push('L' + p.level + '@' + g.time.toFixed(2)));
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    // launch, cruise, steer taps, a drift with steering changes, release, boost pad and brake
    setInput(k, {
      throttle: t < 9 ? 1 : 0,
      steer: t > 3 && t < 3.3 ? 1 : t > 4.2 && t < 4.4 ? -1 : t > 5.5 && t < 7.5 ? 0.6 : 0,
      drift: t > 5.4 && t < 7.8,
      brake: t > 9 ? 1 : 0,
    });
    step(g, dt);
  }
  return { pos: k.position.clone(), yaw: k.yaw, speed: k.speed, events };
}
const rates = [30, 45, 60, 90, 144, 240];
const ref = scenario(1 / 60);
console.log('reference @60 fps: pos', ref.pos.toArray().map((x) => f2(x, 2)).join(','), 'yaw', f2(ref.yaw, 3), 'speed', f2(ref.speed, 2), ref.events.join(' '));
let worst = 0;
for (const r of rates) {
  const o = scenario(1 / r);
  const d = o.pos.distanceTo(ref.pos);
  worst = Math.max(worst, d);
  console.log(`${String(r).padStart(3)} fps: pos ${o.pos.toArray().map((x) => f2(x, 2)).join(',')}  |dpos| ${f2(d, 2)} m  dyaw ${f2(o.yaw - ref.yaw, 3)}  dspeed ${f2(o.speed - ref.speed, 2)}  ${o.events.join(' ')}`);
}
console.log(worst < 3 ? `\nOK: worst deviation ${f2(worst, 2)} m over ~300 m of driving` : `\nWARNING: deviation ${f2(worst, 2)} m`);
