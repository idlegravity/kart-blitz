/**
 * Kart — arcade kart physics, drift/boost/trick logic, hit reactions and rescue.
 * OWNER: Driving agent. Public API: ARCHITECTURE.md §6.2 (plus a few documented extras below).
 * Every tunable number lives in ./tuning.js.
 *
 * Model
 *  - `yaw` is the travel/steer heading. `forward`/`right` are the flat unit vectors derived from it.
 *  - Velocity is decomposed along the heading projected on the ground plane (forward part `vf` = `speed`)
 *    and a lateral part that grip bleeds away (fast on road, slower off-road, very slow on ice).
 *  - While drifting the chassis is DRAWN rotated into the turn (`quaternion` only); the physics heading
 *    carves a base arc that the steering widens/tightens. `quaternion` = ground alignment * yaw * slide.
 *  - The kart sticks to `track.query().height`; it leaves the ground when the surface falls away faster than
 *    its remembered slope (ramp lips, sharp crests), when hopping, launched, or hit.
 *  - Sub-stepped at <= 1/90 s. No per-frame allocation (events allocate their small payloads only when fired).
 *
 * Extra public fields (beyond the contract): chassisYaw, yawRate, stallTime, drafting, draftCharge, hopping,
 * wallContact, slideAngle, lateralSpeed, slipAmount, bodyRoll, bodyPitch, suspension (secondary-motion data the
 * model can use). Extra methods: applyImpulse(vx, vz, gripTime), nudgeYaw(dy), get airborne.
 */
import * as THREE from 'three';
import { EVT } from '../core/events.js';
import { COUNTDOWN_STEP, ROCKET_START } from '../core/constants.js';
import { UP, clamp, clamp01, lerp, damp, dampFactor, smoothstep, wrapAngle, angleDiff, forwardToYaw } from '../core/math.js';
import { TUNE, computeStats, ccSpeedMul, turnRateAt, driftBaseRate, driftSteerMul } from './tuning.js';

// ------------------------------------------------------------------------------------------------ scratch
const _f = new THREE.Vector3(); // ground-plane forward
const _r = new THREE.Vector3(); // ground-plane right
const _n = new THREE.Vector3(); // scratch normal
const _qa = new THREE.Quaternion();
const _qy = new THREE.Quaternion();

/** Copy `n` into `out`, guarding against missing / degenerate normals. */
function sanitizeNormal(out, n) {
  if (!n || !Number.isFinite(n.x + n.y + n.z)) return out.copy(UP);
  out.copy(n);
  if (out.y < 0.3) out.y = 0.3;
  return out.normalize();
}

// ------------------------------------------------------------------------------------------------ colliders
const CELL = 16;
const _grids = new WeakMap();
const cellKey = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);

/** Uniform grid over track.colliders (circles in XZ) so each kart only tests the few near it. */
function getColliderGrid(track) {
  const cols = track.colliders;
  if (!cols || cols.length === 0) return null;
  let g = _grids.get(track);
  if (g && g.n === cols.length) return g;
  const map = new Map();
  for (const c of cols) {
    const pad = c.radius + 3;
    const x0 = Math.floor((c.x - pad) / CELL), x1 = Math.floor((c.x + pad) / CELL);
    const z0 = Math.floor((c.z - pad) / CELL), z1 = Math.floor((c.z + pad) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = cellKey(ix, iz);
        let arr = map.get(k);
        if (!arr) map.set(k, (arr = []));
        arr.push(c);
      }
    }
  }
  g = { n: cols.length, map };
  _grids.set(track, g);
  return g;
}

export class Kart {
  /**
   * @param {import('../Game.js').Game} game
   * @param {{ id:number, character:object, isPlayer?:boolean }} opts
   */
  constructor(game, { id, character, isPlayer }) {
    this.game = game;
    // ---- identity ----
    this.id = id;
    this.character = character;
    this.name = character.name;
    this.isPlayer = !!isPlayer;
    /** Set by Game: PlayerController | AIController */
    this.controller = null;
    /** Set by Game: KartModel */
    this.model = null;

    // ---- physics state (Driving writes; everyone reads) ----
    this.position = new THREE.Vector3(); // ground contact point under the kart center
    this.velocity = new THREE.Vector3();
    this.yaw = 0; // travel / steer heading (see file header)
    this.quaternion = new THREE.Quaternion(); // chassis: ground alignment * yaw * drift slide angle
    this.forward = new THREE.Vector3(0, 0, 1); // flat unit heading vector (from yaw)
    this.right = new THREE.Vector3(-1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0); // smoothed chassis up (ground normal / airborne attitude)
    this.speed = 0; // signed forward speed m/s
    this.topSpeed = 30; // nominal current top speed m/s (cc, AI mul, star, shrink; NOT boost/off-road)
    this.grounded = true;
    this.airTime = 0; // seconds since leaving the ground (0 while grounded)
    this.steerAmount = 0; // smoothed actual steer -1..1 (+ right)
    this.throttleAmount = 0; // smoothed 0..1 (also animates while controls are locked)
    this.surface = 'road';
    this.radius = TUNE.radius;
    this.mass = 1;
    this.aiSpeedMul = 1; // AIController writes; multiplies top speed & accel

    // ---- drift ----
    this.drifting = false;
    this.driftDir = 0; // -1 left, +1 right
    this.driftCharge = 0; // seconds of charge
    this.driftLevel = 0; // 0 none, 1 blue, 2 orange, 3 purple

    // ---- status ----
    this.boostTime = 0;
    this.boostPower = 0; // eased 0..1+ intensity (fx / camera / audio)
    this.boostSource = null;
    this.starTime = 0;
    this.shrinkTime = 0;
    /** null | { type: 'spin'|'tumble'|'explode'|'squish', t, duration, lock } */
    this.hit = null;
    this.invulnTime = 0;
    this.trickTime = 0;
    this.respawnTime = 0; // > 0 while being rescued
    this.controlLocked = true;

    // ---- input (controllers write every frame) ----
    /** analog (optional): true when the steering comes from an analog stick, which gets a snappier smoothing. */
    this.input = { throttle: 0, brake: 0, steer: 0, drift: false, item: false, lookBack: false, aimBack: false, analog: false, assist: 0 };

    // ---- track tracking (physics maintains) ----
    this.trackIndex = -1;
    this.trackS = 0;
    this.lateral = 0;
    this.lastSample = null;

    // ---- race (RaceManager writes) ----
    this.lap = 1;
    this.progress = 0;
    this.place = id + 1;
    this.finished = false;
    this.finishTime = 0;
    this.lapTimes = [];
    this.wrongWay = false;

    // ---- items (ItemSystem writes) ----
    this.item = null;
    this.itemCount = 0;
    this.rouletteTime = 0;
    this.itemTime = 0;

    // ---- extras (Driving-owned, read by camera / fx / audio) ----
    this.chassisYaw = 0; // yaw actually drawn (yaw - slide)
    this.yawRate = 0; // rad/s, + = turning left (yaw increasing)
    this.stallTime = 0; // > 0 during a burnout
    this.drafting = false; // in another kart's slipstream
    this.draftCharge = 0; // seconds spent drafting (boost fires at TUNE.draft.charge)
    this.hopping = false; // in the small drift hop
    this.wallContact = 0; // seconds since last wall contact (0 = touching now); large when free
    this.slideAngle = 0; // current chassis slide angle (rad, + = nose right)
    this.lateralSpeed = 0; // m/s sideways slide relative to the heading (+ = sliding to the right)
    this.slipAmount = 0; // 0..1 how much the kart is sliding (tire smoke / skid marks)
    this.bodyRoll = 0; // rad, + = body leans to the kart's right (leans outward in a turn)
    this.bodyPitch = 0; // rad, + = nose up (squat on acceleration, dive on braking)
    this.suspension = 0; // m of spring compression, kicked by landings (+ = compressed)

    // ---- internals ----
    this._st = computeStats(character.stats, ccSpeedMul(game));
    this.mass = this._st.mass;
    this.topSpeed = this._st.top;
    this._prevDrift = false;
    this._driftPressed = false;
    this._hopActive = false;
    this._landGrace = 0;
    this._slide = 0;
    this._starAmt = 0;
    this._shrinkAmt = 0;
    this._starActive = false;
    this._shrinkActive = false;
    this._boostPowerT = 0;
    this._trickWindow = 0;
    this._tricked = false;
    this._rampT = 99;
    this._rampLaunch = 0;
    this._wasOnRamp = false;
    this._onPad = false;
    this._lastGroundY = 0;
    this._gvy = 0;
    this._throttleSince = null;
    this._wallCd = 0;
    this._bumpSlide = 0;
    this._safeS = 0;
    this._hasSafe = false;
    this._safeTimer = 0;
    this._respawnManual = false;
    this._respawnPlaced = false;
    this._liftStartY = 0;
    this._draftCd = 0;
    this._frameTmp = {};
    this._kick = 0; // visual-only yaw offset that eases out (wall bounces)
    this._susV = 0;
    this._prevSpeed = 0;
    this._bumpCd = null; // per-pair KART_BUMP cooldowns (collisions.js)
  }

