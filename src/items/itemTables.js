/**
 * itemTables.js — the ONE place to tune the item system (numbers + the item-box distribution).
 * OWNER: Gameplay agent.
 *
 * Everything here is plain data + one pure function (`pickItem`), so it can be tweaked (or unit-tested
 * from the console: `__game.items.describeDistribution()`) without touching the simulation code.
 */
import { clamp, smoothstep, weightedPick } from '../core/math.js';

// ==================================================================================================
// Numbers
// ==================================================================================================
export const TUNING = {
  boxes: {
    size: 1.5, //          cube edge (m)
    hover: 1.3, //         height of the cube centre above the slot position (m)
    bobAmp: 0.16, //       gentle bob amplitude (m)
    bobSpeed: 2.1, //      rad/s
    spin: 1.35, //         rad/s about the vertical axis
    pickupRadius: 1.6, //  kart centre to box centre (m)
    respawn: 2.0, //       seconds until a shattered box comes back
    popTime: 0.5, //       scale-pop animation length after respawning
  },
  roulette: { duration: 1.8 },

  banana: { radius: 0.8, hitPad: 0.5, max: 30, dropBehind: 1.9, life: 240 },
  orb: {
    radius: 0.45, //        collision radius of bouncer/seeker orbs (m)
    speedMul: 1.6, //       bouncer speed = speedMul * owner top speed
    minTop: 22, //          top-speed floor used for the multiplier (m/s)
    life: 8, //             bouncer lifetime (s)
    maxBounces: 6,
    ownerGrace: 0.5, //     seconds before the owner can be hit by its own orb
    hitPad: 0.85, //        kart radius fraction that counts as a hit
    hover: 0.5, //          orb centre height above ground (m)
  },
  seeker: {
    speedMul: 1.5,
    life: 14,
    lookAhead: 26, //       metres ahead along the course the orb steers toward while far away
    homingRange: 25, //     direct homing inside this distance to the target (m)
    turnRate: 6.5, //       max heading change (rad/s)
    acquireRange: 45, //    when the owner leads, auto-lock onto a kart this close ahead
  },
  bomb: {
    radius: 0.5,
    blast: 7, //            explosion radius (m)
    fuse: 2.5, //           seconds a landed bomb sits before it goes off
    contact: 1.15, //       contact-trigger radius around the bomb (m)
    ownerGrace: 1.0, //     the owner can't set it off for this long after landing
    throwUp: 15, //         vertical launch speed of the lob (m/s)
    throwAhead: 22, //      horizontal speed added on top of the kart speed (m/s)
    gravity: 30,
    rollBack: 0.2, //       fraction of owner speed a back-rolled bomb keeps
  },
  comet: {
    radius: 0.7,
    blast: 6,
    cruise: 78, //          m/s along the course (faster than any kart)
    dive: 62, //            m/s while diving on the target
    height: 5, //           cruise height above the course (m)
    diveDistance: 48, //    start the dive when this close to the target along the course (m)
    clipRadius: 2.6, //     karts this close to the dive path get clipped (m)
    life: 22,
  },
  bolt: { cooldown: 20, shrinkFirst: 8, shrinkLast: 3, minRaceTime: 8 },
  boosts: { nitro: 1.2, nitroPower: 1.0, gold: 1.0, goldPower: 1.0, goldTime: 7.5, star: 7.5 },
  trail: {
    single: 1.0, //         gap between kart rear and the single trailing item (m)
    chain: 0.95, //         spacing along the banana chain (m)
    orbitRadius: 1.9,
    orbitSpeed: 5.2, //     rad/s
    blockCone: 0.0, //      dot(forward, toHitter) must be below this for a block (behind the kart)
  },
};

// ==================================================================================================
// Item-box distribution
// ==================================================================================================
/**
 * Relative weights by race position for an 8-kart field (columns = 1st … 8th). Smaller fields are
 * stretched over the columns (last place always uses the 8th column). Leaders get defensive junk
 * (bananas / bouncers / bombs), the middle gets seekers + nitros + triples, the back gets nitro3,
 * golden nitro and stars. Bolt and comet are gated separately (see SPECIAL below).
 */
export const PLACE_WEIGHTS = {
  //                1st  2nd  3rd  4th  5th  6th  7th  8th
  banana: [30, 20, 10, 6, 3, 0, 0, 0],
  banana3: [6, 10, 10, 6, 3, 0, 0, 0],
  bouncer: [26, 18, 10, 6, 2, 0, 0, 0],
  bouncer3: [8, 10, 10, 6, 3, 0, 0, 0],
  bomb: [14, 10, 8, 4, 0, 0, 0, 0],
  seeker: [0, 10, 14, 14, 10, 6, 3, 0],
  seeker3: [0, 2, 6, 9, 9, 6, 3, 0],
  nitro: [14, 18, 20, 18, 14, 8, 4, 2],
  nitro3: [2, 4, 9, 13, 16, 18, 18, 14],
  goldnitro: [0, 0, 2, 6, 11, 16, 20, 22],
  star: [0, 0, 2, 8, 14, 18, 22, 26],
  bolt: [0, 0, 0, 0, 6, 9, 12, 16], //   only used when boltOk (see SPECIAL)
  comet: [0, 0, 0, 0, 0, 0, 0, 0], //    weight is computed from the gap (see SPECIAL.comet)
};

