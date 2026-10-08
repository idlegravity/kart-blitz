/**
 * Shared place styling (HUD indicator + results): gold / silver / bronze, then blue → purple → red.
 */
import { clamp } from './dom.js';

/** CSS linear-gradient for a finishing place (1-based). */
export function placeGradient(place) {
  if (place === 1) return 'linear-gradient(#fff8c8, #ffd23f 52%, #ff9a1a)';
  if (place === 2) return 'linear-gradient(#ffffff, #dde5f4 52%, #94a3c4)';
  if (place === 3) return 'linear-gradient(#ffe6cb, #f2984c 52%, #b05a1e)';
  const t = clamp((place - 4) / 4, 0, 1);
  const hue = Math.round(215 + 140 * t);
  return `linear-gradient(hsl(${hue} 100% 90%), hsl(${hue} 95% 62%) 52%, hsl(${hue} 88% 46%))`;
}

/** Ordinal suffix only ('st', 'nd', 'rd', 'th'). */
export function suffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}
