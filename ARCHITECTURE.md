# KART BLITZ — Architecture & Team Contract

> Read this whole document before writing code. It is the contract between five agents working **in parallel**
> in the same directory. If something here conflicts with a stub file, **this document wins**.

---

## 0. Mission & quality bar

Build a **AAA-quality arcade kart racer in the spirit of Mario Kart 8** with Three.js (r186) that runs in the
browser at a locked 60 fps on an Apple-Silicon laptop.

* **Original IP only.** No Nintendo names, characters, logos, item names or music. The game is **KART BLITZ**.
  Characters and items are original (see `src/data/`). "Mario Kart-like" = mechanics & feel, not assets.
* **Everything is procedural.** No downloaded models, textures, fonts or sounds. Geometry is built in code,
  textures are drawn on `<canvas>` or in shaders, audio is synthesized with WebAudio. The only npm deps are the
  ones already installed: `three`, `@fontsource/lilita-one`, `@fontsource/nunito`. **Do not `npm install` anything.**
* **Look:** bright, saturated, glossy cartoon (MK8 / Crash Team Racing Nitro-Fueled). Soft shadows, rim light,
  bloom on emissives, clean silhouettes, chunky readable shapes, lots of secondary animation.
* **Feel:** responsive controls, satisfying drift → spark → mini-turbo loop, camera FOV kick & shake, particles,
  sound on every action. Juice everywhere.
* **Polish over breadth, but ship every listed feature.** A feature that exists but looks cheap is not done.

---

## 1. Team & file ownership

| Area (agent) | Owns (create/edit freely) | Main deliverables |
|---|---|---|
| **Orchestrator** | `index.html`, `vite.config.js`, `package.json`, `scripts/`, `src/main.js`, `src/Game.js`, `src/core/`, `src/data/`, `src/race/`, `ARCHITECTURE.md` | Game loop, state machine, RaceManager, contracts, integration |
| **Driving** | `src/kart/`, `src/input/`, `src/camera/`, `dev/driving/` | Kart physics, drift/boost/tricks, collisions, hit reactions, respawn, input (kbd+gamepad), camera |
| **World** | `src/track/`, `dev/world/` | Track generator + 4 themed tracks, terrain, sky, lighting, decoration, track query API |
| **Visuals** | `src/visuals/`, `src/fx/`, `dev/visuals/` | 8 character+kart models & animation, portraits, particles/VFX, post-processing, menu Showroom |
| **Gameplay** | `src/items/`, `src/ai/`, `dev/gameplay/` | Item boxes, 13 items, roulette, projectiles, AI drivers |
| **Presentation** | `src/ui/`, `src/audio/`, `dev/presentation/` | All menus/HUD/results (DOM+CSS), synthesized music & SFX, engine audio |

**Rules for parallel work**

1. Only create/edit files inside your owned paths. **Never edit another area's files — not even to fix a bug.**
   Work around it defensively in your own code and report it in your final message.
2. Orchestrator files are read-only for everyone else. `Game.js` already wires every system; if you need a new
   hook, expose it from your module and say so in your report.
3. Each owned module currently contains a **placeholder stub** written by the orchestrator. Replace it
   entirely with a real implementation, **keeping the public API in §6 exactly** (you may add to it).
4. **Keep the game runnable at all times.** Write new helper files *before* importing them. Never leave a file
   with a syntax error. Other agents are testing against your code while you work.
5. The tree changes under you. If `npm run check` or a snap shows an error in *someone else's* file, wait a
   minute and retry — do not touch it. If it persists, test with `dev/<area>/` pages and mention it.
6. Scratch output goes to `node_modules/.cache/<area>/`; screenshots to `snaps/<area>/`. Never write to `dist/`.
7. No global CSS except the Presentation agent's stylesheet. Don't create DOM in the main page except the UI
   agent (others may create DOM freely inside their own `dev/` pages).

---

## 2. Tech stack & code style

* Vite 8, native ES modules, **plain JavaScript** (no TypeScript). `import * as THREE from 'three'`;
  addons via `'three/addons/…'` (e.g. `three/addons/postprocessing/EffectComposer.js`).
* Three r186 notes: `THREE.PCFSoftShadowMap` is **deprecated** — the renderer uses `THREE.PCFShadowMap`.
  `THREE.Clock` is deprecated — use the `dt` passed to you. Lighting is physically based (directional ≈ 2–4,
  hemisphere ≈ 1–2). Color management is on: canvas textures holding colors need
  `tex.colorSpace = THREE.SRGBColorSpace`; data textures (normal/roughness) stay linear.
* Renderer (created by Game): ACES Filmic tone mapping, sRGB output, shadows on (`PCFShadowMap`),
  pixel ratio ≤ `QUALITY[settings.quality].pixelRatio`.
