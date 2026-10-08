/**
 * Item catalog (ids + presentation). Behaviour lives in src/items/ (Gameplay agent).
 * OWNER: orchestrator. Read-only for agents (the Items agent may tune gameplay numbers in its own module).
 *
 * id        : stable string stored in kart.item
 * uses      : how many activations the pickup grants (kart.itemCount starts at this)
 * holdable  : can be held behind the kart as a shield while the item button is held
 * color     : primary color for icons / meshes (hex)
 * iconHint  : art direction for the HUD icon (UI agent draws SVG icons from this)
 */
export const ITEMS = {
  banana: { id: 'banana', name: 'Banana', uses: 1, holdable: true, color: '#ffd93b', iconHint: 'single yellow banana peel' },
  banana3: { id: 'banana3', name: 'Triple Banana', uses: 3, holdable: true, color: '#ffd93b', iconHint: 'three bananas in a fan' },
  bouncer: { id: 'bouncer', name: 'Bouncer', uses: 1, holdable: true, color: '#34d058', iconHint: 'glossy green orb with a white ring band; flies straight and ricochets off walls' },
  bouncer3: { id: 'bouncer3', name: 'Triple Bouncer', uses: 3, holdable: true, color: '#34d058', iconHint: 'three green orbs in a triangle' },
  seeker: { id: 'seeker', name: 'Seeker', uses: 1, holdable: true, color: '#ff3b3b', iconHint: 'glossy red orb with a white ring band and a tiny target reticle; homes onto the kart ahead' },
  seeker3: { id: 'seeker3', name: 'Triple Seeker', uses: 3, holdable: true, color: '#ff3b3b', iconHint: 'three red orbs in a triangle' },
  nitro: { id: 'nitro', name: 'Nitro', uses: 1, holdable: false, color: '#ff8a00', iconHint: 'orange-and-white nitro canister with a flame decal' },
  nitro3: { id: 'nitro3', name: 'Triple Nitro', uses: 3, holdable: false, color: '#ff8a00', iconHint: 'three nitro canisters' },
  goldnitro: { id: 'goldnitro', name: 'Golden Nitro', uses: 1, holdable: false, color: '#ffc400', iconHint: 'shining gold nitro canister; unlimited boosts for a few seconds' },
  star: { id: 'star', name: 'Super Star', uses: 1, holdable: false, color: '#ffe93b', iconHint: 'five-point star with rainbow shimmer and cute eyes' },
  bolt: { id: 'bolt', name: 'Thunderbolt', uses: 1, holdable: false, color: '#ffe600', iconHint: 'jagged yellow lightning bolt; shrinks every rival' },
  bomb: { id: 'bomb', name: 'Bomb', uses: 1, holdable: true, color: '#2b2b3a', iconHint: 'round black bomb with lit fuse and wind-up key' },
  comet: { id: 'comet', name: 'Comet', uses: 1, holdable: false, color: '#3b7bff', iconHint: 'blue spiked orb with little white wings and a sparkle trail; hunts the race leader' },
};

export const ITEM_IDS = Object.keys(ITEMS);
export const getItem = (id) => ITEMS[id] ?? null;
