/**
 * Measures the JS cost per frame of ItemSystem.update and all AIController.update calls (per-frame totals + percentiles).
 * Run on a race page with CPU throttling as a phone proxy, e.g.
 *   node scripts/snap.mjs "/?quick=1&skipintro=1&nocountdown=1&autodrive=1&ai=7&mute=1" --mobile --wait=3000 --noshot \
 *     --actions='[["cpu","4"],["eval","import('/dev/gameplay/perf.js').then(m=>m.run(15)).then(r=>window.__perf=r)"],["wait","17000"],["probe","window.__perf"]]'
 * Budget (docs/MOBILE.md §3.5): AI (7 CPUs) + items ≲ 2 ms/frame on the 4x-throttled proxy.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(3);
};
const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : 0);

export async function run(seconds = 20, { stress = true } = {}) {
  const g = window.__game;
  const items = [], ai = [], total = [];
  let frameAi = 0;
  const origItems = g.items.update.bind(g.items);
  const wrapped = [];
  for (const k of g.karts) {
    const c = k.controller;
    if (!c || !c.update) continue;
    const orig = c.update;
    c.update = function (dt) {
      const t = performance.now();
      orig.call(c, dt);
      frameAi += performance.now() - t;
    };
    wrapped.push([c, orig]);
  }
  g.items.update = (dt) => {
    const t = performance.now();
    origItems(dt);
    const d = performance.now() - t;
    items.push(d);
    ai.push(frameAi);
    total.push(d + frameAi);
    frameAi = 0;
  };
  // optional: keep every kart supplied with items so projectiles/hazards/comets are always in play
  const ids = ['banana3', 'bomb', 'seeker', 'bouncer', 'star', 'nitro3', 'comet', 'shrink', 'lightning', 'banana', 'nitro'];
  const feed = stress ? setInterval(() => { for (const k of g.karts) if (!k.item) g.items.giveItem(k, ids[(Math.random() * ids.length) | 0]); }, 700) : 0;
  await sleep(seconds * 1000);
  clearInterval(feed);
  g.items.update = origItems;
  for (const [c, orig] of wrapped) c.update = orig;
  return {
    frames: total.length,
    items: { mean: mean(items), p95: pct(items, 0.95), p99: pct(items, 0.99), max: pct(items, 0.9999) },
    ai: { mean: mean(ai), p95: pct(ai, 0.95), p99: pct(ai, 0.99), max: pct(ai, 0.9999) },
    total: { mean: mean(total), p95: pct(total, 0.95), p99: pct(total, 0.99), max: pct(total, 0.9999) },
    fps: g._fps.value,
    calls: g.renderer.info.render.calls,
    stats: g.items.stats(),
  };
}