* **Framerate independence:** `dt` is variable and clamped to ≤ 1/20 s. Use `damp()`/`dampFactor()` from
  `src/core/math.js` instead of per-frame lerp constants. Every `update(dt)` must accept `dt === 0` (paused).
* Avoid per-frame allocations in hot paths (reuse module-level `THREE.Vector3` temporaries). Pool particles,
  projectiles and audio voices.
* JSDoc on public classes/methods. 2-space indent, single quotes, semicolons, ES2022.
* Dispose geometries/materials/textures/render targets in `dispose()` / `teardownRace()`.
* `window.__game` is the live `Game` instance (for debugging & snap probes).

---

## 3. Conventions (units, axes, scale)

* **Y is up. Meters and seconds.**
* **Kart heading `yaw`:** forward = `(sin yaw, 0, cos yaw)`, right = `(-cos yaw, 0, sin yaw)`.
  **Positive steer (+1) = turn right = yaw decreases.** Helpers: `yawToForward`, `yawToRight`, `forwardToYaw`.
* **Models face +Z**, origin at the **ground contact point under the kart center** (so `root.position = kart.position`).
* **Track frame:** `right = normalize(cross(tangent, UP))`. `lateral > 0` = right of the centerline (in the
  direction of travel). `curvatureAt(s) > 0` = the road bends to the right.
* **Minimap / top view:** screen x = world x, screen y = world z (this is the un-mirrored view from above).
* **Scale targets:** kart ≈ 1.5 m wide × 2.2 m long × 1.6 m tall incl. driver, collision radius ≈ 1.1 m.
  Road half-width 8–12 m. Walls typically 3–7 m beyond the asphalt edge. Lap length 900–1500 m.
  Top speed ≈ 31–36 m/s at 150cc (×`CC_CLASSES[cc].speedMul`). Arcade gravity ≈ 30 m/s².
  Item box: 1.5 m cube floating ~1.3 m above the road. Banana ≈ 0.7 m. Orb projectiles radius ≈ 0.45 m.
* Colors in data files are hex strings → `new THREE.Color(hex)`.
* **Bloom is HDR, pre-tonemap.** Anything meant to glow (boost pads, neon, sparks, item-box glow, visor lights)
  should be emissive with `emissiveIntensity` ≳ 1.5–4 or use additive materials with color > 1. Normal lit
  surfaces must not blow out (keep albedo ≤ ~0.9, sun ≈ 2.5–3.5).

---

## 4. App flow

**Game.state:** `'boot' → 'menu' ⇄ 'loading' → 'race'`. (`GAME_STATE` event on change.)
While `state !== 'race'`, Game renders `game.showroom.scene` with `game.showroom.camera` behind the UI.

**Race phases** (`game.race.phase`, `RACE_PHASE` event):
1. `'intro'` — `INTRO_DURATION` (4 s) camera flyover; confirm/item key skips it.
2. `'countdown'` — `RACE_COUNTDOWN {count:3}`, `{2}`, `{1}` one `COUNTDOWN_STEP` apart, then `{0}` = GO and `RACE_START`.
   Karts have `controlLocked = true` until GO (physics must still track throttle for rocket starts & engine revs).
3. `'racing'` — laps counted by RaceManager (§6.12).
4. `'finished'` — the player crossed the line; Game swaps the player's controller to an `AIController`
   (`autopilot: true`). Others keep racing until all finish or `FINISH_TIMEOUT` (10 s).
5. `'results'` — `RACE_RESULTS` emitted; the race keeps simulating in the background behind the results UI.

**Modes:** `gp` (4-race cup, points `GP_POINTS`), `quick` (single race vs 7 CPUs), `timetrial` (solo, no item
boxes, player starts with `nitro3`, records saved in localStorage, `RACE_RESULTS.record`).

**Game API for the UI:** `startRace(cfg)`, `restartRace()`, `nextRace()`, `quitToMenu()`, `pause()`, `resume()`,
`togglePause()`, `setSetting(key, value)`, `getGpStandings()`, `isLastGpRace`, plus read-only `state`, `paused`,
`raceConfig`, `settings`, `gp`, `track`, `karts`, `player`, `race`, `trackList`, `cups`, `characters`.
`startRace` cfg: `{ mode: 'gp'|'quick'|'timetrial', characterId, trackId?, cupId?, cc?: 50|100|150|200, laps? }`.
GP flow: results screen "Next" → `game.nextRace()`; after the last race `nextRace()` emits `GP_COMPLETE`
and returns to `'menu'` → UI shows the trophy screen with `showroom.setMode('podium', …)`.

