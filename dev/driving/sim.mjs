/**
 * Driving physics scenarios (Node). Usage: node dev/driving/sim.mjs [scenario ...]   (no args = all)
 * Prints numbers to compare against the spec in the brief / tuning.js.
 */
import { makeGame, spawn, run, step, events, clearLog, f2, place, setInput, realTrack, THREE, EVT, CHARACTERS } from './simlib.mjs';
import { computeStats } from '../../src/kart/tuning.js';

const S = {};
const wantAll = process.argv.length <= 2;
const want = new Set(process.argv.slice(2));
const dt = 1 / 60;
// open plane: no walls in reach, everything is road
const OPEN = { features: false, hw: 2000, wall: 2000 };

// ------------------------------------------------------------------------------------------------
S.stats = () => {
  console.log('char      top(150cc)  t90(s)  accelK  turnPeak  mass  (spec: top 30.5+1.1(speed-1), t90 2.9..1.7, turn 1.7..2.4, mass .8..1.4)');
  for (const c of CHARACTERS) {
    const s = computeStats(c.stats, 1);
    console.log(c.id.padEnd(9), f2(s.top).padStart(9), f2(s.t90).padStart(8), f2(s.accelK, 3).padStart(8), f2(s.turnPeak).padStart(9), f2(s.mass).padStart(6));
  }
};

// ------------------------------------------------------------------------------------------------
S.accel = () => {
  console.log('--- acceleration from standstill, throttle held (flat straight)');
  for (const id of ['blaze', 'bolt', 'rex', 'mochi']) {
    const g = makeGame(OPEN);
    const k = spawn(g, id, 10);
    let t90 = null, t99 = null;
    const top = k.topSpeed;
    run(g, 8, (t) => {
      setInput(k, { throttle: 1 });
      if (t90 === null && k.speed >= 0.9 * top) t90 = t;
      if (t99 === null && k.speed >= 0.99 * top) t99 = t;
    });
    console.log(id.padEnd(8), 'top', f2(top), 'speed@8s', f2(k.speed), 't90', f2(t90), 't99', f2(t99), ' (spec t90', f2(computeStats(k.character.stats, 1).t90), ')');
  }
  // cc and ai mul
  for (const cc of [50, 100, 150, 200]) {
    const g = makeGame(OPEN, cc);
    const k = spawn(g, 'blaze', 10);
    run(g, 8, () => setInput(k, { throttle: 1 }));
    console.log('cc', cc, 'top', f2(k.topSpeed), 'speed@8s', f2(k.speed));
  }
  const g = makeGame(OPEN);
  const k = spawn(g, 'blaze', 10);
  k.aiSpeedMul = 1.08;
  run(g, 8, () => setInput(k, { throttle: 1 }));
  console.log('aiSpeedMul 1.08 -> top', f2(k.topSpeed), 'speed@8s', f2(k.speed));
};

// ------------------------------------------------------------------------------------------------
S.brake = () => {
  console.log('--- braking / reverse / coast');
  const g = makeGame(OPEN);
  const k = spawn(g, 'blaze', 10);
  place(k, 10, 0, 30);
  let tStop = null;
  run(g, 1.5, (t) => {
    setInput(k, { brake: 1 });
    if (tStop === null && k.speed <= 0.01) tStop = t;
  });
  console.log('brake from 30 m/s: stopped at t=', f2(tStop), '(40 m/s^2 => 0.75 s)  speed after 1.5 s:', f2(k.speed));
  run(g, 2.5, () => setInput(k, { brake: 1 }));
  console.log('reverse speed after 2.5 s more (max ~9):', f2(k.speed));
  place(k, 10, 0, 30);
  const s0 = k.speed;
  let t10 = null;
  run(g, 6, (t) => {
    setInput(k, {});
    if (t10 === null && k.speed < 15) t10 = t;
  });
  console.log('coast from 30 m/s: to 15 m/s at', f2(t10 - 0), 's, speed after 6 s', f2(k.speed));
};

// ------------------------------------------------------------------------------------------------
S.steer = () => {
  console.log('--- steering: yaw rate vs speed (full right steer held 1.2 s; rate measured over last 0.5 s)');
  for (const v of [0, 2, 5, 8, 15, 22, 28, 31]) {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10);
    place(k, 10, 0, v);
    let y0 = 0, tm = 0;
    run(g, 1.2, (t, i) => {
      setInput(k, { throttle: v > 0 ? 0.0 : 0, steer: 1 });
      // keep speed constant by resetting it (measure pure turn rate)
      if (i === Math.round(0.7 / dt)) { y0 = k.yaw; tm = t; }
      const fx = Math.sin(k.yaw), fz = Math.cos(k.yaw);
      if (v > 0) { k.velocity.x = fx * v; k.velocity.z = fz * v; }
    });
    const rate = -(k.yaw - y0) / (g.time - tm);
    console.log('v', String(v).padStart(3), 'yaw rate', f2(rate), 'rad/s', ' radius', v > 0.1 ? f2(v / Math.max(rate, 1e-3), 1) : '-');
  }
  // reversing
  const g = makeGame(OPEN);
  const k = spawn(g, 'blaze', 10);
  place(k, 10, 0, -6);
  const y0 = k.yaw;
  run(g, 0.6, () => setInput(k, { brake: 1, steer: 1 }));
  console.log('reversing with steer right: yaw change', f2(k.yaw - y0), '(positive expected: yaw increases when reversing right)');
  // steering ramp response
  const g2 = makeGame(OPEN);
  const k2 = spawn(g2, 'blaze', 10);
  place(k2, 10, 0, 20);
  const rec = [];
  run(g2, 0.5, (t, i) => {
    setInput(k2, { throttle: 1, steer: i >= 6 ? 1 : 0 });
    rec.push(k2.steerAmount);
  });
  console.log('steerAmount ramp after key press (per frame):', rec.slice(5, 20).map((x) => f2(x)).join(' '));
};

