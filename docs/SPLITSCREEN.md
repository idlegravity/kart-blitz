# Local split-screen (2–4 players) — plan & team contract

> Read this whole document **and** `ARCHITECTURE.md` (§1 rules, §5 frame loop, §6 contracts, §9 testing) before
> writing code. Five agents work **in parallel in the same directory**. This document is the contract between
> them; where it conflicts with ARCHITECTURE.md, **this document wins** for split-screen behaviour.
> Single-player behaviour must stay exactly as it is today (same look, same feel, same performance).

---

## 0. Goal

Up to **4 human players on one screen**, each with their own input device, camera, viewport and HUD, racing
together (plus CPUs filling the grid up to 8 karts) in **Quick Race** and **Grand Prix**. Time Trial stays 1 player.

* **Layouts:** 1P = full screen (unchanged). 2P = **top / bottom** halves. 3P = 2×2 grid, the bottom-right
  quadrant is a shared **overview panel** (big minimap + standings, drawn by the UI). 4P = 2×2 grid.
  Viewport order: P1 top(-left), P2 bottom (2P) / top-right (3–4P), P3 bottom-left, P4 bottom-right.
* **Devices:** keyboard split into two halves (`kb1`, `kb2`) + up to 4 gamepads (`pad0`..`pad3`).
* **Player colours:** `PLAYER_COLORS` in `src/core/constants.js` (P1 red, P2 blue, P3 yellow, P4 green).
  Already added, together with `MAX_PLAYERS = 4` and `INPUT_DEVICES`.

---

## 1. Ownership (the five agents)

Same rule as ARCHITECTURE.md §1: **only edit files you own.** Need something from another area? Code
defensively against the contract below (with fallbacks) and mention it in your report. Never edit someone
else's file, not even to fix a bug.

| Agent | Owns | Delivers |
|---|---|---|
| **A · Core** | `src/Game.js`, `src/race/`, `src/core/`, `src/data/`, `src/main.js`, `index.html`, `scripts/`, `src/track/` (only the small hook in §3.4), `ARCHITECTURE.md`, `README.md`, `docs/` | Multi-player race config, `game.players`, `game.views` + layout, multi-camera frame loop, RaceManager rules, debug URL params, smoke scenarios, docs |
| **B · Input & Camera** | `src/input/`, `src/camera/`, `src/kart/`, `dev/driving/` | Per-device input sources, keyboard halves, per-pad rumble, multi-instance CameraController that looks right in wide/quad viewports |
| **C · Rendering & FX** | `src/fx/`, `src/visuals/`, `dev/visuals/` | Multi-viewport PostFX (`renderViews`), per-view speed FX/flash/hit vignette, per-view shadows, Effects LOD for many cameras, player marker above human karts |
| **D · UI** | `src/ui/` (all: screens, HUD, CSS, icons), `dev/presentation/` UI pages | Players-count step, join/character-select lobby, per-view HUDs, shared minimap/overview, dividers, results/GP/trophy/pause for several humans, controls screen |
| **E · Audio, Items & AI** | `src/audio/`, `src/items/`, `src/ai/`, `dev/gameplay/`, `dev/presentation/` audio pages | One engine voice per human, spatial audio vs several listeners, music/jingle rules, item system & AI aware of several humans |

Rules: no `npm install`, no git commits / pushes / branch changes, scratch files in `node_modules/.cache/<agent>/`,
screenshots in `snaps/split/<agent>/`. Keep the game runnable at all times (other agents test against your code
while you work). `npm run check` must pass whenever you pause.

---

## 2. Shared data model (everyone reads; Core writes)

