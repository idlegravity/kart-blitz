#!/usr/bin/env node
/**
 * smoke.mjs — end-to-end integration suite for Kart Blitz (orchestrator-owned).
 *
 * Boots one private Vite dev server + headless Chrome (real GPU) and runs scenarios, each in a fresh page:
 *   menu        title screen boots into state 'menu', UI responds to Enter
 *   race:<id>   1-lap autodrive race on each track at timescale 4 → results, 8 finishers, no stuck karts
 *   gp          4-race Grand Prix via game.nextRace() → GP_COMPLETE, points awarded, back to menu
 *   timetrial   solo race → results with a record object
 *   pause       Esc toggles pause during a race, sim time freezes
 *   lifecycle   restart ×3 + quit → no scene/GPU-resource leaks
 *   split:N     N-player (2..4) 1-lap autodrive split-screen race → all humans finish, views/layout correct
 *   perf:split2 / perf:split4   real-time fps + draw calls in split-screen
 *   perf:<id>   real-time fps + draw calls + triangles per track
 *
 * Usage: node scripts/smoke.mjs [--only=race,perf] [--tracks=meadow,neon] [--shots] [--keep] [--dist]
 *   --dist  build the production bundle (into node_modules/.cache/smoke-dist) and test THAT via `vite preview`
 * Exit code 1 if any scenario fails. Screenshots → snaps/smoke/.
 */
import { createServer, preview, build } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const only = args.only ? String(args.only).split(',') : null;
const TRACKS = args.tracks ? String(args.tracks).split(',') : ['meadow', 'canyon', 'glacier', 'neon'];
const shotsDir = path.join(root, 'snaps', 'smoke');
fs.mkdirSync(shotsDir, { recursive: true });
const cacheDir = path.join(root, 'node_modules', '.cache', `smoke-${process.pid}`);

const want = (name) => !only || only.some((o) => name === o || name.startsWith(o + ':') || name.split(':')[0] === o);
const results = [];

let server;
if (args.dist) {
  const outDir = path.join(root, 'node_modules', '.cache', 'smoke-dist');
  await build({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  server = await preview({ root, configFile: path.join(root, 'vite.config.js'), logLevel: 'error', build: { outDir }, preview: { port: 0, strictPort: false } });
  console.log('[smoke] testing production bundle from', path.relative(root, outDir));
} else {
  server = await createServer({
    root, configFile: path.join(root, 'vite.config.js'), cacheDir, logLevel: 'error', clearScreen: false,
    server: { port: 0, hmr: false, watch: null },
  });
  await server.listen();
}
const base = `http://localhost:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

async function scenario(name, fn) {
  if (!want(name)) return;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n    ${(e.stack || '').split('\n').slice(1, 4).join('\n    ')}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const t0 = Date.now();
  let ok = true, detail = '';
  try {
    detail = (await fn(page)) ?? '';
  } catch (e) {
    ok = false;
    detail = e.message.split('\n')[0];
  }
  if (errors.length) ok = false;
  results.push({ name, ok, secs: ((Date.now() - t0) / 1000).toFixed(1), detail, errors, consoleErrors });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name} (${results.at(-1).secs}s) ${detail}`);
  for (const e of errors.slice(0, 3)) console.log(`   page error: ${e}`);
  for (const e of [...new Set(consoleErrors)].slice(0, 3)) console.log(`   console.error: ${e.slice(0, 300)}`);
  await page.close();
}

const go = (page, q) => page.goto(`${base}/${q}`, { waitUntil: 'load' });
const waitFor = (page, expr, timeout = 60000) => page.waitForFunction(expr, null, { timeout, polling: 250 });
const shot = async (page, file) => { if (args.shots || args.keep) await page.screenshot({ path: path.join(shotsDir, file) }); };

