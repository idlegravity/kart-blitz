/**
 * Small reusable UI building blocks shared by several screens. OWNER: Presentation.
 */
import { h } from './dom.js';
import { uiIcon, WEIGHT_META } from './icons.js';

/** Screen heading: optional tag pill + big outlined title. */
export function head(tag, title, { cls = '', variant = 'gold' } = {}) {
  return h(`div.head.a-down${cls ? '.' + cls : ''}`,
    tag ? h('div.pill.pill--tag', tag) : null,
    h(`div.head__title.fx.fx--${variant}`, { 'data-text': title }, title));
}

/** Difficulty flames (filled up to n of max). */
export function flames(n, max = 4) {
  let s = '';
  for (let i = 0; i < max; i++) s += `<span class="flame${i < n ? ' on' : ''}">${uiIcon('flame')}</span>`;
  return `<span class="flames" aria-label="Difficulty ${n} of ${max}">${s}</span>`;
}

/** Weight-class badge (HTML string). */
export function weightBadge(cls) {
  const m = WEIGHT_META[cls] ?? WEIGHT_META.medium;
  return `<span class="wbadge" style="--wc:${m.color}">${uiIcon(m.icon)}<span>${m.label}</span></span>`;
}

/** Segmented stat bar (5 pips). Returns { el, set(v) }. */
export function statBar(label, color) {
  const pips = [];
  for (let i = 0; i < 5; i++) pips.push(h('i', { style: { '--k': i } }));
  const el = h('div.stat', { style: { '--sc': color } }, h('span.stat__l', label), h('span.stat__pips', pips));
  return {
    el,
    set(v) {
      pips.forEach((p, i) => p.classList.toggle('on', i < v));
    },
  };
}

/** Format seconds as m:ss.mmm (for TT records). */
export function fmtTime(t) {
  if (!Number.isFinite(t) || t < 0) return '-:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
