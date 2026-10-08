/**
 * Shared mobile-emulation helpers for snap.mjs / smoke.mjs (docs/MOBILE.md).
 * Touch is injected through CDP Input.dispatchTouchEvent so pointer + touch events (and multi-touch) behave like a phone.
 */
export const DEVICES = {
  iphone: { w: 844, h: 390, dpr: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  se: { w: 667, h: 375, dpr: 2, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  pixel: { w: 915, h: 412, dpr: 2.625, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  ipad: { w: 1180, h: 820, dpr: 2, ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Create a browser context + page emulating a phone. Returns { ctx, page, cdp, touch, dev }. */
export async function newMobilePage(browser, deviceName = 'iphone', over = {}) {
  const dev = { ...DEVICES[deviceName], ...over };
  const ctx = await browser.newContext({
    viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dpr,
    isMobile: true, hasTouch: true, userAgent: dev.ua, screen: { width: dev.w, height: dev.h },
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, dev, touch: makeTouch(cdp), rotate: (o) => rotate(cdp, page, dev, o) };
}

export async function rotate(cdp, page, dev, orientation) {
  const land = orientation === 'landscape';
  const w = Math.max(dev.w, dev.h), h = Math.min(dev.w, dev.h);
  // go through Playwright (not raw CDP): Playwright re-applies its own viewport on screenshots, which would
  // silently undo a CDP-only override. For a mobile context it derives the screen orientation from width/height.
  await page.setViewportSize({ width: land ? w : h, height: land ? h : w });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
}

/**
 * touch.seq(fingers): fingers = [{ x1, y1, x2, y2, move (ms to travel), hold (ms before lifting, from the end of the move) }]
 * All fingers go down together, travel together, and lift at their own `hold` time.
 * Helpers: tap(x,y), hold(x,y,ms), drag(x1,y1,x2,y2,ms), multi([[x,y,ms],…]).
 */
export function makeTouch(cdp) {
  let nextId = 1;
  const pt = (id, x, y) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 });
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  async function seq(fingers) {
    const f = fingers.map((a) => ({ ...a, id: nextId++ }));
    await send('touchStart', f.map((a) => pt(a.id, a.x1, a.y1)));
    const maxMove = Math.max(0, ...f.map((a) => a.move || 0));
    if (maxMove > 0) {
      const steps = Math.max(2, Math.round(maxMove / 16));
      for (let i = 1; i <= steps; i++) {
        await sleep(maxMove / steps);
        await send('touchMove', f.map((a) => {
          const t = a.move ? Math.min(1, (i / steps) * (maxMove / a.move)) : 1;
          return pt(a.id, a.x1 + (a.x2 - a.x1) * t, a.y1 + (a.y2 - a.y1) * t);
        }));
      }
    }
    const t0 = Date.now();
    const alive = new Set(f.map((a) => a.id));
    for (const a of [...f].sort((p, q) => (p.hold || 0) - (q.hold || 0))) {
      const wait = (a.hold || 0) - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      alive.delete(a.id);
      await send('touchEnd', f.filter((b) => alive.has(b.id)).map((b) => pt(b.id, b.x2, b.y2)));
    }
  }
  return {
    seq,
    tap: (x, y) => seq([{ x1: x, y1: y, x2: x, y2: y, hold: 50 }]),
    hold: (x, y, ms) => seq([{ x1: x, y1: y, x2: x, y2: y, hold: ms }]),
    drag: (x1, y1, x2, y2, ms, hold = 0) => seq([{ x1, y1, x2, y2, move: ms, hold }]),
    multi: (list) => seq(list.map(([x, y, ms]) => ({ x1: x, y1: y, x2: x, y2: y, hold: ms }))),
  };
}
