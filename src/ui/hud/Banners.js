/**
 * HUD centre stage: countdown, intro banner, FINAL LAP!, FINISH!, WRONG WAY, warnings and toasts.
 * All animation is Web Animations / CSS on transform+opacity.
 */
import { h, pop } from '../dom.js';
import { uiIcon, checkerSvg, actionGlyph } from '../icons.js';
import { ordinal } from '../../core/math.js';

const CD_STYLE = {
  3: 'linear-gradient(#ffe0dc, #ff6a5a 46%, #ff2b2b)',
  2: 'linear-gradient(#fff0c9, #ffb73a 48%, #ff8a1f)',
  1: 'linear-gradient(#fffbd1, #ffe45c 48%, #ffc21f)',
  0: 'linear-gradient(#f0fff3, #6ff58f 46%, #1fbf55)',
};

const PLACE_TEXT = ['', 'Champion!', 'Great race!', 'Nice one!', 'Good effort!', 'Keep going!', 'Keep at it!', 'Almost there!', 'Better luck next time!'];

export class Banners {
  constructor(hud) {
    this.hud = hud;
    this.game = hud.game;
    this.cdNum = h('div.cd__n.fx', { 'data-text': '3' }, '3');
    this.cdRing = h('div.cd__ring');
    this.cd = h('div.cd', this.cdRing, this.cdNum);

    this.introTag = h('div.pill.pill--tag');
    this.introName = h('div.intro__name.fx', { 'data-text': '' });
    this.introMeta = h('div.intro__meta');
    this.intro = h('div.intro', h('div.intro__band', this.introTag, this.introName, this.introMeta));

    this.finalEl = h('div.banner.banner--final',
      h('span.banner__bolt', { html: uiIcon('bolt') }),
      h('span.banner__t.fx.fx--red', { 'data-text': 'FINAL LAP!' }, 'FINAL LAP!'),
      h('span.banner__bolt', { html: uiIcon('bolt') }));

    this.finishSub = h('div.finish__sub');
    this.finishEl = h('div.banner.banner--finish',
      h('div.finish__flags', { html: checkerSvg() + checkerSvg() }),
      h('div.finish__t.fx.fx--gold', { 'data-text': 'FINISH!' }, 'FINISH!'),
      this.finishSub);

    this.wrongEl = h('div.banner.banner--wrong', h('span.wrong__ico', { html: uiIcon('arrowDown') }), h('span.wrong__t', 'WRONG WAY'), h('span.wrong__ico', { html: uiIcon('arrowDown') }));
    this.warnEl = h('div.banner.banner--warn', h('span.warn__ico', { html: uiIcon('siren') }), h('span.warn__t', 'COMET INCOMING!'), h('span.warn__ico', { html: uiIcon('siren') }));
    this.waitEl = h('div.wait-pill', 'Waiting for the other racers…');
    this.toasts = h('div.toasts');
    this.skipHint = h('div.skip-hint');
    this.el = h('div.hud-center', this.intro, this.cd, this.finalEl, this.finishEl, this.wrongEl, this.warnEl, this.waitEl, this.toasts, this.skipHint);
    this._timers = new Set();
    this._skipDevice = '';
  }

  clear() {
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    for (const el of [this.intro, this.cd, this.finalEl, this.finishEl, this.wrongEl, this.warnEl, this.waitEl, this.skipHint]) {
      el.classList.remove('is-on');
      el.getAnimations?.().forEach((a) => a.cancel());
    }
    this.toasts.textContent = '';
  }

  _later(ms, fn) {
    const t = setTimeout(() => {
      this._timers.delete(t);
      fn();
    }, ms);
    this._timers.add(t);
    return t;
  }

