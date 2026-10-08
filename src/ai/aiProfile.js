/**
 * aiProfile.js — turns (character, skill 0..1) into the numbers that shape one CPU driver.
 * Personalities are deterministic from the character id (same racer, same temperament, every race).
 * OWNER: Gameplay agent.
 */
import { clamp, lerp, makeRng } from '../core/math.js';

/** Hand-tuned temperaments for the shipped roster; unknown ids fall back to a hash of the id. */
const PERSONA = {
  blaze: { aggression: 0.85, eagerness: 0.75, lane: 0.5 },
  bolt: { aggression: 0.55, eagerness: 0.9, lane: -0.4 },
  mochi: { aggression: 0.3, eagerness: 0.55, lane: 0.9 },
  rex: { aggression: 0.8, eagerness: 0.6, lane: -0.8 },
  frost: { aggression: 0.4, eagerness: 0.45, lane: 0.2 },
  nova: { aggression: 0.6, eagerness: 0.8, lane: -1.1 },
  grizz: { aggression: 0.95, eagerness: 0.5, lane: 1.2 },
  pepper: { aggression: 0.5, eagerness: 0.7, lane: -0.2 },
};

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {{id?:string, stats?:{handling?:number, speed?:number}}} character
 * @param {number} skill 0..1
 */
export function makeProfile(character, skill) {
  const id = String(character?.id ?? 'cpu');
  const seed = hashString(id);
  const rng = makeRng(seed);
  const base = PERSONA[id] ?? { aggression: rng(), eagerness: rng(), lane: (rng() * 2 - 1) * 1.2 };
  const s = clamp(skill, 0, 1);
  return {
    id,
    skill: s,
    aggression: base.aggression,
    eagerness: base.eagerness,
    // ---- lane preference (spreads the pack out) ----
    laneBase: base.lane,
    laneAmp: lerp(2.0, 1.4, s),
    phase1: rng() * 6.28,
    phase2: rng() * 6.28,
    phase3: rng() * 6.28,
    // ---- driving quality ----
    /** lateral imprecision (m) */
    lineNoise: lerp(1.5, 0.15, Math.pow(s, 0.8)),
    /** average seconds between "mistakes" (wide line / late steering) */
    mistakeEvery: lerp(9, 70, Math.pow(s, 1.2)),
    /** fraction of the cornering limit the driver dares to use when planning speed */
    safety: lerp(0.66, 0.97, s),
    /** pure-pursuit look-ahead scaling (weak drivers look a little too short / long) */
    lookScale: lerp(0.85, 1.0, s),
    /** seconds of steering lag added for weak drivers */
    steerLag: lerp(0.09, 0.0, s),
    // ---- drifting ----
    /** probability of using a suitable corner for a drift */
    driftUse: clamp(0.15 + 0.9 * Math.pow(s, 0.9), 0, 0.99),
    /** minimum corner angle (rad) worth a drift */
    driftMinAngle: lerp(1.25, 0.62, s),
    /** spark level to cash in: 1 blue, 2 orange, 3 purple */
    driftLevel: s < 0.42 ? 1 : s < 0.85 ? 2 : 3,
    trickChance: clamp((s - 0.45) * 1.8, 0, 0.85),
    // ---- items ----
    /** seconds before a fresh item is used */
    reaction: lerp(1.2, 0.3, s),
    itemSkill: s,
  };
}
