/**
 * Track select (Quick Race & Time Trial): 2x2 track cards with outline previews, detail + TT records.
 * Drives the 'track' showroom mode (3D glowing miniature on the right half).
 */
import { Screen } from './Screen.js';
import { Nav } from '../nav.js';
import { h } from '../dom.js';
import { head, flames, fmtTime } from '../parts.js';
import { trackMapSvg } from '../trackart.js';
import { RaceManager } from '../../race/RaceManager.js';

const DIFF_LABEL = ['', 'Easy', 'Medium', 'Hard', 'Expert'];

export class TrackScreen extends Screen {
  constructor(ui) {
    super(ui, 'track');
  }

  build() {
    const g = this.game;
    this.headEl = head('Quick Race', 'Choose a Track');
    this.tagEl = this.headEl.querySelector('.pill');
    const cards = g.trackList.map((t, i) => {
      const rec = h('div.tc__rec');
      const el = h('div.tc.a-up', {
        style: { '--i': i + 2, '--c1': t.colors.primary, '--c2': t.colors.secondary, '--c3': t.colors.accent },
        role: 'button',
      },
      h('div.tc__bg'),
      h('div.tc__num', String(i + 1)),
      h('div.tc__map', { html: trackMapSvg(t.id, { road: t.colors.primary }) }),
      h('div.tc__body', h('div.tc__name', t.name), h('div.tc__diff', { html: flames(t.difficulty, 4) })),
      rec);
      el._rec = rec;
      return el;
    });
    this.cards = cards;
    this.grid = h('div.track-grid', cards);

    this.dName = h('div.td__name.fx', { 'data-text': '' });
    this.dDiff = h('div.td__diff');
    this.dDesc = h('div.td__desc');
    this.dRec = h('div.td__rec');
    this.detail = h('div.track-detail.panel.a-right', { style: { '--d': '160ms' } },
      h('div.td__row', this.dName, this.dDiff), this.dDesc, this.dRec);
    this.root.append(this.headEl, this.grid, this.detail);

    this.nav = new Nav(this.ui, { layout: 'grid', cols: 2 });
    this.nav.setItems(
      cards.map((el, i) => ({
        el,
        onFocus: (it, { silent }) => this.focusTrack(i, silent),
        onSelect: () => this.pick(i),
      })),
      0,
    );
  }

  hints() {
    return [{ action: 'nav', label: 'Choose' }, { action: 'confirm', label: 'Race' }, { action: 'back', label: 'Back' }];
  }

  onShow() {
    const f = this.ui.flow;
    this.tagEl.textContent = f.mode === 'timetrial' ? 'Time Trial' : `Quick Race • ${f.cc}cc${f.players > 1 ? ` • ${f.players} Players` : ''}`;
    this.records = RaceManager.getRecords?.() ?? {};
    // refresh card record lines
    this.game.trackList.forEach((t, i) => {
      const r = this.records[t.id];
      const el = this.cards[i]._rec;
      if (f.mode === 'timetrial') el.innerHTML = r ? `<span>BEST</span> ${fmtTime(r.bestTotal)}` : '<span>NO RECORD</span>';
      else el.innerHTML = '';
      el.style.display = f.mode === 'timetrial' ? '' : 'none';
    });
    const idx = Math.max(0, this.game.trackList.findIndex((t) => t.id === f.trackId));
    this.nav.focus(idx, { silent: true, force: true });
    this.focusTrack(idx, true);
  }

  focusTrack(i, silent) {
    const t = this.game.trackList[i];
    const f = this.ui.flow;
    // the initial silent focus while building must not clobber the remembered track
    if (this.active || !silent) {
      f.trackId = t.id;
      this.ui.showroom('track', { trackId: t.id });
    }
    this.dName.textContent = t.name.toUpperCase();
    this.dName.dataset.text = t.name.toUpperCase();
    this.dName.style.setProperty('--g', `linear-gradient(#fff, ${t.colors.primary})`);
    this.dDiff.innerHTML = `${flames(t.difficulty, 4)}<span>${DIFF_LABEL[t.difficulty] ?? ''}</span>`;
    this.dDesc.textContent = t.description;
    if (f.mode === 'timetrial') {
      const r = this.records?.[t.id];
      this.dRec.innerHTML = r
        ? `<div class="rec"><span>Best time</span><b>${fmtTime(r.bestTotal)}</b></div><div class="rec"><span>Best lap</span><b>${fmtTime(r.bestLap)}</b></div>`
        : '<div class="rec rec--none">No record yet — set the first one!</div>';
    } else {
      this.dRec.innerHTML = `<div class="rec"><span>Laps</span><b>3</b></div><div class="rec"><span>Rivals</span><b>${8 - (f.players ?? 1)}</b></div>`;
    }
  }

  pick(i) {
    this.ui.flow.trackId = this.game.trackList[i].id;
    this.ui.startFromFlow();
  }

  onBack() {
    this.ui.goto(this.ui.racerScreen, { keep: true });
  }
}
