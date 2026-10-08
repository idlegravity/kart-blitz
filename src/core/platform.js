/**
 * Platform detection, computed once at startup (see docs/MOBILE.md).
 * `?mobile=1` forces the mobile experience on a desktop browser (for testing), `?mobile=0` disables it.
 */
const nav = typeof navigator !== 'undefined' ? navigator : {};
const win = typeof window !== 'undefined' ? window : null;
const ua = nav.userAgent || '';
const params = win ? new URLSearchParams(win.location.search) : new URLSearchParams();

const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1); // iPadOS reports as Mac
const android = /Android/.test(ua);
const touch = !!win && ('ontouchstart' in win || (nav.maxTouchPoints || 0) > 0);
const coarse = !!win?.matchMedia?.('(pointer: coarse)').matches;
const smallScreen = !!win && Math.min(win.screen?.width || 9999, win.screen?.height || 9999) <= 900;

let mobile = ios || android || (touch && coarse && smallScreen);
if (params.get('mobile') === '1') mobile = true;
if (params.get('mobile') === '0') mobile = false;

export const PLATFORM = Object.freeze({
  /** Phone/tablet experience: touch controls, mobile quality preset, single player only. */
  mobile,
  /** The device has a touch screen (may also be true on touch laptops). */
  touch: touch || mobile,
  ios,
  android,
  /** Launched from the home screen as an installed web app (no browser chrome). */
  standalone: !!(win?.matchMedia?.('(display-mode: standalone)').matches || nav.standalone),
});
