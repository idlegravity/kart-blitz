/**
 * Cup select (Grand Prix): the Nitro Cup card with its four tracks. Confirm starts the Grand Prix.
 * The 3D showroom cycles through the cup's tracks while this screen is open.
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h } from '../dom.js';
import { uiIcon, trophySvg } from '../icons.js';
import { head, flames } from '../parts.js';
import { trackMapSvg } from '../trackart.js';

const CYCLE = 3.8;

export class CupScreen extends Screen {
  constructor(ui) {
    super(ui, 'cup');
    this._t = 0;
    this._idx = 0;
    this._cup = null;
  }

  build() {
    const g = this.game;
    this.headEl = head('Grand Prix', 'Choose a Cup');
    this.cupCards = g.cups.map((cup, ci) => {
      const tracks = cup.trackIds.map((id) => g.trackList.find((t) => t.id === id)).filter(Boolean);
      const thumbs = tracks.map((t, i) =>
        h('div.cup__t', { dataset: { track: t.id } },
          h('span.cup__n', String(i + 1)),
          h('div.cup__map', { html: trackMapSvg(t.id, { road: t.colors.primary }) }),
          h('span.cup__tn', t.name)));
      const avg = Math.round(tracks.reduce((a, t) => a + t.difficulty, 0) / Math.max(1, tracks.length));
      const el = h('div.cup.a-left', { style: { '--i': ci + 2 }, role: 'button' },
        h('div.cup__bg'),
        h('div.cup__shine'),
        h('div.cup__top',
          h('div.cup__trophy', { html: trophySvg('gold') }),
          h('div.cup__main',
            h('div.cup__name.fx', { 'data-text': cup.name.toUpperCase() }, cup.name.toUpperCase()),
            h('div.cup__sub', `${tracks.length} races • points for every place`),
            h('div.cup__diff', { html: `<span>Difficulty</span>${flames(avg, 4)}` }))),
        h('div.cup__tracks', thumbs),
        h('div.cup__go', { html: `<span>Start Grand Prix</span>${uiIcon('chevron')}` }));
      el._thumbs = thumbs;
      el._tracks = tracks;
      return el;
    });
    this.list = h('div.cup-list', this.cupCards);
    this.panel = h('div.cup-panel.panel.a-left', this.headEl, this.list);
    this.root.append(this.panel);
    this.nav = new Nav(this.ui, { layout: 'list' });
    this.nav.setItems(
      this.cupCards.map((el, i) => ({
        el,
        onFocus: () => {
          this._cup = this.game.cups[i];
          this._idx = 0;
          this._t = 0;
          this._showTrack();
        },
        onSelect: () => this.start(i),
      })),
      0,
    );
  }

  hints() {
    return [{ action: 'confirm', label: 'Start' }, { action: 'back', label: 'Back' }];
  }

  onShow() {
    this._cup = this.game.cups[Math.max(0, this.nav.index)] ?? this.game.cups[0];
    this._idx = 0;
    this._t = 0;
    this._showTrack();
  }

  _showTrack() {
    const cup = this._cup;
    if (!cup) return;
    const id = cup.trackIds[this._idx % cup.trackIds.length];
    this.ui.showroom('track', { trackId: id });
    const el = this.cupCards[Math.max(0, this.nav.index)];
    el?._thumbs?.forEach((t) => t.classList.toggle('is-now', t.dataset.track === id));
  }

  update(dt) {
    if (!this.active || !this._cup) return;
    this._t += dt;
    if (this._t >= CYCLE) {
      this._t = 0;
      this._idx = (this._idx + 1) % this._cup.trackIds.length;
      this._showTrack();
    }
  }

  start(i) {
    const cup = this.game.cups[i];
    this.ui.flow.cupId = cup.id;
    this.ui.flow.mode = 'gp';
    this.ui.startFromFlow();
  }

  onBack() {
    this.ui.goto(this.ui.racerScreen, { keep: true });
  }
}
