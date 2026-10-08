#!/usr/bin/env node
/**
 * make-icons.mjs — procedurally renders the PWA / home-screen icons into public/ (no downloads, no new deps).
 * Uses the Playwright + Chrome already used by snap.mjs to rasterize an SVG.
 *
 *   node scripts/make-icons.mjs        → public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png (180)
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');
fs.mkdirSync(out, { recursive: true });

/** 512-unit artwork. `safe` shrinks the kart for maskable icons (content must stay inside the central 80% circle). */
const svg = (safe) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#3a3f9a"/><stop offset="0.55" stop-color="#1d2154"/><stop offset="1" stop-color="#11142b"/></radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b5b"/><stop offset="1" stop-color="#d81f3a"/></linearGradient>
    <linearGradient id="flame" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0.0"/></linearGradient>
    <clipPath id="ck"><rect x="0" y="0" width="512" height="512"/></clipPath>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <!-- speed streaks -->
  <g stroke="#ffffff" stroke-opacity="0.18" stroke-width="10" stroke-linecap="round">
    <line x1="40" y1="150" x2="170" y2="150"/><line x1="70" y1="196" x2="150" y2="196"/><line x1="30" y1="330" x2="140" y2="330"/><line x1="80" y1="372" x2="170" y2="372"/>
  </g>
  <g transform="translate(256 262) scale(${safe ? 0.78 : 1}) translate(-256 -262)">
    <!-- exhaust flame -->
    <path d="M96 292 Q40 270 20 292 Q40 314 96 316Z" fill="url(#flame)"/>
    <path d="M100 296 Q60 284 44 296 Q60 308 100 312Z" fill="#fff6c8" opacity="0.8"/>
    <!-- shadow -->
    <ellipse cx="262" cy="388" rx="170" ry="22" fill="#000" opacity="0.3"/>
    <!-- kart body -->
    <path d="M92 292 L132 250 Q150 232 178 232 L286 232 Q312 232 330 250 L380 296 Q420 300 430 322 L430 346 Q430 360 416 360 L104 360 Q88 360 88 344 L88 308 Q88 296 92 292Z" fill="url(#body)" stroke="#8c1226" stroke-width="8" stroke-linejoin="round"/>
    <!-- windshield / helmet -->
    <path d="M182 244 L284 244 Q300 244 312 258 L336 288 L170 288Z" fill="#9fe7ff" stroke="#1b6a8a" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="238" cy="224" r="34" fill="#ffd23f" stroke="#a87c00" stroke-width="7"/>
    <path d="M206 222 Q238 190 272 222Z" fill="#ff3b3b" stroke="#a31515" stroke-width="5"/>
    <!-- stripe -->
    <path d="M110 322 L410 322" stroke="#ffd23f" stroke-width="14" stroke-linecap="round"/>
    <!-- wheels -->
    <g><circle cx="144" cy="364" r="48" fill="#161a2e" stroke="#000" stroke-width="6"/><circle cx="144" cy="364" r="22" fill="#c9d1ff"/><circle cx="144" cy="364" r="8" fill="#161a2e"/></g>
    <g><circle cx="378" cy="364" r="48" fill="#161a2e" stroke="#000" stroke-width="6"/><circle cx="378" cy="364" r="22" fill="#c9d1ff"/><circle cx="378" cy="364" r="8" fill="#161a2e"/></g>
    <!-- BLITZ bolt -->
    <path d="M300 112 L246 190 L284 190 L262 252 L332 160 L292 160 L316 112Z" fill="#ffd23f" stroke="#a87c00" stroke-width="6" stroke-linejoin="round" transform="translate(40 -20)"/>
  </g>
</svg>`;

const jobs = [
  { file: 'icon-512.png', size: 512, safe: false },
  { file: 'icon-192.png', size: 192, safe: false },
  { file: 'icon-maskable-512.png', size: 512, safe: true },
  { file: 'apple-touch-icon.png', size: 180, safe: false },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:#11142b}svg{display:block;width:${j.size}px;height:${j.size}px}</style>${svg(j.safe)}`);
  await page.screenshot({ path: path.join(out, j.file), omitBackground: false });
  await page.close();
  console.log('wrote public/' + j.file);
}
await browser.close();
