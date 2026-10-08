/**
 * Race HUD: item slot, place indicator, lap counter + timer, minimap, standings column,
 * countdown / intro / FINAL LAP / FINISH / WRONG WAY banners and toasts.
 * OWNER: Presentation. Values are only written to the DOM when they change.
 */
import { EVT } from '../../core/events.js';
import { ordinal, formatTime } from '../../core/math.js';
import { placeGradient } from '../placeStyle.js';
import { h, setText, pop } from '../dom.js';
import { uiIcon, checkerSvg } from '../icons.js';
import { ItemSlot } from './ItemSlot.js';
import { Minimap } from './Minimap.js';
import { Banners } from './Banners.js';
import { RaceManager } from '../../race/RaceManager.js';

export class Hud {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.root = h('div.hud.is-hidden');
    ui.layers.hud.appendChild(this.root);
    this.ctx = null;
    this.offs = [];
    this.visible = false;
    this.rouletteDuration = 1.8;
    this.chips = [];
    this._place = -1;
    this._lap = -1;
    this._bestLap = Infinity;
  }

  // ==================================================================================================
  setup(ctx) {
    this.teardown();
    this.ctx = ctx;
    const g = this.game;
    const { karts, track } = ctx;
    this._place = -1;
    this._lap = -1;
    this._bestLap = Infinity;
    const solo = karts.length < 2;
    this.root.classList.toggle('is-solo', solo);
    this.root.classList.add('is-hidden');
    this.visible = false;

    // ---- item slot
    this.item = new ItemSlot(this);
    this.item.reset();

    // ---- lap plaque
    this.lapN = h('span.hl__n', '1');
    this.lapOf = h('span.hl__of', `/${ctx.config?.laps ?? track.laps ?? 3}`); // race.setup() hasn't run yet: read the config
    this.timeEl = h('div.hl__time', '0:00.000');
    this.bestEl = h('div.hl__best');
    this.lapBox = h('div.hl__lap', h('span.hl__lbl', 'LAP'), this.lapN, this.lapOf);
    this.lapEl = h('div.hud-lap', this.lapBox, this.timeEl, this.bestEl);
    if (ctx.config?.mode === 'timetrial') {
      const rec = RaceManager.getRecords?.()?.[track.id];
      this.bestEl.innerHTML = rec ? `<span>BEST</span>${formatTime(rec.bestTotal)}` : '';
      this.bestEl.style.display = rec ? '' : 'none';
    } else this.bestEl.style.display = 'none';

    // ---- minimap
    this.map = new Minimap(this);

    // ---- place indicator
    this.placeNum = h('span.hp__num.fx', { 'data-text': '8' }, '8');
    this.placeSuf = h('span.hp__suf.fx', { 'data-text': 'th' }, 'th');
    this.placeDelta = h('div.hp__delta');
    this.placeEl = h('div.hud-place', this.placeDelta, h('div.hp__row', this.placeNum, this.placeSuf));

    // ---- standings column (portrait chips)
    this.standings = h('div.hud-standings', { style: { '--n': karts.length } });
    this.chips = karts.map((k) => {
      const img = h('img', { alt: '', draggable: 'false' });
      img.src = this.ui.portrait(k.character.id, 128);
      const rank = h('span.st__rank', String(k.place));
      const el = h(`div.st${k.isPlayer ? '.is-player' : ''}`, { style: { '--c': k.character.colors.primary, '--r': Math.max(0, k.place - 1) }, dataset: { rank: k.place <= 3 ? String(k.place) : '' } },
        h('div.st__in', rank, h('span.st__port', img), h('span.st__name', k.character.name), h('span.st__flag', { html: checkerSvg() })));
      this.standings.appendChild(el);
      return { kart: k, el, rank, place: k.place, finished: false };
    });

    // ---- banners
    this.banners = new Banners(this);

    this.root.textContent = '';
    this.root.append(this.item.el, this.standings, this.lapEl, this.map.el, this.placeEl, this.banners.el);
    this.map.setup(track, karts);

    // ---- events
    const ev = g.events;
    const on = (name, fn) => this.offs.push(ev.on(name, fn));
    const isPlayer = (k) => !!k && k === g.player;
    on(EVT.RACE_PHASE, ({ phase }) => this._applyPhase(phase));
    on(EVT.RACE_COUNTDOWN, ({ count }) => this.banners.countdown(count));
    on(EVT.RACE_LAP, ({ kart, lap, laps, lapTime, isFinalLap }) => {
      if (!isPlayer(kart)) return;
      const best = lapTime < this._bestLap;
      this._bestLap = Math.min(this._bestLap, lapTime);
      this.banners.toast(`LAP ${lap - 1} \u2022 ${formatTime(lapTime)}`, { kind: best && lap > 2 ? 'best' : 'info', icon: 'flag', ms: 2600, sub: best && lap > 2 ? 'BEST LAP' : '' });
      if (isFinalLap) this.banners.finalLap();
      else if (laps > 1) pop(this.lapBox, { from: 1.35, duration: 500 });
    });
    on(EVT.RACE_FINISH, ({ kart, place }) => {
      if (isPlayer(kart)) this.banners.finish(place);
      else {
        const c = this.chips.find((x) => x.kart === kart);
        if (c) c.el.classList.add('is-done');
      }
    });
    on(EVT.RACE_PLACE, ({ kart, place, prev }) => {
      if (!isPlayer(kart) || !g.race.hasStarted || !(prev > 0)) return;
      this.placeDelta.innerHTML = uiIcon(place < prev ? 'arrowUp' : 'arrowDown');
      this.placeDelta.className = `hp__delta ${place < prev ? 'is-up' : 'is-down'}`;
      this.placeDelta.getAnimations().forEach((a) => a.cancel());
      this.placeDelta.animate([{ opacity: 0, transform: 'translateY(.8em) scale(.6)' }, { opacity: 1, transform: 'none', offset: 0.2 }, { opacity: 1, offset: 0.7 }, { opacity: 0, transform: `translateY(${place < prev ? '-' : ''}.8em)` }], { duration: 1500, fill: 'forwards' });
      pop(this.placeEl.querySelector('.hp__row'), { from: 1.4, duration: 520 });
    });
    on(EVT.RACE_WRONG_WAY, ({ kart, wrongWay }) => {
      if (isPlayer(kart)) this.banners.wrongWay(wrongWay);
    });
    on(EVT.ITEM_ROULETTE, ({ kart, duration }) => {
      if (isPlayer(kart)) this.rouletteDuration = duration || 1.8;
    });
    on(EVT.KART_BOOST, ({ kart, source }) => {
      if (isPlayer(kart) && source === 'rocketstart') this.banners.toast('ROCKET START!', { kind: 'good', icon: 'rocket', ms: 1800 });
    });
    on(EVT.KART_STALL, ({ kart }) => {
      if (isPlayer(kart)) this.banners.toast('TOO EARLY!', { kind: 'warn', icon: 'warn', ms: 1600 });
    });
    on(EVT.KART_TRICK, ({ kart }) => {
      if (isPlayer(kart)) this.banners.toast('TRICK!', { kind: 'good', icon: 'star', ms: 1300 });
    });
    on(EVT.ITEM_COMET_WARN, ({ target }) => {
      if (isPlayer(target)) this.banners.warn('COMET INCOMING!', 3600);
    });
    const clearComet = ({ item }) => item === 'comet' && this.banners.clearWarn();
    on(EVT.ITEM_EXPLODE, clearComet);
    on(EVT.ITEM_DESTROY, clearComet);
    on(EVT.ITEM_HIT, ({ item, kart }) => {
      if (item === 'comet') this.banners.clearWarn();
      if (isPlayer(kart) && item === 'banana') this.banners.toast('SLIPPED!', { kind: 'warn', ms: 1100 });
    });
  }

  teardown() {
    for (const off of this.offs) off();
    this.offs = [];
    this.banners?.clear();
    this.root.textContent = '';
    this.root.classList.add('is-hidden');
    this.ctx = null;
    this.chips = [];
    this.visible = false;
  }

  // ==================================================================================================
  /** Slide the HUD pieces in/out. */
  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    this.root.classList.toggle('is-hidden', !v);
  }

  /** Game.state just became 'race': sync everything to the current race phase. */
  enterRace() {
    if (!this.ctx) return;
    const r = this.game.race;
    this._applyPhase(r.phase, 0.3);
    if (r.phase === 'countdown') this.banners.countdown(r.countdown);
  }

  _applyPhase(phase, introDelay = 0) {
    const b = this.banners;
    if (!b) return;
    switch (phase) {
      case 'intro':
        this.setVisible(false);
        b.showIntro({ track: this.ctx.track, config: this.ctx.config, gp: this.game.gp }, { delay: introDelay });
        break;
      case 'countdown':
        b.hideIntro();
        this.setVisible(true);
        break;
      case 'racing':
        b.hideIntro();
        this.setVisible(true);
        break;
      case 'finished':
        this.setVisible(true);
        break;
      case 'results':
        b.setWaiting(false);
        b.wrongWay(false);
        b.clearWarn();
        break;
      default:
    }
  }

  // ==================================================================================================
  update(dt) {
    if (!this.ctx) return;
    const g = this.game, p = g.player, r = g.race;
    if (!p) return;

    // lap counter + timer
    const lap = Math.min(p.lap, r.laps);
    if (lap !== this._lap) {
      this._lap = lap;
      setText(this.lapN, lap);
      this.lapOf.textContent = `/${r.laps}`;
      this.lapEl.classList.toggle('is-final', r.laps > 1 && lap >= r.laps);
    }
    setText(this.timeEl, formatTime(p.finished ? p.finishTime : r.time));

    // place indicator
    if (p.place !== this._place) {
      const first = this._place < 0;
      this._place = p.place;
      const o = ordinal(p.place);
      const n = String(p.place);
      const suf = o.slice(n.length);
      this.placeNum.textContent = n;
      this.placeNum.dataset.text = n;
      this.placeSuf.textContent = suf;
      this.placeSuf.dataset.text = suf;
      const grad = placeGradient(p.place);
      this.placeEl.style.setProperty('--g', grad);
    }

    // standings (only touch the DOM when someone's rank changed)
    let dirty = false;
    for (const c of this.chips) {
      if (c.kart.place !== c.place) {
        dirty = true;
        break;
      }
    }
    if (dirty) {
      for (const c of this.chips) {
        const pl = c.kart.place;
        if (pl === c.place) continue;
        c.place = pl;
        c.rank.textContent = String(pl);
        c.el.style.setProperty('--r', Math.max(0, pl - 1));
        c.el.dataset.rank = pl <= 3 ? String(pl) : '';
      }
    }

    this.item.update(g.paused ? 0 : dt, p);
    this.map.update(dt);
    this.banners.update(dt);
  }
}