```js
// race config (game.raceConfig, normalized by Game._normalizeConfig)
config.players = [{ index: 0, characterId: 'zip', device: 'kb1' }, ...]   // ALWAYS present, length 1..4
config.characterId                       // === players[0].characterId (back-compat)
config.aiCount                           // default MAX_KARTS - players.length (time trial: 0)

game.players  : Kart[]                   // human karts in player order (length 1..4, [] outside a race)
game.player   : Kart | null              // === game.players[0] (back-compat, keep using it for 1P-only logic)
game.views    : View[]                   // one per human, same order as game.players ([] outside a race)
game.layout   : 'single' | 'h2' | 'quad'
game.overviewRect : Rect | null          // 3P only: the free bottom-right quadrant (UI draws the overview there)
game.isSplit  : boolean                  // views.length > 1

View = {
  index,                                 // 0..3 (== player index)
  kart,                                  // the human Kart this view follows
  camera,                                // THREE.PerspectiveCamera (views[0].camera === game.camera)
  cameraController,                      // CameraController (views[0].cameraController === game.cameraController)
  rect: { x, y, w, h },                  // normalized 0..1, ORIGIN TOP-LEFT (CSS convention)
  color,                                 // PLAYER_COLORS[index]
}

kart.isPlayer     // true for every human kart
kart.playerIndex  // 0..3 for humans, -1 for CPUs
kart.controller.source   // (PlayerController) the InputSource driving this kart
```

`RaceResult` and `getGpStandings()` rows gain `playerIndex` (−1 for CPUs); `isPlayer` is true for every human.

---

## 3. Contracts per area

### 3.1 A · Core — `Game.js`, `RaceManager`, constants, scripts

**Config.** `startRace(cfg)` accepts `cfg.players: [{ characterId, device }]` (1..4). Without it:
`players = [{ characterId: cfg.characterId, device: 'any' }]` (exact current single-player behaviour).
Normalization: clamp to `MAX_PLAYERS`; duplicate characters are replaced by the next free character;
`mode === 'timetrial'` keeps only player 1; `aiCount` defaults to `MAX_KARTS - players.length`, and
`aiCount + players.length ≤ MAX_KARTS`. `restartRace()/nextRace()` reuse `config.players`.
A 1-player config with an explicit device (e.g. `pad1`) still uses the full-screen 'single' layout.

**Spawning.** Humans start at the back of the grid in player order (P1 last), CPUs fill the front. Later GP
races sort the grid by points as today. Each human gets `kart.playerIndex`, `KartModel(character,
{ isPlayer: true, quality, playerIndex, playerCount })` (extra options; KartModel ignores them until C lands)
and `new PlayerController(game, kart, game.input.getSource?.(device) ?? game.input)`. `debug.autodrive`
drives **all** humans with autopilot AI.

