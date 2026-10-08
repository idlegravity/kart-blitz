#!/usr/bin/env node
/**
 * snap.mjs — headless browser harness for Kart Blitz.
 *
 * Spins up a private Vite dev server (random port, private cache dir), opens a page in
 * headless Google Chrome via Playwright, prints console output + uncaught errors,
 * optionally runs an action script (key presses, waits, evals, screenshots), then exits.
 * Exit code 1 if the page threw uncaught errors.
 *
 * Usage:
 *   node scripts/snap.mjs "<path?query>" [--out=snaps/x.png] [--wait=2500] [--size=1280x720]
 *        [--actions="down:ArrowUp;wait:2000;shot:snaps/b.png;up:ArrowUp"]
 *        [--actions='[["down","ArrowUp"],["wait",1500],["eval","__game.player.item=\"star\""],["shot","snaps/c.png"]]']
 *        [--eval="js to run after initial wait"] [--probe="expression printed as JSON at end"]
 *        [--fps] [--log=all|errors|none] [--noshot] [--dpr=2]   (device pixel ratio, e.g. Retina)
 *
 * Action verbs: down:<Key> up:<Key> press:<Key> wait:<ms> shot:<file> eval:<js> probe:<expr> click:<css selector>
 * Keys use Playwright names: ArrowUp, ArrowLeft, Space, ShiftLeft, KeyE, KeyQ, Escape, Enter, etc.
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opts = { path: '/', out: 'snaps/shot.png', wait: '2500', size: '1280x720', dpr: '1', actions: '', eval: '', probe: '', log: 'all', timeout: '120000' };
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--')) {
    const i = a.indexOf('=');
    if (i === -1) opts[a.slice(2)] = true; else opts[a.slice(2, i)] = a.slice(i + 1);
  } else opts.path = a;
}
const [vw, vh] = String(opts.size).split('x').map(Number);
const cacheDir = path.join(root, 'node_modules', '.cache', `snap-${process.pid}-${Date.now()}`);

function parseActions(src) {
  if (!src) return [];
  src = String(src).trim();
  if (src.startsWith('[')) return JSON.parse(src);
  return src.split(';').filter(Boolean).map(s => {
    const i = s.indexOf(':');
    return i === -1 ? [s.trim()] : [s.slice(0, i).trim(), s.slice(i + 1)];
  });
}

const errors = [];
let server, browser;
const cleanup = async () => {
  try { await browser?.close(); } catch {}
  try { await server?.close(); } catch {}
  try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch {}
};
const hardTimeout = setTimeout(async () => {
  console.error(`[snap] HARD TIMEOUT after ${opts.timeout}ms`);
  await cleanup(); process.exit(2);
}, Number(opts.timeout));

try {
  server = await createServer({
    root, configFile: path.join(root, 'vite.config.js'), cacheDir, logLevel: 'error', clearScreen: false,
    server: { port: 0, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const addr = server.httpServer.address();
  const base = `http://localhost:${addr.port}`;

  browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: Number(opts.dpr) || 1 });
  page.on('console', msg => {
    const t = msg.type();
    if (opts.log === 'none') return;
    if (opts.log === 'errors' && t !== 'error' && t !== 'warning') return;
    console.log(`[console.${t}] ${msg.text()}`);
  });
  page.on('pageerror', err => { errors.push(err); console.log(`[PAGE ERROR] ${err.message}\n${(err.stack || '').split('\n').slice(0, 6).join('\n')}`); });
  page.on('requestfailed', req => console.log(`[request failed] ${req.url()} ${req.failure()?.errorText}`));

  const url = base + (opts.path.startsWith('/') ? opts.path : '/' + opts.path);
  console.log(`[snap] loading ${url}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(Number(opts.wait));

  if (opts.eval) { const r = await page.evaluate(opts.eval); if (r !== undefined) console.log('[eval]', JSON.stringify(r)); }

  for (const [verb, arg] of parseActions(opts.actions)) {
    switch (verb) {
      case 'down': await page.keyboard.down(arg); break;
      case 'up': await page.keyboard.up(arg); break;
      case 'press': await page.keyboard.press(arg); break;
      case 'wait': await page.waitForTimeout(Number(arg)); break;
      case 'click': await page.click(arg); break;
      case 'eval': { const r = await page.evaluate(arg); if (r !== undefined) console.log('[eval]', JSON.stringify(r)); break; }
      case 'probe': console.log('[probe]', JSON.stringify(await page.evaluate(arg))); break;
      case 'shot': fs.mkdirSync(path.dirname(path.resolve(root, arg)), { recursive: true }); await page.screenshot({ path: path.resolve(root, arg) }); console.log(`[snap] saved ${arg}`); break;
      default: console.log(`[snap] unknown action ${verb}`);
    }
  }

  if (opts.fps) {
    const fps = await page.evaluate(() => new Promise(res => {
      let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
      requestAnimationFrame(f);
    }));
    console.log(`[fps] ${fps.toFixed(1)}`);
  }
  if (opts.probe) console.log('[probe]', JSON.stringify(await page.evaluate(opts.probe)));
  if (!opts.noshot) {
    fs.mkdirSync(path.dirname(path.resolve(root, opts.out)), { recursive: true });
    await page.screenshot({ path: path.resolve(root, opts.out) });
    console.log(`[snap] saved ${opts.out}`);
  }
} catch (e) {
  console.error('[snap] FAILED:', e.message);
  errors.push(e);
} finally {
  clearTimeout(hardTimeout);
  await cleanup();
  if (errors.length) { console.log(`[snap] ${errors.length} error(s)`); process.exit(1); }
  process.exit(0);
}
