/** Runs N standing starts and counts rocket starts / burnouts per skill band. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function run(n = 5) {
  const g = window.__game;
  const stats = {};
  let offB, offS;
  const cur = { boost: new Map(), stall: new Map() };
  offB = g.events.on('kart:boost', ({ kart, source }) => {
    if (source === 'rocketstart' && g.race.time < 1) cur.boost.set(kart.name, (cur.boost.get(kart.name) || 0) + 1);
  });
  offS = g.events.on('kart:stall', ({ kart }) => cur.stall.set(kart.name, (cur.stall.get(kart.name) || 0) + 1));
  for (let i = 0; i < n; i++) {
    g.restartRace();
    for (let t = 0; t < 200; t++) {
      await sleep(100);
      if (g.race.phase === 'racing') break;
    }
    await sleep(1800);
    for (const k of g.karts) {
      const s = (stats[k.name] ||= { skill: +k.controller.skill?.toFixed?.(2), rocket: 0, stall: 0, speed2s: [] });
      s.rocket += cur.boost.get(k.name) || 0;
      s.stall += cur.stall.get(k.name) || 0;
      s.speed2s.push(+k.speed.toFixed(0));
    }
    cur.boost.clear();
    cur.stall.clear();
  }
  offB();
  offS();
  return stats;
}
