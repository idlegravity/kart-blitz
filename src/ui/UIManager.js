/**
 * UIManager — every menu, the HUD, pause, results and trophy screens (DOM + CSS over the WebGL canvas).
 * OWNER: Presentation. Contract (ARCHITECTURE.md §6.10): new UIManager(game); setupRace(ctx); teardownRace(); update(dt).
 *
 * Input: menu navigation is polled in update() from `game.input.repeated('up'|'down'|'left'|'right')` (edge + auto-repeat)
 * and `game.input.pressed('confirm'|'back')`, plus mouse hover/click. During races Game owns Esc/pause; we only react to
 * GAME_PAUSE (and Backspace / gamepad B step back inside the pause menu).
 *
 * Events emitted: UI_NAV, UI_CONFIRM, UI_BACK, UI_SCREEN {screen}.
 * Events consumed: GAME_STATE, GAME_PAUSE, RACE_RESULTS, RACE_FINISH, GP_COMPLETE (+ per-race HUD subscriptions).
 * Extras: ui.goto(name), ui.openOverlay(name), ui.forceScreen(name), ui.flow (menu selection state), ui.portrait(id, size),
 * ui.debugGoto(name, params) for snap/debug scripts (e.g. --eval="void __game.ui.debugGoto('trophy', {...})").
 */
import '@fontsource/lilita-one';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './styles.css';

import { EVT } from '../core/events.js';
import { CHARACTERS } from '../data/characters.js';
import { getPortrait } from '../visuals/portraits.js';
import { h } from './dom.js';
import { DEFS_SVG, actionGlyph } from './icons.js';
import { MAX_PLAYERS } from './split.js';
import { Hud } from './hud/Hud.js';
import { TitleScreen } from './screens/TitleScreen.js';
import { MainMenuScreen } from './screens/MainMenuScreen.js';
import { PlayersScreen } from './screens/PlayersScreen.js';
import { LobbyScreen } from './screens/LobbyScreen.js';
import { CcScreen } from './screens/CcScreen.js';
import { CharacterScreen } from './screens/CharacterScreen.js';
import { CupScreen } from './screens/CupScreen.js';
import { TrackScreen } from './screens/TrackScreen.js';
import { OptionsScreen, PauseOptionsScreen } from './screens/OptionsScreen.js';
import { ControlsScreen } from './screens/ControlsScreen.js';
import { LoadingScreen } from './screens/LoadingScreen.js';
import { PauseScreen } from './screens/PauseScreen.js';
import { ResultsScreen } from './screens/ResultsScreen.js';
import { TrophyScreen } from './screens/TrophyScreen.js';

const PREFS_KEY = 'kartblitz.ui.v1';

/** Screen registry: name → class. Screens are constructed lazily on first use. */
const SCREEN_CLASSES = {
  title: TitleScreen,
  main: MainMenuScreen,
  players: PlayersScreen,
  lobby: LobbyScreen,
  cc: CcScreen,
  character: CharacterScreen,
  cup: CupScreen,
  track: TrackScreen,
  options: OptionsScreen,
  pauseOptions: PauseOptionsScreen,
  controls: ControlsScreen,
  loading: LoadingScreen,
  pause: PauseScreen,
  results: ResultsScreen,
  trophy: TrophyScreen,
};

/** Bottom hint bar with device-aware input glyphs. */
class HintBar {
  constructor(ui) {
    this.ui = ui;
    this.el = ui.layers.hints;
    this.wrap = h('div.hints');
    this.el.appendChild(this.wrap);
    this.list = [];
    this.device = 'keyboard';
  }

  set(list) {
    this.list = list || [];
    this.render();
  }

  setDevice(dev) {
    if (dev === this.device) return;
    this.device = dev;
    this.render();
  }

  render() {
    this.wrap.innerHTML = this.list
      .map(({ action, label }) => `<div class="hint"><span class="hint__g">${actionGlyph(action, this.device)}</span><span>${label}</span></div>`)
      .join('');
    this.el.classList.toggle('is-on', this.list.length > 0);
  }
}

