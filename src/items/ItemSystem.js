/**
 * ItemSystem — item boxes, roulette, the 13 items, projectiles, hazards and hit resolution.
 * OWNER: Gameplay agent.  Contract: ARCHITECTURE.md §6.8.
 *
 *   new ItemSystem(game)      setupRace(ctx)      teardownRace()      update(dt)      giveItem(kart, id)
 *   hazards     [{ type:'banana'|'bomb', position, radius, owner, s, lateral, ... }]   (live, static things on the road)
 *   projectiles [{ type:'bouncer'|'seeker'|'bomb'|'comet', position, velocity, owner, target, s, lateral, ... }]   (live, moving)
 *   boxes       [{ position (cube centre), active, s, lateral, ... }]
 * Additions to the documented API: getShield(kart), stats(), describeDistribution(count, gap), kill(entity) (debug/tests).
 *
 * Design notes
 *  - Everything that exists in the world is a pooled `Entity` (no per-frame allocation). Entities are rendered
 *    through a handful of InstancedMeshes (ItemRenderer) and the boxes through ItemBoxes.
 *  - Kills are deferred: `kill(e)` marks the entity dead and `_flush()` compacts the live lists at the end of
 *    update, so no loop ever sees a list mutate under it (and AI reading the lists mid-frame is always safe).
 *  - Karts are only touched through their documented API (`applyHit/applyBoost/startStar/startShrink`, status
 *    fields). Tracks only through the Track API (`query`, `getFrameAt`, `deltaS`, `wrapS`, colliders, slots).
 *  - Item use is edge-detected from `kart.input.item`:
 *      instant items ........ act on press
 *      holdable items ....... press = deploy behind the kart (shield), release = throw / drop
 *      triples .............. appear as an orbiting / trailing shield on pickup, each release throws one
 *      golden nitro ......... press starts a 7.5 s window in which every press (or holding) boosts again
 */
import * as THREE from 'three';
import { EVT } from '../core/events.js';
import { ITEMS } from '../data/items.js';
import { makeRng, clamp, damp, angleDiff } from '../core/math.js';
import { TUNING, pickItem, describeDistribution } from './itemTables.js';
import { ItemRenderer, CometVisual } from './ItemRenderer.js';
import { ItemBoxes } from './ItemBoxes.js';
import { ColliderGrid } from './colliderGrid.js';

const TAU = Math.PI * 2;
const GRAVITY = 30;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** kart.item -> the world entity type used for its held / thrown form. */
const HELD_TYPE = { banana: 'banana', banana3: 'banana', bouncer: 'bouncer', bouncer3: 'bouncer', seeker: 'seeker', seeker3: 'seeker', bomb: 'bomb' };
const ORBIT_ITEMS = new Set(['bouncer3', 'seeker3']);

/** HDR colours (r, g, b) for Effects.burst */
const FX_COLOR = {
  banana: [3.4, 2.8, 0.6],
  bouncer: [0.8, 3.2, 1.2],
  seeker: [3.4, 0.8, 0.7],
  bomb: [4, 2.8, 1],
  comet: [0.8, 1.8, 4],
  white: [3, 3, 3.4],
};
const _fxOpts = { count: 6, scale: 1, color: FX_COLOR.white };
const _fxPos = new THREE.Vector3();

// scratch (module level — never allocate in hot paths)
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _frame = {};
const _near = new Array(64);

/** A pooled world object: banana, orb, bomb or comet (also used for held/trailing visuals). */
class Entity {
  constructor(index) {
    this.index = index;
    this.active = false;
    this.dead = false;
    /** Public type: 'banana' | 'bouncer' | 'seeker' | 'bomb' | 'comet'. */
    this.type = 'banana';
    /** 'trail' | 'orbit' | 'hazard' | 'fly' | 'arc' | 'sit' | 'cruise' | 'dive'. */
    this.mode = 'hazard';
    this.list = null; // 'hazards' | 'projectiles' | null
    this.ks = null; //   owning KartItemState while held
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1); // horizontal travel direction (unit)
    this.radius = 0.5;
    this.owner = null;
    this.target = null;
    this.age = 0;
    this.life = 0;
    this.speed = 0;
    this.bounces = 0;
    this.fuse = 0;
    this.grace = 0;
    this.yaw = 0;
    this.spin = 0;
    this.vy = 0;
    this.airborne = false;
    this.hint = -1;
    this.sample = {};
    this.groundY = 0;
    this.s = 0; //       distance along the course (AI reads this on hazards / projectiles)
    this.lateral = 0; // lateral position on the course
    this.lat = 0;
    this.aimX = 0;
    this.aimZ = 0;
    this.armed = false; // bomb: fuse running
    this.fxT = 0;
    this.slotOrbit = 0;
    this.pendingList = null;
  }
  reset(type, mode) {
    this.type = type;
    this.mode = mode;
    this.dead = false;
    this.list = null;
    this.ks = null;
    this.owner = null;
    this.target = null;
    this.age = this.life = this.speed = this.fuse = this.grace = this.spin = this.vy = 0;
    this.bounces = 0;
    this.yaw = 0;
    this.airborne = false;
    this.armed = false;
    this.pendingList = null;
    this.hint = -1;
    this.velocity.set(0, 0, 0);
    this.dir.set(0, 0, 1);
  }
}

/** Per-kart item bookkeeping. */
class KartItemState {
  constructor(kart) {
    this.kart = kart;
    this.prev = false; //    item button state last frame
    this.aiming = false; //  button held with a holdable item
    /** @type {Entity[]} held / orbiting entities (shield). */
    this.trail = [];
    this.orbit = 0;
    this.lastItem = null;
  }
}

export class ItemSystem {
  constructor(game) {
    this.game = game;
    /** @type {Entity[]} live static hazards (bananas, landed bombs). */
    this.hazards = [];
    /** @type {Entity[]} live moving projectiles (orbs, flying bombs, comet). */
    this.projectiles = [];
    /** Public box list ({ position, active, s, lateral }). Empty when items are disabled. */
    this.boxes = [];

    this.track = null;
    this.karts = [];
    this.player = null;
    this.players = [];
    this.config = null;
    this.group = null;
    this.renderer = null;
    this.comet = null;
    this.boxField = null;
    this.grid = null;
    this.time = 0;
    this.boltCooldown = 0;
    this.rng = makeRng(1);

    this._pool = [];
    this._free = [];
    this._dying = [];
    this._moving = [];
    this._states = new Map();
    this._stateList = [];
    this._off = [];
    this._cometEntity = null;
    this._active = false;
    this._errors = 0;
  }

