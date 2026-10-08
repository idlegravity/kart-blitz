/**
 * Character select: 4x2 grid of racer cards (left ~55%), info + stat bars for the focused racer (top right),
 * turntable in the 3D showroom at ~70% width. Calls game.showroom.showCharacter(id) on focus change.
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h } from '../dom.js';
import { uiIcon, WEIGHT_META } from '../icons.js';
import { head, statBar, weightBadge } from '../parts.js';
import { CHARACTERS } from '../../data/characters.js';

const SPECIES = { fox: 'Fox', robot: 'Robot', bunny: 'Bunny', dino: 'Dino', penguin: 'Penguin', alien: 'Alien', bear: 'Bear', cat: 'Cat' };

export class CharacterScreen extends Screen {
  constructor(ui) {
    super(ui, 'character');
    this._built = false;
  }

  build() {
    this.headEl = head('Racer', 'Choose Your Racer');
    this.tagEl = this.headEl.querySelector('.pill');
    const cards = CHARACTERS.map((c, i) => {
      const meta = WEIGHT_META[c.weightClass] ?? WEIGHT_META.medium;
      const img = h('img.rc__img', { alt: c.name, draggable: 'false' });
      img.src = this.ui.portrait(c.id, 256);
      return h('div.rc.a-up', { style: { '--i': i + 2, '--c1': c.colors.primary, '--c2': c.colors.secondary, '--c3': c.colors.accent }, role: 'button' },
        h('div.rc__bg'),
        h('div.rc__port', img),
        h('div.rc__badge', { style: { '--wc': meta.color }, html: uiIcon(meta.icon), title: meta.label }),
        h('div.rc__name', c.name),
        h('div.rc__p1', 'P1'));
    });
    this.grid = h('div.sel-grid', cards);

    this.stats = {
      speed: statBar('Speed', '#ff5c5c'),
      accel: statBar('Accel', '#3ee86b'),
      handling: statBar('Handling', '#2de2ff'),
      weight: statBar('Weight', '#c39bff'),
    };
    this.nameEl = h('div.info__name.fx', { 'data-text': '' });
    this.metaEl = h('div.info__meta');
    this.tagline = h('div.info__tagline');
    this.info = h('div.sel-info.panel.a-right', { style: { '--d': '120ms' } },
      this.nameEl, this.metaEl, this.tagline,
      h('div.info__stats', Object.values(this.stats).map((s) => s.el)));

    this.root.append(this.headEl, this.grid, this.info);
    this.cards = cards;
    this.nav = new Nav(this.ui, { layout: 'grid', cols: 4 });
    this.nav.setItems(
      cards.map((el, i) => ({
        el,
        onFocus: (it, { silent }) => this.focusRacer(i, silent),
        onSelect: () => this.pick(i),
      })),
      0,
    );
  }

  hints() {
    return [{ action: 'nav', label: 'Choose' }, { action: 'confirm', label: 'Confirm' }, { action: 'back', label: 'Back' }];
  }

  onShow() {
    const f = this.ui.flow;
    const label = f.mode === 'gp' ? 'Grand Prix' : f.mode === 'timetrial' ? 'Time Trial' : 'Quick Race';
    this.tagEl.textContent = f.mode === 'timetrial' ? `${label} • 150cc` : `${label} • ${f.cc}cc`;
    const idx = Math.max(0, CHARACTERS.findIndex((c) => c.id === f.characterId));
    this.ui.showroom('select', { characterId: CHARACTERS[idx].id });
    this.nav.focus(idx, { silent: true, force: true });
    this.focusRacer(idx, true);
  }

  focusRacer(i, silent) {
    const c = CHARACTERS[i];
    // the initial silent focus while building must not clobber the remembered racer
    if (this.active || !silent) {
      this.ui.flow.characterId = c.id;
      this.ui.showroomCharacter(c.id);
    }
    this.nameEl.textContent = c.name;
    this.nameEl.dataset.text = c.name;
    this.nameEl.style.setProperty('--g', `linear-gradient(#fff, ${c.colors.primary} 62%, ${c.colors.primary})`);
    this.metaEl.innerHTML = `<span class="pill pill--species">${SPECIES[c.species] ?? c.species}</span>${weightBadge(c.weightClass)}`;
    this.tagline.textContent = `“${c.tagline}”`;
    for (const k of Object.keys(this.stats)) this.stats[k].set(c.stats[k]);
    // little re-pop of the name each time
    this.nameEl.classList.remove('is-pop');
    void this.nameEl.offsetWidth; // eslint-disable-line no-unused-expressions
    this.nameEl.classList.add('is-pop');
  }

  pick(i) {
    const f = this.ui.flow;
    f.characterId = CHARACTERS[i].id;
    this.ui.goto(f.mode === 'gp' ? 'cup' : 'track');
  }

  onBack() {
    this.ui.goto(this.ui.flow.mode === 'timetrial' ? 'main' : 'cc');
  }
}
