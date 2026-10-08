/**
 * List the special surfaces along the centerline of the real tracks (ramps, gaps/void, ice, boost pads, open edges).
 *   node dev/driving/features.mjs [trackId ...]
 */
import { realTrack, f2 } from './simlib.mjs';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['meadow', 'canyon', 'glacier', 'neon'];
for (const id of ids) {
  const t = await realTrack(id);
  const L = t.length;
  console.log(`\n${id}: length ${f2(L, 0)} m, laps ${t.laps}, killY ${f2(t.killY, 1)}, colliders ${t.colliders?.length ?? 0}, boostPads ${t.boostPads?.length ?? 0}, ramps ${t.ramps?.length ?? 0}`);
  const q = {};
  let hint = -1;
  const runs = [];
  let cur = null;
  const lateralProbe = [-8, 0, 8, 14, 20];
  for (let s = 0; s < L; s += 1) {
    const f = t.getFrameAt(s);
    const r0 = t.query(f.position.clone().setY(f.position.y + 0.3), hint, q);
    hint = r0.index;
    const surf = r0.surface;
    if (surf !== 'road' || (cur && cur.surf !== surf)) {
      if (!cur || cur.surf !== surf) { cur = { surf, s0: s, s1: s, launch: r0.launch, wl: r0.wallLeft, wr: r0.wallRight }; runs.push(cur); }
      cur.s1 = s;
      cur.launch = Math.max(cur.launch ?? 0, r0.launch ?? 0);
    } else cur = null;
  }
  for (const r of runs) console.log(`  centerline ${r.surf.padEnd(7)} s ${f2(r.s0, 0)}..${f2(r.s1, 0)} (${f2(r.s1 - r.s0 + 1, 0)} m)${r.launch ? ' launch ' + r.launch : ''}`);
  // wall coverage & open edges
  let openL = 0, openR = 0, both = 0;
  for (let s = 0; s < L; s += 2) {
    const f = t.getFrameAt(s);
    const r = t.query(f.position.clone().setY(f.position.y + 0.3), hint, q);
    hint = r.index;
    if (r.wallLeft == null) openL++;
    if (r.wallRight == null) openR++;
    if (r.wallLeft != null && r.wallRight != null) both++;
  }
  const n = Math.ceil(L / 2);
  console.log(`  walls: both sides ${(100 * both / n).toFixed(0)}% of the lap; open left ${(100 * openL / n).toFixed(0)}%, open right ${(100 * openR / n).toFixed(0)}%`);
  // off-road / void beyond the shoulder
  const beyond = { offroad: 0, void: 0, ice: 0 };
  for (let s = 0; s < L; s += 4) {
    const f = t.getFrameAt(s);
    for (const lat of [-16, 16]) {
      const p = f.position.clone().addScaledVector(f.right, lat);
      p.y += 0.5;
      const r = t.query(p, hint, q);
      hint = r.index;
      if (beyond[r.surface] !== undefined) beyond[r.surface]++;
    }
  }
  console.log(`  at lateral +-16 m: ${Object.entries(beyond).map(([k, v]) => `${k} ${(100 * v / (2 * Math.ceil(L / 4))).toFixed(0)}%`).join('  ')}`);
}
