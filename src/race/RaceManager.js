/**
 * RaceManager — race phases, countdown, lap counting, standings, finish & results.
 * OWNER: orchestrator.
 *
 * Progress model: every frame each kart's `progress` is integrated from the signed change of its
 * track distance (`track.deltaS(prevS, kart.trackS)`), so it is continuous across the start line,
 * negative while still behind the line at the start, and decreases when driving backwards.
 *   completedLaps = floor(progress / track.length)   (-1 while behind the line at the start)
 *   kart.lap      = clamp(completedLaps + 1, 1, laps) (never decreases — display value)
 * A kart finishes when progress >= laps * track.length.
 *
 * Kart fields written here: lap, progress, place, finished, finishTime, lapTimes, wrongWay.
 *
 * RaceResult: { kart, characterId, name, isPlayer, place, time, lapTimes, bestLap, estimated, points, totalPoints }
 */
import { EVT } from '../core/events.js';
import { INTRO_DURATION, COUNTDOWN_STEP, FINISH_TIMEOUT, DEFAULT_LAPS } from '../core/constants.js';
import { clamp } from '../core/math.js';

const RECORDS_KEY = 'kartblitz.records.v1';

export class RaceManager {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    /** 'idle'|'intro'|'countdown'|'racing'|'finished'|'results' */
    this.phase = 'idle';
    this.phaseTime = 0;
    /** Race clock in seconds since GO. */
    this.time = 0;
    /** Current countdown value (3,2,1,0). */
    this.countdown = 3;
    this.laps = DEFAULT_LAPS;
    this.track = null;
    this.karts = [];
    this.player = null;
    this.config = null;
    /** Karts sorted by current place (index 0 = leader). */
    this.standings = [];
    this.finishOrder = [];
    this.results = null;
    this.record = null;
    this.playerFinishTime = -1;
  }

  /** Called by Game after the track is built and karts are placed on the grid (kart.trackS valid). */
  setup({ track, karts, player, config }) {
    this.reset();
    this.track = track;
    this.karts = karts;
    this.player = player;
    this.config = config;
    this.laps = config.laps ?? track.laps ?? DEFAULT_LAPS;
    for (const k of karts) this._initKart(k);
    this._updatePlaces(true);
    if (config.noCountdown) {
      this._setPhase('countdown');
      this._go();
    } else {
      this._setPhase(config.skipIntro ? 'countdown' : 'intro');
    }
  }

  _initKart(k) {
    k.progress = this.track.deltaS(this.track.startS ?? 0, k.trackS);
    k._lastS = k.trackS;
    k._completed = Math.floor(k.progress / this.track.length);
    k.lap = clamp(k._completed + 1, 1, this.laps);
    k._lapStart = 0;
    k.lapTimes = [];
    k.finished = false;
    k.finishTime = 0;
    k.wrongWay = false;
    k._wrongTimer = 0;
    k.controlLocked = true;
  }

  get isRacing() {
    return this.phase === 'racing' || this.phase === 'finished';
  }
  /** True once GO has happened (racing, finished or results). */
  get hasStarted() {
    return this.phase === 'racing' || this.phase === 'finished' || this.phase === 'results';
  }
  get leader() {
    return this.standings[0] ?? null;
  }
  getKartByPlace(place) {
    return this.standings[place - 1] ?? null;
  }
  /** The kart directly ahead of `kart` in the standings (null if leading). */
  getKartAhead(kart) {
    return kart.place > 1 ? this.standings[kart.place - 2] ?? null : null;
  }
  /** Distance (m) from `kart` to the leader along the course (0 for the leader). */
  distanceToLeader(kart) {
    const l = this.leader;
    return l ? Math.max(0, l.progress - kart.progress) : 0;
  }
  /** Fraction of the race completed by `kart`, 0..1. */
  raceFraction(kart) {
    return clamp(kart.progress / (this.laps * this.track.length), 0, 1);
  }

  skipIntro() {
    if (this.phase === 'intro') this._setPhase('countdown');
  }

  _setPhase(phase) {
    const prev = this.phase;
    this.phase = phase;
    this.phaseTime = 0;
    if (phase === 'countdown') {
      this.countdown = 3;
      this.game.events.emit(EVT.RACE_PHASE, { phase, prev });
      this.game.events.emit(EVT.RACE_COUNTDOWN, { count: 3 });
      return;
    }
    this.game.events.emit(EVT.RACE_PHASE, { phase, prev });
  }

  _go() {
    this.countdown = 0;
    this.time = 0;
    this._setPhase('racing');
    this.game.events.emit(EVT.RACE_COUNTDOWN, { count: 0 });
    for (const k of this.karts) {
      k.controlLocked = false;
      k._lapStart = 0;
      k.onRaceStart?.();
    }
    this.game.events.emit(EVT.RACE_START, {});
  }

  /** Phase timers. Called every simulated frame before controllers/physics. */
  update(dt) {
    this.phaseTime += dt;
    switch (this.phase) {
      case 'intro':
        if (this.phaseTime >= INTRO_DURATION) this._setPhase('countdown');
        break;
      case 'countdown': {
        const count = 3 - Math.floor(this.phaseTime / COUNTDOWN_STEP);
        if (count < this.countdown) {
          if (count <= 0) this._go();
          else {
            this.countdown = count;
            this.game.events.emit(EVT.RACE_COUNTDOWN, { count });
          }
        }
        break;
      }
      case 'racing':
        this.time += dt;
        break;
      case 'finished':
        this.time += dt;
        if (this.karts.every((k) => k.finished) || this.time - this.playerFinishTime >= FINISH_TIMEOUT) this._buildResults();
        break;
      case 'results':
        this.time += dt;
        break;
    }
  }

  /** Progress, laps, finish detection, wrong-way and places. Called every frame AFTER physics. */
  updateStandings(dt) {
    if (!this.track) return;
    const L = this.track.length;
    const counting = this.phase === 'racing' || this.phase === 'finished';
    for (const k of this.karts) {
      if (!k.finished) k.progress += this.track.deltaS(k._lastS, k.trackS);
      k._lastS = k.trackS;
      if (!counting || k.finished) continue;

      const completed = Math.floor(k.progress / L);
      if (completed > k._completed) {
        for (let c = k._completed + 1; c <= completed && !k.finished; c++) {
          if (c < 1) continue; // first crossing of the start line
          const lapTime = this.time - k._lapStart;
          k.lapTimes.push(lapTime);
          k._lapStart = this.time;
          if (c >= this.laps) this._finishKart(k);
          else {
            this.game.events.emit(EVT.RACE_LAP, { kart: k, lap: c + 1, laps: this.laps, lapTime, isFinalLap: c + 1 === this.laps });
          }
        }
        k._completed = completed;
        if (!k.finished) k.lap = clamp(completed + 1, 1, this.laps);
      }
      this._updateWrongWay(k, dt);
    }
    this._updatePlaces(false);
  }

  _updateWrongWay(k, dt) {
    const t = k.lastSample?.tangent;
    if (!t) return;
    const heading = k.forward.x * t.x + k.forward.z * t.z;
    const along = k.velocity.x * t.x + k.velocity.z * t.z;
    const wrongNow = heading < -0.25 && along < -1.5;
    if (wrongNow) k._wrongTimer = Math.min(k._wrongTimer + dt, 2);
    else k._wrongTimer = Math.max(k._wrongTimer - dt * 3, 0);
    const want = k.wrongWay ? k._wrongTimer > 0.2 : k._wrongTimer > 1.0;
    if (want !== k.wrongWay) {
      k.wrongWay = want;
      this.game.events.emit(EVT.RACE_WRONG_WAY, { kart: k, wrongWay: want });
    }
  }

  _finishKart(k) {
    const L = this.track.length;
    const overshoot = k.progress - this.laps * L;
    const speed = Math.max(5, Math.abs(k.speed));
    k.finished = true;
    k.finishTime = Math.max(0, this.time - overshoot / speed);
    // keep the final lap time consistent with the interpolated finish time
    if (k.lapTimes.length) k.lapTimes[k.lapTimes.length - 1] -= this.time - k.finishTime;
    k.lap = this.laps;
    k.wrongWay = false;
    this.finishOrder.push(k);
    this.finishOrder.sort((a, b) => a.finishTime - b.finishTime);
    this._updatePlaces(false);
    this.game.events.emit(EVT.RACE_FINISH, { kart: k, place: k.place, time: k.finishTime });
    if (k === this.player && this.phase === 'racing') {
      this.playerFinishTime = this.time;
      this._setPhase('finished');
    }
  }

  _updatePlaces(silent) {
    const sorted = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    for (let i = 0; i < sorted.length; i++) {
      const k = sorted[i];
      const place = i + 1;
      if (k.place !== place) {
        const prev = k.place;
        k.place = place;
        if (!silent) this.game.events.emit(EVT.RACE_PLACE, { kart: k, place, prev });
      }
    }
    this.standings = sorted;
  }

  _buildResults() {
    const L = this.track.length;
    const total = this.laps * L;
    // Estimate finish times for karts still racing, then freeze everyone.
    for (const k of this.karts) {
      if (k.finished) continue;
      const avg = this.time > 1 ? Math.max(10, k.progress / this.time) : 20;
      k.finishTime = this.time + Math.max(0, total - k.progress) / avg;
      k._estimated = true;
      k.finished = true;
    }
    this._updatePlaces(true);
    const results = this.standings.map((k) => {
      const laps = k.lapTimes.slice(0, this.laps);
      return {
        kart: k,
        characterId: k.character.id,
        name: k.character.name,
        isPlayer: k.isPlayer,
        place: k.place,
        time: k.finishTime,
        lapTimes: laps,
        bestLap: laps.length ? Math.min(...laps) : Infinity,
        estimated: !!k._estimated,
        points: 0,
        totalPoints: 0,
      };
    });
    if (this.config.mode === 'timetrial' && this.player) this.record = this._saveRecord(results.find((r) => r.isPlayer));
    this.game._applyGpPoints?.(results);
    this.results = results;
    this._setPhase('results');
    this.game.events.emit(EVT.RACE_RESULTS, { results, config: this.config, record: this.record });
  }

  _saveRecord(r) {
    if (!r) return null;
    const id = this.track.id;
    let all = {};
    try {
      all = JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
    } catch {}
    const prev = all[id] || { bestTotal: Infinity, bestLap: Infinity };
    const rec = {
      trackId: id,
      total: r.time,
      bestLap: r.bestLap,
      prevBestTotal: prev.bestTotal ?? Infinity,
      prevBestLap: prev.bestLap ?? Infinity,
      newTotalRecord: r.time < (prev.bestTotal ?? Infinity),
      newLapRecord: r.bestLap < (prev.bestLap ?? Infinity),
    };
    all[id] = { bestTotal: Math.min(r.time, prev.bestTotal ?? Infinity), bestLap: Math.min(r.bestLap, prev.bestLap ?? Infinity) };
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(all));
    } catch {}
    return rec;
  }

  /** Stored time-trial records: { [trackId]: { bestTotal, bestLap } }. */
  static getRecords() {
    try {
      return JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}');
    } catch {
      return {};
    }
  }
}
