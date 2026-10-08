# Mobile phones (single player) — plan & team contract

> Read this whole document **and** `ARCHITECTURE.md` (§1 rules, §5 frame loop, §6 contracts, §9 testing, §10
> performance, §13 split-screen) before writing code. Five agents work **in parallel in the same directory**.
> This document is the contract between them; where it conflicts with ARCHITECTURE.md, **this document wins**.
> **Desktop behaviour must not change** (same look, feel, controls, performance) — every mobile change is gated
> on `PLATFORM.mobile` / `PLATFORM.touch` or on a viewport size, never applied blindly.

---

## 0. Goal

Kart Blitz is fully playable and polished on a phone in a mobile browser (iOS Safari, Android Chrome), and
when added to the home screen: **single player only** (Grand Prix, Quick Race, Time Trial), **landscape**, touch
controls, menus that work with one thumb, a HUD that fits small screens and stays clear of the thumbs, and a
smooth frame rate on a mid-range phone (target: iPhone 12 / Pixel 6 class at 60 fps, never below 30).

Reference viewports (CSS px, landscape): **844×390 @3x** (iPhone 12–15), **932×430 @3x** (Pro Max),
**667×375 @2x** (iPhone SE — the smallest we support), **915×412 @2.6x** (Pixel). Tablets (1024×768+) use the
same mobile experience with more room. Portrait shows a "rotate your phone" prompt.

## 1. Already in place (shared foundation — do not redefine)

* `src/core/platform.js` → `PLATFORM = { mobile, touch, ios, android, standalone }`.
  **`?mobile=1` forces the mobile experience on desktop** (use it for all testing), `?mobile=0` disables it.
* New settings in `DEFAULT_SETTINGS` (`src/core/constants.js`): `touchSteer: 'stick'|'tilt'|'buttons'`,
  `autoAccel: true`, `haptics: true`, `leftHanded: false`. Read via `game.settings`, change via
  `game.setSetting(key, value)` (emits `SETTINGS_CHANGED`).
* `index.html` already has `user-scalable=no`, `overscroll-behavior: none`, no text selection.

---

## 2. Ownership (the five agents)

Same rule as ARCHITECTURE.md §1: **only edit files you own.** Need something from another area? Code
defensively against this contract (with fallbacks) and mention it in your report. Never edit someone else's
file, not even to fix a bug.

