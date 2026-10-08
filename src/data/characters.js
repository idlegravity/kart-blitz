/**
 * The racer roster. All original characters (no third-party IP).
 * OWNER: orchestrator. Read-only for agents.
 *
 * stats: 1..5 integers (UI shows them as bars; physics maps them to numbers).
 *   speed    → top speed
 *   accel    → acceleration / mini-turbo recovery
 *   handling → steering rate & drift tightness
 *   weight   → mass for bumps (heavier pushes lighter), less knockback
 * weightClass drives the kart body style: 'light' = nimble buggy, 'medium' = classic kart, 'heavy' = chunky muscle kart.
 * colors: primary = kart paint + main fur/body, secondary = belly/trim, accent = details/emblem. Hex strings.
 * look: art direction notes for the procedural model.
 */
export const CHARACTERS = [
  {
    id: 'blaze', name: 'Blaze', species: 'fox', weightClass: 'medium',
    stats: { speed: 3, accel: 3, handling: 3, weight: 3 },
    colors: { primary: '#ef3b24', secondary: '#fff3e6', accent: '#ffb000' },
    tagline: 'All-rounder with a fiery streak',
    look: 'Red-orange fox, big pointed ears with dark tips, white muzzle, bushy tail with white tip curling behind the seat, aviator goggles on forehead.',
  },
  {
    id: 'bolt', name: 'Bolt', species: 'robot', weightClass: 'light',
    stats: { speed: 2, accel: 5, handling: 4, weight: 1 },
    colors: { primary: '#ffd21f', secondary: '#39404d', accent: '#26d9ff' },
    tagline: 'Zippy little robot, lightning off the line',
    look: 'Round yellow robot head with a glowing cyan visor-face (emissive), antenna with a blinking ball, riveted panels, small claw hands.',
  },
  {
    id: 'mochi', name: 'Mochi', species: 'bunny', weightClass: 'light',
    stats: { speed: 2, accel: 4, handling: 5, weight: 1 },
    colors: { primary: '#ff7eb6', secondary: '#ffffff', accent: '#ffd1e6' },
    tagline: 'Hops through corners like nobody else',
    look: 'Pink bunny, very long ears (one flopped), round cheeks with blush, tiny nose, star hairclip, fluffy pom tail.',
  },
  {
    id: 'rex', name: 'Rex', species: 'dino', weightClass: 'heavy',
    stats: { speed: 5, accel: 2, handling: 2, weight: 5 },
    colors: { primary: '#35b449', secondary: '#f2e6a6', accent: '#1d6b2a' },
    tagline: 'Heavyweight with a monster top speed',
    look: 'Chunky green T-rex, big grin with little teeth, row of dark-green back spikes, cream belly, tiny arms gripping the wheel.',
  },
  {
    id: 'frost', name: 'Frost', species: 'penguin', weightClass: 'medium',
    stats: { speed: 3, accel: 3, handling: 4, weight: 3 },
    colors: { primary: '#2aa8ff', secondary: '#172640', accent: '#ffffff' },
    tagline: 'Cool, collected and slippery',
    look: 'Penguin with navy body, white face/belly, orange beak and feet, blue knit beanie with pom-pom, scarf trailing in the wind.',
  },
  {
    id: 'nova', name: 'Nova', species: 'alien', weightClass: 'medium',
    stats: { speed: 4, accel: 3, handling: 3, weight: 2 },
    colors: { primary: '#9b5cff', secondary: '#3ee8b5', accent: '#ffe45c' },
    tagline: 'Out-of-this-world speed',
    look: 'Mint-green alien with a big dome head, three glossy black eyes, two bobbing antennae with glowing yellow tips, purple space suit.',
  },
  {
    id: 'grizz', name: 'Grizz', species: 'bear', weightClass: 'heavy',
    stats: { speed: 5, accel: 2, handling: 2, weight: 5 },
    colors: { primary: '#8a5a33', secondary: '#e8c894', accent: '#2d2d2d' },
    tagline: 'Big, burly and hard to budge',
    look: 'Brown bear, round ears, tan muzzle, black nose, red-and-black flannel vest, small leather racing cap.',
  },
  {
    id: 'pepper', name: 'Pepper', species: 'cat', weightClass: 'light',
    stats: { speed: 3, accel: 4, handling: 4, weight: 2 },
    colors: { primary: '#ff8c1a', secondary: '#2f2f2f', accent: '#ffffff' },
    tagline: 'Quick paws, sharp lines',
    look: 'Orange tabby cat with dark stripes, white paws and chest, green eyes, whiskers, long striped tail, red bandana.',
  },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
export const getCharacter = (id) => CHARACTER_BY_ID[id] ?? CHARACTERS[0];
