/**
 * Driving tunables. OWNER: Driving agent.
 *
 * EVERY number that shapes how the kart feels lives here, so feel-tuning never means hunting through
 * physics code. Units: meters, seconds, radians. "stat" values are the 1..5 integers from
 * src/data/characters.js. Yaw convention: positive steer = turn right = yaw DECREASES.
 *
 * Model overview (see Kart.js):
 *   - `yaw` is the kart's travel/steer heading. Velocity is decomposed into a forward part (along the
 *     heading, projected onto the ground plane) and a lateral part that "grip" bleeds away.
 *   - While drifting the chassis is drawn rotated INTO the turn by a slide angle (quaternion only),
 *     the physics heading keeps carving a base arc that the steering modulates.
 *   - Everything is sub-stepped at <= MAX_SUBSTEP for stability.
 */
import { CC_CLASSES } from '../core/constants.js';
import { clamp, clamp01, lerp, smoothstep } from '../core/math.js';

export const TUNE = {
  /** Arcade gravity (m/s^2). */
  gravity: 30,
  /** Largest physics sub-step (s). dt above this is split into several sub-steps. */
  maxSubstep: 1 / 90,

  // ---------------------------------------------------------------- stats -> numbers
  stats: {
    /** top speed = topBase + topPerStat * (speed - 1)  -> 30.5 .. 34.9 m/s at 150cc */
    topBase: 30.5,
    topPerStat: 1.1,
    /** Time (s) to reach ~90% of top speed on flat road: accel stat 1 -> t90Slow, stat 5 -> t90Fast. */
    t90Slow: 2.9,
    t90Fast: 1.7,
    /** Peak steering rate (rad/s) by handling stat 1 -> 5. */
    turnPeakMin: 1.7,
    turnPeakMax: 2.4,
    /** Mass by weight stat 1 -> 5 (used for kart-kart bumps). */
    massMin: 0.8,
    massMax: 1.4,
    /** Mini-turbo duration scale by accel stat 1 -> 5 ("accel = mini-turbo recovery"). */
    miniTurboScaleMin: 0.94,
    miniTurboScaleMax: 1.08,
    /** Drift turn-rate scale by handling stat 1 -> 5. */
    driftHandlingMin: 0.9,
    driftHandlingMax: 1.12,
  },
  /** Nominal collision radius (m). */
  radius: 1.1,

  // ---------------------------------------------------------------- longitudinal
  /**
   * Acceleration law: a(v) = accelK * top * (1 - (v/cap)^2). For that law the time to 90% is
   * 1.4722 / accelK, so accelK = ACCEL_T90_CONST / t90. Strong at low speed, tapering to zero at the cap.
   */
  accelT90Const: 1.4722,
  /** Braking deceleration (m/s^2) while moving forward with brake held. */
  brakeDecel: 40,
  /** Max reverse speed (m/s) and reverse acceleration (m/s^2). */
  reverseMax: 9,
  reverseAccel: 15,
  /** Coasting drag: decel = coastBase + coastPerSpeed * |v|  (m/s^2). */
  coastBase: 2.1,
  coastPerSpeed: 0.085,
  /** Rate (1/s) at which speed above the current cap decays back to the cap (post-boost bleed ~1 s). */
  overspeedRate: 2.5,
  /** Same but when the cap dropped because of an off-road surface. */
  offroadOverspeedRate: 3.8,
  /** Off-road top speed as a fraction of the nominal top speed (ignored while boosting / star). */
  offroadTopFactor: 0.55,
  /** Fraction of real gravity applied along slopes (hills slow / speed the kart "a little"). */
  slopeGravity: 0.3,
  /** Burnout (botched rocket start): seconds without acceleration. */
  stallTime: 0.9,

  // ---------------------------------------------------------------- steering
  /** Steering smoothing rates (1/s). ~1/0.08 s response when pressing, quicker when releasing/reversing. */
  steerPress: 13,
  steerRelease: 21,
  /** Snappier response when the steering comes from an analog stick (input.analog): the stick is already smooth. */
  steerPressAnalog: 26,
  steerReleaseAnalog: 30,
  /** Turn-rate speed profile: 0 at standstill, full from turnFullSpeed, dropping by turnTopDrop toward top speed. */
  turnMinSpeed: 0.4,
  turnFullSpeed: 8,
  turnFalloffStart: 22,
  turnTopDrop: 0.16,
  /** Steering authority in the air. */
  airSteer: 0.35,
  /** Horizontal air drag (1/s). */
  airDrag: 0.04,

  // ---------------------------------------------------------------- surfaces
  /**
   * grip:      rate (1/s) at which lateral velocity decays (higher = stickier).
   * turnLoss:  fraction of speed lost per radian the velocity vector is turned (cornering drag).
   * steerMul:  multiplier on turn rate.
   */
  surfaces: {
    road: { grip: 14, turnLoss: 0.055, steerMul: 1.0 },
    boost: { grip: 14, turnLoss: 0.055, steerMul: 1.0 },
    ramp: { grip: 14, turnLoss: 0.055, steerMul: 1.0 },
    offroad: { grip: 8, turnLoss: 0.09, steerMul: 0.92 },
    ice: { grip: 2.0, turnLoss: 0.012, steerMul: 0.68 },
    void: { grip: 14, turnLoss: 0.055, steerMul: 1.0 },
  },
  /** Grip multiplier for a short time after a kart-kart bump so the shove is visible. */
  bumpGripMul: 0.3,
  bumpGripTime: 0.28,

  // ---------------------------------------------------------------- ground following / air
  /** Rate (1/s) at which `up` eases to the ground normal (grounded) and to the airborne attitude. */
  upFollowGround: 13,
  upFollowAir: 4.5,
  /** Fraction of the flight-path pitch shown by the chassis while airborne (nose follows the arc). */
  airPitchFollow: 0.55,
  /**
   * Take-off when the ground falls this far (m) below the kart's ballistic path in one sub-step. Small enough
   * to catch ramp lips and sharp crests, large enough to hug smooth hills and noisy terrain.
   */
  airGap: 0.1,
  /** Landing: impacts (m/s along the ground normal) above hardLandStart cost speed; below softLand no event. */
  landEventMin: 2.0,
  hardLandStart: 13,
  hardLandSpeedLoss: 0.01, // fraction per (m/s) above start, up to hardLandMaxLoss
  hardLandMaxLoss: 0.15,
  /** On landing, fraction of the lateral slide that is converted into forward speed (forgiving landings). */
  landRealign: 0.5,
  /** Cheap protection: never let speed exceed this (m/s). */
  hardSpeedCap: 95,

  // ---------------------------------------------------------------- hop, drift, mini-turbo
  drift: {
    hopVy: 4.5,
    /** Minimum forward speed to enter a drift, and speed under which a drift is cancelled (no boost). */
    minSpeed: 11,
    cancelSpeed: 8,
    /** |steer| needed (during/at the end of the hop) to pick a drift direction. */
    steerThreshold: 0.3,
    /** After a hop lands with the drift button still held, a late steer still starts the drift for this long. */
    graceAfterLand: 0.22,
    /** Base (steering-neutral) drift arc turn rate in rad/s at top speed, handling-scaled; see driftBaseRate(). */
    baseTurn: 0.95,
    /** Extra turn at low speed: rate *= 1 + lowSpeedBoost * (1 - v/top). */
    lowSpeedBoost: 0.25,
    /** Steering multipliers: steering into the turn tightens up to `inward`, steering out widens down to `outward`. */
    inward: 1.6,
    outward: 0.45,
    /** Chassis slide angle (rad): base when neutral/outward, more when steering inward. ~21..30 degrees. */
    slideBase: 0.37,
    slideInward: 0.53,
    slideResponse: 10,
    /** Grip while drifting (1/s) and cornering drag (fraction / rad). Speed is mostly kept. */
    grip: 9,
    turnLoss: 0.02,
    /** Charge thresholds (seconds of charge) for levels 1..3 (blue, orange, purple). */
    levels: [0.8, 1.8, 3.0],
    /** Charge rate multiplier: steering outward -> chargeOut, neutral 1, inward -> chargeIn. */
    chargeOut: 0.85,
    chargeIn: 1.15,
    /** Mini-turbo per level: duration (s) and power. */
    turbo: [
      { duration: 0.6, power: 0.85 },
      { duration: 1.1, power: 1.0 },
      { duration: 1.7, power: 1.2 },
    ],
    /** Drift cancels (no boost) after this much continuous airtime (the initial hop does not count). */
    cancelAirTime: 0.55,
    /** ...or when hitting a wall harder than this (m/s into the wall). */
    cancelWallImpact: 11,
  },

  // ---------------------------------------------------------------- boost
  boost: {
    /** Top speed multiplier at power 1: 1 + topMul * power. */
    topMul: 0.35,
    /** Acceleration multiplier while boosting ("fast accel to the boosted speed"). */
    accelMul: 2.4,
    /** boostPower easing rates (1/s). */
    easeIn: 14,
    easeOut: 4.5,
    /** Boost pad: duration, power. Event only on entry. */
    pad: { duration: 1.0, power: 1.1 },
    /** Trick landing boost. */
    trick: { duration: 0.7, power: 0.9 },
    /** Slipstream boost. */
    draft: { duration: 0.8, power: 0.8 },
    /** Rocket start: duration range (worst -> best timing) and power. */
    rocket: { minDuration: 0.6, maxDuration: 1.3, power: 1.05 },
  },

  // ---------------------------------------------------------------- tricks
  trick: {
    /** Window after launching off a ramp / sharp crest in which a drift-button press does a trick. */
    window: 0.35,
    /** Duration of the trick animation flag (kart.trickTime). */
    duration: 0.6,
    /** A non-ramp take-off counts as a "sharp crest" if it leaves the ground with at least this vy. */
    crestMinVy: 3.0,
    /** After leaving a ramp surface, a take-off within this time inherits the ramp's launch speed. */
    rampGrace: 0.3,
    /** Ramp launch is scaled by speed: clamp(min + (1-min) * v/(0.9*top), min, max). */
    launchMinScale: 0.55,
    launchMaxScale: 1.05,
  },

  // ---------------------------------------------------------------- walls / colliders
  wall: {
    restitution: 0.3,
    /** Fresh contact: fraction of the tangential speed lost per unit sin(impact angle). Glancing scrapes keep most speed. */
    angleLoss: 0.4,
    /** Continued contact: speed decay rate (1/s) per unit sin(angle), plus a flat scrape drag (1/s) while touching. */
    scrapeRate: 4,
    scrapeDrag: 0.3,
    /** Heading swing toward the wall tangent: instant fraction on a fresh hit, and rate (1/s) while sliding. */
    swing: 0.5,
    deflect: 7,
    /** KART_WALL is emitted only above this impact speed (m/s), at most once per cooldown. */
    eventMin: 2,
    eventCooldown: 0.15,
  },

  // ---------------------------------------------------------------- hits (applyHit)
  hit: {
    /** lock: no control while the reaction plays. speedMul scales horizontal speed at the moment of the hit. */
    spin: { duration: 0.9, speedMul: 0.15, vy: 0, lock: true },
    tumble: { duration: 1.3, speedMul: 0.1, vy: 5, lock: true },
    explode: { duration: 1.8, speedMul: 0, vy: 12, lock: true },
    // squish: flattened but still steerable, capped to squishTopMul of the top speed while it lasts
    squish: { duration: 1.2, speedMul: 0.5, vy: 0, lock: false },
    /** invulnTime = duration + invulnExtra */
    invulnExtra: 0.8,
    squishTopMul: 0.55,
  },

  // ---------------------------------------------------------------- star / shrink
  star: { topMul: 1.15 },
  shrink: { topMul: 0.8, radiusMul: 0.55, massMul: 0.7, easeRate: 7 },

  // ---------------------------------------------------------------- rescue / respawn
  respawn: {
    /** Whole sequence length (s): fall -> teleport -> lower -> control back. */
    duration: 2.2,
    /** Seconds of falling before the teleport (manual respawn() lifts instead of falls). */
    fallTime: 0.65,
    /** End of the lowering phase (s from the start); the rest is a settle. */
    lowerEnd: 2.0,
    /** Height above the road the kart is placed at, and metres before the last safe point. */
    hoverHeight: 4.0,
    backDistance: 5,
    /** Invulnerability after control returns. */
    invuln: 1.5,
    /** Safe-point sampling interval while grounded on road/boost. */
    sampleInterval: 0.25,
    /** Considered fallen when this far below the road / the last grounded height while over void. */
    fallDepth: 4,
    /** Manual respawn lift height before the teleport. */
    liftHeight: 3.0,
  },

  // ---------------------------------------------------------------- slipstream
  draft: {
    minDist: 2,
    maxDist: 12,
    halfWidth: 2.4,
    /** Minimum cos(angle) between the two karts' headings (cos 15 deg). */
    minAlign: 0.966,
    minSpeed: 20,
    charge: 1.3,
    cooldown: 4.0,
    decay: 1.5,
  },

  // ---------------------------------------------------------------- kart-kart collisions
  collide: {
    restitution: 0.5,
    /** Extra separating speed (m/s) from a bump; scaled by the other kart's mass share and approach speed. */
    bumpBase: 2.4,
    bumpPerSpeed: 0.09,
    /** Per-pair KART_BUMP cooldown (s). */
    cooldown: 0.3,
    /** Ignore pairs further apart than this vertically (m): jumping over/under each other. */
    verticalReach: 1.7,
    /** Velocity change below which KART_BUMP is not emitted. */
    eventMin: 1.0,
  },
};

