/**
 * Curvature statistics of the real tracks: how tight are the bends compared with the kart's turning options?
 * node dev/driving/curv.mjs [trackId ...]
 */
import { realTrack, f2 } from './simlib.mjs';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['meadow', 'canyon', 'glacier', 'neon'];
for (const id of ids) {
  const t = await realTrack(id);
  const L = t.length;
  const bins = { '<25': 0, '25-40': 0, '40-60': 0, '60-90': 0, '90-150': 0, '>150': 0 };
  let minR = 1e9, minS = 0, n = 0;
  const tight = [];
  for (let s = 0; s < L; s += 4) {
    const k = Math.abs(t.curvatureAt(s));
    const R = k > 1e-5 ? 1 / k : 1e5;
    n++;
    if (R < minR) { minR = R; minS = s; }
    const key = R < 25 ? '<25' : R < 40 ? '25-40' : R < 60 ? '40-60' : R < 90 ? '60-90' : R < 150 ? '90-150' : '>150';
    bins[key]++;
    if (R < 40) tight.push([Math.round(s), Math.round(R)]);
  }
  console.log(`${id}: length ${f2(L, 0)} m, min radius ${f2(minR, 1)} m at s=${f2(minS, 0)}; fraction of the lap by radius:`, Object.entries(bins).map(([k, v]) => `${k}: ${(100 * v / n).toFixed(0)}%`).join('  '));
  if (tight.length) console.log('   tight spots (s, R<40):', tight.slice(0, 24).map((x) => x.join(':')).join(' '));
}
