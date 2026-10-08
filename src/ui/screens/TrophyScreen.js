/**
 * Trophy ceremony (GP_COMPLETE): podium in the 3D showroom, trophy tier from the player's final place,
 * final standings list, Continue → main menu.
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h } from '../dom.js';
import { uiIcon, trophySvg } from '../icons.js';
import { getCharacter } from '../../data/characters.js';
import { playerColor, playerTag } from '../split.js';
import { ordinal } from '../../core/math.js';

const TIERS = [
  { tier: 'gold', head: 'CHAMPION!', sub: (cup) => `You won the ${cup}!`, g: 'linear-gradient(#fff7c2, #ffd23f 50%, #ff8a1f)' },
  { tier: 'silver', head: 'RUNNER-UP!', sub: (cup) => `So close! Second place in the ${cup}.`, g: 'linear-gradient(#ffffff, #dfe7f6 50%, #93a3c4)' },
  { tier: 'bronze', head: 'ON THE PODIUM!', sub: (cup) => `Third place in the ${cup}. Well raced!`, g: 'linear-gradient(#ffe6cb, #f2984c 50%, #b05a1e)' },
];
const PARTICIPATION = { tier: 'participation', head: 'CUP COMPLETE!', sub: (cup, place) => `You finished ${place}th in the ${cup}. Keep racing!`, g: 'linear-gradient(#e6f4ff, #7cc8ff 50%, #4a7bff)' };
const CONFETTI = ['#ffd23f', '#ff3b3b', '#2de2ff', '#3ee86b', '#9b5cff', '#ff5fb0', '#ffffff'];

export class TrophyScreen extends Screen {
  constructor(ui) {
    super(ui, 'trophy');
    this.inputDelay = 0.6;
  }

  build() {
    this.cupPill = h('div.pill.pill--tag');
    this.trophy = h('div.tro__trophy');
    this.headEl = h('div.tro__head.fx.fx--big', { 'data-text': '' });
    this.subEl = h('div.tro__sub');
    this.humansEl = h('div.tro__humans');
    this.rays = h('div.tro__rays');
    this.list = h('div.tro__list.panel.a-left');
    this.confetti = h('div.res__confetti');
    this.btn = h('div.btn.a-up', { style: { '--i': 6, '--accent': '#7af79a', '--accent2': '#1fbf55' }, role: 'button' },
      h('div.btn__bg'), h('div.btn__shine'), h('div.btn__icon', { html: uiIcon('home') }),
      h('div.btn__text', h('div.btn__label', 'Continue'), h('div.btn__sub', 'Back to the main menu')),
      h('div.btn__arrow', { html: uiIcon('chevron') }));
    this.root.append(
      this.rays, this.confetti,
      h('div.tro__top', h('div.tro__hero', this.trophy, h('div.tro__text', this.cupPill, this.headEl, this.subEl, this.humansEl))),
      this.list,
      h('div.tro__cta', this.btn));
    this.nav = new Nav(this.ui, { layout: 'list' });
    this.nav.setItems([{ el: this.btn, onSelect: () => this.done() }], 0);
  }

  hints() {
    return [{ action: 'confirm', label: 'Continue' }];
  }

  onShow(params = {}) {
    const g = this.game;
    const standings = params.standings?.length ? params.standings : g.getGpStandings();
    const cup = params.cupName ?? g.gp?.cupName ?? 'Nitro Cup';
    const cfgPlayers = g.raceConfig?.players?.length ? g.raceConfig.players : [{ characterId: g.raceConfig?.characterId }];
    const piOf = (s) => (Number.isInteger(s.playerIndex) && s.playerIndex >= 0 ? s.playerIndex : Math.max(0, cfgPlayers.findIndex((p) => p.characterId === s.characterId)));
    const isHuman = (s) => s.isPlayer || cfgPlayers.some((p) => p.characterId === s.characterId);
    const humans = standings.map((s, i) => ({ s, i, pi: piOf(s) })).filter((x) => isHuman(x.s));
    const multi = humans.length > 1;
    let idx = humans.length ? humans[0].i : standings.length; // trophy tier: the best human
    const place = idx + 1;
    const t = TIERS[idx] ?? PARTICIPATION;
    const top3 = standings.slice(0, 3).map((s) => s.characterId);
    this.ui.showroom('podium', { characterIds: top3 });

    this.cupPill.textContent = cup;
    this.trophy.innerHTML = trophySvg(t.tier);
    this.headEl.textContent = t.head;
    this.headEl.dataset.text = t.head;
    this.headEl.style.setProperty('--g', t.g);
    if (multi) {
      const best = humans[0];
      const tag = playerTag(best.pi);
      const sub = idx === 0 ? `${tag} won the ${cup}!` : idx === 1 ? `${tag} took second in the ${cup}.` : idx === 2 ? `${tag} made the podium in the ${cup}.` : `${tag} led the humans in the ${cup}.`;
      this.subEl.textContent = sub;
    } else this.subEl.textContent = t.sub(cup, place);
    this.humansEl.textContent = '';
    if (multi) {
      for (const x of humans) this.humansEl.append(h('span.tro__hc', { style: { '--pc': playerColor(x.pi) } }, h('span.ptag', playerTag(x.pi)), ordinal(x.i + 1)));
    }
    this.root.dataset.tier = t.tier;

    this.list.textContent = '';
    this.list.append(h('div.tro__lh', 'Final standings'));
    standings.forEach((s, i) => {
      const c = getCharacter(s.characterId);
      const img = h('img', { alt: '', draggable: 'false' });
      img.src = this.ui.portrait(s.characterId, 128);
      const hu = isHuman(s);
      const pi = hu ? piOf(s) : -1;
      this.list.append(h(`div.tro__row.a-left${hu ? '.is-player' : ''}${hu && multi ? '.is-human' : ''}`, { style: { '--i': i + 2, '--c': c.colors.primary, '--pc': pi >= 0 ? playerColor(pi) : 'transparent' } },
        h('span.tro__n', i < 3 ? h(`span.medal.medal--${i + 1}`, String(i + 1)) : h('span.pnum', String(i + 1))),
        h('span.tro__p', img),
        h('span.tro__name', c.name, hu && multi ? h('span.ptag', playerTag(pi)) : null),
        h('span.tro__pts', `${s.points}`, h('small', 'pts'))));
    });
    this._confetti(place);
  }

  _confetti(place) {
    this.confetti.textContent = '';
    const n = place === 1 ? 70 : place <= 3 ? 40 : 14;
    for (let i = 0; i < n; i++) {
      this.confetti.appendChild(h('i', {
        style: {
          left: `${Math.random() * 100}%`,
          background: CONFETTI[i % CONFETTI.length],
          animationDelay: `${Math.random() * 2.4}s`,
          animationDuration: `${2.8 + Math.random() * 2.4}s`,
          '--dx': `${(Math.random() - 0.5) * 18}em`,
          '--rot': `${360 + Math.random() * 720}deg`,
          width: `${0.6 + Math.random() * 0.7}em`,
          height: `${1 + Math.random() * 0.9}em`,
        },
      }));
    }
  }

  done() {
    this.game.quitToMenu(); // clears the GP state (already in the 'menu' state)
    this.ui.goto('main');
  }

  onAction(action) {
    if (action === 'back') return true;
    return this.nav.action(action);
  }

  onHide() {
    this.confetti.textContent = '';
  }
}
