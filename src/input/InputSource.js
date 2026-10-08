/**
 * InputSource — one input device (keyboard half or a single gamepad), driven by the InputManager.
 * OWNER: Driving agent. See docs/SPLITSCREEN.md §3.2.
 *
 *   id, label, connected
 *   throttle, brake, steer, steerAnalog, drift, item, lookBack, aimBack   (same semantics as InputManager)
 *   pressed(action), held(action), repeated(action)
 *   rumble(strong, weak, ms)                                             (pads only; no-op for keyboards)
 *
 * Presses that happen between two frames are latched per source (key down + up inside one frame still counts).
 */
import { clamp } from '../core/math.js';

export const ACTIONS = ['throttle', 'brake', 'left', 'right', 'drift', 'item', 'lookBack', 'pause', 'confirm', 'back', 'up', 'down'];
const NAV = ['up', 'down', 'left', 'right'];
const DEADZONE = 0.15;

/** Standard-mapping gamepad buttons. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** Radial dead zone + response curve for an analog axis pair, returns the shaped x. */
export function shapeStick(x, y) {
  const mag = Math.hypot(x, y);
  if (mag <= DEADZONE) return 0;
  const scaled = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE));
  const nx = (x / mag) * scaled;
  // gentle expo: fine control near the center, full lock at the edge
  return Math.sign(nx) * Math.pow(Math.abs(nx), 1.35);
}

/** Zero the pad read-out `out` (shared by the merged reader and per-pad sources). */
export function resetPadOut(out) {
  out.steer = 0;
  out.throttle = 0;
  out.brake = 0;
  out.any = false;
  for (const a of ACTIONS) out[a] = false;
  return out;
}

/** Merge one gamepad `p` into `out` (max semantics). `nav` = last nav booleans (hysteresis). */
export function readOnePad(p, out, nav) {
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
  const th = (was) => (was ? 0.35 : 0.6);
  if (on(PAD.UP) || ly < -th(nav.up)) out.up = true;
  if (on(PAD.DOWN) || ly > th(nav.down)) out.down = true;
  if (dl || lx < -th(nav.left)) out.left = true;
  if (dr || lx > th(nav.right)) out.right = true;
  for (let i = 0; i < b.length; i++) if (on(i)) out.any = true;
  if (Math.abs(steer) > 0.3 || Math.abs(ly) > 0.6) out.any = true;
}

export class InputSource {
  /**
   * @param {object} o
   * @param {string} o.id  'kb1' | 'kb2' | 'pad0'..
   * @param {string} o.label
   * @param {object|null} o.keys   action -> KeyboardEvent.code[] (keyboard halves)
   * @param {number} [o.pad]       Gamepad.index (pad sources)
   * @param {import('./InputManager.js').InputManager} o.manager
   */
  constructor({ id, label, keys = null, pad = -1, manager }) {
    this.id = id;
    this.label = label;
    this.keys = keys;
    this.padIndex = pad;
    this.manager = manager;
    this.isPad = pad >= 0;
    this.connected = !this.isPad;

    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.steerAnalog = false;
    this.drift = false;
    this.item = false;
    this.lookBack = false;
    this.aimBack = false;

    this._codeActions = new Map(); // code -> actions
    if (keys) {
      for (const [a, codes] of Object.entries(keys)) {
        for (const c of codes) {
          if (!this._codeActions.has(c)) this._codeActions.set(c, []);
          this._codeActions.get(c).push(a);
        }
      }
    }
    this._latch = Object.create(null);
    this._held = Object.create(null);
    this._prevHeld = Object.create(null);
    this._pressed = Object.create(null);
    this._holdTime = Object.create(null);
    this._repeat = Object.create(null);
    for (const a of ACTIONS) {
      this._latch[a] = this._held[a] = this._prevHeld[a] = this._pressed[a] = this._repeat[a] = false;
      this._holdTime[a] = 0;
    }
    this._nav = { up: false, down: false, left: false, right: false };
    this._padOut = {};
    this._lastRumble = -1e9;
  }

