/**
 * Turtle-graphics helper for authoring track layouts: straights and arcs with exact radii, per-segment
 * elevation targets and automatic banking. Returns control points [x, y, z, halfWidth, bankDeg]. (Data tooling only.)
 *   segs: ['S', length, y1?, hw1?] | ['R', radius, degrees, y1?, hw1?] | ['L', radius, degrees, y1?, hw1?]
 * heading in degrees: 90 = +x, 0 = +z (forward = (sin h, cos h)).
 */
const smooth = (t) => t * t * (3 - 2 * t);

export function turtle({ x = 0, z = 0, y = 0, heading = 90, hw = 10.5, segs, step = 22, bankScale = 260, maxBank = 11, first = true }) {
  const pts = [];
  let h = (heading * Math.PI) / 180;
  let px = x, pz = z, py = y, phw = hw;
  if (first) pts.push([px, py, pz, phw, 0]);
  for (const seg of segs) {
    const kind = seg[0];
    let len, y1, hw1, R = 0, dir = 0, ang = 0;
    if (kind === 'S') { len = seg[1]; y1 = seg[2]; hw1 = seg[3]; } else {
      R = seg[1]; ang = (seg[2] * Math.PI) / 180; len = R * ang; y1 = seg[3]; hw1 = seg[4]; dir = kind === 'R' ? 1 : -1;
    }
    y1 = y1 ?? py;
    hw1 = hw1 ?? phw;
    const n = Math.max(1, Math.round(len / step));
    const ds = len / n, y0 = py, hw0 = phw;
    const bankFull = dir * Math.min(maxBank, bankScale / Math.max(R, 1));
    for (let i = 1; i <= n; i++) {
      if (kind === 'S') {
        px += Math.sin(h) * ds; pz += Math.cos(h) * ds;
      } else {
        const dh = -dir * (ds / R);
        const hm = h + dh / 2;
        px += Math.sin(hm) * ds; pz += Math.cos(hm) * ds;
        h += dh;
      }
      const t = i / n;
      py = y0 + (y1 - y0) * smooth(t) * 0.5 + (y1 - y0) * t * 0.5;
      phw = hw0 + (hw1 - hw0) * t;
      const bank = kind === 'S' ? 0 : bankFull * smooth(Math.min(1, Math.min(t, 1 - t + 1 / n) * 4));
      pts.push([+px.toFixed(2), +py.toFixed(2), +pz.toFixed(2), +phw.toFixed(2), +bank.toFixed(2)]);
    }
  }
  return { points: pts, end: { x: px, z: pz, y: py, heading: (h * 180) / Math.PI, hw: phw } };
}

/**
 * Append control points that blend from the turtle end pose to a target pose with a cubic Hermite curve.
 * Returns the extra points (excluding the start pose itself, which is points[0]).
 */
export function closer(end, target, { count = 6, tension = 0.9, hw = 10.5 } = {}) {
  const out = [];
  const d = Math.hypot(target.x - end.x, target.z - end.z);
  const he = (end.heading * Math.PI) / 180, ht = (target.heading * Math.PI) / 180;
  const t0 = [Math.sin(he) * d * tension, Math.cos(he) * d * tension];
  const t1 = [Math.sin(ht) * d * tension, Math.cos(ht) * d * tension];
  for (let i = 1; i < count; i++) {
    const t = i / count, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const x = h00 * end.x + h10 * t0[0] + h01 * target.x + h11 * t1[0];
    const z = h00 * end.z + h10 * t0[1] + h01 * target.z + h11 * t1[1];
    const y = end.y + (target.y - end.y) * (t * t * (3 - 2 * t));
    out.push([+x.toFixed(2), +y.toFixed(2), +z.toFixed(2), hw, 0]);
  }
  return out;
}