**Views & layout.** Built in `startRace` after spawning, torn down in `_teardownRace`:
* `views[0]` uses `game.camera` and `game.cameraController` (unchanged objects). Extra views get a new
  `THREE.PerspectiveCamera(70, aspect, 0.1, 5000)` (added to the scene) and
  `new CameraController(game, { camera })`. Call `setupRace({ track, player: view.kart, karts })` on each
  extra controller (views[0]'s controller is already in `_raceSystems`), `teardownRace()` + `dispose()` on teardown.
* Rects: `single` → `{0,0,1,1}`; `h2` → P1 `{0,0,1,.5}`, P2 `{0,.5,1,.5}`; `quad` → P1 `{0,0,.5,.5}`,
  P2 `{.5,0,.5,.5}`, P3 `{0,.5,.5,.5}`, P4 `{.5,.5,.5,.5}`; 3P sets `overviewRect = {.5,.5,.5,.5}`.
* `_onResize` sets each view camera's `aspect = (rect.w·W)/(rect.h·H)`.
* Emits **`EVT.VIEWS_CHANGED`** `{ views, layout, overviewRect }` (new event in `src/core/events.js`, add it
  FIRST) right after views are built and again (with `views: []`) on teardown. Also add to the ctx passed to
  `setupRace`: `ctx.players`, `ctx.views`.

**Frame loop** (race state):
```
… kart.model.update ×N; effects.update(sdt)
for (const v of views) v.cameraController.update(sdt)      // views[0] = game.cameraController
track.update(sdt, views[0].kart.position)
audio.update(dt); ui.update(dt)
views.length > 1 && postfx.renderViews ? postfx.renderViews(scene, views, sdt)
                                       : postfx.render(scene, camera, sdt)
```
Shader precompile: compile once with `game.camera`.

**Finishing.** Each human kart that finishes switches to autopilot AI (existing `RACE_FINISH` handler, now for
every human). RaceManager: phase `'finished'` begins when **all humans** have finished; the
`FINISH_TIMEOUT` clock for CPUs starts when the **last** human finishes. `RACE_FINISH` is still emitted per kart.
Results/standings carry `playerIndex`. Time-trial records only for 1-player time trials.
`getGpStandings()` marks every human (`isPlayer`, `playerIndex`), ties sorted humans first.

**Track hook** (only change Core may make in `src/track/`): `track.setShadowFocus(position)` — moves the sun
light + shadow camera to follow `position` exactly as `update()` does today, without animating anything.
PostFX calls it before rendering each view so each viewport has correct shadows around its own kart.

**Debug URL params** (in `_parseDebug`, applied with `quick=1`): `players=1..4`; `pchars=zip,bolt,…`
(characters per player; missing → distinct defaults); `pdev=kb1,kb2,pad0,…` (devices; default for
`players>1`: `kb1,kb2,pad0,pad1`; for 1 player: `any`). Example:
`/?quick=1&players=2&skipintro=1&autodrive=1&mute=1`.

**Scripts.** Add smoke scenarios `split:2`, `split:3`, `split:4` (1-lap autodrive race at timescale 4 → results,
all humans finish, `game.views.length` correct, no page errors, screenshot) and `perf:split2` / `perf:split4`
(fps, draw calls). Existing scenarios must still pass. Update ARCHITECTURE.md (new §13 Split-screen pointing to
this doc) and README (how to play split-screen, key bindings).

### 3.2 B · Input & Camera

**Input sources.** `game.input.getSource(deviceId) → InputSource` (cached per id). Device ids:
`'any'` (merged keyboard + all pads, i.e. exactly today's behaviour — the InputManager itself may be/proxy it),
`'kb1'`, `'kb2'`, `'pad0'..'pad3'` (by `Gamepad.index`). All sources are updated inside `input.update(dt)`.

```js
InputSource = {
  id, label,                                      // e.g. 'kb1', 'Keyboard · WASD'; 'pad0', 'Gamepad 1'
  connected,                                      // pads: physically present; keyboards: always true
  throttle, brake, steer, steerAnalog, drift, item, lookBack, aimBack,   // same semantics as InputManager
  pressed(action), held(action), repeated(action),  // same action names as InputManager
  rumble(strong, weak, ms),                       // only this device's pad (no-op for keyboards)
}
```
* `input.devices() → string[]` currently available ids (`kb1`, `kb2`, plus connected pads).
* `input.pressedBy(action) → string[]` device ids (never `'any'`) whose action went down this frame — used by
  the UI join lobby.
* **Keyboard halves** (export `KEY_BINDINGS_SPLIT = { kb1: {...}, kb2: {...} }` for the controls screen):
  * `kb1`: W throttle, S brake, A/D steer, Space or ShiftLeft drift, E or ControlLeft item, Q look back.
    Menus: W/A/S/D navigate, Space or E confirm, Q back.
  * `kb2`: ↑ throttle, ↓ brake, ←/→ steer, ShiftRight or Period drift, Slash or ControlRight or Enter item,
    Comma look back. Menus: arrows navigate, Enter or Slash confirm, Backspace back.
  * Pause stays global (Esc/P/any Start) via the merged input. `'any'` keeps today's full bindings.
  * Latched sub-frame taps must work per source exactly like today.
* `PlayerController(game, kart, source = game.input)` copies from `this.source`; expose `controller.source`.
* **Rumble:** haptic events go to the pad of the kart's own source (`kart.controller?.source`) for every human
  kart; `'any'` keeps today's behaviour for 1P.

**Camera.** `new CameraController(game, { camera } = {})` (default `game.camera`). Every instance is fully
independent: own state, own target, own shake; event reactions only for **its** target (finish orbit when its
own kart finishes, shake for hits on its own kart, explosions near its own kart, etc.); `dispose()` removes all
listeners. Look-back uses its target kart's input. **Wide/quad viewports:** the chase framing must look right at
aspect ≈ 3.5 (2P halves at 16:9) and ≈ 1.78 (quad): adapt FOV/distance/height from `camera.aspect` (e.g. keep a
sensible horizontal FOV on very wide views so the kart isn't tiny), never assume full screen. 1P framing must not
change. Intro flyover runs in every view (fine to be identical).

Test page: `dev/driving/` is yours; use `?quick=1&players=2…` once Core lands (until then, construct a second
CameraController by hand in a dev page or via `--eval`).

### 3.3 C · Rendering & FX

* **`postfx.renderViews(scene, views, dt)`**: renders every view into its rect (rect origin is top-left; WebGL
  viewport origin is bottom-left), with the **full pipeline per view** (bloom, grade, vignette, speed blur, CA,
  speed lines, flash, hit vignette). Per-view state (blur/CA/lines/flash/hit) is driven by `view.kart`. Before
  each view: `game.track?.setShadowFocus?.(view.kart.position)` (fallback: skip). 3P: clear `overviewRect` to a
  dark navy (`#0b0d24`). Keep `stats` / `renderer.info` meaningful (sum over views). `render()` (1P) unchanged.
* Performance targets at 1280×720 on Apple Silicon (check with `snap.mjs --fps` and `debug=1`): 2P ≥ 55 fps on
  `high`; 4P ≥ 45 fps on `medium`. Use reduced per-view render resolution / cheaper bloom / lower MSAA in split
  screen as needed — but keep it pretty. Handle `setSize`/`setQuality`/resize for all view targets; dispose them.
* `postfx.flash(intensity, color, duration, kart?)` and `hitPulse(amount, kart?)`: with a kart → only that
  kart's view; without → all views (1P behaviour unchanged).
* **Effects:** LOD / culling must use the **nearest view camera** (all `game.views` cameras), not only
  `game.camera`; effects that are "for the player" (hit pulse, explosion flash near the player, finish confetti)
  apply per human kart / per view.
* **KartModel:** new constructor options `{ playerIndex = -1, playerCount = 1 }`. When `playerCount > 1`, human
  karts get a floating marker above the driver (chunky rounded tag "P1".."P4" or chevron in `PLAYER_COLORS`,
  readable at distance, constant-ish screen size, ≤ 2 draw calls, no shadows). Hide a view's own marker in its
  own view if cheap (e.g. `onBeforeRender` checking the camera), otherwise always show it.
* Showroom: nothing required; optional nicety: in the join lobby the UI may call
  `showroom.setMode('select', { characterId })` as today.

### 3.4 D · UI

* **Flow:** Main menu → Grand Prix / Quick Race → **Players (1–4)** step (skipped for Time Trial; remember the
  last choice in prefs) → **1 player:** existing character screen, unchanged. **2–4 players:** a **join lobby /
  character select**: N player cards (colour = `PLAYER_COLORS`); a player joins by pressing confirm on any
  free device (`game.input.pressedBy('confirm')`, fall back to assigning `kb1`, `kb2`, `pad0`… if the API isn't
  there yet), then browses characters with *their own* device (`getSource(id).repeated('left'|'right'|…)`),
  confirms to lock in (taken characters are unavailable to others), back to unlock/leave. When all N are
  locked → continue. P1's device (or the merged input) drives the remaining shared steps (cc, cup/track).
  `startFromFlow` passes `players: [{ characterId, device }]` and `characterId` = P1's. Mouse/touch must still
  work for 1P and for the shared steps.
* **HUD:** one HUD per view, laid out inside `view.rect` (listen to `EVT.VIEWS_CHANGED` and/or read
  `game.views` in `setupRace`; fall back to one full-screen HUD when `views` is empty/missing). Scale with the
  viewport (e.g. a CSS `--hud-scale` per view so the quad HUD is compact). Per view: item slot (its own
  `ItemSlot`), place, lap + time, wrong-way, finish banner, player tag ("P2" in its colour). Countdown/GO:
  per view or once centered — must be readable. Shared: **one minimap** with every human as a coloured
  arrow (2P: right edge straddling the divider; 3P: big in `overviewRect` together with live standings; 4P:
  small in the centre). Standings column: 1P as today; split-screen compact or overview-only. Draw clean
  dividers (thick ink line) between views.
* **Results / GP standings / trophy / pause:** highlight every human with a "P1".."P4" tag in its colour;
  the 1P "you" card becomes per-player cards (or a compact human summary) in split-screen; confetti if any
  human podiums; trophy tier from the **best human** finish, list all humans. Pause menu: anyone pauses.
* **Controls screen:** show the split-keyboard bindings (`KEY_BINDINGS_SPLIT` from B; hard-code the table from
  §3.2 as fallback).
* Debugging: `ui.debugGoto` should be able to open the players step and lobby.

### 3.5 E · Audio, Items & AI

* **Engines:** one "player" `EngineVoice` per human (`game.players`), CPU voices assigned to the CPUs nearest to
  *any* human. Lower each player voice's level when several humans play so the mix doesn't clip.
* **Spatial:** `_spatial()` measures distance/pan against the **nearest view camera** (`game.views`, fallback
  `game.camera`). SFX owned by any human kart play at full level; in quad layouts pan player-owned SFX gently
  toward their view's side (left column −, right column +). 2P top/bottom: no pan for player-owned SFX.
* **Music/jingles:** star music only in 1P (split-screen: a short star sting instead). Final-lap, results and
  victory jingles: decided by the **best human** place. Wrong-way / place-change cues per human are fine but
  must not spam (rate-limit across players).
* **Items:** audit `ItemSystem` for single-player assumptions (`this.player`, time-trial nitro is 1P only);
  anything "near the player" (e.g. comet warning) must consider all humans.
* **AI rubber-banding:** relative to the **leading human who hasn't finished** (`game.players`, fall back to
  `game.player`). `autopilot` controllers (finished humans / autodrive) are unaffected.

---

## 4. Order of work & testing

1. **Core lands the plumbing first** (events.js `VIEWS_CHANGED`, config, `game.players/views`, frame loop,
   URL params) — target within the first ~20 minutes — keeping 1P identical. Everyone else codes defensively
   (`game.views?.length ? … : fallback`, `game.players ?? (game.player ? [game.player] : [])`,
   `game.input.getSource?.(id) ?? game.input`) so nothing breaks while the tree is in flux.
2. Each agent tests its own area with `node scripts/snap.mjs` (see ARCHITECTURE.md §9), e.g.
   ```bash
   node scripts/snap.mjs "/?quick=1&players=2&skipintro=1&autodrive=1&mute=1" --wait=7000 --out=snaps/split/<agent>/2p.png
   node scripts/snap.mjs "/?quick=1&players=4&skipintro=1&autodrive=1&mute=1&quality=medium" --wait=7000 --fps --out=snaps/split/<agent>/4p.png
   node scripts/snap.mjs "/?quick=1&players=2&nocountdown=1&skipintro=1&mute=1" --wait=1500 \
     --actions="down:KeyW;down:ArrowUp;wait:1500;down:KeyD;down:ArrowLeft;wait:1200;shot:snaps/split/<agent>/drive.png"
   ```
   **Always look at your screenshots** (Read the PNG). If a page error comes from someone else's file, wait a
   minute and retry; if it persists, work around it and report it.
3. Before finishing: `npm run check` passes; 1P screenshots look exactly as before; `node scripts/smoke.mjs
   --only=menu,race,pause --tracks=meadow` passes (Core: the full suite incl. `split:*`).
4. **Final report** (≤ 50 lines): what you built, files touched, API additions/deviations, how you tested
   (with screenshot paths), known issues, and anything another area must still wire.