// ------------------------------------------------------------------------------------------------
S.drift = () => {
  console.log('--- drift: hop, steer right, hold; sample timeline');
  for (const id of ['blaze', 'mochi', 'rex']) {
    const g = makeGame({ ...OPEN, straight: 600, radius: 200 });
    const k = spawn(g, id, 10);
    place(k, 10, 0, k.topSpeed);
    // rotate the track direction? we just use a wide arc; measure relative
    const lv = {};
    let startedAt = null;
    run(g, 5, (t, i) => {
      setInput(k, { throttle: 1, steer: 1, drift: t > 0.3 });
      if (k.drifting && startedAt === null) startedAt = t;
      if (k.drifting) for (let L = 1; L <= 3; L++) if (k.driftLevel >= L && lv[L] === undefined) lv[L] = t - startedAt;
    });
    console.log(id.padEnd(7), 'drift start', f2(startedAt), 'levels reached (s after start):', JSON.stringify(Object.fromEntries(Object.entries(lv).map(([a, b]) => [a, +f2(b)]))), 'speed', f2(k.speed), 'level', k.driftLevel, 'charge', f2(k.driftCharge));
    clearLog(g);
    setInput(k, { throttle: 1, steer: 1, drift: false });
    step(g);
    console.log('   release ->', events(g, EVT.KART_DRIFT_END).map((e) => 'DRIFT_END level ' + e.p.level).join(','), events(g, EVT.KART_BOOST).map((e) => `BOOST ${e.p.source} ${f2(e.p.duration)}s p${e.p.power}`).join(','));
  }

  console.log('--- drift arc at 25 m/s (hop with steer right, then steering held neutral / inward / outward)');
  for (const [name, st] of [['neutral', 0], ['inward', 1], ['outward', -1]]) {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10);
    place(k, 10, 0, 25);
    let y0 = 0, tm = 0, sp = 0, slide = 0;
    run(g, 2.6, (t, i) => {
      setInput(k, { throttle: 1, steer: t < 0.5 ? 1 : st, drift: t > 0.2 });
      if (i === Math.round(1.4 / dt)) { y0 = k.yaw; tm = t; }
      if (i > Math.round(1.4 / dt)) { sp = k.speed; slide = k.slideAngle; }
    });
    const rate = -(k.yaw - y0) / (g.time - tm);
    console.log(name.padEnd(8), 'drifting', k.drifting, 'dir', k.driftDir, 'yaw rate', f2(rate), 'rad/s', 'radius', f2(sp / rate, 1), 'm  speed', f2(sp), ' slide angle', f2(slide * 57.2958, 1), 'deg', ' at 25 m/s => R', f2(25 / rate, 1));
  }
  console.log('--- 180 deg hairpin drift at ~25 m/s, full inward steer: time, distance, radius, speed kept');
  {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10);
    place(k, 10, 0, 25);
    let acc = 0, sp0 = 0, done = null, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    run(g, 6, (t, i) => {
      setInput(k, { throttle: 1, steer: 1, drift: t > 0.2 });
      if (i === Math.round(0.5 / dt)) sp0 = k.speed;
      if (t > 0.5) {
        acc += -k.yawRate * dt;
        minX = Math.min(minX, k.position.x); maxX = Math.max(maxX, k.position.x); minZ = Math.min(minZ, k.position.z); maxZ = Math.max(maxZ, k.position.z);
      }
      if (done === null && acc >= Math.PI) done = { t: +f2(t), speed: +f2(k.speed), level: k.driftLevel, width: +f2(maxX - minX, 1), depth: +f2(maxZ - minZ, 1) };
    });
    console.log('180 deg reached:', JSON.stringify(done), ' speed at drift start', f2(sp0), '(bounding box width ~ 2R)');
  }
  console.log('--- hop details (first 0.6 s): t, y, vy, grounded, drifting, slide deg, yaw');
  {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10);
    place(k, 10, 0, 28);
    const rows = [];
    run(g, 0.7, (t, i) => {
      setInput(k, { throttle: 1, steer: 1, drift: t >= 0.1 });
      if (i % 4 === 0) rows.push(`t=${f2(t)} y=${f2(k.position.y, 3)} vy=${f2(k.velocity.y)} gnd=${k.grounded ? 1 : 0} drift=${k.drifting ? 1 : 0} slide=${f2(k.slideAngle * 57.3, 1)} yawRate=${f2(k.yawRate)} spd=${f2(k.speed)}`);
    });
    console.log(rows.join('\n'));
    console.log('events:', g.log.map((e) => e.name.split(':')[1]).join(' '));
  }
};