  // ==================================================================================================
  // public read helpers
  // ==================================================================================================
  get isImmune() {
    return this.starTime > 0 || this.invulnTime > 0 || this.respawnTime > 0;
  }

  /** True while off the ground (hop, jump, hit launch, rescue). */
  get airborne() {
    return !this.grounded;
  }

  // ==================================================================================================
  // lifecycle
  // ==================================================================================================
  /**
   * Place the kart on a start slot and zero every piece of physics/status state.
   * @param {{ position: THREE.Vector3, yaw: number }} slot
   */
  resetForRace(slot) {
    this._st = computeStats(this.character.stats, ccSpeedMul(this.game));
    this.mass = this._st.mass;
    this.aiSpeedMul = 1;
    this.topSpeed = this._st.top;
    this.radius = TUNE.radius;

    this.position.copy(slot.position);
    this.yaw = slot.yaw ?? 0;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.grounded = true;
    this.airTime = 0;
    this.steerAmount = 0;
    this.throttleAmount = 0;
    this.drifting = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftLevel = 0;
    this.boostTime = 0;
    this.boostPower = 0;
    this.boostSource = null;
    this.starTime = 0;
    this.shrinkTime = 0;
    this.hit = null;
    this.invulnTime = 0;
    this.trickTime = 0;
    this.respawnTime = 0;
    this.stallTime = 0;
    this.drafting = false;
    this.draftCharge = 0;
    this.hopping = false;
    this.wallContact = 99;
    this.yawRate = 0;
    this._prevDrift = false;
    this._driftPressed = false;
    this._hopActive = false;
    this._landGrace = 0;
    this._slide = 0;
    this._starAmt = 0;
    this._shrinkAmt = 0;
    this._starActive = false;
    this._shrinkActive = false;
    this._boostPowerT = 0;
    this._trickWindow = 0;
    this._tricked = false;
    this._rampT = 99;
    this._rampLaunch = 0;
    this._wasOnRamp = false;
    this._onPad = false;
    this._throttleSince = null;
    this._wallCd = 0;
    this._bumpSlide = 0;
    this._safeTimer = 0;
    this._respawnPlaced = false;
    this._draftCd = 0;
    this._kick = 0;
    this._susV = 0;
    this._prevSpeed = 0;
    this.lateralSpeed = 0;
    this.slipAmount = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.suspension = 0;
    for (const k in this.input) this.input[k] = typeof this.input[k] === 'boolean' ? false : 0;

    this.trackIndex = -1;
    this.lastSample = this.lastSample ?? {};
    const s = this._querySample();
    if (Number.isFinite(s.height)) this.position.y = s.height;
    sanitizeNormal(this.up, s.normal);
    this._lastGroundY = this.position.y;
    this._safeS = s.s;
    this._hasSafe = true;
    this._orient(0);
  }

  dispose() {
    this.controller = null;
    this.model = null;
    this.lastSample = null;
  }

  // ==================================================================================================
  // main update
  // ==================================================================================================
  /** Advance the physics by `dt` seconds. Accepts dt === 0. */
  update(dt) {
    if (!(dt > 0)) return;
    const track = this.game.track;
    if (!track || !this.lastSample) return;

    this._trackRocketStart();
    const inp = this.input;
    this._driftPressed = !!inp.drift && !this._prevDrift;
    this._prevDrift = !!inp.drift;
    // engine revs keep animating while locked / hit
    this.throttleAmount = damp(this.throttleAmount, clamp01(inp.throttle), 8, dt);

    const n = Math.min(8, Math.ceil(dt / TUNE.maxSubstep));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._step(h, i === 0);

    this._updateDraft(dt);
    this._orient(dt);
    this._sanity();
  }

