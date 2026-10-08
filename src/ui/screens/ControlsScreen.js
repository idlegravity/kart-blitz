/**
 * Controls: keyboard & gamepad maps (ARCHITECTURE §6.3).
 */
import { Screen } from './Screen.js';
import { h } from '../dom.js';
import { uiIcon, keyCap, padBtn, keyLabel } from '../icons.js';
import { KEY_BINDINGS } from '../../input/InputManager.js';
import { head } from '../parts.js';

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

const col = (icon, title, rows, i) =>
  h('div.ctl-col.a-up', { style: { '--i': i } },
    h('div.ctl-col__title', { html: `${uiIcon(icon)}<span>${title}</span>` }),
    h('div.ctl-rows', rows.map(([label, glyphs]) => h('div.ctl-row', h('span.ctl-row__l', label), h('span.ctl-row__g', { html: glyphs })))));

export class ControlsScreen extends Screen {
  constructor(ui) {
    super(ui, 'controls');
  }

  build() {
    this.root.append(
      h('div.controls-wrap',
        h('div.controls.panel.a-pop',
          head('How to play', 'Controls'),
          h('div.controls__cols', col('keyboard', 'Keyboard', keyboardRows(), 2), col('gamepad', 'Gamepad', GAMEPAD, 3)),
          h('div.controls__tip', { html: `${uiIcon('tip')}<span><b>Drift tip:</b> hold <b>Drift</b> while turning, then release when the sparks turn <b class="c-blue">blue</b>, <b class="c-orange">orange</b> or <b class="c-purple">purple</b> for a mini-turbo!</span>` }))),
    );
  }

  hints() {
    return [{ action: 'back', label: 'Back' }];
  }

  onShow() {
    this.ui.showroom('menu');
  }

  onAction(action) {
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