/** Dimensionless helper. */
const t01 = (stat) => clamp((stat - 1) / 4, 0, 1);

/**
 * Convert a character's 1..5 stats + race settings into the concrete numbers the kart physics uses.
 * @param {{speed:number, accel:number, handling:number, weight:number}} stats
 * @param {number} speedMul cc class multiplier (applied to top speed; accel scales with it via top)
 * @returns {{ baseTop:number, top:number, accelK:number, turnPeak:number, driftHandling:number, mass:number, miniTurboScale:number, t90:number }}
 */
export function computeStats(stats, speedMul = 1) {
  const S = TUNE.stats;
  const baseTop = S.topBase + S.topPerStat * ((stats.speed ?? 3) - 1);
  const t90 = lerp(S.t90Slow, S.t90Fast, t01(stats.accel ?? 3));
  return {
    baseTop,
    top: baseTop * speedMul,
    accelK: TUNE.accelT90Const / t90,
    t90,
    turnPeak: lerp(S.turnPeakMin, S.turnPeakMax, t01(stats.handling ?? 3)),
    driftHandling: lerp(S.driftHandlingMin, S.driftHandlingMax, t01(stats.handling ?? 3)),
    mass: lerp(S.massMin, S.massMax, t01(stats.weight ?? 3)),
    miniTurboScale: lerp(S.miniTurboScaleMin, S.miniTurboScaleMax, t01(stats.accel ?? 3)),
  };
}