  // ==================================================================================================
  // one physics sub-step
  // ==================================================================================================
  _step(h, first) {
    const T = TUNE, D = T.drift;
    const inp = this.input;
    const v = this.velocity;

    this._tickStatus(h);
    if (this.respawnTime > 0) {
      this._stepRespawn(h);
      return;
    }

    const canDrive = !this.controlLocked && !(this.hit && this.hit.lock);
    const canDrift = canDrive && !this.hit; // no hop / drift while a (non-locking) reaction such as squish plays
    const pressed = first && this._driftPressed;
    const sample = this.lastSample;

    // ---- steering input smoothing (~0.08 s response, quicker to release / reverse) ----
    const want = canDrive ? clamp(inp.steer || 0, -1, 1) : 0;
    const releasing = want * this.steerAmount < 0 || Math.abs(want) < Math.abs(this.steerAmount);
    const lam = inp.analog ? (releasing ? T.steerReleaseAnalog : T.steerPressAnalog) : releasing ? T.steerRelease : T.steerPress;
    this.steerAmount = damp(this.steerAmount, want, lam, h);
    if (want === 0 && Math.abs(this.steerAmount) < 1e-3) this.steerAmount = 0;

    // ---- hop / trick / drift start ----
    if (canDrift && pressed) {
      if (this.grounded && !this.drifting) this._hop();
      else if (!this.grounded && this._trickWindow > 0 && !this._tricked) this._trick();
    }
    if (canDrift && !this.drifting && inp.drift && (this._hopActive || this._landGrace > 0)) {
      if (Math.abs(inp.steer) > D.steerThreshold * (inp.assist > 0 ? T.assist.driftThresholdMul : 1) && this.speed > D.minSpeed) this._startDrift(Math.sign(inp.steer));
    }
    if (this.drifting) this._updateDrift(h, canDrive);

    // ---- yaw ----
    this._updateYaw(h, canDrive);

    // ---- attitude ----
    if (this.grounded) {
      sanitizeNormal(_n, sample.normal);
      this.up.lerp(_n, dampFactor(T.upFollowGround, h)).normalize();
    } else {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const vh = Math.hypot(v.x, v.z);
      const pitch = clamp(Math.atan2(v.y, Math.max(vh, 8)) * T.airPitchFollow, -0.45, 0.45);
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      _n.set(-sp * fx, cp, -sp * fz);
      this.up.lerp(_n, dampFactor(T.upFollowAir, h)).normalize();
    }

    // ---- integrate ----
    if (this.grounded) this._stepGround(h, canDrive);
    else this._stepAir(h);

    // ---- obstacles, surfaces, rescue ----
    const s = this.lastSample;
    if (this.respawnTime > 0) return; // (a fall may have started inside the step)
    this._collideWalls(s, h);
    this._collideStatic(s, h);
    this._surfaceEffects(s, h);
    this._checkFall(s, h);
    this.lateral = s.lateral;
  }

  // ------------------------------------------------------------------------------------ status timers
  _tickStatus(h) {
    const T = TUNE, B = T.boost;
    if (this.invulnTime > 0) this.invulnTime = Math.max(0, this.invulnTime - h);
    if (this.hit) {
      this.hit.t += h;
      if (this.hit.t >= this.hit.duration) this.hit = null;
    }
    if (this.trickTime > 0) this.trickTime = Math.max(0, this.trickTime - h);
    if (this._trickWindow > 0) this._trickWindow = Math.max(0, this._trickWindow - h);
    if (this.stallTime > 0) this.stallTime = Math.max(0, this.stallTime - h);
    if (this._wallCd > 0) this._wallCd -= h;
    if (this._bumpSlide > 0) this._bumpSlide -= h;
    if (this._landGrace > 0) this._landGrace -= h;
    if (this._draftCd > 0) this._draftCd -= h;
    this.wallContact = Math.min(99, this.wallContact + h);

    // star / shrink
    if (this.starTime > 0) {
      this.starTime = Math.max(0, this.starTime - h);
      if (this.starTime === 0 && this._starActive) {
        this._starActive = false;
        this.game.events.emit(EVT.KART_STAR, { kart: this, active: false });
      }
    }
    if (this.shrinkTime > 0) {
      this.shrinkTime = Math.max(0, this.shrinkTime - h);
      if (this.shrinkTime === 0 && this._shrinkActive) {
        this._shrinkActive = false;
        this.game.events.emit(EVT.KART_SHRINK, { kart: this, active: false });
      }
    }
    this._starAmt = damp(this._starAmt, this.starTime > 0 ? 1 : 0, 4, h);
    this._shrinkAmt = damp(this._shrinkAmt, this.shrinkTime > 0 ? 1 : 0, T.shrink.easeRate, h);
    this.radius = T.radius * lerp(1, T.shrink.radiusMul, this._shrinkAmt);
    this.mass = this._st.mass * lerp(1, T.shrink.massMul, this._shrinkAmt);
    this.topSpeed =
      this._st.top * this.aiSpeedMul * lerp(1, T.star.topMul, this._starAmt) * lerp(1, T.shrink.topMul, this._shrinkAmt);

    // boost
    if (this.boostTime > 0) {
      this.boostTime = Math.max(0, this.boostTime - h);
      if (this.boostTime === 0) this._boostPowerT = 0;
    }
    const boosting = this.boostTime > 0;
    this.boostPower = damp(this.boostPower, boosting ? this._boostPowerT : 0, boosting ? B.easeIn : B.easeOut, h);
    if (!boosting && this.boostPower < 0.003) {
      this.boostPower = 0;
      this.boostSource = null;
    }
  }

  // ------------------------------------------------------------------------------------ hop / drift
  _hop() {
    this.velocity.y += TUNE.drift.hopVy;
    this.grounded = false;
    this.airTime = 0;
    this._hopActive = true;
    this.hopping = true;
    this._lastGroundY = this.position.y;
    this.game.events.emit(EVT.KART_HOP, { kart: this });
  }

  _trick() {
    this._tricked = true;
    this._trickWindow = 0;
    this.trickTime = TUNE.trick.duration;
    this.game.events.emit(EVT.KART_TRICK, { kart: this });
  }

  _startDrift(dir) {
    this.drifting = true;
    this.driftDir = dir;
    this.driftCharge = 0;
    this.driftLevel = 0;
    this._landGrace = 0;
    this.game.events.emit(EVT.KART_DRIFT_START, { kart: this, dir });
  }

  /** End the drift. release=true fires the mini-turbo for the reached level; false just cancels. */
  _endDrift(release) {
    if (!this.drifting) return;
    const level = this.driftLevel;
    this.drifting = false;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftLevel = 0;
    this.game.events.emit(EVT.KART_DRIFT_END, { kart: this, level: release ? level : 0 });
    if (release && level > 0) {
      const tb = TUNE.drift.turbo[level - 1];
      this.applyBoost(tb.duration * this._st.miniTurboScale, tb.power, 'miniturbo');
    }
  }

