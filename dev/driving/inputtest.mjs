/**
 * InputManager unit test (Node): fake window/document/navigator, synthetic key events and a fake gamepad.
 *   node dev/driving/inputtest.mjs
 */
import { EventBus } from '../../src/core/EventBus.js';

// ---- minimal browser stubs ----
class ET { constructor() { this.l = {}; } addEventListener(t, f) { (this.l[t] ??= new Set()).add(f); } removeEventListener(t, f) { this.l[t]?.delete(f); } dispatch(t, e) { for (const f of this.l[t] ?? []) f(e); } }
const win = new ET();
const doc = new ET();
doc.hidden = false;
globalThis.window = win;
globalThis.document = doc;
let pads = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
const { InputManager } = await import('../../src/input/InputManager.js');

let fails = 0;
const ok = (name, cond) => { if (!cond) { fails++; console.log('FAIL', name); } else console.log('ok  ', name); };
const key = (type, code, extra = {}) => { const e = { code, key: code, target: { tagName: 'BODY' }, preventDefault() { this.prevented = true; }, ...extra }; win.dispatch(type, e); return e; };
const game = { events: new EventBus(), state: 'race', paused: false, player: null, settings: {} };
const inp = new InputManager(game);

// 1. held keys
key('keydown', 'ArrowUp'); key('keydown', 'ArrowRight');
inp.update(1 / 60);
ok('throttle held', inp.throttle === 1);
ok('steer right', inp.steer === 1);
key('keyup', 'ArrowUp'); key('keyup', 'ArrowRight');
inp.update(1 / 60);
ok('released', inp.throttle === 0 && inp.steer === 0);

// 2. tap between frames (down+up before update) is latched for pressed() AND reads as down for one frame (drift/item)
key('keydown', 'Space'); key('keyup', 'Space');
inp.update(1 / 60);
ok('pressed(drift) after a between-frames tap', inp.pressed('drift'));
ok('drift reads true for the tap frame', inp.drift === true);
ok('pressed(confirm) too (Space)', inp.pressed('confirm'));
inp.update(1 / 60);
ok('tap only lasts one frame', !inp.pressed('drift') && inp.drift === false);

key('keydown', 'Escape'); key('keyup', 'Escape');
inp.update(1 / 60);
ok('pause tap latched', inp.pressed('pause') && inp.pressed('back'));
inp.update(1 / 60);
ok('pause not repeated', !inp.pressed('pause'));

key('keydown', 'KeyE'); key('keyup', 'KeyE');
inp.update(1 / 60);
ok('item tap reads true for a frame', inp.item === true && inp.pressed('item'));
inp.update(1 / 60);
ok('item cleared next frame', inp.item === false);

// 3. edge detection with a normal hold
key('keydown', 'ShiftLeft');
inp.update(1 / 60);
ok('hold: pressed on first frame', inp.pressed('drift') && inp.drift);
inp.update(1 / 60);
ok('hold: not pressed again, still down', !inp.pressed('drift') && inp.drift);
key('keyup', 'ShiftLeft');
inp.update(1 / 60);
ok('release', !inp.drift);

// 4. auto-repeat ignored, last-pressed steer wins
key('keydown', 'KeyA'); key('keydown', 'KeyA'); key('keydown', 'KeyA');
inp.update(1 / 60);
ok('left steer', inp.steer === -1);
await new Promise((r) => setTimeout(r, 5));
key('keydown', 'KeyD');
inp.update(1 / 60);
ok('both held: last pressed (right) wins', inp.steer === 1);
key('keyup', 'KeyA'); key('keyup', 'KeyD');
inp.update(1 / 60);

// 5. preventDefault while racing
let e = key('keydown', 'ArrowDown');
ok('preventDefault for arrows in race', e.prevented === true);
key('keyup', 'ArrowDown');
game.paused = true;
e = key('keydown', 'Space', { target: { tagName: 'BUTTON' } });
ok('paused: Space on a focused button is NOT prevented', !e.prevented);
key('keyup', 'Space');
game.paused = false;
e = key('keydown', 'KeyW', { target: { tagName: 'INPUT' } });
ok('typing in an input is ignored', !e.prevented);
inp.update(1 / 60);
ok('  ...and does not drive', inp.throttle === 0);
key('keyup', 'KeyW');

// 6. blur clears
key('keydown', 'ArrowUp');
inp.update(1 / 60);
win.dispatch('blur', {});
inp.update(1 / 60);
ok('blur clears held keys', inp.throttle === 0);

