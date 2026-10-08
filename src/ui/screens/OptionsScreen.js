/**
 * Options: master/music/sfx sliders, quality, show FPS, default engine class → game.setSetting(key, value).
 * Used from the main menu (left panel) and from the pause menu (centered overlay: PauseOptionsScreen).
 */
import { Screen } from './Screen.js';
import { EVT } from '../../core/events.js';
import { Nav } from '../nav.js';
import { h, clamp } from '../dom.js';
import { uiIcon } from '../icons.js';
import { head } from '../parts.js';

const ROWS = [
  { key: 'masterVolume', type: 'slider', label: 'Master Volume', icon: 'speaker', accent: ['#ffd23f', '#ff9a1c'] },
  { key: 'musicVolume', type: 'slider', label: 'Music', icon: 'music', accent: ['#c9a6ff', '#7a3ef0'] },
  { key: 'sfxVolume', type: 'slider', label: 'Sound FX', icon: 'bolt', accent: ['#6df3ff', '#1f9dff'] },
  { key: 'quality', type: 'seg', label: 'Graphics', icon: 'monitor', accent: ['#7af79a', '#1fbf55'], options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
  { key: 'showFps', type: 'toggle', label: 'Show FPS', icon: 'fps', accent: ['#ff9c8a', '#ff3b3b'] },
  { key: 'cc', type: 'seg', label: 'Default Class', icon: 'gauge', accent: ['#ffb45c', '#ff7a1a'], options: [[50, '50'], [100, '100'], [150, '150'], [200, '200']] },
];

export class OptionsScreen extends Screen {
  constructor(ui, name = 'options', opts = {}) {
    super(ui, name, opts);
    this._sfxAt = 0;
  }

  build() {
    this.headEl = head('Settings', 'Options');
    this.rows = ROWS.map((r, i) => this._buildRow(r, i));
    this.panel = h('div.opt-panel.panel.a-left', this.headEl, h('div.opt-list', this.rows.map((r) => r.el)));
    if (this.layerName === 'overlay') this.root.append(h('div.pause__dim'));
    this.root.append(this.panel);
    this.nav = new Nav(this.ui, { layout: 'list' });
    this.nav.setItems(this.rows.map((r) => ({
      el: r.el,
      onAdjust: (dir) => r.adjust(dir),
      onSelect: () => r.activate(),
      onClick: r.click ? (e) => r.click(e) : undefined,
    })), 0);
  }

  _buildRow(def, i) {
    const game = this.game;
    const get = () => game.settings?.[def.key];
    const set = (v) => {
      game.setSetting?.(def.key, v);
      this.refresh();
    };
    const el = h('div.btn.btn--opt.a-left', { style: { '--i': i + 2, '--accent': def.accent[0], '--accent2': def.accent[1] }, role: 'button' },
      h('div.btn__bg'), h('div.btn__shine'),
      h('div.btn__icon', { html: uiIcon(def.icon) }),
      h('div.btn__label.opt__label', def.label));
    // `click` is only defined for rows whose own child controls handle pointer input; others fall back to activate()
    const row = { def, el, refresh() {}, adjust: () => false, activate() {}, click: null };

    if (def.type === 'slider') {
      const fill = h('div.sl__fill');
      const knob = h('div.sl__knob');
      const track = h('div.sl__track', fill, knob);
      const val = h('div.sl__val');
      el.append(h('div.sl', track, val));
      const apply = (v) => {
        v = clamp(Math.round(v * 20) / 20, 0, 1);
        if (Math.abs(v - get()) > 1e-4) {
          set(v);
          if (def.key === 'sfxVolume') this._tick();
        }
      };
      row.refresh = () => {
        const v = get() ?? 0;
        fill.style.transform = `scaleX(${v})`;
        knob.style.left = `${v * 100}%`;
        val.textContent = `${Math.round(v * 100)}`;
      };
      row.adjust = (dir) => {
        apply((get() ?? 0) + dir * 0.05);
        return true;
      };
      let dragging = false;
      const fromEvent = (e) => {
        const r = track.getBoundingClientRect();
        apply((e.clientX - r.left) / r.width);
      };
      track.addEventListener('pointerdown', (e) => {
        dragging = true;
        track.setPointerCapture?.(e.pointerId);
        fromEvent(e);
        e.stopPropagation();
      });
      track.addEventListener('pointermove', (e) => dragging && fromEvent(e));
      const end = (e) => {
        dragging = false;
        track.releasePointerCapture?.(e.pointerId);
      };
      track.addEventListener('pointerup', end);
      track.addEventListener('pointercancel', end);
      row.click = () => {};
    } else if (def.type === 'seg') {
      const opts = def.options.map(([value, text]) => {
        const o = h('div.seg__o', text);
        o.addEventListener('click', (e) => {
          e.stopPropagation();
          set(value);
          this.game.events.emit(EVT.UI_CONFIRM, {});
        });
        return { o, value };
      });
      el.append(h('div.seg', opts.map((x) => x.o)));
      row.refresh = () => {
        const v = get();
        opts.forEach((x) => x.o.classList.toggle('is-on', x.value === v));
      };
      row.adjust = (dir) => {
        const idx = Math.max(0, opts.findIndex((x) => x.value === get()));
        const n = clamp(idx + dir, 0, opts.length - 1);
        if (n !== idx) set(opts[n].value);
        return true;
      };
      row.activate = () => row.adjust(1) || true;
      row.click = () => {};
    } else {
      const knob = h('i');
      const tog = h('div.tog', knob, h('span'));
      el.append(tog);
      row.refresh = () => {
        const on = !!get();
        tog.classList.toggle('is-on', on);
        tog.lastChild.textContent = on ? 'ON' : 'OFF';
      };
      row.adjust = (dir) => {
        const want = dir > 0;
        if (!!get() !== want) set(want);
        return true;
      };
      row.activate = () => set(!get());
    }
    return row;
  }

  refresh() {
    for (const r of this.rows) r.refresh();
  }

  _tick() {
    const now = performance.now();
    if (now - this._sfxAt < 90) return;
    this._sfxAt = now;
    this.game.audio?.playSfx?.('uiTick');
  }

  hints() {
    // in the pause overlay Esc is owned by Game (it resumes), so Back is Backspace / gamepad B
    return [{ action: 'navV', label: 'Select' }, { action: 'navH', label: 'Adjust' }, { action: this.layerName === 'overlay' ? 'backAlt' : 'back', label: 'Back' }];
  }

  onShow(params) {
    this.back = params?.back ?? 'main';
    if (this.layerName !== 'overlay') this.ui.showroom('menu');
    this.refresh();
  }

  onBack() {
    if (this.layerName === 'overlay') this.ui.closePauseOptions?.();
    else this.ui.goto(this.back || 'main');
  }
}

export class PauseOptionsScreen extends OptionsScreen {
  constructor(ui) {
    super(ui, 'pauseOptions', { layer: 'overlay' });
  }
}