**Pause:** Game toggles pause on `input.pressed('pause')` during a race (Esc/P/Start). The UI must **not** also
toggle pause on Esc; it shows/hides the pause menu on `GAME_PAUSE` and calls `game.resume()` / `restartRace()` /
`quitToMenu()` from buttons. Window blur auto-pauses.

---

## 5. Frame loop (Game.js — read-only)

```
input.update(dt)
state === 'race':
  [pause toggle]
  race.update(sdt)                         // phases, countdown           (sdt = 0 when paused)
  kart.controller.update(sdt)   ×N         // PlayerController / AIController → kart.input
  items.update(sdt)                        // item use, projectiles, boxes, hits
  kart.update(sdt)              ×N         // physics
  resolveKartCollisions(karts, sdt, game)  // kart-vs-kart
  race.updateStandings(sdt)                // progress, laps, finish, places, wrong-way
  track.update(sdt, focusPosition)         // env animation, shadow camera follows focus
  kart.model.update(sdt, kart)  ×N         // visuals & animation
  effects.update(sdt)
  cameraController.update(sdt)
  audio.update(dt); ui.update(dt)
  postfx.render(scene, camera, sdt)
otherwise (menus/loading):
  showroom.update(dt); audio.update(dt); ui.update(dt)
  postfx.render(showroom.scene, showroom.camera, dt)
```

Race setup order in `Game.startRace`: `track = createTrack(id, game)` → `track.build()` → karts created
(`new Kart`, `new KartModel`, `kart.resetForRace(track.startGrid[slot])`, controller) →
`setupRace(ctx)` on cameraController, effects, items, audio, ui → `RACE_SETUP` → `race.setup(ctx)` →
`state = 'race'`. `ctx = { track, karts, player, config }`. Teardown calls `teardownRace()` on the same systems,
removes kart models, then `track.dispose()`.

---

## 6. Module contracts

Stubs implementing every signature below exist today. Replace them; keep the names.

### 6.1 Track — `src/track/` (World)

`index.js` exports (ids/names/cups are FIXED):
* `TRACK_LIST: [{ id, name, theme, difficulty, description, colors: { primary, secondary, accent } }]`
  ids: `'meadow'` Sunshine Circuit, `'canyon'` Canyon Rush, `'glacier'` Frostbite Pass, `'neon'` Neon Skyway.
* `CUPS: [{ id: 'nitro', name: 'Nitro Cup', trackIds: [...] }]`
* `createTrack(id, game) → Track` (not yet built), `getTrackOutline(id) → Array<[x, z]>` (cheap, no meshes; for menus).

`class Track`:
```js
id, name, theme, laps (3), length /*m*/, startS /*0*/, killY, sunDirection: Vector3,
waterLevel: number|null,           // for splash effects when falling into water
group: THREE.Group                 // everything the track added
build()                            // create meshes/lights/sky/env, add to game.scene; sets scene.background,
                                   // scene.fog and scene.environment (PMREM of the sky — karts need reflections)
update(dt, focus: Vector3|null)    // animate env; move the sun + shadow camera to follow focus
dispose()                          // remove & dispose everything; reset scene.background/fog/environment
startGrid: [{ position: Vector3, yaw }] ×8   // index 0 = pole; staggered 2-wide rows BEHIND the start line
itemBoxSlots: [{ position: Vector3, s, lateral }]   // 3–5 rows per lap, 4–6 boxes per row
boostPads: [{ s, lateral, length, width }]    // informational (AI); query() reports surface 'boost'
ramps: [{ s, lateral, length, width, launch }]// informational; query() reports 'ramp' + launch
colliders: [{ x, z, radius }]                 // static round obstacles karts/projectiles bounce off
minimap: { points: Array<[x, z]>, bounds: { minX, maxX, minZ, maxZ } }
query(position: Vector3, hint = -1, out = {}) → TrackSample
getFrameAt(s, out = {}) → { s, position, tangent, right, up, halfWidth, wallLeft, wallRight, bank }
curvatureAt(s) → number            // signed 1/m, + = bends right
wrapS(s) → [0, length)
deltaS(a, b) → shortest signed distance from a to b along the loop, in (-length/2, length/2]
```
`TrackSample` (reuse `out` to avoid allocation):
```js
{ index,          // nearest centerline sample index — pass back as `hint` next frame (enables local search)
  s,              // distance along the centerline [0, length)
  lateral,        // signed offset from centerline (+ right)
  halfWidth,      // asphalt half-width here
  height,         // ground y at the queried x,z (road surface incl. banking, or shoulder/terrain);
                  //   for 'void' return killY - 10
  normal,         // ground normal (Vector3)
  tangent, right, // track frame (Vector3, horizontal-ish unit vectors)
  surface,        // 'road' | 'offroad' | 'boost' | 'ramp' | 'ice' | 'void'
  wallLeft,       // lateral coordinate of the left wall (negative number) or null = open edge
  wallRight,      // lateral coordinate of the right wall (positive) or null
  launch }        // vertical launch speed (m/s) when surface === 'ramp', else 0
```
Requirements: the query must agree with the rendered geometry; use the hint for a local search (± a few dozen
samples) and weight vertical distance so over/under-passes resolve to the right level; a global search when
`hint < 0`. The **centerline must always be solid ground** (except deliberate jump gaps after a ramp) because
respawn uses it. Query cost must stay tiny (dozens of calls per frame).

