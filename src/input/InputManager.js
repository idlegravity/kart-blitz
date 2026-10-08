/**
 * InputManager — keyboard + Gamepad API (standard mapping), merged. OWNER: Driving agent.
 * Contract (ARCHITECTURE.md §6.3):
 *   update(dt)                — called first every frame (Game)
 *   throttle, brake, steer, drift, item, lookBack, aimBack   — current driving state (steer -1..1, + = right)
 *   pressed(action)           — true on the frame the action went down. Presses that happen BETWEEN frames are
 *                               latched (keydown+keyup inside one frame still counts) and delivered once.
 *   actions: 'drift','item','lookBack','pause','confirm','back','up','down','left','right'
 *   lastDevice: 'keyboard' | 'gamepad'
 * Extras: held(action), repeated(action) (edge + auto-repeat for menus), rumble(strong, weak, ms), dispose().
 *
 * Tap semantics: `drift` and `item` read true for the frame of a latched tap even if the key is already up again,
 * so a very quick hop tap or item tap still reaches kart.input (PlayerController copies these values).
 *
 * Keyboard: W/Up throttle, S/Down brake/reverse, A/D/Left/Right steer, Space/Shift drift, E/K/Ctrl item,
 *           Q/C look back, Esc/P pause, Enter/Space confirm, Esc/Backspace back.
 * Gamepad:  stick / d-pad steer, A throttle, B or LT brake, RB/RT drift, LB/X item, Y look back, Start pause,
 *           A confirm, B back; d-pad + left stick navigate menus.
 */
import { EVT } from '../core/events.js';
import { clamp } from '../core/math.js';
import { InputSource, ACTIONS, readOnePad, resetPadOut } from './InputSource.js';