  // ------------------------------------------------------------------------------------------------
  countdown(count) {
    const go = count <= 0;
    const label = go ? 'GO!' : String(count);
    this.cdNum.textContent = label;
    this.cdNum.dataset.text = label;
    this.cdNum.style.setProperty('--g', CD_STYLE[Math.max(0, Math.min(3, count))]);
    this.cd.classList.add('is-on');
    this.cd.classList.toggle('is-go', go);
    this.cd.getAnimations().forEach((a) => a.cancel());
    // linear overall timing + per-keyframe easing: a punchy pop-in, a real hold, then a fast shrink-out
    this.cd.animate(
      go
        ? [
          { transform: 'scale(.3) rotate(-8deg)', opacity: 0, easing: 'cubic-bezier(.2,.9,.3,1.25)' },
          { transform: 'scale(1.25) rotate(2deg)', opacity: 1, offset: 0.2, easing: 'cubic-bezier(.3,0,.4,1)' },
          { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: 0.34, easing: 'linear' },
          { transform: 'scale(1.07)', opacity: 1, offset: 0.66, easing: 'cubic-bezier(.5,0,.9,.4)' },
          { transform: 'scale(1.9)', opacity: 0 },
        ]
        : [
          { transform: 'scale(2.6)', opacity: 0, easing: 'cubic-bezier(.15,.8,.3,1)' },
          { transform: 'scale(.94)', opacity: 1, offset: 0.17, easing: 'cubic-bezier(.3,0,.3,1)' },
          { transform: 'scale(1)', opacity: 1, offset: 0.28, easing: 'linear' },
          { transform: 'scale(1)', opacity: 1, offset: 0.74, easing: 'cubic-bezier(.5,0,.9,.5)' },
          { transform: 'scale(.55)', opacity: 0 },
        ],
      { duration: go ? 1300 : 980, easing: 'linear', fill: 'forwards' },
    );
    this.cdRing.getAnimations().forEach((a) => a.cancel());
    this.cdRing.animate([{ transform: 'scale(.4)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: go ? 900 : 700, easing: 'ease-out' });
    this.cdRing.style.setProperty('--rc', go ? '#3ee86b' : '#ffd23f');
  }

  // ------------------------------------------------------------------------------------------------
  showIntro({ track, config, gp }, { delay = 0 } = {}) {
    const mode = config?.mode;
    const tag = mode === 'gp' && gp ? `Grand Prix • Race ${gp.raceIndex + 1} of ${gp.trackIds.length}` : mode === 'timetrial' ? 'Time Trial' : 'Quick Race';
    const np = config?.players?.length ?? 1;
    this.introTag.textContent = np > 1 ? `${tag} \u2022 ${np} Players` : tag;
    const name = (track?.name ?? '').toUpperCase();
    this.introName.textContent = name;
    this.introName.dataset.text = name;
    const def = this.game.trackList?.find((t) => t.id === track?.id);
    if (def) this.introName.style.setProperty('--g', `linear-gradient(#ffffff, ${def.colors.primary} 75%)`);
    const laps = config?.laps ?? track?.laps ?? 3;
    const cc = mode === 'timetrial' ? 150 : config?.cc;
    this.introMeta.innerHTML = `<span>${laps} laps</span>${cc ? `<span>${cc}cc</span>` : ''}${def ? `<span>${'★'.repeat(def.difficulty)}${'☆'.repeat(4 - def.difficulty)}</span>` : ''}`;
    this.intro.style.transitionDelay = delay ? `${delay}s, 0s` : '0s, 0s';
    this.intro.classList.add('is-on');
    this.intro.classList.remove('is-out');
    this.skipHint.classList.add('is-on');
    this._renderSkip(true);
  }

  hideIntro() {
    if (!this.intro.classList.contains('is-on')) return;
    this.intro.classList.add('is-out');
    this.skipHint.classList.remove('is-on');
    this._later(600, () => this.intro.classList.remove('is-on', 'is-out'));
  }

  _renderSkip(force) {
    const dev = this.hud.ui.device;
    if (!force && dev === this._skipDevice) return;
    this._skipDevice = dev;
    this.skipHint.innerHTML = `${actionGlyph('skip', dev)}<span>Skip intro</span>`;
  }

  update() {
    if (this.skipHint.classList.contains('is-on')) this._renderSkip(false);
  }

  // ------------------------------------------------------------------------------------------------
  finalLap() {
    const el = this.finalEl;
    el.classList.add('is-on');
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: 'translateY(-1em) scale(3.2) rotate(-6deg)', opacity: 0, easing: 'cubic-bezier(.15,.8,.3,1)' },
        { transform: 'translateY(0) scale(.92) rotate(1deg)', opacity: 1, offset: 0.14, easing: 'cubic-bezier(.3,0,.3,1)' },
        { transform: 'scale(1.06)', opacity: 1, offset: 0.24, easing: 'ease-out' },
        { transform: 'scale(1)', opacity: 1, offset: 0.34, easing: 'linear' },
        { transform: 'scale(1)', opacity: 1, offset: 0.8, easing: 'cubic-bezier(.5,0,.9,.5)' },
        { transform: 'translateY(-3em) scale(.9)', opacity: 0 },
      ],
      { duration: 2200, easing: 'linear', fill: 'forwards' },
    ).onfinish = () => el.classList.remove('is-on');
  }

  finish(place) {
    const el = this.finishEl;
    this.finishSub.innerHTML = `<b>${ordinal(place)}</b> place • ${PLACE_TEXT[Math.min(8, place)] ?? ''}`;
    el.classList.add('is-on');
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(
      [
        { transform: 'scale(.2) rotate(-10deg)', opacity: 0, easing: 'cubic-bezier(.2,.9,.3,1.25)' },
        { transform: 'scale(1.18) rotate(2deg)', opacity: 1, offset: 0.14, easing: 'cubic-bezier(.3,0,.4,1)' },
        { transform: 'scale(1)', opacity: 1, offset: 0.24, easing: 'linear' },
        { transform: 'scale(1)', opacity: 1, offset: 0.86, easing: 'cubic-bezier(.5,0,.9,.5)' },
        { transform: 'translateY(-4em) scale(.85)', opacity: 0 },
      ],
      { duration: 3200, easing: 'linear', fill: 'forwards' },
    ).onfinish = () => {
      el.classList.remove('is-on');
      this.waitEl.classList.toggle('is-on', this.game.race.phase === 'finished');
    };
  }

  setWaiting(on) {
    this.waitEl.classList.toggle('is-on', on);
  }

  wrongWay(on) {
    this.wrongEl.classList.toggle('is-on', on);
  }

  warn(text, ms = 3200) {
    this.warnEl.querySelector('.warn__t').textContent = text;
    this.warnEl.classList.add('is-on');
    clearTimeout(this._warnT);
    this._warnT = this._later(ms, () => this.warnEl.classList.remove('is-on'));
  }

  clearWarn() {
    this.warnEl.classList.remove('is-on');
  }

  /** kind: 'info' | 'good' | 'warn' | 'best' */
  toast(text, { kind = 'info', icon = null, ms = 2000, sub = '' } = {}) {
    const el = h(`div.toast.toast--${kind}`,
      icon ? h('span.toast__ico', { html: uiIcon(icon) }) : null,
      h('span.toast__t', text),
      sub ? h('span.toast__s', sub) : null);
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    pop(el, { from: 0.4, duration: 380 });
    this._later(ms, () => {
      const a = el.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-1.6em)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
      a.onfinish = () => el.remove();
    });
  }
}
