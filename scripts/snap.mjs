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
 *
 * Mobile emulation (docs/MOBILE.md):  --mobile[=iphone|se|pixel|ipad]   (default iphone)
 *   Real Chrome with isMobile + hasTouch + DPR + mobile UA, landscape viewport, and `mobile=1` appended to the URL.
 *     iphone 844x390@3   se 667x375@2   pixel 915x412@2.625   ipad 1180x820@2     (--size / --dpr still override)
 *   Touch actions (real CDP Input.dispatchTouchEvent, so pointer/touch events + multi-touch behave like a phone).
 *   Arguments use ',' and '|' only (the action list itself is split on ';'):
 *     tap:x,y                        touch down + up
 *     touch:x,y,ms                   hold one finger for ms
 *     drag:x1,y1,x2,y2,ms            finger down at 1, move linearly to 2 over ms, up
 *     hold:x1,y1,x2,y2,ms            like drag but stays down for 400ms at the end before lifting
 *     multitouch:x,y,ms|x,y,ms|...   several fingers down simultaneously; each lifts after its own ms
 *                                    (JSON form also works: multitouch:[[x,y,ms],[x,y,ms]])
 *     rotate:portrait|landscape      swap the emulated viewport + screen orientation (fires resize/orientationchange)
 *     cpu:4                          CDP CPU throttling (phone proxy); cpu:1 = off
 *   Coordinates are CSS px in the current viewport.  Example:
 *     node scripts/snap.mjs "/?quick=1&skipintro=1&nocountdown=1&mute=1" --mobile --wait=3000 \
 *       --actions="multitouch:120,300,2500|740,320,2500;shot:snaps/mobile/core/steer.png"
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEVICES, makeTouch, rotate as rotateTo } from './lib/mobile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opts = { path: '/', out: 'snaps/shot.png', wait: '2500', size: '1280x720', dpr: '1', actions: '', eval: '', probe: '', log: 'all', timeout: '120000' };
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--')) {
    const i = a.indexOf('=');
    if (i === -1) opts[a.slice(2)] = true; else opts[a.slice(2, i)] = a.slice(i + 1);
  } else opts.path = a;
}
const dev = opts.mobile ? DEVICES[opts.mobile === true ? 'iphone' : opts.mobile] : null;
if (opts.mobile && !dev) { console.error(`[snap] unknown --mobile=${opts.mobile} (iphone|se|pixel|ipad)`); process.exit(2); }
if (dev) {
  if (!process.argv.some((a) => a.startsWith('--size='))) opts.size = `${dev.w}x${dev.h}`;
  if (!process.argv.some((a) => a.startsWith('--dpr='))) opts.dpr = String(dev.dpr);
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
let server, browser, cdp, touch, curDev;
const nums = (s) => String(s).split(',').map(Number);
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
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh }, deviceScaleFactor: Number(opts.dpr) || 1,
    ...(dev ? { isMobile: true, hasTouch: true, userAgent: dev.ua, screen: { width: vw, height: vh } } : {}),
  });
  const page = await ctx.newPage();
  cdp = await ctx.newCDPSession(page);
  touch = makeTouch(cdp);
  curDev = { w: vw, h: vh, dpr: Number(opts.dpr) || 1 };
  page.on('console', msg => {
    const t = msg.type();
    if (opts.log === 'none') return;
    if (opts.log === 'errors' && t !== 'error' && t !== 'warning') return;
    console.log(`[console.${t}] ${msg.text()}`);
  });
  page.on('pageerror', err => { errors.push(err); console.log(`[PAGE ERROR] ${err.message}\n${(err.stack || '').split('\n').slice(0, 6).join('\n')}`); });
  page.on('requestfailed', req => console.log(`[request failed] ${req.url()} ${req.failure()?.errorText}`));

  let url = base + (opts.path.startsWith('/') ? opts.path : '/' + opts.path);
  if (dev && !/[?&]mobile=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'mobile=1';
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
      case 'tap': { const [x, y] = nums(arg); await touch.tap(x, y); break; }
      case 'touch': { const [x, y, ms] = nums(arg); await touch.hold(x, y, ms); break; }
      case 'drag': case 'hold': { const [x1, y1, x2, y2, ms] = nums(arg); await touch.drag(x1, y1, x2, y2, ms, verb === 'hold' ? 400 : 0); break; }
      case 'multitouch': {
        const list = String(arg).trim().startsWith('[') ? JSON.parse(arg) : String(arg).split('|').map(nums);
        await touch.multi(list);
        break;
      }
      case 'rotate': await rotateTo(cdp, page, curDev, arg); break;
      case 'cpu': await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(arg) || 1 }); break;
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
