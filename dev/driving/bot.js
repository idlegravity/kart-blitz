/**
 * DriverBot — a tiny scripted controller for testing the driving model (NOT the game's AI).
 * Pursuit steering toward a look-ahead point on the centerline, drifts through bends, collects statistics.
 * Works with any Track implementing the contract (real tracks and dev/driving/TestTrack.js).
 *
 * Browser:  --eval="import('/dev/driving/bot.js').then(m => { window.__bot = m.installBot(__game); })"
 * Node:     see dev/driving/sim.mjs (scenario 'lap').
 */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

export class DriverBot {
  /**
   * @param {object} game  needs .track
   * @param {import('../../src/kart/Kart.js').Kart} kart
   * @param {{ drift?: boolean, lineOffset?: number, lookMin?: number, driftCurv?: number, digital?: boolean }} [opts]
   *   digital: quantise the steering to -1/0/+1 like a keyboard (with a dead band)
   */
  constructor(game, kart, opts = {}) {
    this.game = game;
    this.kart = kart;
    this.opts = { drift: true, lineOffset: 0, lookMin: 9, driftCurv: 1 / 62, digital: false, ...opts };
    this._fr = {};
    this._wantDrift = false;
    this._driftDir = 0;
    this._cool = 0;
    this._lastDig = 0;
    this.stats = { time: 0, walls: 0, wallImpactMax: 0, drifts: 0, miniturbos: 0, levels: [0, 0, 0, 0], offroadTime: 0, airTime: 0, respawns: 0, maxSpeed: 0, laps: 0 };
    this._unsub = [];
    const ev = game.events;
    if (ev) {
      const mine = (p) => p.kart === kart;
      this._unsub.push(
        ev.on('kart:wall', (p) => {
          if (!mine(p)) return;
          this.stats.walls++;
          this.stats.wallImpactMax = Math.max(this.stats.wallImpactMax, p.impact);
        }),
        ev.on('kart:driftStart', (p) => mine(p) && this.stats.drifts++),
        ev.on('kart:driftEnd', (p) => {
          if (!mine(p)) return;
          this.stats.levels[p.level]++;
          if (p.level > 0) this.stats.miniturbos++;
        }),
        ev.on('kart:fall', (p) => mine(p) && this.stats.respawns++),
      );
    }
  }

  dispose() {
    for (const off of this._unsub) off?.();
  }

  update(dt) {
    const k = this.kart, track = this.game.track, o = this.opts;
    if (!track || !k.lastSample) return;
    const inp = k.input;
    const st = this.stats;
    st.time += dt;
    st.maxSpeed = Math.max(st.maxSpeed, k.speed);
    if (k.surface === 'offroad') st.offroadTime += dt;
    if (!k.grounded) st.airTime += dt;

    // ---- steering: pursuit of a look-ahead point ----
    const look = clamp(o.lookMin + Math.abs(k.speed) * 0.42, o.lookMin, 26);
    const f = track.getFrameAt(k.trackS + look, this._fr);
    const tx = f.position.x + f.right.x * o.lineOffset;
    const tz = f.position.z + f.right.z * o.lineOffset;
    const want = Math.atan2(tx - k.position.x, tz - k.position.z);
    const err = wrap(want - k.yaw); // + = target is to the left
    let steer = clamp(-err * 2.4, -1, 1);

    // ---- drift through bends ----
    const curvAhead = track.curvatureAt(k.trackS + 6 + k.speed * 0.13);
    const curvNow = track.curvatureAt(k.trackS + 3);
    this._cool -= dt;
    if (o.drift) {
      if (!this._wantDrift && this._cool <= 0 && Math.abs(curvAhead) > o.driftCurv && k.speed > 16 && k.grounded && !k.hit && k.respawnTime <= 0) {
        this._wantDrift = true;
        this._driftDir = Math.sign(curvAhead);
        this._cool = 1;
      } else if (this._wantDrift && Math.abs(curvNow) < o.driftCurv * 0.55 && Math.abs(curvAhead) < o.driftCurv * 0.6) {
        this._wantDrift = false;
        this._cool = 0.8;
      } else if (this._wantDrift && Math.sign(curvAhead) !== this._driftDir && Math.abs(curvAhead) > o.driftCurv * 0.5) {
        // the bend flips direction (S-bend): release now (fires the mini-turbo) and re-enter the other way
        this._wantDrift = false;
        this._cool = 0.25;
      }
    }
    inp.drift = this._wantDrift && !k.hit;
    if (this._wantDrift && !k.drifting && k.grounded) {
      // entering: only just enough steering to pick the direction (the hop reads |steer| > 0.3)
      steer = this._driftDir * 0.4;
    } else if (this._wantDrift && k.drifting) {
      // while drifting: feed-forward the steer that gives the yaw rate the bend needs, plus pursuit feedback
      const need = Math.abs(k.speed) * Math.abs(curvNow * 0.5 + curvAhead * 0.5); // rad/s wanted
      const D = { inward: 1.6, outward: 0.45 };
      const base = 0.95 * (1 + 0.25 * (1 - Math.min(1, k.speed / Math.max(k.topSpeed, 1))));
      const mult = need / (base + 1e-6);
      const inward = mult >= 1 ? (mult - 1) / (D.inward - 1) : -(1 - mult) / (1 - D.outward);
      const ff = clamp(inward, -1, 1) * k.driftDir;
      steer = clamp(ff + steer * 0.55, -1, 1);
    }
    if (o.digital) {
      // keyboard-like: hold a direction only when the wanted steering is clearly on one side
      const th = this._lastDig !== 0 ? 0.18 : 0.32;
      steer = Math.abs(steer) < th ? 0 : Math.sign(steer);
      this._lastDig = steer;
    }
    inp.steer = steer;
    inp.throttle = 1;
    inp.brake = 0;
    inp.item = false;
    inp.lookBack = false;
    inp.aimBack = false;
  }
}

/** Install the bot on the game's player (browser). */
export function installBot(game, opts) {
  const k = game.player;
  k.controller?.dispose?.();
  const bot = new DriverBot(game, k, opts);
  k.controller = bot;
  return bot;
}
