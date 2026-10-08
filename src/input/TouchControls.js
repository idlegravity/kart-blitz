/**
 * TouchControls — on-screen driving controls for phones/tablets (docs/MOBILE.md §3.2). OWNER: Driving agent.
 *
 * Mounted by InputManager when PLATFORM.touch. One DOM root `#touch-controls` (sibling of #ui, z-index 20) holding
 * a full-screen pointer surface plus purely visual buttons; ALL hit-testing is done here with pointer events so
 * several fingers work at once (steer + drift + item) and every button gets a generous invisible hit margin.
 *
 * Layout (landscape; mirrored when settings.leftHanded)
 *   left thumb  : steering — 'stick' (floating analog stick anywhere in the left ~45%), 'tilt' (DeviceOrientation
 *                 wheel, calibrated to the hold angle during the countdown), 'buttons' (two big left/right pads)
 *   right thumb : big DRIFT/HOP (hold), ITEM above-left of it, BRAKE/REVERSE left of it, small LOOK BACK above it,
 *                 and a GAS button only when settings.autoAccel is off.
 *
 * Throttle / rocket start (documented design)
 *   - autoAccel (default): throttle is 1 from GO on (0 while braking). Before GO the kart does NOT rev by itself;
 *     press-and-HOLD the big DRIFT button (it rings in the rocket-start window, between "2" and "1"... i.e. the
 *     ROCKET_START window) and the kart revs exactly like holding the gas key on desktop: pressed inside the window
 *     = rocket boost, too early = burnout. Never touching it = a plain start, so the default is always safe.
 *     That finger is "consumed": it does not hop/drift at GO, it just has to be released first.
 *   - autoAccel off: the GAS button (and, during the countdown, the DRIFT button) is the throttle.
 *
 * API (published on `game.input.touch`)
 *   active, visible, inUse, mode ('stick'|'tilt'|'buttons', the *effective* one), layout, requestTiltPermission(),
 *   recalibrateTilt(), vibrate(ms), tiltState ('off'|'unknown'|'granted'|'denied'|'unsupported')
 *   layout = { hand, steerZone, actionZone, touchArea, buttons: {drift,item,brake,gas,look} }   (Rect = {x,y,w,h,left,top,right,bottom}, CSS px)
 *   CSS custom properties on :root (physical sides): --touch-left-w, --touch-right-w, --touch-bottom-h
 *   `input.lastDevice` becomes 'touch' while the player last used a finger.
 */
import { EVT } from '../core/events.js';
import { COUNTDOWN_STEP, ROCKET_START } from '../core/constants.js';
import { clamp, damp, wrapAngle } from '../core/math.js';
import { shapeStick } from './InputSource.js';

const STYLE_ID = 'touch-controls-style';
const STEER_ZONE_FRAC = 0.46; // stick / pads accept touches in this fraction of the width on the steering side
const TILT_FULL = 30 * Math.PI / 180; // radians of wheel rotation for full lock
const TILT_DEAD = 2.5 * Math.PI / 180;

const ICONS = {
  drift: '<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 38c0-14 8-22 22-22"/><path d="M24 6l10 10-10 10" /></svg>',
  item: '<svg viewBox="0 0 48 48"><rect x="7" y="7" width="34" height="34" rx="9" fill="#fff" fill-opacity=".92" stroke="#140a2e" stroke-width="4"/><path d="M18 19c0-4 3-6 6-6s6 2 6 5.500c0 5-6 4.500-6 9.500" fill="none" stroke="#7a3fe4" stroke-width="5" stroke-linecap="round"/><circle cx="24" cy="35" r="3.200" fill="#7a3fe4"/></svg>',
  brake: '<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M24 8v26"/><path d="M12 24l12 14 12-14"/></svg>',
  gas: '<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M24 40V14"/><path d="M12 24L24 10l12 14"/></svg>',
  look: '<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M38 20H18a8 8 0 000 16h8"/><path d="M26 10l-10 10 10 10"/></svg>',
  left: '<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M30 8L14 24l16 16"/></svg>',
  right: '<svg viewBox="0 0 48 48" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8l16 16-16 16"/></svg>',
  wheel: '<svg class="tc-wheel" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="rgba(255,255,255,.12)" stroke="#fff" stroke-opacity=".85" stroke-width="7"/><path d="M12 54c14 8 62 8 76 0" stroke="#fff" stroke-opacity=".85" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M50 54v36" stroke="#fff" stroke-opacity=".85" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="12" r="6" fill="#ffd23f" stroke="#140a2e" stroke-width="3"/></svg>',
};

