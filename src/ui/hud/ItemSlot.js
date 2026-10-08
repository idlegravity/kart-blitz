/**
 * HUD item slot (top-left): glossy bubble, roulette animation, count pips for triples, and a draining ring
 * for timed items (golden nitro) and star power. Icons are stacked and toggled with opacity/transform only.
 */
import { h, pop } from '../dom.js';
import { itemIcon, ITEM_ICON_IDS, ITEM_ICON_VARIANTS, itemIconFor } from '../icons.js';
import { ITEMS } from '../../data/items.js';

const RING_LEN = 2 * Math.PI * 46;
const ROULETTE_DEFAULT = 1.8;

export class ItemSlot {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this.icons = new Map();
    this.shown = null;
    this.rolling = false;
    this.rollClock = 0;
    this.rollIdx = 0;
    this.rollDur = ROULETTE_DEFAULT;
    this.rollOrder = [];
    this.count = 0;
    this.ringMax = 0;
    this.ringLast = 0;
    this._pipShown = -1;

    const iconEls = ITEM_ICON_VARIANTS.map((id) => {
      const el = h('div.hi__ico', { html: itemIcon(id) });
      this.icons.set(id, el);
      return el;
    });
    this.ring = h('div.hi__ring', {
      html: `<svg viewBox="0 0 100 100"><circle class="hi__ring-bg" cx="50" cy="50" r="46"/><circle class="hi__ring-fg" cx="50" cy="50" r="46" stroke-dasharray="${RING_LEN.toFixed(1)}" stroke-dashoffset="0" transform="rotate(-90 50 50)"/></svg>`,
    });
    this.ringFg = this.ring.querySelector('.hi__ring-fg');
    this.glow = h('div.hi__glow');
    this.bubble = h('div.hi__bubble', this.glow, h('div.hi__q', '?'), h('div.hi__icons', iconEls), h('div.hi__gloss'));
    this.pips = h('div.hi__pips', h('i'), h('i'), h('i'));
    this.el = h('div.hud-item', this.ring, this.bubble, this.pips);
  }

  /** Reset for a new race. */
  reset() {
    this.shown = null;
    this.rolling = false;
    this.count = 0;
    this.ringMax = 0;
    this._pipShown = -1;
    for (const el of this.icons.values()) el.classList.remove('is-on');
    this.el.classList.remove('has-item', 'is-rolling', 'has-ring');
    this.el.style.removeProperty('--ic');
    this.pips.classList.remove('is-on');
  }

  startRoulette(duration) {
    this.rolling = true;
    this.rollDur = duration > 0 ? duration : ROULETTE_DEFAULT;
    this.rollClock = 0;
    // shuffled cycle order (skip icons that aren't real pickups)
    const ids = ITEM_ICON_IDS.slice();
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.rollOrder = ids;
    this.rollIdx = 0;
    this.el.classList.add('is-rolling', 'has-item');
    this.pips.classList.remove('is-on');
    this._setIcon(this.rollOrder[0], false);
    pop(this.bubble, { from: 1.12, duration: 260 });
  }

  _setIcon(id, animate) {
    if (this.shown === id) return;
    const prev = this.icons.get(this.shown);
    if (prev) prev.classList.remove('is-on');
    this.shown = id;
    const el = id ? this.icons.get(id) : null;
    if (el) {
      el.classList.add('is-on');
      if (animate) pop(el, { from: 1.5, duration: 420 });
    }
    const item = id ? ITEMS[id] ?? ITEMS[id.replace(/2$/, '3')] : null;
    if (item) this.el.style.setProperty('--ic', item.color);
    this.el.classList.toggle('has-item', !!item);
  }

  _land(id) {
    this.rolling = false;
    this.el.classList.remove('is-rolling');
    this.shown = null; // force refresh
    this._setIcon(id, true);
    pop(this.bubble, { from: 1.3, duration: 520 });
    this.el.classList.remove('is-land');
    void this.el.offsetWidth; // eslint-disable-line no-unused-expressions
    this.el.classList.add('is-land');
  }

  update(dt, p) {
    if (!p) return;
    if (p.rouletteTime > 0) {
      if (!this.rolling) this.startRoulette(this.hud.rouletteDuration || ROULETTE_DEFAULT);
      const progress = Math.min(1, 1 - p.rouletteTime / this.rollDur);
      const interval = 0.05 + 0.16 * progress * progress;
      this.rollClock += dt;
      if (this.rollClock >= interval) {
        this.rollClock = 0;
        this.rollIdx = (this.rollIdx + 1) % this.rollOrder.length;
        this._setIcon(this.rollOrder[this.rollIdx], false);
        pop(this.bubble, { from: 1.05, duration: 120, easing: 'ease-out' });
      }
      return;
    }

    if (this.rolling) this._land(itemIconFor(p.item, p.itemCount));
    const want = itemIconFor(p.item, p.itemCount) ?? (p.starTime > 0 ? 'star' : null);
    if (want !== this.shown) this._setIcon(want, true);

    // count pips (triples)
    const count = p.item ? p.itemCount : 0;
    const maxUses = p.item ? ITEMS[p.item]?.uses ?? 1 : 0;
    if (count !== this._pipShown || this._pipMax !== maxUses) {
      this._pipShown = count;
      this._pipMax = maxUses;
      this.pips.classList.toggle('is-on', maxUses > 1);
      [...this.pips.children].forEach((pip, i) => {
        pip.classList.toggle('on', i < count);
        pip.classList.toggle('gone', i >= count);
        pip.style.display = i < maxUses ? '' : 'none';
      });
      if (maxUses > 1) pop(this.pips, { from: 1.2, duration: 260 });
    }

    // ring: goldnitro (itemTime) or star power (starTime)
    const t = p.itemTime > 0 ? p.itemTime : p.starTime > 0 ? p.starTime : 0;
    if (t > 0) {
      if (t > this.ringLast + 0.3 || this.ringMax === 0) this.ringMax = t;
      this.el.classList.add('has-ring');
      this.ringFg.setAttribute('stroke-dashoffset', ((1 - Math.min(1, t / this.ringMax)) * RING_LEN).toFixed(1));
    } else if (this.ringMax > 0) {
      this.ringMax = 0;
      this.el.classList.remove('has-ring');
    }
    this.ringLast = t;
  }
}

