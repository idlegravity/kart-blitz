/**
 * Loading screen (Game.state === 'loading'): track name, outline map, spinning wheel and random tips.
 * Only transform/opacity animations so it keeps moving while the main thread builds the track.
 */
import { Screen } from './Screen.js';
import { h } from '../dom.js';
import { uiIcon } from '../icons.js';
import { trackMapSvg } from '../trackart.js';
import { PLATFORM } from '../../core/platform.js';

const TIPS = [
  'Hold <b>Drift</b> through a turn, then release when the sparks glow for a <b>mini-turbo</b>: blue, orange, purple!',
  'Tap the throttle just before <b>GO!</b> for a <b>Rocket Start</b>. Too early and your wheels will burn out.',
  'Hit a ramp and pull a <b>trick</b> in mid-air for a free burst of speed.',
  'Hold your item button to trail a <b>banana or orb</b> behind you as a shield, then release to throw it.',
  'The <b>Comet</b> hunts whoever is in first place. Leaders, keep an eye on the sirens!',
  '<b>Thunderbolt</b> shrinks every rival for a few seconds. Perfect time to slip past.',
  'Grab a <b>Super Star</b> to become invincible and blast through anything.',
  'Boost pads and <b>Nitro</b> stack with mini-turbos. Chain them for maximum speed.',
  'Staying on the road is fastest — grass and sand will slow you right down.',
  '<b>Golden Nitro</b> gives you unlimited boosts for a few precious seconds.',
  'In <b>Time Trial</b> you start with triple nitro. Save one for the final straight!',
  'Heavier racers hit harder and get knocked around less. Lighter ones accelerate faster.',
  'Some edges on <b>Neon Skyway</b> have no rails. Mind the gap!',
];

/** Phone wording: the on-screen buttons replace the key hints. */
const TOUCH_TIPS = {
  0: 'Hold the <b>Drift</b> button through a turn, then let go when the sparks glow for a <b>mini-turbo</b>: blue, orange, purple!',
  1: 'Steer with small, smooth thumb moves: they keep you on the <b>racing line</b>. Big jerks just scrub speed.',
  3: 'Hold the <b>Item</b> button to trail a <b>banana or orb</b> behind you as a shield, then release to throw it.',
};

export class LoadingScreen extends Screen {
  get backButton() {
    return false;
  }

  constructor(ui) {
    super(ui, 'loading', { layer: 'loading' });
    this._tipT = 0;
    this._tipIdx = -1;
  }

  build() {
    this.tag = h('div.pill.pill--tag');
    this.name = h('div.ld__name.fx', { 'data-text': '' });
    this.map = h('div.ld__map');
    this.tip = h('div.ld__tipText');
    this.root.append(
      h('div.ld__bg'),
      h('div.ld__stripes'),
      h('div.ld__center',
        this.tag,
        this.name,
        this.map,
        h('div.ld__status',
          h('div.ld__wheel', { html: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#15102e" stroke="#0a0620" stroke-width="3"/><circle cx="24" cy="24" r="13" fill="#3a3f6e" stroke="#0a0620" stroke-width="2.500"/><g stroke="#cfd6ff" stroke-width="3.400" stroke-linecap="round"><path d="M24 14v20M14 24h20M17 17l14 14M31 17 17 31"/></g><circle cx="24" cy="24" r="4" fill="#ffd23f" stroke="#0a0620" stroke-width="2"/></svg>' }),
          h('div.ld__label', 'Loading'),
          h('div.ld__dots', h('i'), h('i'), h('i'))),
        h('div.ld__bar', h('i'))),
      h('div.ld__tip.panel', h('div.ld__tipIcon', { html: uiIcon('tip') }), h('div.ld__tipBody', h('div.ld__tipHead', 'Pro tip'), this.tip)),
    );
  }

  hints() {
    return [];
  }

  onShow({ config, gp } = {}) {
    const g = this.game;
    const cfg = config ?? g.raceConfig ?? {};
    const track = g.trackList.find((t) => t.id === cfg.trackId) ?? g.trackList[0];
    const modeLabel = cfg.mode === 'gp' ? `Grand Prix${gp ? ` • Race ${gp.raceIndex + 1} of ${gp.trackIds.length}` : ''}` : cfg.mode === 'timetrial' ? 'Time Trial' : 'Quick Race';
    const np = cfg.players?.length ?? 1;
    this.tag.textContent = np > 1 ? `${modeLabel} \u2022 ${np} Players` : modeLabel;
    this.name.textContent = track.name.toUpperCase();
    this.name.dataset.text = track.name.toUpperCase();
    this.name.style.setProperty('--g', `linear-gradient(#fff, ${track.colors.primary} 70%)`);
    this.map.innerHTML = trackMapSvg(track.id, { road: track.colors.primary });
    this.root.style.setProperty('--c1', track.colors.primary);
    this.root.style.setProperty('--c2', track.colors.secondary);
    this._nextTip(true);
    this._tipT = 0;
  }

  _nextTip(first) {
    let i;
    do i = Math.floor(Math.random() * TIPS.length);
    while (i === this._tipIdx && TIPS.length > 1);
    this._tipIdx = i;
    this.tip.innerHTML = (PLATFORM.mobile && TOUCH_TIPS[i]) || TIPS[i];
    if (!first) {
      this.tip.classList.remove('is-swap');
      void this.tip.offsetWidth; // eslint-disable-line no-unused-expressions
      this.tip.classList.add('is-swap');
    }
  }

  update(dt) {
    if (!this.active) return;
    this._tipT += dt;
    if (this._tipT > 4.5) {
      this._tipT = 0;
      this._nextTip(false);
    }
  }

  hide() {
    if (!this.root || !this.active) return;
    this.active = false;
    this.root.classList.add('is-fading');
    clearTimeout(this._leaveTimer);
    this._leaveTimer = setTimeout(() => this.root.classList.remove('is-active', 'is-fading'), 360);
  }

  show(params) {
    if (this.root) this.root.classList.remove('is-fading');
    super.show(params);
  }

  onAction() {
    return true;
  }
}