### 6.2 Kart — `src/kart/Kart.js` (Driving)

`new Kart(game, { id, character, isPlayer })`. **Public fields** (others read; only the noted owner writes):
```js
// identity: id, character, name, isPlayer, controller (Game sets), model (Game sets)
// physics (Driving writes):
position /*ground contact point*/, velocity, yaw, quaternion /*chassis orientation incl. ground alignment
& drift slide angle*/, forward, right, up, speed /*signed m/s*/, topSpeed /*nominal current top speed*/,
grounded, airTime, steerAmount /*smoothed -1..1*/, throttleAmount /*smoothed 0..1, also while locked*/,
surface, radius, mass, aiSpeedMul /*AIController writes; multiplies top speed & accel*/
// drift: drifting, driftDir (-1|0|1), driftCharge (s), driftLevel (0 none, 1 blue, 2 orange, 3 purple)
// status: boostTime, boostPower (0..1+ intensity), boostSource, starTime, shrinkTime,
//         hit: null | { type:'spin'|'tumble'|'explode'|'squish', t, duration }, invulnTime, trickTime,
//         respawnTime (>0 while being rescued), controlLocked (Game/RaceManager write)
// input (controllers write each frame): input = { throttle 0..1, brake 0..1, steer -1..1, drift, item, lookBack, aimBack }
// track: trackIndex, trackS, lateral, lastSample (latest TrackSample)
// race (RaceManager writes): lap, progress, place, finished, finishTime, lapTimes, wrongWay
// items (ItemSystem writes): item (id|null), itemCount, rouletteTime, itemTime
```
**Methods:** `resetForRace(slot)` (must set position/yaw, query the track so `trackS/trackIndex/lastSample` are
valid, zero velocities/status), `update(dt)`, `onRaceStart()` (rocket-start evaluation, see `ROCKET_START`),
`applyHit(type, source?) → boolean` (false if immune; star/invuln/respawning), `applyBoost(duration, power = 1, source)`,
`startStar(duration)`, `startShrink(duration)`, `launch(verticalSpeed)`, `respawn()`, `get isImmune`, `dispose()`.
`src/kart/collisions.js` exports `resolveKartCollisions(karts, dt, game)`.

### 6.3 Input — `src/input/` (Driving)

`InputManager(game)`: `update(dt)`; continuous `throttle, brake, steer, drift, item, lookBack, aimBack`;
`pressed(action)` = went down this frame, actions `'drift','item','lookBack','pause','confirm','back','up','down','left','right'`;
`lastDevice: 'keyboard'|'gamepad'`. Keyboard: W/↑ throttle, S/↓ brake/reverse, A/D/←/→ steer, Space/Shift drift,
E/K/Ctrl item, Q/C look back, Esc/P pause, Enter/Space confirm, Esc/Backspace back. Gamepad (standard mapping):
stick/d-pad steer, A throttle, B brake, RB/RT drift, LB/X item, Y look back, Start pause, A confirm, B back.
`PlayerController(game, kart)`: `update(dt)` copies input → `kart.input`; `dispose()`.

### 6.4 Camera — `src/camera/CameraController.js` (Driving)

`CameraController(game)` drives `game.camera`: `setupRace({ track, player, karts })`, `teardownRace()`,
`setTarget(kart)`, `setMode('intro'|'chase'|'finish'|'orbit')`, `update(dt)`, `shake(amount, duration)`,
`target` (Kart|null). Listens to `RACE_PHASE` (intro → countdown/racing → chase) and `RACE_FINISH` (player → finish orbit).

### 6.5 KartModel & portraits — `src/visuals/` (Visuals)

`new KartModel(character, { isPlayer, quality })` → `root: THREE.Group`; `update(dt, kart | null)` syncs
`root.position/quaternion` from the kart and animates everything (null = idle/menu animation); `dispose()`;
`getAnchor(name, outVec3) → Vector3` world position of `'wheelFL','wheelFR','wheelRL','wheelRR','exhaustL','exhaustR','head','back'`.
Visual-only reactions live here (spin/tumble/explode/squish animations on child nodes, invuln flashing, star
rainbow, shrink scale, trick flips, drift lean, rescue drone while `respawnTime > 0`, victory cheer when `finished`).
`portraits.js`: `getPortrait(game, characterId, size = 128) → string` PNG data URL (transparent, cached).

