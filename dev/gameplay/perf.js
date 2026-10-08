/** Measures the JS cost per frame of ItemSystem.update and all AIController.update calls. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function run(seconds = 20) {
  const g = window.__game;
  const acc = { items: 0, ai: 0, frames: 0, itemsMax: 0, aiMax: 0 };
  const origItems = g.items.update.bind(g.items);
  g.items.update = (dt) => {
    const t = performance.now();
    origItems(dt);
    const d = performance.now() - t;
    acc.items += d;
    acc.itemsMax = Math.max(acc.itemsMax, d);
    acc.frames++;
  };
  const wrapped = [];
  for (const k of g.karts) {
    const c = k.controller;
    if (!c || !c.update) continue;
    const orig = c.update.bind(c);
    c.update = (dt) => {
      const t = performance.now();
      orig(dt);
      acc.ai += performance.now() - t;
    };
    wrapped.push([c, orig]);
  }
  // per frame AI total
  let frameAi = 0, frameAiMax = 0, lastFrames = 0;
  const t0 = performance.now();
  const samples = [];
  while (performance.now() - t0 < seconds * 1000) {
    await sleep(250);
  }
  g.items.update = origItems;
  const n = Math.max(1, acc.frames);
  return {
    frames: acc.frames,
    itemsMsPerFrame: +(acc.items / n).toFixed(3),
    itemsMaxMs: +acc.itemsMax.toFixed(2),
    aiMsPerFrameAll: +(acc.ai / n).toFixed(3),
    fps: g._fps.value,
    calls: g.renderer.info.render.calls,
    tris: g.renderer.info.render.triangles,
    stats: g.items.stats(),
  };
}
