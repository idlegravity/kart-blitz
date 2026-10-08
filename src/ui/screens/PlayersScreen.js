/**
 * Players step (Grand Prix / Quick Race): how many humans share the screen, 1-4.
 * Each option shows a miniature of its split-screen layout in the player colours.
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h } from '../dom.js';
import { uiIcon } from '../icons.js';
import { head } from '../parts.js';
import { layoutDiagram } from '../split.js';

const OPTIONS = [
  { n: 1, label: '1 Player', sub: 'Full screen', accent: ['#ff8d8d', '#ff3b3b'], desc: 'Classic <b>solo racing</b> against seven CPU rivals.' },
  { n: 2, label: '2 Players', sub: 'Top & bottom', accent: ['#6df3ff', '#1f9dff'], desc: '<b>Split-screen</b> for two. Share one keyboard or plug in gamepads.' },
  { n: 3, label: '3 Players', sub: 'Three views + map', accent: ['#ffe27a', '#ff9a1c'], desc: 'Three views, with a big <b>live map and standings</b> in the fourth corner.' },
  { n: 4, label: '4 Players', sub: 'Four-way split', accent: ['#7af79a', '#1fbf55'], desc: 'Full house! Four views, <b>one shared minimap</b> in the middle.' },
];

export class PlayersScreen extends Screen {
  constructor(ui) {
    super(ui, 'players');
  }

  build() {
    this.headEl = head('Quick Race', 'Players');
    this.pill = this.headEl.querySelector('.pill');
    this.desc = h('div.menu-desc');
    const buttons = OPTIONS.map((o, i) =>
      h('div.btn.a-left', { style: { '--i': i + 2, '--accent': o.accent[0], '--accent2': o.accent[1] }, role: 'button' },
        h('div.btn__bg'), h('div.btn__shine'),
        h('div.btn__icon.btn__icon--layout', { html: layoutDiagram(o.n) }),
        h('div.btn__text', h('div.btn__label.btn__label--num', o.label), h('div.btn__sub', o.sub)),
        h('div.btn__arrow', { html: uiIcon('chevron') })));
    this.buttons = buttons;
    this.panel = h('div.menu-panel.panel.a-left', this.headEl, h('div.menu-list', buttons), this.desc);
    this.root.append(this.panel);
    this.nav = new Nav(this.ui, { layout: 'list' });
    this.nav.setItems(
      buttons.map((el, i) => ({
        el,
        onFocus: () => {
          this.desc.innerHTML = OPTIONS[i].desc;
        },
        onSelect: () => this.pick(OPTIONS[i].n),
      })),
      0,
    );
  }

  hints() {
    return [{ action: 'navV', label: 'Navigate' }, { action: 'confirm', label: 'Select' }, { action: 'back', label: 'Back' }];
  }

  onShow() {
    this.ui.showroom('menu');
    const f = this.ui.flow;
    this.pill.textContent = f.mode === 'gp' ? 'Grand Prix' : 'Quick Race';
    this.nav.focus(Math.max(0, Math.min(3, (f.players ?? 1) - 1)), { silent: true, force: true });
    this.desc.innerHTML = OPTIONS[this.nav.index].desc;
  }

  pick(n) {
    this.ui.flow.players = n;
    this.ui.savePrefs();
    this.ui.goto('cc');
  }

  onBack() {
    this.ui.goto('main');
  }
}
