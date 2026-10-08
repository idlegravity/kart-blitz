/**
 * KartModel — a character + kart, procedurally built and fully animated.
 * Contract (ARCHITECTURE.md §6.5):
 *   new KartModel(character, { isPlayer, quality })
 *   root: THREE.Group (origin = ground contact point under the kart centre, model faces +Z, +X = kart left)
 *   update(dt, kart | null)  — sync root to kart.position/quaternion and animate everything; null = idle/menu animation
 *   getAnchor(name, out)     — 'wheelFL','wheelFR','wheelRL','wheelRR','exhaustL','exhaustR','head','back'
 *                              (+ 'front','top','center','hook'); wheels report the tyre contact point
 *   dispose()
 * Draw calls: chassis + 4 wheels + steering wheel + torso + head + blob shadow = 9 (dizzy stars / drone only while shown).
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { events } from '../core/EventBus.js';
import { EVT } from '../core/events.js';
import { clamp, wrapAngle } from '../core/math.js';
import { setDetail } from './geo.js';
import { KART_CLASSES, makePalette, buildChassis, buildWheelGeo, buildSteeringGeo } from './karts.js';
import { createAtlas } from './atlas.js';
import { makeKartUniforms, createKartMaterial } from './material.js';
import { buildDriver } from './drivers/index.js';
import { Spring, FlexChannel, follow, easeOutCubic, easeInOutCubic } from './animation.js';
import { createDrone, createDizzy, blobTexture } from './extras.js';

const PIV = 0.55; // height of the flip/scale pivot (kart centre)
const TAU = Math.PI * 2;
const HOOKS = { light: [0, 1.6, -0.88], medium: [0, 1.06, -0.66], heavy: [0, 1.18, -0.8] };

const PART_CACHE = new Map();

/** Geometry for a character is built once per quality tier and shared by every instance. */
function getParts(character, quality) {
  const key = `${character.id}:${quality === 'low' ? 'l' : 'h'}`;
  let p = PART_CACHE.get(key);
  if (p) return p;
  setDetail(quality === 'low' ? 0.7 : 1);
  const cn = KART_CLASSES[character.weightClass] ? character.weightClass : 'medium';
  const cls = KART_CLASSES[cn];
  const palette = makePalette(character);
  const chassis = buildChassis(cn, palette);
  const wheelF = buildWheelGeo(cls.wheels.front, cn, palette);
  const wheelR = buildWheelGeo(cls.wheels.rear, cn, palette);
  const steer = buildSteeringGeo(cn, palette);
  const driver = buildDriver(character, { palette, cls, className: cn, quality });
  p = { cn, cls, palette, chassis, wheelF, wheelR, steer, driver, tris: chassis.tris + wheelF.tris * 2 + wheelR.tris * 2 + steer.tris + driver.tris };
  PART_CACHE.set(key, p);
  return p;
}

