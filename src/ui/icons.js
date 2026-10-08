/**
 * Inline SVG art for the UI: the 13 item icons, menu glyphs, trophies and input glyphs.
 * Everything is procedural (no external assets). OWNER: Presentation.
 *
 * Item icons share gradients from one hidden <svg> (`DEFS_SVG`) that UIManager mounts once.
 */
import { esc } from './dom.js';

const INK = '#1a0d3f';
const S = (w = 5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/** Hidden <svg> holding every shared gradient. Must stay in the DOM (not display:none). */
export const DEFS_SVG = `
<svg class="ui-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="kb-banana" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff9b0"/><stop offset=".45" stop-color="#ffdc3f"/><stop offset="1" stop-color="#e79400"/></linearGradient>
  <radialGradient id="kb-orb-green" cx=".34" cy=".28" r=".85"><stop offset="0" stop-color="#d4ffdc"/><stop offset=".3" stop-color="#43e675"/><stop offset="1" stop-color="#0c7434"/></radialGradient>
  <radialGradient id="kb-orb-red" cx=".34" cy=".28" r=".85"><stop offset="0" stop-color="#ffd6d0"/><stop offset=".3" stop-color="#ff4a3d"/><stop offset="1" stop-color="#9a0f1c"/></radialGradient>
  <radialGradient id="kb-orb-blue" cx=".34" cy=".28" r=".85"><stop offset="0" stop-color="#d8ecff"/><stop offset=".32" stop-color="#4c92ff"/><stop offset="1" stop-color="#1436a8"/></radialGradient>
  <radialGradient id="kb-bomb" cx=".34" cy=".28" r=".9"><stop offset="0" stop-color="#7d7f9c"/><stop offset=".28" stop-color="#3a3a52"/><stop offset="1" stop-color="#0b0b16"/></radialGradient>
  <linearGradient id="kb-nitro" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb35a"/><stop offset=".45" stop-color="#ff8a00"/><stop offset="1" stop-color="#c84e00"/></linearGradient>
  <linearGradient id="kb-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff6a8"/><stop offset=".4" stop-color="#ffc800"/><stop offset="1" stop-color="#b87700"/></linearGradient>
  <linearGradient id="kb-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4f7fb"/><stop offset=".5" stop-color="#b8c2d3"/><stop offset="1" stop-color="#6c778c"/></linearGradient>
  <linearGradient id="kb-star" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbb8"/><stop offset=".5" stop-color="#ffe93b"/><stop offset="1" stop-color="#ffa800"/></linearGradient>
  <linearGradient id="kb-bolt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffbc4"/><stop offset=".5" stop-color="#ffe600"/><stop offset="1" stop-color="#ff9c00"/></linearGradient>
  <linearGradient id="kb-wing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#bcd4ff"/></linearGradient>
  <linearGradient id="kb-rainbow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3b3b" stop-opacity=".55"/><stop offset=".25" stop-color="#ffb400" stop-opacity=".55"/><stop offset=".5" stop-color="#3ee86b" stop-opacity=".55"/><stop offset=".75" stop-color="#2de2ff" stop-opacity=".55"/><stop offset="1" stop-color="#9b5cff" stop-opacity=".55"/></linearGradient>
  <linearGradient id="kb-tro-gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b87700"/><stop offset=".25" stop-color="#ffd23f"/><stop offset=".5" stop-color="#fff6a8"/><stop offset=".75" stop-color="#ffc400"/><stop offset="1" stop-color="#a86a00"/></linearGradient>
  <linearGradient id="kb-tro-silver" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6c778c"/><stop offset=".25" stop-color="#d6deea"/><stop offset=".5" stop-color="#ffffff"/><stop offset=".75" stop-color="#c3cddd"/><stop offset="1" stop-color="#5f6a80"/></linearGradient>
  <linearGradient id="kb-tro-bronze" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a3d10"/><stop offset=".25" stop-color="#e58a3c"/><stop offset=".5" stop-color="#ffc98f"/><stop offset=".75" stop-color="#d9782a"/><stop offset="1" stop-color="#6d3410"/></linearGradient>
  <linearGradient id="kb-tro-base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2f7a"/><stop offset="1" stop-color="#1b1245"/></linearGradient>
  <linearGradient id="kb-ribbon-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5cc8ff"/><stop offset="1" stop-color="#2a6be0"/></linearGradient>
  <linearGradient id="kb-ribbon-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c39bff"/><stop offset="1" stop-color="#7a3ef0"/></linearGradient>
</defs></svg>`;

// ------------------------------------------------------------------------------------------------
// item icon parts (100x100 viewBox)
// ------------------------------------------------------------------------------------------------
const banana = () => `
  <path d="M27 12C21 24 20 46 32 64c12 18 36 24 54 13 5-3 3-9-3-8-17 4-34-6-39-24-4-14 0-27-8-33Z" fill="url(#kb-banana)" ${S(5)}/>
  <path d="M32 20c-2 16 3 32 16 42" fill="none" stroke="#fffbd0" stroke-width="4.5" stroke-linecap="round" opacity=".9"/>
  <path d="M40 40c3 12 12 20 24 22" fill="none" stroke="#e79400" stroke-width="3" stroke-linecap="round" opacity=".75"/>
  <path d="M27 12 24 4l10-3 5 9Z" fill="#8a5220" ${S(4)}/>
  <path d="M84 70l7-4 3 8-8 5Z" fill="#5b3512" ${S(4)}/>`;

const orb = (grad, ring = true, reticle = false) => `
  <clipPath id="oc-${grad}"><circle cx="50" cy="50" r="34"/></clipPath>
  <circle cx="50" cy="50" r="34" fill="url(#kb-orb-${grad})"/>
  ${ring ? `<g clip-path="url(#oc-${grad})"><path d="M10 47Q50 74 90 47" fill="none" stroke="#fff" stroke-width="10"/><path d="M10 47Q50 74 90 47" fill="none" stroke="${INK}" stroke-width="2" opacity=".25" transform="translate(0 6)"/></g>` : ''}
  <ellipse cx="36" cy="30" rx="11" ry="6.5" fill="#fff" opacity=".8" transform="rotate(-32 36 30)"/>
  <circle cx="50" cy="50" r="34" fill="none" ${S(5.5)}/>
  ${reticle ? `<g transform="translate(66 34)"><circle r="10" fill="#fff" fill-opacity=".92" ${S(3.5)}/><circle r="4" fill="#ff3b3b"/><path d="M0-15v6M0 9v6M-15 0h6M9 0h6" ${S(3.5)}/></g>` : ''}`;

const triple = (inner, positions = [[50, 29], [29, 67], [71, 67]], k = 0.56) =>
  positions
    .map(([x, y], i) => `<g transform="translate(${x} ${y}) scale(${k}) translate(-50 -50)">${inner(i)}</g>`)
    .join('');

const nitroCan = (grad = 'nitro', flame = true) => `
  <rect x="45" y="4" width="10" height="10" rx="3" fill="url(#kb-steel)" ${S(4)}/>
  <rect x="36" y="11" width="28" height="14" rx="5" fill="url(#kb-steel)" ${S(4.5)}/>
  <rect x="28" y="22" width="44" height="68" rx="15" fill="url(#kb-${grad})" ${S(5)}/>
  <rect x="28" y="33" width="44" height="7" fill="#fff" opacity=".95" stroke="none"/>
  <rect x="28" y="76" width="44" height="7" fill="#fff" opacity=".95" stroke="none"/>
  <rect x="28" y="22" width="44" height="68" rx="15" fill="none" ${S(5)}/>
  ${flame ? `<path d="M50 42c9 9 13 18 9 27-2 5-7 7-9 7s-7-2-9-7c-3-6-1-12 4-17 0 4 2 6 5 7-2-6-2-11 0-17Z" fill="#ff3b1f" ${S(3.2)}/><path d="M50 58c4 4 5 8 3 11-1 2-3 3-3 3s-2-1-3-3c-2-4 0-7 3-11Z" fill="#ffe45c"/>` : ''}
  <path d="M35 46v30" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".55"/>`;

const sparkle = (x, y, s = 1, col = '#fff') =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0-10C1-3 3-1 10 0 3 1 1 3 0 10-1 3-3 1-10 0-3-1-1-3 0-10Z" fill="${col}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;

const starPath = (cx, cy, R, r) => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    d += `${i === 0 ? 'M' : 'L'}${(cx + Math.cos(a) * rad).toFixed(1)} ${(cy + Math.sin(a) * rad).toFixed(1)}`;
  }
  return d + 'Z';
};

