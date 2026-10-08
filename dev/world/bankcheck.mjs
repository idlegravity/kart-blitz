// Node: report where bank angle disagrees with curvature (off-camber). usage: node dev/world/bankcheck.mjs canyon
import { Centerline } from '../../src/track/centerline.js';
const id = process.argv[2];
const def = (await import(`../../src/track/defs/${id}.js`)).default;
const cl = new Centerline(def);
let bad = [];
for (let i = 0; i < cl.N; i += 5) {
  const k = cl.curv[i], b = (cl.bank[i] * 180) / Math.PI;
  if (Math.abs(k) > 1 / 130 && Math.abs(b) > 1.5 && Math.sign(k) !== Math.sign(b)) bad.push([Math.round(i * cl.ds), (1 / Math.abs(k)).toFixed(0) + (k > 0 ? 'R' : 'L'), b.toFixed(1)]);
}
console.log(`${id}: off-camber samples: ${bad.length}`);
console.log(bad.map((b) => b.join(':')).join('  '));
// profile: bank by 50 m
const rows = [];
for (let s = 0; s < cl.length; s += 50) { const i = Math.round(s / cl.ds) % cl.N; rows.push(`${s}:${(cl.bank[i] * 180 / Math.PI).toFixed(0)}°/${cl.curv[i] * 1000 | 0}`); }
console.log(rows.join(' '));