// ------------------------------------------------------------------------------------------------
S.offroad = () => {
  console.log('--- offroad cap (~55%): drive straight from road onto the shoulder (lateral 10..14 m is offroad on the test track)');
  const g = makeGame({ ...OPEN, hw: 9, wall: 30 });
  const k = spawn(g, 'blaze', 10, 4);
  place(k, 10, 4, 0);
  const rows = [];
  let tCap = null;
  run(g, 6, (t, i) => {
    // steer gently right so we leave the asphalt, then straighten
    setInput(k, { throttle: 1, steer: k.lateral < 12 ? 0.25 : 0 });
    if (i % 30 === 0) rows.push(`t=${f2(t, 1)} lat=${f2(k.lateral, 1)} ${k.surface} spd=${f2(k.speed)}`);
    if (tCap === null && k.surface === 'offroad' && k.speed <= 0.56 * k.topSpeed && k.speed > 0) tCap = t;
  });
  console.log(rows.join('\n'));
  console.log('top', f2(k.topSpeed), 'cap 55% =', f2(0.55 * k.topSpeed), 'final speed', f2(k.speed), 'reached cap at', f2(tCap));
  // star ignores offroad; boost ignores offroad
  for (const mode of ['star', 'boost']) {
    const g2 = makeGame({ ...OPEN, hw: 9, wall: 30 });
    const k2 = spawn(g2, 'blaze', 10, 12);
    place(k2, 10, 12, 0);
    if (mode === 'star') k2.startStar(20); else k2.applyBoost(20, 1, 'nitro');
    run(g2, 5, () => setInput(k2, { throttle: 1 }));
    console.log(mode, 'offroad final speed', f2(k2.speed), 'top', f2(k2.topSpeed), 'surface', k2.surface);
  }
};

// ------------------------------------------------------------------------------------------------
S.boost = () => {
  console.log('--- boost: power ramp, top speed, and the bleed-off after it ends (nitro 1.0 s, power 1)');
  const g = makeGame(OPEN);
  const k = spawn(g, 'blaze', 10);
  place(k, 10, 0, k.topSpeed);
  const rows = [];
  run(g, 4, (t, i) => {
    setInput(k, { throttle: 1 });
    if (i === 30) k.applyBoost(1.0, 1, 'nitro');
    if (i % 12 === 0) rows.push(`t=${f2(t)} spd=${f2(k.speed)} boostT=${f2(k.boostTime)} boostP=${f2(k.boostPower)}`);
  });
  console.log(rows.join('\n'));
  console.log('boost events', events(g, EVT.KART_BOOST).length, ' expected top x1.35 =', f2(k.topSpeed * 1.35));
  // extension semantics
  clearLog(g);
  const k2 = spawn(g, 'blaze', 300);
  k2.applyBoost(0.6, 0.85, 'miniturbo');
  k2.applyBoost(0.4, 1.2, 'nitro');
  console.log('extend: boostTime', f2(k2.boostTime), '(max 0.6) power target', f2(k2._boostPowerT), 'source', k2.boostSource);
};

// ------------------------------------------------------------------------------------------------
S.pad = () => {
  console.log('--- boost pad: event only on entry, boost lasts ~1 s after');
  const g = makeGame({});
  const k = spawn(g, 'blaze', 100, 0);
  place(k, 100, 0, 25);
  let n = 0;
  run(g, 2.5, (t) => setInput(k, { throttle: 1 }));
  console.log('boost events:', events(g, EVT.KART_BOOST).map((e) => `${e.p.source}@${f2(e.t)}`).join(' '), ' boostTime now', f2(k.boostTime), 'speed', f2(k.speed));
};

// ------------------------------------------------------------------------------------------------
S.ramp = () => {
  console.log('--- ramp at s=200 (14 m, 1.6 m rise, launch 11), gap 214..242, landing after; full throttle');
  for (const doTrick of [false, true]) {
    const g = makeGame({});
    const k = spawn(g, 'blaze', 150, 0);
    place(k, 150, 0, 30);
    const rows = [];
    let takeoff = null, land = null, apex = 0;
    run(g, 4, (t, i) => {
      const trickNow = doTrick && !k.grounded && k.airTime > 0.1 && k.airTime < 0.15;
      setInput(k, { throttle: 1, drift: trickNow });
      if (takeoff === null && !k.grounded) takeoff = { t: +f2(t), s: +f2(k.trackS, 1), vy: +f2(k.velocity.y), spd: +f2(k.speed) };
      if (!k.grounded) apex = Math.max(apex, k.position.y);
      if (takeoff && land === null && k.grounded && t > takeoff.t + 0.1) land = { t: +f2(t), s: +f2(k.trackS, 1), airTime: +f2(t - takeoff.t) };
    });
    console.log('trick attempt', doTrick, 'takeoff', JSON.stringify(takeoff), 'apex y', f2(apex), 'land', JSON.stringify(land));
    console.log('   events:', g.log.map((e) => e.name.split(':')[1] + (e.name.endsWith('land') ? `(${f2(e.p.impact)})` : '') + (e.name.endsWith('boost') ? `(${e.p.source})` : '')).join(' '));
  }
  console.log('--- slow ramp (12 m/s): launch scaled down and probably falls in the gap');
  {
    const g = makeGame({});
    const k = spawn(g, 'blaze', 150, 0);
    place(k, 190, 0, 12);
    run(g, 6, () => setInput(k, { throttle: 0 }));
    console.log('events:', g.log.map((e) => e.name.split(':')[1] + '@' + f2(e.t, 1)).join(' '), 'respawnTime', f2(k.respawnTime), 's', f2(k.trackS, 1), 'y', f2(k.position.y));
  }
};