const mkRect = (x, y, w, h) => ({ x, y, w, h, left: x, top: y, right: x + w, bottom: y + h });
const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return mkRect(r.left, r.top, r.width, r.height);
};
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** Output of TouchControls.poll(): reused every frame. */
const makeOut = () => ({
  active: false, throttle: 0, brake: 0, steer: 0, steerAnalog: false,
  drift: false, item: false, lookBack: false, latchDrift: false, latchItem: false, latchConfirm: false, assist: false,
});

export class TouchControls {
  /**
   * @param {import('../Game.js').Game} game
   * @param {import('./InputManager.js').InputManager} manager
   * @param {{ mobile: boolean, touch: boolean }} platform
   */
  constructor(game, manager, platform) {
    this.game = game;
    this.manager = manager;
    this.platform = platform;
    /** Controls are on screen and live (racing, not paused). */
    this.active = false;
    this.visible = false;
    /** A finger is down on the controls, or tilt steering is producing input. */
    this.inUse = false;
    this.layout = null;
    this.tiltState = 'off';

    // ---- settings snapshot ----
    this._mode = 'stick'; // requested
    this._hand = 'right';
    this._auto = true;
    this._haptics = true;
    this._effMode = 'stick';

    // ---- pointers ----
    /** pointerId -> { kind: 'btn'|'steer', name, x0, y0, consumed } */
    this._ptrs = new Map();
    this._btnDown = { drift: false, item: false, brake: false, gas: false, look: false };
    this._latchDrift = false;
    this._latchItem = false;
    this._latchConfirm = false;
    this._stick = { x: 0, y: 0, ox: 0, oy: 0, pid: -1, steer: 0 };
    this._padDir = 0;
    this._touchSeen = !!platform.mobile;
    this._lastTouchT = -1e9;
    this._catching = false;

    // ---- tilt ----
    this._tiltListening = false;
    this._tiltAngle = 0; // current wheel angle (rad, + = clockwise)
    this._tiltSmooth = 0;
    this._tiltBase = 0;
    this._tiltValid = false;
    this._tiltT = -1e9;
    this._tiltSteer = 0;
    this._tiltCalibrating = true;
    this._tiltPermAsked = false;

    // ---- misc ----
    this._lastVibrate = 0;
    this._rect = {};
    this._r = 52; // stick travel radius
    this._time = 0;
    this._out = makeOut();
    this._lastPhase = '';
    this._lvl = 0;
    this._offs = [];

    this._build();
    this._bind();
    this._syncSettings(true);
  }

