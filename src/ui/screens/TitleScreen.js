/**
 * Title screen: animated logo + "press to start". First gesture unlocks audio.
 */
import { Screen } from './Screen.js';
import { EVT } from '../../core/events.js';
import { h, fromHTML } from '../dom.js';
import { LOGO_BOLT, actionGlyph } from '../icons.js';
import { PLATFORM } from '../../core/platform.js';

const SPARK = '<svg viewBox="-12 -12 24 24"><path d="M0-11C1.200-3.500 3.500-1.200 11 0 3.500 1.200 1.200 3.500 0 11-1.200 3.500-3.500 1.200-11 0-3.500-1.200-1.200-3.500 0-11Z" fill="#fff" stroke="#2de2ff" stroke-width="1.600" stroke-linejoin="round"/></svg>';

export class TitleScreen extends Screen {
  constructor(ui) {
    super(ui, 'title');
    this._device = '';
  }

  build() {
    const sparks = [
      ['-6em', '2em', '0s'], ['52em', '3em', '.9s'], ['60em', '16em', '1.5s'], ['-2em', '17em', '2.1s'], ['30em', '-1em', '.4s'],
    ].map(([x, y, d]) => h('div.logo__spark', { style: { left: x, top: y, animationDelay: d }, html: SPARK }));
    this.prompt = h('div.title-prompt');
    this.root.append(
      h('div.title-hit', { onclick: () => this.start() }),
      h('div.logo',
        h('div.logo__rays'),
        h('div.logo__glow'),
        h('div.logo__words',
          h('div.logo__kart.fx', { 'data-text': 'KART' }, 'KART'),
          h('div.logo__blitz.fx', { 'data-text': 'BLITZ' }, 'BLITZ')),
        fromHTML(`<div class="logo__bolt">${LOGO_BOLT}</div>`),
        ...sparks,
        h('div.logo__tag', 'Arcade Kart Racing')),
      this.prompt,
      h('div.title-foot', 'All racers, tracks & music are original  •  Made with Three.js'),
    );
  }

  hints() {
    return [];
  }

  get backButton() {
    return false;
  }

  onShow() {
    this.ui.showroom('title');
    this._renderPrompt(true);
  }

  _renderPrompt(force) {
    const dev = this.ui.touchMode && this.game.input?.lastDevice !== 'gamepad' ? 'touch' : this.game.input?.lastDevice === 'gamepad' ? 'gamepad' : 'keyboard';
    if (!force && dev === this._device) return;
    this._device = dev;
    if (dev === 'touch') {
      this.prompt.innerHTML = 'Tap to start';
      return;
    }
    // browsers only allow audio after a keyboard/mouse gesture (gamepad buttons don't count)
    const needGesture = navigator.userActivation && !navigator.userActivation.hasBeenActive;
    this.prompt.innerHTML =
      dev === 'gamepad'
        ? `Press ${actionGlyph('confirm', 'gamepad')} to start${needGesture ? '<small>Click anywhere to enable sound</small>' : ''}`
        : `Press ${actionGlyph('confirm', 'keyboard')} or click to start`;
  }

  update() {
    this._renderPrompt(false);
  }

  start() {
    if (!this.active) return;
    this.game.audio?.unlock?.();
    if (PLATFORM.mobile) {
      try {
        const p = this.game.requestFullscreen?.(); // must run inside this tap (user gesture)
        p?.catch?.(() => {});
      } catch { /* unsupported */ }
    }
    this.emit(EVT.UI_CONFIRM);
    this.ui.goto('main');
  }

  onAction(action) {
    if (action === 'confirm') {
      this.start();
      return true;
    }
    return false;
  }
}
