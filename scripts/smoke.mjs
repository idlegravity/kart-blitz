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
 *   mobile:menu     (iPhone 844x390@3, touch) tap from title through the menus into a race; Players step skipped
 *   mobile:race     touch-driven start (stick + drift + item), then CPU autopilot to 1-lap results, results UI tappable
 *   mobile:rotate   portrait → orientation event + race auto-pause; landscape back; visibility pause
 *   mobile:context  WebGL context loss/restore mid-race → race restarts, no errors
 *   perf:mobile     real-time fps with 4x CPU throttle, draw calls, triangles, render scale (budgets: ≤150 calls, ≤450k tris, ≥30 fps)
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
import { newMobilePage } from './lib/mobile.mjs';

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

async function scenario(name, fn, opt = {}) {
  if (!want(name)) return;
  let page, mob = null;
  if (opt.mobile) {
    mob = await newMobilePage(browser, opt.mobile);
    page = mob.page;
  } else page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n    ${(e.stack || '').split('\n').slice(1, 4).join('\n    ')}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const t0 = Date.now();
  let ok = true, detail = '';
  try {
    detail = (await fn(page, mob)) ?? '';
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
  await (mob ? mob.ctx.close() : page.close());
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


// ---------------------------------------------------------------------------------------- mobile (docs/MOBILE.md)
const mobShotsDir = path.join(root, 'snaps', 'mobile', 'core');
fs.mkdirSync(mobShotsDir, { recursive: true });
const mshot = (page, file) => page.screenshot({ path: path.join(mobShotsDir, file) });
/** Center of the first visible tappable UI element (optionally matching a label), skipping Back buttons. */
const findTappable = (page, label) => page.evaluate((label) => {
  const els = [...document.querySelectorAll('#ui .title-hit, #ui [role=button], #ui button, #ui .btn, #ui .rc')];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 8 || r.height < 8 || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.1) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    const txt = (el.textContent || '').trim();
    if (label ? !new RegExp(label, 'i').test(txt) : /^(back|‹|←)/i.test(txt) || el.matches('.back, [data-back]')) continue;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, text: txt.slice(0, 30) };
  }
  return null;
}, label);
const touchSetup = (page) => page.evaluate(() => {
  window.__screens = [];
  __game.events.on('ui:screen', (p) => window.__screens.push(p.screen));
  window.__orient = [];
  __game.events.on('game:orientation', (p) => window.__orient.push(p.orientation));
  window.__ctxEvt = [];
  __game.events.on('game:contextRestored', (p) => window.__ctxEvt.push(p.action));
});

await scenario('mobile:menu', async (page, m) => {
  await go(page, '?mobile=1&mute=1');
  await waitFor(page, () => window.__game?.state === 'menu', 20000);
  await touchSetup(page);
  const env = await page.evaluate(() => ({ mobile: __game.platform.mobile, touch: __game.platform.touch, q: __game.settings.quality, o: __game.orientation, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, pr: __game.renderer.getPixelRatio() }));
  if (!env.mobile || !env.touch) throw new Error(`platform not mobile/touch: ${JSON.stringify(env)}`);
  if (env.q !== 'mobile') throw new Error(`first-run quality should be 'mobile', got ${env.q}`);
  if (env.o !== 'landscape') throw new Error(`orientation ${env.o}`);
  await page.waitForTimeout(1500);
  await mshot(page, 'smoke-title.png');
  const seen = [];
  for (let step = 0; step < 14; step++) {
    if (await page.evaluate(() => __game.state === 'race' || __game.state === 'loading')) break;
    const sc = await page.evaluate(() => window.__screens.at(-1));
    const el = await findTappable(page, sc === 'main' ? 'quick' : undefined);
    if (!el) { await page.waitForTimeout(500); continue; }
    if (el.w < 40 || el.h < 36) throw new Error(`tap target too small on '${sc}': ${Math.round(el.w)}x${Math.round(el.h)} "${el.text}"`);
    seen.push(`${sc}:${el.text.replace(/\s+/g, ' ').slice(0, 14)}`);
    if (step > 0 && step < 4) await mshot(page, `smoke-menu-${step}.png`);
    await m.touch.tap(el.x, el.y);
    await page.waitForTimeout(700);
  }
  await waitFor(page, () => __game.state === 'race', 30000);
  const screens = await page.evaluate(() => window.__screens);
  if (screens.includes('players') || screens.includes('lobby')) throw new Error(`Players/lobby step not skipped on mobile: ${screens.join('>')}`);
  const r = await page.evaluate(() => ({ players: __game.players.length, karts: __game.karts.length, dev: __game.raceConfig.players[0].device }));
  if (r.players !== 1) throw new Error(`mobile must be single player, got ${r.players}`);
  return `screens=${screens.join('>')} taps=${seen.length}`;
}, { mobile: 'iphone' });

