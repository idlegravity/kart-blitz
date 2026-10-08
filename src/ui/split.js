/**
 * Split-screen helpers shared by the UI (players step, lobby, HUD, results...). OWNER: UI.
 * See docs/SPLITSCREEN.md §3.4.
 */
import { PLAYER_COLORS, MAX_PLAYERS } from '../core/constants.js';
import { keyCap, padBtn } from './icons.js';

export { PLAYER_COLORS, MAX_PLAYERS };

export const playerColor = (i) => PLAYER_COLORS[Math.max(0, i) % PLAYER_COLORS.length];
export const playerTag = (i) => `P${Math.max(0, i) + 1}`;

/** Device ids in the order they get handed out when the input API can't tell us (fallback). */
export const DEVICE_ORDER = ['kb1', 'kb2', 'pad0', 'pad1', 'pad2', 'pad3'];

export const DEVICE_META = {
  any: { label: 'Keyboard + Gamepad', short: 'Any', kind: 'any' },
  kb1: { label: 'Keyboard', short: 'WASD', kind: 'keyboard' },
  kb2: { label: 'Keyboard', short: 'Arrows', kind: 'keyboard' },
  pad0: { label: 'Gamepad 1', short: 'Pad 1', kind: 'gamepad' },
  pad1: { label: 'Gamepad 2', short: 'Pad 2', kind: 'gamepad' },
  pad2: { label: 'Gamepad 3', short: 'Pad 3', kind: 'gamepad' },
  pad3: { label: 'Gamepad 4', short: 'Pad 4', kind: 'gamepad' },
};
export const deviceMeta = (id) => DEVICE_META[id] ?? DEVICE_META.any;

const OR = '<span class="or">/</span>';

/** Key caps / pad button that confirm (join / lock in) on a device. */
export function confirmGlyph(device) {
  if (device === 'kb1') return `${keyCap('Space')}${OR}${keyCap('E')}`;
  if (device === 'kb2') return `${keyCap('Enter')}${OR}${keyCap('/')}`;
  return padBtn('A');
}
export function backGlyph(device) {
  if (device === 'kb1') return keyCap('Q');
  if (device === 'kb2') return keyCap('Backspace');
  return padBtn('B');
}
export function navGlyph(device) {
  if (device === 'kb1') return `${keyCap('A')}${keyCap('D')}`;
  if (device === 'kb2') return `${keyCap('ArrowLeft')}${keyCap('ArrowRight')}`;
  return padBtn('DPAD');
}

/**
 * Pixel size of the "1em" unit for a HUD box of `w`×`h` CSS pixels: the same 16:9-fitting formula the main UI uses
 * (`--u: min(1vw, 1.7778vh)`), so a box laid out in em looks like a miniature full-screen HUD.
 */
export function boxUnit(w, h) {
  return Math.min(w / 100, (h * 16) / 9 / 100);
}

/** CSS pixel rect of a normalized view rect (origin top-left). */
export function pxRect(rect, W = window.innerWidth, H = window.innerHeight) {
  return { x: rect.x * W, y: rect.y * H, w: rect.w * W, h: rect.h * H };
}

/** Human player index of a result / standings row (−1 for CPUs). Falls back to the race config's player list. */
export function playerIndexOf(row, config) {
  if (!row) return -1;
  if (Number.isInteger(row.playerIndex) && row.playerIndex >= 0) return row.playerIndex;
  if (!row.isPlayer) return -1;
  const i = (config?.players ?? []).findIndex((p) => p.characterId === (row.characterId ?? row.kart?.character?.id));
  return i >= 0 ? i : 0;
}

/** Mini layout diagram (HTML/SVG string) for the Players step. 48×34 viewBox. */
export function layoutDiagram(n) {
  const C = PLAYER_COLORS;
  const cell = (x, y, w, h, i) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.2" fill="${C[i]}"/><rect x="${x}" y="${y}" width="${w}" height="${h * 0.42}" rx="2.2" fill="#fff" opacity=".28"/>`;
  let body = '';
  if (n === 1) body = cell(2, 2, 44, 30, 0);
  else if (n === 2) body = cell(2, 2, 44, 14.2, 0) + cell(2, 17.8, 44, 14.2, 1);
  else if (n === 3) {
    body = cell(2, 2, 21.2, 14.2, 0) + cell(24.8, 2, 21.2, 14.2, 1) + cell(2, 17.8, 21.2, 14.2, 2)
      + '<rect x="24.8" y="17.8" width="21.2" height="14.2" rx="2.2" fill="#0b0d24"/><path d="M28.500 28.500c2-6 4-7 7-5s3 2 6-1" fill="none" stroke="#8f9bd6" stroke-width="2" stroke-linecap="round"/><circle cx="41.500" cy="22.500" r="1.800" fill="#fff"/>';
  } else body = cell(2, 2, 21.2, 14.2, 0) + cell(24.8, 2, 21.2, 14.2, 1) + cell(2, 17.8, 21.2, 14.2, 2) + cell(24.8, 17.8, 21.2, 14.2, 3);
  return `<svg class="layout-diagram" viewBox="0 0 48 34" aria-hidden="true"><rect x=".8" y=".8" width="46.4" height="32.4" rx="4" fill="#140a2e" stroke="#140a2e" stroke-width="1.6"/>${body}</svg>`;
}
