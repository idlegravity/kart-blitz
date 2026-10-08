// Node-side triangle profiler:  node dev/visuals/tris.mjs [quality] [--parts]
import { CHARACTERS } from '../../src/data/characters.js';
import { KART_CLASSES, makePalette, buildChassis, buildWheelGeo, buildSteeringGeo } from '../../src/visuals/karts.js';
import { buildDriver } from '../../src/visuals/drivers/index.js';
import { setDetail } from '../../src/visuals/geo.js';

const quality = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'high';
const parts = process.argv.includes('--parts');
setDetail(quality === 'low' ? 0.7 : 1);
let worst = 0;
for (const c of CHARACTERS) {
  const cn = c.weightClass, cls = KART_CLASSES[cn], pal = makePalette(c);
  const ch = buildChassis(cn, pal);
  const wf = buildWheelGeo(cls.wheels.front, cn, pal), wr = buildWheelGeo(cls.wheels.rear, cn, pal);
  const st = buildSteeringGeo(cn, pal);
  const dr = buildDriver(c, { palette: pal, cls, className: cn, quality });
  const total = ch.tris + wf.tris * 2 + wr.tris * 2 + st.tris + dr.tris;
  worst = Math.max(worst, total);
  console.log(`${c.id.padEnd(7)} ${cn.padEnd(6)} total ${String(total).padStart(6)} | chassis ${ch.tris} wheelF ${wf.tris}x2 wheelR ${wr.tris}x2 steer ${st.tris} driver ${dr.tris}`);
  if (parts) {
    console.log('  chassis:', ch.log.map((r) => r.tris).join(' '));
  }
}
console.log('worst', worst);