  // ==================================================================================================
  // lifecycle
  // ==================================================================================================
  setupRace(ctx) {
    if (this._active) this.teardownRace();
    const { track, karts, player, config } = ctx;
    this.track = track;
    this.karts = karts;
    this.player = player;
    /** Every human kart (split-screen); [] outside a race. Falls back to [player]. */
    this.players = ctx.players?.length ? ctx.players : (player ? [player] : []);
    this.config = config;
    this.time = 0;
    this.boltCooldown = 0;
    const seedParam = Number(this.game.params?.get?.('itemseed'));
    this.rng = makeRng(Number.isFinite(seedParam) && this.game.params.has('itemseed') ? seedParam : (Math.random() * 4294967296) >>> 0);

    this.group = new THREE.Group();
    this.group.name = 'items';
    this.game.scene.add(this.group);
    this.renderer = new ItemRenderer(this.group);
    this.comet = new CometVisual(this.group);
    this.grid = new ColliderGrid(track?.colliders ?? [], 32);

    const cap = 8 * 3 + TUNING.banana.max + 40;
    for (let i = 0; i < cap; i++) {
      this._pool.push(new Entity(i));
      this._free.push(cap - 1 - i);
    }

    for (const k of karts) this._state(k);
    this._active = true;

    const useBoxes = config?.items !== false;
    if (useBoxes) {
      this.boxField = new ItemBoxes(this.group, track?.itemBoxSlots ?? []);
      this.boxes = this.boxField.list;
    } else {
      this.boxes = [];
      // time trial (always 1 player): no boxes, start with a triple nitro
      const solo = this.players[0] ?? player;
      if (solo) this.giveItem(solo, 'nitro3');
    }

    this._off.push(this.game.events.on(EVT.KART_HIT, (p) => this._onKartHit(p)));
  }

  teardownRace() {
    for (const off of this._off) off();
    this._off.length = 0;
    this.boxField?.dispose();
    this.boxField = null;
    this.comet?.dispose();
    this.comet = null;
    this.renderer?.dispose();
    this.renderer = null;
    if (this.group) {
      this.game.scene.remove(this.group);
      this.group = null;
    }
    this.hazards.length = 0;
    this.projectiles.length = 0;
    this.boxes = [];
    this._pool.length = 0;
    this._free.length = 0;
    this._dying.length = 0;
    this._moving.length = 0;
    this._states.clear();
    this._stateList.length = 0;
    this._cometEntity = null;
    this.grid = null;
    this.track = null;
    this.karts = [];
    this.player = null;
    this.players = [];
    this._active = false;
  }

  // ==================================================================================================
  // public API
  // ==================================================================================================
  /**
   * Give `kart` an item immediately (debug, time trial, roulette result). Triples appear as a shield.
   * @param {object} kart
   * @param {string} itemId one of ITEMS
   */
  giveItem(kart, itemId) {
    const def = ITEMS[itemId];
    const ks = this._state(kart);
    this._clearTrail(ks);
    ks.aiming = false;
    if (!def) {
      kart.item = null;
      kart.itemCount = 0;
      kart.rouletteTime = 0;
      return;
    }
    kart.item = itemId;
    kart.itemCount = def.uses;
    kart.rouletteTime = 0;
    if (itemId !== 'goldnitro') kart.itemTime = 0;
    if (def.holdable && def.uses > 1 && this._active) this._deployTriple(kart, ks, def);
    this.game.events.emit(EVT.ITEM_GET, { kart, item: itemId, count: def.uses });
  }

  /** Number of trailing / orbiting shield items a kart currently has. */
  getShield(kart) {
    return this._states.get(kart)?.trail.length ?? 0;
  }

  /** Item-box probability table (percent per place) — handy in the console: __game.items.describeDistribution(). */
  describeDistribution(count = 8, gap = 60) {
    return describeDistribution(count, gap);
  }

  /** Quick counters for probes / tests. */
  stats() {
    return {
      hazards: this.hazards.length,
      projectiles: this.projectiles.length,
      boxes: this.boxes.filter((b) => b.active).length,
      comet: !!this._cometEntity,
      humans: this.players.length,
      boltCooldown: Math.max(0, this.boltCooldown),
    };
  }

  // ==================================================================================================
  // per-frame
  // ==================================================================================================
  update(dt) {
    if (!(dt > 0) || !this._active || !this.track) return;
    try {
      this._update(dt);
    } catch (err) {
      if (this._errors++ < 3) console.error('[ItemSystem] update failed', err);
    }
  }

  _update(dt) {
    const race = this.game.race;
    const started = race.hasStarted;
    this.time += dt;
    if (this.boltCooldown > 0) this.boltCooldown -= dt;
    this.boxField?.update(dt);

    for (let i = 0; i < this._stateList.length; i++) {
      const ks = this._stateList[i];
      this._updateKart(ks.kart, ks, dt, started);
    }
    this._updateTrails(dt);
    if (started) {
      this._updateProjectiles(dt);
      this._updateHazards(dt);
    }
    this._flush();
    this._render(dt);
  }

  // ---------------------------------------------------------------------------------------------- karts
  _state(kart) {
    let ks = this._states.get(kart);
    if (!ks) {
      ks = new KartItemState(kart);
      this._states.set(kart, ks);
      this._stateList.push(ks);
    }
    return ks;
  }

  _updateKart(kart, ks, dt, started) {
    const inp = kart.input;
    const down = !!(inp && inp.item);
    const pressed = down && !ks.prev;
    const released = !down && ks.prev;
    ks.prev = down;

    if (kart.finished) {
      if (ks.trail.length) this._clearTrail(ks);
      ks.aiming = false;
      return;
    }

    // ---- boxes ----
    if (started && this.boxField && !(kart.respawnTime > 0)) {
      const box = this.boxField.find(kart);
      if (box) this._collectBox(kart, box);
    }

    // ---- roulette ----
    if (kart.rouletteTime > 0) {
      kart.rouletteTime -= dt;
      if (kart.rouletteTime <= 0) {
        kart.rouletteTime = 0;
        if (!kart.item) this._grantRandom(kart, ks);
      }
      return;
    }

    // ---- golden nitro window ----
    if (kart.itemTime > 0) {
      kart.itemTime -= dt;
      if (kart.itemTime <= 0) {
        kart.itemTime = 0;
        if (kart.item === 'goldnitro') this._endItem(kart, ks);
      }
    }

    if (!kart.item) {
      if (ks.trail.length) this._clearTrail(ks);
      ks.aiming = false;
      return;
    }
    const def = ITEMS[kart.item];
    if (!def) return;
    const canUse = started && !kart.controlLocked && !(kart.hit && kart.hit.lock !== false) && !(kart.respawnTime > 0);

    if (def.id === 'goldnitro') {
      if (!canUse) return;
      const B = TUNING.boosts;
      if (kart.itemTime > 0) {
        if (pressed || (down && kart.boostTime < 0.1)) kart.applyBoost(B.gold, B.goldPower, 'goldnitro');
      } else if (pressed) {
        kart.itemTime = B.goldTime;
        this.game.events.emit(EVT.ITEM_USE, { kart, item: def.id });
        kart.applyBoost(B.gold, B.goldPower, 'goldnitro');
      }
      return;
    }

    if (!def.holdable) {
      if (canUse && pressed) this._useInstant(kart, ks, def);
      return;
    }

    // ---- holdable: deploy on press, throw on release ----
    const triple = def.uses > 1;
    if (triple && ks.trail.length === 0 && kart.itemCount > 0) this._deployTriple(kart, ks, def); // robustness (item set externally)
    if (canUse) {
      if (pressed && !ks.aiming) {
        if (!triple && ks.trail.length === 0) this._deploySingle(kart, ks, def);
        ks.aiming = true;
      }
      if (released && ks.aiming) {
        this._throwHeld(kart, ks, def);
        ks.aiming = false;
      }
    }
  }

