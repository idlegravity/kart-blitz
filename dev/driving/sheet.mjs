/**
 * Contact sheet: node dev/driving/sheet.mjs out.png a.png b.png c.png ... [--cols=3] [--w=640]
 * Lays the images out in a grid (labelled with their file names) so a whole sequence can be reviewed at once.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
const args = process.argv.slice(2);
const opt = { cols: 3, w: 640 };
const files = [];
for (const a of args) {
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); opt[k] = Number(v); } else files.push(a);
}
const out = files.shift();
const cols = opt.cols, w = opt.w, h = Math.round((w * 9) / 16);
const rows = Math.ceil(files.length / cols);
const html = `<body style="margin:0;background:#111"><div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:2px">${files
  .map((f) => `<div style="position:relative;width:${w}px;height:${h}px"><img src="file://${path.resolve(f)}" width="${w}" height="${h}"><span style="position:absolute;left:4px;top:2px;font:12px monospace;color:#ff0;background:#0008;padding:1px 4px">${path.basename(f)}</span></div>`)
  .join('')}</div></body>`;
const tmp = path.resolve('node_modules/.cache/driving/sheet.html');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, html);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: cols * (w + 2), height: rows * (h + 2) } });
await page.goto('file://' + tmp);
await page.waitForTimeout(400);
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await page.screenshot({ path: path.resolve(out) });
await browser.close();
console.log('saved', out);