const ITEM_PARTS = {
  banana: () => `<g transform="translate(2 4)">${banana()}</g>`,
  banana3: () =>
    `<g transform="translate(48 92) rotate(-30) scale(.74) translate(-50 -92)">${banana()}</g>
     <g transform="translate(52 92) rotate(30) scale(.74) translate(-50 -92)">${banana()}</g>
     <g transform="translate(50 95) scale(.8) translate(-50 -92)">${banana()}</g>`,
  bouncer: () => orb('green', true),
  bouncer3: () => triple(() => orb('green', true)),
  seeker: () => orb('red', true, true),
  seeker3: () => triple(() => orb('red', true)),
  nitro: () => `<g transform="translate(0 2)">${nitroCan('nitro')}</g>`,
  nitro3: () =>
    `<g transform="translate(22 50) scale(.66) translate(-50 -46)">${nitroCan('nitro', false)}</g>
     <g transform="translate(78 50) scale(.66) translate(-50 -46)">${nitroCan('nitro', false)}</g>
     <g transform="translate(50 56) scale(.78) translate(-50 -50)">${nitroCan('nitro')}</g>`,
  goldnitro: () =>
    `<g transform="translate(0 3)">${nitroCan('gold')}</g>${sparkle(84, 22, 1.25, '#fffbc8')}${sparkle(14, 36, 0.9, '#fffbc8')}${sparkle(80, 74, 0.7, '#fff')}`,
  star: () => `
    <clipPath id="star-clip"><path d="${starPath(50, 54, 44, 20)}"/></clipPath>
    <path d="${starPath(50, 54, 44, 20)}" fill="url(#kb-star)" ${S(5.5)}/>
    <g clip-path="url(#star-clip)"><rect x="-10" y="20" width="130" height="16" fill="url(#kb-rainbow)" transform="rotate(-28 50 50)"/><rect x="-10" y="60" width="130" height="14" fill="url(#kb-rainbow)" transform="rotate(-28 50 50)"/></g>
    <path d="${starPath(50, 54, 44, 20)}" fill="none" ${S(5.5)}/>
    <ellipse cx="42" cy="56" rx="4.6" ry="6.4" fill="${INK}"/><ellipse cx="58" cy="56" rx="4.6" ry="6.4" fill="${INK}"/>
    <circle cx="43.6" cy="53.4" r="1.7" fill="#fff"/><circle cx="59.6" cy="53.4" r="1.7" fill="#fff"/>
    <path d="M44 66q6 5 12 0" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>
    ${sparkle(88, 18, 0.8, '#fff')}`,
  bolt: () => `
    <path d="M60 3 20 56h25l-11 41 47-58H51L69 3Z" fill="url(#kb-bolt)" ${S(5.5)}/>
    <path d="M58 12 33 50" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" opacity=".85"/>
    ${sparkle(18, 20, 0.8, '#fff')}${sparkle(86, 84, 0.7, '#fff')}`,
  bomb: () => `
    <path d="M14 58h-6" ${S(4)}/>
    <g transform="translate(9 58)"><rect x="-6" y="-3" width="14" height="6" rx="2" fill="url(#kb-gold)" ${S(3)}/><ellipse cx="-7" cy="0" rx="6" ry="9" fill="url(#kb-gold)" ${S(3.5)}/><ellipse cx="-7" cy="0" rx="2.2" ry="5" fill="#3a3a52"/></g>
    <circle cx="50" cy="60" r="32" fill="url(#kb-bomb)" ${S(5.5)}/>
    <ellipse cx="38" cy="46" rx="11" ry="6.5" fill="#fff" opacity=".55" transform="rotate(-32 38 46)"/>
    <rect x="44" y="20" width="20" height="13" rx="4" fill="url(#kb-steel)" ${S(4.5)} transform="rotate(20 54 26)"/>
    <path d="M62 24c8-6 12-12 12-19" fill="none" stroke="#d8b06a" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M62 24c8-6 12-12 12-19" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
    <g transform="translate(75 6)"><path d="M0-9 2.6-2.6 9-0.6 3.4 2.4 5 9 0 5 -5 9 -3.4 2.4 -9 -0.6 -2.6-2.6Z" fill="#ffb400" ${S(2.2)}/><circle r="3.2" fill="#fffbc8"/></g>`,
  comet: () => `
    <path d="M6 88C24 84 36 74 44 62" fill="none" stroke="#7fb2ff" stroke-width="7" stroke-linecap="round" opacity=".7"/>
    <path d="M14 70c10-2 20-8 27-18" fill="none" stroke="#c6dcff" stroke-width="4" stroke-linecap="round" opacity=".85"/>
    ${sparkle(12, 60, 0.9, '#fff')}${sparkle(24, 90, 0.7, '#cfe2ff')}${sparkle(36, 78, 0.55, '#fff')}
    <g transform="translate(60 46) scale(1.12)">
      <path d="M-8 -10C-30 -34-40 -22-30 -6-22 4-14 0-8 -4Z" fill="url(#kb-wing)" ${S(3.8)}/>
      <path d="M-6 -6C-22 -16-30 -10-24 -2" fill="none" stroke="#9bbcf0" stroke-width="2.4" stroke-linecap="round"/>
      ${Array.from({ length: 8 }, (_, i) => `<path transform="rotate(${i * 45})" d="M-6-22 0-38 6-22Z" fill="#2b5fe0" ${S(3.4)}/>`).join('')}
      <circle r="24" fill="url(#kb-orb-blue)" ${S(5)}/>
      <ellipse cx="-8" cy="-10" rx="8" ry="4.6" fill="#fff" opacity=".8" transform="rotate(-32 -8 -10)"/>
      <circle cx="-6" cy="3" r="3.4" fill="#fff"/><circle cx="8" cy="3" r="3.4" fill="#fff"/><circle cx="-5.4" cy="3.4" r="1.6" fill="${INK}"/><circle cx="8.6" cy="3.4" r="1.6" fill="${INK}"/>
    </g>`,
};

