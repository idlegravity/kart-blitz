/**
 * Join lobby / per-player character select for 2-4 local players.
 *
 * N player cards (colour = PLAYER_COLORS). A player joins by pressing confirm on any free device
 * (`input.pressedBy('confirm')`), browses racers with their OWN device (`input.getSource(id).repeated(...)`),
 * confirms to lock in (a locked racer is unavailable to the others) and backs out to unlock / leave.
 * When all N cards are locked the flow continues (cup / track select, driven by P1's device).
 *
 * This screen polls the input itself (`rawInput`), UIManager does not dispatch menu actions to it.
 */
import { Screen } from './Screen.js';
import { h, pop } from '../dom.js';
import { uiIcon, WEIGHT_META } from '../icons.js';
import { head } from '../parts.js';
import { CHARACTERS } from '../../data/characters.js';
import { EVT } from '../../core/events.js';
import { DEVICE_ORDER, deviceMeta, confirmGlyph, backGlyph, navGlyph, playerColor, playerTag } from '../split.js';

const COLS = 4;
const wrap = (i, n) => ((i % n) + n) % n;
const idxOf = (id) => Math.max(0, CHARACTERS.findIndex((c) => c.id === id));

export class LobbyScreen extends Screen {
  constructor(ui) {
    super(ui, 'lobby');
    this.rawInput = true;
    this.slots = [];
    this.cards = [];
    this._armedAt = 0;
    this._goT = -1;
    this._devKey = '';
  }

  build() {
    this.headEl = head('Quick Race', 'Join the Race');
    this.tagEl = this.headEl.querySelector('.pill');
    this.devStrip = h('div.lb-devices.a-down');
    this.row = h('div.lb-row');
    this.banner = h('div.lb-ready', h('span.fx.fx--green.fx--big', { 'data-text': 'ALL SET!' }, 'ALL SET!'));
    this.backBtn = h('div.lb-back.a-down', { role: 'button', onclick: () => this.onBack() }, h('span', { html: uiIcon('chevronL') }), h('b', 'Back'));
    this.root.append(h('div.lb-dim'), this.headEl, h('div.lb-top', this.devStrip, this.backBtn), this.row, this.banner);
  }

  hints() {
    return [{ action: 'back', label: 'Back' }];
  }

  // ==================================================================================================
  onShow(params = {}) {
    const f = this.ui.flow;
    const n = Math.max(2, Math.min(4, params.players ?? f.players ?? 2));
    this.n = n;
    this.tagEl.textContent = `${f.mode === 'gp' ? 'Grand Prix' : 'Quick Race'} • ${n} Players`;
    this.ui.showroom('menu');
    this._armedAt = this.ui._time + 0.35;
    this._goT = -1;
    this.banner.classList.remove('is-on');

    // fresh slots; when coming back from the next step the previous devices + racers are kept (unlocked)
    const prev = params.keep ? f.slots ?? [] : [];
    this.slots = Array.from({ length: n }, (_, i) => {
      const p = params.preset?.[i] ?? prev[i];
      if (p?.device) return { device: p.device, characterId: p.characterId ?? null, locked: !!p.locked };
      return { device: null, characterId: null, locked: false };
    });
    for (let i = 0; i < n; i++) {
      const s = this.slots[i];
      if (s.device && !s.characterId) s.characterId = this._freeChar(i, idxOf(f.characterId));
    }
    this._buildCards();
    this.render(true);
  }