  // ================================================================================================
  // DOM
  // ================================================================================================
  _build() {
    if (!document.getElementById(STYLE_ID)) {
      // (imported lazily so a missing stylesheet module can never break the rest of the input system)
      import('./touchControls.css.js').then((m) => {
        if (document.getElementById(STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = m.TOUCH_CSS;
        document.head.appendChild(s);
        this._measure();
      }).catch(() => {});
    }
    const old = document.getElementById('touch-controls');
    if (old) old.remove();
    const root = el('div');
    root.id = 'touch-controls';
    root.dataset.visible = '0';
    root.dataset.mode = 'stick';
    root.dataset.hand = 'right';
    root.dataset.auto = '1';
    this.root = root;

    this.surface = el('div', 'tc-surface');
    const group = el('div', 'tc-group');
    this.group = group;
    const steer = el('div', 'tc-steer');
    this.ring = el('div', 'tc-ring');
    this.knob = el('div', 'tc-knob');
    this.pads = el('div', 'tc-pads');
    this.padL = el('div', 'tc-btn tc-pad', ICONS.left);
    this.padR = el('div', 'tc-btn tc-pad', ICONS.right);
    this.pads.append(this.padL, this.padR);
    this.tilt = el('div', 'tc-tilt', ICONS.wheel);
    this.tilt.appendChild(el('span', 'tc-cal', 'HOLD STEADY'));
    this.wheel = this.tilt.querySelector('.tc-wheel');
    steer.append(this.ring, this.knob, this.pads, this.tilt);

    const btn = (cls, name, icon, label) => {
      const b = el('div', `tc-btn ${cls}`, icon + (label ? `<b>${label}</b>` : ''));
      b.dataset.btn = name;
      return b;
    };
    this.btns = {
      drift: btn('tc-drift', 'drift', ICONS.drift, 'DRIFT'),
      item: btn('tc-item', 'item', ICONS.item, ''),
      brake: btn('tc-brake', 'brake', ICONS.brake, 'BRAKE'),
      gas: btn('tc-gas', 'gas', ICONS.gas, 'GAS'),
      look: btn('tc-look', 'look', ICONS.look, ''),
    };
    this.btns.drift.appendChild(el('i', 'tc-lvl'));
    group.append(steer, ...Object.values(this.btns));
    root.append(this.surface, group);
    document.body.appendChild(root);
    this._relayout();
  }

  _bind() {
    const s = this.surface;
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    s.addEventListener('pointerdown', this._onDown);
    s.addEventListener('pointermove', this._onMove);
    s.addEventListener('pointerup', this._onUp);
    s.addEventListener('pointercancel', this._onUp);
    s.addEventListener('lostpointercapture', this._onUp);
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    // any real touch anywhere flags "touch is the active device" (also makes controls appear on touch laptops)
    this._onAnyTouch = (e) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      this._touchSeen = true;
      this._lastTouchT = performance.now();
      this.manager.lastDevice = 'touch';
    };
    window.addEventListener('pointerdown', this._onAnyTouch, true);
    this._onResize = () => this._relayout();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    window.visualViewport?.addEventListener('resize', this._onResize);
    this._onBlur = () => this._releaseAll();
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('visibilitychange', this._onBlur);
    this._onOrient = (e) => this._orientation(e);

    const ev = this.game?.events;
    if (ev) {
      const mine = (k) => !!k && k === this.game.player;
      this._offs.push(
        ev.on(EVT.SETTINGS_CHANGED, () => this._syncSettings()),
        ev.on(EVT.KART_DRIFT_LEVEL, (p) => { if (mine(p?.kart)) this._lvl = p.level; }),
        ev.on(EVT.KART_DRIFT_END, (p) => { if (mine(p?.kart)) this._lvl = 0; }),
        ev.on(EVT.KART_HOP, (p) => mine(p?.kart) && this.vibrate(8)),
        ev.on(EVT.ITEM_GET, (p) => mine(p?.kart) && this.vibrate(18)),
        ev.on(EVT.RACE_TEARDOWN, () => { this._releaseAll(); this._lvl = 0; this._tiltCalibrating = true; }),
        ev.on(EVT.RACE_SETUP, () => { this._tiltCalibrating = true; this._lvl = 0; }),
      );
    }
  }

  dispose() {
    this.surface.removeEventListener('pointerdown', this._onDown);
    window.removeEventListener('pointerdown', this._onAnyTouch, true);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    window.visualViewport?.removeEventListener('resize', this._onResize);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('visibilitychange', this._onBlur);
    this._stopTilt();
    for (const off of this._offs) off?.();
    this._offs.length = 0;
    this.root.remove();
  }

  // ================================================================================================
  // settings
  // ================================================================================================
  _syncSettings(force = false) {
    const st = this.game?.settings ?? {};
    const mode = ['stick', 'tilt', 'buttons'].includes(st.touchSteer) ? st.touchSteer : 'stick';
    const hand = st.leftHanded ? 'left' : 'right';
    const auto = st.autoAccel !== false;
    this._haptics = st.haptics !== false;
    if (!force && mode === this._mode && hand === this._hand && auto === this._auto) return;
    const modeChanged = mode !== this._mode;
    this._mode = mode;
    this._hand = hand;
    this._auto = auto;
    this.root.dataset.hand = hand;
    this.root.dataset.auto = auto ? '1' : '0';
    this._releaseAll();
    if (modeChanged) this._tiltCalibrating = true;
    this._syncMode();
    this._relayout();
  }

  /** Effective steering mode: 'tilt' falls back to the stick until orientation events actually arrive. */
  _syncMode() {
    if (this._mode === 'tilt') {
      this._startTilt();
    } else {
      this._stopTilt();
    }
    const tiltLive = this._mode === 'tilt' && this._tiltValid && performance.now() - this._tiltT < 1500;
    const eff = this._mode === 'tilt' && !tiltLive ? 'stick' : this._mode;
    if (eff !== this._effMode || this.root.dataset.mode !== eff) {
      this._effMode = eff;
      this.root.dataset.mode = eff;
      this._relayout();
    }
  }

  get mode() { return this._effMode; }

  // ================================================================================================
  // layout
  // ================================================================================================
  _relayout() {
    // CSS sizing depends on viewport height; measure after the browser applied it
    this._measure();
    requestAnimationFrame?.(() => this._measure());
  }

  _measure() {
    const W = window.innerWidth, H = window.innerHeight;
    const left = this._hand === 'left';
    const rects = {};
    for (const [k, b] of Object.entries(this.btns)) rects[k] = rectOf(b);
    this._rect = rects;
    const showGas = !this._auto;
    // action cluster bounding box (visible buttons only)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [k, r] of Object.entries(rects)) {
      if (k === 'gas' && !showGas) continue;
      if (!(r.w > 0)) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    if (!Number.isFinite(x0)) { x0 = W - 210; y0 = H - 200; x1 = W; y1 = H; }
    const pad = 10;
    const aw = left ? x1 + pad : W - x0 + pad;
    const action = left ? mkRect(0, y0 - pad, aw, H - y0 + pad) : mkRect(W - aw, y0 - pad, aw, H - y0 + pad);
    const sw = clamp(Math.round(W * 0.3), 190, 300), sh = clamp(Math.round(H * 0.5), 150, 230);
    const steerZone = left ? mkRect(W - sw, H - sh, sw, sh) : mkRect(0, H - sh, sw, sh);
    const zoneW = Math.round(W * STEER_ZONE_FRAC);
    const topY = this._topLimit();
    const touchArea = left ? mkRect(W - zoneW, topY, zoneW, H - topY) : mkRect(0, topY, zoneW, H - topY);
    this._r = clamp(H * 0.13, 44, 64);
    this.root.style.setProperty('--tc-r', `${this._r}px`);
    this.layout = { hand: this._hand, steerZone, actionZone: action, touchArea, buttons: rects, viewport: { w: W, h: H } };
    const leftW = left ? action.w : steerZone.w, rightW = left ? steerZone.w : action.w;
    const rs = document.documentElement.style;
    rs.setProperty('--touch-left-w', `${Math.round(leftW)}px`);
    rs.setProperty('--touch-right-w', `${Math.round(rightW)}px`);
    rs.setProperty('--touch-bottom-h', `${Math.round(Math.max(steerZone.h, action.h))}px`);

    // place the pads / tilt gauge in the steering zone
    const e = 16;
    const side = left ? 'right' : 'left';
    const other = left ? 'left' : 'right';
    for (const g of [this.pads, this.tilt]) {
      g.style[side] = `max(env(safe-area-inset-${side}, 0px), ${e}px)`;
      g.style[other] = 'auto';
      g.style.bottom = 'max(env(safe-area-inset-bottom, 0px), 14px)';
      g.style.top = 'auto';
    }
    this._rest = { x: left ? W - Math.max(sw * 0.45, 96) : Math.max(sw * 0.45, 96), y: H - clamp(H * 0.26, 80, 110) };
    if (!this._stick.active) this._placeRing(this._rest.x, this._rest.y, 0, 0);
    this._padsRect = rectOf(this.pads);
  }

  _topLimit() {
    return 60; // the strip above stays free for the HUD's pause button
  }

  _placeRing(ox, oy, kx, ky) {
    this.ring.style.transform = `translate(${ox}px,${oy}px)`;
    this.knob.style.transform = `translate(${ox + kx}px,${oy + ky}px)`;
  }

  // ================================================================================================
  // pointers
  // ================================================================================================
  _hitButton(x, y) {
    const showGas = !this._auto;
    let best = null, bestD = 1e9;
    for (const [k, r] of Object.entries(this._rect)) {
      if (k === 'gas' && !showGas) continue;
      if (!(r.w > 0)) continue;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const d = Math.hypot(x - cx, y - cy) - r.w / 2;
      const margin = k === 'look' ? 16 : 14;
      if (d <= margin && d < bestD) { best = k; bestD = d; }
    }
    return best;
  }

  _inSteerArea(x, y) {
    const a = this.layout?.touchArea;
    return !!a && x >= a.left && x <= a.right && y >= a.top;
  }

  _pointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this._touchSeen = true;
    if (e.pointerType !== 'mouse') this.manager.lastDevice = 'touch';
    const x = e.clientX, y = e.clientY;
    if (this._catching && !this.visible) {
      // intro fly-over: any tap skips it (Game listens for confirm)
      this._latchConfirm = true;
      return;
    }
    if (!this.visible) return;
    this._tryTiltPermission();
    let p = null;
    const b = this._hitButton(x, y);
    if (b) {
      p = { kind: 'btn', name: b, x0: x, y0: y, consumed: false };
      this._pressButton(b, p);
    } else if (this._inSteerArea(x, y)) {
      if (this._effMode === 'stick' && this._stick.pid < 0) {
        p = { kind: 'steer', name: 'stick', x0: x, y0: y };
        const R = this._r, W = window.innerWidth, H = window.innerHeight;
        const sl = parseFloat(getComputedStyle(this.root).getPropertyValue('--tc-eL')) || 16;
        const ox = clamp(x, R + 24 + sl, W - R - 24 - sl), oy = clamp(y, this._topLimit() + R + 20, H - R - 20);
        Object.assign(this._stick, { pid: e.pointerId, ox, oy, x: x, y: y, steer: 0, active: true });
        this._placeRing(ox, oy, 0, 0);
        this.ring.classList.add('on');
        this.knob.classList.add('on');
      } else if (this._effMode === 'buttons') {
        p = { kind: 'steer', name: 'pad', x0: x, y0: y, dir: 0 };
        this._padMove(p, x);
      }
    }
    if (!p) return;
    this._ptrs.set(e.pointerId, p);
    try { this.surface.setPointerCapture(e.pointerId); } catch {}
  }