function fallbackPortrait(id, size) {
  const c = CHARACTERS.find((x) => x.id === id) ?? CHARACTERS[0];
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = c.colors.primary;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${size * 0.5}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(c.name[0], size / 2, size / 2);
  return cv.toDataURL('image/png');
}

export class UIManager {
  /** @param {import('../Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui') ?? document.body.appendChild(h('div#ui'));
    this.root.textContent = '';
    this.root.insertAdjacentHTML('afterbegin', DEFS_SVG);

    /** DOM layers, back to front. */
    this.layers = {};
    for (const name of ['hud', 'screens', 'overlay', 'hints', 'loading']) {
      this.layers[name] = h(`div.ui-layer#ui-${name}`);
      this.root.appendChild(this.layers[name]);
    }
    this.hintBar = new HintBar(this);

    this.screens = {};
    this.current = null;
    this.currentName = null;
    this.overlay = null;
    this._portraits = new Map();
    this._showroomKey = '';
    this._pendingMenu = false;
    this._forced = null;
    this._titleShown = false;
    this._fontsReady = false;
    this._offs = [];
    this._time = 0;
    this._pendingResults = null;
    this._inputLock = 0;
    this._playerFinishAt = -99;
    this._warmIndex = 0;
    this._device = 'keyboard';

    // ---- persisted UI preferences & menu flow state ----
    const prefs = this._loadPrefs();
    /** Selection state carried through the menu flow. */
    this.flow = {
      mode: prefs.mode ?? 'quick',
      characterId: CHARACTERS.some((c) => c.id === prefs.characterId) ? prefs.characterId : 'blaze',
      trackId: prefs.trackId ?? 'meadow',
      cupId: prefs.cupId ?? 'nitro',
      cc: game.settings?.cc ?? 150,
      /** Local players (1..4). 2+ goes through the join lobby. */
      players: Math.max(1, Math.min(MAX_PLAYERS, prefs.players | 0 || 1)),
      /** Players committed by the lobby: [{ characterId, device }] (null for a single player). */
      slots: null,
    };

    this.hud = new Hud(this);

    const ev = game.events;
    const on = (name, fn) => this._offs.push(ev.on(name, fn));
    on(EVT.GAME_STATE, (p) => this._onGameState(p));
    on(EVT.GAME_PAUSE, (p) => this._onPause(p));
    on(EVT.RACE_RESULTS, (p) => this._onResults(p));
    on(EVT.RACE_FINISH, ({ kart }) => {
      if (kart?.isPlayer) this._playerFinishAt = this._time; // split-screen: the LAST human to finish wins this
    });
    on(EVT.GP_COMPLETE, (p) => this._onGpComplete(p));