  _updateDrift(h, canDrive) {
    const D = TUNE.drift;
    const inp = this.input;
    if (!canDrive || this.hit) return this._endDrift(false);
    if (!inp.drift) return this._endDrift(true);
    if (this.speed < D.cancelSpeed) return this._endDrift(false);
    if (!this.grounded && !this._hopActive && this.airTime > D.cancelAirTime) return this._endDrift(false);
    // charge: faster when steering into the turn
    const inward = this.steerAmount * this.driftDir;
    const rate = inward >= 0 ? lerp(1, D.chargeIn, inward) : lerp(1, D.chargeOut, -inward);
    this.driftCharge += h * rate;
    if (this.driftLevel < 3 && this.driftCharge >= D.levels[this.driftLevel]) {
      this.driftLevel++;
      this.game.events.emit(EVT.KART_DRIFT_LEVEL, { kart: this, level: this.driftLevel });
    }
  }

  // ------------------------------------------------------------------------------------ steering
  _updateYaw(h, canDrive) {
    const T = TUNE, st = this._st;
    const spdAbs = Math.abs(this.speed);
    let rate = 0; // rad/s, + = yaw increasing (turning left)
    if (this.drifting) {
      const mul = driftSteerMul(this.steerAmount * this.driftDir);
      rate = -this.driftDir * driftBaseRate(spdAbs, this.topSpeed, st.driftHandling) * mul;
    } else if (canDrive) {
      const surf = T.surfaces[this.surface] ?? T.surfaces.road;
      // reversed when reversing; smooth through zero so there is no flip-flop near standstill
      const dir = clamp(this.speed / 1.5, -1, 1);
      rate = -this.steerAmount * turnRateAt(spdAbs, this.topSpeed, st.turnPeak, surf.steerMul) * dir * (this.grounded ? 1 : T.airSteer);
      if (this.input.assist > 0) rate += this._assistRate();
    }
    this.yawRate = rate;
    if (rate !== 0) this.yaw = wrapAngle(this.yaw + rate * h);
  }

  /** Mobile touch assist: gentle yaw rate (rad/s, + = left) aligning the kart with the road while the player is not steering. */
  _assistRate() {
    const A = TUNE.assist;
    const t = this.lastSample?.tangent;
    if (!t || !this.grounded || this.speed < A.alignMinSpeed || this.respawnTime > 0 || this.hit) return 0;
    if (this.surface === 'ice' || this.surface === 'void') return 0;
    const steerW = 1 - smoothstep(A.alignNeutral, A.alignFade, Math.abs(this.steerAmount));
    if (steerW <= 0) return 0;
    const err = wrapAngle(Math.atan2(t.x, t.z) - this.yaw); // + = road is to the left of the heading
    const ae = Math.abs(err);
    const w = steerW * (1 - smoothstep(A.alignMaxErr * 0.7, A.alignMaxErr, ae));
    return clamp(err * A.alignRate, -A.alignMax, A.alignMax) * w;
  }