  _collectBox(kart, box) {
    this.boxField.collect(box);
    this.game.events.emit(EVT.ITEM_BOX_HIT, { kart, position: box.position.clone() });
    if (!kart.item && !(kart.rouletteTime > 0)) {
      const duration = TUNING.roulette.duration;
      kart.rouletteTime = duration;
      this.game.events.emit(EVT.ITEM_ROULETTE, { kart, duration });
    }
  }

  _grantRandom(kart, ks) {
    const race = this.game.race;
    const ctx = {
      place: kart.place,
      count: this.karts.length,
      gap: race.distanceToLeader(kart),
      raceTime: race.time,
      boltOk: this._boltAvailable(),
      cometOk: this._cometAvailable(),
      lastItem: ks.lastItem,
    };
    const id = pickItem(this.rng, ctx);
    ks.lastItem = id;
    this.giveItem(kart, id);
  }

  _boltAvailable() {
    if (this.boltCooldown > 0 || this.game.race.time < TUNING.bolt.minRaceTime) return false;
    for (const k of this.karts) if (k.item === 'bolt') return false;
    return true;
  }

  _cometAvailable() {
    if (this._cometEntity) return false;
    for (const k of this.karts) if (k.item === 'comet') return false;
    return true;
  }

  _endItem(kart, ks) {
    kart.item = null;
    kart.itemCount = 0;
    if (ks) ks.aiming = false;
  }

  /** Spend one use: decrement, drop one shield entity, clear the slot at zero. */
  _consumeOne(kart, ks) {
    kart.itemCount = Math.max(0, kart.itemCount - 1);
    if (ks.trail.length) {
      const e = ks.trail[ks.trail.length - 1];
      this._releaseEntity(e);
    }
    if (kart.itemCount <= 0) {
      this._clearTrail(ks);
      this._endItem(kart, ks);
    } else if (ks.trail.length && ks.trail[0].mode === 'orbit') {
      this._respaceOrbit(ks);
    }
  }

  // ---------------------------------------------------------------------------------------------- instant items
  _useInstant(kart, ks, def) {
    const B = TUNING.boosts;
    switch (def.id) {
      case 'nitro':
      case 'nitro3':
        kart.applyBoost(B.nitro, B.nitroPower, 'nitro');
        break;
      case 'star':
        kart.startStar(B.star);
        break;
      case 'bolt':
        this._bolt(kart);
        break;
      case 'comet':
        this._launchComet(kart);
        break;
      default:
        break;
    }
    this.game.events.emit(EVT.ITEM_USE, { kart, item: def.id });
    this._consumeOne(kart, ks);
  }

  _bolt(owner) {
    const B = TUNING.bolt;
    this.boltCooldown = B.cooldown;
    this.game.events.emit(EVT.ITEM_LIGHTNING, { owner });
    const n = this.karts.length;
    for (const kart of this.karts) {
      if (kart === owner || kart.finished) continue;
      if (kart.starTime > 0 || kart.respawnTime > 0) continue; // star / rescue drone: immune
      const place = kart.place || 1;
      const d = n > 1 ? B.shrinkFirst + (B.shrinkLast - B.shrinkFirst) * ((place - 1) / (n - 1)) : B.shrinkFirst;
      const ok = kart.applyHit('spin', owner);
      kart.startShrink(d);
      this._stripItems(kart);
      if (ok) this.game.events.emit(EVT.ITEM_HIT, { kart, item: 'bolt', owner, position: kart.position.clone() });
    }
  }

  /** Remove a kart's held / shield items (bolt, big hits). Keeps a running roulette. */
  _stripItems(kart) {
    const ks = this._state(kart);
    this._clearTrail(ks);
    ks.aiming = false;
    if (kart.item && kart.item !== 'goldnitro') {
      kart.item = null;
      kart.itemCount = 0;
    }
  }

