/**
 * CameraController — chase / intro / finish / orbit camera + shake, FOV and look-back. OWNER: Driving agent.
 * Contract (ARCHITECTURE.md §6.4): drives game.camera.
 *   setupRace({ track, player, karts }), teardownRace(), setTarget(kart), setMode('intro'|'chase'|'finish'|'orbit'),
 *   update(dt), shake(amount, duration), target (Kart|null). Listens to RACE_PHASE and RACE_FINISH.
 *
 * Design notes
 *  - The chase pose is RIGID relative to the kart's current position (no positional lag => no jitter and the
 *    kart never wobbles in frame). All smoothing lives in the camera-relative quantities: a critically-damped
 *    spring on the travel heading (so drifts show the kart's slide), on a vertical reference (looser in the air),
 *    on the extra distance (speed / boost pull-back), on FOV, roll and the lateral look lead.
 *  - Modes never hard-cut: the pose is blended (kart-relative, or world-frozen after a teleport) between modes.
 *  - Intro: a Catmull-Rom flight whose last control point is the LIVE chase pose, so the handoff to the
 *    countdown is exact.
 */
import * as THREE from 'three';
import { EVT } from '../core/events.js';
import { INTRO_DURATION } from '../core/constants.js';
import { UP, clamp, clamp01, lerp, damp, dampFactor, smoothstep, wrapAngle, angleDiff } from '../core/math.js';

// ------------------------------------------------------------------------------------------------ tuning
export const CAM = {
  baseFov: 68,
  boostFov: 10, // extra degrees at boostPower 1 (up to ~12 at 1.2)
  speedFov: 3, // extra degrees at top speed
  fovResponse: 6,
  distance: 6.2, // metres behind the kart
  distanceExtra: 1.5, // extra metres at top speed / boost
  distanceResponse: 3.5,
  height: 2.6, // metres above the (smoothed) kart height
  lookAhead: 3, // look target: kart + forward * lookAhead
  lookUp: 1.1,
  headingResponse: 7.5, // rad/s of the critically damped heading spring (ground)
  headingResponseAir: 4.5,
  headingResponseRespawn: 3.0,
  slipBlend: 0.4, // how much of the velocity-vs-heading slip the camera follows (ice, wall bounces)
  yResponse: 9, // vertical reference follow on the ground
  yResponseAir: 2.4, // looser in the air so jumps read well
  yMaxLag: 3.3, // never let the kart leave the frame vertically
  leadLateral: 1.5, // look lead toward the steering side (m)
  leadDrift: 1.1, // extra lead into a drift (m)
  leadResponse: 5,
  rollDrift: 0.05, // rad of camera roll into a drift (~2.9 deg)
  rollSteer: 0.012,
  rollResponse: 6,
  groundClearance: 0.6,
  wallMargin: 0.7,
  lookBackDistance: 5.4,
  lookBackHeight: 2.3,
  introFovStart: 52,
  finishRadius: 7,
  finishHeight: 2.5,
  finishSpeed: 0.38, // rad/s
  orbitRadius: 9,
  orbitHeight: 3.5,
  orbitSpeed: 0.3,
  // shake
  shakePos: 0.34, // metres at trauma 1
  shakeRot: 0.034, // rad at trauma 1 (~1.9 deg)
  shakeFreq: 52,
  // continuous rumble (off-road, wall scrape, burnout): metres of vibration at rumble 1
  rumblePos: 0.035,
  rumbleRoll: 0.004,
  rumbleFreq: 95,
  // suspension-style dip of the vertical reference on hard landings (m/s per m/s of impact)
  landDip: 0.11,
};

// ------------------------------------------------------------------------------------------------ helpers
/** Critically damped spring state. */
class Spring {
  constructor(x = 0) {
    this.x = x;
    this.v = 0;
  }
  set(x) {
    this.x = x;
    this.v = 0;
  }
  /** Exact critically damped step toward `target` with natural frequency `omega`. Returns x. */
  step(target, omega, dt) {
    const d = this.x - target;
    const e = Math.exp(-omega * dt);
    const c2 = this.v + omega * d;
    this.x = target + (d + c2 * dt) * e;
    this.v = (this.v - omega * c2 * dt) * e;
    return this.x;
  }
  /** Same but for an angle (shortest way round). */
  stepAngle(target, omega, dt) {
    const d = wrapAngle(this.x - target);
    const e = Math.exp(-omega * dt);
    const c2 = this.v + omega * d;
    this.x = wrapAngle(target + (d + c2 * dt) * e);
    this.v = (this.v - omega * c2 * dt) * e;
    return this.x;
  }
}