// count-aware variants: a triple item shows two (then one) as it is used up
ITEM_PARTS.banana2 = () =>
  `<g transform="translate(50 90) rotate(-17) scale(.72) translate(-50 -90)">${banana()}</g>
   <g transform="translate(50 90) rotate(17) scale(.72) translate(-50 -90)">${banana()}</g>`;
ITEM_PARTS.bouncer2 = () => triple(() => orb('green', true), [[30, 52], [70, 52]], 0.62);
ITEM_PARTS.seeker2 = () => triple(() => orb('red', true), [[30, 52], [70, 52]], 0.62);
ITEM_PARTS.nitro2 = () =>
  `<g transform="translate(29 48) scale(.7) translate(-50 -46)">${nitroCan('nitro', true)}</g>
   <g transform="translate(71 48) scale(.7) translate(-50 -46)">${nitroCan('nitro', true)}</g>`;

/** Ids of every real item that has an icon (variants like 'banana2' are display-only). */
export const ITEM_ICON_IDS = Object.keys(ITEM_PARTS).filter((k) => !/2$/.test(k));
/** Every drawable icon id including the display-only variants. */
export const ITEM_ICON_VARIANTS = Object.keys(ITEM_PARTS);

/** Icon id to show for an item with `count` uses left (triples shrink to 2 then 1 as they are used). */
export function itemIconFor(item, count) {
  if (!item) return null;
  if (item.endsWith('3')) {
    const base = item.slice(0, -1);
    if (count <= 1) return base;
    if (count === 2) return `${base}2`;
  }
  return item;
}