  _buildCards() {
    this.row.textContent = '';
    this.row.dataset.n = String(this.n);
    this.cards = this.slots.map((_, i) => {
      const c = CHARACTERS[0];
      const img = h('img.lb__img', { alt: '', draggable: 'false' });
      img.src = this.ui.portrait(c.id, 256);
      const chips = CHARACTERS.map((ch, k) => {
        const im = h('img', { alt: ch.name, draggable: 'false' });
        im.src = this.ui.portrait(ch.id, 128);
        return h('div.lb__chip', { style: { '--c': ch.colors.primary }, onclick: (e) => { e.stopPropagation(); this.clickChip(i, k); } }, im);
      });
      const el = h('div.lb.a-up', { style: { '--pc': playerColor(i), '--i': i + 1 }, dataset: { state: 'empty' } },
        h('div.lb__bg'),
        h('div.lb__tag', playerTag(i)),
        h('div.lb__dev'),
        h('div.lb__empty'),
        h('div.lb__main',
          h('div.lb__stage',
            h('div.lb__arrow.lb__arrow--l', { html: uiIcon('chevronL'), onclick: (e) => { e.stopPropagation(); this.clickArrow(i, -1); } }),
            h('div.lb__port', img),
            h('div.lb__arrow.lb__arrow--r', { html: uiIcon('chevron'), onclick: (e) => { e.stopPropagation(); this.clickArrow(i, 1); } })),
          h('div.lb__name'),
          h('div.lb__badge'),
          h('div.lb__grid', chips)),
        h('div.lb__foot'));
      el.addEventListener('click', () => this.clickCard(i));
      this.row.appendChild(el);
      return {
        el, img, chips,
        dev: el.querySelector('.lb__dev'), empty: el.querySelector('.lb__empty'),
        name: el.querySelector('.lb__name'), badge: el.querySelector('.lb__badge'), foot: el.querySelector('.lb__foot'), port: el.querySelector('.lb__port'),
        shown: null,
      };
    });
  }

  // ==================================================================================================
  // state helpers
  // ==================================================================================================
  _takenByOther(charIdx, slotIdx) {
    const id = CHARACTERS[charIdx].id;
    return this.slots.some((s, j) => j !== slotIdx && s.locked && s.characterId === id);
  }

  /** First racer (from `from`) that nobody locked and nobody else is currently looking at. */
  _freeChar(slotIdx, from = 0) {
    const looking = new Set(this.slots.filter((s, j) => j !== slotIdx && s.characterId).map((s) => s.characterId));
    for (let k = 0; k < CHARACTERS.length; k++) {
      const c = CHARACTERS[wrap(from + k, CHARACTERS.length)];
      if (!looking.has(c.id)) return c.id;
    }
    return CHARACTERS[wrap(from, CHARACTERS.length)].id;
  }

  _freeDevices() {
    const used = new Set(this.slots.map((s) => s.device).filter(Boolean));
    const avail = this.game.input?.devices?.() ?? ['kb1', 'kb2'];
    return DEVICE_ORDER.filter((d) => !used.has(d) && (avail.includes(d) || d === 'kb1' || d === 'kb2' || d === 'pad0'));
  }

  _slotOf(device) {
    return this.slots.findIndex((s) => s.device === device);
  }

  join(device, slotIdx = this.slots.findIndex((s) => !s.device)) {
    if (slotIdx < 0 || this.slots[slotIdx].device || this._slotOf(device) >= 0) return false;
    const s = this.slots[slotIdx];
    s.device = device;
    s.locked = false;
    s.characterId = this._freeChar(slotIdx, slotIdx === 0 ? idxOf(this.ui.flow.characterId) : slotIdx * 2);
    this.ui.game.events.emit(EVT.UI_CONFIRM, {});
    this._changed(slotIdx, true);
    return true;
  }

  lock(i) {
    const s = this.slots[i];
    if (!s.device || s.locked) return;
    if (this._takenByOther(idxOf(s.characterId), i)) {
      this._shake(i);
      return;
    }
    s.locked = true;
    this.ui.game.events.emit(EVT.UI_CONFIRM, {});
    this._changed(i, true);
    // someone else was looking at the same racer: nudge them on to the next free one
    this.slots.forEach((o, j) => {
      if (j !== i && o.device && !o.locked && o.characterId === s.characterId) this.move(j, 1, 0, true);
    });
    this._maybeAllSet();
  }

  unlock(i) {
    const s = this.slots[i];
    if (!s.locked) return;
    s.locked = false;
    this.ui.game.events.emit(EVT.UI_BACK, {});
    this._changed(i, false);
  }

  leave(i) {
    const s = this.slots[i];
    if (!s.device) return;
    s.device = null;
    s.locked = false;
    s.characterId = null;
    this.ui.game.events.emit(EVT.UI_BACK, {});
    this._changed(i, false);
  }

  move(i, dx, dy, silent = false) {
    const s = this.slots[i];
    if (!s.device || s.locked) return;
    let k = idxOf(s.characterId);
    for (let t = 0; t < CHARACTERS.length; t++) {
      k = dy ? wrap(k + dy * COLS, CHARACTERS.length) : wrap(k + dx, CHARACTERS.length);
      if (!this._takenByOther(k, i)) break;
    }
    s.characterId = CHARACTERS[k].id;
    if (!silent) this.ui.game.events.emit(EVT.UI_NAV, {});
    this._changed(i, false, true);
  }

