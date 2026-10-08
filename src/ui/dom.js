/**
 * Tiny DOM helpers shared by every UI module.
 * OWNER: Presentation.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Hyperscript-style element factory.
 *   h('div.card.big#id', { style: {...}, dataset: {...}, onclick }, child, [children], 'text')
 * `class`/`className` strings are appended to the selector classes. Props starting with `on` become listeners.
 * @param {string} sel
 * @param {object|Node|string|Array|null} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(sel, props, ...children) {
  const m = /^([a-z][a-z0-9-]*)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  const rest = m[2] || '';
  const re = /([.#])([\w-]+)/g;
  let mm;
  while ((mm = re.exec(rest))) {
    if (mm[1] === '.') el.classList.add(mm[2]);
    else el.id = mm[2];
  }
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText += v;
        else for (const sk in v) (sk.startsWith('--') ? el.style.setProperty(sk, v[sk]) : (el.style[sk] = v[sk]));
      } else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

/** Append strings / nodes / nested arrays to `el`. */
export function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

/** Create an element from an HTML/SVG markup string (first element). */
export function fromHTML(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/** Create an SVG element with attributes. */
export function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
  append(el, children);
  return el;
}

/** Set text only when it changed (avoids needless layout/paint). Returns true if changed. */
export function setText(el, text) {
  text = String(text);
  if (el.__txt === text) return false;
  el.__txt = text;
  el.textContent = text;
  return true;
}

/** Toggle a class only when its state changes. */
export function setClass(el, cls, on) {
  if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
}

/** Set a style property only when the value changed. */
export function setStyle(el, prop, value) {
  const c = el.__st || (el.__st = {});
  if (c[prop] === value) return;
  c[prop] = value;
  if (prop.startsWith('--')) el.style.setProperty(prop, value);
  else el.style[prop] = value;
}

/** Remove every child. */
export function empty(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

/** Web-Animations "pop" (scale bounce) that is safe to spam. Transform/opacity only. */
export function pop(el, { from = 1.35, to = 1, duration = 420, easing = 'cubic-bezier(.34,1.56,.64,1)' } = {}) {
  if (!el || !el.animate) return null;
  return el.animate([{ transform: `scale(${from})` }, { transform: `scale(${to})` }], { duration, easing });
}

/** Restart a CSS animation class on an element. */
export function retrigger(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // eslint-disable-line no-unused-expressions
  el.classList.add(cls);
}

/** Ease helpers for JS-driven counters. */
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Escape text for HTML interpolation. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Format a time delta like +0.532 / -1.204. */
export function formatDelta(d) {
  const sign = d < 0 ? '-' : '+';
  return `${sign}${Math.abs(d).toFixed(3)}`;
}