  _onKartHit({ kart }) {
    const ks = this._states.get(kart);
    if (!ks) return;
    if (ks.trail.length || ks.aiming) {
      // getting hit destroys the deployed shield (and with it the item)
      const had = ks.trail.length > 0;
      this._clearTrail(ks);
      ks.aiming = false;
      if (had && kart.item && ITEMS[kart.item]?.holdable) {
        kart.item = null;
        kart.itemCount = 0;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- holding / throwing
  _backPoint(kart, dist, out) {
    return out.set(kart.position.x - kart.forward.x * dist, kart.position.y, kart.position.z - kart.forward.z * dist);
  }

  _makeHeld(kart, ks, type, mode, dist) {
    const e = this._alloc(type, mode);
    if (!e) return null;
    e.owner = kart;
    e.ks = ks;
    e.radius = type === 'banana' ? 0.55 : type === 'bomb' ? TUNING.bomb.radius : TUNING.orb.radius;
    this._backPoint(kart, dist, e.position);
    e.yaw = kart.yaw;
    ks.trail.push(e);
    return e;
  }

  _deploySingle(kart, ks, def) {
    const type = HELD_TYPE[def.id];
    if (!type) return;
    this._makeHeld(kart, ks, type, 'trail', kart.radius + TUNING.trail.single);
  }

  _deployTriple(kart, ks, def) {
    const type = HELD_TYPE[def.id];
    if (!type) return;
    this._clearTrail(ks);
    const n = Math.min(3, Math.max(0, kart.itemCount));
    const orbit = ORBIT_ITEMS.has(def.id);
    for (let i = 0; i < n; i++) {
      const e = this._makeHeld(kart, ks, type, orbit ? 'orbit' : 'trail', kart.radius + TUNING.trail.single + i * TUNING.trail.chain);
      if (!e) break;
    }
    if (orbit) this._respaceOrbit(ks);
  }

  _respaceOrbit(ks) {
    const n = ks.trail.length;
    for (let i = 0; i < n; i++) ks.trail[i].slotOrbit = (i / n) * TAU;
  }

  _clearTrail(ks) {
    const list = ks.trail;
    for (let i = list.length - 1; i >= 0; i--) this._releaseEntity(list[i]);
    list.length = 0;
  }

  /** Free a held entity right away (it is in no live list). */
  _releaseEntity(e) {
    if (!e.active) return;
    if (e.ks) {
      const i = e.ks.trail.indexOf(e);
      if (i >= 0) e.ks.trail.splice(i, 1);
      e.ks = null;
    }
    e.active = false;
    e.dead = false;
    e.owner = e.target = null;
    this._free.push(e.index);
  }

  _throwHeld(kart, ks, def) {
    const back = !!kart.input.aimBack;
    let direction = 'forward';
    const src = ks.trail.length ? ks.trail[ks.trail.length - 1] : null;
    switch (def.id) {
      case 'banana':
      case 'banana3':
        direction = 'back';
        this._dropBanana(kart, src);
        break;
      case 'bouncer':
      case 'bouncer3':
        direction = back ? 'back' : 'forward';
        this._fireOrb(kart, 'bouncer', back, src);
        break;
      case 'seeker':
      case 'seeker3':
        direction = back ? 'back' : 'forward';
        this._fireOrb(kart, 'seeker', back, src);
        break;
      case 'bomb':
        direction = back ? 'back' : 'forward';
        this._fireBomb(kart, back, src);
        break;
      default:
        break;
    }
    this.game.events.emit(EVT.ITEM_USE, { kart, item: def.id });
    this.game.events.emit(EVT.ITEM_THROW, { kart, item: def.id, direction });
    this._consumeOne(kart, ks);
  }

  _dropBanana(kart, src) {
    const T = TUNING.banana;
    // cap: remove the oldest banana
    let count = 0, oldest = null;
    for (let i = 0; i < this.hazards.length; i++) {
      const h = this.hazards[i];
      if (h.type !== 'banana' || h.dead) continue;
      count++;
      if (!oldest || h.age > oldest.age) oldest = h;
    }
    if (count >= T.max && oldest) this.kill(oldest);
    const e = this._alloc('banana', 'hazard');
    if (!e) return;
    if (src) e.position.copy(src.position);
    else this._backPoint(kart, kart.radius + T.dropBehind - 0.6, e.position);
    this._snapToGround(e, 0.02);
    e.radius = T.radius;
    e.owner = kart;
    e.yaw = this.rng() * TAU;
    e.grace = 0.45;
    e.life = T.life;
    this._addTo(e, 'hazards');
    this._fx('dust', e.position, 3, 0.45, [0.85, 0.82, 0.7]);
  }

  _fireOrb(kart, type, back, src) {
    const O = TUNING.orb, S = TUNING.seeker;
    const e = this._alloc(type, 'fly');
    if (!e) return;
    const sgn = back ? -1 : 1;
    e.dir.set(kart.forward.x * sgn, 0, kart.forward.z * sgn);
    const l = Math.hypot(e.dir.x, e.dir.z) || 1;
    e.dir.x /= l;
    e.dir.z /= l;
    const lead = kart.radius + (back ? 1.3 : 1.1);
    e.position.set(kart.position.x + e.dir.x * lead, kart.position.y, kart.position.z + e.dir.z * lead);
    if (back && src) e.position.copy(src.position);
    e.hint = kart.trackIndex ?? -1;
    this._snapToGround(e, O.hover);
    const base = Math.max(kart.topSpeed || 30, O.minTop);
    e.speed = Math.max((type === 'seeker' ? S.speedMul : O.speedMul) * base, Math.abs(kart.speed || 0) + 14);
    e.radius = O.radius;
    e.owner = kart;
    e.grace = O.ownerGrace;
    e.life = type === 'seeker' ? S.life : O.life;
    e.yaw = Math.atan2(e.dir.x, e.dir.z);
    if (type === 'seeker' && !back) {
      e.target = this._seekerTarget(kart);
      e.mode = 'seek';
    }
    this._addTo(e, 'projectiles');
  }

  _seekerTarget(kart) {
    const race = this.game.race;
    let t = race.getKartAhead(kart);
    if (t && t.finished) t = null;
    if (t) return t;
    // leading (or the kart ahead is done): auto-lock onto the nearest kart in front within range
    const S = TUNING.seeker;
    let best = null, bestD = S.acquireRange;
    for (const k of this.karts) {
      if (k === kart || k.finished) continue;
      const dx = k.position.x - kart.position.x, dz = k.position.z - kart.position.z;
      const fwd = dx * kart.forward.x + dz * kart.forward.z;
      if (fwd < 2) continue;
      const d = Math.hypot(dx, dz);
      if (d < bestD && fwd / d > 0.8) {
        best = k;
        bestD = d;
      }
    }
    return best;
  }

  _fireBomb(kart, back, src) {
    const B = TUNING.bomb;
    const e = this._alloc('bomb', 'arc');
    if (!e) return;
    const sgn = back ? -1 : 1;
    e.dir.set(kart.forward.x * sgn, 0, kart.forward.z * sgn);
    const l = Math.hypot(e.dir.x, e.dir.z) || 1;
    e.dir.x /= l;
    e.dir.z /= l;
    if (back) {
      if (src) e.position.copy(src.position);
      else this._backPoint(kart, kart.radius + 1.2, e.position);
      e.position.y += 0.4;
      const v = Math.max(0, kart.speed || 0) * B.rollBack;
      e.velocity.set(kart.forward.x * v, 0, kart.forward.z * v);
      e.vy = 3;
    } else {
      const lead = kart.radius + 0.8;
      e.position.set(kart.position.x + e.dir.x * lead, kart.position.y + 0.9, kart.position.z + e.dir.z * lead);
      const v = Math.max(0, kart.speed || 0) + B.throwAhead;
      e.velocity.set(e.dir.x * v, 0, e.dir.z * v);
      e.vy = B.throwUp;
    }
    e.hint = kart.trackIndex ?? -1;
    e.radius = B.radius;
    e.owner = kart;
    e.grace = 99; // the owner is safe until the bomb has landed (+ ownerGrace)
    e.life = 6;
    e.airborne = true;
    e.yaw = Math.atan2(e.dir.x, e.dir.z);
    e.spin = 0;
    this._addTo(e, 'projectiles');
  }

  // ---------------------------------------------------------------------------------------------- held item visuals
  _updateTrails(dt) {
    const T = TUNING.trail;
    for (let si = 0; si < this._stateList.length; si++) {
      const ks = this._stateList[si];
      const list = ks.trail;
      const n = list.length;
      if (!n) continue;
      const k = ks.kart;
      if (list[0].mode === 'orbit') {
        ks.orbit = (ks.orbit + T.orbitSpeed * dt) % TAU;
        for (let i = 0; i < n; i++) {
          const e = list[i];
          const a = ks.orbit + e.slotOrbit;
          e.position.set(
            k.position.x + Math.cos(a) * T.orbitRadius,
            k.position.y + 0.75 + Math.sin(a * 2 + this.time * 3) * 0.08,
            k.position.z + Math.sin(a) * T.orbitRadius
          );
          e.spin += dt * 7;
          e.yaw = a + Math.PI / 2;
          e.groundY = k.position.y - 0.05;
        }
      } else {
        // tractrix chain: each item stays a fixed distance from the thing in front of it
        let ax = k.position.x - k.forward.x * (k.radius * 0.7);
        let az = k.position.z - k.forward.z * (k.radius * 0.7);
        for (let i = 0; i < n; i++) {
          const e = list[i];
          const len = i === 0 ? k.radius * 0.3 + T.single + 0.2 : T.chain;
          let dx = e.position.x - ax, dz = e.position.z - az;
          let d = Math.hypot(dx, dz);
          if (d < 1e-3) {
            dx = -k.forward.x;
            dz = -k.forward.z;
            d = 1;
          }
          const tx = ax + (dx / d) * len, tz = az + (dz / d) * len;
          const f = 1 - Math.exp(-40 * dt);
          e.position.x += (tx - e.position.x) * f;
          e.position.z += (tz - e.position.z) * f;
          e.position.y += (k.position.y + (e.type === 'banana' ? 0.03 : e.radius + 0.06) - e.position.y) * (1 - Math.exp(-25 * dt));
          e.yaw = Math.atan2(ax - e.position.x, az - e.position.z);
          e.spin += dt * 5;
          e.groundY = k.position.y - 0.05;
          ax = e.position.x;
          az = e.position.z;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- world simulation
  _updateProjectiles(dt) {
    const list = this.projectiles;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.dead) continue;
      switch (e.type) {
        case 'bouncer':
        case 'seeker':
          this._stepOrb(e, dt);
          break;
        case 'bomb':
          this._stepBomb(e, dt);
          break;
        case 'comet':
          this._stepComet(e, dt);
          break;
        default:
          break;
      }
    }
  }

  _updateHazards(dt) {
    const list = this.hazards;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.dead) continue;
      h.age += dt;
      if (h.grace > 0) h.grace -= dt;
      if (h.type === 'bomb') this._stepSittingBomb(h, dt);
      else if (h.type === 'banana') {
        if (h.age > h.life) {
          this.kill(h);
          continue;
        }
        this._bananaVsKarts(h);
      }
    }
  }

  _bananaVsKarts(h) {
    const T = TUNING.banana;
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      if (k.finished || k.respawnTime > 0) continue;
      if (k === h.owner && h.grace > 0) continue;
      const dx = k.position.x - h.position.x, dz = k.position.z - h.position.z;
      const reach = h.radius + k.radius * T.hitPad;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (k.position.y - h.position.y > 1.5 || h.position.y - k.position.y > 2.5) continue;
      if (k.starTime > 0) {
        this._destroy(h, true);
        return;
      }
      if (k.isImmune) continue;
      if (k.applyHit('spin', h.owner)) {
        this.game.events.emit(EVT.ITEM_HIT, { kart: k, item: 'banana', owner: h.owner, position: h.position.clone() });
        this.kill(h);
        return;
      }
    }
  }

  // ---- orbs -----------------------------------------------------------------------------------------
  _stepOrb(e, dt) {
    const O = TUNING.orb, S = TUNING.seeker;
    e.age += dt;
    if (e.grace > 0) e.grace -= dt;
    if (e.age >= e.life) {
      this._destroy(e, true);
      return;
    }
    if (e.mode === 'seek') this._updateSeekAim(e);
    const n = Math.min(12, Math.max(1, Math.ceil((e.speed * dt) / 0.7)));
    const h = dt / n;
    for (let k = 0; k < n && !e.dead; k++) {
      if (e.mode === 'seek') this._turnToward(e, e.aimX, e.aimZ, S.turnRate * h);
      e.position.x += e.dir.x * e.speed * h;
      e.position.z += e.dir.z * e.speed * h;
      e.yaw = Math.atan2(e.dir.x, e.dir.z);
      if (!this._groundStep(e, h, O.hover)) return; // fell into a void / killed
      this._wallBounce(e, O.maxBounces);
      if (e.dead) return;
      if (this._orbHits(e)) return;
    }
    e.velocity.set(e.dir.x * e.speed, 0, e.dir.z * e.speed);
    e.spin += dt * 9;
  }

  /** Aim point for a seeker: follow the course toward the target, then home in directly. */
  _updateSeekAim(e) {
    const S = TUNING.seeker;
    let t = e.target;
    if (t && (t.finished || t.respawnTime > 0)) t = e.target = null;
    if (!t) {
      // lost the target: continue straight like a bouncer
      e.aimX = e.position.x + e.dir.x * 20;
      e.aimZ = e.position.z + e.dir.z * 20;
      return;
    }
    const dx = t.position.x - e.position.x, dz = t.position.z - e.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < S.homingRange) {
      // predictive direct homing
      const lead = clamp(dist / Math.max(e.speed, 1), 0, 0.5);
      e.aimX = t.position.x + t.velocity.x * lead;
      e.aimZ = t.position.z + t.velocity.z * lead;
      return;
    }
    // follow the course: look ahead along the track toward the target's lateral position
    const track = this.track;
    const s = e.sample.s ?? t.trackS;
    const ds = track.deltaS(s, t.trackS);
    const dirSign = ds >= 0 ? 1 : -1;
    const look = Math.min(S.lookAhead, Math.abs(ds));
    const f = track.getFrameAt(s + dirSign * Math.max(look, 6), _frame);
    const hw = (f.halfWidth ?? 8) - 1.5;
    const lat = clamp(t.lateral ?? 0, -hw, hw);
    e.aimX = f.position.x + f.right.x * lat;
    e.aimZ = f.position.z + f.right.z * lat;
  }

  _turnToward(e, ax, az, maxTurn) {
    const dx = ax - e.position.x, dz = az - e.position.z;
    if (dx * dx + dz * dz < 1e-6) return;
    const want = Math.atan2(dx, dz);
    const cur = Math.atan2(e.dir.x, e.dir.z);
    const d = clamp(angleDiff(cur, want), -maxTurn, maxTurn);
    e.dir.x = Math.sin(cur + d);
    e.dir.z = Math.cos(cur + d);
  }

  /**
   * Keep an entity on the ground (query height), go ballistic over gaps, die in voids.
   * @returns {boolean} false when the entity was destroyed
   */
  _groundStep(e, h, hover) {
    const track = this.track;
    const s = track.query(e.position, e.hint, e.sample);
    e.hint = s.index;
    const gy = (s.height ?? 0) + hover;
    e.groundY = s.height ?? 0;
    e.s = s.s;
    e.lateral = s.lateral;
    // an orb that has wandered far off the course (open edges) is of no use to anyone: let it fizzle
    if (e.type !== 'bomb' && Math.abs(s.lateral) > (s.halfWidth ?? 10) + 34) {
      this._destroy(e, true);
      return false;
    }
    if (s.surface === 'void' || e.position.y < (track.killY ?? -1e9)) {
      this._destroy(e, true);
      return false;
    }
    if (e.airborne) {
      e.vy -= GRAVITY * h;
      e.position.y += e.vy * h;
      if (e.position.y <= gy) {
        e.position.y = gy;
        if (e.type === 'bomb' && Math.abs(e.vy) > 5) {
          e.vy = -e.vy * 0.28;
          e.velocity.x *= 0.7;
          e.velocity.z *= 0.7;
        } else {
          e.vy = 0;
          e.airborne = false;
        }
      }
    } else if (gy < e.position.y - 0.9) {
      e.airborne = true; // rolled off a ledge / into a jump gap
      e.vy = 0;
    } else {
      e.position.y += (gy - e.position.y) * Math.min(1, h * 24);
    }
    return true;
  }

  /** Reflect off the track walls and static colliders. */
  _wallBounce(e, maxBounces) {
    const s = e.sample;
    const r = e.radius;
    let bounced = false;
    if (s.right && s.lateral != null) {
      let nx = 0, nz = 0, pen = 0;
      if (s.wallRight != null && s.lateral + r > s.wallRight) {
        nx = -s.right.x;
        nz = -s.right.z;
        pen = s.lateral + r - s.wallRight;
      } else if (s.wallLeft != null && s.lateral - r < s.wallLeft) {
        nx = s.right.x;
        nz = s.right.z;
        pen = s.wallLeft - (s.lateral - r);
      }
      if (pen > 0) {
        const l = Math.hypot(nx, nz) || 1;
        nx /= l;
        nz /= l;
        e.position.x += nx * pen;
        e.position.z += nz * pen;
        this._reflect(e, nx, nz);
        bounced = true;
      }
    }
    const grid = this.grid;
    if (grid && grid.count) {
      const c = grid.collect(e.position.x, e.position.z, _near);
      for (let i = 0; i < c; i++) {
        const col = _near[i];
        const dx = e.position.x - col.x, dz = e.position.z - col.z;
        const md = col.radius + r;
        const d2 = dx * dx + dz * dz;
        if (d2 < md * md && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const nx = dx / d, nz = dz / d;
          e.position.x = col.x + nx * md;
          e.position.z = col.z + nz * md;
          this._reflect(e, nx, nz);
          bounced = true;
        }
      }
    }
    if (bounced) {
      e.bounces++;
      this._fx('sparks', e.position, 5, 0.55, FX_COLOR[e.type] ?? FX_COLOR.white);
      if (e.bounces > maxBounces) this._destroy(e, true);
    }
    return bounced;
  }

  _reflect(e, nx, nz) {
    if (e.type === 'bomb') {
      const dot = e.velocity.x * nx + e.velocity.z * nz;
      if (dot < 0) {
        e.velocity.x -= 1.6 * dot * nx;
        e.velocity.z -= 1.6 * dot * nz;
      }
      return;
    }
    const dot = e.dir.x * nx + e.dir.z * nz;
    if (dot < 0) {
      e.dir.x -= 2 * dot * nx;
      e.dir.z -= 2 * dot * nz;
      const l = Math.hypot(e.dir.x, e.dir.z) || 1;
      e.dir.x /= l;
      e.dir.z /= l;
    }
  }

  /** Orb vs shield items, karts, bananas, other projectiles. Returns true if the orb was consumed. */
  _orbHits(e) {
    const O = TUNING.orb;
    const pos = e.position;
    // ---- shield items of every kart (blocks hits from behind) ----
    for (let si = 0; si < this._stateList.length; si++) {
      const ks = this._stateList[si];
      const list = ks.trail;
      if (!list.length) continue;
      if (ks.kart === e.owner && e.grace > 0) continue;
      if (ks.kart.finished) continue;
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        const dx = t.position.x - pos.x, dz = t.position.z - pos.z, dy = t.position.y - pos.y;
        const reach = e.radius + t.radius + 0.2;
        if (dx * dx + dz * dz + dy * dy < reach * reach) {
          // only blocks when the orb comes from behind the kart
          const k = ks.kart;
          const bx = pos.x - k.position.x, bz = pos.z - k.position.z;
          if (bx * k.forward.x + bz * k.forward.z < TUNING.trail.blockCone || t.mode === 'orbit') {
            this._block(ks, t, e);
            return true;
          }
        }
      }
    }
    // ---- karts ----
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      if (k.finished || k.respawnTime > 0) continue;
      if (k === e.owner && e.grace > 0) continue;
      const dx = k.position.x - pos.x, dz = k.position.z - pos.z;
      const reach = e.radius + k.radius * O.hitPad;
      if (dx * dx + dz * dz > reach * reach) continue;
      const dy = k.position.y + 0.55 - pos.y;
      if (dy > 1.6 || dy < -1.6) continue;
      if (k.starTime > 0) {
        this._destroy(e, true);
        return true;
      }
      if (k.isImmune) continue; // recently hit — the orb flies through
      // a shield that the orb slipped past (gaps in an orbiting ring, the wide kart body next to a narrow banana):
      // anything arriving from behind — or at all, for an orbiting triple — is still absorbed
      const ks = this._states.get(k);
      if (ks && ks.trail.length) {
        const bx = pos.x - k.position.x, bz = pos.z - k.position.z;
        if (ks.trail[0].mode === 'orbit' || bx * k.forward.x + bz * k.forward.z < TUNING.trail.blockCone) {
          let best = ks.trail[0], bestD = Infinity;
          for (let j = 0; j < ks.trail.length; j++) {
            const t = ks.trail[j];
            const d = (t.position.x - pos.x) ** 2 + (t.position.z - pos.z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = t;
            }
          }
          this._block(ks, best, e);
          return true;
        }
      }
      if (k.applyHit('tumble', e.owner)) {
        this.game.events.emit(EVT.ITEM_HIT, { kart: k, item: e.type, owner: e.owner, position: pos.clone() });
        this.kill(e);
        return true;
      }
    }
    // ---- bananas / sitting bombs ----
    const hz = this.hazards;
    for (let i = 0; i < hz.length; i++) {
      const h = hz[i];
      if (h.dead) continue;
      const dx = h.position.x - pos.x, dz = h.position.z - pos.z, dy = h.position.y - pos.y;
      const reach = e.radius + h.radius * 0.75;
      if (dx * dx + dz * dz + dy * dy < reach * reach) {
        if (h.type === 'bomb') this._detonate(h);
        else this._destroy(h, true);
        this._destroy(e, true);
        return true;
      }
    }
    // ---- other projectiles ----
    const pj = this.projectiles;
    for (let i = 0; i < pj.length; i++) {
      const o = pj[i];
      if (o === e || o.dead || o.type === 'comet') continue;
      if (o.owner === e.owner && (o.grace > 0 || e.grace > 0) && o.type !== 'bomb') continue; // freshly fired salvo
      const dx = o.position.x - pos.x, dz = o.position.z - pos.z, dy = o.position.y - pos.y;
      const reach = e.radius + o.radius;
      if (dx * dx + dz * dz + dy * dy < reach * reach) {
        if (o.type === 'bomb') this._detonate(o);
        else this._destroy(o, true);
        this._destroy(e, true);
        return true;
      }
    }
    return false;
  }

  /** A shield item absorbs a projectile. */
  _block(ks, t, proj) {
    const kart = ks.kart;
    this.game.events.emit(EVT.ITEM_BLOCK, { kart, item: kart.item, position: t.position.clone() });
    this._fx('ring', t.position, 1, 0.8, FX_COLOR.white);
    this._fx('sparks', t.position, 12, 0.9, FX_COLOR.white);
    this._destroy(proj, true);
    this._releaseEntity(t);
    kart.itemCount = Math.max(0, kart.itemCount - 1);
    if (kart.itemCount <= 0) {
      this._clearTrail(ks);
      this._endItem(kart, ks);
    } else if (ks.trail.length && ks.trail[0].mode === 'orbit') this._respaceOrbit(ks);
  }

  // ---- bombs ----------------------------------------------------------------------------------------
  _stepBomb(e, dt) {
    const B = TUNING.bomb;
    e.age += dt;
    if (e.age > e.life) {
      this._detonate(e);
      return;
    }
    const n = Math.min(12, Math.max(1, Math.ceil((Math.hypot(e.velocity.x, e.velocity.z) * dt) / 0.7)));
    const h = dt / n;
    for (let k = 0; k < n && !e.dead; k++) {
      e.position.x += e.velocity.x * h;
      e.position.z += e.velocity.z * h;
      if (!this._groundStep(e, h, B.radius)) return;
      this._wallBounce(e, 99);
      if (e.dead) return;
      // contact with karts while flying / rolling
      if (this._bombContact(e)) return;
      if (!e.airborne) {
        // landed: become a hazard
        e.mode = 'sit';
        e.armed = true;
        e.fuse = B.fuse;
        e.grace = B.ownerGrace;
        e.velocity.x *= 0.5;
        e.velocity.z *= 0.5;
        this._moveList(e, 'hazards');
        return;
      }
    }
    e.spin += dt * 9;
  }

  _stepSittingBomb(h, dt) {
    const B = TUNING.bomb;
    // roll to a stop
    if (Math.abs(h.velocity.x) + Math.abs(h.velocity.z) > 0.05) {
      const damping = Math.exp(-5 * dt);
      h.velocity.x *= damping;
      h.velocity.z *= damping;
      h.position.x += h.velocity.x * dt;
      h.position.z += h.velocity.z * dt;
      const s = this.track.query(h.position, h.hint, h.sample);
      h.hint = s.index;
      h.groundY = s.height ?? 0;
      h.s = s.s;
      h.lateral = s.lateral;
      h.position.y = h.groundY + B.radius;
    }
    h.fuse -= dt;
    if (h.fuse <= 0) {
      this._detonate(h);
      return;
    }
    this._bombContact(h);
  }

  /** Bomb touching a kart (owner immune while its grace lasts). Detonates and returns true on contact. */
  _bombContact(e) {
    const B = TUNING.bomb;
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      if (k.finished || k.respawnTime > 0) continue;
      if (k === e.owner && e.grace > 0) continue;
      const dx = k.position.x - e.position.x, dz = k.position.z - e.position.z;
      const reach = B.contact + k.radius * 0.4;
      if (dx * dx + dz * dz > reach * reach) continue;
      const dy = k.position.y + 0.5 - e.position.y;
      if (dy > 1.8 || dy < -1.8) continue;
      this._detonate(e);
      return true;
    }
    return false;
  }

  _detonate(e) {
    if (e.dead) return;
    const B = TUNING.bomb;
    this.kill(e);
    this._explode(e.position.x, e.position.y, e.position.z, B.blast, 'bomb', e.owner, e);
  }

  /** Blast: hits karts in radius, wipes bananas/orbs, chains other bombs. */
  _explode(x, y, z, radius, item, owner, source) {
    this.game.events.emit(EVT.ITEM_EXPLODE, { position: new THREE.Vector3(x, y, z), radius, item });
    for (let i = 0; i < this.karts.length; i++) {
      const k = this.karts[i];
      if (k.finished) continue;
      const dx = k.position.x - x, dy = k.position.y + 0.5 - y, dz = k.position.z - z;
      const reach = radius + k.radius * 0.5;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      if (k.starTime > 0 || k.respawnTime > 0) continue;
      if (k.applyHit('explode', owner)) this.game.events.emit(EVT.ITEM_HIT, { kart: k, item, owner, position: new THREE.Vector3(x, y, z) });
    }
    const wipe = (list) => {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === source || o.dead || o.type === 'comet') continue;
        const dx = o.position.x - x, dy = o.position.y - y, dz = o.position.z - z;
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        if (o.type === 'bomb') o.fuse = Math.min(o.fuse || 0.2, 0.18); // chain reaction
        else this._destroy(o, true);
      }
    };
    wipe(this.hazards);
    wipe(this.projectiles);
    // bombs in flight cannot "fuse": detonate them right away
    for (let i = 0; i < this.projectiles.length; i++) {
      const o = this.projectiles[i];
      if (o !== source && !o.dead && o.type === 'bomb') {
        const dx = o.position.x - x, dy = o.position.y - y, dz = o.position.z - z;
        if (dx * dx + dy * dy + dz * dz <= radius * radius) this._detonate(o);
      }
    }
  }

  // ---- comet ----------------------------------------------------------------------------------------
  _cometTarget(owner) {
    const st = this.game.race.standings;
    for (let i = 0; i < st.length; i++) if (st[i] !== owner && !st[i].finished) return st[i];
    return null;
  }

  _launchComet(kart) {
    const C = TUNING.comet;
    const target = this._cometTarget(kart);
    if (!target) return;
    const e = this._alloc('comet', 'cruise');
    if (!e) return;
    e.owner = kart;
    e.target = target;
    e.radius = C.radius;
    e.life = C.life;
    e.s = kart.trackS;
    e.lat = kart.lateral ?? 0;
    e.position.set(kart.position.x, kart.position.y + 2.2, kart.position.z);
    e.dir.set(kart.forward.x, 0, kart.forward.z);
    e.yaw = kart.yaw;
    this._cometEntity = e;
    this._addTo(e, 'projectiles');
    this.game.events.emit(EVT.ITEM_COMET_WARN, { target });
  }

  _stepComet(e, dt) {
    const C = TUNING.comet;
    const track = this.track;
    e.age += dt;
    let tgt = this._cometTarget(e.owner);
    if (!tgt || e.age > e.life) {
      this._destroy(e, true);
      return;
    }
    if (tgt !== e.target) {
      e.target = tgt;
      this.game.events.emit(EVT.ITEM_COMET_WARN, { target: tgt });
    }
    const tp = tgt.position;
    const ds = track.deltaS(e.s, tgt.trackS);
    _v1.copy(e.position);
    if (e.mode === 'cruise') {
      const sgn = ds >= 0 ? 1 : -1;
      const step = C.cruise * dt;
      if (Math.abs(ds) <= step) e.s = tgt.trackS;
      else e.s = track.wrapS(e.s + sgn * step);
      e.lat = damp(e.lat, tgt.lateral ?? 0, 2.5, dt);
      const f = track.getFrameAt(e.s, _frame);
      const tx = f.position.x + f.right.x * e.lat;
      const tz = f.position.z + f.right.z * e.lat;
      const ty = f.position.y + C.height;
      e.position.x = damp(e.position.x, tx, 14, dt);
      e.position.y = damp(e.position.y, ty, 6, dt);
      e.position.z = damp(e.position.z, tz, 14, dt);
      if (Math.abs(ds) < C.diveDistance) e.mode = 'dive';
    } else {
      _v2.set(tp.x, tp.y + 0.6, tp.z).sub(e.position);
      const dist = _v2.length();
      const step = C.dive * dt;
      if (dist <= Math.max(step, 2.2)) {
        this.kill(e);
        this._cometEntity = null;
        this._explode(tp.x, tp.y, tp.z, C.blast, 'comet', e.owner, e);
        return;
      }
      _v2.multiplyScalar(1 / dist);
      e.position.addScaledVector(_v2, step);
      // clip karts that are near the dive path
      for (let i = 0; i < this.karts.length; i++) {
        const k = this.karts[i];
        if (k === tgt || k === e.owner || k.finished || k.isImmune) continue;
        const dx = k.position.x - e.position.x, dy = k.position.y + 0.5 - e.position.y, dz = k.position.z - e.position.z;
        if (dx * dx + dy * dy + dz * dz < C.clipRadius * C.clipRadius) {
          if (k.applyHit('tumble', e.owner)) this.game.events.emit(EVT.ITEM_HIT, { kart: k, item: 'comet', owner: e.owner, position: k.position.clone() });
        }
      }
    }
    // heading for the visual
    _v1.subVectors(e.position, _v1);
    const l = _v1.length();
    if (l > 1e-4) {
      e.velocity.copy(_v1).multiplyScalar(1 / dt);
      e.dir.set(_v1.x / l, _v1.y / l, _v1.z / l);
    }
  }

  /** Optional extra juice through the Visuals agent's Effects.burst (a no-op when Effects is absent / inactive). */
  _fx(type, pos, count, scale, color) {
    const fx = this.game.effects;
    if (!fx || !fx.burst) return;
    _fxPos.copy(pos);
    _fxOpts.count = count;
    _fxOpts.scale = scale;
    _fxOpts.color = color;
    fx.burst(type, _fxPos, _fxOpts);
  }

  // ==================================================================================================
  // entity pool / lists
  // ==================================================================================================
  _alloc(type, mode) {
    if (!this._free.length) return null;
    const e = this._pool[this._free.pop()];
    e.active = true;
    e.reset(type, mode);
    return e;
  }

  _addTo(e, list) {
    e.list = list;
    this[list].push(e);
  }

  /** Deferred list change (applied in _flush) so loops over the lists never see them mutate. */
  _moveList(e, list) {
    if (e.list === list || e.pendingList) return;
    e.pendingList = list;
    this._moving.push(e);
  }

  /** Deferred removal. */
  kill(e) {
    if (e.dead || !e.active) return;
    e.dead = true;
    this._dying.push(e);
    if (e === this._cometEntity) this._cometEntity = null;
  }

  /** Remove + announce (ITEM_DESTROY). */
  _destroy(e, announce) {
    if (e.dead || !e.active) return;
    if (announce) {
      this.game.events.emit(EVT.ITEM_DESTROY, { position: e.position.clone(), item: e.type });
      this._fx('sparks', e.position, e.type === 'comet' ? 16 : 9, e.type === 'banana' ? 0.6 : 0.85, FX_COLOR[e.type] ?? FX_COLOR.white);
    }
    this.kill(e);
  }

  _flush() {
    const m = this._moving;
    if (m.length) {
      for (let i = 0; i < m.length; i++) {
        const e = m[i];
        const to = e.pendingList;
        e.pendingList = null;
        if (!e.active || e.dead || !to) continue;
        if (e.list) {
          const arr = this[e.list];
          const j = arr.indexOf(e);
          if (j >= 0) arr.splice(j, 1);
        }
        this._addTo(e, to);
      }
      m.length = 0;
    }
    const d = this._dying;
    if (!d.length) return;
    for (let i = 0; i < d.length; i++) {
      const e = d[i];
      if (!e.active) continue;
      if (e.list) {
        const arr = this[e.list];
        const j = arr.indexOf(e);
        if (j >= 0) arr.splice(j, 1);
        e.list = null;
      }
      if (e.ks) {
        const j = e.ks.trail.indexOf(e);
        if (j >= 0) e.ks.trail.splice(j, 1);
        e.ks = null;
      }
      e.active = false;
      e.dead = false;
      e.owner = e.target = null;
      this._free.push(e.index);
    }
    d.length = 0;
  }

  _snapToGround(e, hover) {
    const s = this.track.query(e.position, e.hint, e.sample);
    e.hint = s.index;
    e.groundY = s.height ?? e.position.y;
    e.s = s.s;
    e.lateral = s.lateral;
    e.position.y = e.groundY + hover;
    e.airborne = false;
  }

  // ==================================================================================================
  // rendering (instances)
  // ==================================================================================================
  _render(dt) {
    const R = this.renderer;
    if (!R) return;
    R.begin();
    const t = this.time;
    let comet = null;
    this.boxField?.addHalos(R);
    const pool = this._pool;
    for (let i = 0; i < pool.length; i++) {
      const e = pool[i];
      if (!e.active || e.dead) continue;
      const trailing = e.mode === 'trail' || e.mode === 'orbit';
      switch (e.type) {
        case 'banana': {
          const scale = trailing ? 1 : Math.min(1, 0.4 + e.age * 8);
          R.addBanana(e.position, e.yaw, scale);
          break;
        }
        case 'bouncer':
        case 'seeker': {
          _q1.setFromAxisAngle(Y_AXIS, e.yaw);
          _q2.setFromAxisAngle(Z_AXIS, e.spin);
          _q1.multiply(_q2);
          const kind = e.type === 'bouncer' ? 0 : 1;
          R.addOrb(kind, e.position, _q1, trailing ? 1 : 1.18); // a flying orb is drawn a touch bigger than its hit radius so it reads at speed
          const gs = trailing ? 0.85 : 1.15;
          if (kind === 0) R.addGlow(e.position, 0.28, 1.05, 0.4, gs, e.groundY);
          else R.addGlow(e.position, 1.15, 0.24, 0.24, gs, e.groundY);
          if (!trailing) {
            // short glowing streak behind a flying orb
            for (let j = 1; j <= 3; j++) {
              _v1.set(e.position.x - e.dir.x * j * 0.95, e.position.y, e.position.z - e.dir.z * j * 0.95);
              const f = 0.6 / j;
              if (kind === 0) R.addGlow(_v1, 0.2 * f, 0.9 * f, 0.3 * f, 0.85 - j * 0.16, e.groundY);
              else R.addGlow(_v1, 0.95 * f, 0.2 * f, 0.2 * f, 0.85 - j * 0.16, e.groundY);
            }
          }
          if (kind === 1 && e.mode === 'seek' && e.target) {
            // lock-on beacon over the hunted kart
            const p = 0.65 + 0.35 * Math.sin(t * 14);
            _v1.set(e.target.position.x, e.target.position.y + 2.4, e.target.position.z);
            R.addGlow(_v1, 2.4 * p, 0.25 * p, 0.2 * p, 0.55 + 0.1 * p);
          }
          break;
        }
        case 'bomb': {
          if (e.mode === 'arc') {
            _q1.setFromAxisAngle(Y_AXIS, e.yaw);
            _q2.setFromAxisAngle(Z_AXIS, e.spin * 0.5);
            _q1.multiply(_q2);
          } else if (trailing) {
            _q1.setFromAxisAngle(Y_AXIS, e.yaw + 0.3);
          } else {
            _q1.setFromAxisAngle(Y_AXIS, e.yaw);
          }
          const sc = trailing ? 1 : 1.1;
          R.addBomb(e.position, _q1, sc);
          R.bombFuseWorld(e.position, _q1, sc, _v1);
          const fl = 0.7 + 0.3 * Math.sin(t * 46 + e.index * 3.1);
          R.addGlow(_v1, 3.4 * fl, 1.7 * fl, 0.45 * fl, 0.3 + 0.07 * fl);
          e.fxT -= dt;
          if (e.fxT <= 0 && e.mode !== 'arc') {
            e.fxT = 0.075 + Math.random() * 0.06;
            this._fx('sparks', _v1, 2, 0.32, FX_COLOR.bomb);
            if (Math.random() < 0.35) this._fx('smoke', _v1, 1, 0.3, [0.25, 0.25, 0.28]);
          }
          if (e.mode === 'sit' && e.fuse < 1.4) {
            const rate = 9 + (1.4 - e.fuse) * 22;
            const p = 0.5 + 0.5 * Math.sin(e.age * rate);
            R.addGlow(e.position, 2.6 * p, 0.14 * p, 0.05 * p, 1.35, e.groundY);
          }
          break;
        }
        case 'comet':
          comet = e;
          break;
        default:
          break;
      }
    }
    if (comet) {
      // flare around the comet + a pulsing beacon over the kart it is hunting
      R.addGlow(comet.position, 0.3, 0.62, 1.7, 2.7);
      const tg = comet.target;
      if (tg) {
        const p = 0.6 + 0.4 * Math.sin(t * 12);
        _v1.set(tg.position.x, tg.position.y + 3.2, tg.position.z);
        R.addGlow(_v1, 3.2 * p, 0.35 * p, 0.25 * p, 1.05 + 0.15 * p);
      }
    }
    R.end();
    if (comet) this.comet.place(comet.position, comet.dir, dt);
    else this.comet?.hide();
  }
}