  // ------------------------------------------------------------------------------------ ground frame
  /** Fill _f / _r from the current yaw and the given surface normal. */
  _frameFrom(n) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const d = fx * n.x + fz * n.z;
    _f.set(fx - n.x * d, -n.y * d, fz - n.z * d).normalize();
    _r.crossVectors(_f, n);
  }

  // ------------------------------------------------------------------------------------ grounded step
  _stepGround(h, canDrive) {
    const T = TUNE, B = T.boost;
    const inp = this.input, v = this.velocity, st = this._st;
    this._frameFrom(this.up);
    let vf = v.dot(_f);
    let vr = v.dot(_r);
    if (vf > -1e-3 && vf < 1e-3) vf = 0;
    if (vr > -1e-3 && vr < 1e-3) vr = 0;

    // ---------------- longitudinal ----------------
    const thr = canDrive && this.stallTime <= 0 ? clamp01(inp.throttle) : 0;
    const brk = canDrive ? clamp01(inp.brake) : 0;
    const squished = this.hit !== null && this.hit.type === 'squish';
    const topNom = this.topSpeed * (squished ? T.hit.squishTopMul : 1);
    const boosting = this.boostPower > 0.02;
    const offroadCap = this.surface === 'offroad' && this.boostPower < 0.05 && this.starTime <= 0;
    const boostTop = topNom * (1 + B.topMul * this.boostPower);
    const cap = offroadCap ? topNom * T.offroadTopFactor : boostTop;

    if (brk > 0.05 && vf > 0.5) {
      vf = Math.max(0, vf - T.brakeDecel * brk * h);
    } else if (brk > 0.05) {
      const room = clamp01((vf + T.reverseMax) / T.reverseMax); // 1 at standstill, 0 at max reverse
      vf = Math.max(-T.reverseMax * brk, vf - T.reverseAccel * room * h);
    } else if (thr > 0.05) {
      // (-0.05 rather than 0: float noise around a standstill must never block the launch)
      if (vf < -0.05) vf = Math.min(0, vf + T.brakeDecel * h);
      else if (vf < cap) {
        const a = st.accelK * boostTop * (1 - (vf / cap) * (vf / cap)) * (boosting ? B.accelMul : 1) * thr;
        vf = Math.min(cap, vf + a * h);
      }
    } else if (vf !== 0) {
      const dec = (T.coastBase + T.coastPerSpeed * Math.abs(vf)) * h;
      vf = Math.abs(vf) <= dec ? 0 : vf - Math.sign(vf) * dec;
    }
    if (vf > cap) vf = cap + (vf - cap) * Math.exp(-(offroadCap ? T.offroadOverspeedRate : T.overspeedRate) * h);
    // slopes: uphill slows, downhill speeds up "a little" (none at a standstill so karts never roll back)
    vf -= T.gravity * T.slopeGravity * _f.y * smoothstep(0.5, 4, Math.abs(vf)) * h;
    if (this.wallContact < 0.08) vf *= Math.exp(-T.wall.scrapeDrag * h);

    // ---------------- lateral grip ----------------
    const surf = T.surfaces[this.surface] ?? T.surfaces.road;
    let grip = this.drifting ? Math.min(T.drift.grip, surf.grip * 1.6) : surf.grip;
    let turnLoss = this.drifting ? T.drift.turnLoss : surf.turnLoss;
    if (this._bumpSlide > 0) grip *= T.bumpGripMul;
    const kk = 1 - Math.exp(-grip * h);
    const vrOld = vr;
    const vr2 = vrOld * (1 - kk);
    const vfAbs = Math.abs(vf);
    // the removed slide is (mostly) converted into forward speed so cornering keeps momentum
    const transfer = (Math.sqrt(vf * vf + vrOld * vrOld - vr2 * vr2) - vfAbs) * clamp01(vfAbs / 6);
    vf += Math.sign(vf) * transfer;
    vr = vr2;
    // cornering drag: proportional to the angle the velocity vector was just turned by grip
    const removedAng = Math.abs(vrOld - vr2) / Math.max(Math.hypot(vf, vr), 4);
    const keep = 1 - clamp(turnLoss * removedAng, 0, 0.4);
    vf *= keep;
    vr *= keep;

    this.lateralSpeed = vr;
    this.slipAmount = clamp01(Math.abs(vr) / Math.max(Math.hypot(vf, vr), 6) * 3.2);
    v.set(_f.x * vf + _r.x * vr, _f.y * vf + _r.y * vr, _f.z * vf + _r.z * vr);
    this.speed = vf;
    this.position.addScaledVector(v, h);
    const s = this._querySample();

    // ---------------- ground contact / take-off ----------------
    const gH = Number.isFinite(s.height) ? s.height : this._lastGroundY;
    if (this.position.y - gH > T.airGap) {
      this._takeoff(s);
    } else {
      this.position.y = gH;
      this._lastGroundY = gH;
    }
  }

  // ------------------------------------------------------------------------------------ airborne step
  _stepAir(h) {
    const T = TUNE;
    const v = this.velocity;
    this.airTime += h;
    v.y -= T.gravity * h;
    if (this._hopActive) {
      // the small drift hop keeps a little traction so the hop-drift stays smooth
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      let vf = v.x * fx + v.z * fz;
      let vr = v.x * -fz + v.z * fx;
      const vr2 = vr * Math.exp(-6 * h);
      vf += Math.sign(vf) * (Math.sqrt(vf * vf + vr * vr - vr2 * vr2) - Math.abs(vf));
      v.x = fx * vf + -fz * vr2;
      v.z = fz * vf + fx * vr2;
    }
    const drag = Math.exp(-T.airDrag * h);
    v.x *= drag;
    v.z *= drag;
    this.position.addScaledVector(v, h);
    const s = this._querySample();
    this.speed = v.x * Math.sin(this.yaw) + v.z * Math.cos(this.yaw);
    const gH = s.height;
    if (Number.isFinite(gH) && this.position.y <= gH) this._land(s);
  }

  _takeoff(s) {
    const T = TUNE;
    this.grounded = false;
    this.airTime = 0;
    const v = this.velocity;
    const inRampGrace = this._rampLaunch > 0 && this._rampT < T.trick.rampGrace;
    if (inRampGrace) {
      // ramp: inherit its launch speed, scaled by how fast we are going
      const k = clamp(T.trick.launchMinScale + (1 - T.trick.launchMinScale) * (this.speed / (0.9 * Math.max(this.topSpeed, 1))), T.trick.launchMinScale, T.trick.launchMaxScale);
      v.y = Math.max(v.y, this._rampLaunch * k);
      this._trickWindow = T.trick.window;
      this._tricked = false;
    } else if (v.y > T.trick.crestMinVy && !this._hopActive) {
      this._trickWindow = T.trick.window; // sharp crest
      this._tricked = false;
    }
    this._rampLaunch = 0;
    this._rampT = 99;
    this._wasOnRamp = false;
    void s;
  }

  _land(s) {
    const T = TUNE, D = T.drift;
    const v = this.velocity;
    const n = sanitizeNormal(_n, s.normal);
    const vn = v.dot(n);
    const impact = Math.max(0, -vn);
    v.addScaledVector(n, -vn); // slide along the surface we touched down on
    this.position.y = s.height;
    this._lastGroundY = s.height;
    const airT = this.airTime;
    this.grounded = true;
    this.airTime = 0;
    this.hopping = false;
    this.up.lerp(n, 0.55).normalize();

    if (impact > T.hardLandStart) {
      v.multiplyScalar(1 - clamp((impact - T.hardLandStart) * T.hardLandSpeedLoss, 0, T.hardLandMaxLoss));
    }
    // forgiving touchdown: convert part of any sideways slide into forward speed
    this._frameFrom(n);
    const vf = v.dot(_f), vr = v.dot(_r);
    const vr2 = vr * (1 - T.landRealign);
    const vf2 = Math.sign(vf) * Math.sqrt(vf * vf + (vr * vr - vr2 * vr2) * clamp01(Math.abs(vf) / 6));
    v.set(_f.x * vf2 + _r.x * vr2, _f.y * vf2 + _r.y * vr2, _f.z * vf2 + _r.z * vr2);
    this.speed = vf2;

    this._susV += clamp(impact, 0, 26) * 0.26; // spring compression kick
    if (impact > T.landEventMin || airT > 0.25) this.game.events.emit(EVT.KART_LAND, { kart: this, impact });

    // trick landing boost
    if (this._tricked) {
      this._tricked = false;
      this.applyBoost(T.boost.trick.duration, T.boost.trick.power, 'trick');
    }
    this._trickWindow = 0;

    // MK behaviour: landing from ANY airborne moment while holding drift + steer starts a drift
    const inp = this.input;
    const canDrive = !this.controlLocked && !this.hit;
    const wasHop = this._hopActive;
    this._hopActive = false;
    if (canDrive && !this.drifting && inp.drift) {
      if (Math.abs(inp.steer) > D.steerThreshold * (inp.assist > 0 ? TUNE.assist.driftThresholdMul : 1) && this.speed > D.minSpeed) this._startDrift(Math.sign(inp.steer));
      else if (wasHop) this._landGrace = D.graceAfterLand;
    }
  }

  // ------------------------------------------------------------------------------------ track sampling
  _querySample() {
    const track = this.game.track;
    const out = this.lastSample ?? (this.lastSample = {});
    const res = track.query(this.position, this.trackIndex, out) ?? out;
    this.lastSample = res;
    this.trackIndex = res.index;
    this.trackS = res.s;
    this.lateral = res.lateral;
    this.surface = res.surface ?? 'road';
    return res;
  }

  // ------------------------------------------------------------------------------------ walls & obstacles
  /**
   * Reflect the horizontal velocity off a surface with unit normal (nx, nz) pointing toward the kart.
   * A fresh contact costs speed by impact angle (glancing scrapes keep most speed) and bounces (restitution);
   * continued contact scrapes with a rate-based drag and swings the heading along the wall so a kart held
   * against a wall never gets stuck. Returns the impact speed (m/s into the surface), 0 if moving away.
   */
  _reflect(nx, nz, h) {
    const W = TUNE.wall;
    const v = this.velocity;
    const vn = v.x * nx + v.z * nz;
    if (vn >= 0) return 0;
    const impact = -vn;
    const fresh = this.wallContact > 0.12;
    const hs = Math.hypot(v.x, v.z) || 1;
    const sinT = clamp01(impact / hs);
    const tx = v.x - vn * nx, tz = v.z - vn * nz;
    const keep = fresh ? 1 - W.angleLoss * sinT : Math.exp(-W.scrapeRate * sinT * h);
    const e = fresh ? W.restitution : 0;
    v.x = tx * keep - vn * e * nx;
    v.z = tz * keep - vn * e * nz;
    // heading swings toward the wall tangent (kick keeps the drawn chassis continuous, it eases out in _orient)
    const dot = Math.sin(this.yaw) * -nz + Math.cos(this.yaw) * nx;
    const sgn = dot >= 0 ? 1 : -1;
    const targetYaw = Math.atan2(-nz * sgn, nx * sgn);
    const d = angleDiff(this.yaw, targetYaw);
    const k = fresh ? W.swing * (1 - 0.7 * sinT) : (1 - Math.exp(-(impact > 8 ? W.deflect * 2 : W.deflect) * h)) * (1 - 0.5 * sinT);
    this.yaw = wrapAngle(this.yaw + d * k);
    this._kick = clamp(this._kick - d * k, -0.9, 0.9);
    this.wallContact = 0;
    return impact;
  }

  _wallEvent(impact, nx, nz) {
    const W = TUNE.wall;
    if (impact > TUNE.drift.cancelWallImpact && this.drifting) this._endDrift(false);
    if (impact > W.eventMin && this._wallCd <= 0) {
      this._wallCd = W.eventCooldown;
      const point = new THREE.Vector3(this.position.x - nx * this.radius, this.position.y + 0.5, this.position.z - nz * this.radius);
      this.game.events.emit(EVT.KART_WALL, { kart: this, impact, point });
    }
  }

  _collideWalls(s, h) {
    if (!s.right) return;
    const r = this.radius;
    let rx = s.right.x, rz = s.right.z;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const lat = s.lateral;
    if (s.wallRight != null && lat > s.wallRight - r) {
      const pen = lat - (s.wallRight - r);
      this.position.x -= rx * pen;
      this.position.z -= rz * pen;
      s.lateral -= pen;
      this._wallEvent(this._reflect(-rx, -rz, h), -rx, -rz);
    } else if (s.wallLeft != null && lat < s.wallLeft + r) {
      const pen = s.wallLeft + r - lat;
      this.position.x += rx * pen;
      this.position.z += rz * pen;
      s.lateral += pen;
      this._wallEvent(this._reflect(rx, rz, h), rx, rz);
    }
  }

  _collideStatic(s, h) {
    const track = this.game.track;
    const grid = getColliderGrid(track);
    if (!grid) return;
    if (!this.grounded && this.position.y > s.height + 1.8) return; // flying over the obstacle
    const cell = grid.map.get(cellKey(Math.floor(this.position.x / CELL), Math.floor(this.position.z / CELL)));
    if (!cell) return;
    const p = this.position;
    for (let i = 0; i < cell.length; i++) {
      const c = cell[i];
      const dx = p.x - c.x, dz = p.z - c.z;
      const rr = this.radius + c.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const nx = dx / d, nz = dz / d;
      const pen = rr - d;
      p.x += nx * pen;
      p.z += nz * pen;
      this._wallEvent(this._reflect(nx, nz, h), nx, nz);
    }
  }

  // ------------------------------------------------------------------------------------ surfaces
  _surfaceEffects(s, h) {
    if (!this.grounded) return;
    const B = TUNE.boost;
    if (s.surface === 'boost') {
      if (!this._onPad) {
        this._onPad = true;
        this.applyBoost(B.pad.duration, B.pad.power, 'pad'); // event only on entry
      }
    } else {
      this._onPad = false;
    }

    // ramps: remember the launch speed; leaving the ramp surface while still on the ground launches too
    if (s.surface === 'ramp') {
      this._wasOnRamp = true;
      this._rampT = 0;
      this._rampLaunch = Math.max(this._rampLaunch, s.launch || 0);
    } else {
      this._rampT += h;
      if (this._wasOnRamp) {
        this._wasOnRamp = false;
        if (this._rampLaunch > 0) {
          // exit without a drop: launch now
          this._takeoff(s);
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------ falling & rescue
  _roadY(s) {
    const track = this.game.track;
    const fr = track.getFrameAt?.(s.s, this._frameTmp);
    return fr?.position ? fr.position.y : this._lastGroundY;
  }

  _checkFall(s, h) {
    const R = TUNE.respawn, track = this.game.track;
    const y = this.position.y;
    let fell = false;
    if (Number.isFinite(track.killY) && y < track.killY) fell = true;
    else if (!this.grounded) {
      if (s.surface === 'void' && y < this._lastGroundY - R.fallDepth) fell = true;
      else if (y < this._lastGroundY - 3.5 && y < this._roadY(s) - R.fallDepth) fell = true;
    } else if (s.surface === 'offroad' && y < this._roadY(s) - R.fallDepth) {
      fell = true;
    }
    if (fell) {
      this._startRespawn(false);
      return;
    }
    // remember the last safe spot (grounded on road/boost, inside the asphalt)
    if (this.grounded && !this.hit && (s.surface === 'road' || s.surface === 'boost') && Math.abs(s.lateral) < s.halfWidth) {
      this._safeTimer += h;
      if (this._safeTimer >= R.sampleInterval) {
        this._safeTimer = 0;
        this._safeS = s.s;
        this._hasSafe = true;
      }
    }
  }

  /** Begin the rescue sequence: fall (or lift) → teleport ~5 m back → lowered by the drone → control back. */
  _startRespawn(manual) {
    if (this.respawnTime > 0) return;
    const R = TUNE.respawn;
    this.respawnTime = R.duration;
    this._respawnManual = manual;
    this._respawnPlaced = false;
    this._liftStartY = this.position.y;
    // cancel everything in flight
    if (this.drifting) this._endDrift(false);
    this.hit = null;
    this.boostTime = 0;
    this._boostPowerT = 0;
    this.trickTime = 0;
    this._trickWindow = 0;
    this._tricked = false;
    this._hopActive = false;
    this.hopping = false;
    this.stallTime = 0;
    this._rampLaunch = 0;
    this._wasOnRamp = false;
    this.grounded = false;
    this.airTime = 0;
    this.game.events.emit(EVT.KART_FALL, { kart: this });
  }

  _stepRespawn(h) {
    const T = TUNE, R = T.respawn;
    const v = this.velocity;
    this.respawnTime = Math.max(0, this.respawnTime - h);
    const t = R.duration - this.respawnTime;
    this.steerAmount = damp(this.steerAmount, 0, 10, h);

    if (!this._respawnPlaced) {
      if (this._respawnManual) {
        // the drone lifts the kart before carrying it away
        const u = smoothstep(0, 1, clamp01(t / R.fallTime));
        this.position.y = this._liftStartY + R.liftHeight * u;
        v.x *= Math.exp(-5 * h);
        v.z *= Math.exp(-5 * h);
        v.y = 0;
        this.position.x += v.x * h;
        this.position.z += v.z * h;
      } else {
        this.airTime += h;
        v.y -= T.gravity * h;
        v.x *= Math.exp(-1.3 * h);
        v.z *= Math.exp(-1.3 * h);
        this.position.addScaledVector(v, h);
      }
      this._querySample();
      this.speed = v.x * Math.sin(this.yaw) + v.z * Math.cos(this.yaw);
      if (t >= R.fallTime) this._placeRespawn();
    } else {
      const u = clamp01((t - R.fallTime) / (R.lowerEnd - R.fallTime));
      const e = u * u * (3 - 2 * u);
      const s = this._querySample();
      const gh = Number.isFinite(s.height) ? s.height : this._lastGroundY;
      this.position.y = gh + R.hoverHeight * (1 - e);
      this._lastGroundY = gh;
      this.up.lerp(sanitizeNormal(_n, s.normal), dampFactor(6, h)).normalize();
    }

    if (this.respawnTime <= 0) {
      // control returns
      const s = this._querySample();
      if (Number.isFinite(s.height)) this.position.y = s.height;
      this.grounded = true;
      this.airTime = 0;
      this.velocity.set(0, 0, 0);
      this.speed = 0;
      this.invulnTime = Math.max(this.invulnTime, R.invuln);
      this._lastGroundY = this.position.y;
      this._safeTimer = 0;
      this._respawnPlaced = false;
    }
  }

  _placeRespawn() {
    const R = TUNE.respawn, track = this.game.track;
    const s = track.wrapS((this._hasSafe ? this._safeS : this.trackS) - R.backDistance);
    const fr = track.getFrameAt(s, this._frameTmp);
    this.position.copy(fr.position);
    this.position.y += R.hoverHeight;
    this.yaw = forwardToYaw(fr.tangent.x, fr.tangent.z);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.yawRate = 0;
    this.trackIndex = -1; // force a global re-acquire after the teleport
    this._querySample();
    this._respawnPlaced = true;
    this._lastGroundY = this.lastSample.height;
    this.game.events.emit(EVT.KART_RESPAWN, { kart: this });
  }

  // ------------------------------------------------------------------------------------ slipstream
  _updateDraft(dt) {
    const T = TUNE.draft;
    const karts = this.game.karts;
    let drafting = false;
    if (karts && this.grounded && this.speed > T.minSpeed && !this.controlLocked && this.respawnTime <= 0 && !this.hit) {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      for (let i = 0; i < karts.length; i++) {
        const k = karts[i];
        if (k === this || k.respawnTime > 0) continue;
        const dx = k.position.x - this.position.x, dz = k.position.z - this.position.z;
        const along = dx * fx + dz * fz;
        if (along < T.minDist || along > T.maxDist) continue;
        const lat = dx * -fz + dz * fx;
        if (Math.abs(lat) > T.halfWidth) continue;
        if (fx * k.forward.x + fz * k.forward.z < T.minAlign) continue;
        if (k.speed < 8) continue;
        drafting = true;
        break;
      }
    }
    this.drafting = drafting;
    if (drafting) {
      this.draftCharge += dt;
      if (this.draftCharge >= T.charge && this._draftCd <= 0) {
        this.draftCharge = 0;
        this._draftCd = T.cooldown;
        this.applyBoost(TUNE.boost.draft.duration, TUNE.boost.draft.power, 'draft');
      }
    } else {
      this.draftCharge = Math.max(0, this.draftCharge - dt * T.decay);
    }
  }

  // ------------------------------------------------------------------------------------ rocket start
  /** While locked in the countdown, remember when (seconds before GO) the throttle was first pressed and held. */
  _trackRocketStart() {
    if (!this.controlLocked) return;
    const race = this.game.race;
    if (race && race.phase === 'countdown' && this.input.throttle > 0.5) {
      if (this._throttleSince === null) this._throttleSince = 3 * COUNTDOWN_STEP - race.phaseTime;
    } else {
      this._throttleSince = null;
    }
  }

  /** Called by RaceManager at GO (after controlLocked = false): rocket start or burnout. */
  onRaceStart() {
    const t0 = this._throttleSince;
    this._throttleSince = null;
    if (t0 === null) return;
    const R = ROCKET_START, B = TUNE.boost.rocket;
    if (t0 > R.stallIfBefore) {
      this.stallTime = TUNE.stallTime;
      this.game.events.emit(EVT.KART_STALL, { kart: this });
    } else if (t0 <= R.windowStart && t0 >= R.windowEnd) {
      const mid = 0.5 * (R.windowStart + R.windowEnd);
      const half = 0.5 * (R.windowStart - R.windowEnd);
      const q = clamp01(1 - Math.abs(t0 - mid) / half);
      this.applyBoost(lerp(B.minDuration, B.maxDuration, q), B.power, 'rocketstart');
    }
  }

  // ==================================================================================================
  // gameplay API
  // ==================================================================================================
  /**
   * Apply a hit reaction. Returns false (and does nothing) if the kart is immune.
   * @param {'spin'|'tumble'|'explode'|'squish'} type
   * @param {Kart|null} source
   */
  applyHit(type, source = null) {
    if (this.isImmune) return false;
    const H = TUNE.hit[type];
    if (!H) return false;
    this.hit = { type, t: 0, duration: H.duration, lock: H.lock };
    this.invulnTime = H.duration + TUNE.hit.invulnExtra;
    if (this.drifting) this._endDrift(false);
    this._hopActive = false;
    this.hopping = false;
    this._trickWindow = 0;
    this._tricked = false;
    this.trickTime = 0;
    this.boostTime = Math.min(this.boostTime, 0.1);
    const v = this.velocity;
    if (H.speedMul === 0) {
      v.x = 0;
      v.z = 0;
    } else {
      v.x *= H.speedMul;
      v.z *= H.speedMul;
    }
    if (H.vy > 0) {
      v.y = H.vy;
      this.grounded = false;
      this.airTime = 0;
      this._lastGroundY = this.position.y;
    }
    this.speed *= H.speedMul;
    this.game.events.emit(EVT.KART_HIT, { kart: this, type, source });
    return true;
  }

  /**
   * Boost. New boosts extend the current one (max of remaining time and power).
   * source: 'miniturbo'|'nitro'|'pad'|'rocketstart'|'trick'|'goldnitro'|'draft'
   */
  applyBoost(duration, power = 1, source = 'nitro') {
    if (this.boostTime > 0) {
      const strongerNow = power >= this._boostPowerT;
      this.boostTime = Math.max(this.boostTime, duration);
      this._boostPowerT = Math.max(this._boostPowerT, power);
      if (strongerNow) this.boostSource = source;
    } else {
      this.boostTime = duration;
      this._boostPowerT = power;
      this.boostSource = source;
    }
    this.game.events.emit(EVT.KART_BOOST, { kart: this, source, duration, power });
  }

  /** Invincible super-speed for `duration` seconds (top speed x1.15, ignores off-road). */
  startStar(duration) {
    const wasActive = this._starActive;
    this.starTime = Math.max(this.starTime, duration);
    this._starActive = true;
    if (!wasActive) this.game.events.emit(EVT.KART_STAR, { kart: this, active: true });
  }

  /** Shrink (radius x0.55, top speed x0.8). Ignored while a star is active. */
  startShrink(duration) {
    if (this.starTime > 0) return;
    const wasActive = this._shrinkActive;
    this.shrinkTime = Math.max(this.shrinkTime, duration);
    this._shrinkActive = true;
    if (!wasActive) this.game.events.emit(EVT.KART_SHRINK, { kart: this, active: true });
  }

  /** Make the kart airborne with the given vertical speed (ramps, bumpers, debugging). */
  launch(verticalSpeed) {
    if (this.respawnTime > 0) return;
    if (this.grounded) {
      this.grounded = false;
      this.airTime = 0;
      this._lastGroundY = this.position.y;
    }
    this.velocity.y = verticalSpeed;
    this._trickWindow = TUNE.trick.window;
    this._tricked = false;
  }

  /** Rescue the kart (AI uses this when hopelessly stuck). Same sequence as falling off the world. */
  respawn() {
    this._startRespawn(true);
  }

  /**
   * Instantaneous horizontal velocity change (kart-kart bumps, item shoves). Temporarily loosens grip so the
   * shove is visible.
   */
  applyImpulse(vx, vz, gripTime = TUNE.bumpGripTime) {
    this.velocity.x += vx;
    this.velocity.z += vz;
    this._bumpSlide = Math.max(this._bumpSlide, gripTime);
  }

  /** Small instantaneous heading change (bump body-english). The drawn chassis eases into it. */
  nudgeYaw(dy) {
    if (this.respawnTime > 0 || this.hit) return;
    this.yaw = wrapAngle(this.yaw + dy);
    this._kick = clamp(this._kick - dy, -0.9, 0.9);
  }

  // ==================================================================================================
  // orientation & safety
  // ==================================================================================================
  _orient(dt) {
    const D = TUNE.drift;
    let target = 0;
    if (this.drifting) {
      const inward01 = (this.steerAmount * this.driftDir + 1) * 0.5;
      target = this.driftDir * lerp(D.slideBase, D.slideInward, inward01);
    }
    this._slide = damp(this._slide, target, D.slideResponse, dt);
    if (Math.abs(this._slide) < 1e-4 && target === 0) this._slide = 0;
    this.slideAngle = this._slide;
    // nose points INTO the turn: drifting right (dir +1) => chassis yaw is smaller than the travel heading
    this._kick = damp(this._kick, 0, 12, dt);
    if (Math.abs(this._kick) < 1e-4) this._kick = 0;
    this.chassisYaw = this.yaw - this._slide + this._kick;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    // secondary motion data: body roll (outward lean), pitch (squat / dive) and landing suspension
    if (dt > 0) {
      const aLong = (this.speed - this._prevSpeed) / dt;
      this._prevSpeed = this.speed;
      const aLat = -this.yawRate * this.speed; // + = turning right
      const rollT = this.grounded ? clamp(-aLat * 0.0032, -0.13, 0.13) : 0;
      const pitchT = this.grounded ? clamp(aLong * 0.0035, -0.09, 0.09) : 0;
      this.bodyRoll = damp(this.bodyRoll, rollT, 9, dt);
      this.bodyPitch = damp(this.bodyPitch, pitchT, 8, dt);
      // damped spring for the suspension (semi-implicit Euler, stable for the largest dt)
      const sub = Math.max(1, Math.ceil(dt / 0.008));
      const sh = dt / sub;
      for (let i = 0; i < sub; i++) {
        this._susV += (-170 * this.suspension - 15 * this._susV) * sh;
        this.suspension += this._susV * sh;
      }
      if (Math.abs(this.suspension) < 1e-4 && Math.abs(this._susV) < 1e-3) this.suspension = this._susV = 0;
    }
    _qa.setFromUnitVectors(UP, this.up);
    _qy.setFromAxisAngle(UP, this.chassisYaw);
    this.quaternion.copy(_qa).multiply(_qy);
  }

  /** Recover from NaN / runaway values (never expected, but a corrupted kart must not kill the frame). */
  _sanity() {
    const p = this.position, v = this.velocity;
    if (!Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z + this.yaw)) {
      console.warn('[Kart] non-finite state, recovering', this.name);
      v.set(0, 0, 0);
      this.speed = 0;
      if (!Number.isFinite(this.yaw)) this.yaw = 0;
      const fr = this.game.track?.getFrameAt?.(this._hasSafe ? this._safeS : 0, this._frameTmp);
      if (fr) p.copy(fr.position);
      else p.set(0, 0, 0);
      this.trackIndex = -1;
      this._querySample();
      this.position.y = this.lastSample.height ?? 0;
      this.grounded = true;
    }
    const hs = Math.hypot(v.x, v.y, v.z);
    if (hs > TUNE.hardSpeedCap) v.multiplyScalar(TUNE.hardSpeedCap / hs);
  }
}
