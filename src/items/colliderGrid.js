/**
 * ColliderGrid — tiny spatial hash over `track.colliders` ([{ x, z, radius }]) so projectiles can bounce off
 * static obstacles without scanning every tree/rock every sub-step. No allocation in `collect`.
 * OWNER: Gameplay agent.
 */
export class ColliderGrid {
  /**
   * @param {Array<{x:number, z:number, radius:number}>} colliders
   * @param {number} cell cell size in metres
   */
  constructor(colliders = [], cell = 32) {
    this.cell = cell;
    this.count = colliders?.length ?? 0;
    this.map = new Map();
    let maxR = 0;
    for (const c of colliders ?? []) {
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      maxR = Math.max(maxR, c.radius || 0);
    }
    this.maxR = maxR;
    for (const c of colliders ?? []) {
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      const r = (c.radius || 0.5) + 1.0; // padding so a projectile near a cell border still finds it
      const x0 = Math.floor((c.x - r) / cell), x1 = Math.floor((c.x + r) / cell);
      const z0 = Math.floor((c.z - r) / cell), z1 = Math.floor((c.z + r) / cell);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const k = gx * 73856093 ^ gz * 19349663;
          let list = this.map.get(k);
          if (!list) this.map.set(k, (list = []));
          list.push(c);
        }
      }
    }
  }

  /** Fill `out` with the colliders in the cell containing (x, z). Returns how many were written. */
  collect(x, z, out) {
    if (this.count === 0) return 0;
    const list = this.map.get(Math.floor(x / this.cell) * 73856093 ^ Math.floor(z / this.cell) * 19349663);
    if (!list) return 0;
    let n = 0;
    for (let i = 0; i < list.length; i++) out[n++] = list[i];
    return n;
  }
}
