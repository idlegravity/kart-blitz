/**
 * aiItems.js — the CPU drivers' item strategy.
 * OWNER: Gameplay agent.
 *
 * The brain presses / releases `kart.input.item` (and sets `aimBack`) like a human would:
 *   instant items (nitro, star, bolt, comet, golden nitro) .... one-frame pulse
 *   holdables (banana, bouncer, seeker, bomb + triples) ........ press to deploy behind the kart as a shield,
 *                                                                 release to fire / drop
 * Decisions are gated by a skill-scaled reaction delay and by personality (eagerness, aggression).
 */
import { ITEMS } from '../data/items.js';
import { lerp } from '../core/math.js';

const HOLD_MAX = { banana: 9, banana3: 30, bouncer: 12, bouncer3: 30, seeker: 13, seeker3: 30, bomb: 12 };

export class AIItemBrain {
  constructor(ai) {
    this.ai = ai;
    this.itemId = null;
    this.age = 0;
    this.holdT = 0;
    this.holding = false;
    this.commit = null; // 'fwd' | 'back' — the press was a "fire now" press
    this.prevBtn = false;
    this.lastUse = -99;
    this.reaction = 0.6;
    this.shieldLoss = 0;
  }

  _reset() {
    this.itemId = null;
    this.age = 0;
    this.holdT = 0;
    this.holding = false;
    this.commit = null;
  }

  update(dt) {
    const ai = this.ai, k = ai.kart, inp = k.input, game = ai.game, P = ai.profile;
    if (!k.item || k.rouletteTime > 0 || k.finished || k.hit || k.respawnTime > 0) {
      if (!k.item || k.finished) this._reset();
      else this.holding = false;
      inp.item = false;
      inp.aimBack = false;
      this.prevBtn = false;
      return;
    }
    if (k.item !== this.itemId) {
      this.itemId = k.item;
      this.age = 0;
      this.holdT = 0;
      this.holding = false;
      this.commit = null;
      this.reaction = P.reaction * lerp(1.25, 0.75, ai.rng()) * lerp(1.15, 0.8, P.eagerness);
    }
    this.age += dt;
    const time = ai.time;
    let btn = false;
    let aimBack = false;

    if (this.age < this.reaction) {
      inp.item = false;
      inp.aimBack = false;
      this.prevBtn = false;
      return;
    }

    const def = ITEMS[k.item];
    const c = ai.ctx;
    switch (k.item) {
      // ---------------------------------------------------------------- instant items
      case 'nitro':
      case 'nitro3': {
        const straight = c.turnAhead < 0.4;
        // jumps want speed: fire a nitro on the run-up to a ramp
        const rampRun = c.rampAhead > 6 && c.rampAhead < 42 && k.boostTime < 0.5 && k.grounded;
        const fine = (k.boostTime < 0.15 && c.speed > 0.4 * c.top && k.grounded && straight) || (rampRun && c.speed > 12);
        const spaced = time - this.lastUse > 1.7;
        const race = game.race;
        const desperate = k.place >= 5 && race.distanceToLeader(k) > 90;
        if (spaced && ((fine && (this.age > this.reaction + 0.2 || P.eagerness > 0.6)) || (this.age > 11 && k.boostTime < 0.3 && c.turnAhead < 0.9) || (desperate && k.boostTime < 0.15 && k.grounded))) {
          btn = true;
          this.lastUse = time;
        }
        break;
      }
      case 'goldnitro': {
        if (k.itemTime <= 0) {
          if (c.turnAhead < 0.6 || this.age > 2.5) {
            btn = true;
            this.lastUse = time;
          }
        } else if (k.boostTime < 0.3 && time - this.lastUse > 0.5 && !this.prevBtn) {
          btn = true; // spam it
          this.lastUse = time;
        }
        break;
      }
      case 'star': {
        const threat = this._threat();
        const eager = P.itemSkill < 0.35;
        const holdMax = 0.4 + 2.4 * P.itemSkill * (1.3 - P.aggression * 0.5);
        const crowd = c.ahead && c.ahead.ds < 26;
        if (eager || threat || crowd || this.age > holdMax + this.reaction) {
          btn = true;
          this.lastUse = time;
        }
        break;
      }
      case 'bolt': {
        const n = game.karts.length;
        if (k.place > Math.ceil(n / 2) || this.age > 28) {
          btn = true;
          this.lastUse = time;
        }
        break;
      }
      case 'comet': {
        btn = true;
        this.lastUse = time;
        break;
      }
      // ---------------------------------------------------------------- holdables
      default: {
        if (!def || !def.holdable) break;
        const triple = def.uses > 1;
        this.holdT += this.holding ? dt : 0;
        if (this.holding) {
          const dir = this.commit ?? this._fireDecision(k.item, triple, time);
          if (dir) {
            btn = false;
            aimBack = dir === 'back';
            this.holding = false;
            this.commit = null;
            this.lastUse = time;
            this.holdT = 0;
          } else {
            btn = true;
          }
        } else if (!(triple && time - this.lastUse < 1.1)) {
          const dir = this._fireDecision(k.item, triple, time);
          if (dir) {
            btn = true;
            this.holding = true;
            this.commit = dir;
            this.holdT = 0;
          } else if (!triple && this._wantShield()) {
            btn = true;
            this.holding = true;
            this.holdT = 0;
          }
        }
        break;
      }
    }
    // a pulse is always followed by a released frame
    if (btn && this.prevBtn && !this.holding) btn = false;
    inp.item = btn;
    inp.aimBack = aimBack;
    this.prevBtn = btn;
  }

