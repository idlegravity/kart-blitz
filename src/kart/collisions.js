/**
 * Kart-vs-kart collisions (circles in XZ). OWNER: Driving agent.
 * Contract: export function resolveKartCollisions(karts, dt, game)   (called once per frame after all kart.update)
 *
 *  - Overlap is resolved by mass (the lighter kart is moved more).
 *  - Normal velocity is exchanged with restitution ~0.5, plus a "bump" impulse: heavier karts shove lighter ones
 *    harder (each kart's share is the OTHER kart's mass fraction).
 *  - A Star kart hitting a non-star kart makes the victim tumble (and plows through: it counts as heavy).
 *  - A normal-size kart touching a shrunk kart squishes it (drive-over: no bounce when the squish lands).
 *  - Respawning karts and karts at different heights (jumping over each other) are ignored.
 *  - KART_BUMP { a, b, impulse, point } with a per-pair cooldown.
 * Cheap: 28 circle tests for 8 karts, no per-frame allocation (events allocate only when they fire).
 */
import * as THREE from 'three';
import { EVT } from '../core/events.js';
import { clamp } from '../core/math.js';
import { TUNE } from './tuning.js';

const BUMP_SLOTS = 16;

/**
 * @param {import('./Kart.js').Kart[]} karts
 * @param {number} dt
 * @param {import('../Game.js').Game} game
 */
export function resolveKartCollisions(karts, dt, game) {
  if (dt <= 0) return;
  const C = TUNE.collide;
  const n = karts.length;
  for (let i = 0; i < n; i++) {
    const cd = karts[i]._bumpCd;
    if (cd) for (let j = 0; j < BUMP_SLOTS; j++) if (cd[j] > 0) cd[j] -= dt;
  }
  for (let i = 0; i < n; i++) {
    const a = karts[i];
    if (a.respawnTime > 0) continue;
    for (let j = i + 1; j < n; j++) {
      const b = karts[j];
      if (b.respawnTime > 0) continue;
      const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
      const rr = a.radius + b.radius;
      if (dx * dx + dz * dz >= rr * rr) continue;
      if (Math.abs(b.position.y - a.position.y) > C.verticalReach) continue;
      resolvePair(a, b, dx, dz, rr, game);
    }
  }
}

function resolvePair(a, b, dx, dz, rr, game) {
  const C = TUNE.collide;
  let d = Math.hypot(dx, dz);
  let nx, nz; // unit normal from a to b
  if (d < 1e-4) {
    nx = a.right.x;
    nz = a.right.z;
    d = 0;
  } else {
    nx = dx / d;
    nz = dz / d;
  }
  const overlap = rr - d;

  // ---- star: victim tumbles ----
  const aStar = a.starTime > 0, bStar = b.starTime > 0;
  if (aStar !== bStar) {
    const star = aStar ? a : b, victim = aStar ? b : a;
    victim.applyHit('tumble', star);
  } else if (!aStar) {
    // ---- shrink: a normal-size kart squishes a shrunk one (drive-over) ----
    const aSmall = a.shrinkTime > 0, bSmall = b.shrinkTime > 0;
    if (aSmall !== bSmall) {
      const victim = aSmall ? a : b, big = aSmall ? b : a;
      if (victim.applyHit('squish', big)) {
        // the big kart rolls over it: only separate the overlap a little so it does not pop
        pushApart(a, b, nx, nz, overlap * 0.4);
        emitBump(game, a, b, 1.5, nx, nz);
        return;
      }
    }
  }

  // ---- physical response ----
  const ma = a.mass * (aStar && !bStar ? 3 : 1);
  const mb = b.mass * (bStar && !aStar ? 3 : 1);
  const msum = ma + mb;
  pushApart(a, b, nx, nz, overlap + 0.01, mb / msum, ma / msum);

  const va = a.velocity, vb = b.velocity;
  const vrel = (vb.x - va.x) * nx + (vb.z - va.z) * nz; // < 0 : approaching
  let impulse = 0;
  if (vrel < 0) {
    const j = (-(1 + C.restitution) * vrel) / (1 / ma + 1 / mb);
    const bump = C.bumpBase + C.bumpPerSpeed * -vrel;
    const dva = j / ma + (bump * mb) / msum;
    const dvb = j / mb + (bump * ma) / msum;
    a.applyImpulse(-nx * dva, -nz * dva);
    b.applyImpulse(nx * dvb, nz * dvb);
    impulse = Math.max(dva, dvb);
    // small body-english: a hit on a front/rear corner twists the nose
    yawKick(a, -nx, -nz, impulse);
    yawKick(b, nx, nz, impulse);
  } else if (overlap > 0.05) {
    // already separating but still overlapping: a gentle shove so they clear each other
    const s = Math.min(1.5, overlap * 6);
    a.applyImpulse(-nx * s * (mb / msum), -nz * s * (mb / msum));
    b.applyImpulse(nx * s * (ma / msum), nz * s * (ma / msum));
    impulse = s * 0.5;
  }
  if (impulse >= C.eventMin) emitBump(game, a, b, impulse, nx, nz);
}

function pushApart(a, b, nx, nz, dist, wa = 0.5, wb = 0.5) {
  a.position.x -= nx * dist * wa;
  a.position.z -= nz * dist * wa;
  b.position.x += nx * dist * wb;
  b.position.z += nz * dist * wb;
}

/** Twist the kart's nose depending on where the contact is (front/rear, left/right). */
function yawKick(k, nx, nz, impulse) {
  // (nx, nz) points from k toward the other kart
  const nf = nx * k.forward.x + nz * k.forward.z;
  const nr = nx * k.right.x + nz * k.right.z;
  const kick = 0.035 * clamp(impulse * 0.5, 0, 3) * clamp(nf * nr * 2, -1, 1);
  if (kick !== 0) k.nudgeYaw?.(kick);
}

function emitBump(game, a, b, impulse, nx, nz) {
  const C = TUNE.collide;
  const ca = a._bumpCd ?? (a._bumpCd = new Float32Array(BUMP_SLOTS));
  const slot = b.id % BUMP_SLOTS;
  if (ca[slot] > 0) return;
  ca[slot] = C.cooldown;
  const cb = b._bumpCd ?? (b._bumpCd = new Float32Array(BUMP_SLOTS));
  cb[a.id % BUMP_SLOTS] = C.cooldown;
  const point = new THREE.Vector3(
    a.position.x + nx * a.radius,
    0.5 * (a.position.y + b.position.y) + 0.5,
    a.position.z + nz * a.radius,
  );
  game.events.emit(EVT.KART_BUMP, { a, b, impulse, point });
}
