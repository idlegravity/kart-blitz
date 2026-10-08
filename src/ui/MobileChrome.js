/**
 * MobileChrome — everything the phone UI needs that desktop doesn't (docs/MOBILE.md §3.4). OWNER: UI.
 *
 *  - UI scale: sets `--u` (px) on #ui from the real viewport so every screen fits 667x375 and scales up to tablets.
 *    Portrait uses the same (landscape) scale so the layout doesn't jump while rotating.
 *  - "Rotate your phone" overlay in portrait (EVT.ORIENTATION, with matchMedia/size fallback).
 *  - Floating Back button on every sub-screen (phones have no Esc).
 *  - Tap-to-skip during the intro (the touch overlay isn't up yet).
 *
 * Only instantiated when PLATFORM.mobile. Debug: `?safe=t,r,b,l` fakes safe-area insets (px) for headless tests.
 */
import { EVT } from '../core/events.js';
import { PLATFORM } from '../core/platform.js';
import { h } from './dom.js';
import { uiIcon } from './icons.js';

const PHONE_SVG = `<svg viewBox="0 0 120 120" class="rot__svg" aria-hidden="true">
  <g class="rot__phone">
    <rect x="38" y="10" width="44" height="100" rx="9" fill="#1b1f3a" stroke="#140a2e" stroke-width="6"/>
    <rect x="38" y="10" width="44" height="100" rx="9" fill="none" stroke="#fff" stroke-width="2.4" opacity=".9"/>
    <rect x="44" y="20" width="32" height="76" rx="3" fill="#2de2ff" opacity=".22"/>
    <path d="M52 62h16M62 56l6 6-6 6" fill="none" stroke="#ffd23f" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" opacity=".0"/>
    <circle cx="60" cy="103" r="2.6" fill="#fff" opacity=".7"/>
    <rect x="53" y="13.5" width="14" height="3" rx="1.5" fill="#fff" opacity=".55"/>
    <path d="M50 44h20l-9 14h9L52 80l4-16h-8Z" fill="#ffd23f" stroke="#140a2e" stroke-width="2.4" stroke-linejoin="round"/>
  </g>
</svg>`;

export class MobileChrome {
  /** @param {import('./UIManager.js').UIManager} ui */
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.root = ui.root;
    this._backShown = false;
    this._backFor = null;
    this._portrait = false;

    this._applySafe();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 120));
    window.visualViewport?.addEventListener('resize', () => this._resize());

    // ---- rotate prompt
    this.rotate = h('div.rot', { role: 'alert' },
      h('div.rot__bg'),
      h('div.rot__card',
        h('div.rot__phoneWrap', { html: PHONE_SVG }),
        h('div.rot__title',
          h('div.fx.fx--gold', { 'data-text': 'ROTATE' }, 'ROTATE'),
          h('div.fx.fx--gold', { 'data-text': 'YOUR PHONE' }, 'YOUR PHONE')),
        h('div.rot__sub', 'Kart Blitz is played in landscape')));
    this.rotate.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(this.rotate);
    this._offs = [ui.game.events.on(EVT.ORIENTATION, ({ orientation }) => this._setPortrait(orientation === 'portrait'))];
    this._setPortrait(this._isPortrait());

    // ---- back button
    this.backLabel = h('span', 'Back');
    this.back = h('div.m-back', { role: 'button' }, h('span.m-back__ico', { html: uiIcon('chevronL') }), this.backLabel);
    this.back.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ui.game.events.emit(EVT.UI_NAV, {});
      this.ui.back();
    });
    this.root.appendChild(this.back);

    // ---- tap anywhere to skip the intro fly-over
    this.skip = h('div.m-skip');
    this.skip.addEventListener('click', () => {
      try {
        this.game.race?.skipIntro?.();
      } catch { /* not ready */ }
    });
    this.root.appendChild(this.skip);
  }

  _isPortrait() {
    if (this.game.orientation) return this.game.orientation === 'portrait';
    return window.matchMedia?.('(orientation: portrait)').matches ?? window.innerHeight > window.innerWidth;
  }

  _setPortrait(p) {
    if (p === this._portrait && this.rotate.classList.contains('is-on') === p) return;
    this._portrait = p;
    this.rotate.classList.toggle('is-on', p);
    this.root.classList.toggle('is-portrait', p);
  }

  /** `--u` in px from the real viewport (same in portrait so the layout doesn't jump). */
  _resize() {
    const w = this.root.clientWidth || window.innerWidth;
    const hh = this.root.clientHeight || window.innerHeight;
    const long = Math.max(w, hh), short = Math.min(w, hh);
    const u = Math.max(4.2, Math.min(long * 0.0112, short * 0.02));
    this.root.style.setProperty('--u', `${u.toFixed(3)}px`);
    this.root.style.setProperty('--vw-u', (long / u).toFixed(2));
    this.root.style.setProperty('--vh-u', (short / u).toFixed(2));
    this.root.classList.toggle('is-tall', short / u > 56);
    if (!this.game.orientation) this._setPortrait(this._isPortrait());
  }

  _applySafe() {
    const s = new URLSearchParams(location.search).get('safe');
    if (!s) return;
    const [t, r, b, l] = s.split(',').map((v) => `${parseFloat(v) || 0}px`);
    const st = this.root.style;
    st.setProperty('--sa-t', t);
    st.setProperty('--sa-r', r ?? '0px');
    st.setProperty('--sa-b', b ?? '0px');
    st.setProperty('--sa-l', l ?? '0px');
  }

  update() {
    const ui = this.ui;
    // back button: for the active owner (overlay first), unless it opts out
    const o = ui._owner?.();
    let show = !!o && o.backButton !== false && !this._portrait;
    if (show && o.name === 'pause') show = false;
    if (show !== this._backShown) {
      this._backShown = show;
      this.back.classList.toggle('is-on', show);
    }
    if (show && o !== this._backFor) {
      this._backFor = o;
      this.backLabel.textContent = o.backLabel ?? 'Back';
    }
    // intro: the whole screen skips
    const g = this.game;
    const intro = g.state === 'race' && g.race?.phase === 'intro' && !g.paused && !this._portrait;
    if (intro !== this._skipOn) {
      this._skipOn = intro;
      this.skip.classList.toggle('is-on', intro);
    }
  }
}