/** Keyboard bindings by KeyboardEvent.code. */
export const KEY_BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyE', 'KeyK', 'ControlLeft', 'ControlRight'],
  lookBack: ['KeyQ', 'KeyC'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
  back: ['Escape', 'Backspace'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
};

/**
 * Split-screen keyboard halves (docs/SPLITSCREEN.md §3.2). Same action names as KEY_BINDINGS.
 * Menus: kb1 WASD + Space/E confirm + Q back; kb2 arrows + Enter or Slash confirm + Backspace back.
 */
export const KEY_BINDINGS_SPLIT = {
  kb1: {
    throttle: ['KeyW'],
    brake: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    drift: ['Space', 'ShiftLeft'],
    item: ['KeyE', 'ControlLeft'],
    lookBack: ['KeyQ'],
    confirm: ['Space', 'KeyE'],
    back: ['KeyQ'],
    up: ['KeyW'],
    down: ['KeyS'],
  },
  kb2: {
    throttle: ['ArrowUp'],
    brake: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    drift: ['ShiftRight', 'Period'],
    item: ['Slash', 'ControlRight', 'Enter'],
    lookBack: ['Comma'],
    confirm: ['Enter', 'Slash'],
    back: ['Backspace'],
    up: ['ArrowUp'],
    down: ['ArrowDown'],
  },
};
const SPLIT_LABELS = { kb1: 'Keyboard \u00b7 WASD', kb2: 'Keyboard \u00b7 Arrows' };
const PAD_IDS = ['pad0', 'pad1', 'pad2', 'pad3'];
const NAV = ['up', 'down', 'left', 'right'];

const CODE_TO_ACTIONS = new Map();
for (const [action, codes] of Object.entries(KEY_BINDINGS)) {
  for (const c of codes) {
    if (!CODE_TO_ACTIONS.has(c)) CODE_TO_ACTIONS.set(c, []);
    CODE_TO_ACTIONS.get(c).push(action);
  }
}
/** Every key code any keyboard half binds (so split-only keys such as Period/Slash/Comma are tracked too). */
const SPLIT_CODES = new Set();
for (const half of Object.values(KEY_BINDINGS_SPLIT)) for (const codes of Object.values(half)) for (const c of codes) SPLIT_CODES.add(c);

const isTextTarget = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const isButtonTarget = (t) => !!t && /^(BUTTON|A|SUMMARY)$/.test(t.tagName);

export class InputManager {
  /** @param {import('../Game.js').Game} game */
  constructor(game) {
    this.game = game;
    /** InputSource facade fields: the manager itself is the merged 'any' source. */
    this.id = 'any';
    this.label = 'Keyboard + Gamepad';
    this.connected = true;

    // ---- continuous driving state ----
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.drift = false;
    this.item = false;
    this.lookBack = false;
    this.aimBack = false;
    /** 'keyboard' | 'gamepad' — device that produced the most recent input. */
    this.lastDevice = 'keyboard';
    /** True when the current steering value comes from an analog stick (gets snappier smoothing in the kart). */
    this.steerAnalog = false;
    /** True while at least one gamepad is connected. */
    this.gamepadConnected = false;
    /** Mobile steering assist is on (touch controls live on a phone); PlayerController copies it to kart.input.assist. */
    this.steerAssist = false;
    /** On-screen touch controls (TouchControls) — created on touch devices only (docs/MOBILE.md); undefined on desktop. */
    this.touch = undefined;

    // ---- keyboard ----
    this.keys = new Set(); // held key codes
    this._latch = Object.create(null); // action -> went down since the last update()
    this._leftT = 0;
    this._rightT = 0;

    // ---- per-frame results ----
    this._held = Object.create(null);
    this._prevHeld = Object.create(null);
    this._pressed = Object.create(null);
    this._holdTime = Object.create(null);
    this._repeat = Object.create(null);
    for (const a of ACTIONS) {
      this._held[a] = false;
      this._prevHeld[a] = false;
      this._pressed[a] = false;
      this._holdTime[a] = 0;
      this._repeat[a] = false;
      this._latch[a] = false;
    }

    // ---- gamepad ----
    this._padSteer = 0;
    this._padNav = { up: false, down: false, left: false, right: false };
    this._padPrevAny = false;
    this._lastRumble = 0;

    // ---- per-device sources (kb1, kb2, pad0..3); 'any' is this manager ----
    this._downT = new Map(); // key code -> performance.now() of its last (non-repeat) keydown
    this._sources = new Map();
    for (const id of ['kb1', 'kb2']) this._sources.set(id, new InputSource({ id, label: SPLIT_LABELS[id], keys: KEY_BINDINGS_SPLIT[id], manager: this }));
    PAD_IDS.forEach((id, i) => this._sources.set(id, new InputSource({ id, label: `Gamepad ${i + 1}`, pad: i, manager: this })));
    this._padList = null;

    this._onKeyDown = (e) => this._keyDown(e);
    this._onKeyUp = (e) => this._keyUp(e);
    this._onBlur = () => this._clear();
    this._onVis = () => document.hidden && this._clear();
    this._onPadConnect = () => this._refreshPads();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('gamepadconnected', this._onPadConnect);
    window.addEventListener('gamepaddisconnected', this._onPadConnect);
    this._refreshPads();
    this._initTouch(game);

    // gamepad haptics for the player kart (no-op without a pad / actuator)
    this._offs = [];
    const ev = game?.events;
    if (ev) {
      // haptics go to the pad of the kart's own source ('any' = the merged manager, today's behaviour)
      const humans = () => game.players?.length ?? (game.player ? 1 : 0);
      const buzz = (kart, s, w, ms) => {
        if (!kart?.isPlayer && kart !== game.player) return;
        const src = kart.controller?.source ?? (humans() <= 1 && kart === game.player ? this : null);
        src?.rumble?.(s, w, ms);
      };
      this._offs.push(
        ev.on(EVT.KART_HIT, (p) => buzz(p?.kart, 1, 0.8, 380)),
        ev.on(EVT.KART_WALL, (p) => buzz(p?.kart, Math.min(1, (p.impact ?? 0) / 25), 0.4, 140)),
        ev.on(EVT.KART_LAND, (p) => (p.impact ?? 0) > 8 && buzz(p?.kart, Math.min(1, p.impact / 25), 0.2, 120)),
        ev.on(EVT.KART_BOOST, (p) => buzz(p?.kart, 0.35, 0.7, 180)),
        ev.on(EVT.KART_BUMP, (p) => { buzz(p?.a, 0.5, 0.3, 110); buzz(p?.b, 0.5, 0.3, 110); }),
        ev.on(EVT.KART_DRIFT_LEVEL, (p) => buzz(p?.kart, 0.0, 0.5, 70)),
        ev.on(EVT.KART_STALL, (p) => buzz(p?.kart, 0.6, 0.3, 300)),
      );
    }
  }

  /** Create the touch overlay on touch devices. Platform detection is imported lazily and failure-proof (Node tests). */
  _initTouch(game) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
    import('../core/platform.js')
      .then(async (m) => {
        const platform = game?.platform ?? m.PLATFORM;
        if (!platform?.touch || this._disposed) return;
        const { TouchControls } = await import('./TouchControls.js');
        if (this._disposed) return;
        this.touch = new TouchControls(game, this, platform);
      })
      .catch(() => {});
  }

  /** Remove all listeners. */
  dispose() {
    this._disposed = true;
    this.touch?.dispose();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('gamepadconnected', this._onPadConnect);
    window.removeEventListener('gamepaddisconnected', this._onPadConnect);
    for (const off of this._offs) off?.();
    this._offs.length = 0;
  }

  // ================================================================================================
  // keyboard events
  // ================================================================================================
  _keyDown(e) {
    // macOS swallows keyup for other keys while Cmd is held; drop everything so nothing can stick
    if (e.key === 'Meta') return this._clear();
    if (e.metaKey || e.altKey) return; // leave browser / OS shortcuts alone
    const code = e.code;
    const actions = CODE_TO_ACTIONS.get(code);
    if ((!actions && !SPLIT_CODES.has(code)) || isTextTarget(e.target)) return;
    if (this._shouldPrevent(e)) e.preventDefault();
    if (this.keys.has(code)) return; // auto-repeat
    this.keys.add(code);
    if (actions) for (const a of actions) this._latch[a] = true;
    this._downT.set(code, performance.now());
    for (const src of this._sources.values()) if (src.keys) src.keyDown(code);
    if (code === 'KeyA' || code === 'ArrowLeft') this._leftT = performance.now();
    if (code === 'KeyD' || code === 'ArrowRight') this._rightT = performance.now();
    this.lastDevice = 'keyboard';
  }

  _keyUp(e) {
    const code = e.code;
    if (!CODE_TO_ACTIONS.has(code) && !SPLIT_CODES.has(code)) return;
    // the held state ends now, but a latched press (down+up between two frames) is still delivered by update()
    this.keys.delete(code);
  }

  /** Suppress scrolling / focused-button clicks for game keys while racing, but never break DOM menus. */
  _shouldPrevent(e) {
    const g = this.game;
    const code = e.code;
    if (g?.state === 'race' && !g.paused) return code !== 'Enter' && code !== 'NumpadEnter';
    // menus / paused: only stop page scrolling & history-back; keep Space/Enter working on focused buttons
    if (code === 'Space') return !isButtonTarget(e.target);
    return code === 'Backspace' || code.startsWith('Arrow');
  }

  _clear() {
    this.keys.clear();
    for (const a of ACTIONS) this._latch[a] = false;
    this.throttle = this.brake = this.steer = 0;
    this.drift = this.item = this.lookBack = this.aimBack = false;
    for (const src of this._sources.values()) src.clear();
  }

  // ================================================================================================
  // gamepad
  // ================================================================================================
  _refreshPads() {
    let any = false;
    try {
      for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) any = true;
    } catch {}
    this.gamepadConnected = any;
  }

  _readPads(out) {
    resetPadOut(out);
    let pads = [];
    try {
      pads = navigator.getGamepads?.() ?? [];
    } catch {}
    this._padList = pads;
    let connected = false;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      connected = true;
      readOnePad(p, out, this._padNav);
    }
    this.gamepadConnected = connected;
    return out;
  }

  /** Vibrate the active gamepad (strong = low-frequency motor, weak = high-frequency), 0..1, milliseconds. */
  rumble(strong = 0.5, weak = 0.5, ms = 150) {
    if (this.lastDevice === 'touch') return this.touch?.rumble(strong, weak, ms);
    if (this.lastDevice !== 'gamepad' || !this.gamepadConnected || this.game?.settings?.rumble === false) return;
    const now = performance.now();
    if (now - this._lastRumble < 60) return;
    this._lastRumble = now;
    try {
      for (const p of navigator.getGamepads?.() ?? []) {
        p?.vibrationActuator?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) })?.catch?.(() => {});
      }
    } catch {}
  }

  // ================================================================================================
  // per-frame update
  // ================================================================================================
  /** Called first every frame. */
  update(dt = 0) {
    const pad = this._readPads(this._padOut ?? (this._padOut = {}));
    if (pad.any) this.lastDevice = 'gamepad';
    for (const src of this._sources.values()) src.update(dt, this.keys, this._padList, this._downT);
    const K = this.keys;
    const kb = (a) => {
      const codes = KEY_BINDINGS[a];
      for (let i = 0; i < codes.length; i++) if (K.has(codes[i])) return true;
      return false;
    };

    // on-screen touch controls (phones): merged exactly like another device
    const tp = this.touch ? this.touch.poll(dt) : null;
    const tOn = tp !== null && tp.active;

    // held state per action = keyboard || gamepad (|| touch)
    const held = this._held;
    for (const a of ACTIONS) held[a] = kb(a) || !!pad[a];
    if (tp) {
      if (tOn) {
        if (tp.drift) held.drift = true;
        if (tp.item) held.item = true;
        if (tp.lookBack) held.lookBack = true;
        if (tp.latchDrift) this._latch.drift = true;
        if (tp.latchItem) this._latch.item = true;
      }
      if (tp.latchConfirm) this._latch.confirm = true;
    }
    // analog values that have no pad boolean
    const padThrottle = pad.throttle, padBrake = pad.brake;
    held.throttle = held.throttle || padThrottle > 0.05;
    held.brake = held.brake || padBrake > 0.05;
    if (tOn) {
      held.throttle = held.throttle || tp.throttle > 0.05;
      held.brake = held.brake || tp.brake > 0.05;
    }

    // edges (+ presses latched between frames), then consume the latches
    for (const a of ACTIONS) {
      this._pressed[a] = (held[a] && !this._prevHeld[a]) || this._latch[a];
      this._latch[a] = false;
    }
    // held time + auto-repeat (menus)
    for (const a of ACTIONS) {
      if (held[a]) {
        const before = this._holdTime[a];
        this._holdTime[a] += dt;
        this._repeat[a] = this._pressed[a] || (this._holdTime[a] > 0.4 && Math.floor((this._holdTime[a] - 0.4) / 0.11) !== Math.floor((before - 0.4) / 0.11));
      } else {
        this._holdTime[a] = 0;
        this._repeat[a] = this._pressed[a];
      }
    }
    for (const a of ACTIONS) this._prevHeld[a] = held[a];
    for (const a of NAV) this._padNav[a] = pad[a];

    // ---- continuous driving values ----
    this.throttle = clamp(Math.max(kb('throttle') ? 1 : 0, padThrottle, tOn ? tp.throttle : 0), 0, 1);
    this.brake = clamp(Math.max(kb('brake') ? 1 : 0, padBrake, tOn ? tp.brake : 0), 0, 1);
    // keyboard steer: if both directions are held the most recent press wins
    let ks = 0;
    const l = K.has('KeyA') || K.has('ArrowLeft'), r = K.has('KeyD') || K.has('ArrowRight');
    if (l && r) ks = this._rightT >= this._leftT ? 1 : -1;
    else ks = (r ? 1 : 0) - (l ? 1 : 0);
    this._padSteer = pad.steer;
    let ps = pad.steer;
    // touch steering competes with the pad like a second analog stick (largest magnitude wins)
    if (tOn && Math.abs(tp.steer) > Math.abs(ps)) ps = tp.steer;
    const fromPad = Math.abs(ks) < Math.abs(ps);
    this.steer = clamp(fromPad ? ps : ks, -1, 1);
    this.steerAnalog = fromPad && Math.abs(ps) > 0 && Math.abs(ps) < 0.999 && (ps !== pad.steer ? tp.steerAnalog : true);
    this.steerAssist = tOn && tp.assist === true;
    // taps that landed between two frames still read as down for one frame
    this.drift = held.drift || this._pressed.drift;
    this.item = held.item || this._pressed.item;
    this.lookBack = held.lookBack;
    // throw items backward while braking or looking back
    this.aimBack = this.brake > 0.3 || this.lookBack;
  }

  // ================================================================================================
  // queries
  // ================================================================================================
  /** True only on the frame the action went down (latched: presses between frames are never lost). */
  pressed(action) {
    return this._pressed[action] === true;
  }

  /** True while the action is held. */
  held(action) {
    return this._held[action] === true;
  }

  /** The InputSource for a device id: 'any' (this merged manager), 'kb1', 'kb2', 'pad0'..'pad3'. Unknown ids -> 'any'. */
  getSource(id = 'any') {
    return id === 'any' ? this : this._sources.get(id) ?? this;
  }

  /** Device ids currently available: kb1, kb2 and every connected pad. */
  devices() {
    const out = ['kb1', 'kb2'];
    for (const id of PAD_IDS) if (this._sources.get(id).connected) out.push(id);
    return out;
  }

  /** Device ids (never 'any') whose `action` went down this frame. */
  pressedBy(action) {
    const out = [];
    for (const [id, src] of this._sources) if (src.pressed(action)) out.push(id);
    return out;
  }

  /** pressed(), plus auto-repeat while held (0.4 s delay, then every 0.11 s). Handy for menu navigation. */
  repeated(action) {
    return this._repeat[action] === true;
  }
}