const smoother = (t) => {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Smooth 1D noise in roughly [-1, 1] built from incommensurate sines (cheap, allocation free). */
const noise1 = (t, seed) => Math.sin(t + seed) * 0.55 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.13 + seed * 2.9) * 0.15;

class Pose {
  constructor() {
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.roll = 0;
    this.fov = CAM.baseFov;
  }
  copy(o) {
    this.pos.copy(o.pos);
    this.look.copy(o.look);
    this.roll = o.roll;
    this.fov = o.fov;
    return this;
  }
}

// scratch
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qRoll = new THREE.Quaternion();
const _qShake = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _zAxis = new THREE.Vector3(0, 0, 1);

export class CameraController {
  /**
   * @param {import('../Game.js').Game} game
   * @param {{ camera?: THREE.PerspectiveCamera }} [opts] camera to drive (default game.camera). Every instance is
   *   fully independent (own state / target / shake; events only for its own target; dispose() removes listeners).
   */
  constructor(game, { camera } = {}) {
    this.game = game;
    this.camera = camera ?? game.camera;
    this._poseFov = CAM.baseFov; // last pose FOV before viewport adaptation
    this._wideT = 0; // 0..1 how far the viewport is past the "very wide" aspect (framing adaptation)
    this._compactT = 0; // 0..1 how small the viewport is (quad)
    /** @type {import('../kart/Kart.js').Kart|null} */
    this.target = null;
    /** 'intro' | 'chase' | 'finish' | 'orbit' */
    this.mode = 'chase';
    this.track = null;
    this.karts = [];
    this._t = 0; // seconds in the current mode
    this._time = 0; // running clock (shake noise)

    // ---- chase state (all camera-relative smoothing) ----
    this._heading = new Spring(0);
    this._yRef = new Spring(0);
    this._dist = new Spring(CAM.distance);
    this._lead = new Spring(0);
    this._roll = new Spring(0);
    this._fov = new Spring(CAM.baseFov);
    this._fovKick = 0;
    this._lastKartPos = new THREE.Vector3();
    this._haveLast = false;
    this._respawnBoost = 0; // >0 while re-acquiring after a teleport (slows the heading spring)
    this._falling = false; // the target is falling off the world: do not chase it down
    this._fallRefY = 0;

    // ---- poses ----
    this._chase = new Pose();
    this._mode = new Pose();
    this._out = new Pose();

    // ---- blending ----
    this._blendT = 1;
    this._blendDur = 0;
    this._blendWorld = false;
    this._fromPos = new THREE.Vector3();
    this._fromLook = new THREE.Vector3();
    this._fromRoll = 0;
    this._fromFov = CAM.baseFov;

    // ---- orbit / finish ----
    this._orbitAngle = 0;

    // ---- intro ----
    this._introPos = null;
    this._introLook = null;
    this._introLast = 4;
    this._introProgress = 0;

    // ---- ground / wall clearance ----
    this._camSample = {};
    this._camHint = -1;
    this._clearY = 0;
    this._wallPush = new THREE.Vector3();
    this._fr = {};

    // ---- shake ----
    this._shakes = [];
    for (let i = 0; i < 8; i++) this._shakes.push({ amp: 0, t: 0, dur: 1 });
    this._trauma = 0;
    this._rumble = 0;

    // ---- events (the controller lives as long as the game) ----
    const ev = game.events;
    this._offs = [
      ev.on(EVT.RACE_PHASE, ({ phase }) => {
        if (phase === 'intro') this.setMode('intro');
        else if ((phase === 'countdown' || phase === 'racing') && (this.mode === 'intro' || this.mode === 'orbit')) this.setMode('chase');
      }),
      ev.on(EVT.RACE_FINISH, ({ kart }) => {
        if (kart === this.target) this.setMode('finish');
      }),
      ev.on(EVT.RACE_START, () => {
        this._fovKick = Math.max(this._fovKick, 4);
      }),
      ev.on(EVT.KART_HIT, ({ kart }) => {
        if (kart !== this.target) return;
        this.shake(0.6, 0.6);
        this._fovKick = Math.max(this._fovKick, 3);
      }),
      ev.on(EVT.ITEM_EXPLODE, ({ position, radius }) => {
        const k = this.target;
        if (!k || !position) return;
        const d = Math.hypot(position.x - k.position.x, position.y - k.position.y, position.z - k.position.z);
        const reach = 42 + (radius ?? 3) * 2;
        const f = clamp01(1 - d / reach);
        if (f > 0.02) this.shake(0.8 * f * f + 0.05, 0.65);
      }),
      ev.on(EVT.ITEM_LIGHTNING, ({ owner }) => {
        if (this.target && owner !== this.target) this.shake(0.5, 0.9);
      }),
      ev.on(EVT.KART_WALL, ({ kart, impact }) => {
        if (kart === this.target) this.shake(clamp((impact ?? 0) / 30, 0, 1) * 0.55 + 0.04, 0.32);
      }),
      ev.on(EVT.KART_LAND, ({ kart, impact }) => {
        if (kart !== this.target) return;
        if (impact > 10) this.shake(clamp((impact - 10) / 20, 0, 1) * 0.4 + 0.1, 0.36);
        if (impact > 5) this._yRef.v -= clamp(impact, 0, 24) * CAM.landDip; // the view dips with the suspension
      }),
      ev.on(EVT.KART_BUMP, ({ a, b }) => {
        if (a === this.target || b === this.target) this.shake(0.2, 0.28);
      }),
      ev.on(EVT.KART_BOOST, ({ kart, power }) => {
        if (kart === this.target && power >= 0.9) {
          this.shake(0.1, 0.25);
          this._fovKick = Math.max(this._fovKick, 2.5);
        }
      }),
      ev.on(EVT.KART_FALL, ({ kart }) => {
        if (kart !== this.target) return;
        // like a rescue cam: hold the road-level view while the kart drops out of frame
        this._respawnBoost = 3;
        this._falling = true;
        this._fallRefY = this._yRef.x;
      }),
      ev.on(EVT.KART_RESPAWN, ({ kart }) => {
        if (kart !== this.target) return;
        this._falling = false;
        this._acquire(1.1);
      }),
    ];
  }