  _changed(i, popCard, popPortrait = false) {
    this._goT = -1;
    this.banner.classList.remove('is-on');
    this.render(false);
    const c = this.cards[i];
    if (popCard) pop(c.el, { from: 0.94, duration: 380 });
    if (popPortrait) pop(c.port, { from: 0.8, duration: 320 });
  }

  _shake(i) {
    const el = this.cards[i].el;
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-.8em)' }, { transform: 'translateX(.8em)' }, { transform: 'translateX(-.5em)' }, { transform: 'translateX(0)' }], { duration: 300 });
    this.ui.game.events.emit(EVT.UI_NAV, {});
  }

  _maybeAllSet() {
    if (this.slots.every((s) => s.device && s.locked)) {
      this._goT = 1.0;
      this.banner.classList.add('is-on');
      pop(this.banner, { from: 0.4, duration: 520 });
    }
  }

  proceed() {
    const f = this.ui.flow;
    f.slots = this.slots.map((s) => ({ device: s.device, characterId: s.characterId }));
    f.characterId = f.slots[0].characterId;
    f.players = this.n;
    this.ui.savePrefs();
    this.ui.goto(f.mode === 'gp' ? 'cup' : 'track');
  }

  // ==================================================================================================
  // rendering
  // ==================================================================================================
  render(force = false) {
    this.slots.forEach((s, i) => {
      const c = this.cards[i];
      const state = !s.device ? 'empty' : s.locked ? 'locked' : 'browse';
      c.el.dataset.state = state;
      if (state === 'empty') {
        this._renderEmpty(c);
        return;
      }
      const ch = CHARACTERS.find((x) => x.id === s.characterId) ?? CHARACTERS[0];
      const dm = deviceMeta(s.device);
      c.dev.innerHTML = `<span class="lb__devico">${uiIcon(dm.kind === 'gamepad' ? 'gamepad' : 'keyboard')}</span><span>${dm.label}</span><b>${dm.kind === 'keyboard' ? dm.short : ''}</b>`;
      if (c.shown !== ch.id || force) {
        c.shown = ch.id;
        c.img.src = this.ui.portrait(ch.id, 256);
        c.name.textContent = ch.name;
        const m = WEIGHT_META[ch.weightClass] ?? WEIGHT_META.medium;
        c.badge.innerHTML = `<span class="wbadge" style="--wc:${m.color}">${uiIcon(m.icon)}<span>${m.label}</span></span>`;
        c.el.style.setProperty('--c1', ch.colors.primary);
        c.el.style.setProperty('--c2', ch.colors.secondary);
      }
      c.chips.forEach((chip, k) => {
        const id = CHARACTERS[k].id;
        const ownerIdx = this.slots.findIndex((o, j) => o.locked && o.characterId === id);
        const taken = ownerIdx >= 0 && ownerIdx !== i;
        chip.classList.toggle('is-sel', id === s.characterId);
        chip.classList.toggle('is-taken', taken);
        chip.style.setProperty('--tc', taken ? playerColor(ownerIdx) : 'transparent');
        chip.dataset.owner = taken ? playerTag(ownerIdx) : '';
      });
      c.foot.innerHTML = state === 'locked'
        ? `<span class="lb__ready">${uiIcon('check')}<b>READY!</b></span><span class="lb__sub">${backGlyph(s.device)} change</span>`
        : `<span class="lb__sub">${navGlyph(s.device)} choose</span><span class="lb__sub lb__sub--go">${confirmGlyph(s.device)} lock in</span>`;
    });
    this._renderDevices(true);
  }

  _renderEmpty(c) {
    const free = this._freeDevices();
    const key = free.join(',');
    if (c.emptyKey === key) return;
    c.emptyKey = key;
    c.shown = null;
    const rows = free
      .filter((d) => d === 'kb1' || d === 'kb2' || (this.game.input?.devices?.() ?? []).includes(d))
      .map((d) => {
        const m = deviceMeta(d);
        return `<div class="lb__join"><span class="lb__jg">${confirmGlyph(d)}</span><span class="lb__jl">${m.kind === 'gamepad' ? m.label : `${m.label} · ${m.short}`}</span></div>`;
      });
    if (!(this.game.input?.devices?.() ?? []).some((d) => d.startsWith('pad'))) rows.push(`<div class="lb__join lb__join--dim"><span class="lb__jg">${confirmGlyph('pad0')}</span><span class="lb__jl">Gamepad</span></div>`);
    c.empty.innerHTML = `<div class="lb__plus">${uiIcon('plus')}</div><div class="lb__press">PRESS TO JOIN</div>${rows.join('')}`;
  }

  _renderDevices(force = false) {
    const devs = this.game.input?.devices?.() ?? ['kb1', 'kb2'];
    const key = devs.join(',') + '|' + this.slots.map((s) => s.device).join(',');
    if (!force && key === this._devKey) return;
    this._devKey = key;
    this.devStrip.innerHTML = devs
      .map((d) => {
        const m = deviceMeta(d);
        const si = this._slotOf(d);
        const style = si >= 0 ? ` style="--pc:${playerColor(si)}"` : '';
        const owner = si >= 0 ? `<i>${playerTag(si)}</i>` : '';
        return `<span class="lb-dev${si >= 0 ? ' is-owned' : ''}"${style}>${uiIcon(m.kind === 'gamepad' ? 'gamepad' : 'keyboard')}<b>${m.kind === 'keyboard' ? m.short : m.short}</b>${owner}</span>`;
      })
      .join('');
  }

  // ==================================================================================================
  // input
  // ==================================================================================================
  update(dt = 1 / 60) {
    if (!this.active) return;
    const ui = this.ui;
    const inp = this.game.input;
    this._renderDevices();
    if (this._goT >= 0) {
      this._goT -= dt;
      if (this._goT < 0) {
        this._goT = -1;
        this.proceed();
        return;
      }
    }
    if (!inp || ui._time < this._armedAt) return;

    const hasApi = typeof inp.pressedBy === 'function' && typeof inp.getSource === 'function';
    // ---- back
    const backBy = hasApi ? inp.pressedBy('back') : [];
    for (const d of backBy) {
      const i = this._slotOf(d);
      if (i >= 0) {
        if (this.slots[i].locked) this.unlock(i);
        else this.leave(i);
      } else if (!this.slots.some((s) => s.device)) {
        this.onBack();
        return;
      }
    }
    // Esc / merged back with no joined device behind it: leave the lobby
    if (inp.pressed('back') && (!hasApi || !backBy.length)) {
      this.onBack();
      return;
    }

    // ---- confirm: join / lock in
    let confirmBy;
    if (hasApi) confirmBy = inp.pressedBy('confirm');
    else {
      confirmBy = [];
      if (inp.pressed('confirm')) {
        const open = this.slots.findIndex((s) => s.device && !s.locked);
        confirmBy = [open >= 0 ? this.slots[open].device : this._freeDevices()[0]];
      }
    }
    for (const d of confirmBy) {
      if (!d || backBy.includes(d)) continue;
      const i = this._slotOf(d);
      if (i >= 0) {
        if (!this.slots[i].locked) this.lock(i);
      } else this.join(d);
    }

    // ---- browse with each player's own device
    this.slots.forEach((s, i) => {
      if (!s.device || s.locked) return;
      const src = hasApi ? inp.getSource(s.device) : inp;
      const rep = (a) => (src.repeated ? src.repeated(a) : src.pressed(a));
      if (rep('left')) this.move(i, -1, 0);
      else if (rep('right')) this.move(i, 1, 0);
      else if (rep('up')) this.move(i, 0, -1);
      else if (rep('down')) this.move(i, 0, 1);
    });
  }

  // ---- mouse / touch ----
  clickCard(i) {
    const s = this.slots[i];
    if (!s.device) {
      const d = this._freeDevices()[0];
      if (d) this.join(d, i);
    } else if (s.locked) this.unlock(i);
    else this.lock(i);
  }

  clickArrow(i, dx) {
    if (this.slots[i].device) this.move(i, dx, 0);
  }

  clickChip(i, k) {
    const s = this.slots[i];
    if (!s.device || s.locked || this._takenByOther(k, i)) return;
    s.characterId = CHARACTERS[k].id;
    this._changed(i, false, true);
  }

  onAction(action) {
    if (action === 'back') {
      // handled in update() (device-aware); a stray UI-level back (mouse etc.) just leaves
      return false;
    }
    return false;
  }

  onBack() {
    this.ui.goto('cc');
  }

  onHide() {
    this._goT = -1;
  }
}
