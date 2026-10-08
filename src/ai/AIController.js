/**
 * AIController — CPU racers. Writes `kart.input` exactly like a player would (throttle, brake, steer, drift,
 * item, aimBack) and `kart.aiSpeedMul` (rubber-banding).
 * OWNER: Gameplay agent.  Contract: ARCHITECTURE.md §6.9.
 *
 * Pieces (all deterministic per character, scaled by `skill` 0..1):
 *   racing line ........ src/ai/racingLine.js (cached on `track._aiLine`)
 *   steering ........... pure pursuit to a look-ahead point on the line + lane wander + avoidance offsets
 *   speed .............. plans a cornering speed from the upcoming line curvature (rarely brakes)
 *   drifting ........... hop-drifts into long corners, releases at the exit / target spark level (mini-turbos)
 *   rocket start ....... times the throttle inside the ROCKET_START window (or fumbles it)
 *   items .............. src/ai/aiItems.js
 *   recovery ........... reverse when stuck, turn around when facing backwards, respawn when hopeless
 *   rubber banding ..... kart.aiSpeedMul from the progress gap to the player
 * The steering / drift model comes straight from the Driving agent (src/kart/tuning.js: turnRateAt, driftBaseRate,
 * driftSteerMul, computeStats, TUNE), so the AI never duplicates the kart's numbers; a slow run-time calibration
 * (omegaScale / driftScale) only mops up small differences (ice, bumps).
 * Nothing here allocates per frame.
 */
import { COUNTDOWN_STEP, ROCKET_START } from '../core/constants.js';
import { clamp, clamp01, lerp, damp, smoothstep, angleDiff, makeRng } from '../core/math.js';
import { TUNE, computeStats, ccSpeedMul, turnRateAt, driftBaseRate, driftSteerMul } from '../kart/tuning.js';
import { getRacingLine } from './racingLine.js';
import { makeProfile } from './aiProfile.js';
import { AIItemBrain } from './aiItems.js';
import { PLATFORM } from '../core/platform.js';

/** Tunables (kept together so feel-tuning never means hunting through the logic). */
export const AI_TUNE = {
  lookBase: 5.5, //         pure-pursuit look-ahead = lookBase + lookGain * speed
  lookGain: 0.3,
  lookMin: 6,
  lookMax: 24,
  brakeDecel: 26, //        comfortable braking used by the cornering-speed planner (m/s^2)
  hopLead: 3, //            start a drift this many metres (+ 0.1 v) before a corner
  driftMinSpeedFrac: 0.55,
  rubber: {
    up: { 50: 1.04, 100: 1.075, 150: 1.1, 200: 1.1 }, //   max speed multiplier when far behind the player
    down: { 50: 0.9, 100: 0.92, 150: 0.92, 200: 0.93 }, // min multiplier when far ahead
    behindRange: [20, 260],
    aheadRange: [40, 300],
    response: 0.6, //       1/s smoothing
  },
  // phones (docs/MOBILE.md §3.5): touch steering is coarser, so the catch-up push is a notch gentler at the fast classes
  rubberMobile: { up: { 150: 1.075, 200: 1.08 } },
  skillPace: [0.955, 1.0], // aiSpeedMul factor from skill 0..1
  stuckSpeed: 3,
  stuckTime: 1.5,
};

