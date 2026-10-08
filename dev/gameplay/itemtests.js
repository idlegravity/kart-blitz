/**
 * In-page item tests. Usage (after the race has started, e.g. /?quick=1&nocountdown=1&skipintro=1&mute=1):
 *   node scripts/snap.mjs "/?quick=1&nocountdown=1&skipintro=1&mute=1&ai=3" --wait=2500 --noshot \
 *     --eval="import('/dev/gameplay/itemtests.js').then(m => m.runAll())"
 * Each test returns { name, ok, info }. Karts are driven by hand (controllers detached).
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = () => window.__game;

function recorder(names) {
  const g = G();
  const log = [];
  const offs = names.map((n) => g.events.on(n, (p) => log.push([n, p])));
  return {
    log,
    count: (n) => log.filter((l) => l[0] === n).length,
    stop: () => offs.forEach((o) => o()),
  };
}

/** Detach controllers, park every kart far apart on the centreline, zero inputs. */
function prepare() {
  const g = G();
  const track = g.track;
  g.karts.forEach((k, i) => {
    k.controller?.dispose?.();
    k.controller = null;
    k.input.throttle = 0;
    k.input.brake = 0;
    k.input.steer = 0;
    k.input.item = false;
    k.input.aimBack = false;
    k.item = null;
    k.itemCount = 0;
    k.rouletteTime = 0;
    k.itemTime = 0;
    k.controlLocked = false;
    place(k, 80 + i * 40, 0);
  });
  g.items.hazards.slice().forEach((h) => g.items.kill(h));
  g.items.projectiles.slice().forEach((h) => g.items.kill(h));
  void track;
}

function place(kart, s, lateral) {
  const g = G();
  const f = g.track.getFrameAt(s);
  kart.position.copy(f.position).addScaledVector(f.right, lateral);
  kart.yaw = Math.atan2(f.tangent.x, f.tangent.z);
  kart.speed = 0;
  kart.velocity?.set(0, 0, 0);
  kart.hit = null;
  kart.invulnTime = 0;
  kart.starTime = 0;
  kart.shrinkTime = 0;
  kart.respawnTime = 0;
  kart.trackIndex = -1;
  kart.forward.set(Math.sin(kart.yaw), 0, Math.cos(kart.yaw));
  kart.right.set(-Math.cos(kart.yaw), 0, Math.sin(kart.yaw));
}

async function press(kart, holdMs = 80, aimBack = false) {
  kart.input.aimBack = aimBack;
  kart.input.item = true;
  await sleep(holdMs);
  kart.input.item = false;
  await sleep(80);
  kart.input.aimBack = false;
}

const T = {};

T.banana = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  const rec = recorder(['item:use', 'item:throw']);
  g.items.giveItem(k, 'banana');
  k.input.item = true;
  await sleep(250);
  const shieldWhileHeld = g.items.getShield(k);
  k.input.item = false;
  await sleep(200);
  const hz = g.items.hazards.filter((h) => h.type === 'banana').length;
  rec.stop();
  return { ok: shieldWhileHeld === 1 && hz === 1 && k.item === null, info: { shieldWhileHeld, hazards: hz, item: k.item, throws: rec.count('item:throw') } };
};

T.banana3 = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  g.items.giveItem(k, 'banana3');
  await sleep(150);
  const shield = g.items.getShield(k);
  for (let i = 0; i < 3; i++) await press(k, 60);
  const hz = g.items.hazards.filter((h) => h.type === 'banana').length;
  return { ok: shield === 3 && hz === 3 && k.item === null, info: { shield, hazards: hz, item: k.item, count: k.itemCount } };
};

T.bananaHit = async () => {
  const g = G();
  prepare();
  const a = g.karts[0], b = g.karts[1];
  place(a, 120, 0);
  place(b, 100, 0);
  g.items.giveItem(a, 'banana');
  await press(a, 60);
  const bn = g.items.hazards.find((h) => h.type === 'banana');
  if (!bn) return { ok: false, info: 'no banana' };
  // teleport victim onto it
  b.position.copy(bn.position);
  b.position.y = bn.position.y;
  const rec = recorder(['item:hit', 'kart:hit']);
  await sleep(250);
  rec.stop();
  return { ok: rec.count('item:hit') >= 1 && b.hit?.type === 'spin', info: { hit: b.hit?.type, itemHits: rec.count('item:hit'), left: g.items.hazards.length } };
};

