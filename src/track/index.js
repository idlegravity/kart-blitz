/**
 * Track registry. OWNER: World agent (initial version by orchestrator).
 * The ids, names and CUPS below are FIXED — UI, audio (music per track id) and Game depend on them.
 */
import { Track } from './Track.js';
import { Centerline } from './centerline.js';
import meadowDef from './defs/meadow.js';
import canyonDef from './defs/canyon.js';
import glacierDef from './defs/glacier.js';
import neonDef from './defs/neon.js';

export const TRACK_LIST = [
  {
    id: 'meadow', name: 'Sunshine Circuit', theme: 'meadow', difficulty: 1,
    description: 'Rolling green hills, flower fields and a sparkling lake. A perfect warm-up.',
    colors: { primary: '#5fd35a', secondary: '#7cc8ff', accent: '#ffd23f' },
  },
  {
    id: 'canyon', name: 'Canyon Rush', theme: 'canyon', difficulty: 2,
    description: 'Blazing desert canyon with towering mesas, rock arches and a death-defying jump.',
    colors: { primary: '#f0a04b', secondary: '#ffcf7a', accent: '#c1440e' },
  },
  {
    id: 'glacier', name: 'Frostbite Pass', theme: 'glacier', difficulty: 3,
    description: 'Icy mountain pass with slippery corners, a crystal cave and falling snow.',
    colors: { primary: '#bfe8ff', secondary: '#5aa9e6', accent: '#ffffff' },
  },
  {
    id: 'neon', name: 'Neon Skyway', theme: 'neon', difficulty: 4,
    description: 'A glowing highway through a midnight city skyline. Some edges have no rails!',
    colors: { primary: '#ff3df2', secondary: '#2de2ff', accent: '#ffe45c' },
  },
];

export const CUPS = [{ id: 'nitro', name: 'Nitro Cup', trackIds: ['meadow', 'canyon', 'glacier', 'neon'] }];

const DEFS = { meadow: meadowDef, canyon: canyonDef, glacier: glacierDef, neon: neonDef };

function resolve(id) {
  const info = TRACK_LIST.find((t) => t.id === id) ?? TRACK_LIST[0];
  return { ...DEFS[info.id], ...info };
}

/** Create (but do not build) a Track instance. Game calls track.build() right after. */
export function createTrack(id, game) {
  return new Track(resolve(id), game);
}

const outlineCache = new Map();

/**
 * Cheap 2D outline of a track for menu previews, WITHOUT building meshes.
 * Returns an array of [x, z] points (closed loop, any scale — callers normalize).
 */
export function getTrackOutline(id) {
  const def = resolve(id);
  let pts = outlineCache.get(def.id);
  if (!pts) {
    pts = new Centerline(def).outline(7);
    outlineCache.set(def.id, pts);
  }
  return pts.map((p) => [p[0], p[1]]);
}