await scenario('mobile:race', async (page, m) => {
  await go(page, '?mobile=1&quick=1&track=meadow&skipintro=1&laps=1&timescale=4&nopause=1&mute=1&players=3');
  await waitFor(page, () => window.__game?.state === 'race', 40000);
  const pl = await page.evaluate(() => __game.players.length);
  if (pl !== 1) throw new Error(`players=3 must be ignored on mobile, got ${pl}`);
  await waitFor(page, () => __game.race.phase === 'racing', 30000);
  const tc = await page.evaluate(() => !!document.getElementById('touch-controls'));
  const s0 = await page.evaluate(() => ({ spd: __game.player.speed, s: __game.player.trackS ?? 0 }));
  // left thumb: stick drag right, right thumb: tap the lower-right area (drift) — all through real multi-touch
  const W = 844, H = 390;
  await m.touch.multi([[110, H - 110, 2500], [W - 110, H - 100, 2500], [W - 200, H - 190, 600]]);
  await m.touch.drag(100, H - 110, 190, H - 110, 400, 1500);
  await mshot(page, 'smoke-race-touch.png');
  const s1 = await page.evaluate(() => ({ spd: __game.player.speed, s: __game.player.trackS ?? 0, steer: __game.player.steer ?? null, touch: __game.input.touch?.active ?? null }));
  if (!(s1.spd > 3 || s1.s !== s0.s)) throw new Error(`kart did not move under touch control (no auto-accel?): ${JSON.stringify({ s0, s1 })}`);
  // hand the kart to the CPU autopilot so the race can finish at timescale 4 (finger-steering a full lap is not scriptable)
  await page.evaluate(() => {
    const ai = __game.karts.find((k) => !k.isPlayer).controller.constructor;
    const k = __game.player;
    k.controller.dispose?.();
    k.controller = new ai(__game, k, { skill: 0.9, autopilot: true });
  });
  await waitFor(page, () => __game.race.phase === 'results', 150000);
  await page.waitForTimeout(2500);
  await mshot(page, 'smoke-race-results.png');
  const el = await findTappable(page);
  if (!el) throw new Error('results screen has no visible tappable button');
  const inView = await page.evaluate(() => {
    const bad = [...document.querySelectorAll('#ui .btn, #ui [role=button], #ui button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1); });
    return bad.map((e) => (e.textContent || '').trim().slice(0, 20));
  });
  if (inView.length) throw new Error(`results buttons off-screen: ${inView.join(', ')}`);
  return `touch-controls=${tc} spd=${s1.spd.toFixed(1)} results ok (tap target "${el.text.replace(/\s+/g, ' ')}")`;
}, { mobile: 'iphone' });

await scenario('mobile:rotate', async (page, m) => {
  await go(page, '?mobile=1&quick=1&skipintro=1&nocountdown=1&autodrive=1&mute=1');
  await waitFor(page, () => window.__game?.state === 'race' && __game.race.phase === 'racing', 40000);
  await touchSetup(page);
  await page.waitForTimeout(800);
  if (await page.evaluate(() => __game.paused)) throw new Error('paused before rotate');
  await m.rotate('portrait');
  await page.waitForTimeout(700);
  await mshot(page, 'smoke-portrait.png');
  const p = await page.evaluate(() => ({ o: __game.orientation, paused: __game.paused, evt: window.__orient.join(','), w: innerWidth, h: innerHeight, ar: __game.camera.aspect }));
  if (p.o !== 'portrait' || p.evt !== 'portrait') throw new Error(`portrait not reported: ${JSON.stringify(p)}`);
  if (!p.paused) throw new Error('race did not auto-pause in portrait');
  const prompt = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#ui *')].find((e) => /rotate/i.test(e.textContent || '') && e.children.length < 6 && e.getBoundingClientRect().width > 100);
    return !!el;
  });
  await m.rotate('landscape');
  await page.waitForTimeout(700);
  const l = await page.evaluate(() => ({ o: __game.orientation, evt: window.__orient.join(','), ar: __game.camera.aspect }));
  if (l.o !== 'landscape' || l.evt !== 'portrait,landscape') throw new Error(`landscape not restored: ${JSON.stringify(l)}`);
  if (l.ar < 1.5) throw new Error(`camera aspect not updated after rotating back: ${l.ar}`);
  // visibility: a hidden page pauses a running race
  await page.evaluate(() => __game.resume());
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hid = await page.evaluate(() => __game.paused);
  await page.evaluate(() => { delete document.hidden; });
  if (!hid) throw new Error('visibilitychange(hidden) did not pause the race');
  return `rotate prompt in DOM=${prompt}`;
}, { mobile: 'iphone' });

