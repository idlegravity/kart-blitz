// Node: quick layout stats for a def module path. usage: node dev/world/tune.mjs glacier
import { Centerline } from '../../src/track/centerline.js';
const id = process.argv[2];
const def = (await import(`../../src/track/defs/${id}.js`)).default;
const cl = new Centerline(def);
const b = cl.bounds();
let minR = 1e9, at = 0;
for (let i = 0; i < cl.N; i++) { const R = 1 / Math.max(1e-5, Math.abs(cl.curv[i])); if (R < minR) { minR = R; at = i; } }
let minSep = 1e9, sepAt = [0, 0];
for (let i = 0; i < cl.N; i += 4) for (let j = i + 1; j < cl.N; j += 4) {
  const ds = Math.min(Math.abs(j - i), cl.N - Math.abs(j - i)) * cl.ds;
  if (ds < 100) continue;
  const d = Math.hypot(cl.px[i] - cl.px[j], cl.pz[i] - cl.pz[j]);
  if (d < minSep) { minSep = d; sepAt = [i, j]; }
}
console.log(`${id}: L=${cl.length.toFixed(0)}  bbox x ${b.minX.toFixed(0)}..${b.maxX.toFixed(0)} z ${b.minZ.toFixed(0)}..${b.maxZ.toFixed(0)} y ${b.minY.toFixed(0)}..${b.maxY.toFixed(0)}  minR=${minR.toFixed(0)}@${(at * cl.ds).toFixed(0)}  minSep=${minSep.toFixed(0)}@${sepAt.map((v) => (v * cl.ds).toFixed(0)).join('/')}`);
let maxGrade = 0, gAt = 0;
for (let i = 0; i < cl.N; i++) { const g = Math.abs(cl.ty[i]) / Math.hypot(cl.tx[i], cl.tz[i]); if (g > maxGrade) { maxGrade = g; gAt = i; } }
console.log(`max grade ${(maxGrade * 100).toFixed(1)}% @ s=${(gAt * cl.ds).toFixed(0)}`);
const runs = cl.curveRuns(120).map((r) => `${r.s0.toFixed(0)}-${r.s1.toFixed(0)}${r.dir > 0 ? 'R' : 'L'}${r.minR.toFixed(0)}`);
console.log('curves:', runs.join('  '));