// ------------------------------------------------------------------------------------------------
S.ice = () => {
  console.log('--- ice (s 300..370): steer right at 28 m/s, then straighten; velocity direction vs heading');
  const g = makeGame({});
  const k = spawn(g, 'blaze', 290, 0);
  place(k, 290, 0, 28);
  const rows = [];
  run(g, 3.0, (t, i) => {
    setInput(k, { throttle: 1, steer: t > 0.45 && t < 1.0 ? 1 : 0 });
    if (i % 12 === 0) {
      const vh = Math.atan2(k.velocity.x, k.velocity.z);
      const slip = ((k.yaw - vh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      rows.push(`t=${f2(t)} s=${f2(k.trackS, 0)} ${k.surface} lat=${f2(k.lateral, 1)} slip=${f2(slip * 57.3, 1)}deg spd=${f2(k.speed)}`);
    }
  });
  console.log(rows.join('\n'));
  console.log('--- same on road for comparison');
  const g2 = makeGame({});
  const k2 = spawn(g2, 'blaze', 40, 0);
  place(k2, 40, 0, 28);
  const rows2 = [];
  run(g2, 3.0, (t, i) => {
    setInput(k2, { throttle: 1, steer: t > 0.45 && t < 1.0 ? 1 : 0 });
    if (i % 12 === 0) {
      const vh = Math.atan2(k2.velocity.x, k2.velocity.z);
      const slip = ((k2.yaw - vh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      rows2.push(`t=${f2(t)} s=${f2(k2.trackS, 0)} ${k2.surface} lat=${f2(k2.lateral, 1)} slip=${f2(slip * 57.3, 1)}deg spd=${f2(k2.speed)}`);
    }
  });
  console.log(rows2.join('\n'));
};

// ------------------------------------------------------------------------------------------------
S.hill = () => {
  console.log('--- hill (s 400..530, 4 m amp): speed and grounded behaviour at full throttle from 30 m/s; then sharp crest 820..860');
  const g = makeGame({});
  const k = spawn(g, 'blaze', 370, 0);
  place(k, 370, 0, 30);
  let minS = 99, maxS = 0, air = 0;
  const rows = [];
  run(g, 5, (t, i) => {
    setInput(k, { throttle: 1 });
    if (k.trackS > 400 && k.trackS < 530) { minS = Math.min(minS, k.speed); maxS = Math.max(maxS, k.speed); }
    if (!k.grounded) air += dt;
    if (i % 15 === 0) rows.push(`t=${f2(t)} s=${f2(k.trackS, 0)} y=${f2(k.position.y)} spd=${f2(k.speed)} gnd=${k.grounded ? 1 : 0}`);
  });
  console.log(rows.join('\n'));
  console.log('speed range on hill', f2(minS), '..', f2(maxS), ' airtime on hill', f2(air), 's');
  const g2 = makeGame({});
  const k2 = spawn(g2, 'blaze', 790, 0);
  place(k2, 790, 0, 32);
  const rows2 = [];
  let took = null;
  run(g2, 3, (t, i) => {
    setInput(k2, { throttle: 1 });
    if (took === null && !k2.grounded) took = { t: +f2(t), s: +f2(k2.trackS, 0), vy: +f2(k2.velocity.y) };
    if (i % 8 === 0) rows2.push(`t=${f2(t)} s=${f2(k2.trackS, 0)} y=${f2(k2.position.y)} vy=${f2(k2.velocity.y)} gnd=${k2.grounded ? 1 : 0}`);
  });
  console.log('sharp crest take-off:', JSON.stringify(took));
  console.log(rows2.join('\n'));
  console.log('events:', g2.log.map((e) => e.name.split(':')[1] + (e.name.endsWith('land') ? `(${f2(e.p.impact)})` : '')).join(' '));
};

// ------------------------------------------------------------------------------------------------
S.wall = () => {
  console.log('--- walls: hit the right wall (wall at lateral 9.5, radius 1.1) at various angles from 30 m/s');
  for (const angDeg of [3, 8, 15, 30, 60, 90]) {
    const g = makeGame({ features: false, wall: 0.5 });
    const k = spawn(g, 'blaze', 30, 0);
    // start 10 m from the wall, angled to the right
    place(k, 30, 5, 30, -angDeg * Math.PI / 180);
    const rows = [];
    let minSpeed = 99;
    run(g, 1.5, (t) => {
      setInput(k, { throttle: 1 });
    });
    const ev = events(g, EVT.KART_WALL);
    console.log(`angle ${String(angDeg).padStart(2)} deg: wall events ${ev.length} impacts [${ev.map((e) => f2(e.p.impact, 1)).join(', ')}] speed after 1.5 s ${f2(k.speed)} lateral ${f2(k.lateral, 2)} yaw off track ${f2((k.yaw - Math.atan2(k.lastSample.tangent.x, k.lastSample.tangent.z)) * 57.3, 1)} deg`);
  }
  console.log('--- pinned against the wall steering into it for 3 s (speed drain)');
  {
    const g = makeGame({ features: false, wall: 0.5 });
    const k = spawn(g, 'blaze', 30, 7);
    place(k, 30, 7, 30);
    const rows = [];
    run(g, 3, (t, i) => {
      setInput(k, { throttle: 1, steer: 1 });
      if (i % 20 === 0) rows.push(`t=${f2(t)} lat=${f2(k.lateral, 2)} spd=${f2(k.speed)} yawOff=${f2((k.yaw - Math.atan2(k.lastSample.tangent.x, k.lastSample.tangent.z)) * 57.3, 1)}`);
    });
    console.log(rows.join('\n'));
    console.log('wall events', events(g, EVT.KART_WALL).length);
  }
  console.log('--- collider (circle at x=-6.5,z=60 r=1.6): drive straight into it');
  {
    const g = makeGame({});
    const k = spawn(g, 'blaze', 30, 0);
    place(k, 30, 6.5, 20);
    run(g, 2, () => setInput(k, { throttle: 1 }));
    console.log('events', g.log.map((e) => e.name.split(':')[1] + (e.name.endsWith('wall') ? `(${f2(e.p.impact, 1)})` : '')).join(' '), 'pos', f2(k.position.x), f2(k.position.z), 'spd', f2(k.speed));
  }
};

// ------------------------------------------------------------------------------------------------
S.hits = () => {
  console.log('--- hit reactions (from 30 m/s): speed right after, duration, invuln, control lock');
  for (const type of ['spin', 'tumble', 'explode', 'squish']) {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10);
    place(k, 10, 0, 30);
    run(g, 0.2, () => setInput(k, { throttle: 1 }));
    const y0 = k.yaw;
    const ok = k.applyHit(type, null);
    const ok2 = k.applyHit(type, null);
    let endT = null;
    const rows = [];
    let yawMax = 0;
    run(g, 3, (t, i) => {
      setInput(k, { throttle: 1, steer: 1 });
      if (k.hit) endT = t;
      if (k.hit) yawMax = Math.max(yawMax, Math.abs(k.yaw - y0));
      if (i % 12 === 0) rows.push(`t=${f2(t - 0.2)} spd=${f2(k.speed)} y=${f2(k.position.y)} gnd=${k.grounded ? 1 : 0} hit=${k.hit ? f2(k.hit.t) : '-'}`);
    });
    console.log(type.padEnd(8), 'applied', ok, 'second applyHit (immune)', ok2, 'hit lasted until', f2(endT - 0.2), 'yaw drift', f2(yawMax), 'invuln left @3s', f2(k.invulnTime));
    console.log('    ' + rows.slice(0, 6).join(' | '));
  }
};

// ------------------------------------------------------------------------------------------------
S.starshrink = () => {
  console.log('--- star / shrink');
  const g = makeGame(OPEN);
  const k = spawn(g, 'blaze', 10);
  k.startStar(1.0);
  k.startStar(1.0);
  console.log('immune while star:', k.isImmune, 'applyHit ->', k.applyHit('spin'));
  run(g, 2.5, () => setInput(k, { throttle: 1 }));
  console.log('star events', events(g, EVT.KART_STAR).map((e) => e.p.active).join(','), 'top after', f2(k.topSpeed), 'speed', f2(k.speed));
  clearLog(g);
  k.startShrink(1.0);
  run(g, 0.6, () => setInput(k, { throttle: 1 }));
  console.log('shrunk radius', f2(k.radius), 'top', f2(k.topSpeed), '(x0.8 =', f2(k._st.top * 0.8), ') mass', f2(k.mass));
  run(g, 2.5, () => setInput(k, { throttle: 1 }));
  console.log('shrink events', events(g, EVT.KART_SHRINK).map((e) => e.p.active).join(','), 'radius after', f2(k.radius), 'top', f2(k.topSpeed));
  k.startStar(3);
  k.startShrink(3);
  console.log('shrink ignored during star: shrinkTime', k.shrinkTime);
};

// ------------------------------------------------------------------------------------------------
S.respawn = () => {
  console.log('--- fall into the jump gap at low speed, then respawn timing');
  const g = makeGame({});
  const k = spawn(g, 'blaze', 150, 0);
  place(k, 192, 0, 14);
  const rows = [];
  let fallT = null;
  run(g, 5.5, (t, i) => {
    setInput(k, { throttle: 0.3 });
    if (fallT === null && k.respawnTime > 0) fallT = t;
    if (i % 12 === 0) rows.push(`t=${f2(t)} s=${f2(k.trackS, 0)} y=${f2(k.position.y)} rt=${f2(k.respawnTime)} gnd=${k.grounded ? 1 : 0} spd=${f2(k.speed)} imm=${k.isImmune ? 1 : 0}`);
  });
  console.log(rows.join('\n'));
  console.log('fall began', f2(fallT), 'events:', g.log.map((e) => e.name.split(':')[1] + '@' + f2(e.t - 0)).join(' '));
  console.log('final: s', f2(k.trackS, 1), 'y', f2(k.position.y, 2), 'invuln', f2(k.invulnTime), 'grounded', k.grounded);
  console.log('--- manual respawn() while driving on the road');
  const g2 = makeGame({});
  const k2 = spawn(g2, 'blaze', 40, 0);
  place(k2, 40, 0, 28);
  run(g2, 1, () => setInput(k2, { throttle: 1 }));
  const s0 = k2.trackS;
  k2.respawn();
  const rows2 = [];
  run(g2, 2.6, (t, i) => {
    setInput(k2, { throttle: 1 });
    if (i % 12 === 0) rows2.push(`t=${f2(t - 1)} s=${f2(k2.trackS, 0)} y=${f2(k2.position.y)} rt=${f2(k2.respawnTime)} spd=${f2(k2.speed)}`);
  });
  console.log('s at trigger', f2(s0, 1));
  console.log(rows2.join('\n'));
  console.log('events:', g2.log.map((e) => e.name.split(':')[1]).join(' '), '-> final s', f2(k2.trackS, 1), 'y', f2(k2.position.y, 2));
  console.log('--- open edge (s 900..960): drive off the side into void');
  const g3 = makeGame({});
  const k3 = spawn(g3, 'blaze', 920, 0);
  place(k3, 905, 0, 25);
  let fell = null;
  run(g3, 4, (t) => {
    setInput(k3, { throttle: 1, steer: 0.5 });
    if (fell === null && k3.respawnTime > 0) fell = t;
  });
  console.log('fell at', f2(fell), 'events', g3.log.map((e) => e.name.split(':')[1]).join(' '));
};

// ------------------------------------------------------------------------------------------------
S.rocket = () => {
  console.log('--- rocket start: throttle first pressed at X seconds before GO (window 1.1..0.3, stall if > 1.6)');
  for (const before of [2.5, 1.8, 1.5, 1.1, 0.9, 0.7, 0.5, 0.3, 0.1, null]) {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10, 0, { locked: true });
    g.race.phase = 'countdown';
    g.race.phaseTime = 0;
    let went = false;
    for (let i = 0; i < 400 && !went; i++) {
      const tGo = 3 - g.race.phaseTime;
      setInput(k, { throttle: before !== null && tGo <= before ? 1 : 0 });
      // simulate the RaceManager ordering: race.update (time), then GO
      if (g.race.phaseTime >= 3) {
        clearLog(g);
        k.controlLocked = false;
        k.onRaceStart();
        went = true;
        break;
      }
      step(g);
    }
    let stall = false;
    run(g, 2, () => setInput(k, { throttle: 1 }));
    const b = events(g, EVT.KART_BOOST)[0];
    console.log(`press ${before === null ? 'never' : before.toFixed(1)}s before GO -> boost ${b ? `${b.p.source} ${f2(b.p.duration)}s` : 'none'} stall=${events(g, EVT.KART_STALL).length} speed@2s ${f2(k.speed)}`);
  }
  // release before GO cancels
  {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10, 0, { locked: true });
    g.race.phase = 'countdown';
    for (let i = 0; i < 200 && g.race.phaseTime < 3; i++) {
      const tGo = 3 - g.race.phaseTime;
      setInput(k, { throttle: tGo <= 0.8 && tGo > 0.5 ? 1 : 0 });
      step(g);
    }
    k.controlLocked = false;
    k.onRaceStart();
    console.log('pressed 0.8..0.5 then released -> boostTime', f2(k.boostTime));
  }
  // throttleAmount animates while locked
  {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10, 0, { locked: true });
    g.race.phase = 'countdown';
    run(g, 0.5, () => setInput(k, { throttle: 1 }));
    console.log('locked: throttleAmount after 0.5 s', f2(k.throttleAmount), 'speed', f2(k.speed));
  }
};

