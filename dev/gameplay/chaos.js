/** Chaos test: hand every kart a random item every few seconds and let the AI use them. Reports leaked entities. */
import { ITEM_IDS } from '/src/data/items.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function run(seconds = 60, every = 2500) {
  const g = window.__game;
  const t0 = performance.now();
  const errors = [];
  const onErr = (e) => errors.push(String(e.message || e));
  window.addEventListener('error', onErr);
  let given = 0;
  let maxHaz = 0, maxProj = 0;
  while (performance.now() - t0 < seconds * 1000) {
    for (const k of g.karts) {
      if (!k.item && !(k.rouletteTime > 0) && !k.finished) {
        g.items.giveItem(k, ITEM_IDS[(Math.random() * ITEM_IDS.length) | 0]);
        given++;
      }
    }
    for (let i = 0; i < 10; i++) {
      await sleep(every / 10);
      maxHaz = Math.max(maxHaz, g.items.hazards.length);
      maxProj = Math.max(maxProj, g.items.projectiles.length);
    }
  }
  window.removeEventListener('error', onErr);
  return { given, maxHaz, maxProj, stats: g.items.stats(), poolFree: g.items._free.length, poolSize: g.items._pool.length, phase: g.race.phase, errors };
}