| Agent | Owns | Delivers |
|---|---|---|
| **A · Platform & Core** | `index.html`, `public/` (new: manifest, icons), `src/Game.js`, `src/main.js`, `src/race/`, `src/core/` (keep `platform.js`'s API), `src/data/`, `vite.config.js`, `scripts/`, `ARCHITECTURE.md`, `README.md`, `docs/` | Mobile boot, viewport/orientation/fullscreen/PWA, mobile quality preset & dynamic resolution, WebGL context loss, single-player enforcement, mobile test tooling (touch emulation in snap/smoke) |
| **B · Touch controls & camera** | `src/input/` (incl. new `TouchControls.js` + its own stylesheet), `src/camera/`, `src/kart/`, `dev/driving/` | On-screen touch controls overlay, three steering modes, auto-accelerate, haptics, steering assist, camera framing for phone aspects |
| **C · Rendering performance** | `src/fx/`, `src/visuals/`, `src/track/`, `dev/visuals/`, `dev/world/` | Mobile render path (PostFX, shadows, particles, kart/track LOD & decor), budgets in §3.3 met, identical desktop look |
| **D · UI** | `src/ui/` (all), `dev/presentation/` UI pages | Responsive phone layouts for every screen, tap-friendly menus, touch hints, mobile HUD clear of the thumb zones, pause button, rotate prompt, touch settings in Options, touch page in Controls |
| **E · Audio, items & AI** | `src/audio/`, `src/items/`, `src/ai/`, `dev/gameplay/`, `dev/presentation/` audio pages | iOS/Android audio unlock & interruptions, mobile audio CPU budget, AI/item CPU cost, difficulty fit for touch players |

Rules: no `npm install` (and no `npx playwright install`), no git commits / pushes / branch changes, scratch
files in `node_modules/.cache/<agent>/`, screenshots in `snaps/mobile/<agent>/`. Keep the game runnable at
all times. `npm run check` must pass whenever you pause.

**DOM exception:** B owns the touch-controls overlay DOM. It mounts a single root `#touch-controls`
(sibling of `#ui`, `z-index: 20`, own CSS injected from `src/input/`). Everything else in the main page stays D's.

---

## 3. Contracts per area

### 3.1 A · Platform & Core

* **index.html:** `viewport-fit=cover` in the viewport meta; `apple-mobile-web-app-capable`,
  `mobile-web-app-capable`, status-bar style `black-translucent`, `apple-touch-icon`; link a
  `manifest.webmanifest` (name, short_name "Kart Blitz", `display: fullscreen`, `orientation: landscape`,
  theme/background `#11142b`, icons 192/512 PNG generated procedurally by a script you write — no downloads).
  All paths relative (the site is served from `/kart-blitz/` on GitHub Pages; `base: './'`). Disable iOS
  double-tap zoom / pinch / long-press callouts (`touch-action: none` on the game surface,
  `-webkit-touch-callout: none`) and prevent `gesturestart` zoom.
* **Game:** `game.platform = PLATFORM`. On mobile:
  * Default quality = new preset **`QUALITY.mobile`** (add it to `constants.js`, e.g. pixelRatio cap 1.5 —
    C tunes the numbers; `settings.quality` may still be switched to low/medium/high in Options).
    A saved desktop-only choice must not force 'high' on a phone: first run on mobile → 'mobile'.
  * Dynamic resolution (`_adaptResolution`) may drop the pixel ratio **below 1** on mobile (floor ~0.75) and
    is tuned for 60 Hz/120 Hz phones; add `game.renderScale` (read-only) for debugging.
  * Resize from `visualViewport` (iOS toolbar show/hide) and `orientationchange`; expose
    `game.orientation: 'landscape'|'portrait'` and emit **`EVT.ORIENTATION`** `{ orientation }` (add to
    `src/core/events.js` FIRST). In portrait during a race: auto-pause (UI shows the rotate prompt).
  * Fullscreen: `game.requestFullscreen()` — calls `documentElement.requestFullscreen` (Android/iPad) and
    `screen.orientation.lock('landscape')` where supported; safe no-op otherwise (iPhone Safari has neither).
    UI calls it from the first tap on the title screen.
  * `visibilitychange` hidden → pause the race (in addition to window blur).
  * **WebGL context loss** (iOS kills contexts in the background): handle `webglcontextlost` /
    `webglcontextrestored` without a crash — prevent default, pause, and on restore rebuild GPU resources
    (simplest robust approach: restart the current race / return to the menu with a toast event
    `EVT.CONTEXT_RESTORED`).
  * **Single player only:** when `PLATFORM.mobile`, `_normalizeConfig` keeps only player 1 (device `'any'`)
    and URL `players=` is ignored.
* **Tooling (essential for everyone — land it within ~20 minutes):** `scripts/snap.mjs --mobile[=iphone|se|pixel|ipad]`
  launches Chrome with Playwright device emulation (viewport, DPR, `isMobile`, `hasTouch`, mobile UA,
  landscape) and appends `mobile=1` to the URL; new actions `tap:x,y`, `touch:x,y,ms` (hold),
  `drag:x1,y1,x2,y2,ms` (multi-step touch move), `multitouch:[[x,y,ms],…]` (simultaneous holds — use CDP
  `Input.dispatchTouchEvent`), `rotate:portrait|landscape`, `cpu:4` (CDP CPU throttling as a phone proxy).
  `smoke.mjs`: scenarios `mobile:menu` (tap through to a race), `mobile:race` (touch-driven 1-lap race to
  results), `mobile:rotate`, `perf:mobile` (fps with `cpu:4`, draw calls, triangles at 844×390@3x).
  Existing scenarios must still pass. Update ARCHITECTURE.md (§14 Mobile → this doc) and README.

### 3.2 B · Touch controls & camera

* **`TouchControls`** (new, `src/input/TouchControls.js`), created by InputManager when `PLATFORM.touch`;
  visible only while racing (`game.state === 'race'`, not paused, not in results) and only on touch devices.
  Feeds a touch source that is merged into the `'any'` input exactly like keyboard/gamepad (so
  PlayerController needs no changes). Exposes `input.touch` with `{ active, layout }` where
  `layout = { steerZone: Rect, actionZone: Rect }` in CSS px (D keeps HUD elements out of these zones; also
  publish them as CSS custom properties `--touch-left-w`, `--touch-right-w`, `--touch-bottom-h` on `#ui`
  or `:root`).
* **Layout** (landscape, mirrored when `settings.leftHanded`): left thumb = steering; right thumb = big
  **Drift/Hop** button (hold), **Item** button (above/left of it, shows nothing — the HUD item slot shows the
  item; the button can show a subtle icon), **Brake/Reverse** button (smaller, lower), small **Look back**.
  All buttons ≥ 64 CSS px, generous invisible hit areas, multi-touch (steer + drift + item simultaneously),
  respect `env(safe-area-inset-*)`, semi-transparent glossy style that matches the game, pressed states.
* **Steering modes** (`settings.touchSteer`):
  * `'stick'` (default): floating analog stick — touch anywhere in the left zone sets the origin, drag
    left/right steers proportionally (dead zone + response curve like `shapeStick`), `steerAnalog = true`.
  * `'tilt'`: DeviceOrientation (landscape-aware, either rotation direction), calibrated to the hold angle at
    race start; iOS 13+ needs `DeviceOrientationEvent.requestPermission()` from a user gesture — expose
    `input.touch.requestTiltPermission()` (D calls it from the Options toggle / first race tap). Fallback to
    stick when denied/unavailable.
  * `'buttons'`: two large left/right pads (digital).
* `settings.autoAccel` (default on): throttle = 1 while racing unless brake held; rocket starts still work
  (holding throttle before GO happens automatically → design something fair, e.g. tap the drift button in
  the window to rocket-start, or auto-accel starts at the ideal moment only if the player touches the screen
  during the window — document it).
* **Haptics:** `navigator.vibrate` (Android; no-op on iOS) on hits/boosts/drift levels, when
  `settings.haptics`.
* **Steering assist** (mobile only, subtle): touch steering is coarser than a keyboard — e.g. mild
  auto-alignment toward the road direction when not steering and slightly wider drift tolerance. Keep it
  gentle and gated on `PLATFORM.mobile`; desktop driving must be identical.
* **Camera:** phone aspects are 2.0–2.3; tune `CameraController` so the kart sits a bit lower/smaller on
  short screens leaving room for the thumbs and HUD, gated on mobile. 1P desktop framing unchanged.
* Pause from touch: D draws the pause button and calls `game.togglePause()`.

### 3.3 C · Rendering performance

* Define the numbers of `QUALITY.mobile` with A (A adds the key; you tune values and anything it controls).
  Budgets for `mobile` at 844×390 @3x (measure with `snap.mjs --mobile --fps` + `debug=1`, and with `cpu:4`):
  **≤ 150 draw calls, ≤ 450k triangles, ≤ 1 shadow map of ≤ 1024², internal resolution ≤ ~1.5× CSS px**,
  no MSAA (use FXAA or nothing), cheap bloom (half/quarter res, few mips) or bloom off, simplified grade
  pass, no per-frame allocations.
* PostFX: a mobile path that keeps the bright cartoon look (bloom on emissives can be faked/cheapened).
* Track: decor density / instancing / draw distance / fog for mobile; Effects: particle caps; KartModel:
  LOD for distant CPU karts (fewer draw calls); portraits & showroom cheap on mobile (menus must also run
  smoothly — the showroom renders behind every menu).
* Handle `webglcontextrestored` gracefully if A calls into you (`postfx.setSize`, recreate targets).
* Desktop presets low/medium/high must look and perform exactly as before (compare screenshots).

### 3.4 D · UI

* **Responsive scale:** the UI unit `--u` must make every screen fit in 667×375 and look great at 844×390
  and tablets (scale from the smaller dimension, cap text size, tighten layouts below ~500 px height).
  Respect `env(safe-area-inset-*)` (notch / home indicator).
* **Touch menus:** on touch, a tap on a menu item selects it directly (no focus-then-confirm), big tap
  targets (≥ 44 px), visible pressed states, no hover-only affordances, Back buttons on every screen (no
  Esc on phones). Hints show touch wording ("Tap") instead of key glyphs when `PLATFORM.touch` and the
  last input was touch.
* Title: "Tap to start" on mobile; first tap calls `game.requestFullscreen?.()` and `audio.unlock()`.
* Hide the **Players** step on mobile (always 1 player; skip straight to the existing flow).
* **Rotate prompt:** full-screen, polished "Rotate your phone" overlay in portrait (listen to
  `EVT.ORIENTATION`, fallback `matchMedia('(orientation: portrait)')`), on every screen.
* **HUD on phones:** compact layout clear of the touch zones (`input.touch.layout` / CSS vars from B): item
  slot top-left, lap/time top-right, place indicator moved so it isn't under a thumb, minimap smaller or
  optional, standings compact/collapsed, **pause button** (top centre or top corner within safe area) →
  `game.togglePause()`. Countdown/banners sized for small screens.
* **Pause / Results / GP / Trophy / Loading:** fit and tappable on phones.
* **Options (mobile):** Steering (Stick / Tilt / Buttons — selecting Tilt calls
  `game.input.touch?.requestTiltPermission?.()`), Auto-accelerate, Haptics, Left-handed layout; existing
  options too. **Controls** screen: a Touch page illustrating the layout.
* Desktop UI must look exactly as before (compare screenshots at 1280×720 and 1920×1080).

### 3.5 E · Audio, items & AI

* **Unlock:** resume/create the AudioContext inside a user gesture on iOS (`touchend`/`pointerup`/`click`,
  not only `pointerdown`/`keydown`) — you may add your own document listeners from AudioManager.
  On iOS, set `navigator.audioSession.type = 'playback'` when available so the ring/silent switch doesn't
  mute the game (otherwise document that iOS mutes WebAudio in silent mode).
* **Interruptions:** handle `ctx.state === 'interrupted'` (iOS calls, Siri, backgrounding) and resume on
  return; never get stuck silent. Also re-check: after `visibilitychange` → visible, audio resumes reliably.
  (A desktop Chrome user reported all sound dropping out mid-race once — unreproduced; while you're in
  here, look for any path that can leave the context suspended or the graph silent and harden it, e.g. a
  watchdog that resumes a suspended context when the page is visible and the game wants sound.)
* **Mobile CPU budget:** fewer engine voices (e.g. player + 2 CPUs), cheaper/no convolution reverb on mobile,
  music scheduler resilient to timer throttling (`setInterval` lookahead), polyphony caps.
* **AI & items CPU:** profile `AIController`/`ItemSystem` per frame with `cpu:4`; make sure 7 CPUs cost
  ≲ 2 ms/frame on the throttled proxy. Touch players are less precise: on mobile, lower the default rubber-band
  "push" a notch for 150cc/200cc (gated on `PLATFORM.mobile`), unchanged on desktop.

---

## 4. Order of work & testing

1. **A lands the tooling and boot plumbing first** (`EVT.ORIENTATION`, `QUALITY.mobile`, `snap.mjs --mobile`
   + touch actions) — target within ~20 minutes. Others code defensively until then
   (`game.input.touch?.layout`, `QUALITY.mobile ?? QUALITY.low`, `matchMedia` fallbacks).
2. Test your own area constantly, e.g.
   ```bash
   node scripts/snap.mjs "/" --mobile --wait=3000 --out=snaps/mobile/<agent>/title.png
   node scripts/snap.mjs "/?quick=1&skipintro=1&nocountdown=1&mute=1" --mobile --wait=3000 \
     --actions="touch:120,300,2500;shot:snaps/mobile/<agent>/steer.png"
   node scripts/snap.mjs "/?quick=1&skipintro=1&autodrive=1&mute=1&debug=1" --mobile --fps --actions="cpu:4;wait:6000;shot:snaps/mobile/<agent>/perf.png"
   node scripts/snap.mjs "/" --mobile=se --wait=3000 --out=snaps/mobile/<agent>/se.png
   ```
   (until A's `--mobile` lands: `--size=844x390 --dpr=3` and `?mobile=1`). **Always look at your screenshots**
   (Read the PNG) and judge them like an art director on a phone: thumb reach, legibility, nothing under a
   thumb or the notch. If a page error comes from someone else's file, wait and retry; if it persists, work
   around it and report it.
3. Before finishing: `npm run check` passes; desktop screenshots unchanged; `node scripts/smoke.mjs
   --only=menu,race,pause --tracks=meadow` passes, plus the `mobile:*` scenarios once A has added them
   (A: the full suite).
4. **Final report** (≤ 50 lines): what you built, files touched, API additions/deviations, how you tested
   (screenshot paths, fps/draw-call numbers), known issues, anything another area must still wire.
