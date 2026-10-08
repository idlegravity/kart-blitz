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

export class ControlsScreen extends Screen {
  constructor(ui) {
    super(ui, 'controls');
  }

  build() {
    this.tabs = ['Solo', 'Split-screen'].map((label, i) =>
      h('div.ctl-tab', { role: 'button', onclick: () => this.setPage(i) }, label));
    const headEl = head('How to play', 'Controls');
    headEl.append(h('div.ctl-tabs', this.tabs));
    this.page1 = h('div.controls__cols', col('keyboard', 'Keyboard', keyboardRows(), 2), col('gamepad', 'Gamepad', GAMEPAD, 3));
    this.page2 = h('div.controls__cols.controls__cols--3',
      col('keyboard', 'Keyboard left', splitRows(SPLIT.kb1), 2, 'WASD side \u2022 pick it first in the lobby'),
      col('keyboard', 'Keyboard right', splitRows(SPLIT.kb2), 3, 'Arrow keys side'),
      col('gamepad', 'Gamepads', splitPadRows(), 4, 'One pad per player (up to 4)'));
    this.tip1 = h('div.controls__tip', { html: `${uiIcon('tip')}<span><b>Drift tip:</b> hold <b>Drift</b> while turning, then release when the sparks turn <b class="c-blue">blue</b>, <b class="c-orange">orange</b> or <b class="c-purple">purple</b> for a mini-turbo!</span>` });
    this.tip2 = h('div.controls__tip', { html: `${uiIcon('tip')}<span><b>Split-screen:</b> in the lobby each player presses <b>confirm</b> on their own device to join. <b>Pause</b> with ${keyCap('Escape')} / ${keyCap('P')} / ${padBtn('START')}: any player can.</span>` });
    this.root.append(h('div.controls-wrap', h('div.controls.panel.a-pop', headEl, this.page1, this.page2, this.tip1, this.tip2)));
    this.pageIdx = 0;
    this.setPage(0, true);
  }

  setPage(i, silent = false) {
    this.pageIdx = i;
    this.page1.style.display = i === 0 ? '' : 'none';
    this.tip1.style.display = i === 0 ? '' : 'none';
    this.page2.style.display = i === 1 ? '' : 'none';
    this.tip2.style.display = i === 1 ? '' : 'none';
    this.tabs.forEach((t, k) => t.classList.toggle('is-on', k === i));
    if (!silent) this.emit(EVT.UI_NAV);
  }

  hints() {
    return [{ action: 'navH', label: 'Page' }, { action: 'back', label: 'Back' }];
  }

  onShow() {
    this.ui.showroom('menu');
    this.setPage(this.ui.flow.players > 1 ? 1 : 0, true);
  }

  onAction(action) {
    if (action === 'left' || action === 'right') {
      this.setPage(action === 'left' ? 0 : 1);
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
