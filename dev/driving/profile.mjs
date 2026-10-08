import { realTrack, f2 } from './simlib.mjs';
const id = process.argv[2] ?? 'meadow', s0 = +process.argv[3] ?? 470, s1 = +process.argv[4] ?? 535, step = +process.argv[5] ?? 2;
const t = await realTrack(id);
const q = {};
let hint = -1, prev = null;
const rows = [];
for (let s = s0; s <= s1; s += step) {
  const f = t.getFrameAt(s);
  const r = t.query(f.position.clone().setY(f.position.y + 0.3), hint, q);
  hint = r.index;
  const slope = prev == null ? 0 : (r.height - prev) / step;
  rows.push(`s=${s} h=${f2(r.height, 2)} slope=${f2(slope, 3)} surf=${r.surface} n=(${f2(r.normal.x, 2)},${f2(r.normal.y, 2)},${f2(r.normal.z, 2)}) hw=${f2(r.halfWidth,1)}`);
  prev = r.height;
}
console.log(rows.join('\n'));
