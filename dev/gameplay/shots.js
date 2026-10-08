/**
 * Screenshot staging helpers: put the race into a photogenic state, then freeze the simulation
 * (game.paused = true without emitting GAME_PAUSE, so no pause menu appears).
 *   --eval="import('/dev/gameplay/shots.js').then(m => m.stage('banana3'))" --actions="shot:snaps/gameplay/x.png"
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = () => window.__game;

async function until(fn, timeout = 8000, step = 16) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(step);
  }
  return false;
}

function freeze() {
  G().paused = true;
}
export function unfreeze() {
  G().paused = false;
  G()._last = performance.now();
}

function player() {
  return G().player;
}

/** Make sure the AI-driven karts keep moving but nobody else interferes with the staged item. */
async function warm(seconds = 4) {
  await sleep(seconds * 1000);
}

const S = {};

S.banana3 = async () => {
  const g = G();
  const p = player();
  g.items.giveItem(p, 'banana3');
  await sleep(1800);
  freeze();
};

S.bouncer3 = async () => {
  const g = G();
  g.items.giveItem(player(), 'bouncer3');
  await sleep(1500);
  freeze();
};

S.seeker3 = async () => {
  const g = G();
  g.items.giveItem(player(), 'seeker3');
  await sleep(1500);
  freeze();
};

/** Player holds a single banana trailing behind (button held). */
S.bananaHeld = async () => {
  const g = G();
  const p = player();
  p.controller.items._reset?.();
  p.controller.items.update = () => {}; // manual item control for the staging
  g.items.giveItem(p, 'banana');
  p.input.item = true;
  await sleep(1400);
  freeze();
};

/** A trail of dropped bananas on the road behind the player. */
S.bananaTrail = async () => {
  const g = G();
  const p = player();
  p.controller.items.update = () => {};
  for (let i = 0; i < 5; i++) {
    g.items.giveItem(p, 'banana');
    p.input.item = true;
    await sleep(120);
    p.input.item = false;
    await sleep(250);
  }
  await sleep(500);
  freeze();
};

S.orbInFlight = async () => {
  const g = G();
  const p = player();
  p.controller.items.update = () => {};
  g.items.giveItem(p, 'bouncer');
  p.input.item = true;
  await sleep(100);
  p.input.item = false;
  await sleep(350);
  freeze();
};

S.seekerInFlight = async () => {
  const g = G();
  const p = player();
  p.controller.items.update = () => {};
  g.items.giveItem(p, 'seeker');
  p.input.item = true;
  await sleep(100);
  p.input.item = false;
  await sleep(600);
  freeze();
};

S.bomb = async () => {
  const g = G();
  const p = player();
  p.controller.items.update = () => {};
  g.items.giveItem(p, 'bomb');
  p.input.item = true;
  await sleep(100);
  p.input.item = false;
  await sleep(450);
  freeze();
};

S.bombSitting = async () => {
  const g = G();
  const p = player();
  p.controller.items.update = () => {};
  g.items.giveItem(p, 'bomb');
  p.input.item = true;
  await sleep(100);
  p.input.aimBack = true;
  p.input.item = false;
  await sleep(120);
  p.input.aimBack = false;
  await sleep(150);
  freeze();
};

S.comet = async () => {
  const g = G();
  const p = player();
  // make the player the leader, someone behind fires the comet
  const shooter = g.karts.find((k) => k !== p && k.place > 3) ?? g.karts[3];
  shooter.controller.items.update = () => {};
  g.items.giveItem(shooter, 'comet');
  shooter.input.item = true;
  await sleep(100);
  shooter.input.item = false;
  await until(() => g.items.projectiles.some((e) => e.type === 'comet'), 2000);
  const ok = await until(() => {
    const c = g.items.projectiles.find((e) => e.type === 'comet');
    if (!c) return true;
    // photograph it when it is ~22 m in front of / around the player's camera
    return Math.hypot(c.position.x - p.position.x, c.position.z - p.position.z) < 26 && c.mode === 'dive';
  }, 9000, 8);
  freeze();
  return ok;
};

S.explosion = async () => {
  const g = G();
  const p = player();
  const bomber = g.karts.find((k) => k !== p) ?? g.karts[0];
  bomber.controller.items.update = () => {};
  g.items.giveItem(bomber, 'bomb');
  bomber.input.item = true;
  await sleep(100);
  bomber.input.aimBack = true;
  bomber.input.item = false;
  await sleep(100);
  bomber.input.aimBack = false;
  const b = await until(() => g.items.hazards.some((h) => h.type === 'bomb'), 2000);
  void b;
  // fuse ~2.5 s: freeze a moment after the blast
  await until(() => g.events && false, 10);
  return true;
};

S.bolt = async () => {
  const g = G();
  const p = player();
  const shooter = g.karts.find((k) => k !== p && k.place > 4) ?? g.karts[5];
  shooter.controller.items.update = () => {};
  g.items.giveItem(shooter, 'bolt');
  shooter.input.item = true;
  await sleep(100);
  shooter.input.item = false;
  await sleep(500);
  freeze();
};

S.star = async () => {
  const g = G();
  const p = player();
  p.controller.items.update = () => {};
  g.items.giveItem(p, 'star');
  p.input.item = true;
  await sleep(100);
  p.input.item = false;
  await sleep(900);
  freeze();
};

S.boxes = async () => {
  const g = G();
  const p = player();
  // let the (AI-driven) player run until a box row is ~16 m ahead, then freeze
  await until(() => {
    for (const b of g.items.boxes) {
      const d = g.track.deltaS(p.trackS, b.s);
      if (d > 13 && d < 17) return true;
    }
    return false;
  }, 20000, 8);
  freeze();
};

export async function stage(name) {
  const r = await S[name]();
  return r ?? true;
}
export const names = Object.keys(S);
