/**
 * Pause menu (overlay): Resume / Restart / Options / Quit (with a confirm step).
 * Shown by UIManager on GAME_PAUSE. Esc/P is handled by Game (toggles pause) — never here.
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h } from '../dom.js';
import { uiIcon } from '../icons.js';

const ITEMS = [
  { id: 'resume', label: 'Resume', sub: 'Back to the race', icon: 'play', accent: ['#7af79a', '#1fbf55'] },
  { id: 'restart', label: 'Restart', sub: 'Start this race over', icon: 'restart', accent: ['#ffd23f', '#ff9a1c'] },
  { id: 'options', label: 'Options', sub: 'Audio & graphics', icon: 'gear', accent: ['#c9a6ff', '#7a3ef0'] },
  { id: 'quit', label: 'Quit', sub: 'Leave the race', icon: 'exit', accent: ['#ff9c8a', '#ff3b3b'] },
];

export class PauseScreen extends Screen {
  constructor(ui) {
    super(ui, 'pause', { layer: 'overlay' });
    this.inputDelay = 0.15;
    this.view = 'menu';
  }

  build() {
    this.sub = h('div.pause__sub');
    const mk = (it, i) => h('div.btn.btn--sm.a-up', { style: { '--i': i + 1, '--accent': it.accent[0], '--accent2': it.accent[1] }, role: 'button' },
      h('div.btn__bg'), h('div.btn__shine'), h('div.btn__icon', { html: uiIcon(it.icon) }),
      h('div.btn__text', h('div.btn__label', it.label), h('div.btn__sub', it.sub)),
      h('div.btn__arrow', { html: uiIcon('chevron') }));
    this.buttons = ITEMS.map(mk);
    this.menuView = h('div.pause__list', this.buttons);

    // confirm view
    const cItems = [
      { id: 'keep', label: 'Keep Racing', sub: 'Return to the race', icon: 'play', accent: ['#7af79a', '#1fbf55'] },
      { id: 'yes', label: 'Quit Race', sub: 'Progress will be lost', icon: 'exit', accent: ['#ff9c8a', '#ff3b3b'] },
    ];
    this.confirmButtons = cItems.map(mk);
    this.confirmView = h('div.pause__confirm',
      h('div.pause__q', 'Quit to the main menu?'),
      h('div.pause__qsub', 'Your progress in this race will be lost.'),
      h('div.pause__list', this.confirmButtons));
    this.confirmView.style.display = 'none';

    this.panel = h('div.pause__panel.panel.a-pop',
      h('div.pause__head', h('div.pause__title.fx', { 'data-text': 'PAUSED' }, 'PAUSED'), this.sub),
      this.menuView, this.confirmView);
    this.root.append(h('div.pause__dim'), h('div.pause__center', this.panel));

    this.nav = new Nav(this.ui, { layout: 'list' });
    this.nav.setItems(this.buttons.map((el, i) => ({ el, onSelect: () => this.pick(ITEMS[i].id) })), 0);
    this.confirmNav = new Nav(this.ui, { layout: 'list' });
    this.confirmNav.setItems(this.confirmButtons.map((el, i) => ({ el, onSelect: () => this.confirmPick(cItems[i].id) })), 0);
    this.confirmNav.pointerEnabled = false;
  }

  hints() {
    // Esc / P / Start are owned by Game (they resume); Backspace / gamepad B step back one level
    return this.view === 'confirm'
      ? [{ action: 'navV', label: 'Choose' }, { action: 'confirm', label: 'Select' }, { action: 'backAlt', label: 'Back' }]
      : [{ action: 'navV', label: 'Navigate' }, { action: 'confirm', label: 'Select' }, { action: 'pause', label: 'Resume' }];
  }

  onShow(params, wasActive) {
    const g = this.game;
    const t = g.track?.name ?? '';
    const p = g.player;
    const np = g.views?.length ?? 1;
    this.sub.textContent = np > 1 ? `${t} \u2022 ${np} players` : `${t}${p && g.race ? ` • Lap ${Math.min(p.lap, g.race.laps)}/${g.race.laps}` : ''}`;
    if (!wasActive) this._setView('menu', params?.focus ?? 0);
    else this.nav.focus(params?.focus ?? 0, { silent: true, force: true });
  }

  _setView(view, focus = 0) {
    this.view = view;
    const conf = view === 'confirm';
    this.menuView.style.display = conf ? 'none' : '';
    this.confirmView.style.display = conf ? '' : 'none';
    this.nav.pointerEnabled = !conf;
    this.confirmNav.pointerEnabled = conf;
    if (conf) this.confirmNav.focus(0, { silent: true, force: true });
    else this.nav.focus(focus, { silent: true, force: true });
    this.ui.hintBar.set(this.hints());
  }

  onAction(action) {
    if (this.view === 'confirm') {
      if (action === 'back') {
        this._setView('menu', 3); // back onto "Quit"
        return true;
      }
      return this.confirmNav.action(action);
    }
    if (action === 'back') {
      // Esc is handled by Game (toggle pause); gamepad B resumes
      this.game.resume();
      return true;
    }
    return this.nav.action(action);
  }

  pick(id) {
    const g = this.game;
    switch (id) {
      case 'resume':
        g.resume();
        break;
      case 'restart':
        g.restartRace();
        break;
      case 'options':
        this.ui.openOverlay('pauseOptions', { back: 'pause' });
        break;
      case 'quit':
        this._setView('confirm');
        break;
      default:
    }
  }

  confirmPick(id) {
    if (id === 'yes') this.game.quitToMenu();
    else this._setView('menu', 3);
  }
}