T.bouncer = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  g.items.giveItem(k, 'bouncer');
  await press(k, 60);
  await sleep(150);
  const p = g.items.projectiles.find((x) => x.type === 'bouncer');
  if (!p) return { ok: false, info: 'no projectile' };
  const y0 = p.position.y;
  const v = p.speed;
  const rec = recorder(['item:hit', 'item:destroy']);
  await sleep(1500);
  rec.stop();
  const alive = g.items.projectiles.includes(p);
  // karts are parked 40 m apart down the road, so the orb usually hits the next one
  return { ok: !!alive || p.bounces > 0 || rec.count('item:hit') > 0, info: { speed: v.toFixed(1), bounces: p.bounces, age: p.age.toFixed(2), y0: y0.toFixed(2), y: p.position.y.toFixed(2), hits: rec.count('item:hit') } };
};

T.bouncerHit = async () => {
  const g = G();
  prepare();
  const a = g.karts[0], b = g.karts[1];
  place(a, 100, 0);
  place(b, 150, 0);
  b.position.copy(a.position).addScaledVector(a.forward, 45); // straight down the orb's line
  g.items.giveItem(a, 'bouncer');
  const rec = recorder(['item:hit']);
  await press(a, 60);
  await sleep(1400);
  rec.stop();
  return { ok: b.hit?.type === 'tumble' || rec.count('item:hit') > 0, info: { hit: b.hit?.type, events: rec.count('item:hit') } };
};

T.seeker = async () => {
  const g = G();
  prepare();
  // put karts in known places: karts[0] behind, karts[1] slightly ahead & offset laterally
  const a = g.karts[0], b = g.karts[1];
  place(a, 100, 0);
  place(b, 190, 5);
  // make the standings agree (a behind b)
  a.progress = 100; b.progress = 190;
  g.race._updatePlaces?.(true);
  g.items.giveItem(a, 'seeker');
  const rec = recorder(['item:hit']);
  await press(a, 60);
  await sleep(150);
  const p = g.items.projectiles.find((x) => x.type === 'seeker');
  const target = p?.target?.name;
  await sleep(2600);
  rec.stop();
  return { ok: rec.count('item:hit') >= 1, info: { target, hit: b.hit?.type, events: rec.count('item:hit') } };
};

T.bomb = async () => {
  const g = G();
  prepare();
  const a = g.karts[0], b = g.karts[1];
  place(a, 100, 0);
  place(b, 180, 0);
  g.items.giveItem(a, 'bomb');
  const rec = recorder(['item:explode', 'item:hit']);
  a.speed = 20;
  await press(a, 60);
  await sleep(200);
  const flying = g.items.projectiles.filter((x) => x.type === 'bomb').length;
  await sleep(1200);
  const sitting = g.items.hazards.filter((x) => x.type === 'bomb').length;
  await sleep(3000);
  rec.stop();
  return { ok: flying === 1 && rec.count('item:explode') === 1, info: { flying, sitting, explosions: rec.count('item:explode') } };
};

T.bombBlast = async () => {
  const g = G();
  prepare();
  const a = g.karts[0], b = g.karts[1];
  place(a, 100, 0);
  place(b, 100, 0);
  b.position.x += 3;
  g.items.giveItem(a, 'bomb');
  await press(a, 60, true); // roll back
  await sleep(300);
  // put victim next to the bomb
  const bm = [...g.items.hazards, ...g.items.projectiles].find((x) => x.type === 'bomb');
  if (!bm) return { ok: false, info: 'no bomb' };
  b.position.copy(bm.position);
  b.position.x += 3;
  b.position.y = bm.position.y - 0.5;
  const rec = recorder(['item:explode', 'item:hit']);
  await sleep(3200);
  rec.stop();
  const victimHit = rec.log.some((l) => l[0] === 'item:hit' && l[1].kart === b);
  return { ok: rec.count('item:explode') === 1 && victimHit, info: { victimHit, hits: rec.count('item:hit'), explosions: rec.count('item:explode') } };
};

T.nitro = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  g.items.giveItem(k, 'nitro3');
  const seq = [];
  for (let i = 0; i < 3; i++) {
    await press(k, 60);
    seq.push([k.itemCount, k.boostTime.toFixed(2)]);
  }
  return { ok: k.item === null && seq[0][0] === 2, info: { seq, item: k.item } };
};

T.goldnitro = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  g.items.giveItem(k, 'goldnitro');
  await press(k, 60);
  const t0 = k.itemTime;
  await press(k, 60);
  await press(k, 60);
  const mid = { itemTime: k.itemTime.toFixed(2), boost: k.boostTime.toFixed(2), item: k.item };
  k.itemTime = 0.1;
  await sleep(300);
  return { ok: t0 > 7 && mid.item === 'goldnitro' && k.item === null, info: { t0: t0.toFixed(2), mid, afterItem: k.item } };
};