/** Triangle count of a character's kart (dev tooling). */
export function kartTriangleCount(character, quality = 'high') {
  return getParts(character, quality).tris;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler();
const _axis = new THREE.Vector3();

export class KartModel {
  /**
   * @param {object} character entry of CHARACTERS
   * @param {{isPlayer?: boolean, quality?: 'low'|'medium'|'high'}} opts
   */
  constructor(character, { isPlayer = false, quality = 'high' } = {}) {
    this.character = character;
    this.isPlayer = isPlayer;
    this.quality = quality;
    const P = (this.parts = getParts(character, quality));
    const cls = P.cls;
    const D = P.driver;
    this.cls = cls;

    // ---------------- materials ----------------
    this.uniforms = makeKartUniforms(createAtlas(character));
    this.material = createKartMaterial(this.uniforms, { quality });

    // ---------------- hierarchy ----------------
    this.root = new THREE.Group();
    this.root.name = `kart:${character.id}`;
    this.fxRoot = new THREE.Group();
    this.fxRoot.position.y = PIV;
    this.fxRoot.rotation.order = 'YXZ';
    this.hull = new THREE.Group();
    this.hull.position.y = -PIV;
    this.wheelsRoot = new THREE.Group();
    this.wheelsRoot.position.y = -PIV;
    this.fxRoot.add(this.hull, this.wheelsRoot);
    this.root.add(this.fxRoot);

    const mk = (geo, cast = true) => {
      const m = new THREE.Mesh(geo, this.material);
      m.castShadow = cast;
      m.receiveShadow = false;
      m.frustumCulled = true;
      return m;
    };
    this.chassisMesh = mk(P.chassis.geo);
    this.hull.add(this.chassisMesh);

    // wheels
    this.wheels = [];
    this.anchors = {};
    const A = (name, parent, x, y, z) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.anchors[name] = o;
      return o;
    };
    for (const [name, axle, sx, sz] of [['FL', 'front', 1, 1], ['FR', 'front', -1, 1], ['RL', 'rear', 1, -1], ['RR', 'rear', -1, -1]]) {
      const spec = cls.wheels[axle];
      const pivot = new THREE.Group();
      pivot.position.set(sx * spec.x, spec.r, spec.z);
      const spin = new THREE.Group();
      const mesh = mk(axle === 'front' ? P.wheelF.geo : P.wheelR.geo);
      if (sx < 0) mesh.rotation.y = Math.PI;
      spin.add(mesh);
      pivot.add(spin);
      this.wheelsRoot.add(pivot);
      this.wheels.push({ name, axle, pivot, spin, mesh, r: spec.r, side: sx });
      A('wheel' + name, this.wheelsRoot, sx * spec.x, 0, spec.z);
    }

    // steering wheel (+ hand handles)
    this.steerPivot = new THREE.Group();
    this.steerPivot.position.set(...cls.steer.pos);
    this.steerPivot.rotation.set(cls.steer.tilt, Math.PI, 0);
    this.steerMesh = mk(P.steer.geo, false);
    this.steerPivot.add(this.steerMesh);
    this.handleR = new THREE.Object3D();
    this.handleL = new THREE.Object3D();
    this.handleR.position.set(cls.steer.R * 0.98, 0, 0);
    this.handleL.position.set(-cls.steer.R * 0.98, 0, 0);
    this.steerMesh.add(this.handleR, this.handleL);
    this.hull.add(this.steerPivot);

    // driver
    this.driver = new THREE.Group();
    this.driver.position.set(...cls.seat);
    this.torsoMesh = mk(D.torso);
    this.driver.add(this.torsoMesh);
    this.head = new THREE.Group();
    this.head.position.y = D.neckY;
    this.headMesh = mk(D.head);
    this.head.add(this.headMesh);
    this.driver.add(this.head);
    this.hull.add(this.driver);
    if (D.extras) D.extras(this);

    // anchors
    A('exhaustL', this.hull, ...cls.exhausts[0]);
    A('exhaustR', this.hull, ...cls.exhausts[1]);
    A('back', this.hull, ...cls.back);
    A('front', this.hull, ...cls.nose);
    A('hook', this.hull, ...HOOKS[P.cn]);
    A('center', this.hull, 0, PIV, 0);
    A('head', this.head, 0, D.h.cy, 0);
    A('top', this.head, 0, D.h.cy + D.h.ry + 0.4, 0);

    // dizzy stars over the head
    this.dizzy = createDizzy(quality);
    this.dizzy.group.position.y = D.h.cy + D.h.ry + 0.22;
    this.head.add(this.dizzy.group);

    // rescue drone (built lazily on first use)
    this.drone = null;

    // blob contact shadow
    this.blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0.85 });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.scale.set(2.4, 3.1, 1);
    this.blob.position.y = 0.035;
    this.blob.renderOrder = -1;
    this.blob.frustumCulled = false;
    this.root.add(this.blob);

    // ---------------- animation state ----------------
    this.kart = null;
    this.t = Math.random() * 20;
    this.celebrate = false;
    this.flexChans = D.channels.map((d) => new FlexChannel(d));
    this.drive = { t: 0, dt: 0, speed: 0, boost: 0, accelZ: 0, accelX: 0, accelY: 0, yawRate: 0, excite: 0, chaos: 0, idle: true };
    const S = (this.S = {
      roll: new Spring(140, 13),
      pitch: new Spring(120, 12),
      bob: new Spring(190, 13),
      sq: new Spring(230, 12, 1),
      lean: new Spring(90, 9),
      dPitch: new Spring(80, 9),
      hopY: new Spring(60, 8),
      scale: new Spring(220, 11, 1),
      headYaw: 0,
      headPitch: 0,
      headRoll: 0,
      headYawVel: 0,
      steerVis: 0,
      driftBlend: 0,
      spinF: 0,
      spinR: 0,
      prevSpeed: 0,
      prevVy: 0,
      accel: 0,
      wasGrounded: true,
      wasAirborneVy: 0,
      starU: 0,
      scorch: 0,
      scorchTail: 0,
      dizzyT: 0,
      blinkT: 1 + Math.random() * 3,
      blinkP: 0,
      squint: 0,
      lookT: 0,
      lookYawT: 0,
      lookPitchT: 0,
      celebT: 0,
      celebBlend: 0,
      trickT: 0,
      trickKind: 0,
      shake: 0,
      droneT: 0,
      droneOut: 0,
      droneCarried: false,
      droneLeave: null,
      fallBlend: 0,
      fallT: 0,
      hitPrev: null,
      hitFlail: 0,
      armRot: [new THREE.Vector3(), new THREE.Vector3()],
      respawnBlend: 0,
      invulnFlick: 0,
      boostBlend: 0,
    });
    this.sh = { L: new THREE.Vector3(...D.rest.shoulders.L), R: new THREE.Vector3(...D.rest.shoulders.R) };
    this.hand0 = { L: new THREE.Vector3(...D.rest.hands.L), R: new THREE.Vector3(...D.rest.hands.R) };

    // events → springs
    this._offs = [
      events.on(EVT.KART_LAND, (e) => {
        if (e.kart !== this.kart) return;
        const k = Math.min(e.impact ?? 6, 25);
        if (!this._phys) {
          S.bob.kick(-k * 0.06);
          S.sq.kick(-k * 0.07);
          S.pitch.kick(k * 0.03);
        } else S.sq.kick(-k * 0.03); // the body compression itself comes from kart.suspension
        S.dPitch.kick(k * 0.05);
      }),
      events.on(EVT.KART_HOP, (e) => {
        if (e.kart !== this.kart) return;
        S.sq.kick(1.8);
        S.dPitch.kick(-0.8);
      }),
      events.on(EVT.KART_BOOST, (e) => {
        if (e.kart !== this.kart) return;
        S.sq.kick(2.4);
        S.pitch.kick(-2.4);
        S.dPitch.kick(-3.6);
        S.headPitch -= 0.25;
      }),
      events.on(EVT.KART_TRICK, (e) => {
        if (e.kart !== this.kart) return;
        S.trickT = 1e-4;
        S.trickKind = (S.trickKind + 1) % 3;
      }),
      events.on(EVT.KART_BUMP, (e) => {
        const me = e.a === this.kart ? e.a : e.b === this.kart ? e.b : null;
        if (!me) return;
        const dir = Math.random() < 0.5 ? -1 : 1;
        const k = clamp((e.impulse ?? 6) / 24, 0.12, 1.3); // impulse ≈ 3..50 m/s
        S.roll.kick(dir * k * 3.2);
        S.lean.kick(-dir * k * 4);
        S.bob.kick(0.35 + k * 0.5);
      }),
      events.on(EVT.KART_WALL, (e) => {
        if (e.kart !== this.kart) return;
        const k = Math.min(e.impact ?? 5, 20);
        S.roll.kick((Math.random() < 0.5 ? -1 : 1) * k * 0.18);
        S.shake = Math.max(S.shake, Math.min(0.4, k * 0.03));
      }),
      events.on(EVT.KART_STALL, (e) => {
        if (e.kart === this.kart) S.shake = 0.7;
      }),
    ];
  }

  // =============================================================================================================
  // public API
  // =============================================================================================================
  /** Turn the celebration animation on/off in idle mode (podium). */
  setCelebrate(on) {
    this.celebrate = !!on;
  }

  /** A little hop + squash (menu life). */
  bounce(k = 1) {
    const S = this.S;
    S.sq.kick(2.2 * k);
    S.bob.kick(0.6 * k);
    S.dPitch.kick(-1.4 * k);
    S.headPitch -= 0.1 * k;
  }

  /** Show/hide the contact blob shadow. */
  setBlob(on) {
    this.blob.visible = !!on;
  }

  /** Portrait/bust mode: hide everything but the driver. */
  setBustOnly(on) {
    for (const o of [this.chassisMesh, this.steerMesh, ...this.wheels.map((w) => w.pivot)]) o.visible = !on;
    this.blob.visible = !on;
  }

  /** World position of a named anchor. */
  getAnchor(name, out = new THREE.Vector3()) {
    const a = this.anchors[name] ?? this.anchors.center;
    return a.getWorldPosition(out);
  }

  /**
   * Sync to the kart (or idle when null) and animate.
   * @param {number} dt seconds (0 = paused)
   * @param {object|null} kart
   */
  update(dt, kart) {
    if (!(dt >= 0)) dt = 0;
    const hdt = Math.min(dt, 1 / 20);
    this.kart = kart || null;
    const D = this.drive;
    D.dt = hdt;
    if (hdt > 0) this.t += hdt;
    D.t = this.t;
    this.uniforms.uTime.value = this.t;
    if (kart) {
      this.root.position.copy(kart.position);
      this.root.quaternion.copy(kart.quaternion);
    }
    if (kart) this._animateKart(hdt, kart);
    else this._animateIdle(hdt);
    this._finish(hdt, kart);
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.material.dispose();
    this.blobMat.dispose();
    this.blob.geometry.dispose();
    this.dizzy.mat.dispose();
    if (this.drone) {
      this.drone.group.removeFromParent();
      this.drone.mat.dispose();
    }
    if (this.root.parent) this.root.parent.remove(this.root);
  }

  // =============================================================================================================
  // animation: driving
  // =============================================================================================================
  _animateKart(dt, kart) {
    const S = this.S, D = this.drive, U = this.uniforms;
    const speed = kart.speed ?? 0;
    const top = Math.max(8, kart.topSpeed || 30);
    const sf = clamp(Math.abs(speed) / top, 0, 1.25);
    const steer = kart.steerAmount ?? 0;
    const drifting = !!kart.drifting;
    const driftDir = kart.driftDir || 0;
    const boosting = (kart.boostTime ?? 0) > 0;
    const hit = kart.hit;
    const airborne = kart.grounded === false;
    const vy = kart.velocity ? kart.velocity.y : 0;
    // The real Kart physics publishes bodyRoll / bodyPitch / suspension / slideAngle: use them (no double rolling).
    const phys = (this._phys = kart.bodyRoll !== undefined);

    // motion signals
    if (dt > 0) {
      const rawAcc = (speed - S.prevSpeed) / dt;
      S.accel = follow(S.accel, clamp(rawAcc, -60, 60), 10, dt);
      S.prevSpeed = speed;
      S.driftBlend = follow(S.driftBlend, drifting ? 1 : 0, 9, dt);
      S.boostBlend = follow(S.boostBlend, boosting ? 1 : 0, 8, dt);
      // vertical body inertia from ground-following
      const dvy = clamp(vy - S.prevVy, -12, 12);
      S.prevVy = vy;
      if (!phys && kart.grounded !== false) S.bob.kick(-dvy * 0.35);
      // landing / take-off (in case KART_LAND events are not emitted)
      if (S.wasGrounded && airborne) {
        S.sq.kick(1.2);
        S.wasAirborneVy = 0;
      } else if (!S.wasGrounded && !airborne) {
        const impact = Math.max(0, -S.wasAirborneVy);
        if (impact > 2) {
          if (!phys) S.bob.kick(-Math.min(impact, 20) * 0.03);
          S.sq.kick(-Math.min(impact, 20) * (phys ? 0.02 : 0.04));
        }
      }
      if (airborne) S.wasAirborneVy = Math.min(S.wasAirborneVy, vy);
      S.wasGrounded = !airborne;
    }

    // ---- hull: roll / pitch / bob / squash ----
    const brake = (kart.input?.brake ?? 0) > 0.4 && speed > 3 ? 0.035 : 0;
    let roll, pitch;
    if (phys) {
      roll = kart.bodyRoll * 0.95 - driftDir * S.driftBlend * 0.02; //   + = leans to the kart's right
      pitch = -kart.bodyPitch * 0.95 - 0.04 * S.boostBlend + (airborne ? clamp(-vy * 0.01, -0.08, 0.08) : 0); // hull.x + = nose down
    } else {
      roll = -steer * sf * 0.085 - driftDir * S.driftBlend * 0.075;
      pitch = clamp(-S.accel * 0.0032, -0.065, 0.065) + brake - 0.045 * S.boostBlend + (airborne ? clamp(-vy * 0.012, -0.08, 0.08) : 0);
    }
    let rough = 0;
    if (kart.surface === 'offroad') rough = 0.014 * sf;
    else if (kart.surface === 'ice') rough = 0;
    else rough = 0.0025 * sf;
    const shake = S.shake > 0 ? S.shake : 0;
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt);
    const vib = (rough + shake * 0.03) * Math.sin(this.t * 63) + rough * 0.6 * Math.sin(this.t * 41 + 1.7);
    S.roll.update(dt, roll);
    S.pitch.update(dt, pitch);
    S.bob.update(dt, 0);
    S.sq.update(dt, boosting ? 1.05 : 1);
    S.lean.update(dt, steer * (0.1 + 0.2 * sf) + driftDir * S.driftBlend * 0.26);
    S.dPitch.update(dt, clamp(-S.accel * 0.006, -0.16, 0.16) - 0.09 * S.boostBlend + brake * 2.5);
    const susp = phys ? clamp(kart.suspension ?? 0, -0.25, 0.4) : 0;
    const bobY = clamp(S.bob.x, -0.09, 0.09) + vib - susp * 0.22;
    const sq = clamp(S.sq.x * (1 - susp * 0.4), 0.72, 1.28);
    this.hull.position.set(0, -PIV + bobY, 0);
    this.hull.rotation.set(clamp(S.pitch.x, -0.25, 0.25), 0, clamp(S.roll.x, -0.35, 0.35));
    this.hull.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    // ---- wheels ----
    const stalled = (kart.stallTime ?? 0) > 0;
    const locked = (kart.controlLocked && (kart.throttleAmount ?? 0) > 0.5) || stalled;
    const cw = this.cls.wheels;
    S.spinF += (locked ? 8 : clamp(speed / cw.front.r, -24, 24)) * dt;
    S.spinR += (locked ? 26 : clamp(speed / cw.rear.r, -24, 24)) * dt;
    S.steerVis = follow(S.steerVis, steer, 16, dt);
    // counter-steer: the chassis is drawn rotated into the slide, the front wheels point where the kart travels
    const counter = phys ? clamp((kart.slideAngle ?? 0) * 0.85, -0.5, 0.5) : driftDir * S.driftBlend * 0.3;
    for (const w of this.wheels) {
      w.spin.rotation.x = w.axle === 'rear' ? S.spinR : S.spinF;
      if (w.axle === 'front') w.pivot.rotation.y = -S.steerVis * 0.46 + counter;
    }
    this.steerMesh.rotation.z = -S.steerVis * 1.35 + counter * 1.2;

    // ---- driver ----
    let headYawT = -steer * 0.55 * (0.35 + 0.65 * sf) - driftDir * S.driftBlend * 0.5;
    let headPitchT = brake * 3 + (boosting ? -0.05 : 0.02);
    if (kart.input?.lookBack) {
      const side = steer > 0.15 ? -1 : steer < -0.15 ? 1 : -1;
      headYawT = side * 2.75;
      headPitchT = -0.05;
    }
    const lb = kart.input?.lookBack ? 16 : 9;
    const prevYaw = S.headYaw;
    S.headYaw += (headYawT - S.headYaw) * (1 - Math.exp(-lb * dt));
    S.headYawVel = dt > 0 ? (S.headYaw - prevYaw) / dt : 0;
    S.headPitch += (headPitchT - S.headPitch) * (1 - Math.exp(-8 * dt));
    S.headRoll += (S.lean.x * 0.55 - S.headRoll) * (1 - Math.exp(-10 * dt));
    this.driver.rotation.set(clamp(S.dPitch.x, -0.3, 0.3), 0, clamp(S.lean.x, -0.5, 0.5));
    this.driver.scale.set(1, 1, 1);
    this.head.rotation.set(S.headPitch, S.headYaw, S.headRoll);
    this.head.position.y = this.parts.driver.neckY + clamp(-S.bob.v * 0.008, -0.03, 0.03);

    // ---- state effects ----
    const star = (kart.starTime ?? 0) > 0;
    const starTarget = star ? (kart.starTime < 1.6 ? 0.55 + 0.45 * Math.sin(this.t * 18) ** 2 : 1) : 0;
    S.starU = follow(S.starU, starTarget, star ? 14 : 5, dt);
    U.uStar.value = S.starU;

    // shrink pop
    S.scale.update(dt, (kart.shrinkTime ?? 0) > 0 ? 0.55 : 1);
    const sc = clamp(S.scale.x, 0.3, 1.25);

    // hit reactions
    this._applyHit(dt, kart, hit, sc);

    // invulnerability flicker
    let fade = 1;
    if ((kart.invulnTime ?? 0) > 0 && !hit && !star && !((kart.respawnTime ?? 0) > 0)) fade = Math.floor(this.t * 11) % 2 ? 0.28 : 1;
    U.uFade.value = fade;

    // trick flips
    if (S.trickT === 0 && (kart.trickTime ?? 0) > 0 && !S.trickSeen) {
      S.trickT = 1e-4;
      S.trickKind = (S.trickKind + 1) % 3;
    }
    S.trickSeen = (kart.trickTime ?? 0) > 0;

    // rescue drone
    this._animateDrone(dt, kart);

    // victory
    const cel = !!kart.finished;
    S.celebBlend = follow(S.celebBlend, cel ? 1 : 0, 6, dt);
    if (cel && dt > 0) S.celebT += dt;
    if (!cel) S.celebT = 0;

    // blink
    this._blink(dt, 0.18 * S.celebBlend);

    // blob & flex drive
    D.idle = false;
    D.speed = sf;
    D.boost = S.boostBlend;
    D.accelZ = S.accel;
    D.accelX = phys && kart.yawRate !== undefined ? clamp(-kart.yawRate * speed * 0.33, -30, 30) : steer * sf * 20;
    D.accelY = S.bob.v * 8;
    D.yawRate = S.headYawVel;
    D.excite = clamp(0.35 + 0.4 * sf + 0.5 * S.boostBlend + 0.6 * S.celebBlend + (star ? 0.4 : 0), 0, 1);
    D.chaos = clamp(S.hitFlail, 0, 1);

    // root scale + fxRoot base (flips/hops handled in _applyHit)
    this.root.scale.setScalar(sc);
    this._blobFor(kart, sc);
  }

  _applyHit(dt, kart, hit, sc) {
    const S = this.S, U = this.uniforms, fx = this.fxRoot;
    let ry = 0, rx = 0, rz = 0, py = 0, sx = 1, sy = 1;
    let flash = 0, scorchT = 0, flail = 0;

    if (hit) {
      const p = clamp(hit.t / Math.max(0.01, hit.duration), 0, 1);
      S.dizzyT = Math.max(S.dizzyT, Math.max(0, hit.duration - hit.t) + 0.9);
      flail = 1;
      switch (hit.type) {
        case 'spin': {
          const spins = hit.duration < 1.3 ? 2 : 3;
          const q = clamp(p / 0.86, 0, 1);
          ry = TAU * spins * (1 - Math.pow(1 - q, 2.2));
          py = 0.32 * Math.sin(Math.PI * clamp(p * 2.4, 0, 1)) + 0.02 * Math.sin(p * 60) * (1 - p);
          rz = Math.sin(p * 18) * 0.06 * (1 - p);
          break;
        }
        case 'tumble': {
          const q = clamp(p / 0.72, 0, 1);
          rx = TAU * easeInOutCubic(q);
          if (this._phys) {
            // physics already launches the kart (vy 5): only add the extra clearance the flip needs
            const hq = clamp(p / 0.5, 0, 1);
            py = 0.95 * 4 * hq * (1 - hq);
          } else py = 1.55 * 4 * q * (1 - q);
          if (p > 0.72) {
            const r = (p - 0.72) / 0.28;
            py += 0.28 * Math.abs(Math.sin(r * Math.PI * 2)) * (1 - r);
            sy = 1 - 0.14 * Math.exp(-r * 6) * Math.cos(r * 20);
          }
          break;
        }
        case 'explode': {
          const q = clamp(p / 0.78, 0, 1);
          if (this._phys) py = 0.7 * Math.sin(Math.PI * clamp(p / 0.46, 0, 1)); // physics launch is vy 12 (~2.4 m)
          else py = 3.4 * Math.sin(Math.PI * Math.min(1, q * 1.02)) * (1 - 0.1 * q);
          rx = TAU * 1.5 * easeOutCubic(q);
          rz = TAU * 0.5 * easeOutCubic(q);
          ry = TAU * 0.6 * easeOutCubic(q);
          if (p > 0.78) {
            const r = (p - 0.78) / 0.22;
            py += 0.35 * Math.abs(Math.sin(r * Math.PI * 2.4)) * (1 - r);
            rx = TAU * 1.5;
            rz = TAU * 0.5;
          }
          flash = 1.8 * Math.exp(-p * 26);
          scorchT = smoothstep01(0, 0.06, p);
          S.scorchTail = 1.6;
          break;
        }
        case 'squish': {
          const tSec = hit.t;
          if (p < 0.08) sy = 1 - 0.78 * (p / 0.08);
          else if (p < 0.72) sy = 0.22 + 0.01 * Math.sin(this.t * 30);
          else {
            const qq = (p - 0.72) * hit.duration;
            sy = 1 - 0.78 * Math.exp(-6 * qq) * Math.cos(14 * qq);
          }
          sx = 1 + (1 - sy) * 0.55;
          break;
        }
        default:
          break;
      }
    }
    S.hitFlail = follow(S.hitFlail, flail, hit ? 20 : 5, dt);

    // scorch: darken while exploding and fade out afterwards
    if (!hit && S.scorchTail > 0) {
      S.scorchTail = Math.max(0, S.scorchTail - dt);
      scorchT = clamp(S.scorchTail / 1.6, 0, 1);
    } else if (hit && hit.type !== 'explode') scorchT = 0;
    S.scorch = follow(S.scorch, scorchT, 12, dt);
    U_set(U, 'uScorch', S.scorch);
    U_set(U, 'uFlash', flash);

    // trick flip
    if (S.trickT > 0) {
      S.trickT += dt;
      const dur = 0.72;
      const q = clamp(S.trickT / dur, 0, 1);
      const e = easeInOutCubic(q);
      if (S.trickKind === 0) rx += TAU * e; // front flip
      else if (S.trickKind === 1) rz += TAU * e; // barrel roll
      else ry += TAU * e; // 360 spin
      py += 0.18 * Math.sin(Math.PI * q);
      if (q >= 1) S.trickT = 0;
    }

    // falling into the void: flailing tumble
    const fall = S.fallBlend;
    if (fall > 0.001) {
      rx += fall * 1.25 * Math.sin(S.fallT * 3.4);
      rz += fall * 0.9 * Math.sin(S.fallT * 2.6 + 1);
      ry += fall * S.fallT * 1.3;
    }
    // respawn hanging (set in _animateDrone via S.respawnBlend)
    const hang = S.respawnBlend;
    if (hang > 0.001) {
      rx += 0.28 * hang;
      rz += 0.1 * Math.sin(this.t * 2.6) * hang;
      py += (0.05 * Math.sin(this.t * 3.1)) * hang;
    }

    // celebration hops
    if (S.celebBlend > 0.01) {
      const hop = Math.abs(Math.sin(S.celebT * 5.5));
      py += 0.07 * hop * S.celebBlend;
    }

    fx.rotation.set(rx, ry, rz);
    fx.scale.set(sx, sy, sx);
    fx.position.set(0, PIV * sy + py, 0);

    // dizzy stars
    const dz = this.dizzy;
    if (S.dizzyT > 0) {
      S.dizzyT = Math.max(0, S.dizzyT - dt);
      dz.group.visible = true;
      dz.mesh.rotation.y += dt * 6.5;
      const a = clamp(S.dizzyT / 0.5, 0, 1);
      dz.group.scale.setScalar(0.4 + 0.6 * a);
      dz.group.position.y = this.parts.driver.h.cy + this.parts.driver.h.ry + 0.22 + 0.03 * Math.sin(this.t * 7);
      // dizzy wobble of the head
      this.head.rotation.z += 0.22 * Math.sin(this.t * 5.5) * a;
      this.head.rotation.x += 0.08 * Math.cos(this.t * 4.1) * a;
    } else dz.group.visible = false;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // rescue drone
  // ---------------------------------------------------------------------------------------------------------------
  _animateDrone(dt, kart) {
    const S = this.S;
    const rescuing = (kart.respawnTime ?? 0) > 0;
    // Kart physics: a fall phase (kart tumbles into the void, no drone yet) then the drone lowers it back onto the track;
    // a manual respawn is lifted by the drone right away.
    const known = kart._respawnPlaced !== undefined;
    const placed = kart._respawnPlaced === true;
    const manual = kart._respawnManual === true;
    const carried = rescuing && (!known || placed || manual);
    const falling = rescuing && known && !placed && !manual;

    S.fallBlend = follow(S.fallBlend, falling ? 1 : 0, falling ? 12 : 8, dt);
    if (falling) S.fallT += dt;
    else if (S.fallBlend < 0.01) S.fallT = 0;

    if (carried && !this.drone) {
      this.drone = createDrone(this.quality);
      this.fxRoot.add(this.drone.group);
    }
    if (carried && !S.droneCarried) {
      // (re)attach and fly in from above
      S.droneCarried = true;
      S.droneT = 0;
      S.droneLeave = null;
      if (this.drone.group.parent !== this.fxRoot) this.fxRoot.add(this.drone.group);
      this.drone.group.scale.setScalar(1.18);
      this.drone.group.quaternion.identity();
    } else if (!carried && S.droneCarried) {
      S.droneCarried = false;
      this._releaseDrone();
    }
    S.respawnBlend = follow(S.respawnBlend, carried ? 1 : 0, carried ? 9 : 6, dt);
    // panic: the driver flails while falling / dangling
    S.hitFlail = Math.max(S.hitFlail, S.respawnBlend * 0.45, S.fallBlend * 0.9);
    if (S.respawnBlend > 0.01) {
      S.spinF += dt * 3 * S.respawnBlend;
      S.spinR += dt * 3 * S.respawnBlend;
    }
    const d = this.drone;
    if (!d) return;
    const dU = d.uniforms;
    if (S.droneCarried) {
      S.droneT = Math.min(1, S.droneT + dt / 0.45);
      const e = easeOutCubic(S.droneT);
      const hook = HOOKS[this.parts.cn];
      d.group.visible = true;
      d.group.position.set(hook[0], -PIV + hook[1] + (1 - e) * 7, hook[2]);
      d.group.rotation.set(-0.06 + Math.sin(this.t * 1.7) * 0.04, Math.sin(this.t * 1.3) * 0.25, Math.sin(this.t * 2.1) * 0.05);
      this._droneProps(d, dt, 55);
    } else if (S.droneLeave) {
      const L = S.droneLeave;
      L.t += dt;
      L.vy += dt * 9;
      d.group.position.y += L.vy * dt;
      d.group.position.x += Math.sin(L.t * 2) * 0.4 * dt;
      d.group.rotation.y += dt * 2.4;
      d.group.rotation.z = Math.sin(L.t * 5) * 0.12;
      this._droneProps(d, dt, 70);
      if (L.t > 1.6) {
        d.group.visible = false;
        this.fxRoot.add(d.group);
        S.droneLeave = null;
      }
    } else if (d.group.visible) d.group.visible = false;
    dU.uTime.value = this.t;
  }

  _droneProps(d, dt, speed) {
    const dU = d.uniforms;
    for (let i = 0; i < 4; i++) dU.uFlex.value[i].set(0, this.t * speed * (i % 2 ? -1 : 1), 0);
    const open = 0.25 + 0.1 * Math.sin(this.t * 3);
    dU.uFlex.value[4].set(0, 0, -open);
    dU.uFlex.value[5].set(0, 0, open);
    dU.uBeacon.value = Math.sin(this.t * 9) > 0 ? 1 : 0.1;
    dU.uBrake.value = Math.sin(this.t * 9) > 0 ? 0.1 : 1;
  }

  /** The kart is back on the ground: the drone lets go, detaches into the scene and flies away. */
  _releaseDrone() {
    const d = this.drone;
    const scene = this.root.parent;
    if (!d || !scene) {
      if (d) d.group.visible = false;
      return;
    }
    d.group.updateWorldMatrix(true, false);
    d.group.getWorldPosition(_v1);
    d.group.getWorldQuaternion(_q1);
    d.group.getWorldScale(_v2);
    scene.add(d.group);
    d.group.position.copy(_v1);
    d.group.quaternion.copy(_q1);
    d.group.scale.copy(_v2);
    d.group.visible = true;
    this.S.droneLeave = { t: 0, vy: 1.2 };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // idle / menu
  // ---------------------------------------------------------------------------------------------------------------
  _animateIdle(dt) {
    const S = this.S, D = this.drive, U = this.uniforms;
    const t = this.t;
    // hull: engine idle rumble
    const vib = Math.sin(t * 58) * 0.0016 + Math.sin(t * 37 + 1) * 0.001;
    S.bob.update(dt, 0);
    S.sq.update(dt, 1);
    S.roll.update(dt, 0);
    S.pitch.update(dt, 0);
    S.lean.update(dt, 0);
    S.dPitch.update(dt, 0);
    this.hull.position.set(0, -PIV + S.bob.x + vib, 0);
    this.hull.rotation.set(S.pitch.x, 0, S.roll.x);
    const sq = clamp(S.sq.x, 0.7, 1.3);
    this.hull.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    this.fxRoot.rotation.set(0, 0, 0);
    this.fxRoot.scale.set(1, 1, 1);

    // celebration (podium) or relaxed idle
    const cel = this.celebrate;
    S.celebBlend = follow(S.celebBlend, cel ? 1 : 0, 6, dt);
    if (cel && dt > 0) S.celebT += dt;
    let py = 0;
    if (S.celebBlend > 0.01) py = 0.09 * Math.abs(Math.sin(S.celebT * 5.2 + this.character.id.length)) * S.celebBlend;
    this.fxRoot.position.set(0, PIV + py, 0);

    // breathing
    const br = 1 + 0.014 * Math.sin(t * 2.2);
    this.driver.scale.set(1, br, 1);
    this.driver.rotation.set(0.02 * Math.sin(t * 1.1), 0, 0.03 * Math.sin(t * 0.9));

    // look around
    S.lookT -= dt;
    if (S.lookT <= 0) {
      S.lookT = 1.4 + Math.random() * 2.6;
      const r = this.parts.driver.look ?? 0.4;
      S.lookYawT = (Math.random() * 2 - 1) * r;
      S.lookPitchT = (Math.random() * 2 - 1) * 0.1 - 0.02;
      if (Math.random() < 0.3) S.lookYawT *= 0.2;
    }
    const prevYaw = S.headYaw;
    S.headYaw += (S.lookYawT - S.headYaw) * (1 - Math.exp(-3.2 * dt));
    S.headYawVel = dt > 0 ? (S.headYaw - prevYaw) / dt : 0;
    S.headPitch += (S.lookPitchT + 0.02 * Math.sin(t * 1.7) - S.headPitch) * (1 - Math.exp(-3 * dt));
    S.headRoll += (0.04 * Math.sin(t * 0.8) - S.headRoll) * (1 - Math.exp(-3 * dt));
    this.head.rotation.set(S.headPitch, S.headYaw, S.headRoll);
    this.head.position.y = this.parts.driver.neckY + 0.006 * Math.sin(t * 2.2);

    // steering wheel wiggle
    S.steerVis = follow(S.steerVis, 0.28 * Math.sin(t * 0.9) * (1 - S.celebBlend), 6, dt);
    this.steerMesh.rotation.z = -S.steerVis * 1.35;
    for (const w of this.wheels) {
      w.spin.rotation.x = 0;
      if (w.axle === 'front') w.pivot.rotation.y = -S.steerVis * 0.4;
      else w.pivot.rotation.y = 0;
    }

    // states off
    this.root.userData.idle = true;
    U.uStar.value = 0;
    U.uFade.value = 1;
    U_set(U, 'uScorch', 0);
    U_set(U, 'uFlash', 0);
    this.dizzy.group.visible = false;
    if (this.drone) this.drone.group.visible = false;
    this._blink(dt, 0.2 * S.celebBlend);

    D.idle = true;
    D.speed = 0;
    D.boost = 0;
    D.accelZ = 0;
    D.accelX = 0;
    D.accelY = S.bob.v * 8;
    D.yawRate = S.headYawVel;
    D.excite = clamp(0.25 + 0.75 * S.celebBlend, 0, 1);
    D.chaos = 0;
    S.hitFlail = follow(S.hitFlail, 0, 6, dt);
    this.blob.position.y = 0.035;
    this.blobMat.opacity = 0.85;
    this.blob.scale.set(2.4, 3.1, 1);
  }

  // ---------------------------------------------------------------------------------------------------------------
  _blink(dt, squintTarget) {
    const S = this.S, U = this.uniforms;
    S.squint = follow(S.squint, squintTarget * 3, 10, dt); // 0..~0.55
    S.blinkT -= dt;
    if (S.blinkT <= 0 && S.blinkP <= 0) {
      S.blinkP = 1e-4;
      const [a, b] = this.parts.driver.blink ?? [2, 5];
      S.blinkT = a + Math.random() * (b - a);
      if (Math.random() < 0.18) S.blinkT = 0.22; // double blink
    }
    let v = 0;
    if (S.blinkP > 0) {
      S.blinkP += dt;
      const d = 0.15;
      const q = S.blinkP / d;
      v = q < 0.4 ? q / 0.4 : Math.max(0, 1 - (q - 0.4) / 0.6);
      if (q >= 1) S.blinkP = 0;
    }
    U.uBlink.value = Math.max(v, Math.min(0.62, S.squint));
  }

  _blobFor(kart, sc) {
    const s = kart.lastSample;
    let air = 0;
    if (s && Number.isFinite(s.height)) air = Math.max(0, kart.position.y - s.height);
    const k = 1 / (1 + air * 0.55);
    this.blob.position.y = 0.035 - air * (1 / Math.max(0.2, sc));
    this.blob.scale.set(2.4 * k, 3.1 * k, 1);
    this.blobMat.opacity = 0.85 * (0.35 + 0.65 * k);
    this.blob.visible = true;
  }

  // ---------------------------------------------------------------------------------------------------------------
  /** Final pass: matrices, arm IK toward the wheel / celebration poses, flex channels, brake lights. */
  _finish(dt, kart) {
    const S = this.S, D = this.drive, U = this.uniforms;
    // brake lights
    const braking = kart ? (kart.input?.brake ?? 0) > 0.3 : false;
    U.uBrake.value = follow(U.uBrake.value, braking ? 1 : 0.3, 18, dt || 0.016);
    U.uBeacon.value = 0.55 + 0.45 * Math.max(0, Math.sin(this.t * 3.3)) ** 6;

    this.root.updateMatrixWorld(true);

    // arms: aim at the wheel handles (or celebration poses)
    const flail = clamp(S.hitFlail, 0, 1);
    const cel = S.celebBlend;
    for (const side of ['L', 'R']) {
      const i = side === 'L' ? 0 : 1;
      const handle = side === 'L' ? this.handleL : this.handleR;
      handle.getWorldPosition(_v1);
      this.driver.worldToLocal(_v1);
      const sh = this.sh[side];
      if (cel > 0.02 || flail > 0.02) {
        const s = side === 'L' ? 1 : -1;
        // celebration pose: DIRECTION from the shoulder (arms keep their length, they only aim)
        const ct = S.celebT + (side === 'L' ? 0 : 1.3);
        const cyc = Math.floor(S.celebT / 2.6) % 3;
        let cx, cy, cz;
        if (cyc === 0) {
          // right fist pump, left stays on the wheel
          if (side === 'R') {
            cx = -0.62; cy = 1.0 + 0.35 * Math.sin(S.celebT * 9); cz = 0.12;
          } else cx = null;
        } else if (cyc === 1) {
          // both arms up waving
          cx = s * (0.7 + 0.3 * Math.sin(ct * 10)); cy = 1.0; cz = 0.05;
        } else if (side === 'L') {
          cx = 0.8 + 0.35 * Math.sin(ct * 11); cy = 0.9; cz = 0.02;
        } else cx = null;
        if (cx != null) {
          _v2.set(sh.x + cx * 0.4, sh.y + cy * 0.4, sh.z + cz * 0.4);
          _v1.lerp(_v2, cel);
        }
        if (flail > 0.02) {
          _v3.set(sh.x + s * (0.22 + 0.1 * Math.sin(this.t * 24 + i)), sh.y + 0.34 + 0.1 * Math.cos(this.t * 21 + i * 2), sh.z + 0.08);
          _v1.lerp(_v3, flail);
        }
      }
      this._aimArm(side, i, _v1, dt);
    }

    // flex channels (ears, tails, scarves...)
    for (const c of this.flexChans) c.update(dt, D, U);
    // drone channels live on the drone's own material
  }

  _aimArm(side, i, target, dt) {
    const S = this.S;
    const sh = this.sh[side], h0 = this.hand0[side];
    _v2.subVectors(h0, sh);
    const l0 = _v2.length();
    _v3.subVectors(target, sh);
    const l1 = _v3.length();
    const rot = S.armRot[i];
    if (l1 < 1e-4) return;
    _v3.multiplyScalar(l0 / l1);
    // rotation taking _v2 onto _v3
    const axis = _axis.copy(_v2).cross(_v3);
    const s = axis.length();
    const c = _v2.dot(_v3) / (l0 * l0);
    const ang = Math.atan2(s, c);
    if (s > 1e-6) axis.multiplyScalar(ang / s);
    else axis.set(0, 0, 0);
    const lam = 1 - Math.exp(-40 * (dt || 0.016));
    rot.lerp(axis, lam);
    this.uniforms.uFlex.value[i === 0 ? 0 : 1].copy(rot);
  }
}

function smoothstep01(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function U_set(U, key, v) {
  U[key].value = v;
}
