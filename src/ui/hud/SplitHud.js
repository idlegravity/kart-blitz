/**
 * Split-screen HUD (2-4 humans). OWNER: UI. Used by Hud.js when `views.length > 1`; the single-player HUD is untouched.
 *
 * One ViewHud per view, laid out inside `view.rect` (a miniature of the 1P HUD: item slot, lap + time, place, player tag,
 * countdown / FINAL LAP / FINISH / WRONG WAY banners and toasts, each with its own font-size so em-based CSS scales),
 * plus the shared pieces: thick ink dividers, the track minimap (2P: right edge straddling the divider, 4P: centre,
 * 3P: a big map + live standings "overview" panel in the free bottom-right quadrant) and one intro banner.
 */
import { EVT } from '../../core/events.js';
import { ordinal, formatTime } from '../../core/math.js';
import { placeGradient } from '../placeStyle.js';
import { h, setText, pop } from '../dom.js';
import { uiIcon, checkerSvg } from '../icons.js';
import { boxUnit, pxRect, playerColor, playerTag } from '../split.js';
import { ItemSlot } from './ItemSlot.js';
import { Minimap } from './Minimap.js';
import { Banners } from './Banners.js';

/** Per-view HUD scale relative to a full-screen HUD in the same 16:9 box. */
const VIEW_K = { h2: 1.2, quad: 1.2 };
const OVERVIEW_ROW = 5.9; // em between standings rows in the overview panel (kept in sync with CSS)

/** One human's HUD, positioned over their viewport. */
class ViewHud {
  constructor(split, view, i, side) {
    this.split = split;
    this.hud = split.hud;
    this.ui = split.ui;
    this.game = split.game;
    this.view = view;
    this.kart = view.kart;
    this.index = view.index ?? i;
    this.side = side;
    this.rouletteDuration = 1.8;
    this._lap = -1;
    this._place = -1;

    this.item = new ItemSlot(this);
    this.item.reset();

    this.lapN = h('span.hl__n', '1');
    this.lapOf = h('span.hl__of', `/${split.laps}`);
    this.timeEl = h('div.hl__time', '0:00.000');
    this.lapBox = h('div.hl__lap', h('span.hl__lbl', 'LAP'), this.lapN, this.lapOf);
    this.lapEl = h('div.hud-lap', this.lapBox, this.timeEl);

    this.placeNum = h('span.hp__num.fx', { 'data-text': '8' }, '8');
    this.placeSuf = h('span.hp__suf.fx', { 'data-text': 'th' }, 'th');
    this.placeDelta = h('div.hp__delta');
    this.placeRow = h('div.hp__row', this.placeNum, this.placeSuf);
    this.placeEl = h('div.hud-place', this.placeDelta, this.placeRow);

    this.tag = h('div.vh__tag', h('span', playerTag(this.index)));
    this.banners = new Banners(this);
    this.el = h('div.vh', { dataset: { side, index: String(this.index) }, style: { '--pc': view.color ?? playerColor(this.index) } },
      this.item.el, this.lapEl, this.placeEl, this.tag, this.banners.el);
  }

  place() {
    const r = this.view.rect;
    const s = this.el.style;
    s.left = `${(r.x * 100).toFixed(3)}%`;
    s.top = `${(r.y * 100).toFixed(3)}%`;
    s.width = `${(r.w * 100).toFixed(3)}%`;
    s.height = `${(r.h * 100).toFixed(3)}%`;
  }

  setUnit(px) {
    this.el.style.fontSize = `${px.toFixed(3)}px`;
  }

  update(dt) {
    const g = this.game, p = this.kart, r = g.race;
    if (!p) return;
    const lap = Math.min(p.lap, r.laps);
    if (lap !== this._lap) {
      this._lap = lap;
      setText(this.lapN, lap);
      this.lapOf.textContent = `/${r.laps}`;
      this.lapEl.classList.toggle('is-final', r.laps > 1 && lap >= r.laps);
    }
    setText(this.timeEl, formatTime(p.finished ? p.finishTime : r.time));
    if (p.place !== this._place) {
      this._place = p.place;
      const n = String(p.place);
      const suf = ordinal(p.place).slice(n.length);
      this.placeNum.textContent = n;
      this.placeNum.dataset.text = n;
      this.placeSuf.textContent = suf;
      this.placeSuf.dataset.text = suf;
      this.placeEl.style.setProperty('--g', placeGradient(p.place));
    }
    this.item.update(g.paused ? 0 : dt, p);
    this.banners.update(dt);
  }

  placeChange(place, prev) {
    const up = place < prev;
    this.placeDelta.innerHTML = uiIcon(up ? 'arrowUp' : 'arrowDown');
    this.placeDelta.className = `hp__delta ${up ? 'is-up' : 'is-down'}`;
    this.placeDelta.getAnimations().forEach((a) => a.cancel());
    this.placeDelta.animate([{ opacity: 0, transform: 'translateY(.8em) scale(.6)' }, { opacity: 1, transform: 'none', offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0, transform: `translateY(${up ? '-' : ''}.8em)` }], { duration: 1500, fill: 'forwards' });
    pop(this.placeRow, { from: 1.4, duration: 520 });
  }
}

