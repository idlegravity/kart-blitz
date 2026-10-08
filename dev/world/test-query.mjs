// Node: query / frame sanity tests for all four tracks (no GPU needed). usage: node dev/world/test-query.mjs
import * as THREE from 'three';
import { Track } from '../../src/track/Track.js';
import { TRACK_LIST, getTrackOutline, createTrack } from '../../src/track/index.js';

let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  FAIL', msg); } };
for (const info of TRACK_LIST) {
  const def = { ...(await import(`../../src/track/defs/${info.id}.js`)).default, ...info };
  const t = new Track(def, null);
  const L = t.length;
  console.log(`== ${info.id}: L=${L.toFixed(0)} N=${t.count} startGrid=${t.startGrid.length} itemBoxSlots=${t.itemBoxSlots.length} boostPads=${t.boostPads.length} ramps=${t.ramps.length} overlaps=${t.overlaps}`);
  ok(t.startGrid.length === 8, 'startGrid has 8 slots');
  // outline (cheap, no meshes): closed loop that matches the minimap bounds
  {
    const t0 = performance.now();
    const o = getTrackOutline(info.id);
    ok(performance.now() - t0 < 60, 'outline is cheap');
    ok(o.length > 80 && o.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])), 'outline has finite points');
    const gap = Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]);
    ok(gap < 12, `outline closes (gap ${gap.toFixed(1)} m)`);
    const xs = o.map((p) => p[0]), zs = o.map((p) => p[1]);
    ok(Math.abs(Math.min(...xs) - t.minimap.bounds.minX) < 12 && Math.abs(Math.max(...zs) - t.minimap.bounds.maxZ) < 12, 'outline matches minimap bounds');
    ok(typeof createTrack(info.id, null).query === 'function', 'createTrack works');
  }
  // item box rows / boost pad / ramp bookkeeping
  {
    const rows = new Set(t.itemBoxSlots.map((b) => b.s));
    ok(rows.size >= 3 && rows.size <= 5, `3-5 item rows (${rows.size})`);
    for (const r of rows) ok(t.itemBoxSlots.filter((b) => b.s === r).length >= 4 && t.itemBoxSlots.filter((b) => b.s === r).length <= 6, 'row has 4-6 boxes');
    ok(t.boostPads.length >= 1, 'has boost pads');
    ok(t.ramps.length >= 1, 'has a ramp');
    for (const r of t.ramps) ok(r.launch >= 9 && r.launch <= 13, `ramp launch ${r.launch}`);
    for (const b of t.itemBoxSlots) for (const r of t.ramps) ok(Math.abs(t.deltaS(r.s + r.length / 2, b.s)) > r.length, 'item row not on a ramp');
  }
  ok(L > 900 && L < 1500, `lap length in 900..1500 (${L.toFixed(0)})`);
  // frames
  const f = {};
  const q = {};
  const pos = new THREE.Vector3();
  let maxJump = 0, prevS = null, prevIdx = -1, worst = 0, bad = 0;
  for (let s = 0; s < L; s += 0.7) {
    t.getFrameAt(s, f);
    for (const lat of [-6, 0, 6]) {
      pos.set(f.position.x + f.right.x * lat, f.position.y - lat * Math.tan(f.bank) + 0.5, f.position.z + f.right.z * lat);
      t.query(pos, prevIdx, q);
      if (lat === 0) {
        // centerline: lateral ~ 0, height ~ centerline y, s ~ s
        ok(Math.abs(q.lateral) < 0.25, `centerline lateral ${q.lateral.toFixed(3)} at s=${s.toFixed(1)}`);
        const ds = Math.abs(t.deltaS(s, q.s));
        if (ds > worst) worst = ds;
        if (!t.cl.gap[Math.floor(s / t.cl.ds) % t.cl.N]) ok(Math.abs(q.height - f.position.y) < 0.08 || q.surface === 'ramp', `centerline height off by ${(q.height - f.position.y).toFixed(3)} at s=${s.toFixed(1)} (${q.surface})`);
        if (prevS !== null) maxJump = Math.max(maxJump, Math.abs(t.deltaS(prevS, q.s)));
        prevS = q.s;
        prevIdx = q.index;
      } else {
        ok(Math.abs(q.lateral - lat) < 0.35, `lateral ${q.lateral.toFixed(2)} expected ${lat} at s=${s.toFixed(1)}`);
      }
      ok(q.normal.y > 0.5, `normal.y ${q.normal.y.toFixed(2)} at s=${s.toFixed(1)}`);
      if (!Number.isFinite(q.height)) bad++;
    }
  }
  console.log(`  max |s error| on the centerline: ${worst.toFixed(3)} m, max frame-to-frame s jump ${maxJump.toFixed(2)} m, non-finite ${bad}`);
  ok(maxJump < 1.6, 'query s is continuous');
  // global search agrees with local search
  for (const s of [10, L * 0.25, L * 0.5, L * 0.75]) {
    t.getFrameAt(s, f);
    pos.set(f.position.x, f.position.y + 0.5, f.position.z);
    t.query(pos, -1, q);
    ok(Math.abs(t.deltaS(s, q.s)) < 0.5, `global search s=${s.toFixed(0)} -> ${q.s.toFixed(1)}`);
  }
  // grid & item boxes sit on the road
  for (const slot of t.startGrid) {
    t.query(slot.position, -1, q);
    ok(q.surface === 'road' && Math.abs(q.height - slot.position.y) < 0.05, 'start slot on road');
  }
  for (const b of t.itemBoxSlots) {
    t.query(b.position, -1, q);
    ok(q.surface === 'road' || q.surface === 'boost' || q.surface === 'ice', `item box on road (${q.surface} @ s=${b.s})`);
  }
  // wrap / delta
  ok(Math.abs(t.wrapS(-5) - (L - 5)) < 1e-6, 'wrapS(-5)');
  ok(Math.abs(t.deltaS(L - 10, 10) - 20) < 1e-6, 'deltaS across the line');
  ok(Math.abs(t.deltaS(10, L - 10) + 20) < 1e-6, 'deltaS backwards across the line');
  if (t.overlaps) {
    // crossover: find the two stations near the same plan position and test the level resolution
    let a = -1, b = -1;
    outer: for (let i = 0; i < t.cl.N; i += 2) for (let j = i + 100; j < t.cl.N; j += 2) {
      if (Math.hypot(t.cl.px[i] - t.cl.px[j], t.cl.pz[i] - t.cl.pz[j]) < 1.5 && Math.abs(t.cl.py[i] - t.cl.py[j]) > 8) { a = i; b = j; break outer; }
    }
    ok(a >= 0, 'found crossover');
    if (a >= 0) {
      const lo = t.cl.py[a] < t.cl.py[b] ? a : b, hi = lo === a ? b : a;
      pos.set(t.cl.px[lo], t.cl.py[lo] + 1, t.cl.pz[lo]);
      t.query(pos, -1, q);
      ok(Math.abs(q.s - lo * t.cl.ds) < 1.5, `under-pass resolves to the lower deck (s=${q.s.toFixed(1)}, expected ${(lo * t.cl.ds).toFixed(1)})`);
      pos.set(t.cl.px[hi], t.cl.py[hi] + 1, t.cl.pz[hi]);
      t.query(pos, -1, q);
      ok(Math.abs(q.s - hi * t.cl.ds) < 1.5, `over-pass resolves to the upper deck (s=${q.s.toFixed(1)}, expected ${(hi * t.cl.ds).toFixed(1)})`);
      // with a wrong hint the global fallback must still find the right level
      pos.set(t.cl.px[hi], t.cl.py[hi] + 1, t.cl.pz[hi]);
      t.query(pos, lo, q);
      ok(Math.abs(q.s - hi * t.cl.ds) < 1.5, 'wrong hint recovers');
      // falling off the upper deck sideways lands on the lower deck when directly above it
      pos.set(t.cl.px[lo], t.cl.py[hi] - 3, t.cl.pz[lo]);
      t.query(pos, hi, q);
      console.log(`  kart between decks resolves to s=${q.s.toFixed(1)} height ${q.height.toFixed(1)} surface ${q.surface}`);
    }
  }
}
console.log(fails ? `\n${fails} FAILURES` : '\nall query tests passed');
process.exit(fails ? 1 : 0);