// ------------------------------------------------------------------------------------------------
S.draft = () => {
  console.log('--- slipstream: follow 6 m behind a kart at 28 m/s');
  const g = makeGame(OPEN);
  const lead = spawn(g, 'rex', 40);
  const k = spawn(g, 'blaze', 30);
  place(lead, 40, 0, 28);
  place(k, 32, 0, 28);
  let firstBoost = null;
  run(g, 4, (t) => {
    setInput(lead, { throttle: 1 });
    lead.velocity.x = Math.sin(lead.yaw) * 28; lead.velocity.z = Math.cos(lead.yaw) * 28; lead.speed = 28;
    setInput(k, { throttle: 1 });
    k.velocity.x = Math.sin(k.yaw) * 28; k.velocity.z = Math.cos(k.yaw) * 28; k.speed = 28;
    if (firstBoost === null && k.boostTime > 0) firstBoost = t;
  });
  console.log('drafting boost at', f2(firstBoost), ' events', events(g, EVT.KART_BOOST).map((e) => `${e.p.source}@${f2(e.t)}`).join(' '));
};

// ------------------------------------------------------------------------------------------------
S.bump = () => {
  console.log('--- kart-kart bumps');
  const scenarios = [
    // label, charA, speedA, latA, charB, speedB, latB, gapAhead(m)
    ['rear-end: blaze 30 m/s into coasting rex 20 m/s', 'blaze', 30, 0, 'rex', 20, 0, 6],
    ['rear-end: rex 30 m/s into coasting mochi 20 m/s', 'rex', 30, 0, 'mochi', 20, 0, 6],
    ['side-swipe: mochi vs rex 1.2 m apart laterally, same speed, converging', 'mochi', 25, -1.6, 'rex', 25, 0.6, 0],
    ['head-on: blaze vs blaze', 'blaze', 25, 0, 'blaze', -25, 0, 30],
  ];
  for (const [label, a, va, la, b, vb, lb, gap] of scenarios) {
    const g = makeGame(OPEN);
    const ka = spawn(g, a, 10, 0), kb = spawn(g, b, 40, 0);
    place(ka, 10, la, va);
    place(kb, 10 + gap, lb, Math.abs(vb), vb < 0 ? Math.PI : 0);
    if (vb < 0) { kb.velocity.multiplyScalar(1); kb.speed = Math.abs(vb); }
    const sa0 = ka.speed;
    run(g, 1.5, () => {
      setInput(ka, { throttle: 1 });
      setInput(kb, { throttle: vb < 0 ? 1 : 0 });
      if (la !== lb && gap === 0) { ka.steerAmount = 0; }
    });
    const ev = events(g, EVT.KART_BUMP);
    console.log(label, '->', 'bump events', ev.length, `[${ev.map((e) => f2(e.p.impulse, 1)).join(', ')}]`, `A speed ${f2(ka.speed)} B speed ${f2(kb.speed)}`, `lat ${f2(ka.lateral)} / ${f2(kb.lateral)}`, 'dist', f2(ka.position.distanceTo(kb.position)));
  }
  {
    const g = makeGame(OPEN);
    const ka = spawn(g, 'blaze', 10), kb = spawn(g, 'mochi', 40);
    place(ka, 10, 0, 28);
    place(kb, 13, 0, 20);
    ka.startStar(5);
    run(g, 1, () => { setInput(ka, { throttle: 1 }); setInput(kb, { throttle: 1 }); });
    console.log('star vs normal: victim hit', kb.hit?.type ?? 'none', 'star kart hit', ka.hit?.type ?? 'none', 'star speed', f2(ka.speed));
  }
  {
    const g = makeGame(OPEN);
    const ka = spawn(g, 'blaze', 10), kb = spawn(g, 'mochi', 40);
    place(ka, 10, 0, 28);
    place(kb, 13, 0, 20);
    kb.startShrink(5);
    run(g, 1, () => { setInput(ka, { throttle: 1 }); setInput(kb, { throttle: 1 }); });
    console.log('normal vs shrunk: shrunk kart hit', kb.hit?.type ?? 'none', 'normal kart hit', ka.hit?.type ?? 'none');
  }
  {
    const g = makeGame(OPEN);
    const ks = [];
    for (let i = 0; i < 8; i++) { const k = spawn(g, CHARACTERS[i].id, 10); place(k, 10 + (i >> 1) * 1.5, (i % 2 ? 1 : -1) * 0.8, 20); ks.push(k); }
    const t0 = performance.now();
    run(g, 2, () => ks.forEach((k) => setInput(k, { throttle: 1 })));
    const el = performance.now() - t0;
    let minD = 99;
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) minD = Math.min(minD, ks[i].position.distanceTo(ks[j].position) - ks[i].radius - ks[j].radius);
    console.log('8-kart pile at the start: bumps', events(g, EVT.KART_BUMP).length, 'min gap after 2 s', f2(minD), ' cpu ms for 120 frames x 8 karts:', f2(el, 1));
  }
};