// 7. aimBack semantic
key('keydown', 'ArrowDown');
inp.update(1 / 60);
ok('aimBack while braking', inp.aimBack === true && inp.brake === 1);
key('keyup', 'ArrowDown');
key('keydown', 'KeyQ');
inp.update(1 / 60);
ok('aimBack while looking back', inp.aimBack === true && inp.lookBack === true);
key('keyup', 'KeyQ');
inp.update(1 / 60);

// 8. gamepad: hot-plug, stick deadzone/curve, buttons, lastDevice
const mkPad = () => ({ connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) });
inp.update(1 / 60);
ok('no pad yet', inp.gamepadConnected === false);
const pad = mkPad();
pads = [pad];
win.dispatch('gamepadconnected', {});
inp.update(1 / 60);
ok('hot-plug detected', inp.gamepadConnected === true);
pad.axes[0] = 0.1;
inp.update(1 / 60);
ok('stick inside the deadzone -> 0', inp.steer === 0);
pad.axes[0] = 0.5;
inp.update(1 / 60);
ok('stick 0.5 -> shaped (0 < s < 0.5)', inp.steer > 0.1 && inp.steer < 0.5);
ok('lastDevice = gamepad', inp.lastDevice === 'gamepad');
pad.axes[0] = -1;
inp.update(1 / 60);
ok('stick full left -> -1', Math.abs(inp.steer + 1) < 1e-6);
pad.axes[0] = 0;
pad.buttons[0] = { pressed: true, value: 1 }; // A
inp.update(1 / 60);
ok('A = throttle + confirm edge', inp.throttle === 1 && inp.pressed('confirm'));
inp.update(1 / 60);
ok('A held: no second edge', !inp.pressed('confirm') && inp.throttle === 1);
pad.buttons[0] = { pressed: false, value: 0 };
pad.buttons[5] = { pressed: true, value: 1 }; // RB
inp.update(1 / 60);
ok('RB = drift edge', inp.drift && inp.pressed('drift'));
pad.buttons[5] = { pressed: false, value: 0 };
pad.buttons[7] = { pressed: true, value: 1 }; // RT
inp.update(1 / 60);
ok('RT = drift', inp.drift);
pad.buttons[7] = { pressed: false, value: 0 };
pad.buttons[4] = { pressed: true, value: 1 }; // LB
inp.update(1 / 60);
ok('LB = item', inp.item && inp.pressed('item'));
pad.buttons[4] = { pressed: false, value: 0 };
pad.buttons[9] = { pressed: true, value: 1 }; // Start
inp.update(1 / 60);
ok('Start = pause', inp.pressed('pause'));
pad.buttons[9] = { pressed: false, value: 0 };
pad.buttons[15] = { pressed: true, value: 1 }; // d-pad right
inp.update(1 / 60);
ok('d-pad right = steer +1 & nav right', inp.steer === 1 && inp.pressed('right'));
pad.buttons[15] = { pressed: false, value: 0 };
pad.buttons[6] = { pressed: true, value: 0.6 }; // LT analog
inp.update(1 / 60);
ok('LT analog = brake 0.6', Math.abs(inp.brake - 0.6) < 1e-6);
pad.buttons[6] = { pressed: false, value: 0 };
// both devices at once
pad.axes[0] = 0.4;
key('keydown', 'ArrowLeft');
inp.update(1 / 60);
ok('keyboard wins when larger magnitude', inp.steer === -1);
key('keyup', 'ArrowLeft');
pad.axes[0] = 0;
inp.update(1 / 60);
key('keydown', 'Space');
inp.update(1 / 60);
ok('keyboard input switches lastDevice back', inp.lastDevice === 'keyboard');
key('keyup', 'Space');
pads = [];
win.dispatch('gamepaddisconnected', {});
inp.update(1 / 60);
ok('hot-unplug detected', inp.gamepadConnected === false);

// 9. repeated() for menus
key('keydown', 'ArrowDown');
let reps = 0;
for (let i = 0; i < 90; i++) { inp.update(1 / 60); if (inp.repeated('down')) reps++; }
ok('repeated(): initial press + auto-repeat while held', reps >= 5 && reps <= 12);
key('keyup', 'ArrowDown');
inp.update(1 / 60);

console.log(fails === 0 ? '\nALL INPUT TESTS PASSED' : `\n${fails} FAILURES`);
process.exit(fails ? 1 : 0);