T.star = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  g.items.giveItem(k, 'star');
  await press(k, 60);
  return { ok: k.starTime > 7 && k.item === null, info: { starTime: k.starTime.toFixed(2) } };
};

T.bolt = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  g.karts.forEach((o) => (o.item = o === k ? null : 'banana'));
  g.items.giveItem(k, 'bolt');
  const rec = recorder(['item:lightning']);
  await press(k, 60);
  await sleep(200);
  rec.stop();
  const others = g.karts.filter((o) => o !== k);
  const shrunk = others.map((o) => [o.name, o.place, o.shrinkTime.toFixed(1), o.hit?.type ?? '-', o.item]);
  return { ok: rec.count('item:lightning') === 1 && others.every((o) => o.shrinkTime > 0), info: { shrunk, ownerShrink: k.shrinkTime } };
};

T.comet = async () => {
  const g = G();
  prepare();
  const a = g.karts[0], lead = g.karts[g.karts.length - 1];
  place(a, 100, 0);
  place(lead, 400, 0);
  a.progress = 100;
  lead.progress = 400;
  g.race._updatePlaces?.(true);
  g.items.giveItem(a, 'comet');
  const rec = recorder(['item:cometWarn', 'item:explode', 'item:hit']);
  await press(a, 60);
  await sleep(4500);
  rec.stop();
  return { ok: rec.count('item:explode') === 1 && lead.hit?.type === 'explode', info: { warn: rec.count('item:cometWarn'), explode: rec.count('item:explode'), leadHit: lead.hit?.type, leader: g.race.leader?.name } };
};

T.block = async () => {
  const g = G();
  prepare();
  const a = g.karts[0], b = g.karts[1];
  place(a, 120, 0);
  place(b, 150, 0);
  b.position.copy(a.position).addScaledVector(a.forward, 30); // straight down a's line
  b.yaw = a.yaw;
  b.forward.copy(a.forward);
  b.right.copy(a.right);
  g.items.giveItem(b, 'banana');
  b.input.item = true; // deploy a shield behind b
  await sleep(300);
  g.items.giveItem(a, 'bouncer');
  const rec = recorder(['item:block', 'item:hit', 'item:destroy']);
  await press(a, 60);
  await sleep(1600);
  rec.stop();
  b.input.item = false;
  return { ok: rec.count('item:block') === 1 && rec.count('item:hit') === 0, info: { blocks: rec.count('item:block'), hits: rec.count('item:hit'), destroys: rec.count('item:destroy'), bItem: b.item } };
};

T.blockOrbit = async () => {
  const g = G();
  prepare();
  const a = g.karts[0], b = g.karts[1];
  g.karts.forEach((k, i) => i > 1 && place(k, 700 + i * 30, 0));
  place(a, 150, 0);
  place(b, 150, 0);
  b.position.copy(a.position).addScaledVector(a.forward, 30);
  b.yaw = a.yaw + Math.PI; // b faces a, so the orb arrives at its FRONT: only an orbiting triple can absorb it
  b.forward.set(Math.sin(b.yaw), 0, Math.cos(b.yaw));
  b.right.set(-Math.cos(b.yaw), 0, Math.sin(b.yaw));
  g.items.giveItem(b, 'bouncer3');
  await sleep(200);
  const rec = recorder(['item:block', 'item:hit']);
  g.items.giveItem(a, 'bouncer');
  await press(a, 60);
  await sleep(1500);
  rec.stop();
  return { ok: rec.count('item:block') === 1 && rec.count('item:hit') === 0 && b.itemCount === 2, info: { blocks: rec.count('item:block'), hits: rec.count('item:hit'), bCount: b.itemCount, shield: g.items.getShield(b) } };
};

T.boxes = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  const box = g.items.boxes[0];
  if (!box) return { ok: false, info: 'no boxes' };
  k.position.copy(box.position);
  k.position.y -= 1.3;
  const rec = recorder(['item:boxHit', 'item:roulette', 'item:get']);
  await sleep(200);
  const roulette = k.rouletteTime;
  const activeAfter = box.active;
  place(k, 700, 0); // drive away so the box is not immediately collected again
  await sleep(2000);
  rec.stop();
  await sleep(1200);
  return { ok: rec.count('item:boxHit') >= 1 && rec.count('item:get') === 1 && !activeAfter && box.active, info: { roulette: roulette.toFixed(2), item: k.item, count: k.itemCount, respawned: box.active, events: rec.log.map((l) => l[0]) } };
};

