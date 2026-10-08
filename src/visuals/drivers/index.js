/**
 * Driver registry: one builder per character id. Each builder returns
 *   { torso, head, tris, neckY, h, rest: { shoulders, hands, hub }, channels: [...], blink: [min, max], look, extras? }
 */
import { buildBlaze } from './blaze.js';
import { buildBolt } from './bolt.js';
import { buildMochi } from './mochi.js';
import { buildRex } from './rex.js';
import { buildFrost } from './frost.js';
import { buildNova } from './nova.js';
import { buildGrizz } from './grizz.js';
import { buildPepper } from './pepper.js';

const BUILDERS = { blaze: buildBlaze, bolt: buildBolt, mochi: buildMochi, rex: buildRex, frost: buildFrost, nova: buildNova, grizz: buildGrizz, pepper: buildPepper };

export function buildDriver(character, ctx) {
  const fn = BUILDERS[character.id] ?? buildBlaze;
  return fn(ctx);
}
