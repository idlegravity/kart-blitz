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

/** Standard-mapping gamepad buttons per action. */
const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const ACTIONS = ['throttle', 'brake', 'left', 'right', 'drift', 'item', 'lookBack', 'pause', 'confirm', 'back', 'up', 'down'];
const NAV = ['up', 'down', 'left', 'right'];

const DEADZONE = 0.15;
const CODE_TO_ACTIONS = new Map();
for (const [action, codes] of Object.entries(KEY_BINDINGS)) {
  for (const c of codes) {
    if (!CODE_TO_ACTIONS.has(c)) CODE_TO_ACTIONS.set(c, []);
    CODE_TO_ACTIONS.get(c).push(action);
  }
}

/** Radial dead zone + response curve for an analog axis pair, returns the shaped x. */
function shapeStick(x, y) {
  const mag = Math.hypot(x, y);
  if (mag <= DEADZONE) return 0;
  const scaled = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE));
  const nx = (x / mag) * scaled;
  // gentle expo: fine control near the center, full lock at the edge
  return Math.sign(nx) * Math.pow(Math.abs(nx), 1.35);
}

const isTextTarget = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const isButtonTarget = (t) => !!t && /^(BUTTON|A|SUMMARY)$/.test(t.tagName);

export class InputManager {
  /** @param {import('../Game.js').Game} game */
  constructor(game) {
    this.game = game;

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

    // gamepad haptics for the player kart (no-op without a pad / actuator)
    this._offs = [];
    const ev = game?.events;
    if (ev) {
      const mine = (p) => p?.kart && p.kart === game.player;
      this._offs.push(
        ev.on(EVT.KART_HIT, (p) => mine(p) && this.rumble(1, 0.8, 380)),
        ev.on(EVT.KART_WALL, (p) => mine(p) && this.rumble(Math.min(1, (p.impact ?? 0) / 25), 0.4, 140)),
        ev.on(EVT.KART_LAND, (p) => mine(p) && (p.impact ?? 0) > 8 && this.rumble(Math.min(1, p.impact / 25), 0.2, 120)),
        ev.on(EVT.KART_BOOST, (p) => mine(p) && this.rumble(0.35, 0.7, 180)),
        ev.on(EVT.KART_BUMP, (p) => (p.a === game.player || p.b === game.player) && this.rumble(0.5, 0.3, 110)),
        ev.on(EVT.KART_DRIFT_LEVEL, (p) => mine(p) && this.rumble(0.0, 0.5, 70)),
        ev.on(EVT.KART_STALL, (p) => mine(p) && this.rumble(0.6, 0.3, 300)),
      );
    }
  }

  /** Remove all listeners. */
  dispose() {
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
    if (!actions || isTextTarget(e.target)) return;
    if (this._shouldPrevent(e)) e.preventDefault();
    if (this.keys.has(code)) return; // auto-repeat
    this.keys.add(code);
    for (const a of actions) this._latch[a] = true;
    if (code === 'KeyA' || code === 'ArrowLeft') this._leftT = performance.now();
    if (code === 'KeyD' || code === 'ArrowRight') this._rightT = performance.now();
    this.lastDevice = 'keyboard';
  }

  _keyUp(e) {
    const code = e.code;
    if (!CODE_TO_ACTIONS.has(code)) return;
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
    out.steer = 0;
    out.throttle = 0;
    out.brake = 0;
    out.any = false;
    out.up = out.down = out.left = out.right = false;
    for (const a of ACTIONS) out[a] = false;
    let pads = [];
    try {
      pads = navigator.getGamepads?.() ?? [];
    } catch {}
    let connected = false;
    for (const p of pads) {
      if (!p || !p.connected) continue;
      connected = true;
      const b = p.buttons;
      const val = (i) => (b[i] ? (b[i].value > 0 ? b[i].value : b[i].pressed ? 1 : 0) : 0);
      const on = (i) => !!b[i] && (b[i].pressed || b[i].value > 0.5);
      const lx = p.axes[0] ?? 0, ly = p.axes[1] ?? 0;
      let steer = shapeStick(lx, ly);
      const dl = on(PAD.LEFT), dr = on(PAD.RIGHT);
      if (dl !== dr) steer = dr ? 1 : -1;
      if (Math.abs(steer) > Math.abs(out.steer)) out.steer = steer;
      out.throttle = Math.max(out.throttle, val(PAD.A));
      out.brake = Math.max(out.brake, val(PAD.B), val(PAD.LT));
      if (on(PAD.RB) || on(PAD.RT)) out.drift = true;
      if (on(PAD.LB) || on(PAD.X)) out.item = true;
      if (on(PAD.Y)) out.lookBack = true;
      if (on(PAD.START)) out.pause = true;
      if (on(PAD.A)) out.confirm = true;
      if (on(PAD.B)) out.back = true;
      // menu navigation: d-pad + stick with hysteresis
      const N = this._padNav;
      const th = (was) => (was ? 0.35 : 0.6);
      if (on(PAD.UP) || ly < -th(N.up)) out.up = true;
      if (on(PAD.DOWN) || ly > th(N.down)) out.down = true;
      if (dl || lx < -th(N.left)) out.left = true;
      if (dr || lx > th(N.right)) out.right = true;
      // any activity switches lastDevice to the gamepad
      for (let i = 0; i < b.length; i++) if (on(i)) out.any = true;
      if (Math.abs(steer) > 0.3 || Math.abs(ly) > 0.6) out.any = true;
    }
    this.gamepadConnected = connected;
    return out;
  }

  /** Vibrate the active gamepad (strong = low-frequency motor, weak = high-frequency), 0..1, milliseconds. */
  rumble(strong = 0.5, weak = 0.5, ms = 150) {
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
    const K = this.keys;
    const kb = (a) => {
      const codes = KEY_BINDINGS[a];
      for (let i = 0; i < codes.length; i++) if (K.has(codes[i])) return true;
      return false;
    };

    // held state per action = keyboard || gamepad
    const held = this._held;
    for (const a of ACTIONS) held[a] = kb(a) || !!pad[a];
    // analog values that have no pad boolean
    const padThrottle = pad.throttle, padBrake = pad.brake;
    held.throttle = held.throttle || padThrottle > 0.05;
    held.brake = held.brake || padBrake > 0.05;

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
    this.throttle = clamp(Math.max(kb('throttle') ? 1 : 0, padThrottle), 0, 1);
    this.brake = clamp(Math.max(kb('brake') ? 1 : 0, padBrake), 0, 1);
    // keyboard steer: if both directions are held the most recent press wins
    let ks = 0;
    const l = K.has('KeyA') || K.has('ArrowLeft'), r = K.has('KeyD') || K.has('ArrowRight');
    if (l && r) ks = this._rightT >= this._leftT ? 1 : -1;
    else ks = (r ? 1 : 0) - (l ? 1 : 0);
    this._padSteer = pad.steer;
    const fromPad = Math.abs(ks) < Math.abs(pad.steer);
    this.steer = clamp(fromPad ? pad.steer : ks, -1, 1);
    this.steerAnalog = fromPad && Math.abs(pad.steer) > 0 && Math.abs(pad.steer) < 0.999;
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

  /** pressed(), plus auto-repeat while held (0.4 s delay, then every 0.11 s). Handy for menu navigation. */
  repeated(action) {
    return this._repeat[action] === true;
  }
}