/** Forwards the Hud-level banner calls (countdown / intro / waiting...) to the right banner sets. */
class BannerGroup {
  constructor(split) {
    this.split = split;
    this.global = new Banners(split);
  }

  get all() {
    return this.split.views.map((v) => v.banners);
  }

  countdown(c) { this.all.forEach((b) => b.countdown(c)); }
  showIntro(...a) { this.global.showIntro(...a); }
  hideIntro() { this.global.hideIntro(); }
  setWaiting(on) { this.all.forEach((b) => b.setWaiting(on)); }
  wrongWay(on) { this.all.forEach((b) => b.wrongWay(on)); }
  clearWarn() { this.all.forEach((b) => b.clearWarn()); }
  update(dt) { this.global.update(dt); this.all.forEach((b) => b.update(dt)); }
  clear() { this.global.clear(); this.all.forEach((b) => b.clear()); }
}

export class SplitHud {
  /** @param {import('./Hud.js').Hud} hud */
  constructor(hud) {
    this.hud = hud;
    this.ui = hud.ui;
    this.game = hud.game;
    this.views = [];
    this.layout = 'h2';
    this.map = null;
    this.overview = null;
    this.dividers = null;
    this.banners = null;
    this._size = '';
    this.laps = 3;
  }

  setup(ctx, views, layout, overviewRect) {
    this.teardown();
    const g = this.game, hud = this.hud;
    this.layout = layout || (views.length === 2 ? 'h2' : 'quad');
    this.laps = ctx.config?.laps ?? ctx.track?.laps ?? 3;
    const track = ctx.track;
    const humans = views.map((v) => ({ kart: v.kart, color: v.color ?? playerColor(v.index), tag: playerTag(v.index) }));
    this.humans = humans;
    this.root = hud.root;

    this.views = views.map((v, i) => {
      // outer side: left column on the left, right column on the right (2P: both left, the map sits on the right edge)
      const right = this.layout === 'quad' && v.rect.x > 0.25;
      return new ViewHud(this, v, i, right ? 'right' : 'left');
    });
    this.views.forEach((v) => v.place());

    // shared minimap / overview
    const mini = (cls, opts) => {
      const m = new Minimap(this, opts);
      m.el.classList.add(cls);
      m.setup(track, ctx.karts, humans);
      return m;
    };
    this.map = null;
    this.overview = null;
    if (this.layout === 'h2') this.map = mini('hud-map--h2', { labels: false });
    else if (views.length >= 4) this.map = mini('hud-map--quad', { labels: false });
    else {
      this.overview = this._buildOverview(ctx, overviewRect ?? g.overviewRect ?? { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, mini);
    }

    this.banners = new BannerGroup(this);
    hud.banners = this.banners;
    this.root.textContent = '';
    this._buildDividers();
    // z-order: view HUDs < dividers < minimap / overview / intro banner
    this.root.append(...this.views.map((v) => v.el), this.dividers, this.banners.global.el);
    if (this.map) this.root.append(this.map.el);
    if (this.overview) this.root.append(this.overview.el);
    this._fit(true);
    this._bind();
    this.map?._prepare?.();
    this.overview?.map._prepare?.();
  }

  // ------------------------------------------------------------------------------------------------
  _buildOverview(ctx, rect, mini) {
    const map = mini('ov__map', { labels: true });
    const rows = ctx.karts.map((k) => {
      const img = h('img', { alt: '', draggable: 'false' });
      img.src = this.ui.portrait(k.character.id, 128);
      const hi = this.humans.findIndex((x) => x.kart === k);
      const tag = hi >= 0 ? h('span.ov__ptag', { style: { '--pc': this.humans[hi].color } }, this.humans[hi].tag) : null;
      const rank = h('span.ov__rank', String(k.place));
      const el = h(`div.ov__row${hi >= 0 ? '.is-human' : ''}`, { style: { '--c': k.character.colors.primary, '--r': Math.max(0, k.place - 1), '--pc': hi >= 0 ? this.humans[hi].color : 'transparent' }, dataset: { rank: k.place <= 3 ? String(k.place) : '' } },
        h('div.ov__in', rank, h('span.ov__port', img), h('span.ov__name', k.character.name), tag, h('span.ov__flag', { html: checkerSvg() })));
      return { kart: k, el, rank, place: k.place };
    });
    const list = h('div.ov__list', { style: { '--n': ctx.karts.length } }, rows.map((r) => r.el));
    const el = h('div.ov', h('div.ov__panel', map.el, list));
    return { el, map, rows, rect };
  }

  _buildDividers() {
    const el = h('div.hud-dividers', { dataset: { layout: this.layout } }, h('i.hd-h'), this.layout === 'quad' ? h('i.hd-v') : null);
    this.dividers = el;
  }

  /** (Re)compute per-view font sizes and the overview box from the window size. */
  _fit(force = false) {
    const W = window.innerWidth, H = window.innerHeight;
    const key = `${W}x${H}`;
    if (!force && key === this._size) return;
    this._size = key;
    const k = VIEW_K[this.layout] ?? 0.9;
    for (const v of this.views) {
      const r = pxRect(v.view.rect, W, H);
      v.setUnit(boxUnit(r.w, r.h) * k);
    }
    const ov = this.overview;
    if (ov) {
      const r = pxRect(ov.rect, W, H);
      const s = ov.el.style;
      s.left = `${ov.rect.x * 100}%`;
      s.top = `${ov.rect.y * 100}%`;
      s.width = `${ov.rect.w * 100}%`;
      s.height = `${ov.rect.h * 100}%`;
      s.fontSize = `${boxUnit(r.w, r.h).toFixed(3)}px`;
      ov.map._sizeKey = '';
    }
    if (this.map) this.map._sizeKey = '';
  }

  // ------------------------------------------------------------------------------------------------
  _bind() {
    const g = this.game, ev = g.events, hud = this.hud;
    const on = (name, fn) => hud.offs.push(ev.on(name, fn));
    const viewOf = (kart) => this.views.find((v) => v.kart === kart);
    on(EVT.RACE_PHASE, ({ phase }) => hud._applyPhase(phase));
    on(EVT.RACE_COUNTDOWN, ({ count }) => this.banners.countdown(count));
    on(EVT.RACE_LAP, ({ kart, lap, laps, lapTime, isFinalLap }) => {
      const v = viewOf(kart);
      if (!v) return;
      v.bestLap = Math.min(v.bestLap ?? Infinity, lapTime);
      const best = lapTime <= v.bestLap && lap > 2;
      v.banners.toast(`LAP ${lap - 1} • ${formatTime(lapTime)}`, { kind: best ? 'best' : 'info', icon: 'flag', ms: 2600, sub: best ? 'BEST LAP' : '' });
      if (isFinalLap) v.banners.finalLap();
      else if (laps > 1) pop(v.lapBox, { from: 1.35, duration: 500 });
    });
    on(EVT.RACE_FINISH, ({ kart, place }) => {
      const v = viewOf(kart);
      if (v) v.banners.finish(place);
      const row = this.overview?.rows.find((r) => r.kart === kart);
      if (row) row.el.classList.add('is-done');
    });
    on(EVT.RACE_PLACE, ({ kart, place, prev }) => {
      const v = viewOf(kart);
      if (v && g.race.hasStarted && prev > 0) v.placeChange(place, prev);
    });
    on(EVT.RACE_WRONG_WAY, ({ kart, wrongWay }) => viewOf(kart)?.banners.wrongWay(wrongWay));
    on(EVT.ITEM_ROULETTE, ({ kart, duration }) => {
      const v = viewOf(kart);
      if (v) v.rouletteDuration = duration || 1.8;
    });
    on(EVT.KART_BOOST, ({ kart, source }) => {
      if (source === 'rocketstart') viewOf(kart)?.banners.toast('ROCKET START!', { kind: 'good', icon: 'rocket', ms: 1800 });
    });
    on(EVT.KART_STALL, ({ kart }) => viewOf(kart)?.banners.toast('TOO EARLY!', { kind: 'warn', icon: 'warn', ms: 1600 }));
    on(EVT.KART_TRICK, ({ kart }) => viewOf(kart)?.banners.toast('TRICK!', { kind: 'good', icon: 'star', ms: 1300 }));
    on(EVT.ITEM_COMET_WARN, ({ target }) => viewOf(target)?.banners.warn('COMET INCOMING!', 3600));
    const clearComet = ({ item }) => item === 'comet' && this.views.forEach((v) => v.banners.clearWarn());
    on(EVT.ITEM_EXPLODE, clearComet);
    on(EVT.ITEM_DESTROY, clearComet);
    on(EVT.ITEM_HIT, ({ item, kart }) => {
      if (item === 'comet') this.views.forEach((v) => v.banners.clearWarn());
      if (item === 'banana') viewOf(kart)?.banners.toast('SLIPPED!', { kind: 'warn', ms: 1100 });
    });
  }

  teardown() {
    this.dividers?.remove();
    this.dividers = null;
    this.banners?.clear();
    this.views = [];
    this.map = null;
    this.overview = null;
    this.banners = null;
  }

  // ------------------------------------------------------------------------------------------------
  update(dt) {
    this._fit();
    for (const v of this.views) v.update(dt);
    this.banners?.global.update(dt);
    this.map?.update(dt);
    const ov = this.overview;
    if (ov) {
      ov.map.update(dt);
      let dirty = false;
      for (const r of ov.rows) if (r.kart.place !== r.place) dirty = true;
      if (dirty) {
        for (const r of ov.rows) {
          const pl = r.kart.place;
          if (pl === r.place) continue;
          r.place = pl;
          r.rank.textContent = String(pl);
          r.el.style.setProperty('--r', Math.max(0, pl - 1));
          r.el.dataset.rank = pl <= 3 ? String(pl) : '';
        }
      }
    }
  }
}

export { OVERVIEW_ROW };