### 6.6 Effects & PostFX — `src/fx/` (Visuals)

`Effects(game)`: `setupRace(ctx)`, `teardownRace()`, `update(dt)` (continuous emitters from kart state: drift
sparks, boost flames, offroad dust, star sparkles, tire smoke…), `burst(type, position, opts)` with types
`'explosion','hit','boxBreak','sparks','dust','splash','confetti','smoke','ring','stars','lightning'`.
Effects also subscribes to kart/item events itself (boost, land, wall, hit, box hit, explode…). Other systems
may call `game.effects.burst(...)` directly.
`PostFX(game)`: `render(scene, camera, dt)` (renders the full frame; reads `game.player` for boost intensity
when `game.state === 'race'`), `setSize(w, h)`, `setQuality(q)`.

### 6.7 Showroom — `src/visuals/Showroom.js` (Visuals)

The 3D backdrop behind menus. `scene`, `camera`, `update(dt)`, `resize(w, h)`, `showCharacter(id)`,
`setMode(mode, data)`. Screen-layout agreement with the UI:
* `'title'` — all 8 racers in a lineup, centered in the lower ~55% of the screen (UI puts the logo on top).
* `'menu'` — same lineup framed into the **right 60%** of the screen (UI menu panel on the left 40%).
* `'select'` `{ characterId }` — one racer on a turntable centered at ~**70% of the width**, lower-middle
  (UI character grid occupies the left ~55%).
* `'track'` `{ trackId }` — 3D glowing miniature of the track outline (`getTrackOutline`) on the **right half**.
* `'podium'` `{ characterIds: [1st, 2nd, 3rd] }` — centered podium with celebration (UI text on top).

### 6.8 Items — `src/items/ItemSystem.js` (Gameplay)

`ItemSystem(game)`: `setupRace(ctx)` (spawn boxes at `track.itemBoxSlots` unless `config.items === false`;
time trial gives the player `nitro3`), `teardownRace()`, `update(dt)` (edge-detects `kart.input.item`, runs
roulette, simulates projectiles/hazards with `track.query`, resolves hits via `kart.applyHit`), `giveItem(kart, id)`.
Live lists for AI: `hazards: [{ type, position, radius, owner }]`, `projectiles: [{ type, position, velocity, owner, target }]`,
`boxes: [{ position, active }]`. Writes `kart.item/itemCount/rouletteTime/itemTime`.

### 6.9 AI — `src/ai/AIController.js` (Gameplay)

`new AIController(game, kart, { skill: 0..1, autopilot })`: `update(dt)` writes `kart.input` exactly like a
player would (throttle, steer, drift, item…) and `kart.aiSpeedMul` (rubber-banding); `dispose()`.

### 6.10 UI — `src/ui/UIManager.js` (Presentation)

`UIManager(game)` renders into `#ui` (DOM + CSS; `#ui` has `pointer-events:none`, opt in per element).
`setupRace(ctx)`, `teardownRace()`, `update(dt)`. Owns every screen: title, main menu, mode/cc, character
select, cup/track select, options, controls, loading, HUD, pause, results, GP standings, trophy.
Drives `game.showroom.setMode(...)` to match the screen. Uses `getPortrait()` and item icons (its own SVGs).

### 6.11 Audio — `src/audio/AudioManager.js` (Presentation)

`AudioManager(game)`: `unlock()` (Game calls it on first pointerdown/keydown), `setMuted(bool)`,
`setupRace(ctx)`, `teardownRace()`, `update(dt)`, `playMusic(key)` (`'menu'|'results'|'victory'|'star'|<trackId>`),
`stopMusic(fadeSec)`, `playSfx(name, opts)`. Reacts to events + `SETTINGS_CHANGED` (volumes) by itself.

### 6.12 RaceManager — `src/race/RaceManager.js` (Orchestrator; read API)

`phase`, `phaseTime`, `time` (since GO), `countdown`, `laps`, `standings` (Kart[] by place), `leader`,
`results`, `record`, `isRacing`, `hasStarted`, `getKartByPlace(n)`, `getKartAhead(kart)`,
`distanceToLeader(kart)`, `raceFraction(kart)`, `skipIntro()`.
`RaceResult = { kart, characterId, name, isPlayer, place, time, lapTimes, bestLap, estimated, points, totalPoints }`.
`RACE_LAP.lap` is the new lap number (2..laps). `kart.lap` is always 1..laps for display.

---

## 7. Events (`src/core/events.js`)

Use `game.events.emit(EVT.X, payload)` / `game.events.on(EVT.X, fn)` (returns an unsubscribe fn — call it in
`dispose`/`teardownRace` for per-race subscriptions). The payload shapes are documented inline in `events.js`.