// ---------------------------------------------------------------------------------------- menu
await scenario('menu', async (page) => {
  await go(page, '');
  await waitFor(page, () => window.__game?.state === 'menu', 20000);
  await page.waitForTimeout(1500);
  await shot(page, 'menu-title.png');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await shot(page, 'menu-2.png');
  const st = await page.evaluate(() => ({ state: __game.state, uiChildren: document.getElementById('ui').children.length }));
  if (st.state !== 'menu') throw new Error(`expected menu state, got ${st.state}`);
  if (st.uiChildren === 0) throw new Error('UI root is empty');
  return `ui nodes=${st.uiChildren}`;
});

// ---------------------------------------------------------------------------------------- races
for (const id of TRACKS) {
  await scenario(`race:${id}`, async (page) => {
    await go(page, `?quick=1&track=${id}&skipintro=1&autodrive=1&laps=1&timescale=4&nopause=1&mute=1`);
    await waitFor(page, () => window.__game?.state === 'race', 30000);
    await page.waitForTimeout(4000);
    await shot(page, `race-${id}-mid.png`);
    await waitFor(page, () => __game.race.phase === 'results', 150000);
    await page.waitForTimeout(1200);
    await shot(page, `race-${id}-results.png`);
    const r = await page.evaluate(() => ({
      n: __game.race.results.length,
      real: __game.race.results.filter((x) => !x.estimated).length,
      time: __game.race.results[0].time,
      trackLen: __game.track.length,
      minProgress: Math.min(...__game.karts.map((k) => k.progress)),
      nan: __game.karts.some((k) => !Number.isFinite(k.position.x + k.position.y + k.position.z)),
    }));
    if (r.nan) throw new Error('a kart has a non-finite position');
    if (r.n !== 8) throw new Error(`expected 8 results, got ${r.n}`);
    if (r.real < 6) throw new Error(`only ${r.real}/8 karts genuinely finished (others estimated) — stuck karts?`);
    return `len=${r.trackLen.toFixed(0)}m winner=${r.time.toFixed(1)}s finished=${r.real}/8`;
  });
}

// ---------------------------------------------------------------------------------------- gp
await scenario('gp', async (page) => {
  await go(page, '?quick=1&mode=gp&skipintro=1&autodrive=1&laps=1&timescale=4&nopause=1&mute=1');
  await page.evaluate(() => {
    window.__gpDone = null;
    __game.events.on('gp:complete', (p) => (window.__gpDone = p));
  });
  for (let i = 0; i < 4; i++) {
    await waitFor(page, () => __game.state === 'race' && __game.race.phase === 'results', 150000);
    const idx = await page.evaluate(() => __game.gp?.raceIndex);
    if (idx !== i) throw new Error(`expected GP race index ${i}, got ${idx}`);
    await page.waitForTimeout(500);
    if (i === 3) await shot(page, 'gp-last-results.png');
    await page.evaluate(() => __game.nextRace());
    if (i < 3) await waitFor(page, () => __game.state === 'race' && __game.race.phase !== 'results', 30000);
  }
  await waitFor(page, () => window.__gpDone !== null && __game.state === 'menu', 20000);
  await page.waitForTimeout(1500);
  await shot(page, 'gp-trophy.png');
  const s = await page.evaluate(() => window.__gpDone.standings.map((x) => x.points));
  const total = s.reduce((a, b) => a + b, 0);
  if (total !== 4 * 58) throw new Error(`expected ${4 * 58} total points, got ${total}`);
  return `points=${s.join(',')}`;
});

// ---------------------------------------------------------------------------------------- time trial
await scenario('timetrial', async (page) => {
  await go(page, '?quick=1&mode=timetrial&skipintro=1&autodrive=1&laps=1&timescale=4&nopause=1&mute=1');
  await waitFor(page, () => window.__game?.state === 'race', 30000);
  const kartCount = await page.evaluate(() => __game.karts.length);
  if (kartCount !== 1) throw new Error(`time trial should have 1 kart, has ${kartCount}`);
  await waitFor(page, () => __game.race.phase === 'results', 150000);
  const rec = await page.evaluate(() => __game.race.record);
  if (!rec) throw new Error('no record object');
  await page.waitForTimeout(800);
  await shot(page, 'timetrial-results.png');
  return `total=${rec.total.toFixed(2)} bestLap=${rec.bestLap.toFixed(2)}`;
});