// ------------------------------------------------------------------------------------------------
S.lap = async () => {
  const { DriverBot } = await import('./bot.js');
  console.log('--- bot laps on the test stadium (no features): with and without drifting');
  for (const [label, drift] of [['no drift', false], ['drift   ', true]]) {
    for (const radius of [60, 35]) {
      const g = makeGame({ features: false, radius, straight: 500 });
      const k = spawn(g, 'blaze', g.track.length - 8, 0);
      const bot = new DriverBot(g, k, { drift });
      k.controller = bot;
      k.controlLocked = false;
      let lapT = null, lastS = k.trackS, crossed = 0, t0 = null;
      const times = [];
      for (let i = 0; i < 60 * 150 && times.length < 3; i++) {
        bot.update(dt);
        step(g);
        if (g.track.deltaS(lastS, k.trackS) < 0 && k.trackS < 50 && lastS > g.track.length - 50) { /* backwards */ }
        if (lastS > g.track.length - 30 && k.trackS < 30) { if (t0 !== null) times.push(g.time - t0); t0 = g.time; }
        lastS = k.trackS;
      }
      const st = bot.stats;
      console.log(`${label} R=${radius}  lap times: ${times.map((x) => f2(x, 1)).join(', ')} s  walls ${st.walls} (max impact ${f2(st.wallImpactMax, 1)}), drifts ${st.drifts}, levels [${st.levels.join(',')}], offroad ${f2(st.offroadTime, 1)} s, maxSpeed ${f2(st.maxSpeed, 1)}`);
    }
  }
};

