/**
 * Main menu: Grand Prix / Quick Race / Time Trial / Options / Controls. Panel on the left 40%.
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h, fromHTML } from '../dom.js';
import { uiIcon, LOGO_BOLT } from '../icons.js';

const ITEMS = [
  {
    id: 'gp', label: 'Grand Prix', sub: '4-race cup • points • trophies', icon: 'trophy', accent: ['#ffd23f', '#ff9a1c'],
    desc: 'Take on the <b>Nitro Cup</b>: four tracks, seven rivals, and a trophy for the best.',
  },
  {
    id: 'quick', label: 'Quick Race', sub: 'One race • any track', icon: 'flag', accent: ['#6df3ff', '#1f9dff'],
    desc: 'Pick a racer and a track, then <b>settle it</b> in a single race against seven CPUs.',
  },
  {
    id: 'timetrial', label: 'Time Trial', sub: 'Solo • chase your best', icon: 'stopwatch', accent: ['#7af79a', '#1fbf55'],
    desc: 'No rivals, no boxes, <b>triple nitro</b> from the start. Beat your record!',
  },
  {
    id: 'options', label: 'Options', sub: 'Audio • graphics • more', icon: 'gear', accent: ['#c9a6ff', '#7a3ef0'],
    desc: 'Volume, quality, FPS counter and your default <b>engine class</b>.',
  },
  {
    id: 'controls', label: 'Controls', sub: 'Keyboard & gamepad', icon: 'gamepad', accent: ['#ff9c8a', '#ff3b3b'],
    desc: 'See how to <b>drift</b>, use items and look back.',
  },
];

export class MainMenuScreen extends Screen {
  constructor(ui) {
    super(ui, 'main');
  }

  build() {
    this.desc = h('div.menu-desc');
    const buttons = ITEMS.map((it, i) =>
      h('div.btn.a-left', {
        style: { '--i': i + 2, '--accent': it.accent[0], '--accent2': it.accent[1] },
        role: 'button',
      },
      h('div.btn__bg'),
      h('div.btn__shine'),
      h('div.btn__icon', { html: uiIcon(it.icon) }),
      h('div.btn__text', h('div.btn__label', it.label), h('div.btn__sub', it.sub)),
      h('div.btn__arrow', { html: uiIcon('chevron') })));
    this.panel = h('div.menu-panel.panel.a-left',
      h('div.menu-head',
        fromHTML(`<div class="menu-head__bolt">${LOGO_BOLT}</div>`),
        h('div.menu-head__logo.fx', { 'data-text': 'KART BLITZ' }, 'KART BLITZ')),
      h('div.menu-list', buttons),
      this.desc);
    this.root.append(this.panel);
    this.nav = new Nav(this.ui, { layout: 'list' });
    this.nav.setItems(
      buttons.map((el, i) => ({
        el,
        onFocus: () => {
          this.desc.innerHTML = ITEMS[i].desc;
        },
        onSelect: () => this.select(ITEMS[i].id),
      })),
      0,
    );
  }

  hints() {
    return [{ action: 'navV', label: 'Navigate' }, { action: 'confirm', label: 'Select' }, { action: 'back', label: 'Title' }];
  }

  onShow() {
    this.ui.showroom('menu');
  }

  select(id) {
    const ui = this.ui;
    switch (id) {
      case 'gp':
      case 'quick':
        ui.flow.mode = id;
        ui.goto('cc');
        break;
      case 'timetrial':
        ui.flow.mode = 'timetrial';
        ui.goto('character');
        break;
      case 'options':
        ui.goto('options', { back: 'main' });
        break;
      case 'controls':
        ui.goto('controls');
        break;
      default:
    }
  }

  onBack() {
    this.ui.goto('title');
  }
}