// ---------------------------------------------------------------------------------------- pause
await scenario('pause', async (page) => {
  await go(page, '?quick=1&nocountdown=1&autodrive=1&mute=1');
  await waitFor(page, () => window.__game?.state === 'race' && __game.race.phase === 'racing', 30000);
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const t1 = await page.evaluate(() => ({ p: __game.paused, t: __game.race.time }));
  await page.waitForTimeout(800);
  await shot(page, 'pause-menu.png');
  const t2 = await page.evaluate(() => __game.race.time);
  if (!t1.p) throw new Error('Escape did not pause');
  if (Math.abs(t2 - t1.t) > 1e-6) throw new Error('race time advanced while paused');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => __game.paused)) throw new Error('Escape did not resume');
  return 'ok';
});

// ---------------------------------------------------------------------------------------- lifecycle / leaks
await scenario('lifecycle', async (page) => {
  await go(page, '?quick=1&skipintro=1&autodrive=1&mute=1');
  await waitFor(page, () => window.__game?.state === 'race', 30000);
  await page.waitForTimeout(1500);
  const snapStats = () => page.evaluate(() => ({
    children: __game.scene.children.length,
    geo: __game.renderer.info.memory.geometries,
    tex: __game.renderer.info.memory.textures,
  }));
  const first = await snapStats();
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => __game.restartRace());
    await waitFor(page, () => __game.state === 'race', 30000);
    await page.waitForTimeout(1500);
  }
  const after = await snapStats();
  await page.evaluate(() => __game.quitToMenu());
  await waitFor(page, () => __game.state === 'menu', 10000);
  await page.waitForTimeout(800);
  const menu = await snapStats();
  const leak = after.children > first.children + 2 || after.geo > first.geo * 1.25 + 20 || after.tex > first.tex * 1.25 + 10;
  const detail = `scene ${first.children}→${after.children}→${menu.children}  geo ${first.geo}→${after.geo}→${menu.geo}  tex ${first.tex}→${after.tex}→${menu.tex}`;
  if (leak) throw new Error(`resource growth across restarts: ${detail}`);
  return detail;
});

// ---------------------------------------------------------------------------------------- perf
for (const id of TRACKS) {
  await scenario(`perf:${id}`, async (page) => {
    await go(page, `?quick=1&track=${id}&skipintro=1&autodrive=1&nopause=1&mute=1`);
    await waitFor(page, () => window.__game?.state === 'race', 30000);
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => new Promise((res) => {
      let n = 0, calls = 0, tris = 0;
      const t0 = performance.now();
      const f = () => {
        n++;
        calls = Math.max(calls, __game.renderer.info.render.calls);
        tris = Math.max(tris, __game.renderer.info.render.triangles);
        if (performance.now() - t0 < 4000) requestAnimationFrame(f);
        else res({ fps: n / ((performance.now() - t0) / 1000), calls, tris });
      };
      requestAnimationFrame(f);
    }));
    await shot(page, `perf-${id}.png`);
    const detail = `fps=${r.fps.toFixed(1)} calls=${r.calls} tris=${(r.tris / 1e6).toFixed(2)}M`;
    if (r.fps < 50) throw new Error(`low fps: ${detail}`);
    return detail;
  });
}