// ------------------------------------------------------------------------------------------------
/** node dev/driving/sim.mjs reallap   -> bot laps on the World agent's real tracks (headless, no meshes). */
S.reallap = async () => {
  const { DriverBot } = await import('./bot.js');
  const ids = (process.env.TRACKS ?? 'meadow,canyon,glacier,neon').split(',');
  console.log('--- bot laps on the real tracks (2 laps each): no drift vs drift vs drift with KEYBOARD-like digital steering');
  for (const id of ids) {
    for (const [label, drift, digital] of [['no drift', false, false], ['drift   ', true, false], ['digital ', true, true], ['dig+nodr', false, true]]) {
      let track;
      try { track = await realTrack(id); } catch (e) { console.log(id, 'track failed:', e.message); continue; }
      const g = makeGame(track);
      const slot = track.startGrid[track.startGrid.length - 1];
      const k = spawn(g, 'blaze', 0, 0);
      k.resetForRace(slot);
      k.controlLocked = false;
      const bot = new DriverBot(g, k, { drift, digital });
      k.controller = bot;
      const L = track.length;
      let progress = 0, lastS = k.trackS, laps = 0, t0 = 0;
      const times = [];
      for (let i = 0; i < 60 * 200 && times.length < 2; i++) {
        bot.update(dt);
        step(g);
        progress += track.deltaS(lastS, k.trackS);
        lastS = k.trackS;
        const lapsDone = Math.floor(progress / L);
        if (lapsDone > laps) { laps = lapsDone; if (laps >= 1) { times.push(g.time - t0); t0 = g.time; } }
        if (i === 0) t0 = 0;
      }
      const st = bot.stats;
      console.log(`${id.padEnd(8)} ${label} laps: ${times.map((x) => f2(x, 1)).join(', ')} s (L=${f2(L, 0)})  walls ${st.walls} (max ${f2(st.wallImpactMax, 1)}) drifts ${st.drifts} levels [${st.levels.join(',')}] offroad ${f2(st.offroadTime, 1)}s air ${f2(st.airTime, 1)}s falls ${st.respawns} maxSpd ${f2(st.maxSpeed, 1)}`);
    }
  }
};