  /** Remove the event subscriptions (the controller normally lives as long as the game). */
  dispose() {
    for (const off of this._offs) off?.();
    this._offs.length = 0;
  }

  // ================================================================================================
  // race lifecycle
  // ================================================================================================
  /**
   * Start following a new race: snap to the chase pose behind `player` (the intro / countdown phases then switch modes).
   * @param {{ track: object, player: import('../kart/Kart.js').Kart, karts: import('../kart/Kart.js').Kart[] }} ctx
   */
  setupRace({ track, player, karts }) {
    this.track = track ?? this.game.track ?? null;
    this.karts = karts ?? [];
    this._camHint = -1;
    this._clearY = 0;
    this._wallPush.set(0, 0, 0);
    this.target = player ?? this.karts[0] ?? null;
    this._trauma = 0;
    this._rumble = 0;
    for (const s of this._shakes) s.amp = 0;
    this._fovKick = 0;
    this._respawnBoost = 0;
    this._falling = false;
    this._introPos = this._introLook = null;
    this.mode = 'chase';
    this._t = 0;
    this._blendT = 1;
    this._snapToTarget();
    this._applyImmediate();
  }

  /** Release everything belonging to the finished race. */
  teardownRace() {
    this.target = null;
    this.track = null;
    this.karts = [];
    this._blendT = 1;
    this._introPos = this._introLook = null;
    this._haveLast = false;
    this._falling = false;
    this._camHint = -1;
    for (const s of this._shakes) s.amp = 0;
    this._trauma = 0;
    this.mode = 'chase';
    this.camera.fov = CAM.baseFov;
    this.camera.updateProjectionMatrix();
  }