// ---------------------------------------------------------------------------------------- split-screen
const splitShotsDir = path.join(root, 'snaps', 'split', 'core');
fs.mkdirSync(splitShotsDir, { recursive: true });
for (const n of [2, 3, 4]) {
  await scenario(`split:${n}`, async (page) => {
    await go(page, `?quick=1&players=${n}&track=meadow&skipintro=1&autodrive=1&laps=1&timescale=4&nopause=1&mute=1`);
    await waitFor(page, () => window.__game?.state === 'race', 40000);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(splitShotsDir, `smoke-split${n}-mid.png`) });
    const v = await page.evaluate(() => ({
      views: __game.views.length, players: __game.players.length, layout: __game.layout, split: __game.isSplit,
      overview: !!__game.overviewRect, karts: __game.karts.length,
      idx: __game.players.map((k) => k.playerIndex).join(','),
      cams: new Set(__game.views.map((x) => x.camera)).size,
      aspects: __game.views.map((x) => x.camera.aspect.toFixed(2)).join('/'),
    }));
    const wantLayout = n === 2 ? 'h2' : 'quad';
    if (v.views !== n || v.players !== n) throw new Error(`expected ${n} views/players, got ${v.views}/${v.players}`);
    if (v.layout !== wantLayout || !v.split) throw new Error(`layout ${v.layout} split=${v.split}`);
    if (v.overview !== (n === 3)) throw new Error(`overviewRect ${v.overview} for ${n}P`);
    if (v.cams !== n) throw new Error('views do not have distinct cameras');
    if (v.karts !== 8) throw new Error(`expected 8 karts, got ${v.karts}`);
    await waitFor(page, () => __game.race.phase === 'results', 150000);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(splitShotsDir, `smoke-split${n}-results.png`) });
    const r = await page.evaluate(() => ({
      humans: __game.race.results.filter((x) => x.isPlayer).length,
      humansDone: __game.players.every((k) => k.finished && !k._estimated),
      pidx: __game.race.results.filter((x) => x.playerIndex >= 0).map((x) => x.playerIndex).sort().join(','),
      nan: __game.karts.some((k) => !Number.isFinite(k.position.x + k.position.y + k.position.z)),
    }));
    if (r.nan) throw new Error('non-finite kart position');
    if (r.humans !== n || !r.humansDone) throw new Error(`humans in results ${r.humans}, all genuinely finished=${r.humansDone}`);
    if (r.pidx !== [...Array(n).keys()].join(',')) throw new Error(`result playerIndex values ${r.pidx}`);
    // teardown must clear the views
    await page.evaluate(() => __game.quitToMenu());
    const after = await page.evaluate(() => ({ v: __game.views.length, p: __game.players.length, s: __game.isSplit }));
    if (after.v || after.p || after.s) throw new Error('views/players not cleared after quitToMenu');
    return `layout=${v.layout} aspects=${v.aspects} idx=${v.idx}`;
  });
}
for (const n of [2, 4]) {
  await scenario(`perf:split${n}`, async (page) => {
    const q = n === 4 ? '&quality=medium' : '';
    await go(page, `?quick=1&players=${n}&track=meadow&skipintro=1&autodrive=1&nopause=1&mute=1${q}`);
    await waitFor(page, () => window.__game?.state === 'race', 40000);
    await page.waitForTimeout(6000);
    const r = await page.evaluate(() => new Promise((res) => {
      let f = 0, calls = 0, tris = 0;
      const t0 = performance.now();
      const loop = () => {
        f++;
        calls = Math.max(calls, __game.renderer.info.render.calls);
        tris = Math.max(tris, __game.renderer.info.render.triangles);
        if (performance.now() - t0 < 4000) requestAnimationFrame(loop);
        else res({ fps: f / ((performance.now() - t0) / 1000), calls, tris });
      };
      requestAnimationFrame(loop);
    }));
    await page.screenshot({ path: path.join(splitShotsDir, `perf-split${n}.png`) });
    const detail = `fps=${r.fps.toFixed(1)} calls=${r.calls} tris=${(r.tris / 1e6).toFixed(2)}M`;
    if (r.fps < (n === 4 ? 40 : 50)) throw new Error(`low fps: ${detail}`);
    return detail;
  });
}

await browser.close();
await (server.close?.() ?? new Promise((r) => server.httpServer.close(r)));
fs.rmSync(cacheDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} scenarios passed ====`);
for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
process.exit(failed.length ? 1 : 0);