  /** True if this keyboard half binds the key. */
  handlesCode(code) {
    return this._codeActions.has(code);
  }

  /** Called by the manager on a (non-repeat) keydown of a bound key. */
  keyDown(code) {
    const acts = this._codeActions.get(code);
    if (acts) for (const a of acts) this._latch[a] = true;
  }

  /** Drop all held/latched state (window blur etc.). */
  clear() {
    for (const a of ACTIONS) this._latch[a] = false;
    this.throttle = this.brake = this.steer = 0;
    this.drift = this.item = this.lookBack = this.aimBack = false;
  }

  /** @param {Set<string>} K held key codes  @param {Gamepad[]|null} pads  @param {Map<string,number>} downT key-down times */
  update(dt, K, pads, downT) {
    const held = this._held;
    let pad = null;
    if (this.isPad) {
      const p = pads?.[this.padIndex];
      this.connected = !!(p && p.connected);
      pad = resetPadOut(this._padOut);
      if (this.connected) readOnePad(p, pad, this._nav);
    }
    const kb = (a) => {
      const codes = this.keys?.[a];
      if (!codes) return false;
      for (let i = 0; i < codes.length; i++) if (K.has(codes[i])) return true;
      return false;
    };
    for (const a of ACTIONS) held[a] = kb(a) || !!pad?.[a];
    const padThrottle = pad ? pad.throttle : 0, padBrake = pad ? pad.brake : 0;
    held.throttle = held.throttle || padThrottle > 0.05;
    held.brake = held.brake || padBrake > 0.05;

    for (const a of ACTIONS) {
      this._pressed[a] = (held[a] && !this._prevHeld[a]) || this._latch[a];
      this._latch[a] = false;
    }
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
    if (pad) for (const a of NAV) this._nav[a] = pad[a];

    this.throttle = clamp(Math.max(kb('throttle') ? 1 : 0, padThrottle), 0, 1);
    this.brake = clamp(Math.max(kb('brake') ? 1 : 0, padBrake), 0, 1);
    let ks = 0;
    if (this.keys) {
      const latest = (codes) => {
        let t = -1, any = false;
        for (const c of codes ?? []) if (K.has(c)) { any = true; t = Math.max(t, downT.get(c) ?? 0); }
        return { any, t };
      };
      const l = latest(this.keys.left), r = latest(this.keys.right);
      if (l.any && r.any) ks = r.t >= l.t ? 1 : -1;
      else ks = (r.any ? 1 : 0) - (l.any ? 1 : 0);
    }
    const ps = pad ? pad.steer : 0;
    const fromPad = Math.abs(ks) < Math.abs(ps);
    this.steer = clamp(fromPad ? ps : ks, -1, 1);
    this.steerAnalog = fromPad && Math.abs(ps) > 0 && Math.abs(ps) < 0.999;
    this.drift = held.drift || this._pressed.drift;
    this.item = held.item || this._pressed.item;
    this.lookBack = held.lookBack;
    this.aimBack = this.brake > 0.3 || this.lookBack;
  }

  pressed(action) { return this._pressed[action] === true; }
  held(action) { return this._held[action] === true; }
  repeated(action) { return this._repeat[action] === true; }

  /** Vibrate this device's pad only (no-op for keyboards / disconnected pads / rumble disabled). */
  rumble(strong = 0.5, weak = 0.5, ms = 150) {
    if (!this.isPad || !this.connected || this.manager.game?.settings?.rumble === false) return;
    const now = performance.now();
    if (now - this._lastRumble < 60) return;
    this._lastRumble = now;
    try {
      const p = navigator.getGamepads?.()?.[this.padIndex];
      p?.vibrationActuator?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) })?.catch?.(() => {});
    } catch {}
  }
}