  /** Follow another kart (snaps the chase springs to it). */
  setTarget(kart) {
    this.target = kart;
    if (kart) {
      this._snapToTarget();
      this._haveLast = false;
    }
  }

  /** Change the camera mode; the pose is blended so nothing ever pops. */
  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    this._t = 0;
    if (mode === 'intro') {
      if (!this._buildIntro()) this.mode = 'chase';
      return;
    }
    if (prev === 'intro' && mode === 'chase') {
      // finished intros end exactly on the chase pose; an interrupted one (skip) blends over
      if (this._introProgress < 0.995) this._startBlend(0.75, false);
    } else if (mode === 'finish' || mode === 'orbit') {
      const k = this.target;
      if (k) this._orbitAngle = Math.atan2(this.camera.position.x - k.position.x, this.camera.position.z - k.position.z);
      this._startBlend(1.3, false);
    } else if (mode === 'chase' && (prev === 'finish' || prev === 'orbit')) {
      this._startBlend(0.9, false);
    }
  }

  /** Add camera shake. amount ~0..1 (0.6 = a hit), duration in seconds. */
  shake(amount, duration = 0.4) {
    if (!(amount > 0)) return;
    let slot = this._shakes[0];
    for (const s of this._shakes) {
      if (s.amp <= 0 || s.t >= s.dur) {
        slot = s;
        break;
      }
      if (this._shakeLeft(s) < this._shakeLeft(slot)) slot = s;
    }
    slot.amp = amount;
    slot.t = 0;
    slot.dur = Math.max(0.05, duration);
  }

  _shakeLeft(s) {
    const f = 1 - s.t / s.dur;
    return f > 0 ? s.amp * f * f : 0;
  }

  // ================================================================================================
  // blending helpers
  // ================================================================================================
  /** Capture the current camera as the start of a blend (kart-relative, or frozen in the world). */
  _startBlend(duration, world) {
    const cam = this.camera;
    this._blendWorld = !!world;
    this._blendDur = duration;
    this._blendT = 0;
    this._fromRoll = this._out.roll;
    this._fromFov = this._poseFov;
    const k = this.target;
    // where the camera is looking: use the previous look target if we have one
    this._fromLook.copy(this._out.look);
    this._fromPos.copy(cam.position);
    if (!world && k) {
      this._fromPos.sub(k.position);
      this._fromLook.sub(k.position);
    }
  }

  /** Re-acquire after a teleport: snap the springs to the new kart pose, blend the picture from the frozen old one. */
  _acquire(duration) {
    this._startBlend(duration, true);
    this._snapToTarget();
    this._respawnBoost = 0;
    this._haveLast = false;
    this._camHint = -1;
  }

  _snapToTarget() {
    const k = this.target;
    if (!k) return;
    this._heading.set(k.yaw);
    this._yRef.set(k.position.y);
    this._dist.set(CAM.distance);
    this._lead.set(0);
    this._roll.set(0);
    this._fov.set(CAM.baseFov);
    this._lastKartPos.copy(k.position);
    this._haveLast = true;
  }

  /** Compute and apply the pose for the current state right now (used on setup so frame 0 is correct). */
  _applyImmediate() {
    const k = this.target;
    if (!k) return;
    this._computeChasePose(this._chase);
    this._out.copy(this._chase);
    this._finalize(this._out, 0);
  }

  // ================================================================================================
  // update
  // ================================================================================================
  /** Advance the camera by `dt` seconds (call after all karts moved). dt === 0 keeps the pose. */
  update(dt) {
    const k = this.target;
    if (!k) return;
    if (!(dt > 0)) {
      // paused: keep the pose exactly as is
      return;
    }
    this._time += dt;
    this._t += dt;

    // teleport detection (respawn, debug moves): re-acquire smoothly
    if (this._haveLast && _v1.copy(k.position).sub(this._lastKartPos).lengthSq() > 12 * 12) this._acquire(0.9);
    this._lastKartPos.copy(k.position);
    this._haveLast = true;

    // keep the chase springs live in every mode (so the handoff into chase is always valid)
    this._updateChaseState(k, dt);
    this._computeChasePose(this._chase);

    // mode pose
    const pose = this._mode;
    switch (this.mode) {
      case 'intro':
        this._introPose(k, pose, dt);
        break;
      case 'finish':
        this._orbitPose(k, pose, dt, CAM.finishRadius, CAM.finishHeight, CAM.finishSpeed);
        break;
      case 'orbit':
        this._orbitPose(k, pose, dt, CAM.orbitRadius, CAM.orbitHeight, CAM.orbitSpeed);
        break;
      default:
        pose.copy(this._chase);
    }

    // look back: an instant cut to a camera in front of the kart (the springs keep running underneath)
    let out = pose;
    if (this.mode === 'chase' && k.input?.lookBack && this._blendT >= 1) {
      this._lookBackPose(k, this._out);
      out = this._out;
    } else {
      this._out.copy(pose);
      // blend from the previous mode / teleport
      if (this._blendT < 1) {
        this._blendT = Math.min(1, this._blendT + dt / Math.max(this._blendDur, 1e-3));
        const w = smoother(this._blendT);
        _v1.copy(this._fromPos);
        _v2.copy(this._fromLook);
        if (!this._blendWorld) {
          _v1.add(k.position);
          _v2.add(k.position);
        }
        this._out.pos.lerpVectors(_v1, pose.pos, w);
        this._out.look.lerpVectors(_v2, pose.look, w);
        this._out.roll = lerp(this._fromRoll, pose.roll, w);
        this._out.fov = lerp(this._fromFov, pose.fov, w);
      }
    }
    this._finalize(this._out, dt);
  }

  // ------------------------------------------------------------------------------------ chase model
  _updateChaseState(k, dt) {
    const grounded = k.grounded && k.respawnTime <= 0;
    const speed = Math.abs(k.speed);
    const top = Math.max(k.topSpeed || 30, 1);

    // heading: the kart's travel heading, plus a little of the real velocity direction (ice / bounces)
    let target = k.yaw;
    const vh = Math.hypot(k.velocity.x, k.velocity.z);
    if (vh > 6 && grounded && k.speed > 0) {
      const vYaw = Math.atan2(k.velocity.x, k.velocity.z);
      const w = clamp01((vh - 6) / 10) * CAM.slipBlend;
      target = k.yaw + angleDiff(k.yaw, vYaw) * w;
    }
    this._respawnBoost = Math.max(0, this._respawnBoost - dt);
    const hr = this._respawnBoost > 0 ? CAM.headingResponseRespawn : grounded ? CAM.headingResponse : CAM.headingResponseAir;
    this._heading.stepAngle(target, hr, dt);

    // vertical reference: tight on the ground, loose in the air, never further than yMaxLag from the kart
    // (except while it falls off the world: then the camera holds the road-level view)
    if (this._falling && k.respawnTime <= 0) this._falling = false;
    const yTarget = this._falling ? Math.max(k.position.y, this._fallRefY - 2.5) : k.position.y;
    this._yRef.step(yTarget, grounded ? CAM.yResponse : CAM.yResponseAir, dt);
    if (!this._falling) {
      const lag = this._yRef.x - k.position.y;
      if (Math.abs(lag) > CAM.yMaxLag) {
        this._yRef.x = k.position.y + Math.sign(lag) * CAM.yMaxLag;
        this._yRef.v *= 0.5;
      }
    }

    // distance: pulls back with speed / boost
    const extra = CAM.distanceExtra * Math.max(clamp01(speed / top) * 0.6, clamp01(k.boostPower));
    this._dist.step(CAM.distance + extra, CAM.distanceResponse, dt);

    // look lead into the steering / drift side, and camera roll into drifts
    const leadTarget = clamp(k.steerAmount * CAM.leadLateral + (k.drifting ? k.driftDir * CAM.leadDrift : 0), -2.2, 2.2);
    this._lead.step(leadTarget, CAM.leadResponse, dt);
    const rollTarget = -(k.drifting ? k.driftDir * CAM.rollDrift : 0) - k.steerAmount * CAM.rollSteer * clamp01(speed / top);
    this._roll.step(rollTarget, CAM.rollResponse, dt);

    // continuous rumble: off-road, scraping a wall, burning out
    let rumble = 0;
    if (grounded) {
      const sp = clamp01(speed / top);
      if (k.surface === 'offroad' && k.starTime <= 0 && k.boostPower < 0.3 && speed > 5) rumble = 0.3 + 0.7 * sp;
      if (k.wallContact < 0.1 && speed > 3) rumble = Math.max(rumble, 0.55 + 0.45 * sp);
    }
    if (k.stallTime > 0) rumble = Math.max(rumble, 0.8);
    this._rumble = damp(this._rumble, rumble, 14, dt);

    // FOV
    this._fovKick = damp(this._fovKick, 0, 5, dt);
    const fovTarget = CAM.baseFov + CAM.boostFov * clamp(k.boostPower, 0, 1.2) + CAM.speedFov * clamp01(speed / top) + this._fovKick;
    this._fov.step(fovTarget, CAM.fovResponse, dt);
  }

  _computeChasePose(out) {
    const k = this.target;
    const h = this._heading.x;
    const fx = Math.sin(h), fz = Math.cos(h);
    const rx = -fz, rz = fx; // right of the camera heading
    const yr = this._yRef.x;
    const d = this._dist.x;
    const fr = this._framing();
    const dd = d * fr.dist;
    out.pos.set(k.position.x - fx * dd, yr + CAM.height * fr.height, k.position.z - fz * dd);
    const ky = this._falling ? Math.max(k.position.y, yr - 5) : k.position.y; // (a falling kart may leave the frame)
    const kyLag = ky - yr; // how far the real kart is above the smoothed reference
    const ly = yr + CAM.lookUp + kyLag * 0.6;
    out.look.set(k.position.x + fx * CAM.lookAhead + rx * this._lead.x, ly, k.position.z + fz * CAM.lookAhead + rz * this._lead.x);
    out.roll = this._roll.x;
    out.fov = this._fov.x;
  }

  _lookBackPose(k, out) {
    const h = this._heading.x;
    const fx = Math.sin(h), fz = Math.cos(h);
    const yr = this._yRef.x;
    const fr = this._framing();
    out.pos.set(k.position.x + fx * CAM.lookBackDistance * fr.dist, yr + CAM.lookBackHeight * fr.height, k.position.z + fz * CAM.lookBackDistance * fr.dist);
    out.look.set(k.position.x - fx * 3, yr + 1, k.position.z - fz * 3);
    out.roll = 0;
    out.fov = CAM.baseFov + 2 + CAM.boostFov * 0.5 * clamp(k.boostPower, 0, 1.2);
  }

  _orbitPose(k, out, dt, radius, height, speed) {
    this._orbitAngle += speed * dt;
    const a = this._orbitAngle;
    out.pos.set(k.position.x + Math.sin(a) * radius, this._yRef.x + height, k.position.z + Math.cos(a) * radius);
    out.look.set(k.position.x, this._yRef.x + 1.0 + (k.position.y - this._yRef.x) * 0.6, k.position.z);
    out.roll = 0;
    out.fov = CAM.baseFov - 4;
  }

  // ------------------------------------------------------------------------------------ intro
  /** Frame on the track at s: writes position (+ lateral + height) into `out`. */
  _trackPoint(s, lateral, height, out) {
    const f = this.track.getFrameAt(s, this._fr);
    out.copy(f.position).addScaledVector(f.right, lateral);
    out.y += height;
    return f.halfWidth ?? 9;
  }

  _buildIntro() {
    const k = this.target, track = this.track;
    this._introProgress = 0;
    if (!k || !track?.getFrameAt) return false;
    const pole = this.karts[0] ?? k;
    const sPl = k.trackS;
    const s0 = track.startS ?? 0; // the start line / gantry plane
    const hw = track.getFrameAt(s0, this._fr).halfWidth ?? 9;
    const P = (s, lat, h) => {
      const v = new THREE.Vector3();
      this._trackPoint(s, lat, h, v);
      return v;
    };
    // Camera path: high & wide beyond the start gantry -> over the gantry (clear of it) -> down along the grid beside
    // the player -> the live chase pose behind the player.
    const sSide = Math.min(sPl + 9, s0 - 9);
    const latSide = k.lateral + (k.lateral >= 0 ? -1 : 1) * hw * 0.55;
    const c0 = P(s0 + 44, -(hw + 14), 34);
    const c1 = P(s0 + 15, -hw * 0.35, 27);
    const c2 = P(s0 - 1, hw * 0.3, 21);
    const c3 = P(sSide, latSide, 8.5);
    const c4 = new THREE.Vector3(); // live chase pose, refreshed every frame
    // Look path: the pack -> the pack -> the pack -> the player -> the chase look target
    const mid = _v1.copy(pole.position).lerp(k.position, 0.5);
    const l0 = new THREE.Vector3(mid.x, mid.y + 1.5, mid.z);
    const l1 = l0.clone();
    const l2 = l0.clone();
    const l3 = new THREE.Vector3(k.position.x, k.position.y + 1.1, k.position.z);
    const l4 = new THREE.Vector3();
    this._introPos = new THREE.CatmullRomCurve3([c0, c1, c2, c3, c4], false, 'centripetal');
    this._introLook = new THREE.CatmullRomCurve3([l0, l1, l2, l3, l4], false, 'centripetal');
    this._introLast = 4;
    return true;
  }

  _introPose(k, out, dt) {
    if (!this._introPos) {
      out.copy(this._chase);
      return;
    }
    const raceT = this.game.race?.phase === 'intro' ? this.game.race.phaseTime : this._t;
    const t = clamp01(Math.max(this._t, raceT) / INTRO_DURATION);
    this._introProgress = t;
    // the last control points ARE the live chase pose => exact handoff
    const last = this._introLast ?? this._introPos.points.length - 1;
    this._introPos.points[last].copy(this._chase.pos);
    this._introLook.points[last].copy(this._chase.look);
    const u = smoother(t);
    this._introPos.getPoint(u, out.pos);
    this._introLook.getPoint(u, out.look);
    out.roll = this._chase.roll * smoothstep(0.6, 1, t);
    out.fov = lerp(CAM.introFovStart, this._chase.fov, smoothstep(0, 1, Math.pow(t, 0.85)));
  }

  // ------------------------------------------------------------------------------------ viewport adaptation
  /**
   * Chase framing factors for the current viewport. Full-screen 16:9 .. 21:9 (and 1P in general) are untouched;
   * only very wide views (2P halves ~3.5:1) and small views (quad) change.
   */
  _framing() {
    const cam = this.camera;
    const a = cam.aspect || 1.78;
    // very wide: ramp in between aspect 2.45 (21:9 = untouched) and 3.5 (2P half at 16:9)
    this._wideT = smoothstep(2.45, 3.5, a);
    // small viewport (quad / 3P): measure the view this camera belongs to
    let area = 1;
    const views = this.game.views;
    if (views && views.length > 1) {
      for (const v of views) if (v.camera === cam && v.rect) { area = v.rect.w * v.rect.h; break; }
    }
    this._compactT = clamp01((0.5 - area) / 0.25);
    const w = this._wideT, c = this._compactT;
    return { dist: 1 - 0.12 * c + 0.04 * w, height: 1 + 0.22 * w - 0.06 * c };
  }

  /** Adapt the vertical FOV: keep a sensible horizontal FOV on very wide views, a bit tighter on small ones. */
  _adaptFov(fov) {
    const w = this._wideT, c = this._compactT;
    if (w <= 0 && c <= 0) return fov;
    const k = lerp(1, 0.62, w) * lerp(1, 0.93, c);
    const half = Math.atan(Math.tan((fov * Math.PI) / 360) * k);
    return (half * 360) / Math.PI;
  }

  // ------------------------------------------------------------------------------------ final placement
  /** Clearance, shake, then write into the real camera. */
  _finalize(pose, dt) {
    const cam = this.camera;
    _v1.copy(pose.pos);

    // ---- keep the camera above the ground and inside the walls (smooth: instant up, slow release) ----
    const track = this.track;
    if (track?.query) {
      const s = track.query(_v1, this._camHint, this._camSample);
      this._camHint = s.index;
      let needY = 0;
      if (s.surface !== 'void' && Number.isFinite(s.height)) needY = Math.max(0, s.height + CAM.groundClearance - _v1.y);
      this._clearY = Math.max(needY, dt > 0 ? damp(this._clearY, 0, 7, dt) : this._clearY);
      _v1.y += this._clearY;
      // optional: tracks may report an overhead surface (cave roof, bridge deck) as `ceiling` (world y); stay under it
      if (Number.isFinite(s.ceiling)) _v1.y = Math.min(_v1.y, s.ceiling - 0.6);
      // walls: pull the camera back inside so it never films the outside of the level
      let px = 0, pz = 0;
      if (s.right && s.surface !== 'void') {
        let rx = s.right.x, rz = s.right.z;
        const rl = Math.hypot(rx, rz) || 1;
        rx /= rl;
        rz /= rl;
        const lat = s.lateral;
        if (s.wallRight != null && lat > s.wallRight - CAM.wallMargin) {
          const over = lat - (s.wallRight - CAM.wallMargin);
          px = -rx * over;
          pz = -rz * over;
        } else if (s.wallLeft != null && lat < s.wallLeft + CAM.wallMargin) {
          const over = s.wallLeft + CAM.wallMargin - lat;
          px = rx * over;
          pz = rz * over;
        }
      }
      const cur = this._wallPush;
      if (px * px + pz * pz >= cur.x * cur.x + cur.z * cur.z) cur.set(px, 0, pz);
      else if (dt > 0) {
        const f = dampFactor(6, dt);
        cur.x += (px - cur.x) * f;
        cur.z += (pz - cur.z) * f;
      }
      _v1.x += cur.x;
      _v1.z += cur.z;
    }

    // ---- orientation ----
    _m.lookAt(_v1, pose.look, UP);
    cam.quaternion.setFromRotationMatrix(_m);
    if (pose.roll !== 0) cam.quaternion.multiply(_qRoll.setFromAxisAngle(_zAxis, pose.roll));

    // ---- shake (trauma model: offsets scale with trauma^1.5, noise is smooth) ----
    let trauma = 0;
    for (const sh of this._shakes) {
      if (sh.amp <= 0) continue;
      sh.t += dt;
      if (sh.t >= sh.dur) {
        sh.amp = 0;
        continue;
      }
      const f = 1 - sh.t / sh.dur;
      trauma += sh.amp * f * f;
    }
    trauma = Math.min(1, trauma);
    this._trauma = trauma;
    if (trauma > 0.002) {
      const m = trauma * Math.sqrt(trauma);
      const tt = this._time * CAM.shakeFreq;
      const nx = noise1(tt, 1.3), ny = noise1(tt, 7.7), nz = noise1(tt, 13.1);
      const nrx = noise1(tt * 0.9, 21.3), nry = noise1(tt * 1.1, 33.9), nrz = noise1(tt, 45.5);
      // offsets in camera space
      _v2.set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(nx * CAM.shakePos * m);
      _v3.set(0, 1, 0).applyQuaternion(cam.quaternion).multiplyScalar(ny * CAM.shakePos * m * 0.8);
      _v1.add(_v2).add(_v3);
      _eul.set(nrx * CAM.shakeRot * m * 0.8, nry * CAM.shakeRot * m * 0.8, nrz * CAM.shakeRot * m * 1.2, 'YXZ');
      cam.quaternion.multiply(_qShake.setFromEuler(_eul));
    }
    if (this._rumble > 0.01) {
      const rt = this._time * CAM.rumbleFreq;
      const r = this._rumble;
      _v2.set(0, 1, 0).applyQuaternion(cam.quaternion).multiplyScalar(noise1(rt, 3.1) * CAM.rumblePos * r);
      _v3.set(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(noise1(rt * 0.93, 9.7) * CAM.rumblePos * 0.6 * r);
      _v1.add(_v2).add(_v3);
      cam.quaternion.multiply(_qShake.setFromAxisAngle(_zAxis, noise1(rt * 1.07, 17.9) * CAM.rumbleRoll * r));
    }
    cam.position.copy(_v1);

    // ---- FOV (adapted to the viewport: narrower vertical FOV on very wide / small views) ----
    this._poseFov = pose.fov;
    const fov = this._adaptFov(pose.fov);
    if (Math.abs(cam.fov - fov) > 0.004) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