export const ITEM_ORDER = Object.keys(PLACE_WEIGHTS);

/** Distance-behind-the-leader modifiers: t goes 0 -> 1 across `range` metres. */
export const GAP_MODS = {
  range: [35, 260],
  /** Multiplier reached at t = 1 (blended linearly from 1 at t = 0). */
  catchUp: { items: ['nitro3', 'goldnitro', 'star', 'seeker3', 'bolt'], far: 2.2 },
  defensive: { items: ['banana', 'banana3', 'bouncer', 'bouncer3', 'bomb'], far: 0.15 },
};

export const SPECIAL = {
  /** Comet: 3rd place or worse, leader at least gapMin ahead; the weight ramps to `weight` at gapFull. */
  comet: { minPlace: 3, gapMin: 110, gapFull: 320, weight: 16, minRaceTime: 12 },
  /** Bolt: back half of the field only, cooldown handled by the ItemSystem. */
  bolt: { minPlaceFrac: 0.5 },
  /** Weight multiplier for the item the kart got last time (variety). */
  repeatPenalty: 0.35,
};

const _w = new Array(ITEM_ORDER.length);

/**
 * Pick an item.
 * @param {() => number} rng
 * @param {{place:number, count:number, gap:number, raceTime:number, boltOk:boolean, cometOk:boolean, lastItem?:string|null}} c
 * @returns {string} item id
 */
export function pickItem(rng, c) {
  const col = c.count > 1 ? ((clamp(c.place, 1, c.count) - 1) / (c.count - 1)) * 7 : 0;
  const c0 = Math.floor(col), c1 = Math.min(7, c0 + 1), f = col - c0;
  const t = smoothstep(GAP_MODS.range[0], GAP_MODS.range[1], c.gap);
  for (let i = 0; i < ITEM_ORDER.length; i++) {
    const id = ITEM_ORDER[i];
    const row = PLACE_WEIGHTS[id];
    let w = row[c0] * (1 - f) + row[c1] * f;
    if (GAP_MODS.catchUp.items.includes(id)) w *= 1 + (GAP_MODS.catchUp.far - 1) * t;
    else if (GAP_MODS.defensive.items.includes(id)) w *= 1 + (GAP_MODS.defensive.far - 1) * t;
    if (id === 'bolt') {
      const backHalf = c.place > Math.ceil(c.count * SPECIAL.bolt.minPlaceFrac);
      w = c.boltOk && backHalf && c.count >= 3 ? w : 0;
    } else if (id === 'comet') {
      const s = SPECIAL.comet;
      w = c.cometOk && c.place >= s.minPlace && c.raceTime >= s.minRaceTime ? s.weight * smoothstep(s.gapMin, s.gapFull, c.gap) : 0;
    }
    if (id === c.lastItem) w *= SPECIAL.repeatPenalty;
    _w[i] = w;
  }
  let sum = 0;
  for (let i = 0; i < _w.length; i++) sum += _w[i];
  if (sum <= 0) return 'nitro';
  return weightedPick(rng, ITEM_ORDER, _w);
}

/**
 * Debug helper: probability table (percent) per place for a given field size and gap behind the leader.
 * @returns {Record<string, number[]>} item -> percent by place (1..count)
 */
export function describeDistribution(count = 8, gap = 60, opts = {}) {
  const out = {};
  for (const id of ITEM_ORDER) out[id] = [];
  const ctx = { count, gap, raceTime: 60, boltOk: true, cometOk: true, lastItem: null, ...opts };
  for (let place = 1; place <= count; place++) {
    ctx.place = place;
    const g = place === 1 ? 0 : gap;
    let sum = 0;
    const ws = {};
    // replicate pickItem's weights without sampling
    const col = count > 1 ? ((place - 1) / (count - 1)) * 7 : 0;
    const c0 = Math.floor(col), c1 = Math.min(7, c0 + 1), f = col - c0;
    const t = smoothstep(GAP_MODS.range[0], GAP_MODS.range[1], g);
    for (const id of ITEM_ORDER) {
      let w = PLACE_WEIGHTS[id][c0] * (1 - f) + PLACE_WEIGHTS[id][c1] * f;
      if (GAP_MODS.catchUp.items.includes(id)) w *= 1 + (GAP_MODS.catchUp.far - 1) * t;
      else if (GAP_MODS.defensive.items.includes(id)) w *= 1 + (GAP_MODS.defensive.far - 1) * t;
      if (id === 'bolt') w = ctx.boltOk && place > Math.ceil(count * SPECIAL.bolt.minPlaceFrac) && count >= 3 ? w : 0;
      if (id === 'comet') w = ctx.cometOk && place >= SPECIAL.comet.minPlace ? SPECIAL.comet.weight * smoothstep(SPECIAL.comet.gapMin, SPECIAL.comet.gapFull, g) : 0;
      ws[id] = w;
      sum += w;
    }
    for (const id of ITEM_ORDER) out[id].push(sum > 0 ? Math.round((ws[id] / sum) * 1000) / 10 : 0);
  }
  return out;
}
