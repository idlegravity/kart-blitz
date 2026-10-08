/**
 * Engine class select (50 / 100 / 150 / 200cc) for Grand Prix and Quick Race.
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h } from '../dom.js';
import { uiIcon } from '../icons.js';
import { head } from '../parts.js';

const CLASSES = [
  { cc: 50, name: 'Relaxed', sub: 'Gentle speeds • easy rivals', accent: ['#7af79a', '#1fbf55'], angle: -62 },
  { cc: 100, name: 'Standard', sub: 'Balanced • fair rivals', accent: ['#6df3ff', '#1f9dff'], angle: -20 },
  { cc: 150, name: 'Fast', sub: 'Quick karts • sharp rivals', accent: ['#ffd23f', '#ff9a1c'], angle: 22 },
  { cc: 200, name: 'Insane', sub: 'Blistering • relentless rivals', accent: ['#ff8d8d', '#ff3b3b'], angle: 64 },
];

function gauge(angle) {
  return `<svg class="ico gauge" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8.400 37.500A20 20 0 1 1 39.600 37.500" stroke-width="4"/>
    <path d="M24 9v3.500M10.500 15.500l3 2M37.500 15.500l-3 2" stroke-width="3" opacity=".7"/>
    <g class="gauge__needle" style="transform-origin:24px 27px;transform:rotate(${angle}deg)"><path d="M24 27V13" stroke-width="4.200"/></g>
    <circle cx="24" cy="27" r="3.600" fill="currentColor" stroke="none"/>
  </svg>`;
}

export class CcScreen extends Screen {
  constructor(ui) {
    super(ui, 'cc');
  }

  build() {
    const mode = () => (this.ui.flow.mode === 'gp' ? 'Grand Prix' : 'Quick Race');
    this.headEl = head(mode(), 'Engine Class');
    const buttons = CLASSES.map((c, i) => {
      const bars = [];
      for (let k = 0; k < 4; k++) bars.push(h('i', { class: k <= i ? 'on' : '' }));
      return h('div.btn.a-left', { style: { '--i': i + 2, '--accent': c.accent[0], '--accent2': c.accent[1] }, role: 'button' },
        h('div.btn__bg'), h('div.btn__shine'),
        h('div.btn__icon', { html: gauge(c.angle) }),
        h('div.btn__text', h('div.btn__label.btn__label--num', `${c.cc}cc`), h('div.btn__sub', `${c.name} • ${c.sub.split(' • ')[1]}`)),
        h('div.speedbars', bars),
        h('div.btn__arrow', { html: uiIcon('chevron') }));
    });
    this.buttons = buttons;
    this.panel = h('div.menu-panel.panel.a-left', this.headEl, h('div.menu-list', buttons),
      h('div.menu-desc', 'Higher engine classes are faster — and so are the rivals.'));
    this.root.append(this.panel);
    this.nav = new Nav(this.ui, { layout: 'list' });
    this.nav.setItems(buttons.map((el, i) => ({ el, onSelect: () => this.pick(CLASSES[i].cc) })), 2);
  }

  hints() {
    return [{ action: 'navV', label: 'Navigate' }, { action: 'confirm', label: 'Select' }, { action: 'back', label: 'Back' }];
  }

  onShow() {
    this.ui.showroom('menu');
    const label = this.ui.flow.mode === 'gp' ? 'Grand Prix' : 'Quick Race';
    this.headEl.querySelector('.pill').textContent = label;
    // the persisted default class (Options can change it) wins over the in-memory flow value
    const cc = this.game.settings?.cc ?? this.ui.flow.cc;
    this.ui.flow.cc = cc;
    const idx = Math.max(0, CLASSES.findIndex((c) => c.cc === cc));
    this.nav.focus(idx, { silent: true, force: true });
  }

  pick(cc) {
    this.ui.flow.cc = cc;
    this.game.setSetting?.('cc', cc);
    this.ui.goto('character');
  }

  onBack() {
    this.ui.goto('main');
  }
}
