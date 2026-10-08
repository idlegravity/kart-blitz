// Node micro-benchmarks: query cost and outline cost.
import * as THREE from 'three';
import { Track } from '../../src/track/Track.js';
import { TRACK_LIST, getTrackOutline } from '../../src/track/index.js';
for (const info of TRACK_LIST) {
  const t0 = performance.now();
  const outline = getTrackOutline(info.id);
  const t1 = performance.now();
  getTrackOutline(info.id);
  const t2 = performance.now();
  const def = { ...(await import(`../../src/track/defs/${info.id}.js`)).default, ...info };
  const tt = performance.now();
  const t = new Track(def, null);
  const tCons = performance.now() - tt;
  const pos = new THREE.Vector3();
  const out = {};
  let hint = -1;
  const N = 200000;
  const f = {};
  const tq = performance.now();
  for (let i = 0; i < N; i++) {
    const s = (i * 0.37) % t.length;
    t.getFrameAt(s, f);
    pos.set(f.position.x + f.right.x * 3, f.position.y + 0.3, f.position.z + f.right.z * 3);
    t.query(pos, hint, out);
    hint = out.index;
  }
  const dq = performance.now() - tq;
  const tg = performance.now();
  for (let i = 0; i < 2000; i++) {
    pos.set(f.position.x + i, f.position.y + 0.3, f.position.z);
    t.query(pos, -1, out);
  }
  const dg = performance.now() - tg;
  console.log(`${info.id}: outline first ${(t1 - t0).toFixed(1)} ms (cached ${(t2 - t1).toFixed(2)} ms, ${outline.length} pts) | ctor ${tCons.toFixed(0)} ms | local query+frame ${(dq / N * 1000).toFixed(2)} us | global query ${(dg / 2000 * 1000).toFixed(1)} us`);
}
