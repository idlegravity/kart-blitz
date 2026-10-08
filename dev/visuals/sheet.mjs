// Contact sheet: node dev/visuals/sheet.mjs <out.png> <cols> <cellWidth> img1.png img2.png ...
import { chromium } from 'playwright';
import fs from 'node:fs';
const [out, cols, cw, ...imgs] = process.argv.slice(2);
const C = Number(cols), W = Number(cw);
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${C},${W}px);gap:2px">` +
  imgs.map((p) => `<div style="position:relative"><img style="width:${W}px;display:block" src="data:image/png;base64,${fs.readFileSync(p).toString('base64')}"><span style="position:absolute;left:4px;bottom:2px;color:#fff;font:11px monospace;text-shadow:0 1px 2px #000">${p.split('/').pop()}</span></div>`).join('') + '</body>';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: C * W + (C - 1) * 2, height: 200 } });
await page.setContent(html);
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('saved', out);
