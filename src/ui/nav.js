/**
 * Focus navigation for menu screens: vertical lists, grids, and rows, driven by
 * `game.input.pressed()` actions (routed in by UIManager) plus mouse hover / click.
 * OWNER: Presentation.
 *
 * Item shape: { el, onSelect?(item), onFocus?(item), onAdjust?(dir) => bool, disabled?, data? }
 */
import { EVT } from '../core/events.js';

export class Nav {
  /**
   * @param {object} ui UIManager (for events)
   * @param {{ layout?: 'list'|'grid'|'row', cols?: number, wrap?: boolean, onChange?: Function }} [opts]
   */
  constructor(ui, { layout = 'list', cols = 1, wrap = true, onChange = null } = {}) {
    this.ui = ui;
    this.layout = layout;
    this.cols = layout === 'row' ? 9999 : layout === 'grid' ? cols : 1;
    this.wrap = wrap;
    this.onChange = onChange;
    /** @type {Array<{el: HTMLElement, onSelect?: Function, onFocus?: Function, onAdjust?: Function, disabled?: boolean}>} */
    this.items = [];
    this.index = -1;
    this._offs = [];
    this.pointerEnabled = true;
    this._lastPointer = { x: -1, y: -1 };
  }

  get item() {
    return this.items[this.index] ?? null;
  }

  /** Replace the focusable items and focus `index` (silently). */
  setItems(items, index = 0) {
    this._unbind();
    this.items = items;
    this.index = -1;
    items.forEach((it, i) => this._bind(it, i));
    if (items.length) this.focus(this._firstEnabled(index), { silent: true, force: true });
  }

  _bind(item, i) {
    const el = item.el;
    if (!el) return;
    const move = (e) => {
      if (!this.pointerEnabled || item.disabled) return;
      // only react to real pointer motion (layout shifts under a still cursor must not steal focus)
      const lp = this._lastPointer;
      if (Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) < 2) return;
      lp.x = e.clientX;
      lp.y = e.clientY;
      const idx = this.items.indexOf(item);
      if (idx !== this.index) this.focus(idx, { pointer: true });
    };
    const click = (e) => {
      if (item.disabled) return;
      const idx = this.items.indexOf(item);
      if (idx !== this.index) this.focus(idx, { silent: true });
      if (item.onClick) item.onClick(e, item);
      else this.activate();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', move);
    el.addEventListener('click', click);
    this._offs.push(() => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerdown', move);
      el.removeEventListener('click', click);
    });
  }

  _unbind() {
    for (const off of this._offs) off();
    this._offs = [];
    for (const it of this.items) it.el?.classList.remove('is-focus');
  }

  destroy() {
    this._unbind();
    this.items = [];
    this.index = -1;
  }

  _firstEnabled(from = 0) {
    const n = this.items.length;
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      if (!this.items[i].disabled) return i;
    }
    return 0;
  }

  /** Focus item `i`. Emits UI_NAV unless `silent`. */
  focus(i, { silent = false, pointer = false, force = false } = {}) {
    if (i < 0 || i >= this.items.length) return;
    if (i === this.index && !force) return;
    const prev = this.item;
    prev?.el?.classList.remove('is-focus');
    this.index = i;
    const it = this.items[i];
    it.el?.classList.add('is-focus');
    if (!silent) this.ui.game.events.emit(EVT.UI_NAV, {});
    it.onFocus?.(it, { pointer, silent });
    this.onChange?.(it, i, { pointer, silent });
  }

  /** Handle a logical action. Returns true when consumed. */
  action(name) {
    const it = this.item;
    switch (name) {
      case 'confirm':
        if (!it || it.disabled) return false;
        this.activate();
        return true;
      case 'left':
      case 'right': {
        const dir = name === 'left' ? -1 : 1;
        if (it?.onAdjust?.(dir)) return true;
        if (this.layout === 'list') return false;
        return this.move(name);
      }
      case 'up':
      case 'down':
        if (this.layout === 'row') return false;
        return this.move(name);
      default:
        return false;
    }
  }

  activate() {
    const it = this.item;
    if (!it || it.disabled) return;
    this.ui.game.events.emit(EVT.UI_CONFIRM, {});
    const el = it.el;
    if (el) {
      el.classList.remove('is-press');
      void el.offsetWidth; // eslint-disable-line no-unused-expressions
      el.classList.add('is-press');
      setTimeout(() => el.classList.remove('is-press'), 360);
    }
    it.onSelect?.(it);
  }

  move(dir) {
    const n = this.items.length;
    if (n < 2) return false;
    let i = this.index;
    for (let guard = 0; guard < n; guard++) {
      i = this._step(i, dir);
      if (i < 0) return false;
      if (!this.items[i].disabled) break;
    }
    if (i === this.index) return false;
    this.focus(i);
    return true;
  }

  _step(i, dir) {
    const n = this.items.length;
    const cols = Math.min(this.cols, n);
    if (this.layout === 'list') {
      const d = dir === 'up' || dir === 'left' ? -1 : 1;
      const j = i + d;
      if (j < 0 || j >= n) return this.wrap ? (j + n) % n : -1;
      return j;
    }
    if (this.layout === 'row') {
      const d = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      if (!d) return -1;
      const j = i + d;
      if (j < 0 || j >= n) return this.wrap ? (j + n) % n : -1;
      return j;
    }
    // grid
    const rows = Math.ceil(n / cols);
    let r = Math.floor(i / cols), c = i % cols;
    const rowLen = (rr) => Math.min(cols, n - rr * cols);
    if (dir === 'left' || dir === 'right') {
      c += dir === 'left' ? -1 : 1;
      const len = rowLen(r);
      if (c < 0 || c >= len) {
        if (!this.wrap) return -1;
        c = (c + len) % len;
      }
    } else {
      r += dir === 'up' ? -1 : 1;
      if (r < 0 || r >= rows) {
        if (!this.wrap) return -1;
        r = (r + rows) % rows;
      }
      c = Math.min(c, rowLen(r) - 1);
    }
    return r * cols + c;
  }
}