  /** Someone close enough behind that a shield is worth deploying. */
  _wantShield() {
    const b = this.ai.ctx.behind;
    return !!b && -b.ds < 30 + 10 * this.ai.profile.eagerness;
  }

  /**
   * Should the held item be fired now, and which way?
   * @returns {'fwd'|'back'|null}
   */
  _fireDecision(id, triple, time) {
    const ai = this.ai, k = ai.kart, c = ai.ctx, P = ai.profile, race = ai.game.race;
    const a = c.ahead, b = c.behind;
    const cone = 2.6 + 3.2 * (1 - P.itemSkill);
    const behindDs = b ? -b.ds : 1e9;
    switch (id) {
      case 'bouncer':
      case 'bouncer3':
        if (a && a.ds > 6 && a.ds < 34 && Math.abs(a.dl) < cone) return 'fwd';
        if (b && behindDs < 10 && Math.abs(b.dl) < 2.6 && P.aggression > 0.4) return 'back';
        break;
      case 'seeker':
      case 'seeker3': {
        const t = race.getKartAhead(k);
        if (t && !t.finished) {
          const gap = t.progress - k.progress;
          if (gap > 8 && gap < 95) return 'fwd';
        } else if (a && a.ds > 8 && a.ds < 40 && Math.abs(a.dl) < 8) return 'fwd';
        if (b && behindDs < 12 && Math.abs(b.dl) < 2.8 && P.aggression > 0.55) return 'back';
        break;
      }
      case 'bomb':
        if (a && a.ds > 10 && a.ds < 42 && (c.aheadCount >= 2 || Math.abs(a.dl) < 6)) return 'fwd';
        if (b && behindDs < 9 && Math.abs(b.dl) < 3.4) return 'back';
        break;
      case 'banana':
      case 'banana3':
        if (b && behindDs < 13 && (Math.abs(b.dl) < 4.2 || this.holdT > 1.2)) return 'back';
        if (!b && this.age > 3 + 3 * (1 - P.eagerness) && c.turnAhead < 0.3 && time - this.lastUse > 2.5) return 'back';
        break;
      default:
        break;
    }
    const max = HOLD_MAX[id] ?? 12;
    if ((this.holding ? this.holdT : this.age) > max) return id.startsWith('banana') ? 'back' : 'fwd';
    return null;
  }

  /** A projectile / hazard that is about to hit us. */
  _threat() {
    const ai = this.ai, k = ai.kart, items = ai.game.items;
    if (!items) return false;
    const pr = items.projectiles;
    for (let i = 0; i < pr.length; i++) {
      const p = pr[i];
      if (p.owner === k || p.dead) continue;
      const rx = k.position.x - p.position.x, rz = k.position.z - p.position.z;
      const d = Math.hypot(rx, rz);
      if (d > 34 || d < 0.5) continue;
      if (p.type === 'comet') {
        if (p.target === k) return true;
        continue;
      }
      if (p.type === 'seeker' && p.target === k && d < 45) return true;
      const vx = p.velocity.x, vz = p.velocity.z;
      const vl = Math.hypot(vx, vz);
      if (vl < 4) continue;
      const closing = (vx * rx + vz * rz) / d;
      const miss = Math.abs(vx * rz - vz * rx) / vl;
      if (closing > 6 && miss < 3.5) return true;
    }
    const hz = items.hazards;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (h.dead) continue;
      const dx = h.position.x - k.position.x, dz = h.position.z - k.position.z;
      const fwd = dx * k.forward.x + dz * k.forward.z;
      if (fwd > 0 && fwd < 14 && Math.abs(dx * k.right.x + dz * k.right.z) < 2.6) return true;
    }
    return false;
  }
}