| Emitter | Events |
|---|---|
| Game / RaceManager | `GAME_STATE, GAME_PAUSE, SETTINGS_CHANGED, RACE_SETUP, RACE_TEARDOWN, RACE_PHASE, RACE_COUNTDOWN, RACE_START, RACE_LAP, RACE_FINISH, RACE_PLACE, RACE_WRONG_WAY, RACE_RESULTS, GP_COMPLETE` |
| Driving (Kart/collisions) | `KART_HOP, KART_LAND, KART_DRIFT_START, KART_DRIFT_LEVEL, KART_DRIFT_END, KART_BOOST, KART_STALL, KART_TRICK, KART_HIT, KART_BUMP, KART_WALL, KART_FALL, KART_RESPAWN, KART_STAR, KART_SHRINK` |
| Gameplay (ItemSystem) | `ITEM_BOX_HIT, ITEM_ROULETTE, ITEM_GET, ITEM_USE, ITEM_THROW, ITEM_HIT, ITEM_BLOCK, ITEM_EXPLODE, ITEM_DESTROY, ITEM_LIGHTNING, ITEM_COMET_WARN` |
| Presentation (UI) | `UI_NAV, UI_CONFIRM, UI_BACK, UI_SCREEN` |

Listeners: Visuals (FX) and Presentation (audio/HUD) react to nearly everything; Driving's camera shakes on
hits/explosions/walls. Emit events exactly as documented even if you don't consume them yourself.

---

## 8. Shared data (read-only)

* `src/data/characters.js` — `CHARACTERS` (8 racers: id, name, species, weightClass, stats 1–5, colors, look notes).
* `src/data/items.js` — `ITEMS` (13 items: id, name, uses, holdable, color, iconHint).
* `src/core/constants.js` — `CC_CLASSES`, `ROCKET_START`, `INTRO_DURATION`, `COUNTDOWN_STEP`, `FINISH_TIMEOUT`,
  `GP_POINTS`, `MODES`, `QUALITY` (per-preset pixelRatio/shadowMapSize/bloom/decorDensity/particles), `DEFAULT_SETTINGS`.
* `src/core/math.js` — `damp, dampFactor, clamp, lerp, smoothstep, wrapAngle, angleDiff, dampAngle, yawToForward,
  yawToRight, forwardToYaw, makeRng, weightedPick, valueNoise2D, fbm2D, ordinal, formatTime, UP`.

---

## 9. Testing & verification (do this constantly)

* **Bundle/import check:** `npm run check` (esbuild resolves every import from `src/main.js`; fails on missing exports).
* **Headless browser harness** (real GPU, prints console + page errors, saves PNG you can view with the Read tool):
  ```bash
  node scripts/snap.mjs "/?quick=1&track=canyon&skipintro=1&autodrive=1" --out=snaps/world/canyon.png --wait=6000
  node scripts/snap.mjs "/?quick=1&nocountdown=1" --wait=800 \
     --actions="down:ArrowUp;wait:1500;down:ArrowRight;down:Space;wait:1800;up:Space;up:ArrowRight;wait:400;shot:snaps/driving/drift.png"
  node scripts/snap.mjs "/?quick=1&nocountdown=1" --eval="__game.items.giveItem(__game.player,'bomb')" \
     --actions="down:ArrowUp;wait:1000;press:KeyE;wait:700;shot:snaps/gameplay/bomb.png"
  node scripts/snap.mjs "/dev/visuals/lineup.html" --out=snaps/visuals/lineup.png
  node scripts/snap.mjs "/" --probe="__game.state" --fps --noshot
  ```
  Options: `--wait=ms` (before actions), `--size=WxH`, `--actions="verb:arg;…"` (verbs: `down up press wait shot
  eval probe click`), `--eval=js`, `--probe=expr`, `--fps`, `--log=all|errors|none`, `--noshot`.
  Key names are Playwright codes: `ArrowUp`, `KeyE`, `Space`, `ShiftLeft`, `Escape`, `Enter`…
  Headless page time runs at real speed; allow a few seconds for loading.
* **URL params (Game):** `quick=1` (skip menus), `mode=quick|gp|timetrial`, `track=<id>`, `char=<id>`, `cc=50|100|150|200`,
  `laps=N`, `ai=0..7`, `autodrive=1` (AI drives the player kart), `skipintro=1`, `nocountdown=1`, `debug=1`
  (fps/draw-calls/kart overlay), `mute=1`, `nopause=1`, `quality=low|medium|high`, `timescale=0.05..8`.