await scenario('mobile:context', async (page) => {
  await go(page, '?mobile=1&quick=1&skipintro=1&autodrive=1&nopause=1&mute=1');
  await waitFor(page, () => window.__game?.state === 'race' && __game.race.phase === 'racing', 40000);
  await touchSetup(page);
  const gen = await page.evaluate(() => (window.__gen = __game.karts[0]));
  await page.evaluate(() => { const gl = __game.renderer.getContext(); window.__lose = gl.getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await page.waitForTimeout(500);
  if (!(await page.evaluate(() => __game._contextLost))) throw new Error('context loss not detected');
  await page.evaluate(() => window.__lose.restoreContext());
  await waitFor(page, () => window.__ctxEvt.length > 0, 10000);
  await waitFor(page, () => __game.state === 'race' && __game.race.phase !== 'intro' || __game.state === 'menu', 30000);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ lost: __game._contextLost, state: __game.state, evt: window.__ctxEvt.join(','), fresh: __game.karts[0] !== window.__gen, time: __game.race.time }));
  if (r.lost) throw new Error('still flagged lost');
  if (r.state !== 'race' || !r.fresh) throw new Error(`race not rebuilt after restore: ${JSON.stringify(r)}`);
  return `restored → ${r.evt}, race rebuilt`;
}, { mobile: 'iphone' });

await scenario('perf:mobile', async (page, m) => {
  await m.cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await go(page, '?mobile=1&quick=1&track=meadow&skipintro=1&autodrive=1&nopause=1&mute=1');
  await waitFor(page, () => window.__game?.state === 'race', 60000);
  await page.waitForTimeout(12000); // let dynamic resolution settle
  const r = await page.evaluate(() => new Promise((res) => {
    let n = 0, calls = 0, tris = 0, worst = 0, last = performance.now();
    const t0 = last;
    const f = (now) => {
      n++; worst = Math.max(worst, now - last); last = now;
      calls = Math.max(calls, __game.renderer.info.render.calls);
      tris = Math.max(tris, __game.renderer.info.render.triangles);
      if (now - t0 < 5000) requestAnimationFrame(f);
      else res({ fps: n / ((now - t0) / 1000), calls, tris, worst, scale: __game.renderScale, q: __game.settings.quality, shadow: __game.renderer.shadowMap.enabled });
    };
    requestAnimationFrame(f);
  }));
  await mshot(page, 'smoke-perf-mobile.png');
  const detail = `cpu4x fps=${r.fps.toFixed(1)} worst=${r.worst.toFixed(0)}ms calls=${r.calls} tris=${(r.tris / 1000).toFixed(0)}k scale=${r.scale} q=${r.q}`;
  const over = [];
  if (r.fps < 30) over.push('fps<30');
  if (r.calls > 150) over.push('calls>150');
  if (r.tris > 450000) over.push('tris>450k');
  if (over.length) throw new Error(`${over.join(',')}: ${detail}`);
  return detail;
}, { mobile: 'iphone' });

await browser.close();
await (server.close?.() ?? new Promise((r) => server.httpServer.close(r)));
fs.rmSync(cacheDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} scenarios passed ====`);
for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
process.exit(failed.length ? 1 : 0);
