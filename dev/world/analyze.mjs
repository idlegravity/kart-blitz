// Node helper: print station (s) of each control point and the curvature profile of a track def.
import { Centerline } from '../../src/track/centerline.js';
const id = process.argv[2] || 'meadow';
const def = (await import(`../../src/track/defs/${id}.js`)).default;
const cl = new Centerline(def);
console.log(`${id}: L=${cl.length.toFixed(1)} N=${cl.N}`);
def.points.forEach((p, k) => {
  let best = 0, bd = 1e9;
  for (let i = 0; i < cl.N; i++) {
    const d = Math.hypot(cl.px[i] - p[0], cl.pz[i] - p[2]) + Math.abs(cl.py[i] - p[1]);
    if (d < bd) { bd = d; best = i; }
  }
  console.log(`P${k} (${p[0]},${p[1]},${p[2]}) s=${(best * cl.ds).toFixed(0)}`);
});
// curve runs
let run = null;
const runs = [];
for (let i = 0; i < cl.N; i++) {
  const k = cl.curv[i];
  const R = Math.abs(k) > 1e-5 ? 1 / Math.abs(k) : 1e5;
  const on = R < 140;
  if (on && !run) run = { s0: i * cl.ds, dir: Math.sign(k), minR: R };
  if (on && run) run.minR = Math.min(run.minR, R);
  if (!on && run) { run.s1 = i * cl.ds; runs.push(run); run = null; }
}
if (run) { run.s1 = cl.length; runs.push(run); }
for (const r of runs) console.log(`curve s ${r.s0.toFixed(0)}..${r.s1.toFixed(0)} ${r.dir > 0 ? 'RIGHT' : 'LEFT '} minR=${r.minR.toFixed(0)}`);