T.ricochet = async () => {
  const g = G();
  prepare();
  const a = g.karts[0];
  // park everyone else far away so nothing gets hit
  g.karts.forEach((k, i) => i && place(k, 900 + i * 30, 0));
  place(a, 300, 0);
  // aim ~35 degrees into the right wall
  a.yaw -= 0.6;
  a.forward.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
  a.right.set(-Math.cos(a.yaw), 0, Math.sin(a.yaw));
  g.items.giveItem(a, 'bouncer');
  await press(a, 60);
  const p = g.items.projectiles.find((x) => x.type === 'bouncer');
  if (!p) return { ok: false, info: 'no projectile' };
  const path = [];
  let maxLat = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    if (!g.items.projectiles.includes(p)) break;
    maxLat = Math.max(maxLat, Math.abs(p.sample.lateral ?? 0));
    if (i % 4 === 0) path.push(`${p.bounces}@${(p.sample.lateral ?? 0).toFixed(1)}`);
  }
  const s = g.track.getFrameAt(300);
  if (s.wallRight == null) return { ok: true, info: 'no wall at s=300 on this track (open edge) - run on track=canyon' };
  return { ok: p.bounces >= 2 && maxLat < (s.wallRight ?? 20) + 0.5, info: { bounces: p.bounces, alive: g.items.projectiles.includes(p), age: p.age.toFixed(2), maxLat: maxLat.toFixed(1), wall: s.wallRight, path } };
};

T.seekerCorner = async () => {
  const g = G();
  prepare();
  const line = g.track._aiLine;
  if (!line) return { ok: false, info: 'no racing line yet (needs a track with AI)' };
  // the sharpest corner of the track
  const cn = [...line.corners].sort((a, b) => b.kmax - a.kmax)[0];
  const sCorner = cn.i0 * line.ds;
  const a = g.karts[0], b = g.karts[1];
  g.karts.forEach((k, i) => i > 1 && place(k, (sCorner + 400 + i * 30) % g.track.length, 0));
  place(a, (sCorner - 35 + g.track.length) % g.track.length, 0);
  place(b, (sCorner + cn.len + 25) % g.track.length, 0);
  a.progress = 100;
  b.progress = 100 + 35 + cn.len + 25;
  g.race._updatePlaces?.(true);
  g.items.giveItem(a, 'seeker');
  const rec = recorder(['item:hit', 'item:destroy']);
  await press(a, 60);
  await sleep(150);
  const p = g.items.projectiles.find((x) => x.type === 'seeker');
  const tgt = p?.target?.name;
  let minD = 1e9;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (p && g.items.projectiles.includes(p)) minD = Math.min(minD, Math.hypot(p.position.x - b.position.x, p.position.z - b.position.z));
    if (rec.count('item:hit') > 0) break;
  }
  rec.stop();
  return { ok: rec.count('item:hit') >= 1, info: { corner: `${cn.dir > 0 ? 'R' : 'L'} ${(cn.angle * 57.3) | 0}deg R=${(1 / cn.kmax).toFixed(0)}m`, target: tgt, hits: rec.count('item:hit'), destroys: rec.count('item:destroy'), minDist: minD.toFixed(1), bounces: p?.bounces } };
};

T.bananaCap = async () => {
  const g = G();
  prepare();
  const k = g.karts[0];
  for (let i = 0; i < 36; i++) {
    g.items.giveItem(k, 'banana');
    await press(k, 30);
    place(k, 100 + i * 8, 0);
  }
  await sleep(100);
  const n = g.items.hazards.filter((h) => h.type === 'banana').length;
  return { ok: n === 30, info: { bananas: n } };
};

T.lightningStar = async () => {
  const g = G();
  prepare();
  const k = g.karts[0], v = g.karts[1];
  v.starTime = 5;
  g.items.giveItem(k, 'bolt');
  await press(k, 60);
  await sleep(150);
  return { ok: v.shrinkTime === 0 && !v.hit, info: { starShrink: v.shrinkTime, hit: v.hit?.type } };
};

export { prepare, place, press };
export async function run(name) {
  const t0 = performance.now();
  try {
    const r = await T[name]();
    return { name, ok: !!r.ok, info: r.info, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { name, ok: false, info: String(e?.stack || e) };
  }
}

export async function runAll(names = Object.keys(T)) {
  const out = [];
  for (const n of names) out.push(await run(n));
  return out.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name} ${JSON.stringify(r.info)}`);
}

window.__itemTests = { run, runAll, T, prepare, place, press };