const hash = (n) => {
  let h = (n + 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

export class AIController {
  /**
   * @param {object} game
   * @param {object} kart
   * @param {{skill?:number, autopilot?:boolean}} opts
   */
  constructor(game, kart, { skill = 0.7, autopilot = false } = {}) {
    this.game = game;
    this.kart = kart;
    this.skill = clamp(skill, 0, 1);
    this.autopilot = !!autopilot;
    this.profile = makeProfile(kart.character, this.skill);
    this.rng = makeRng(hash((kart.id ?? 0) * 7919 + hash(this.profile.id.length * 131 + this.profile.id.charCodeAt(0))));
    this.track = null;
    this.line = null;

    // scratch line samples
    this.L0 = {};
    this.L1 = {};
    this.L2 = {};

    this.time = 0;
    this._errors = 0;
    this.steerCmd = 0;
    this.stats = computeStats(kart.character?.stats ?? {}, ccSpeedMul(game));
    this.omegaScale = 1;
    this.driftScale = 1;
    this.prevYaw = kart.yaw;
    this.yawRate = 0;
    this.rubber = 1;
    this.vAllowed = 99;
    this.turnAhead = 0;
    this.latError = 0;

    // pre-race
    this.rocket = null;

    // recovery
    this.stuckT = 0;
    this.rec = { mode: 0, t: 0, count: 0, lastT: -99, wrongT: 0 };
    this.offT = 0;

    // lateral planning
    this.planOffset = 0; //     smoothed lateral offset of the plan relative to the line (lane, avoidance, boxes)
    this.latErrorPlan = 0; //   kart lateral minus the planned lateral at its own position
    this.passSide = 0;
    this.passT = 0;
    this.mistake = { t: 0, dur: 1.2, amp: 0, next: 6 + this.rng() * 12, offset: 0 };
    this.boxTarget = null;
    this.boxT = 0;

    // drifting
    this.drift = { hold: false, plan: null, planKey: -1, want: false, wantPlan: null, wasDrifting: false, since: 0, cooldown: 0.5, forceT: 0, dir: 0, holdT: 0, releaseAt: 0 };
    this.trick = { done: false, pulse: 0 };

    /** neighbourhood info shared with the item brain (filled every frame) */
    this.ctx = {
      ahead: null, //   { kart, ds, dl, closing }
      behind: null, //  { kart, ds, dl }  (ds < 0)
      aheadCount: 0, // karts within 45 m ahead
      hazardAhead: 999, // distance to the nearest banana / bomb near our line (m)
      rampAhead: 999, //  distance to the next ramp start (m)
      alongL: 99, //     distance to a kart alongside on the left (only within +-3.5 m along the road)
      alongR: 99, //     ... on the right
      turnAhead: 0, //  radians of turning in the next 40 m
      speed: 0,
      top: 30,
      threat: null,
    };
    this._aheadRec = { kart: null, ds: 0, dl: 0, closing: 0 };
    this._behindRec = { kart: null, ds: 0, dl: 0 };

    this.items = new AIItemBrain(this);
    /** debug counters (release reasons etc.), read by dev/gameplay/aidebug.js */
    this.dbg = { rel: {}, relLevel: {}, starts: 0, ev: [], stuck: 0, turn: 0, respawn: 0, lost: 0 };
  }

  dispose() {
    const inp = this.kart?.input;
    if (inp) {
      inp.throttle = inp.brake = inp.steer = 0;
      inp.drift = inp.item = inp.aimBack = inp.lookBack = false;
    }
  }

  // ==================================================================================================
  // main update
  // ==================================================================================================
  update(dt) {
    try {
      this._update(dt);
    } catch (err) {
      // never let one CPU driver take the whole frame loop down (other systems are being developed in parallel)
      if (this._errors++ < 3) console.error('[AIController] update failed for', this.kart?.name, err);
      const inp = this.kart?.input;
      if (inp) {
        inp.throttle = 1;
        inp.brake = 0;
        inp.steer = 0;
        inp.drift = false;
        inp.item = false;
      }
    }
  }

  _update(dt) {
    if (!(dt > 0)) return;
    const game = this.game, k = this.kart, race = game.race, track = game.track;
    if (!track || !race || !k) return;
    const phase = race.phase;
    if (phase === 'idle') return;
    if (track !== this.track) this._bind(track);
    if (!this.line) return;

    if (phase === 'intro' || phase === 'countdown' || (k.controlLocked && phase !== 'racing' && phase !== 'finished' && phase !== 'results')) {
      this._preRace(dt, phase);
      return;
    }

    this.time += dt;
    const inp = k.input;
    this._measure(dt);
    this._sense(dt);

    if (k.respawnTime > 0 || k.controlLocked) {
      inp.throttle = 0;
      inp.brake = 0;
      inp.drift = false;
      inp.item = false;
      this.drift.hold = false;
      this.stuckT = 0;
      this._rubberBand(dt);
      return;
    }

    if (this._recovery(dt)) {
      this._rubberBand(dt);
      return;
    }

    this._steerAndSpeed(dt);
    this._driftControl(dt);
    this._trickControl(dt);
    this.items.update(dt);
    this._rubberBand(dt);
  }

  _bind(track) {
    this.track = track;
    this.line = getRacingLine(track);
  }

  // ==================================================================================================
  // pre-race: rocket start
  // ==================================================================================================
  _preRace(dt, phase) {
    const k = this.kart, inp = k.input;
    inp.steer = 0;
    inp.brake = 0;
    inp.drift = false;
    inp.item = false;
    inp.aimBack = false;
    inp.throttle = 0;
    this.steerCmd = 0;
    if (phase !== 'countdown') {
      this.rocket = null;
      return;
    }
    if (!this.rocket) this.rocket = this._planRocket();
    const race = this.game.race;
    const untilGo = 3 * COUNTDOWN_STEP - race.phaseTime;
    inp.throttle = untilGo <= this.rocket.press ? 1 : 0;
  }

  /**
   * Decide when (seconds before GO) to floor it. ROCKET_START: the boost window is [windowStart, windowEnd] seconds
   * before GO (best in the middle), pressing earlier than stallIfBefore burns out.
   */
  _planRocket() {
    const s = this.skill, R = ROCKET_START;
    const mid = 0.5 * (R.windowStart + R.windowEnd), half = 0.5 * (R.windowStart - R.windowEnd);
    if (this.autopilot) return { press: mid + (Math.random() - 0.5) * 0.12, kind: 'perfect' };
    const r = Math.random();
    const pStall = 0.28 * Math.pow(1 - s, 1.6);
    const pGood = clamp(0.3 + 0.7 * Math.pow(s, 0.9), 0.25, 0.97);
    if (r < pStall) return { press: R.stallIfBefore + 0.15 + Math.random() * 0.45, kind: 'stall' };
    if (r < pStall + pGood * (1 - pStall)) return { press: mid + (Math.random() - 0.5) * 2 * half * lerp(0.95, 0.25, s), kind: 'good' };
    // fumbled: a touch late (no boost) or a touch early (no boost, no burnout)
    return Math.random() < 0.6
      ? { press: Math.max(0.02, R.windowEnd - 0.05 - Math.random() * 0.25), kind: 'late' }
      : { press: R.windowStart + 0.05 + Math.random() * (R.stallIfBefore - R.windowStart - 0.1), kind: 'early' };
  }

  // ==================================================================================================
  // sensing
  // ==================================================================================================
  /** Run-time calibration of the shared kart model against the kart's actual yaw rate (small corrections only). */
  _measure(dt) {
    const k = this.kart;
    const yr = Number.isFinite(k.yawRate) ? k.yawRate : angleDiff(this.prevYaw, k.yaw) / dt; // + = yaw increasing = turning left
    this.prevYaw = k.yaw;
    this.yawRate = yr;
    if (!k.grounded || k.hit || k.speed < 9) return;
    const sa = k.steerAmount ?? 0;
    if (!k.drifting && Math.abs(sa) > 0.65 && Math.abs(k.input.steer) > 0.6 && k.surface !== 'ice') {
      const pred = this._omegaFull(k.speed) / this.omegaScale;
      const obs = -yr / sa; // steer + (right) => yaw decreases
      if (pred > 0.2 && obs > 0.2 && obs < 6) this.omegaScale = clamp(damp(this.omegaScale, obs / pred, 1.2, dt), 0.8, 1.25);
    } else if (k.drifting) {
      const mul = driftSteerMul(sa * k.driftDir);
      const predBase = this._driftBase(k.speed) / this.driftScale;
      const obsBase = (-yr * k.driftDir) / Math.max(mul, 0.3);
      if (predBase > 0.1 && obsBase > 0.1 && obsBase < 4) this.driftScale = clamp(damp(this.driftScale, obsBase / predBase, 1.0, dt), 0.8, 1.25);
    }
  }

  /** Yaw rate (rad/s) the kart reaches at full steer lock at `speed` (shared model + calibration). */
  _omegaFull(speed) {
    const k = this.kart;
    const surf = TUNE.surfaces[k.surface] ?? TUNE.surfaces.road;
    return Math.max(turnRateAt(speed, Math.max(k.topSpeed || 30, 23), this.stats.turnPeak, surf.steerMul) * this.omegaScale, 0.35);
  }

  /** Neutral drift arc rate (rad/s). */
  _driftBase(speed) {
    return driftBaseRate(speed, Math.max(this.kart.topSpeed || 30, 10), this.stats.driftHandling) * this.driftScale;
  }

  _sense(dt) {
    const game = this.game, k = this.kart, track = this.track, line = this.line, ctx = this.ctx;
    const karts = game.karts;
    const speed = Math.max(0, k.speed);
    ctx.speed = speed;
    ctx.top = Math.max(k.topSpeed || 30, 10);
    let ahead = null, behind = null;
    let aheadDs = 70, behindDs = 45;
    let aheadCount = 0;
    let alongL = 99, alongR = 99;
    for (let i = 0; i < karts.length; i++) {
      const o = karts[i];
      if (o === k || o.finished || o.respawnTime > 0) continue;
      const ds = track.deltaS(k.trackS, o.trackS);
      if (ds > -3.5 && ds < 3.5) {
        const dl = o.lateral - k.lateral;
        if (dl < 0 && -dl < alongL) alongL = -dl;
        else if (dl >= 0 && dl < alongR) alongR = dl;
      }
      if (ds > 0) {
        if (ds < 45) aheadCount++;
        if (ds < aheadDs) {
          aheadDs = ds;
          ahead = o;
        }
      } else if (-ds < behindDs) {
        behindDs = -ds;
        behind = o;
      }
    }
    if (ahead) {
      const r = this._aheadRec;
      r.kart = ahead;
      r.ds = aheadDs;
      r.dl = ahead.lateral - k.lateral;
      r.closing = speed - Math.max(0, ahead.speed);
      ctx.ahead = r;
    } else ctx.ahead = null;
    if (behind) {
      const r = this._behindRec;
      r.kart = behind;
      r.ds = -behindDs;
      r.dl = behind.lateral - k.lateral;
      ctx.behind = r;
    } else ctx.behind = null;
    ctx.aheadCount = aheadCount;
    ctx.alongL = alongL;
    ctx.alongR = alongR;
    // banana / bomb close to our racing line in the next 45 m (drifting is pointless if we have to swerve)
    let hz = 999;
    const items = game.items;
    if (items && items.hazards.length) {
      const list = items.hazards;
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h.dead || h.s === undefined) continue;
        const d = track.deltaS(k.trackS, h.s);
        if (d < -2 || d > 45 || d >= hz) continue;
        const lat = line.at(h.s, this.L2).lat;
        if (Math.abs(h.lateral - lat) < 4.6) hz = d;
      }
    }
    ctx.hazardAhead = hz;
    let ra = 999;
    const ramps = track.ramps;
    if (ramps) for (let i = 0; i < ramps.length; i++) {
      const d = track.deltaS(k.trackS, ramps[i].s);
      if (d > -2 && d < ra) ra = d;
    }
    ctx.rampAhead = ra;

    // turning in the next 40 m of the line (for nitro / drift decisions)
    const N = line.N, ds = line.ds;
    const i0 = line.indexAt(k.trackS);
    let ta = 0;
    const steps = Math.ceil(40 / ds);
    for (let j = 0; j < steps; j++) ta += Math.abs(line.curv[(i0 + j) % N]) * ds;
    ctx.turnAhead = ta;
    this.turnAhead = ta;

    // cross-track error to the line
    line.at(k.trackS, this.L0);
    this.latError = k.lateral - this.L0.lat;

    // item box seeking (only when empty-handed)
    this.boxT -= dt;
    if (this.boxT <= 0) {
      this.boxT = 0.25;
      this._chooseBox();
    }

    // scheduled "mistakes"
    const m = this.mistake;
    if (m.t > 0) {
      m.t -= dt;
      const u = 1 - clamp01(m.t / m.dur);
      m.offset = m.amp * Math.sin(Math.PI * u);
      if (m.t <= 0) m.offset = 0;
    } else if (this.time > m.next && speed > 14 && this.time > 5 && !this.autopilot) {
      m.dur = 0.9 + this.rng() * 0.8;
      m.t = m.dur;
      m.amp = (this.rng() < 0.5 ? -1 : 1) * (2.2 + 2.4 * (1 - this.skill));
      m.next = this.time + this.profile.mistakeEvery * (0.5 + this.rng());
    }
  }

  _chooseBox() {
    const k = this.kart, items = this.game.items, track = this.track, P = this.profile;
    this.boxTarget = null;
    if (!items || k.item || k.rouletteTime > 0 || k.finished) return;
    const boxes = items.boxes;
    if (!boxes || boxes.length === 0) return;
    let best = null, bestCost = Infinity;
    const maxDs = 45 + 55 * P.skill;
    const maxDl = 3 + 7 * P.skill;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.active) continue;
      const ds = track.deltaS(k.trackS, b.s);
      if (ds < 8 || ds > maxDs) continue;
      const dl = Math.abs(b.lateral - k.lateral);
      if (dl > maxDl) continue;
      const cost = ds + 4 * dl;
      if (cost < bestCost) {
        bestCost = cost;
        best = b;
      }
    }
    this.boxTarget = best;
  }

  // ==================================================================================================
  // lateral planning
  // ==================================================================================================
  /** Where (lateral) we would like to be at the look-ahead point, before obstacle avoidance. */
  _baseLateral(L1, Ld) {
    const P = this.profile, t = this.time;
    const cornerness = smoothstep(0.004, 0.02, Math.abs(L1.curv));
    const wander = 0.6 * Math.sin(t * 0.31 + P.phase1) + 0.4 * Math.sin(t * 0.127 + P.phase2);
    let off = (P.laneBase * 0.8 + P.laneAmp * 0.55 * wander) * (1 - 0.55 * cornerness);
    off += P.lineNoise * 0.6 * (0.6 * Math.sin(t * 0.9 + P.phase3) + 0.4 * Math.sin(t * 2.3 + P.phase1));
    off += this.mistake.offset;
    let lat = L1.lat + off;
    // item box pull
    const b = this.boxTarget;
    if (b && b.active) {
      const dsb = this.track.deltaS(this.kart.trackS + Ld, b.s);
      const w = 1 - smoothstep(0, 14, Math.abs(dsb));
      if (w > 0) lat = lerp(lat, clamp(b.lateral, L1.minLat, L1.maxLat), 0.85 * w);
    }
    return lat;
  }

  /** Push `lat` away from an obstacle at lateral `lo`, distance `d` ahead, needing `c` metres of clearance. */
  _push(lat, lo, c, d, Ld, lo0, hi0, sticky) {
    const w = smoothstep(d - 26, d - 5, Ld) * (1 - smoothstep(d + 3, d + 9, Ld));
    if (w <= 0.001) return lat;
    const gap = lat - lo;
    if (Math.abs(gap) >= c) return lat;
    let side = Math.sign(gap);
    if (Math.abs(gap) < 0.5) side = sticky !== 0 ? sticky : side || (this.profile.laneBase >= 0 ? 1 : -1);
    let want = lo + side * c;
    if (want > hi0 + 0.5 || want < lo0 - 0.5) {
      side = -side;
      want = lo + side * c;
    }
    want = clamp(want, lo0 - 0.5, hi0 + 0.5);
    return lat + (want - lat) * w;
  }

  /** Obstacle avoidance: returns the planned lateral at the look-ahead point. */
  _avoidPlan(dt, L1, Ld, latBase) {
    const k = this.kart, track = this.track, ctx = this.ctx, P = this.profile;
    let lat = latBase;
    const speed = ctx.speed;
    const lo0 = L1.minLat, hi0 = L1.maxLat;
    // ---- hazards on the road ----
    const items = this.game.items;
    if (items && items.hazards.length) {
      const hz = items.hazards;
      const range = 12 + 26 * P.skill;
      for (let i = 0; i < hz.length; i++) {
        const h = hz[i];
        if (h.dead || h.s === undefined) continue;
        const d = track.deltaS(k.trackS, h.s);
        if (d < 1 || d > range) continue;
        // weak drivers sometimes simply do not see a banana
        if (P.skill < 0.75 && ((hash(i * 31 + (k.id ?? 0)) & 15) / 16) > 0.35 + P.skill) continue;
        const c = h.type === 'bomb' ? 3.4 : 2.5;
        lat = this._push(lat, h.lateral, c, d, Ld, lo0, hi0, 0);
      }
    }
    // ---- karts in the way ----
    const a = ctx.ahead;
    if (a && a.ds > 0.5) {
      const closing = a.closing;
      const reach = 6 + 1.2 * Math.max(closing, 4) + (a.kart.speed < 6 ? 14 : 0);
      if (a.ds < reach) {
        this.passT -= dt;
        if (this.passT <= 0) {
          this.passT = 1.4;
          // pick the side with more room / keep our own side
          const roomL = L1.lat - lo0, roomR = hi0 - L1.lat;
          this.passSide = a.dl > 0.4 ? -1 : a.dl < -0.4 ? 1 : roomR >= roomL ? 1 : -1;
        }
        const c = lerp(2.9, 2.4, P.aggression);
        lat = this._push(lat, k.lateral + a.dl, c, a.ds, Ld, lo0, hi0, this.passSide);
      } else this.passT = 0;
    } else this.passT = 0;
    // ---- keep some daylight to karts alongside (aggressive drivers do not care as much) ----
    const gap = 3.1 - 0.8 * P.aggression;
    if (ctx.alongR < gap) lat -= (gap - ctx.alongR) * 0.9;
    if (ctx.alongL < gap) lat += (gap - ctx.alongL) * 0.9;
    return lat;
  }

  // ==================================================================================================
  // steering + speed
  // ==================================================================================================
  _steerAndSpeed(dt) {
    const k = this.kart, inp = k.input, line = this.line, P = this.profile, ctx = this.ctx, T = AI_TUNE;
    const speed = Math.max(0, k.speed);
    const iceMul = k.surface === 'ice' ? 1.3 : 1;
    const Ld = clamp((T.lookBase + T.lookGain * speed) * P.lookScale * iceMul, T.lookMin, T.lookMax);
    const L1 = line.at(k.trackS + Ld, this.L1);
    const base = this._baseLateral(L1, Ld);
    const latPlan = clamp(this._avoidPlan(dt, L1, Ld, base), L1.minLat - (this.mistake.t > 0 ? 1.8 : 0.5), L1.maxLat + (this.mistake.t > 0 ? 1.8 : 0.5));
    this.planOffset = damp(this.planOffset, latPlan - L1.lat, 5, dt);
    this.latErrorPlan = this.latError - this.planOffset;
    const tx = L1.cx + L1.rx * latPlan, tz = L1.cz + L1.rz * latPlan;
    const dx = tx - k.position.x, dz = tz - k.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const fwd = dx * k.forward.x + dz * k.forward.z;
    const side = dx * k.right.x + dz * k.right.z;
    const vRef = Math.max(speed, 7);
    let omegaDes; // rad/s, + = turn right
    if (fwd > 0.05) omegaDes = (vRef * 2 * side) / (dist * dist); // 2 sin(alpha) / dist, sin(alpha) = side / dist
    else omegaDes = (side >= 0 ? 1 : -1) * 4;
    let steer;
    if (k.drifting) steer = this._driftSteer(omegaDes, speed);
    else steer = omegaDes / this._omegaFull(vRef);
    steer = clamp(steer, -1, 1);
    if (this.drift.forceT > 0) {
      // the hop-drift needs |steer| > 0.3 (in the corner direction) on the frame the button goes down
      this.drift.forceT -= dt;
      steer = this.drift.dir * Math.max(steer * this.drift.dir, TUNE.drift.steerThreshold * 1.4);
    }
    // a little human lag for weak drivers
    this.steerCmd = damp(this.steerCmd, steer, 1 / (0.03 + P.steerLag), dt);
    inp.steer = clamp(this.steerCmd, -1, 1);

    // ---- cornering speed planner ----
    const N = line.N, ds = line.ds;
    const i0 = line.indexAt(k.trackS);
    const omega = this._omegaFull(Math.max(speed, 14)) * P.safety;
    const maxD = clamp(speed * 1.4 + 12, 20, 72);
    let vAllowed = 1e9;
    for (let d = 4; d <= maxD; d += 4) {
      const kap = Math.abs(line.curv[(i0 + Math.round(d / ds)) % N]) + 1e-4;
      const vLim = omega / kap;
      const vA = Math.sqrt(vLim * vLim + 2 * T.brakeDecel * d);
      if (vA < vAllowed) vAllowed = vA;
    }
    if (k.surface === 'ice') vAllowed *= 0.86;
    this.vAllowed = vAllowed;
    inp.throttle = 1;
    inp.brake = 0;
    if (speed > vAllowed * 1.04 && !k.drifting && k.boostTime <= 0.05) {
      inp.throttle = clamp01(1 - (speed - vAllowed) / 5);
      inp.brake = clamp01((speed - vAllowed - 1.5) / 7);
    }
    // wait for the wide kart in front to move if we are about to ram a stopped one
    const a = ctx.ahead;
    if (a && a.ds < 6 && Math.abs(a.dl) < 2 && a.kart.speed < 2 && speed > 6) inp.brake = Math.max(inp.brake, 0.6);
  }

  /** Map a desired yaw rate (+ = right) to a steer value while drifting (inverse of driftSteerMul). */
  _driftSteer(omegaDes, speed) {
    const k = this.kart, D = TUNE.drift;
    const d = k.driftDir || this.drift.dir || 1;
    const base = this._driftBase(Math.max(speed, 10));
    const mul = (omegaDes * d) / base; // wanted arc rate relative to the neutral drift arc
    const inward = mul >= 1 ? (mul - 1) / (D.inward - 1) : -(1 - mul) / (1 - D.outward);
    return d * clamp(inward, -1, 1);
  }

  // ==================================================================================================
  // drifting
  // ==================================================================================================
  /**
   * Hop-drift plan: press the button (with steering into the corner) a few metres before a corner starts,
   * hold it while steering the arc, release at the exit or once the skill-dependent spark level is reached.
   * Gentle corners the drift arc would over-rotate (its minimum turn rate is ~0.45x base) only get a short
   * "charge" drift: blue, then let go.
   */
  _driftControl(dt) {
    const k = this.kart, inp = k.input, line = this.line, P = this.profile, D = this.drift;
    const speed = Math.max(0, k.speed);
    const top = Math.max(k.topSpeed || 30, 10);
    D.cooldown -= dt;
    if (D.releaseAt > 0) D.releaseAt -= dt;
    const N = line.N, ds = line.ds;
    const iK = line.indexAt(k.trackS);

    if (k.drifting) {
      D.wasDrifting = true;
      D.since += dt;
      const plan = D.plan;
      const cn = plan ? line.corners[plan.ci] : null;
      const remaining = cn ? this._cornerRemaining(cn, iK) : 0;
      const level = k.driftLevel;
      const target = plan ? plan.level : P.driftLevel;
      const charge = plan ? plan.mode === 2 : false;
      // how far the arc has carried us toward the inside of the corner (+) / outside (-)
      const inner = this.latErrorPlan * (k.driftDir || D.dir);
      let release = false;
      let why = '';
      if (remaining < 0.2) { release = true; why = 'exit'; } //                                   exit of the corner
      else if (charge ? level >= target : level >= target && remaining < 1.1) { release = true; why = 'sparks'; } // sparks reached
      else if (level >= target && D.since > 2.6) { release = true; why = 'long'; }
      if (!release && (inner > (charge ? 3.0 : 4.6) || inner < -6.5)) { release = true; why = 'drifted'; }
      if (!release && (speed < 11 || k.hit || (!k.grounded && k.airTime > 0.4))) { release = true; why = 'cancel'; }
      const a = this.ctx.ahead;
      if (!release && a && a.ds < 4.5 && Math.abs(a.dl) < 2.2) { release = true; why = 'traffic'; } // something right in front
      // a drift cannot steer to the outside of its own corner: bail out when we need to
      if (!release && this.planOffset * (k.driftDir || D.dir) < -1.4 && this.ctx.hazardAhead < 40) { release = true; why = 'avoid'; }
      if (release && D.releaseAt <= 0) {
        this.dbg.rel[why] = (this.dbg.rel[why] || 0) + 1;
        this.dbg.relLevel[level] = (this.dbg.relLevel[level] || 0) + 1;
        if (this.dbg.ev.length < 40) this.dbg.ev.push([why, +inner.toFixed(1), +remaining.toFixed(2), +D.since.toFixed(2), level, +speed.toFixed(1), +k.steerAmount.toFixed(2), plan ? plan.mode : -1, +this.latError.toFixed(1), +(cn ? cn.angle : 0).toFixed(2), +(cn ? cn.mean * 1000 : 0).toFixed(1)].join(' '));
        if (level >= 1 && this.rng() < 0.12 * (1 - this.skill)) D.releaseAt = 0.25; //  sloppy late release
        else {
          D.hold = false;
          D.cooldown = 0.45 + 0.5 * (1 - this.skill);
          D.plan = null;
        }
      }
    } else {
      if (D.hold && D.wasDrifting) {
        // the kart ended the drift by itself (cancelled / hit): let go of the button right away
        D.hold = false;
        D.cooldown = 0.6;
        D.plan = null;
      } else if (D.hold) {
        D.holdT += dt; // pressed, waiting for the kart to pick the drift up
        if (D.holdT > 0.7) {
          D.hold = false;
          D.cooldown = 0.6;
          D.plan = null;
        }
      } else {
        D.holdT = 0;
        D.since = 0;
        D.wasDrifting = false;
        this._maybeStartDrift(iK, speed, top);
      }
    }
    inp.drift = D.hold;
  }

  /** Radians of turning left in corner `cn` from sample iK (full angle when the corner is still ahead). */
  _cornerRemaining(cn, iK) {
    const line = this.line, N = line.N, ds = line.ds;
    const off = (iK - cn.i0 + N) % N;
    if (off < cn.count) {
      let a = 0;
      const n = (cn.i1 - iK + N) % N;
      for (let j = 0; j <= n; j++) a += Math.abs(line.curv[(iK + j) % N]) * ds;
      return a;
    }
    return (cn.i0 - iK + N) % N <= 45 ? cn.angle : 0;
  }

  _maybeStartDrift(iK, speed, top) {
    const k = this.kart, line = this.line, P = this.profile, D = this.drift, ctx = this.ctx;
    if (D.cooldown > 0 || k.hit || !k.grounded || k.respawnTime > 0 || k.hopping) return;
    if (speed < Math.max(TUNE.drift.minSpeed + 3, AI_TUNE.driftMinSpeedFrac * top)) return;
    if (k.surface === 'ice' || k.surface === 'offroad' || k.stallTime > 0) return;
    const N = line.N, ds = line.ds;
    const ci = line.cornerIdx[iK];
    if (ci < 0) return;
    const cn = line.corners[ci];
    const inside = (iK - cn.i0 + N) % N < cn.count;
    const distStart = inside ? 0 : ((cn.i0 - iK + N) % N) * ds;
    const lead = AI_TUNE.hopLead + 0.1 * speed;
    if (distStart > lead) return;
    // decide (once per corner per pass) whether this corner is worth a drift, and what kind
    const key = ci * 4 + (k.lap ?? 0) * 1000;
    if (D.planKey !== key) {
      D.planKey = key;
      const sRef = 0.9 * top;
      const ratio = (sRef * cn.mean) / this._driftBase(sRef);
      let mode = 0; // 1 = follow the whole corner in the drift, 2 = short charge drift
      if (cn.angle >= P.driftMinAngle && cn.len >= 22) {
        if (ratio >= 0.42 && ratio <= 1.7) mode = 1;
        else if (ratio >= 0.1 && ratio < 0.42 && this.skill >= 0.3 && cn.len >= 40) mode = 2;
      }
      D.want = mode > 0 && this.rng() < P.driftUse;
      const level = mode === 2 ? (this.skill >= 0.85 && cn.angle > 1.7 ? 2 : 1) : cn.angle > 2.2 ? P.driftLevel : Math.min(P.driftLevel, cn.angle > 1.2 ? 2 : 1);
      D.wantPlan = { ci, mode, level, dir: cn.dir };
    }
    if (!D.want) return;
    if (inside) {
      // joined late: only if a decent part of the corner remains
      let remaining = 0;
      const n = (cn.i1 - iK + N) % N;
      for (let j = 0; j <= n; j++) remaining += Math.abs(line.curv[(iK + j) % N]) * ds;
      if (remaining < Math.max(0.6, P.driftMinAngle * 0.7)) return;
    }
    // be tidy about it: roughly aligned with the line, not fighting for a gap
    if (ctx.hazardAhead < 42) return;
    if (Math.abs(this.latErrorPlan) > 3.0) return;
    const a = ctx.ahead;
    if (a && a.ds < 7 && Math.abs(a.dl) < 2.8) return;
    if (this.mistake.t > 0) return;
    D.plan = D.wantPlan;
    D.dir = cn.dir;
    D.hold = true;
    D.holdT = 0;
    D.forceT = 0.02;
    D.since = 0;
    D.want = false;
    D.wasDrifting = false;
    this.dbg.starts++;
  }

  // ==================================================================================================
  // tricks off ramps / crests
  // ==================================================================================================
  _trickControl(dt) {
    const k = this.kart, inp = k.input, T = this.trick, P = this.profile;
    if (T.pulse > 0) {
      T.pulse -= dt;
      inp.drift = true;
      if (T.pulse <= 0) inp.drift = this.drift.hold;
      return;
    }
    if (k.grounded) {
      T.done = false;
      return;
    }
    if (T.done || k.hopping || k.drifting || this.drift.hold) return;
    if (k.airTime > 0.04 && k.airTime < 0.28 && (k.velocity?.y ?? 0) > 2.5) {
      T.done = true;
      if (this.rng() < P.trickChance) T.pulse = 0.09;
    }
  }

  // ==================================================================================================
  // recovery
  // ==================================================================================================
  /** @returns {boolean} true if this frame's inputs were written here */
  _recovery(dt) {
    const k = this.kart, inp = k.input, rec = this.rec, race = this.game.race;
    const line = this.line;
    const trackYaw = line.yawAt(k.trackS);
    const dYaw = angleDiff(k.yaw, trackYaw); // + => the road points to our left
    const settled = race.time > 2.2;

    // ---- reverse manoeuvre in progress ----
    if (rec.mode !== 0) {
      rec.t -= dt;
      inp.throttle = 0;
      inp.brake = 1;
      inp.drift = false;
      inp.item = false;
      this.drift.hold = false;
      // reversing flips the steering: steer + turns the nose left
      inp.steer = clamp(dYaw * 2.5, -1, 1);
      if (rec.mode === 2) {
        if (Math.abs(dYaw) < 1.25 || rec.t <= 0) rec.mode = 0;
      } else if (rec.t <= 0) rec.mode = 0;
      if (rec.mode === 0) this.stuckT = 0;
      return true;
    }

    const free = !k.hit && !(k.respawnTime > 0) && k.grounded && !(k.stallTime > 0);
    // ---- stuck ----
    if (free && settled && k.speed < AI_TUNE.stuckSpeed && k.boostTime <= 0) this.stuckT += dt * (k.wallContact < 0.25 ? 2.2 : 1);
    else this.stuckT = Math.max(0, this.stuckT - 2 * dt);
    if (this.stuckT > AI_TUNE.stuckTime) {
      this.stuckT = 0;
      if (this.time - rec.lastT < 14) rec.count++;
      else rec.count = 1;
      rec.lastT = this.time;
      this.dbg.stuck++;
      if (rec.count >= 4) {
        rec.count = 0;
        this.dbg.respawn++;
        k.respawn?.();
        return true;
      }
      rec.mode = 1;
      rec.t = 0.9 + 0.35 * rec.count;
      return true;
    }
    // ---- facing the wrong way ----
    if (free && settled && Math.abs(dYaw) > 2.1 && k.speed < 10) rec.wrongT += dt;
    else rec.wrongT = Math.max(0, rec.wrongT - dt * 2);
    if (rec.wrongT > 0.8) {
      rec.wrongT = 0;
      if (this.time - rec.lastT < 10) rec.count++;
      else rec.count = 1;
      rec.lastT = this.time;
      this.dbg.turn++;
      if (rec.count >= 3) {
        rec.count = 0;
        this.dbg.respawn++;
        k.respawn?.();
        return true;
      }
      rec.mode = 2;
      rec.t = 3;
      return true;
    }
    // ---- lost in the wilderness ----
    const s = k.lastSample;
    const lost = k.surface === 'offroad' && s && Math.abs(k.lateral) > (s.halfWidth ?? 10) + 2;
    if (lost && free) this.offT += dt;
    else this.offT = Math.max(0, this.offT - dt * 2);
    if (this.offT > 7) {
      this.offT = 0;
      this.dbg.lost++;
      this.dbg.respawn++;
      k.respawn?.();
      return true;
    }
    return false;
  }

  // ==================================================================================================
  // rubber band
  // ==================================================================================================
  _rubberBand(dt) {
    const k = this.kart, game = this.game, T = AI_TUNE;
    // rubber-band against the LEADING human that has not finished yet (split-screen: game.players)
    let player = null;
    const humans = game.players?.length ? game.players : (game.player ? [game.player] : null);
    if (humans) {
      for (let i = 0; i < humans.length; i++) {
        const h = humans[i];
        if (h === k || h.finished) continue;
        if (!player || h.progress > player.progress) player = h;
      }
    }
    let target = 1;
    if (!this.autopilot && player && game.race.hasStarted) {
      const cc = game.raceConfig?.cc ?? 150;
      const up = (PLATFORM.mobile ? T.rubberMobile.up[cc] : undefined) ?? T.rubber.up[cc] ?? 1.08, down = T.rubber.down[cc] ?? 0.93;
      const gap = k.progress - player.progress; // + = we are ahead of the player
      if (gap < 0) target = 1 + (up - 1) * smoothstep(T.rubber.behindRange[0], T.rubber.behindRange[1], -gap);
      else target = 1 - (1 - down) * smoothstep(T.rubber.aheadRange[0], T.rubber.aheadRange[1], gap);
    }
    this.rubber = damp(this.rubber, target, T.rubber.response, dt);
    const pace = this.autopilot ? 1 : lerp(T.skillPace[0], T.skillPace[1], this.skill);
    k.aiSpeedMul = this.rubber * pace;
  }
}