/** Item icon as an SVG markup string (100x100 viewBox). */
export function itemIcon(id, cls = '') {
  const part = ITEM_PARTS[id];
  if (!part) return '';
  return `<svg class="ico item-ico ${cls}" viewBox="0 0 100 100" aria-hidden="true">${part()}</svg>`;
}

// ------------------------------------------------------------------------------------------------
// generic 24x24 stroke glyphs (currentColor)
// ------------------------------------------------------------------------------------------------
function gearPath(cx, cy, ro, ri, teeth) {
  let d = '';
  const n = teeth * 2;
  for (let i = 0; i < n * 2; i++) {
    const a0 = (i / (n * 2)) * Math.PI * 2;
    const phase = Math.floor(i / 2) % 2 === 0 ? ro : ri;
    const px = cx + Math.cos(a0) * phase, py = cy + Math.sin(a0) * phase;
    d += `${i === 0 ? 'M' : 'L'}${px.toFixed(2)} ${py.toFixed(2)}`;
  }
  return d + 'Z';
}

const UI_GLYPHS = {
  trophy: '<path d="M7 3.5h10V9a5 5 0 0 1-10 0V3.5Z"/><path d="M7 5.5H3.8v1.7A3.6 3.6 0 0 0 7.4 10.8M17 5.5h3.2v1.7a3.6 3.6 0 0 1-3.6 3.6"/><path d="M12 14v3.6M8.4 20.5h7.2M9.4 17.6h5.2"/>',
  flag: '<path d="M5 21.5V3.5"/><path d="M5 4.5c3.2-1.6 5.2 1.6 8.6 0 2.4-1.1 4.2-.9 5.4-.3v9c-1.2-.6-3-.8-5.4.3-3.4 1.6-5.4-1.6-8.6 0"/>',
  stopwatch: '<circle cx="12" cy="13.6" r="7.6"/><path d="M12 13.6V9M9.4 2.6h5.2M12 2.6v3.4M18.8 5.6l1.6 1.6"/>',
  gear: `<path d="${gearPath(12, 12, 9.6, 7.2, 8)}"/><circle cx="12" cy="12" r="3"/>`,
  gamepad: '<path d="M6.6 7.5h10.8a4.6 4.6 0 0 1 4.5 5.5l-1 4.5a2.6 2.6 0 0 1-4.4.9L14.2 16H9.8l-2.3 2.4a2.6 2.6 0 0 1-4.4-.9l-1-4.5a4.6 4.6 0 0 1 4.5-5.5Z"/><path d="M8 10.6v3.2M6.4 12.2h3.2"/><circle cx="15.6" cy="11.2" r=".8" fill="currentColor"/><circle cx="17.9" cy="13.3" r=".8" fill="currentColor"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.4"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6.5 14h11"/>',
  gauge: '<path d="M4.2 18.5a9.2 9.2 0 1 1 15.6 0"/><path d="M12 13.5l4-4.6"/><circle cx="12" cy="14" r="1.4" fill="currentColor"/>',
  play: '<path d="M8 5.2v13.6l11-6.8Z" fill="currentColor"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4 4.5v4.6h4.6"/>',
  exit: '<path d="M9.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3.5"/><path d="M15.5 8l4 4-4 4M19 12H9.5"/>',
  home: '<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M6 10v9.5h4.5v-5h3v5H18V10"/>',
  speaker: '<path d="M4 9.5v5h3.6l4.4 3.8V5.7L7.6 9.5Z" fill="currentColor"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6M18 6.8a7.6 7.6 0 0 1 0 10.4"/>',
  music: '<path d="M9 17.5V5.6l11-2v11.9"/><circle cx="6.6" cy="17.6" r="2.7" fill="currentColor"/><circle cx="17.6" cy="15.6" r="2.7" fill="currentColor"/>',
  monitor: '<rect x="3" y="4.5" width="18" height="11.5" rx="2"/><path d="M9 20h6M12 16v4"/>',
  fps: '<path d="M3 13h4l2-6 3.4 11 2.6-8 1.2 3H21"/>',
  star: `<path d="${starPath(12, 12.8, 9.6, 4.3)}" fill="currentColor"/>`,
  flame: '<path d="M12 3c.6 3.6 4.6 5.6 4.6 10.2a4.6 4.6 0 0 1-9.2 0c0-2 .9-3.2 2-4.4.2 1.4.8 2 1.6 2.4C11 8.4 10.8 5.8 12 3Z" fill="currentColor"/>',
  bolt: '<path d="M13.5 2.5 5 13.5h6l-1.5 8 9-12h-6.2Z" fill="currentColor"/>',
  check: '<path d="m5 12.6 4.4 4.4L19 7.4"/>',
  chevron: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  chevronL: '<path d="m15 5.5-6.5 6.5 6.5 6.5"/>',
  arrowUp: '<path d="M12 19V5.5M6 11.5l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v13.5M6 12.5l6 6 6-6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  warn: '<path d="M12 3.6 22 20H2Z"/><path d="M12 9.6v4.6M12 17.2h.01"/>',
  siren: '<path d="M6 19v-6a6 6 0 0 1 12 0v6"/><path d="M4 19h16M12 3v2M3.8 6.2 5.3 7.7M20.2 6.2 18.7 7.7"/>',
  rocket: '<path d="M12 2.5c3.6 2.6 5.2 6.4 4.5 11.2H7.5C6.8 8.9 8.4 5.1 12 2.5Z"/><circle cx="12" cy="9" r="1.7"/><path d="M7.5 12.5 4.5 15v4l3.4-1.6M16.5 12.5l3 2.5v4l-3.4-1.6M10 17.5c.4 2 1 3 2 4 1-1 1.6-2 2-4"/>',
  medal: '<circle cx="12" cy="15" r="5.6"/><path d="M8.6 10.6 6 3h4l2 4.2L14 3h4l-2.6 7.6"/>',
  crown: '<path d="M3.5 8.5 7.6 13l4.4-7 4.4 7 4.1-4.5-1.6 10.2H5.1Z" fill="currentColor"/>',
  feather: '<path d="M20 4c-9 0-14.4 5-14.4 12.4L4 20.5l4-1.8C15.2 18.7 20 13 20 4Z"/><path d="M8.5 15.5 15 9"/>',
  shield: '<path d="M12 3 4.5 5.8v5.7c0 4.6 3.2 8 7.5 9.7 4.3-1.700 7.5-5.100 7.500-9.700V5.800Z"/>',
  kettle: '<path d="M8.5 8.500V7a3.500 3.500 0 0 1 7 0v1.500"/><path d="M6.700 9.600C4.600 11.400 4 13.500 4 15.500A5.500 5.500 0 0 0 9.500 21h5A5.500 5.500 0 0 0 20 15.500c0-2-.6-4.100-2.700-5.900Z" fill="currentColor" fill-opacity=".18"/>',
  tip: '<path d="M9.500 21h5M10 17.500h4M12 3a6 6 0 0 0-3.600 10.800c.7.600 1.100 1.400 1.100 2.200h5c0-.8.400-1.600 1.100-2.200A6 6 0 0 0 12 3Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 7.700h.01"/>',
  steer: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M3.4 10.6 9.5 11.3M20.6 10.6 14.5 11.3M12 14.6V20.8"/>',
  vibrate: '<rect x="8" y="3.5" width="8" height="17" rx="2.2"/><path d="M4.4 8.5v7M19.6 8.5v7M1.8 10.5v3M22.2 10.5v3"/>',
  hand: '<path d="M8 12.5V6.4a1.6 1.6 0 0 1 3.2 0V11M11.2 10.5V4.6a1.6 1.6 0 0 1 3.2 0v5.9M14.4 10.5V5.8a1.6 1.6 0 0 1 3.2 0V13M17.6 9.8a1.6 1.6 0 0 1 3.200 0v5.200a6.200 6.200 0 0 1-6.200 6.200h-1.100a6.200 6.200 0 0 1-4.800-2.300L4.300 14.700a1.700 1.700 0 0 1 2.600-2.100L8 14"/>',
  pause: '<path d="M8.4 5.600v12.800M15.600 5.600v12.800" stroke-width="4.200"/>',
  rotate: '<path d="M4.500 12a7.500 7.500 0 0 1 12.800-5.300M19.500 12a7.500 7.500 0 0 1-12.800 5.300"/><path d="M17.800 3v4h-4M6.200 21v-4h4"/>',
};