// ------------------------------------------------------------------------------------------------
S.driftrules = () => {
  const fresh = () => {
    const g = makeGame(OPEN);
    const k = spawn(g, 'blaze', 10);
    place(k, 10, 0, 28);
    return [g, k];
  };
  const driftEnds = (g) => events(g, EVT.KART_DRIFT_END).map((e) => 'end(level ' + e.p.level + ')').join(',') || 'none';
  const boosts = (g) => events(g, EVT.KART_BOOST).map((e) => e.p.source).join(',') || 'none';
  // 1. speed < 8 cancels without a boost
  {
    const [g, k] = fresh();
    run(g, 1.2, (t) => setInput(k, { throttle: 1, steer: 1, drift: t > 0.2 }));
    clearLog(g);
    run(g, 1.5, () => setInput(k, { brake: 1, steer: 1, drift: true }));
    console.log('brake below 8 m/s while drifting -> drifting', k.drifting, 'speed', f2(k.speed), driftEnds(g), 'boosts', boosts(g));
  }
  // 2. hit cancels
  {
    const [g, k] = fresh();
    run(g, 1.5, (t) => setInput(k, { throttle: 1, steer: 1, drift: t > 0.2 }));
    clearLog(g);
    k.applyHit('spin');
    step(g);
    console.log('hit while drifting -> drifting', k.drifting, driftEnds(g), 'boosts', boosts(g));
  }
  // 3. long airtime cancels; landing while still holding drift+steer starts a NEW drift
  {
    const [g, k] = fresh();
    run(g, 1.5, (t) => setInput(k, { throttle: 1, steer: 1, drift: t > 0.2 }));
    clearLog(g);
    k.launch(14);
    let cancelledAt = null;
    run(g, 2.5, (t, i) => {
      setInput(k, { throttle: 1, steer: 1, drift: true });
      if (cancelledAt === null && !k.drifting) cancelledAt = g.time;
    });
    console.log('launch(14) while drifting -> cancelled after', f2(events(g, EVT.KART_DRIFT_END)[0]?.t - 1.5 - 0.2 * 0, 2), 's of air; events:', g.log.map((e) => e.name.split(':')[1]).join(' '), '-> drifting again after landing:', k.drifting);
  }
  // 4. landing rule from a plain airborne moment (no hop): hold drift + steer, get launched, land -> drift starts
  {
    const [g, k] = fresh();
    setInput(k, { throttle: 1, steer: 1, drift: false });
    run(g, 0.3, () => setInput(k, { throttle: 1, steer: 1, drift: false }));
    k.launch(8);
    // hold drift only AFTER leaving the ground so there is no hop
    run(g, 1.4, () => setInput(k, { throttle: 1, steer: 1, drift: true }));
    console.log('airborne (launch 8), drift+steer held, lands ->', g.log.map((e) => e.name.split(':')[1]).join(' '), '| drifting', k.drifting, 'dir', k.driftDir);
  }
  // 5. hard wall impact cancels
  {
    const g = makeGame({ features: false, wall: 0.5 });
    const k = spawn(g, 'blaze', 30, 0);
    place(k, 30, 4, 30, -0.9); // heading into the right wall (hard angle)
    // start drifting to the LEFT so the wall hit happens mid-drift
    run(g, 0.6, (t) => setInput(k, { throttle: 1, steer: -1, drift: t > 0.05 }));
    console.log('drifting before wall:', k.drifting);
    place(k, 30, 7.5, 30, -0.9);
    k.drifting = true; k.driftDir = -1; k.driftLevel = 2; k.driftCharge = 2;
    clearLog(g);
    run(g, 0.5, () => setInput(k, { throttle: 1, steer: -1, drift: true }));
    console.log('hard wall hit while drifting ->', g.log.map((e) => e.name.split(':')[1] + (e.name.endsWith('wall') ? '(' + f2(e.p.impact, 1) + ')' : '')).join(' '), '| drifting', k.drifting, 'boosts', boosts(g));
  }
  // 6. crest take-off opens the trick window
  {
    const g = makeGame({});
    const k = spawn(g, 'blaze', 790);
    place(k, 790, 0, 32);
    let win = null;
    run(g, 3, () => {
      setInput(k, { throttle: 1 });
      if (win === null && !k.grounded) win = k._trickWindow;
    });
    console.log('sharp crest take-off -> trick window', f2(win, 2), '(expected 0.35)');
  }
  // 7. late steer after the hop still starts the drift (grace)
  {
    const [g, k] = fresh();
    run(g, 1.2, (t) => setInput(k, { throttle: 1, steer: t > 0.55 ? 1 : 0, drift: t > 0.2 }));
    console.log('hop with NO steer, steer added 0.1 s after landing (grace 0.22 s) -> drifting', k.drifting, 'dir', k.driftDir);
  }
  // 8. hop only (no steer, released quickly): no drift, no boost
  {
    const [g, k] = fresh();
    run(g, 1.0, (t) => setInput(k, { throttle: 1, steer: 0, drift: t > 0.2 && t < 0.4 }));
    console.log('hop tap without steering ->', g.log.map((e) => e.name.split(':')[1]).join(' '), 'drifting', k.drifting);
  }
};

// ------------------------------------------------------------------------------------------------
const names = Object.keys(S);
for (const n of names) {
  if (wantAll || want.has(n)) {
    console.log(`\n=== ${n}`);
    await S[n]();
  }
}