  _pointerMove(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'steer') {
      if (p.name === 'stick') this._stickMove(e.clientX, e.clientY);
      else this._padMove(p, e.clientX);
    }
  }

  _pointerUp(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    this._ptrs.delete(e.pointerId);
    if (p.kind === 'btn') this._releaseButton(p.name);
    else if (p.name === 'stick') this._stickEnd();
    else this._padRecalc();
    this._tryTiltPermission();
  }

  _stickMove(x, y) {
    const s = this._stick, R = this._r;
    let dx = x - s.ox;
    // drag-follow: the origin trails the finger once it is past full lock, so reversing is instant
    if (dx > R) { s.ox += dx - R; dx = R; }
    else if (dx < -R) { s.ox += dx + R; dx = -R; }
    const dy = clamp(y - s.oy, -R * 0.45, R * 0.45);
    s.steer = shapeStick(dx / R, 0);
    s.x = x; s.y = y;
    this._placeRing(s.ox, s.oy, dx, dy);
  }

  _stickEnd() {
    const s = this._stick;
    s.pid = -1; s.steer = 0; s.active = false;
    this.ring.classList.remove('on');
    this.knob.classList.remove('on');
    this._placeRing(this._rest?.x ?? 100, this._rest?.y ?? 300, 0, 0);
  }

  _padMove(p, x) {
    const r = this._padsRect;
    const mid = r && r.w > 0 ? r.x + r.w / 2 : (this._hand === 'left' ? window.innerWidth - 120 : 120);
    p.dir = x < mid ? -1 : 1;
    this._padRecalc();
  }

  _padRecalc() {
    let d = 0, l = false, r = false;
    for (const p of this._ptrs.values()) {
      if (p.name !== 'pad') continue;
      if (p.dir < 0) l = true; else if (p.dir > 0) r = true;
    }
    d = (r ? 1 : 0) - (l ? 1 : 0);
    this._padDir = d;
    this.padL.classList.toggle('down', l);
    this.padR.classList.toggle('down', r);
  }

  _pressButton(name, p) {
    const phase = this._phase();
    this._btnDown[name] = true;
    this.btns[name].classList.add('down');
    if (name === 'drift') {
      if (phase === 'countdown') p.consumed = true; // rev the engine, don't hop at GO
      else this._latchDrift = true;
    } else if (name === 'item') this._latchItem = true;
    this.vibrate(6);
  }

  _releaseButton(name) {
    // another finger may still hold the same button
    for (const p of this._ptrs.values()) if (p.kind === 'btn' && p.name === name) return;
    this._btnDown[name] = false;
    this.btns[name].classList.remove('down');
  }

  _releaseAll() {
    for (const id of this._ptrs.keys()) { try { this.surface.releasePointerCapture(id); } catch {} }
    this._ptrs.clear();
    for (const k of Object.keys(this._btnDown)) { this._btnDown[k] = false; this.btns[k].classList.remove('down'); }
    if (this._stick.pid >= 0 || this._stick.active) this._stickEnd();
    this._padDir = 0;
    this.padL.classList.remove('down');
    this.padR.classList.remove('down');
  }

  // ================================================================================================
  // tilt
  // ================================================================================================
  _startTilt() {
    if (this._tiltListening || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      if (!('DeviceOrientationEvent' in window)) this.tiltState = 'unsupported';
      return;
    }
    window.addEventListener('deviceorientation', this._onOrient);
    this._tiltListening = true;
    if (this.tiltState === 'off') {
      this.tiltState = typeof window.DeviceOrientationEvent.requestPermission === 'function' ? 'unknown' : 'granted';
    }
  }

  _stopTilt() {
    if (this._tiltListening) window.removeEventListener('deviceorientation', this._onOrient);
    this._tiltListening = false;
    this._tiltValid = false;
  }

  /**
   * Ask for DeviceOrientation access (iOS 13+ needs this from a user gesture). Safe everywhere; resolves to
   * 'granted' | 'denied' | 'unsupported'. D calls it from the Options toggle / first race tap; the controls also
   * try it themselves on the first touch of a race while Tilt is selected.
   */
  async requestTiltPermission() {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return (this.tiltState = 'unsupported');
    this._tiltPermAsked = true;
    const DOE = window.DeviceOrientationEvent;
    try {
      if (typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission();
        this.tiltState = r === 'granted' ? 'granted' : 'denied';
      } else {
        this.tiltState = 'granted';
      }
    } catch {
      this.tiltState = 'denied';
    }
    if (this.tiltState === 'granted') { this._startTilt(); this._tiltCalibrating = true; }
    this._syncMode();
    return this.tiltState;
  }

  _tryTiltPermission() {
    if (this._mode === 'tilt' && !this._tiltPermAsked && this.tiltState === 'unknown') this.requestTiltPermission();
  }

  /** Use the current hold angle as "straight ahead". */
  recalibrateTilt() {
    this._tiltCalibrating = true;
    this._tiltBase = this._tiltAngle;
  }

  _screenAngle() {
    let a = window.screen?.orientation?.angle;
    if (a == null) a = typeof window.orientation === 'number' ? window.orientation : 90;
    a = ((a % 360) + 360) % 360;
    // desktop emulation of a landscape phone reports 0/180 on a landscape window: treat it as a phone turned 90 degrees
    if ((a === 0 || a === 180) && window.innerWidth > window.innerHeight) a += 90;
    return a % 360;
  }

  _orientation(e) {
    if (e.beta == null && e.gamma == null) return;
    const rad = Math.PI / 180;
    const b = (e.beta ?? 0) * rad, g = (e.gamma ?? 0) * rad;
    // gravity ("down") in the device frame from the W3C Z-X'-Y'' angles
    const gx = Math.sin(g) * Math.cos(b), gy = -Math.sin(b);
    let rx, ry, ux, uy; // screen right / up expressed in device (x right, y up) coordinates
    switch (this._screenAngle()) {
      case 90: rx = 0; ry = -1; ux = 1; uy = 0; break;
      case 180: rx = -1; ry = 0; ux = 0; uy = -1; break;
      case 270: rx = 0; ry = 1; ux = -1; uy = 0; break;
      default: rx = 1; ry = 0; ux = 0; uy = 1;
    }
    const gr = gx * rx + gy * ry, gu = gx * ux + gy * uy;
    this._tiltAngle = Math.atan2(gr, -gu); // + = phone turned clockwise like a steering wheel = steer right
    this._tiltValid = true;
    this._tiltT = performance.now();
    if (this.tiltState === 'unknown' || this.tiltState === 'denied') this.tiltState = 'granted';
  }

  _tiltUpdate(dt) {
    if (!(this._mode === 'tilt' && this._tiltValid)) { this._tiltSteer = 0; return; }
    if (performance.now() - this._tiltT > 1500) { this._tiltValid = false; this._tiltSteer = 0; return; }
    const phase = this._phase();
    // calibrate to the hold angle: continuously during intro / countdown (low-pass), frozen once racing
    if (this._tiltCalibrating || phase === 'countdown' || phase === 'intro') {
      const first = this._tiltCalibrating;
      this._tiltBase = first ? this._tiltAngle : this._tiltBase + wrapAngle(this._tiltAngle - this._tiltBase) * Math.min(1, dt * 3);
      this._tiltCalibrating = false;
      this._tiltSmooth = 0;
    }
    const dev = wrapAngle(this._tiltAngle - this._tiltBase);
    this._tiltSmooth = damp(this._tiltSmooth, dev, 22, dt);
    const m = Math.abs(this._tiltSmooth);
    const s = m <= TILT_DEAD ? 0 : Math.min(1, (m - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
    this._tiltSteer = Math.sign(this._tiltSmooth) * Math.pow(s, 1.25);
  }

  // ================================================================================================
  // game state
  // ================================================================================================
  _phase() {
    const g = this.game;
    return g?.state === 'race' ? g.race?.phase ?? '' : '';
  }

  /** Seconds before GO (only during the countdown), else Infinity. */
  _secondsToGo() {
    const race = this.game?.race;
    if (race?.phase !== 'countdown') return Infinity;
    return 3 * COUNTDOWN_STEP - race.phaseTime;
  }

  // ================================================================================================
  // vibration
  // ================================================================================================
  /** navigator.vibrate wrapper (Android; no-op elsewhere). Respects settings.haptics and rate-limits. */
  vibrate(ms) {
    if (!this._haptics || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false; // browsers refuse (and log) before the first tap
    const now = performance.now();
    if (now - this._lastVibrate < 45) return false;
    this._lastVibrate = now;
    try { return navigator.vibrate(ms); } catch { return false; }
  }

  /** Gamepad-style rumble request routed here by the InputManager (strong/weak 0..1, ms). */
  rumble(strong = 0.5, weak = 0.5, ms = 100) {
    const k = Math.max(strong, weak);
    if (ms >= 300 && strong >= 0.5) return this.vibrate([60, 35, 90, 35, 60]);
    return this.vibrate(Math.round(clamp(ms * (0.3 + 0.7 * k), 10, 160)));
  }

  // ================================================================================================
  // per-frame
  // ================================================================================================
  /**
   * Called by the InputManager every frame (before it merges devices). Returns the reused output record.
   * @param {number} dt
   */
  poll(dt) {
    this._time += dt;
    const g = this.game;
    const phase = this._phase();
    const racing = phase === 'countdown' || phase === 'racing';
    const want = racing && !g.paused && (this.platform.mobile || this._touchSeen);
    const catching = phase === 'intro' && !g.paused && (this.platform.mobile || this._touchSeen);
    if (want !== this.visible) {
      this.visible = want;
      this.active = want;
      this.root.dataset.visible = want ? '1' : '0';
      if (!want) this._releaseAll();
      else this._measure();
    }
    if (catching !== this._catching) {
      this._catching = catching;
      this.root.dataset.catch = catching ? '1' : '0';
    }
    if (phase !== this._lastPhase) {
      this._lastPhase = phase;
      if (phase === 'countdown') this._tiltCalibrating = true;
    }
    if (this._mode === 'tilt') {
      this._tiltUpdate(dt);
      this._syncMode();
    } else if (this._tiltListening) {
      this._syncMode();
    }

    const out = this._out;
    out.latchDrift = this._latchDrift;
    out.latchItem = this._latchItem;
    out.latchConfirm = this._latchConfirm;
    this._latchDrift = this._latchItem = this._latchConfirm = false;
    if (!this.visible) {
      out.active = false;
      out.throttle = out.brake = out.steer = 0;
      out.steerAnalog = false;
      out.drift = out.item = out.lookBack = false;
      out.assist = false;
      this.inUse = false;
      return out;
    }

    const B = this._btnDown;
    // consumed drift pointers (countdown rev) act as gas until released, never as drift
    let driftHeld = B.drift, rev = false;
    if (B.drift) {
      let any = false, consumed = true;
      for (const p of this._ptrs.values()) if (p.kind === 'btn' && p.name === 'drift') { any = true; if (!p.consumed) consumed = false; }
      if (any && consumed) { rev = true; driftHeld = false; }
    }
    if (phase === 'countdown') {
      out.throttle = B.drift || B.gas ? 1 : 0;
      out.brake = 0;
    } else {
      out.brake = B.brake ? 1 : 0;
      out.throttle = out.brake ? 0 : this._auto ? 1 : B.gas ? 1 : 0;
    }
    out.drift = driftHeld && phase === 'racing';
    out.item = B.item && phase === 'racing';
    out.lookBack = B.look;
    // steering
    let steer = 0, analog = false;
    if (this._effMode === 'stick') { steer = this._stick.steer; analog = true; }
    else if (this._effMode === 'buttons') steer = this._padDir;
    else { steer = this._tiltSteer; analog = true; }
    out.steer = steer;
    out.steerAnalog = analog && Math.abs(steer) < 0.999;
    out.active = true;
    out.assist = !!this.platform.mobile;
    this.inUse = this._ptrs.size > 0 || (this._effMode === 'tilt' && Math.abs(steer) > 0.05);
    if (phase !== 'racing') { out.latchDrift = false; out.latchItem = false; }

    this._visuals(phase, rev);
    return out;
  }

  _visuals(phase, rev) {
    const g = this.game;
    const player = g.player;
    // item pulse
    const has = !!player?.item && phase === 'racing';
    if (has !== this._hasItem) { this._hasItem = has; this.btns.item.classList.toggle('has', has); }
    // rocket-start window ring on the drift button
    const t = this._secondsToGo();
    const inWin = phase === 'countdown' && t <= ROCKET_START.windowStart && t >= ROCKET_START.windowEnd && !rev;
    if (inWin !== this._inWin) { this._inWin = inWin; this.btns.drift.classList.toggle('rev', inWin); }
    const lbl = phase === 'countdown' ? 'REV' : 'DRIFT';
    if (lbl !== this._lbl) { this._lbl = lbl; this.btns.drift.querySelector('b').textContent = lbl; }
    // drift level ring
    const lvl = player?.drifting ? this._lvl : 0;
    if (lvl !== this._shownLvl) { this._shownLvl = lvl; this.btns.drift.dataset.lvl = String(lvl); }
    // tilt wheel
    if (this._effMode === 'tilt' && this.wheel) {
      const deg = this._tiltSteer * 45;
      if (deg !== this._wheelDeg) { this._wheelDeg = deg; this.wheel.style.transform = `rotate(${deg.toFixed(1)}deg)`; }
    }
    if (this._mode === 'tilt') {
      const cal = this.tilt.querySelector('.tc-cal');
      const txt = phase === 'countdown' ? 'HOLD STEADY' : '';
      if (cal && cal.textContent !== txt) cal.textContent = txt;
    }
  }
}
