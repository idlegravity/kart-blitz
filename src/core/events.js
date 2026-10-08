/**
 * Canonical event names + payload shapes. Emit with `game.events.emit(EVT.X, payload)`.
 * Payload objects carry live references (e.g. `kart` is the Kart instance).
 * OWNER: orchestrator. If you need a new cross-module event, define it locally in your own
 * module AND mention it in your final report so it can be promoted here.
 */
export const EVT = {
  // ---- split-screen (see docs/SPLITSCREEN.md) ----
  VIEWS_CHANGED: 'views:changed', //    { views, layout, overviewRect }  after views are built; again with views: [] on teardown

  // ---- game / app ----
  GAME_STATE: 'game:state', //          { state, prev }  state: 'boot'|'menu'|'loading'|'race'
  GAME_PAUSE: 'game:pause', //          { paused }
  SETTINGS_CHANGED: 'game:settings', // { settings, key }
  ORIENTATION: 'game:orientation', //   { orientation }  'landscape'|'portrait' (viewport shape; mobile rotate prompt)
  CONTEXT_RESTORED: 'game:contextRestored', // { action }  WebGL context was lost and came back; action: 'menu'|'restart' (UI shows a toast)

  // ---- race flow (emitted by RaceManager / Game) ----
  RACE_SETUP: 'race:setup', //          { track, karts, player, players, views, config }  after karts spawned, before intro
  RACE_TEARDOWN: 'race:teardown', //    {}                                 before the race scene is destroyed
  RACE_PHASE: 'race:phase', //          { phase, prev }  'intro'|'countdown'|'racing'|'finished'|'results'
  RACE_COUNTDOWN: 'race:countdown', //  { count }  3, 2, 1, then 0 = GO
  RACE_START: 'race:start', //          {}  (the GO moment)
  RACE_LAP: 'race:lap', //              { kart, lap, laps, lapTime, isFinalLap }  lap = new lap number (2..laps)
  RACE_FINISH: 'race:finish', //        { kart, place, time }
  RACE_PLACE: 'race:place', //          { kart, place, prev }  fired for every kart whose place changes
  RACE_WRONG_WAY: 'race:wrongWay', //   { kart, wrongWay }
  RACE_RESULTS: 'race:results', //      { results: RaceResult[], config }  (see RaceManager)
  GP_COMPLETE: 'gp:complete', //        { standings: [{ characterId, points, kart? }] }

  // ---- kart (emitted by Kart physics / collisions) ----
  KART_HOP: 'kart:hop', //              { kart }
  KART_LAND: 'kart:land', //            { kart, impact }  impact = downward speed at touchdown (m/s)
  KART_DRIFT_START: 'kart:driftStart', // { kart, dir }  dir: -1 left, +1 right
  KART_DRIFT_LEVEL: 'kart:driftLevel', // { kart, level }  1 blue, 2 orange, 3 purple (reached while drifting)
  KART_DRIFT_END: 'kart:driftEnd', //   { kart, level }  level > 0 => a mini-turbo fires
  KART_BOOST: 'kart:boost', //          { kart, source, duration, power }  source: 'miniturbo'|'nitro'|'pad'|'rocketstart'|'trick'|'goldnitro'
  KART_STALL: 'kart:stall', //          { kart }  botched rocket start (burnout)
  KART_TRICK: 'kart:trick', //          { kart }  trick performed off a ramp/crest
  KART_HIT: 'kart:hit', //              { kart, type, source }  type: 'spin'|'tumble'|'explode'|'squish'; source: Kart|null
  KART_BUMP: 'kart:bump', //            { a, b, impulse, point }  kart-vs-kart contact
  KART_WALL: 'kart:wall', //            { kart, impact, point }   impact = speed into the wall (m/s)
  KART_FALL: 'kart:fall', //            { kart }  fell off course, rescue begins
  KART_RESPAWN: 'kart:respawn', //      { kart }  placed back on the track
  KART_STAR: 'kart:star', //            { kart, active }
  KART_SHRINK: 'kart:shrink', //        { kart, active }

  // ---- items (emitted by ItemSystem) ----
  ITEM_BOX_HIT: 'item:boxHit', //       { kart, position }
  ITEM_ROULETTE: 'item:roulette', //    { kart, duration }  roulette started
  ITEM_GET: 'item:get', //              { kart, item, count }  roulette landed
  ITEM_USE: 'item:use', //              { kart, item }
  ITEM_THROW: 'item:throw', //          { kart, item, direction }  'forward'|'back'
  ITEM_HIT: 'item:hit', //              { kart, item, owner, position }  an item struck a kart
  ITEM_BLOCK: 'item:block', //          { kart, item, position }  a held item absorbed a hit
  ITEM_EXPLODE: 'item:explode', //      { position, radius, item }
  ITEM_DESTROY: 'item:destroy', //      { position, item }  projectile/hazard removed (wall, collision)
  ITEM_LIGHTNING: 'item:lightning', //  { owner }
  ITEM_COMET_WARN: 'item:cometWarn', // { target }  comet is homing on the leader

  // ---- ui (emitted by UIManager, consumed mostly by audio) ----
  UI_NAV: 'ui:nav', //                  {}  focus moved
  UI_CONFIRM: 'ui:confirm', //          {}
  UI_BACK: 'ui:back', //                {}
  UI_SCREEN: 'ui:screen', //            { screen }  e.g. 'title','main','character','track','options','results','trophy'
};