* **Always look at your screenshots** (Read the PNG). Judge them like a AAA art director would. Iterate.
* Dev pages: `dev/<area>/*.html` with an inline `<script type="module">` or a sibling `.js` — served by Vite at
  `/dev/<area>/…` and usable with the snap tool.

---

## 10. Performance budget (60 fps at 1080p, Apple Silicon)

* Whole race scene ≤ ~400 draw calls and ≤ ~1.5 M triangles (check with `debug=1`).
* Track ≤ 150 draw calls (use `InstancedMesh`, merged geometries, texture atlases).
* Each kart ≤ 12 draw calls & ≤ 10k triangles (merge by material). 8 karts on screen.
* Effects ≤ 12 draw calls total (pooled instanced/points systems). Items ≤ 30 draw calls.
* One shadow-casting directional light (Track) following the focus kart; shadow frustum ≈ ±60 m.
  Karts, items and nearby larger props cast; ground/road receive.
* No per-frame allocation in hot paths; no per-frame material/geometry creation.

---

## 11. Definition of done & final report

Your area is done when every feature in your brief exists, looks/feels polished in screenshots, runs without
console errors, `npm run check` passes, and performance is in budget. Your **final message** (≤ 60 lines):
features implemented, files created, any API additions/deviations, events you emit/consume, known issues,
and anything the orchestrator must wire or fix in files you don't own.

---

## 12. Post-integration notes (API additions made by the agents)

