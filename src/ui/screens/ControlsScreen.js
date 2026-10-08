/**
 * Controls: keyboard & gamepad maps (ARCHITECTURE §6.3).
 */
import { Screen } from './Screen.js';
import { h } from '../dom.js';
import { uiIcon, keyCap, padBtn, keyLabel } from '../icons.js';
import * as INPUT from '../../input/InputManager.js';
import { KEY_BINDINGS } from '../../input/InputManager.js';
import { head } from '../parts.js';
import { EVT } from '../../core/events.js';
import { PLATFORM } from '../../core/platform.js';

/** Key caps for an action, straight from the InputManager's bindings (de-duplicated by label). */
const capsFor = (action, fallback = []) => {
  const codes = KEY_BINDINGS[action] ?? fallback;
  const seen = new Set();
  return codes.filter((c) => {
    const l = keyLabel(c);
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
};
const OR = '<span class="or">/</span>';
const K = (action, fallback) => capsFor(action, fallback).map((c) => keyCap(c)).join(OR);
const steerCaps = () => {
  const l = KEY_BINDINGS.left ?? ['KeyA', 'ArrowLeft'], r = KEY_BINDINGS.right ?? ['KeyD', 'ArrowRight'];
  return l.map((lc, i) => `${keyCap(lc)}${keyCap(r[i] ?? r[0])}`).join(OR);
};
const first = (action, fb) => keyCap((KEY_BINDINGS[action] ?? [fb])[0]);

const keyboardRows = () => [
  ['Accelerate', K('throttle', ['KeyW', 'ArrowUp'])],
  ['Brake / Reverse', K('brake', ['KeyS', 'ArrowDown'])],
  ['Steer', steerCaps()],
  ['Drift / Hop', K('drift', ['Space', 'ShiftLeft'])],
  ['Use Item', K('item', ['KeyE', 'KeyK', 'ControlLeft'])],
  ['Look Back', K('lookBack', ['KeyQ', 'KeyC'])],
  ['Pause', K('pause', ['Escape', 'KeyP'])],
  ['Menus', `${first('confirm', 'Enter')}<small>select</small>${first('back', 'Escape')}<small>back</small>`],
];
const GAMEPAD = [
  ['Accelerate', padBtn('A')],
  ['Brake / Reverse', `${padBtn('B')}${OR}${padBtn('LT')}`],
  ['Steer', `${padBtn('STICK')}${OR}${padBtn('DPAD')}`],
  ['Drift / Hop', `${padBtn('RB')}${OR}${padBtn('RT')}`],
  ['Use Item', `${padBtn('LB')}${OR}${padBtn('X')}`],
  ['Look Back', padBtn('Y')],
  ['Pause', padBtn('START')],
  ['Menus', `${padBtn('A')}<small>select</small>${padBtn('B')}<small>back</small>`],
];

/** Split-screen keyboard halves (docs/SPLITSCREEN.md §3.2) — the InputManager's table, with a hard-coded fallback. */
const SPLIT = INPUT.KEY_BINDINGS_SPLIT ?? {
  kb1: { throttle: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'], drift: ['Space', 'ShiftLeft'], item: ['KeyE', 'ControlLeft'], lookBack: ['KeyQ'], confirm: ['Space', 'KeyE'], back: ['KeyQ'] },
  kb2: { throttle: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], drift: ['ShiftRight', 'Period'], item: ['Slash', 'ControlRight', 'Enter'], lookBack: ['Comma'], confirm: ['Enter', 'Slash'], back: ['Backspace'] },
};
const caps = (codes = []) => {
  const seen = new Set();
  return codes.filter((c) => !seen.has(keyLabel(c)) && seen.add(keyLabel(c))).map((c) => keyCap(c)).join(OR);
};
const splitRows = (b) => [
  ['Accelerate', caps(b.throttle)],
  ['Brake / Reverse', caps(b.brake)],
  ['Steer', `${caps(b.left)}${caps(b.right)}`],
  ['Drift / Hop', caps(b.drift)],
  ['Use Item', caps(b.item)],
  ['Look Back', caps(b.lookBack)],
  ['Menus', `${caps(b.confirm)}<small>ok</small>${caps(b.back)}<small>back</small>`],
];
const splitPadRows = () => [
  ['Accelerate', padBtn('A')],
  ['Brake / Reverse', `${padBtn('B')}${OR}${padBtn('LT')}`],
  ['Steer', `${padBtn('STICK')}${OR}${padBtn('DPAD')}`],
  ['Drift / Hop', `${padBtn('RB')}${OR}${padBtn('RT')}`],
  ['Use Item', `${padBtn('LB')}${OR}${padBtn('X')}`],
  ['Look Back', padBtn('Y')],
  ['Menus', `${padBtn('A')}<small>ok</small>${padBtn('B')}<small>back</small>`],
];

const col = (icon, title, rows, i, sub = '') =>
  h('div.ctl-col.a-up', { style: { '--i': i } },
    h('div.ctl-col__title', { html: `${uiIcon(icon)}<span>${title}</span>` }),
    sub ? h('div.ctl-col__sub', sub) : null,
    h('div.ctl-rows', rows.map(([label, glyphs]) => h('div.ctl-row', h('span.ctl-row__l', label), h('span.ctl-row__g', { html: glyphs })))));

/** Touch page (phones & tablets): a miniature of the on-screen layout + what each control does. Mirrors when left-handed. */
const tbtn = (cls, label) => `<span class="tbtn tbtn--${cls}">${label}</span>`;
const touchRows = () => [
  ['Steer', `${tbtn('steer', 'Drag')}<small>thumb left / right</small>`],
  ['Drift / Hop', `${tbtn('drift', 'Drift')}<small>hold</small>`],
  ['Use Item', `${tbtn('item', 'Item')}<small>tap</small>`],
  ['Brake / Reverse', `${tbtn('brake', 'Brake')}<small>hold</small>`],
  ['Look Back', `${tbtn('look', 'Look')}<small>hold</small>`],
  ['Pause', `${tbtn('pause', uiIcon('pause'))}<small>top of the screen</small>`],
];
const touchDiagram = () => h('div.tdiag', { html: `
  <div class="tdiag__phone">
    <div class="tdiag__steer"><div class="tdiag__ring"><i></i></div><svg viewBox="0 0 60 16" class="tdiag__arrows" aria-hidden="true"><path d="M14 8H3M7 3.500 2.500 8 7 12.500M46 8h11M53 3.500 57.500 8 53 12.500" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><b>STEER</b></div>
    <div class="tdiag__pause">${uiIcon('pause')}</div>
    <div class="tdiag__item">ITEM</div>
    <div class="tdiag__drift">DRIFT</div>
    <div class="tdiag__brake">BRAKE</div>
    <div class="tdiag__look">LOOK</div>
  </div>` });

export class ControlsScreen extends Screen {
  constructor(ui) {
    super(ui, 'controls');
  }

  build() {
    const solo = h('div.controls__cols', col('keyboard', 'Keyboard', keyboardRows(), 2), col('gamepad', 'Gamepad', GAMEPAD, 3));
    const split = h('div.controls__cols.controls__cols--3',
      col('keyboard', 'Keyboard left', splitRows(SPLIT.kb1), 2, 'WASD side \u2022 pick it first in the lobby'),
      col('keyboard', 'Keyboard right', splitRows(SPLIT.kb2), 3, 'Arrow keys side'),
      col('gamepad', 'Gamepads', splitPadRows(), 4, 'One pad per player (up to 4)'));
    this.diagram = touchDiagram();
    const touch = h('div.controls__cols.controls__cols--touch', this.diagram, col('hand', 'Touch', touchRows(), 2));
    const tipDrift = h('div.controls__tip', { html: `${uiIcon('tip')}<span><b>Drift tip:</b> hold <b>Drift</b> while turning, then release when the sparks turn <b class="c-blue">blue</b>, <b class="c-orange">orange</b> or <b class="c-purple">purple</b> for a mini-turbo!</span>` });
    const tipSplit = h('div.controls__tip', { html: `${uiIcon('tip')}<span><b>Split-screen:</b> in the lobby each player presses <b>confirm</b> on their own device to join. <b>Pause</b> with ${keyCap('Escape')} / ${keyCap('P')} / ${padBtn('START')}: any player can.</span>` });
    const tipTouch = h('div.controls__tip', { html: `${uiIcon('tip')}<span><b>Tip:</b> hold <b>Drift</b> through a turn and release on the colour sparks for a mini-turbo. Switch <b>Steering</b> (Stick / Tilt / Buttons) or go <b>Left-handed</b> in Options.</span>` });
    const P = { solo: { label: 'Solo', el: solo, tip: tipDrift }, split: { label: 'Split-screen', el: split, tip: tipSplit }, touch: { label: 'Touch', el: touch, tip: tipTouch } };
    this.pages = PLATFORM.mobile ? [P.touch, { ...P.solo, label: 'Keyboard & pad' }] : PLATFORM.touch ? [P.solo, P.split, P.touch] : [P.solo, P.split];
    this.tabs = this.pages.map((pg, i) => h('div.ctl-tab', { role: 'button', onclick: () => this.setPage(i) }, pg.label));
    const headEl = head('How to play', 'Controls');
    headEl.append(h('div.ctl-tabs', this.tabs));
    this.root.append(h('div.controls-wrap', h('div.controls.panel.a-pop', headEl, ...this.pages.flatMap((pg) => [pg.el, pg.tip]))));
    this.pageIdx = 0;
    this.setPage(0, true);
  }

  setPage(i, silent = false) {
    i = Math.max(0, Math.min(this.pages.length - 1, i));
    this.pageIdx = i;
    this.pages.forEach((pg, k) => {
      pg.el.style.display = k === i ? '' : 'none';
      pg.tip.style.display = k === i ? '' : 'none';
    });
    this.tabs.forEach((t, k) => t.classList.toggle('is-on', k === i));
    this.root.dataset.page = this.pages[i].el.className.includes('touch') ? 'touch' : 'keys';
    this.diagram.classList.toggle('is-left', !!this.game.settings?.leftHanded);
    if (!silent) this.emit(EVT.UI_NAV);
  }

  touchHint() {
    return '';
  }

  hints() {
    return [{ action: 'navH', label: 'Page' }, { action: 'back', label: 'Back' }];
  }

  onShow() {
    this.ui.showroom('menu');
    const splitIdx = this.pages.findIndex((pg) => pg.label === 'Split-screen');
    this.setPage(PLATFORM.mobile ? 0 : this.ui.flow.players > 1 && splitIdx >= 0 ? splitIdx : 0, true);
  }

  onAction(action) {
    if (action === 'left' || action === 'right') {
      this.setPage(this.pageIdx + (action === 'left' ? -1 : 1));
      return true;
    }
    if (action === 'back' || action === 'confirm') {
      this.onBack();
      return true;
    }
    return false;
  }

  onBack() {
    this.ui.goto('main');
  }
}