    // fonts: don't reveal the first screen until Lilita One / Nunito are ready (avoids a visible swap)
    const fonts = document.fonts;
    if (fonts?.load) {
      const loads = ['400 48px "Lilita One"', '700 16px Nunito', '800 16px Nunito', '900 16px Nunito'].map((f) => fonts.load(f, 'KART BLITZ 0123').catch(() => {}));
      Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]).then(() => {
        this._fontsReady = true;
      });
    } else {
      this._fontsReady = true;
    }
  }

  // ==================================================================================================
  // public API used by Game
  // ==================================================================================================
  /** Called by Game before RACE_SETUP (state is 'loading'). A HUD failure must never prevent the race from starting. */
  setupRace(ctx) {
    try {
      this.hud.setup(ctx);
    } catch (e) {
      console.error('[ui] HUD setup failed', e);
    }
  }

  /** Called by Game when a race is torn down. */
  teardownRace() {
    try {
      this.hud.teardown();
    } catch (e) {
      console.error('[ui] HUD teardown failed', e);
    }
    this._pendingResults = null;
    this._closeOverlay(true);
  }

  update(dt) {
    this._time += dt;
    // each step is isolated: an exception here must not abort Game's frame (rendering follows ui.update)
    this._step(this._processPending);
    this._step(this._pollDevice);
    this._step(this._pollInput);
    this._step(this._warmPortraits);
    this._step(() => this.current?.update?.(dt));
    this._step(() => this.overlay?.active && this.overlay.update?.(dt));
    this._step(() => this._updatePendingResults(dt));
    this._step(() => this.loading?.update?.(dt));
    if (this.game.state === 'race') this._step(() => this.hud.update(dt));
  }

  /** Run one update step, logging (at most a few times per message) instead of throwing. */
  _step(fn) {
    try {
      fn.call(this);
    } catch (e) {
      const key = String(e?.message ?? e);
      const seen = (this._errSeen ??= new Map());
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n <= 3) console.error('[ui] update error:', e);
    }
  }

  // ==================================================================================================
  // screens
  // ==================================================================================================
  /** Get (lazily constructing) a screen instance by name. */
  getScreen(name) {
    let s = this.screens[name];
    if (!s) {
      const Cls = SCREEN_CLASSES[name];
      if (!Cls) throw new Error(`[ui] unknown screen "${name}"`);
      s = this.screens[name] = new Cls(this);
    }
    return s;
  }

  /** Switch the active menu screen. */
  goto(name, params = {}) {
    const next = this.getScreen(name);
    const prev = this.current;
    if (prev && prev !== next) prev.hide();
    this.current = next;
    this.currentName = name;
    next.show(params);
    this.game.events.emit(EVT.UI_SCREEN, { screen: name });
    return next;
  }

  /** Hide the active menu screen (e.g. when a race starts). */
  clearScreen(immediate = true) {
    this.current?.hide(immediate);
    this.current = null;
    this.currentName = null;
    this.hintBar.set([]);
  }

  /** Request that the next 'menu' state opens `name` instead of the default screen. */
  forceScreen(name, params = {}) {
    this._forced = { name, params };
  }

  /** Show an overlay screen (pause/results) on top; it receives input first. */
  openOverlay(name, params = {}) {
    const s = this.getScreen(name);
    if (this.overlay && this.overlay !== s) this.overlay.hide(true);
    this.overlay = s;
    this._inputLock = this._time + (s.inputDelay ?? 0.12);
    s.show(params);
    this.game.events.emit(EVT.UI_SCREEN, { screen: name });
    return s;
  }

  /** Return from the pause-menu Options overlay to the pause menu. */
  closePauseOptions() {
    if (this.game.paused) this.openOverlay('pause', { focus: 2 }); // land back on "Options"
    else this._closeOverlay();
  }

  _closeOverlay(immediate = false) {
    if (!this.overlay) return;
    this.overlay.hide(immediate);
    this.overlay = null;
    if (this.game.state === 'menu' && this.current) this.hintBar.set(this.current.hints());
    else if (this.game.state === 'race') this.hintBar.set([]);
  }

  /** Back action (emits UI_BACK, then the owner handles it). */
  back() {
    const o = this._owner();
    if (o) this._dispatch(o, 'back');
  }

  // ==================================================================================================
  // helpers used by screens
  // ==================================================================================================
  /** Portrait data URL (cached). Falls back to a drawn disc if the Visuals portrait fails. */
  portrait(id, size = 128) {
    const key = `${id}:${size}`;
    let url = this._portraits.get(key);
    if (!url) {
      try {
        url = getPortrait(this.game, id, size);
      } catch (e) {
        console.warn('[ui] getPortrait failed', e);
      }
      if (!url) url = fallbackPortrait(id, size);
      this._portraits.set(key, url);
    }
    return url;
  }

  _warmPortraits() {
    // stagger portrait generation over the first frames so boot stays smooth
    if (this._warmIndex >= CHARACTERS.length * 2 || this.game.state === 'race') return;
    const i = this._warmIndex++;
    const c = CHARACTERS[i >> 1];
    this.portrait(c.id, i & 1 ? 256 : 128);
  }

  /** Drive the 3D showroom (de-duplicated). */
  showroom(mode, data = {}) {
    const key = `${mode}|${data.characterId ?? data.trackId ?? (data.characterIds ?? []).join(',')}`;
    if (key === this._showroomKey) return;
    this._showroomKey = key;
    try {
      this.game.showroom?.setMode?.(mode, data);
    } catch (e) {
      console.warn('[ui] showroom.setMode failed', e);
    }
  }

  /** Change the displayed character on the turntable (select mode). */
  showroomCharacter(characterId) {
    if (this._showroomKey.startsWith('select|')) {
      this._showroomKey = `select|${characterId}`;
      try {
        this.game.showroom?.showCharacter?.(characterId);
      } catch (e) {
        console.warn('[ui] showroom.showCharacter failed', e);
      }
    } else {
      this.showroom('select', { characterId });
    }
  }

  savePrefs() {
    const f = this.flow;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ mode: f.mode, characterId: f.characterId, trackId: f.trackId, cupId: f.cupId, players: f.players }));
    } catch {
      /* storage unavailable */
    }
  }

  _loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  /** Start the race described by the current menu flow. */
  startFromFlow() {
    const f = this.flow;
    const cfg = { mode: f.mode, characterId: f.characterId, cc: f.mode === 'timetrial' ? 150 : f.cc };
    const n = f.mode === 'timetrial' ? 1 : f.players;
    if (n > 1 && f.slots?.length >= n) {
      cfg.players = f.slots.slice(0, n).map((p) => ({ characterId: p.characterId, device: p.device }));
      cfg.characterId = cfg.players[0].characterId;
    } else cfg.players = [{ characterId: f.characterId, device: 'any' }];
    if (f.mode === 'gp') cfg.cupId = f.cupId;
    else cfg.trackId = f.trackId;
    this.savePrefs();
    this.game.startRace(cfg);
  }

  get device() {
    return this._device;
  }

  // ==================================================================================================
  // game events
  // ==================================================================================================
  _onGameState({ state }) {
    if (state === 'menu') {
      this._showroomKey = ''; // re-assert the 3D showroom mode for whichever screen opens next
      this.hud.setVisible(false);
      this._pendingResults = null;
      this._closeOverlay(true);
      this.screens.loading?.hide?.();
      this._pendingMenu = true;
    } else if (state === 'loading') {
      this.clearScreen(true);
      this._pendingMenu = false;
      this._pendingResults = null;
      this._closeOverlay(true);
      this.hud.setVisible(false);
      this._showLoading();
    } else if (state === 'race') {
      this.loading?.hide();
      this.hud.enterRace();
    }
  }

  _showLoading() {
    if (!SCREEN_CLASSES.loading) return;
    this.loading = this.getScreen('loading');
    this.loading.show({ config: this.game.raceConfig, gp: this.game.gp });
  }

  _onPause({ paused }) {
    if (this.game.state !== 'race') return;
    if (paused) {
      if (SCREEN_CLASSES.pause) this.openOverlay('pause');
    } else if (this.overlay?.name === 'pause' || this.overlay?.name === 'pauseOptions') {
      // resumed by Game (Esc / P / Start / our Resume button): close whichever pause overlay is open
      this._closeOverlay();
    }
  }

  _onResults(payload) {
    if (!SCREEN_CLASSES.results) return;
    // let the player enjoy the FINISH! banner before the table slams in
    const since = this._time - this._playerFinishAt;
    const wait = since < 2.6 ? 2.6 - since : 0;
    this._pendingResults = { payload, t: wait };
    if (wait <= 0) this._updatePendingResults(0);
  }

  _updatePendingResults(dt) {
    const p = this._pendingResults;
    if (!p) return;
    if (this.game.paused) return; // hold the table back while the game is paused (window blur etc.)
    p.t -= dt;
    if (p.t > 0) return;
    this._pendingResults = null;
    if (this.game.state !== 'race') return;
    this.hud.setVisible(false, true);
    this.openOverlay('results', p.payload);
  }

  _onGpComplete(payload) {
    if (!SCREEN_CLASSES.trophy) return;
    this._forced = { name: 'trophy', params: payload };
    if (!this._pendingMenu && this.game.state === 'menu') this._processPending(true);
  }

  _processPending(force = false) {
    if (!this._pendingMenu && !force) return;
    if (!this._fontsReady) return;
    this._pendingMenu = false;
    const forced = this._forced;
    this._forced = null;
    if (forced && SCREEN_CLASSES[forced.name]) this.goto(forced.name, forced.params);
    else if (!this._titleShown) {
      this._titleShown = true;
      this.goto('title');
    } else this.goto('main');
  }

  // ==================================================================================================
  // input
  // ==================================================================================================
  _owner() {
    if (this.overlay?.active) return this.overlay;
    if (this.game.state === 'menu') return this.current;
    return null;
  }

  /** True while several humans share the menus / the race (split-screen). */
  get multi() {
    const g = this.game;
    if (g.state === 'race') return (g.views?.length ?? 0) > 1;
    return (this.flow.players ?? 1) > 1 && this.flow.mode !== 'timetrial';
  }

  /** Screen to go back to from cup / track select (the lobby when several players picked racers). */
  get racerScreen() {
    return this.flow.players > 1 && this.flow.mode !== 'timetrial' ? 'lobby' : 'character';
  }

  /**
   * The input source that drives the menus: P1's own device on the shared steps after the lobby
   * (cup / track), otherwise the merged keyboard + pads.
   */
  _menuSource() {
    const inp = this.game.input;
    const f = this.flow;
    if (this.game.state === 'menu' && !this.overlay?.active && f.players > 1 && f.mode !== 'timetrial' && f.slots?.[0]?.device && (this.currentName === 'cup' || this.currentName === 'track')) {
      return inp.getSource?.(f.slots[0].device) ?? inp;
    }
    return inp;
  }

  _pollDevice() {
    let dev = this.game.input?.lastDevice === 'gamepad' ? 'gamepad' : 'keyboard';
    const src = this._menuSource();
    if (src && src.id && src.id !== 'any') dev = src.id.startsWith('pad') ? 'gamepad' : src.id; // 'kb1' | 'kb2' | 'gamepad'
    if (dev !== this._device) {
      this._device = dev;
      this.hintBar.setDevice(dev);
      this.root.dataset.device = dev;
    }
  }

  _dispatch(owner, action) {
    if (action === 'back') {
      const handled = owner.onAction('back');
      if (handled) this.game.events.emit(EVT.UI_BACK, {});
      return handled;
    }
    return owner.onAction(action);
  }

  _pollInput() {
    const inp = this.game.input;
    if (!inp) return;
    const owner = this._owner();
    if (!owner) return;
    if (owner.rawInput) return; // e.g. the join lobby reads every device itself
    if (this._time < this._inputLock) return; // ignore the key press that opened an overlay
    const src = this._menuSource();
    // split-screen overlays (pause / results): every human can drive them with their own keys / pad
    const all = this.multi && owner === this.overlay && inp.getSource && inp.devices ? inp.devices().map((d) => inp.getSource(d)) : null;
    const edge = (a) => src.pressed(a) || (all && all.some((s) => s.pressed(a)));
    // navigation uses the InputManager's edge + auto-repeat (0.4 s delay, then every ~0.1 s); the rest are single presses
    const nav = (a) => (src.repeated ? src.repeated(a) : src.pressed(a)) || (all && all.some((s) => s.repeated?.(a)));
    for (const a of ['up', 'down', 'left', 'right']) if (nav(a)) this._dispatch(owner, a);
    for (const a of ['confirm', 'back']) if (edge(a)) this._dispatch(owner, a);
  }

  // ==================================================================================================
  // debug helpers
  // ==================================================================================================
  /** Dev/debug: jump straight to a screen (e.g. from snap.mjs --eval). */
  debugGoto(name, params = {}) {
    this._pendingMenu = false;
    this._fontsReady = true;
    if (this.game.state !== 'menu') this.game.setState?.('menu');
    this._pendingMenu = false;
    return this.goto(name, params);
  }
}