/** Stroke glyph (24x24, currentColor). */
export function uiIcon(name, cls = '') {
  const body = UI_GLYPHS[name];
  if (!body) return '';
  return `<svg class="ico glyph ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// ------------------------------------------------------------------------------------------------
// weight class badges
// ------------------------------------------------------------------------------------------------
export const WEIGHT_META = {
  light: { label: 'LIGHT', icon: 'feather', color: '#7fe3ff' },
  medium: { label: 'MEDIUM', icon: 'shield', color: '#ffd23f' },
  heavy: { label: 'HEAVY', icon: 'kettle', color: '#ff7a5c' },
};

// ------------------------------------------------------------------------------------------------
// trophies (100x120)
// ------------------------------------------------------------------------------------------------
const TROPHY_META = {
  gold: { grad: 'kb-tro-gold', label: 'GOLD', glow: '#ffd23f' },
  silver: { grad: 'kb-tro-silver', label: 'SILVER', glow: '#dfe8f5' },
  bronze: { grad: 'kb-tro-bronze', label: 'BRONZE', glow: '#ff9d4a' },
};

/** Trophy artwork for a tier: 'gold' | 'silver' | 'bronze' | 'participation'. */
export function trophySvg(tier, cls = '') {
  if (tier === 'participation') {
    return `<svg class="ico trophy ${cls}" viewBox="0 0 100 120" aria-hidden="true">
      <path d="M32 62 18 112l18-9 8 14 8-46Z" fill="url(#kb-ribbon-b)" ${S(4.5)}/>
      <path d="M68 62 82 112l-18-9-8 14-8-46Z" fill="url(#kb-ribbon-a)" ${S(4.5)}/>
      ${Array.from({ length: 16 }, (_, i) => `<circle cx="${(50 + Math.cos((i / 16) * Math.PI * 2) * 34).toFixed(1)}" cy="${(46 + Math.sin((i / 16) * Math.PI * 2) * 34).toFixed(1)}" r="10" fill="#ffc400" ${S(4)}/>`).join('')}
      <circle cx="50" cy="46" r="31" fill="url(#kb-gold)" ${S(5)}/>
      <circle cx="50" cy="46" r="22" fill="#ffe45c" ${S(3.5)}/>
      <path d="${starPath(50, 47, 14, 6.4)}" fill="#ff8a00" ${S(3)}/>
      <ellipse cx="40" cy="30" rx="10" ry="5" fill="#fff" opacity=".6" transform="rotate(-30 40 30)"/>
    </svg>`;
  }
  const m = TROPHY_META[tier] || TROPHY_META.gold;
  const g = `url(#${m.grad})`;
  return `<svg class="ico trophy ${cls}" viewBox="0 0 100 120" aria-hidden="true">
    <path d="M22 22C6 20 2 36 12 48c6 8 14 10 22 10" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>
    <path d="M22 22C6 20 2 36 12 48c6 8 14 10 22 10" fill="none" stroke="${g}" stroke-width="7" stroke-linecap="round"/>
    <path d="M78 22c16-2 20 14 10 26-6 8-14 10-22 10" fill="none" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>
    <path d="M78 22c16-2 20 14 10 26-6 8-14 10-22 10" fill="none" stroke="${g}" stroke-width="7" stroke-linecap="round"/>
    <path d="M20 10h60v26c0 22-14 36-30 36S20 58 20 36Z" fill="${g}" ${S(5.5)}/>
    <path d="M28 16v20c0 14 5 24 13 30" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>
    <path d="M20 10h60" stroke="#fff" stroke-width="3" opacity=".5"/>
    <path d="${starPath(50, 38, 15, 6.8)}" fill="#fff" fill-opacity=".92" ${S(3.2)}/>
    <path d="M42 70h16l4 16H38Z" fill="${g}" ${S(5)}/>
    <ellipse cx="50" cy="88" rx="17" ry="4.5" fill="${g}" ${S(4.5)}/>
    <rect x="26" y="90" width="48" height="24" rx="6" fill="url(#kb-tro-base)" ${S(5.5)}/>
    <rect x="34" y="97" width="32" height="10" rx="3" fill="${g}" opacity=".95"/>
    <path d="M30 94h40" stroke="#fff" stroke-width="2.4" opacity=".3" stroke-linecap="round"/>
  </svg>`;
}

// ------------------------------------------------------------------------------------------------
// input glyphs (HTML) — keyboard caps & gamepad buttons for the hint bar
// ------------------------------------------------------------------------------------------------
const KEY_LABELS = {
  Enter: 'Enter', Escape: 'Esc', Backspace: '⌫', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', NumpadEnter: 'Enter', Slash: '/', Period: '.', Comma: ',',
  KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyE: 'E', KeyK: 'K', KeyQ: 'Q', KeyC: 'C', KeyP: 'P',
};

/** Display label for a KeyboardEvent.code ('ShiftRight' → 'Shift'). */
export const keyLabel = (code) => KEY_LABELS[code] ?? code.replace(/^Key/, '');

/** Keyboard key cap glyph (HTML string). `k` is a KeyboardEvent.code or a literal label. */
export function keyCap(k, cls = '') {
  const label = KEY_LABELS[k] ?? k;
  const wide = label.length > 2 ? ' key--wide' : '';
  return `<span class="key${wide} ${cls}">${esc(label)}</span>`;
}

/** Gamepad face button glyph. name: 'A'|'B'|'X'|'Y'|'LB'|'RB'|'LT'|'RT'|'START'|'DPAD'|'STICK' */
export function padBtn(name, cls = '') {
  switch (name) {
    case 'A': case 'B': case 'X': case 'Y':
      return `<span class="pbtn pbtn--${name.toLowerCase()} ${cls}">${name}</span>`;
    case 'LB': case 'RB': case 'LT': case 'RT':
      return `<span class="pbump ${cls}">${name}</span>`;
    case 'START':
      return `<span class="pbump pbump--start ${cls}">☰</span>`;
    case 'DPAD':
      return `<span class="dpad ${cls}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7Z" fill="currentColor" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></svg></span>`;
    case 'STICK':
      return `<span class="dpad dpad--stick ${cls}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.4" fill="#7b83b0" stroke="${INK}" stroke-width="1.6"/><circle cx="12" cy="12" r="6.6" fill="#eef1ff" stroke="${INK}" stroke-width="1.4"/><ellipse cx="10.4" cy="10" rx="2.4" ry="1.5" fill="#fff" opacity=".9"/></svg></span>`;
    default:
      return `<span class="pbump ${cls}">${esc(name)}</span>`;
  }
}

/**
 * Glyph markup for a logical UI action on the given device.
 * actions: 'confirm' | 'back' | 'nav' | 'navH' | 'navV' | 'pause' | 'skip' | 'tab'
 */
export function actionGlyph(action, device = 'keyboard') {
  const pad = device === 'gamepad';
  if (device === 'kb1' || device === 'kb2') {
    // split-screen keyboard halves (WASD side / arrows side)
    const one = device === 'kb1';
    switch (action) {
      case 'confirm': case 'skip': return one ? `${keyCap('Space')}` : keyCap('Enter');
      case 'back': case 'backAlt': return one ? keyCap('Q') : keyCap('Backspace');
      case 'nav': return one ? `${keyCap('W')}${keyCap('A')}${keyCap('S')}${keyCap('D')}` : `${keyCap('ArrowUp')}${keyCap('ArrowDown')}${keyCap('ArrowLeft')}${keyCap('ArrowRight')}`;
      case 'navH': return one ? `${keyCap('A')}${keyCap('D')}` : `${keyCap('ArrowLeft')}${keyCap('ArrowRight')}`;
      case 'navV': return one ? `${keyCap('W')}${keyCap('S')}` : `${keyCap('ArrowUp')}${keyCap('ArrowDown')}`;
      case 'pause': return keyCap('Escape');
      default: return '';
    }
  }
  switch (action) {
    case 'confirm': return pad ? padBtn('A') : keyCap('Enter');
    case 'back': return pad ? padBtn('B') : keyCap('Escape');
    case 'backAlt': return pad ? padBtn('B') : keyCap('Backspace');
    case 'nav': return pad ? padBtn('DPAD') : `${keyCap('ArrowUp')}${keyCap('ArrowDown')}${keyCap('ArrowLeft')}${keyCap('ArrowRight')}`;
    case 'navH': return pad ? padBtn('DPAD') : `${keyCap('ArrowLeft')}${keyCap('ArrowRight')}`;
    case 'navV': return pad ? padBtn('DPAD') : `${keyCap('ArrowUp')}${keyCap('ArrowDown')}`;
    case 'pause': return pad ? padBtn('START') : keyCap('Escape');
    case 'skip': return pad ? padBtn('A') : keyCap('Enter');
    default: return '';
  }
}

/** Small colored flag/finish checker pattern as an SVG string (for banners). */
export function checkerSvg(cls = '') {
  let cells = '';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 12; x++) if ((x + y) % 2 === 0) cells += `<rect x="${x * 5}" y="${y * 5}" width="5" height="5"/>`;
  return `<svg class="checker ${cls}" viewBox="0 0 60 20" preserveAspectRatio="none" aria-hidden="true"><g fill="#fff">${cells}</g></svg>`;
}

/** The lightning bolt used by the logo (viewBox 0 0 100 140). */
export const LOGO_BOLT = `<svg class="logo-bolt" viewBox="0 0 100 140" aria-hidden="true">
  <path d="M68 4 14 78h30L28 136 90 52H58Z" fill="${INK}" stroke="${INK}" stroke-width="16" stroke-linejoin="round"/>
  <path d="M68 4 14 78h30L28 136 90 52H58Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>
  <path d="M68 4 14 78h30L28 136 90 52H58Z" fill="url(#kb-bolt-logo)" stroke="none"/>
  <path d="M62 18 30 70" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".9"/>
  <defs><linearGradient id="kb-bolt-logo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5cf0ff"/><stop offset="1" stop-color="#1c7bff"/></linearGradient></defs>
</svg>`;
