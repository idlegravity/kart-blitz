/**
 * Results overlay (RACE_RESULTS): animated table (place, portrait, name, time / best lap, GP points),
 * player summary card, Time Trial record card, and the Grand Prix standings page with an animated re-sort.
 *
 *  - Grand Prix:  Standings → [Next Race | Final Standings] / Retry Race / Quit
 *  - Quick Race:  Race Again / Change Track / Main Menu
 *  - Time Trial:  Retry / Change Track / Main Menu
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h, clamp, lerp, easeOutCubic, pop } from '../dom.js';
import { uiIcon } from '../icons.js';
import { fmtTime } from '../parts.js';
import { placeGradient, suffix } from '../placeStyle.js';
import { playerColor, playerTag, playerIndexOf } from '../split.js';

const STEP = 4.7; // em between rows (kept in sync with CSS)

const CONFETTI_COLORS = ['#ffd23f', '#ff3b3b', '#2de2ff', '#3ee86b', '#9b5cff', '#ff5fb0', '#ffffff'];

export class ResultsScreen extends Screen {
  get backButton() {
    return false;
  }

  constructor(ui) {
    super(ui, 'results', { layer: 'overlay' });
    this.inputDelay = 0.8;
    this.page = 'race';
    this.anim = null;
    this.count = null;
    this.rows = [];
    this.results = [];
  }

  build() {
    this.pill = h('div.pill.pill--tag');
    this.title = h('div.res__title.fx', { 'data-text': 'RESULTS' }, 'RESULTS');
    this.subEl = h('div.res__sub');
    this.table = h('div.res__table');
    this.ttBox = h('div.res__tt');
    this.left = h('div.res__left.panel.a-left', h('div.res__head', h('div.res__hl', this.pill, this.title), this.subEl), this.table, this.ttBox);
    this.you = h('div.res__you.panel.a-right', { style: { '--d': '150ms' } });
    this.btnBox = h('div.res__btns');
    this.confetti = h('div.res__confetti');
    this.root.append(h('div.res__dim'), this.confetti, h('div.res__wrap', this.left, h('div.res__right', this.you, this.btnBox)));
    this.nav = new Nav(this.ui, { layout: 'list' });
  }

  hints() {
    return [{ action: 'navV', label: 'Navigate' }, { action: 'confirm', label: 'Select' }];
  }

  // ==================================================================================================
  onShow(payload) {
    if (!payload || !payload.results) return;
    const g = this.game;
    const cfg = payload.config ?? g.raceConfig ?? {};
    this.results = payload.results;
    this.config = cfg;
    this.record = payload.record ?? null;
    this.mode = cfg.mode ?? 'quick';
    this.page = 'race';
    this.anim = null;
    // keep the menu flow in sync so "Change Track" lands on the right screen with the right racer
    const f = this.ui.flow;
    f.mode = this.mode;
    f.characterId = cfg.characterId ?? f.characterId;
    if (cfg.players?.length) {
      f.players = cfg.players.length;
      f.slots = cfg.players.map((p) => ({ characterId: p.characterId, device: p.device }));
    }
    f.trackId = cfg.trackId ?? f.trackId;
    f.cc = cfg.cc ?? f.cc;

    const track = g.trackList.find((t) => t.id === cfg.trackId) ?? g.track;
    const gp = g.gp;
    this.pill.textContent =
      this.mode === 'gp' && gp ? `Grand Prix • Race ${gp.raceIndex + 1} of ${gp.trackIds.length}` : this.mode === 'timetrial' ? 'Time Trial' : `Quick Race • ${cfg.cc}cc`;
    this._setTitle('RESULTS');
    this.subEl.textContent = track?.name ?? '';
    this.root.dataset.mode = this.mode;
    this.table.dataset.mode = this.mode;
    this.table.dataset.page = 'race';

    const humans = this.results.filter((r) => r.isPlayer).sort((a, b) => this._pi(a) - this._pi(b));
    this.humans = humans;
    this.multi = humans.length > 1;
    this.root.classList.toggle('is-multi', this.multi);
    this.you.classList.toggle('res__you--multi', this.multi);
    const player = humans.slice().sort((a, b) => a.place - b.place)[0]; // 1P: the player; split: the best human
    if (this.mode === 'timetrial') {
      this.table.style.display = 'none';
      this.ttBox.style.display = '';
      this._buildTimeTrial(player);
      this.you.style.display = 'none';
    } else {
      this.table.style.display = '';
      this.ttBox.style.display = 'none';
      this.you.style.display = '';
      this._buildRows();
      if (this.multi) this._buildYouMulti();
      else this._buildYou(player);
    }
    this._setButtons(this._raceButtons());
    this._confetti(player);
  }

  /** Player index (0..3) of a human result row. */
  _pi(r) {
    return playerIndexOf(r, this.config);
  }

  _setTitle(text) {
    this.title.textContent = text;
    this.title.dataset.text = text;
  }

  // ------------------------------------------------------------------------------------------------
  _buildRows() {
    this.table.textContent = '';
    this.table.style.height = `calc(${this.results.length} * var(--rstep, ${STEP}em))`; // --rstep: phones use shorter rows
    this.rows = this.results.map((r, i) => {
      const img = h('img', { alt: '', draggable: 'false' });
      img.src = this.ui.portrait(r.characterId, 128);
      const color = r.kart?.character?.colors?.primary ?? '#ffffff';
      const cells = {
        place: h('div.rr__place'),
        time: h('div.rr__c.c-time'),
        best: h('div.rr__c.c-best'),
        pts: h('div.rr__c.c-pts'),
        total: h('div.rr__c.c-total'),
        delta: h('div.rr__c.c-delta'),
      };
      const inner = h('div.rr__in.a-right', { style: { '--i': i } },
        cells.place, h('div.rr__port', img), this._nameCell(r), cells.time, cells.best, cells.pts, cells.total, cells.delta);
      const pi = r.isPlayer ? this._pi(r) : -1;
      const el = h(`div.rr${r.isPlayer ? '.is-player' : ''}${this.multi && r.isPlayer ? '.is-human' : ''}`, { style: { '--r': i, '--c': color, '--pc': pi >= 0 ? playerColor(pi) : 'transparent' } }, inner);
      this.table.appendChild(el);
      const prev = (r.totalPoints ?? 0) - (r.points ?? 0);
      const row = { r, el, inner, cells, prev, total: r.totalPoints ?? 0, prevRank: i, newRank: i };
      this._setPlaceCell(cells.place, r.place);
      cells.time.textContent = r.estimated ? '—' : fmtTime(r.time);
      cells.time.classList.toggle('is-est', !!r.estimated);
      cells.best.textContent = Number.isFinite(r.bestLap) ? fmtTime(r.bestLap) : '—';
      cells.pts.textContent = r.points ? `+${r.points}` : '+0';
      row.__v = this.mode === 'gp' ? prev : row.total;
      cells.total.textContent = String(row.__v);
      return row;
    });
    // Grand Prix: the running total counts up from the previous total once the rows have slid in
    this.count = this.mode === 'gp' ? { t: 0 } : null;
  }

  _nameCell(r) {
    if (!(this.multi && r.isPlayer)) return h('div.rr__name', r.name);
    const pi = this._pi(r);
    return h('div.rr__name.rr__name--tagged', h('span', r.name), h('span.ptag', { style: { '--pc': playerColor(pi) } }, playerTag(pi)));
  }

  _setPlaceCell(el, place) {
    el.innerHTML = place <= 3 ? `<span class="medal medal--${place}">${place}</span>` : `<span class="pnum">${place}</span>`;
  }

  _buildYou(p) {
    if (!p) {
      this.you.textContent = '';
      return;
    }
    const n = String(p.place);
    const gp = this.mode === 'gp';
    this.you.style.setProperty('--g', placeGradient(p.place));
    this.you.innerHTML = `
      <div class="you__label">Your result</div>
      <div class="you__place"><span class="fx fx--big you__n" data-text="${n}">${n}</span><span class="fx fx--big you__s" data-text="${suffix(p.place)}">${suffix(p.place)}</span></div>
      <div class="you__stats">
        <div class="you__s1"><span>Time</span><b>${p.estimated ? '—' : fmtTime(p.time)}</b></div>
        <div class="you__s1"><span>Best lap</span><b>${Number.isFinite(p.bestLap) ? fmtTime(p.bestLap) : '—'}</b></div>
        ${gp ? `<div class="you__s1 you__s1--pts"><span>Points</span><b>+${p.points ?? 0}</b></div>` : ''}
      </div>`;
    pop(this.you.querySelector('.you__place'), { from: 0.5, duration: 700 });
  }

  /** Split-screen: one compact card per human (place, time) instead of the single "your result" card. */
  _buildYouMulti() {
    const gp = this.mode === 'gp';
    const cards = this.humans.map((p, i) => {
      const pi = this._pi(p);
      const n = String(p.place);
      return `<div class="yc" style="--pc:${playerColor(pi)};--i:${i};--g:${placeGradient(p.place)}">
        <div class="yc__top"><span class="ptag">${playerTag(pi)}</span><span class="yc__nm">${p.name}</span></div>
        <div class="yc__place"><span class="fx fx--big" data-text="${n}" style="--g:${placeGradient(p.place)}">${n}</span><span class="fx fx--big" data-text="${suffix(p.place)}" style="--g:${placeGradient(p.place)}">${suffix(p.place)}</span></div>
        <div class="yc__time">${p.estimated ? '\u2014' : fmtTime(p.time)}${gp ? ` &nbsp;<b>+${p.points ?? 0}</b>` : ''}</div>
      </div>`;
    });
    this.you.style.removeProperty('--g');
    this.you.innerHTML = `<div class="you__label">Results</div><div class="yous" data-n="${this.humans.length}">${cards.join('')}</div>`;
  }

  _buildTimeTrial(p) {
    const rec = this.record;
    const total = p?.time ?? rec?.total ?? 0;
    const laps = p?.lapTimes ?? [];
    const bestLap = laps.length ? Math.min(...laps) : Infinity;
    const first = rec && !Number.isFinite(rec.prevBestTotal);
    let delta = '';
    if (rec && Number.isFinite(rec.prevBestTotal)) {
      const d = total - rec.prevBestTotal;
      delta = `<div class="tt__delta ${d < 0 ? 'is-good' : 'is-bad'}"><span>${d < 0 ? 'Faster than your best by' : 'Slower than your best by'}</span><b>${d < 0 ? '-' : '+'}${Math.abs(d).toFixed(3)}s</b><em>Previous best ${fmtTime(rec.prevBestTotal)}</em></div>`;
    } else if (first) delta = '<div class="tt__delta is-good"><span>First record on this track!</span></div>';
    this.ttBox.innerHTML = `
      <div class="tt__main">
        <div class="tt__label">Total time</div>
        <div class="tt__time">${fmtTime(total)}</div>
        ${rec?.newTotalRecord ? '<div class="tt__ribbon"><span>NEW RECORD!</span></div>' : ''}
      </div>
      ${delta}
      <div class="tt__laps">
        ${laps.map((t, i) => `<div class="tt__lap${t === bestLap ? ' is-best' : ''}"><span>Lap ${i + 1}</span><b>${fmtTime(t)}</b>${t === bestLap ? `<i>${rec?.newLapRecord ? 'NEW LAP RECORD' : 'BEST'}</i>` : ''}</div>`).join('')}
      </div>`;
    this.ttBox.classList.remove('a-pop');
    void this.ttBox.offsetWidth; // eslint-disable-line no-unused-expressions
    this.ttBox.classList.add('a-pop');
  }

  // ------------------------------------------------------------------------------------------------
  _raceButtons() {
    const g = this.game;
    const A = {
      green: ['#7af79a', '#1fbf55'], yellow: ['#ffd23f', '#ff9a1c'], cyan: ['#6df3ff', '#1f9dff'], red: ['#ff9c8a', '#ff3b3b'], purple: ['#c9a6ff', '#7a3ef0'],
    };
    if (this.mode === 'gp') {
      return [
        { label: 'Standings', sub: 'Grand Prix points', icon: 'trophy', accent: A.yellow, run: () => this.showStandings() },
        { label: 'Retry Race', sub: 'Points from this race reset', icon: 'restart', accent: A.green, run: () => g.restartRace() },
        { label: 'Quit', sub: 'Leave the Grand Prix', icon: 'exit', accent: A.red, run: () => g.quitToMenu() },
      ];
    }
    return [
      { label: this.mode === 'timetrial' ? 'Retry' : 'Race Again', sub: this.multi ? 'Same track, same racers' : 'Same track, same racer', icon: 'restart', accent: A.green, run: () => g.restartRace() },
      { label: 'Change Track', sub: 'Pick another course', icon: 'flag', accent: A.cyan, run: () => this._toTrackSelect() },
      { label: 'Main Menu', sub: 'Back to the start', icon: 'home', accent: A.red, run: () => g.quitToMenu() },
    ];
  }

  _standingsButtons() {
    const g = this.game;
    const last = g.isLastGpRace;
    const nextTrack = !last && g.gp ? g.trackList.find((t) => t.id === g.gp.trackIds[g.gp.raceIndex + 1]) : null;
    return [
      {
        label: last ? 'Final Standings' : 'Next Race',
        sub: last ? 'Trophy ceremony' : `${nextTrack?.name ?? 'Continue'} • Race ${g.gp.raceIndex + 2} of ${g.gp.trackIds.length}`,
        icon: last ? 'trophy' : 'play',
        accent: ['#7af79a', '#1fbf55'],
        run: () => g.nextRace(),
      },
      { label: 'Retry Race', sub: 'Points from this race reset', icon: 'restart', accent: ['#ffd23f', '#ff9a1c'], run: () => g.restartRace() },
      { label: 'Quit', sub: 'Leave the Grand Prix', icon: 'exit', accent: ['#ff9c8a', '#ff3b3b'], run: () => g.quitToMenu() },
    ];
  }

  _toTrackSelect() {
    this.ui.forceScreen('track');
    this.game.quitToMenu();
  }

  _setButtons(defs) {
    this.btnBox.textContent = '';
    const els = defs.map((d, i) => {
      const el = h('div.btn.btn--sm.a-right', { style: { '--i': i + 3, '--accent': d.accent[0], '--accent2': d.accent[1] }, role: 'button' },
        h('div.btn__bg'), h('div.btn__shine'), h('div.btn__icon', { html: uiIcon(d.icon) }),
        h('div.btn__text', h('div.btn__label', d.label), h('div.btn__sub', d.sub)),
        h('div.btn__arrow', { html: uiIcon('chevron') }));
      this.btnBox.appendChild(el);
      return el;
    });
    this.nav.setItems(els.map((el, i) => ({ el, onSelect: () => defs[i].run() })), 0);
  }

  // ==================================================================================================
  // Grand Prix standings page
  // ==================================================================================================
  showStandings() {
    if (this.page === 'gp') return;
    this.page = 'gp';
    const g = this.game;
    const rows = this.rows;
    const standings = g.getGpStandings();
    // "before" order = standings before this race's points; ties keep the race-result order (no jump on race 1)
    const prevOrder = [...rows].sort((a, b) => b.prev - a.prev || a.r.place - b.r.place);
    prevOrder.forEach((row, i) => (row.prevRank = i));
    const newIds = standings.map((s) => s.characterId);
    rows.forEach((row) => {
      const idx = newIds.indexOf(row.r.characterId);
      row.newRank = idx >= 0 ? idx : row.prevRank;
    });
    // stable fallback if the standings list lacked someone
    const used = new Set();
    [...rows].sort((a, b) => a.newRank - b.newRank).forEach((row, i) => {
      row.newRank = i;
      used.add(i);
    });

    const last = g.isLastGpRace;
    this._setTitle(last ? 'FINAL POINTS' : 'STANDINGS');
    this.count = null;
    this.table.dataset.page = 'gp';
    // cut (no spring) to the "before" order, then let the rows spring into the new order
    this.table.classList.add('is-snap');
    for (const row of rows) {
      row.el.style.setProperty('--r', row.prevRank);
      this._setPlaceCell(row.cells.place, row.prevRank + 1);
      row.cells.total.textContent = String(row.total);
      row.__v = row.total;
      row.cells.pts.textContent = `+${row.r.points ?? 0}`;
      row.cells.delta.textContent = '';
      row.inner.classList.remove('a-right');
      row.inner.style.animation = 'none';
    }
    void this.table.offsetWidth; // eslint-disable-line no-unused-expressions
    this.table.classList.remove('is-snap');
    // the player summary becomes a "points" card
    const p = this.humans?.[0];
    if (this.multi) {
      const cards = this.humans.map((hp, i) => {
        const pi = this._pi(hp);
        return `<div class="yc" style="--pc:${playerColor(pi)};--i:${i}">
          <div class="yc__top"><span class="ptag">${playerTag(pi)}</span><span class="yc__nm">${hp.name}</span></div>
          <div class="yc__place"><span class="fx fx--big" data-text="${hp.totalPoints}">${hp.totalPoints}</span><small>pts</small></div>
          <div class="yc__time"><b>+${hp.points ?? 0}</b> this race</div>
        </div>`;
      });
      this.you.innerHTML = `<div class="you__label">Points \u2022 Race ${g.gp.raceIndex + 1} / ${g.gp.trackIds.length}</div><div class="yous" data-n="${this.humans.length}">${cards.join('')}</div>`;
    } else if (p) {
      this.you.style.setProperty('--g', placeGradient(1));
      this.you.innerHTML = `
        <div class="you__label">Your points</div>
        <div class="you__pts"><span class="fx fx--big" data-text="${p.totalPoints}">${p.totalPoints}</span><small>pts</small></div>
        <div class="you__stats"><div class="you__s1 you__s1--pts"><span>This race</span><b>+${p.points ?? 0}</b></div>
        <div class="you__s1"><span>Race</span><b>${g.gp.raceIndex + 1} / ${g.gp.trackIds.length}</b></div></div>`;
      pop(this.you, { from: 0.92, duration: 500 });
    }
    this._setButtons(this._standingsButtons());
    this.anim = { t: 0, stage: 0, count: 0 };
    this.animating = true;
  }

  finishAnim() {
    const a = this.anim;
    if (!a) return;
    for (const row of this.rows) {
      row.el.style.setProperty('--r', row.newRank);
      this._setPlaceCell(row.cells.place, row.newRank + 1);
      this._setDelta(row);
    }
    this.anim = null;
    this.animating = false;
  }

  _setDelta(row) {
    const d = row.prevRank - row.newRank;
    row.cells.delta.className = `rr__c c-delta ${d > 0 ? 'is-up' : d < 0 ? 'is-down' : 'is-same'}`;
    row.cells.delta.innerHTML = d > 0 ? `${uiIcon('arrowUp')}<b>${d}</b>` : d < 0 ? `${uiIcon('arrowDown')}<b>${-d}</b>` : '<b>–</b>';
  }

  update(dt) {
    if (!this.active) return;
    // page 1 (Grand Prix): running totals count up from the previous total
    const c = this.count;
    if (c) {
      c.t += dt;
      const k = clamp((c.t - 1.15) / 0.85, 0, 1);
      if (k > 0) {
        const e = easeOutCubic(k);
        for (const row of this.rows) {
          const v = Math.round(lerp(row.prev, row.total, e));
          if (row.__v !== v) {
            row.__v = v;
            row.cells.total.textContent = String(v);
          }
        }
        if (k >= 1) this.count = null;
      }
    }
    // page 2: rows spring into the new order, then the rank-change arrows pop
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    if (a.stage === 0 && a.t > 0.6) {
      a.stage = 1;
      a.t0 = a.t;
      for (const row of this.rows) {
        row.el.style.setProperty('--r', row.newRank);
        this._setPlaceCell(row.cells.place, row.newRank + 1);
      }
    }
    if (a.stage === 1 && a.t - a.t0 > 0.75) {
      a.stage = 2;
      for (const row of this.rows) {
        this._setDelta(row);
        pop(row.cells.delta, { from: 1.8, duration: 450 });
      }
      this.anim = null;
      this.animating = false;
    }
  }

  // ==================================================================================================
  onAction(action) {
    if (action === 'back') return true; // no accidental exits from results
    if (this.animating && action === 'confirm') {
      this.finishAnim();
      return true;
    }
    return this.nav.action(action);
  }

  _confetti(player) {
    this.confetti.textContent = '';
    if (!player || player.place > 3 || this.mode === 'timetrial') return;
    const n = player.place === 1 ? 46 : 24;
    for (let i = 0; i < n; i++) {
      const p = h('i', {
        style: {
          left: `${Math.random() * 100}%`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          animationDelay: `${Math.random() * 1.6}s`,
          animationDuration: `${2.6 + Math.random() * 2.2}s`,
          '--dx': `${(Math.random() - 0.5) * 16}em`,
          '--rot': `${360 + Math.random() * 720}deg`,
          width: `${0.6 + Math.random() * 0.7}em`,
          height: `${1 + Math.random() * 0.9}em`,
        },
      });
      this.confetti.appendChild(p);
    }
  }

  onHide() {
    this.anim = null;
    this.count = null;
    this.animating = false;
    this.confetti.textContent = '';
  }
}
