/**
 * Base class for every menu screen / overlay. OWNER: Presentation.
 *
 * Lifecycle: build() once (lazy) → show(params) → [update(dt) each frame] → hide().
 * Screens are persistent DOM (display:none when inactive) so entrance animations replay on every show.
 */
import { h } from '../dom.js';

export class Screen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   * @param {string} name event/screen id (UI_SCREEN payload)
   * @param {{ layer?: 'screens'|'overlay'|'loading', cls?: string }} [opts]
   */
  constructor(ui, name, { layer = 'screens', cls = '' } = {}) {
    this.ui = ui;
    this.game = ui.game;
    this.name = name;
    this.layerName = layer;
    this.cls = cls;
    this.root = null;
    this.nav = null;
    this.active = false;
    this.params = {};
    this._leaveTimer = 0;
  }

  /** Override: create DOM inside `this.root` (already created) and set `this.nav`. */
  build() {}
  /** Override: called each time the screen is shown (after DOM is visible). */
  onShow() {}
  /** Override: called when the screen starts hiding. */
  onHide() {}
  /** Override: per-frame update while active. */
  update() {}
  /** Override: the hints shown in the bottom bar: [{ action, label }] */
  hints() {
    return [{ action: 'nav', label: 'Navigate' }, { action: 'confirm', label: 'Select' }, { action: 'back', label: 'Back' }];
  }
  /** Override: back action. */
  onBack() {}

  ensureBuilt() {
    if (this.root) return;
    this.root = h(`div.screen.screen--${this.name}${this.cls ? '.' + this.cls : ''}`, { dataset: { screen: this.name } });
    this.build();
    this.ui.layers[this.layerName].appendChild(this.root);
  }

  show(params = {}) {
    this.ensureBuilt();
    clearTimeout(this._leaveTimer);
    this.params = params;
    const wasActive = this.active;
    this.active = true;
    this.root.classList.remove('is-leaving');
    if (!this.root.classList.contains('is-active')) this.root.classList.add('is-active');
    this.onShow(params, wasActive);
    this.ui.hintBar.set(this.hints());
  }

  hide(immediate = false) {
    if (!this.root || !this.active) return;
    this.active = false;
    this.onHide();
    if (immediate) {
      this.root.classList.remove('is-active', 'is-leaving');
      return;
    }
    this.root.classList.add('is-leaving');
    this._leaveTimer = setTimeout(() => {
      this.root.classList.remove('is-active', 'is-leaving');
    }, 210);
  }

  /** Route a logical action; default = focus navigation. Return true if handled. */
  onAction(action) {
    if (action === 'back') {
      this.onBack();
      return true;
    }
    return this.nav ? this.nav.action(action) : false;
  }

  /** Convenience: emit a UI event. */
  emit(evt, payload = {}) {
    this.game.events.emit(evt, payload);
  }
}