All original contracts above hold. Notable additions (details in each module's header comment):

* **Track** — `TrackSample.ceiling` (world y of overhead geometry: cave roof, arch, gantry, bridge deck; `null`
  under open sky — the camera stays below it), `itemBoxSlots[i].hover`, `ramps[i].height`, `startGrid[i].s/.lateral`,
  `groundY(x, z)`, `landmarks[]`, `cave`/`caveF` (glacier). Surfaces: `'offroad'` = grass/sand/snow/shoulders
  (rumble curbs count as `'road'`), `'void'` = jump gaps, water, off the neon deck, `'ice'` = glacier lake/patches.
* **Kart** — extra read-only state `chassisYaw, slideAngle, yawRate, lateralSpeed, slipAmount, bodyRoll, bodyPitch,
  suspension, drafting, draftCharge, hopping, stallTime, wallContact`, getter `airborne`, `hit.lock`; methods
  `applyImpulse(vx, vz, gripTime)`, `nudgeYaw(dy)`. New boost source `'draft'` (slipstream). `forward`/`right`
  follow the travel heading; the drift slide angle lives only in `quaternion`. All tunables: `src/kart/tuning.js`
  (`TUNE`, `computeStats`, `turnRateAt`, `driftBaseRate`, `driftSteerMul` — also used by the AI).
* **Input** — `held()`, `repeated()` (menu auto-repeat), `rumble()`, `gamepadConnected`, `steerAnalog`,
  exported `KEY_BINDINGS`. `pressed()` latches sub-frame taps.
* **Camera** — exported `CAM` tunables; honors `sample.ceiling`.
* **Visuals** — `KartModel` anchors also `'front','top','center','hook'`; `PostFX.flash()/hitPulse()/stats`;
  `PostFX` sets `renderer.info.autoReset = false` (read `renderer.info` after `postfx.render`);
  `portraits.prewarmPortraits()`; `Showroom.getMode()/pulse()`.
* **Items/AI** — `items.getShield(kart)`, `stats()`, `describeDistribution(n, gap)`; `?itemseed=N` makes box rolls
  deterministic; distribution tables in `src/items/itemTables.js`; AI tunables `AI_TUNE`; racing line cached on
  `track._aiLine`.
* **UI/Audio** — `ui.goto/openOverlay/forceScreen/debugGoto`; `audio.level()/stats()/duckMusic()`.
* **Game** — dynamic resolution (`_adaptResolution`), `_clearPause()` emits `GAME_PAUSE` when a race start/quit
  clears a pause.
* **Tooling** — `npm run smoke [-- --dist]` end-to-end suite; `snap.mjs --dpr=2` for Retina-resolution tests.

---

## 13. Split-screen (local multiplayer, 2–4 humans)

Full contract: **`docs/SPLITSCREEN.md`** (wins over this document for split-screen behaviour). Summary of what Core provides:

* `startRace({ players: [{ characterId, device }] })` — 1..4 humans (`MAX_PLAYERS`), normalized into `raceConfig.players`
  (`{ index, characterId, device }`); distinct characters; time trial = 1 player; `aiCount ≤ MAX_KARTS - players`.
* `game.players` (human karts, player order), `game.player === players[0]`, `kart.playerIndex` (−1 for CPUs),
  `game.views[]` (`{ index, kart, camera, cameraController, rect, color }`), `game.layout` (`'single'|'h2'|'quad'`),
  `game.overviewRect` (3P only), `game.isSplit`. Rects are normalized with a top-left origin.
* `EVT.VIEWS_CHANGED { views, layout, overviewRect }` after views are built and (empty) on teardown.
  `RACE_SETUP`/`setupRace` ctx also carry `players` and `views`.
* Frame loop: every view's `cameraController.update`, then `postfx.renderViews(scene, views, sdt)` when there is
  more than one view (fallback: `postfx.render` for `views[0]`). `track.setShadowFocus(position)` re-aims the sun/shadow
  camera per view.
* RaceManager: phase `'finished'` starts when all humans have crossed the line; results/standings rows carry
  `playerIndex`; `getGpStandings()` marks every human and sorts humans first on ties.
* Debug URL: `players=1..4&pchars=a,b&pdev=kb1,kb2,pad0,pad1` (with `quick=1`). Smoke: `split:2|3|4`, `perf:split2|split4`.

---

## 14. Mobile (phones & tablets, single player)

Full contract and per-area ownership: **`docs/MOBILE.md`** (wins over this document for mobile behaviour). What Core provides:

* **Platform** — `src/core/platform.js` exports `PLATFORM { mobile, touch, ios, android, standalone }`; `game.platform` is the same
  object. `?mobile=1` forces the phone experience on desktop, `?mobile=0` disables it. Everything mobile is gated on it.
* **Quality** — `QUALITY.mobile` (`pixelRatio` cap 1.5, shadow 1024, no bloom, `mobile: true`). First run on a phone defaults
  `settings.quality` to `'mobile'`; an explicit Options choice (`setSetting('quality', …)`, remembered as `_qualityPicked`) wins.
  `?quality=mobile` also works. Mobile uses a non-MSAA renderer (`antialias: !PLATFORM.mobile`).
* **Dynamic resolution** (`_adaptResolution`) on mobile: steps of 0.125 down to 0.75 (desktop: 0.25, floor 1), recovery only after a
  growing lock-out so a phone that can't hold 60 fps doesn't oscillate; the level persists across races (`_dynLast`).
  `game.renderScale` (getter) = current internal pixels per CSS pixel.
* **Viewport / orientation** — resize also from `visualViewport`, `orientationchange` (re-measured at +120/+400 ms for iOS) and
  `screen.orientation`. `game.orientation` is `'landscape'|'portrait'` (always landscape off-mobile); changes emit
  `EVT.ORIENTATION { orientation }`; a running race auto-pauses in portrait (not during results, not with `?nopause=1`).
* **Pause triggers** — window blur and `visibilitychange` (hidden) pause a running race.
* **Fullscreen** — `await game.requestFullscreen()` (from a user gesture): `requestFullscreen` + `screen.orientation.lock('landscape')`;
  no-op on desktop, in an installed PWA, and on iPhone Safari.
* **WebGL context loss** — `webglcontextlost` is prevented and freezes the frame loop (and pauses the race); on
  `webglcontextrestored` the loop resumes, a running race is restarted (`restartRace()`, fresh GPU resources) and
  `EVT.CONTEXT_RESTORED { action: 'restart'|'menu' }` is emitted (UI shows a toast).
* **Single player** — `_normalizeConfig` keeps only player 1 (`device: 'any'`) when mobile; `?players=` is ignored.
* **Touch hygiene** — `touch-action: none` on html/body/#app (scrollable UI lists must set their own `touch-action: pan-y`),
  `-webkit-touch-callout: none`, `gesturestart`/context-menu/double-tap suppressed on mobile.
* **PWA** — `public/manifest.webmanifest` (fullscreen, landscape, relative `start_url`/icons), icons generated by
  `node scripts/make-icons.mjs` (Chrome rasterizes an SVG; outputs `public/icon-192|512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png`). `index.html` carries the apple/mobile web-app metas, `viewport-fit=cover`. All paths are relative, so the
  build works from `/kart-blitz/` on GitHub Pages.
* **Tooling** — `snap.mjs --mobile[=iphone|se|pixel|ipad]` (real Chrome, `isMobile`, `hasTouch`, DPR, mobile UA, landscape,
  `mobile=1` appended) with actions `tap:x,y`, `touch:x,y,ms`, `drag:x1,y1,x2,y2,ms`, `hold:…`, `multitouch:x,y,ms|x,y,ms`,
  `rotate:portrait|landscape`, `cpu:4` (see the script header; helpers in `scripts/lib/mobile.mjs`). Smoke scenarios
  `mobile:menu`, `mobile:race`, `mobile:rotate`, `mobile:context`, `perf:mobile` (4× CPU throttle at 844×390@3; budgets ≤150 draw
  calls, ≤450k triangles, ≥30 fps). Screenshots: `snaps/mobile/<agent>/`.