/** Look up the cc speed multiplier for a game (defaults to 1 outside a race). */
export function ccSpeedMul(game) {
  const cc = game?.raceConfig?.ccClass ?? CC_CLASSES[game?.raceConfig?.cc] ?? null;
  return cc?.speedMul ?? 1;
}

// ------------------------------------------------------------------------------------------------
// Shared steering formulas. Kart.js uses these, and other systems (AI) may import them so they never have to
// duplicate the numbers.

/**
 * Yaw rate (rad/s, magnitude) at FULL steering lock for normal driving.
 * @param {number} speedAbs |forward speed| m/s
 * @param {number} top current nominal top speed
 * @param {number} turnPeak stat-derived peak rate (see computeStats().turnPeak)
 * @param {number} [steerMul] surface multiplier (TUNE.surfaces[surface].steerMul)
 */
export function turnRateAt(speedAbs, top, turnPeak, steerMul = 1) {
  const prof =
    smoothstep(TUNE.turnMinSpeed, TUNE.turnFullSpeed, speedAbs) *
    (1 - TUNE.turnTopDrop * smoothstep(TUNE.turnFalloffStart, Math.max(top, TUNE.turnFalloffStart + 1), speedAbs));
  return turnPeak * prof * steerMul;
}

/**
 * Yaw rate (rad/s, magnitude) of the drift arc with steering NEUTRAL.
 * @param {number} driftHandling computeStats().driftHandling
 */
export function driftBaseRate(speedAbs, top, driftHandling) {
  const D = TUNE.drift;
  return D.baseTurn * driftHandling * (1 + D.lowSpeedBoost * (1 - clamp01(speedAbs / Math.max(top, 1))));
}

/** Drift arc multiplier for a steer input: inward > 0 steers into the turn (up to drift.inward), < 0 out (down to drift.outward). */
export function driftSteerMul(inward) {
  const D = TUNE.drift;
  return inward >= 0 ? lerp(1, D.inward, inward) : lerp(1, D.outward, -inward);
}
