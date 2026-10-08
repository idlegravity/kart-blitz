/**
 * In-page AI scenario tests.
 *   node scripts/snap.mjs "/?quick=1&nocountdown=1&skipintro=1&mute=1&autodrive=1&ai=3&track=meadow" --wait=3000 --noshot \
 *     --eval="import('/dev/gameplay/aitests.js').then(m => m.runAll())"
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = () => window.__game;
const T = {};

function place(kart, s, lateral, yawOffset = 0, speed = 0) {
  const g = G();
  const f = g.track.getFrameAt(s);
  kart.position.copy(f.position).addScaledVector(f.right, lateral);
  kart.yaw = Math.atan2(f.tangent.x, f.tangent.z) + yawOffset;
  kart.speed = speed;
  kart.velocity.set(Math.sin(kart.yaw) * speed, 0, Math.cos(kart.yaw) * speed);
  kart.hit = null;
  kart.invulnTime = 0;
  kart.trackIndex = -1;
  kart.forward.set(Math.sin(kart.yaw), 0, Math.cos(kart.yaw));
  kart.right.set(-Math.cos(kart.yaw), 0, Math.sin(kart.yaw));
}

/** Make the first `n` karts the only ones that matter: park the others far behind on the centre line. */
function isolate(n = 1) {
  const g = G();
  g.karts.forEach((k, i) => {
    if (i >= n) {
      k.position.y -= 0;
      place(k, (g.track.length * (0.3 + 0.08 * i)) % g.track.length, 0, 0, 0);
      k.controlLocked = true;
    }
  });
}

T.wall = async () => {
  const g = G();
  isolate(1);
  const k = g.karts[0];
  const s0 = 300;
  const f = g.track.getFrameAt(s0);
  const wall = f.wallRight ?? f.halfWidth + 3;
  place(k, s0, wall - 1.4, -1.2, 0); // nose toward the right wall, stopped
  await sleep(300);
  const t0 = performance.now();
  let recovered = -1;
  for (let i = 0; i < 80; i++) {
    await sleep(100);
    if (k.speed > 18 && Math.abs(k.lateral) < f.halfWidth) {
      recovered = (performance.now() - t0) / 1000;
      break;
    }
  }
  return { ok: recovered > 0 && recovered < 7, info: { recovered, speed: k.speed.toFixed(1), lat: k.lateral.toFixed(1), dbg: k.controller.rec } };
};

T.wrongWay = async () => {
  const g = G();
  isolate(1);
  const k = g.karts[0];
  place(k, 420, 0, Math.PI * 0.95, 0);
  await sleep(300);
  const t0 = performance.now();
  let recovered = -1;
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const trackYaw = g.track.getFrameAt(k.trackS).tangent;
    const dot = k.forward.x * trackYaw.x + k.forward.z * trackYaw.z;
    if (dot > 0.9 && k.speed > 15) {
      recovered = (performance.now() - t0) / 1000;
      break;
    }
  }
  return { ok: recovered > 0 && recovered < 9, info: { recovered, speed: k.speed.toFixed(1), lat: k.lateral.toFixed(1), rec: k.controller.rec } };
};

T.sideways = async () => {
  const g = G();
  isolate(1);
  const k = g.karts[0];
  place(k, 500, 3, Math.PI * 0.5, 0);
  await sleep(300);
  const t0 = performance.now();
  let recovered = -1;
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const tan = g.track.getFrameAt(k.trackS).tangent;
    const dot = k.forward.x * tan.x + k.forward.z * tan.z;
    if (dot > 0.9 && k.speed > 15) {
      recovered = (performance.now() - t0) / 1000;
      break;
    }
  }
  return { ok: recovered > 0 && recovered < 6, info: { recovered, speed: k.speed.toFixed(1) } };
};

T.avoidBanana = async () => {
  const g = G();
  isolate(2);
  const k = g.karts[0];
  const line = g.track._aiLine;
  const s0 = 200;
  const L0 = line.at(s0, {});
  const f0 = g.track.getFrameAt(s0);
  // start ON the racing line, already at speed, heading along it
  k.position.set(L0.cx + L0.rx * L0.lat, f0.position.y, L0.cz + L0.rz * L0.lat);
  k.yaw = line.yawAt(s0);
  k.speed = 30;
  k.velocity.set(Math.sin(k.yaw) * 30, 0, Math.cos(k.yaw) * 30);
  k.trackIndex = -1;
  await sleep(200);
  const sB = (k.trackS + 45) % g.track.length;
  const L = line.at(sB, {});
  const f = g.track.getFrameAt(sB);
  const it = g.items;
  const owner = g.karts[1];
  const bananas = [];
  for (const dl of [0, 0.3]) {
    const e = it._alloc('banana', 'hazard');
    e.position.set(L.cx + L.rx * (L.lat + dl), f.position.y, L.cz + L.rz * (L.lat + dl));
    it._snapToGround(e, 0.02);
    e.radius = 0.8;
    e.owner = owner;
    e.grace = 0;
    e.life = 100;
    it._addTo(e, 'hazards');
    bananas.push(e);
  }
  let hits = 0;
  const off = g.events.on('kart:hit', ({ kart }) => kart === k && hits++);
  let minD = 99;
  for (let i = 0; i < 45; i++) {
    await sleep(100);
    for (const e of bananas) minD = Math.min(minD, Math.hypot(k.position.x - e.position.x, k.position.z - e.position.z));
  }
  off();
  return { ok: hits === 0 && minD > 1.6, info: { hits, minDist: minD.toFixed(2), alive: bananas.filter((e) => e.active).length } };
};

T.overtake = async () => {
  const g = G();
  isolate(2);
  const a = g.karts[0], b = g.karts[1];
  // b is a slow blocker 30 m ahead of a on the same line
  place(a, 200, 0, 0, 30);
  place(b, 235, 0, 0, 8);
  b.controlLocked = false;
  b.controller.dispose?.();
  b.controller = null;
  b.input.throttle = 0.25;
  b.input.steer = 0;
  let bumps = 0;
  const off = g.events.on('kart:bump', ({ a: x, b: y }) => (x === a || y === a) && bumps++);
  let passed = false;
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    b.input.throttle = 0.25;
    if (g.track.deltaS(b.trackS, a.trackS) > 5) {
      passed = true;
      break;
    }
  }
  off();
  return { ok: passed && bumps <= 1, info: { passed, bumps, speedA: a.speed.toFixed(1) } };
};

T.rocket = async () => {
  // statistics of the rocket-start planner for a few skills
  const { AIController } = await import('/src/ai/AIController.js');
  const out = {};
  for (const skill of [0.25, 0.5, 0.82, 0.95]) {
    const fake = { character: { id: 'rex', stats: { handling: 3 } }, id: 1, yaw: 0, input: {} };
    const ai = new AIController({}, fake, { skill });
    const kinds = { good: 0, stall: 0, late: 0, early: 0 };
    let boostOk = 0;
    for (let i = 0; i < 2000; i++) {
      const p = ai._planRocket();
      kinds[p.kind]++;
      if (p.press <= 1.1 && p.press >= 0.3) boostOk++;
    }
    out[skill] = { ...kinds, boostPct: +((boostOk / 20).toFixed(1)) };
  }
  return { ok: true, info: out };
};

export async function run(name) {
  try {
    const r = await T[name]();
    return { name, ok: !!r.ok, info: r.info };
  } catch (e) {
    return { name, ok: false, info: String(e?.stack || e) };
  }
}

export async function runAll(names = Object.keys(T)) {
  const out = [];
  for (const n of names) out.push(await run(n));
  return out.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name} ${JSON.stringify(r.info)}`);
}
