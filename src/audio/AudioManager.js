/**
 * AudioManager — all sound: synthesized music (lookahead step-sequencer), SFX, and engine voices.
 * OWNER: Presentation. Contract (ARCHITECTURE.md §6.11):
 *   new AudioManager(game); unlock(); setMuted(bool); setupRace(ctx); teardownRace(); update(dt);
 *   playMusic(key); stopMusic(fadeSec); playSfx(name, opts)
 *
 * Graph:  songs → musicIn → lowpass(pause) → duck → musicBus ─┐
 *         sfx/engines → sfxIn ──────────────────────→ sfxBus ─┴→ master → compressor → limiter → destination
 *         (music & sfx each have a generated-impulse convolver reverb send)
 *
 * The AudioContext is created lazily on the first user gesture (unlock()), so no autoplay warnings.
 */
import { EVT } from '../core/events.js';
import { impulseResponse, clamp } from './synth.js';
import { MusicEngine } from './music.js';
import { SONGS, TRACK_MUSIC } from './songs.js';
import { SFX, SFX_META, SFX_NAMES } from './sfx.js';
import { EngineVoice, rpmTarget } from './engine.js';

const MASTER_TRIM = 1.5;
const MUSIC_TRIM = 0.9;
const SFX_TRIM = 1.0;
const ENGINE_TRIM = 0.24;
const CPU_VOICES = 3;
const HEAR_RANGE = 90; // metres
const MENU_SCREENS = new Set(['title', 'main', 'cc', 'character', 'cup', 'track', 'options', 'controls']);

export class AudioManager {
  /** @param {import('../Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.muted = false;
    this.music = null;
    this.unlocked = false;
    this._musicBase = null;
    this._starActive = false;
    this._lastWant = null;
    this._sfxState = new Map();
    this._offs = [];
    this._engines = null; // { player, cpus:[{voice, kart}] }
    this._rpm = new WeakMap();
    this._paused = false;
    this._engineScale = 1;
    this._roll = { active: false, clock: 0, idx: 0, dur: 1.8 };
    this._miniAt = new WeakMap();
    this._lastItemHit = new WeakMap();
    this._assignT = 0;
    this._pendingMusic = null;
    this._finishAt = -1e9;
    this._wired = false;
    this._wire();
  }

  // ==================================================================================================
  // public API
  // ==================================================================================================
  /** Resume/create the AudioContext (Game calls this on the first pointerdown/keydown). */
  unlock() {
    if (!this.ctx) this._build();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume?.().catch(() => {});
    if (!this.unlocked) {
      this.unlocked = true;
      this._syncToState();
    }
  }

  setMuted(m) {
    this.muted = !!m;
    this._applyVolumes();
  }

  /** Called by Game after the track + karts exist (state is still 'loading'). Never throws (audio must not block a race). */
  setupRace(ctx) {
    try {
      const id = ctx?.track?.id;
      this._musicBase = SONGS[id] ? id : 'meadow';
      this._starActive = false;
      this._lastWant = null;
      this._roll.active = false;
      this._engineScale = 1;
      this._paused = false;
      this._pendingMusic = null;
      this.music?.setTempoScale(1);
      if (this.ctx) {
        this._applyMusic(0.5);
        this._buildEngines();
      }
    } catch (e) {
      console.error('[audio] setupRace failed', e);
    }
  }

  teardownRace() {
    try {
      this._destroyEngines();
      this.music?.setTempoScale(1);
      this._starActive = false;
      this._roll.active = false;
      this._paused = false;
      this._setPauseFx(false);
    } catch (e) {
      console.error('[audio] teardownRace failed', e);
    }
  }

  /** Start (or crossfade to) a song: 'menu' | 'results' | 'victory' | 'star' | a track id. */
  playMusic(key, { fade = 0.9 } = {}) {
    if (!SONGS[key]) return;
    this._musicBase = key;
    if (this.ctx) this._applyMusic(fade);
  }

  stopMusic(fadeSec = 0.8) {
    this._musicBase = null;
    this._lastWant = null;
    this.music?.stop(fadeSec);
  }

  /**
   * Play a synthesized effect. opts: { position: Vector3, kart, volume, pitch, delay, reverb, ...sfx-specific }.
   * Sounds that belong to another kart (or a world position) are attenuated/panned relative to the camera.
   */
  playSfx(name, opts = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const fn = SFX[name];
    if (!fn) return;
    const meta = SFX_META[name] ?? {};
    const now = ctx.currentTime;
    let st = this._sfxState.get(name);
    if (!st) this._sfxState.set(name, (st = { last: -9, ends: [] }));
    if (meta.cool && now - st.last < meta.cool) return;
    if (meta.max) {
      st.ends = st.ends.filter((e) => e > now);
      if (st.ends.length >= meta.max) return;
    }
    const sp = this._spatial(opts);
    if (!sp) return;
    st.last = now;
    st.ends.push(now + (meta.len ?? 0.7));
    const out = ctx.createGain();
    out.gain.value = sp.gain * (opts.volume ?? 1);
    let node = out;
    if (sp.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = sp.pan;
      out.connect(p);
      node = p;
    }
    node.connect(this.sfxIn);
    const rev = (meta.rev ?? 0) * (opts.reverb ?? 1);
    if (rev > 0) {
      const send = ctx.createGain();
      send.gain.value = rev;
      node.connect(send).connect(this.sfxRevIn);
    }
    const pitch = (opts.pitch ?? 1) * (opts.noVary ? 1 : 1 + (Math.random() - 0.5) * 0.04);
    try {
      fn({ ctx, out, t: now + (opts.delay ?? 0.004), v: 1, p: pitch, o: opts });
    } catch (e) {
      console.warn('[audio] sfx failed:', name, e);
    }
  }

  /** Duck the music (e.g. under fanfares / thunder). amount 0..1. */
  duckMusic(amount = 0.5, hold = 1.2, release = 0.8) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const p = this.musicDuck.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(1 - amount, now + 0.06);
    if (!this._paused) {
      p.setValueAtTime(1 - amount, now + 0.06 + hold);
      p.linearRampToValueAtTime(1, now + 0.06 + hold + release);
    }
  }

  /** Instantaneous output level over the last ~46 ms: { rms, peak, db } (linear amplitude + dBFS of the RMS). */
  level() {
    if (!this.meterNode) return { rms: 0, peak: 0, db: -120 };
    const buf = this._meterBuf;
    this.meterNode.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      sum += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / buf.length);
    return { rms, peak, db: rms > 1e-6 ? 20 * Math.log10(rms) : -120 };
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Debug helper: counts of live players/voices. */
  stats() {
    return {
      state: this.ctx?.state ?? 'none',
      music: this.music?.currentKey ?? null,
      players: this.music?.players.length ?? 0,
      tempo: this.music?.tempoScale ?? 1,
      engines: this._engines ? 1 + this._engines.cpus.filter((c) => c.kart).length : 0,
      time: this.ctx?.currentTime ?? 0,
    };
  }

  // ==================================================================================================
  // graph
  // ==================================================================================================
  _build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      console.warn('[audio] AudioContext unavailable', e);
      return;
    }
    this.ctx = ctx;
    this.master = ctx.createGain();
    // gentle "glue" compressor, then a fast brickwall limiter so loud moments (explosions on top of a fanfare, or a
    // user pushing every slider to 100%) never clip the output
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.22;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.09;
    this.master.connect(this.comp).connect(this.limiter).connect(ctx.destination);
    // metering tap (debug / mix calibration): AudioManager.level() reads it on demand, no per-frame cost
    this.meterNode = ctx.createAnalyser();
    this.meterNode.fftSize = 2048;
    this.meterNode.smoothingTimeConstant = 0;
    this.limiter.connect(this.meterNode);
    this._meterBuf = new Float32Array(this.meterNode.fftSize);

    // music
    this.musicIn = ctx.createGain();
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicFilter.Q.value = 0.5;
    this.musicDuck = ctx.createGain();
    this.musicBus = ctx.createGain();
    // tame inaudible sub-rumble and add a touch of air so small speakers get a clear mix
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 38;
    hp.Q.value = 0.6;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 5500;
    shelf.gain.value = 2.5;
    this.musicIn.connect(hp).connect(shelf).connect(this.musicFilter).connect(this.musicDuck).connect(this.musicBus).connect(this.master);
    this.musicConv = ctx.createConvolver();
    this.musicConv.buffer = impulseResponse(ctx, 2.6, 2.8, { damp: 0.45 });
    this.musicRevIn = ctx.createGain();
    this.musicRevIn.connect(this.musicConv).connect(this.musicIn);

    // sfx
    this.sfxIn = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.sfxIn.connect(this.sfxBus).connect(this.master);
    this.sfxConv = ctx.createConvolver();
    this.sfxConv.buffer = impulseResponse(ctx, 1.9, 3.2, { damp: 0.5 });
    this.sfxRevIn = ctx.createGain();
    this.sfxRevIn.connect(this.sfxConv).connect(this.sfxBus);
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = ENGINE_TRIM;
    this.engineBus.connect(this.sfxBus);

    this.music = new MusicEngine(ctx, { dest: this.musicIn, reverb: this.musicRevIn, songs: SONGS });
    this._applyVolumes(true);
    // don't let the sequencer starve (and the mix glitch) while the tab is hidden: freeze audio time instead
    this._onVis = () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend?.().catch(() => {});
      else if (this.unlocked) this.ctx.resume?.().catch(() => {});
    };
    document.addEventListener('visibilitychange', this._onVis);
  }

  _applyVolumes(instant = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.game.settings ?? {};
    const sq = (v, d) => {
      const x = clamp(Number.isFinite(v) ? v : d, 0, 1);
      return x * x;
    };
    const now = ctx.currentTime;
    const tc = instant ? 0.001 : 0.05;
    this.master.gain.setTargetAtTime(this.muted ? 0 : sq(s.masterVolume, 0.8) * MASTER_TRIM, now, tc);
    this.musicBus.gain.setTargetAtTime(sq(s.musicVolume, 0.55) * MUSIC_TRIM, now, tc);
    this.sfxBus.gain.setTargetAtTime(sq(s.sfxVolume, 0.85) * SFX_TRIM, now, tc);
  }

  // ==================================================================================================
  // music selection
  // ==================================================================================================
  _applyMusic(fade = 0.9) {
    if (!this.music) return;
    const base = this._musicBase;
    const want = this._starActive ? 'star' : base;
    if (!want) return;
    const resume = want === base && this._lastWant === 'star';
    this.music.play(want, { fade: want === 'star' ? 0.2 : fade, resume });
    this._lastWant = want;
  }

  _syncToState() {
    const g = this.game;
    if (g.state === 'menu') this._musicBase = this._musicBase ?? 'menu';
    else if (g.state === 'race' && g.track && !this._musicBase) this._musicBase = SONGS[g.track.id] ? g.track.id : 'meadow';
    this._applyMusic(0.6);
    if (g.state === 'race') this._buildEngines();
  }

  // ==================================================================================================
  // events
  // ==================================================================================================
  _wire() {
    if (this._wired) return;
    this._wired = true;
    const g = this.game;
    const on = (evt, fn) => this._offs.push(g.events.on(evt, fn));
    const isP = (k) => !!k && k === g.player;
    const sfx = (n, o) => this.playSfx(n, o);

    on(EVT.SETTINGS_CHANGED, () => this._applyVolumes());
    on(EVT.GAME_STATE, ({ state, prev }) => {
      if (state === 'menu') {
        this.music?.setTempoScale(1);
        this._starActive = false;
        this.playMusic('menu', { fade: 1.1 });
      } else if (state === 'loading') {
        this._musicBase = null;
        this.music?.stop(0.35);
        this._lastWant = null;
      } else if (state === 'race' && g.race?.phase === 'countdown') {
        sfx('countdownBeep', { noVary: true });
      }
      void prev;
    });
    on(EVT.GAME_PAUSE, ({ paused }) => {
      this._paused = paused;
      this._setPauseFx(paused);
      sfx(paused ? 'pauseOn' : 'pauseOff', { noVary: true });
    });

    // ---- ui
    on(EVT.UI_NAV, () => sfx('uiTick'));
    on(EVT.UI_CONFIRM, () => sfx('uiConfirm'));
    on(EVT.UI_BACK, () => sfx('uiBack'));
    on(EVT.UI_SCREEN, ({ screen }) => {
      if (screen === 'results') sfx('resultsIn', { noVary: true });
      else if (screen !== 'pause' && screen !== 'pauseOptions' && screen !== 'loading') sfx('uiScreen');
      // leaving the trophy ceremony (no state change is emitted) → back to the menu song
      if (MENU_SCREENS.has(screen) && g.state === 'menu' && this._musicBase !== 'menu') this.playMusic('menu', { fade: 1.2 });
    });

    // ---- race flow
    on(EVT.RACE_COUNTDOWN, ({ count }) => {
      // beats emitted while still 'loading' are replayed when the race actually starts (see GAME_STATE below)
      if (this.game.state !== 'race') return;
      sfx(count > 0 ? 'countdownBeep' : 'countdownGo', { noVary: true });
    });
    on(EVT.RACE_LAP, ({ kart, isFinalLap }) => {
      if (!isP(kart)) return;
      if (isFinalLap) {
        sfx('finalLap', { noVary: true });
        this.music?.setTempoScale(1.12);
        this.duckMusic(0.3, 0.6, 0.6);
      } else sfx('lap', { noVary: true });
    });
    on(EVT.RACE_FINISH, ({ kart, place }) => {
      if (!isP(kart)) return;
      this._finishAt = performance.now();
      sfx(place <= 3 ? 'finishWin' : 'finishLose', { noVary: true });
      this.duckMusic(0.55, 2.4, 1.2);
    });
    on(EVT.RACE_PLACE, ({ kart, place, prev }) => {
      if (!isP(kart) || g.race?.phase !== 'racing' || !(prev > 0)) return;
      sfx(place < prev ? 'placeUp' : 'placeDown');
    });
    on(EVT.RACE_WRONG_WAY, ({ kart, wrongWay }) => {
      if (isP(kart) && wrongWay) sfx('wrongWay');
    });
    on(EVT.RACE_RESULTS, ({ results }) => {
      const me = results?.find((r) => r.isPlayer);
      this.music?.setTempoScale(1);
      this._starActive = false;
      this._engineScale = 0.25;
      // let the finish fanfare breathe before the results tune takes over (UI shows the table after ~2.6 s)
      const key = me && me.place <= 3 ? 'victory' : 'results';
      const since = (performance.now() - (this._finishAt ?? -1e9)) / 1000;
      const wait = Math.max(0, 2.5 - since);
      this._pendingMusic = { key, at: performance.now() + wait * 1000 };
    });
    on(EVT.GP_COMPLETE, ({ standings }) => {
      const idx = standings?.findIndex((s) => s.isPlayer) ?? -1;
      this._musicBase = idx >= 0 && idx < 3 ? 'victory' : 'results';
      this._pendingMusic = null;
      if (this.ctx) this._applyMusic(0.8);
    });

    // ---- karts
    on(EVT.KART_HOP, ({ kart }) => sfx('hop', { kart, volume: isP(kart) ? 1 : 0.6 }));
    on(EVT.KART_LAND, ({ kart, impact }) => {
      if (impact > 3) sfx('land', { kart, impact, volume: isP(kart) ? 1 : 0.55 });
    });
    on(EVT.KART_DRIFT_START, ({ kart }) => {
      if (isP(kart)) sfx('driftStart', { kart });
    });
    on(EVT.KART_DRIFT_LEVEL, ({ kart, level }) => {
      if (isP(kart)) sfx('driftLevel', { kart, level, noVary: true });
    });
    on(EVT.KART_DRIFT_END, ({ kart, level }) => {
      if (level > 0) {
        this._miniAt.set(kart, this.ctx?.currentTime ?? 0);
        sfx('miniturbo', { kart, level, volume: isP(kart) ? 1 : 0.55 });
      }
    });
    on(EVT.KART_BOOST, ({ kart, source }) => {
      const vol = isP(kart) ? 1 : 0.55;
      switch (source) {
        case 'pad': sfx('boostPad', { kart, volume: vol }); break;
        case 'nitro': sfx('nitro', { kart, volume: vol }); break;
        case 'goldnitro': sfx('goldnitro', { kart, volume: vol }); break;
        case 'rocketstart': sfx('rocketStart', { kart, volume: vol }); break;
        case 'trick': sfx('boostPad', { kart, volume: vol * 0.7, pitch: 1.2 }); break;
        case 'draft': sfx('draft', { kart, volume: isP(kart) ? 1 : 0.4 }); break;
        case 'miniturbo': {
          const last = this._miniAt.get(kart) ?? -9;
          if ((this.ctx?.currentTime ?? 0) - last > 0.25) sfx('miniturbo', { kart, level: 1, volume: vol });
          break;
        }
        default:
      }
    });
    on(EVT.KART_STALL, ({ kart }) => sfx('stall', { kart, volume: isP(kart) ? 1 : 0.6 }));
    on(EVT.KART_TRICK, ({ kart }) => sfx('trick', { kart, volume: isP(kart) ? 1 : 0.5 }));
    on(EVT.KART_HIT, ({ kart, type }) => {
      const vol = isP(kart) ? 1 : 0.7;
      if (type === 'spin') {
        // KART_HIT fires just before the ITEM_HIT that caused it; if an item sound (banana slip / orb) follows in the
        // same frame it already covers the spin, so decide after the synchronous burst of events has finished
        queueMicrotask(() => {
          const t = this.ctx?.currentTime ?? 0;
          if (t - (this._lastItemHit.get(kart) ?? -9) > 0.15) sfx('spin', { kart, volume: vol });
        });
      } else if (type === 'tumble') sfx('tumble', { kart, volume: vol });
      else if (type === 'squish') sfx('squish', { kart, volume: vol });
    });
    on(EVT.KART_BUMP, ({ a, b, impulse, point }) => {
      const involved = isP(a) || isP(b);
      sfx('bump', { position: point ?? a?.position, impulse: clamp((impulse ?? 0.5) / 2, 0.25, 1), volume: involved ? 1 : 0.6 });
    });
    on(EVT.KART_WALL, ({ kart, impact, point }) => {
      if ((impact ?? 0) < 2) return;
      sfx('wall', { kart, position: point, impact, volume: isP(kart) ? 1 : 0.6 });
    });
    on(EVT.KART_FALL, ({ kart }) => sfx('fall', { kart, volume: isP(kart) ? 1 : 0.5 }));
    on(EVT.KART_RESPAWN, ({ kart }) => sfx('respawn', { kart, volume: isP(kart) ? 1 : 0.5 }));
    on(EVT.KART_STAR, ({ kart, active }) => {
      if (active) sfx('starStart', { kart, volume: isP(kart) ? 1 : 0.5 });
    });
    on(EVT.KART_SHRINK, ({ kart, active }) => sfx(active ? 'shrink' : 'grow', { kart, volume: isP(kart) ? 1 : 0.6 }));

    // ---- items
    on(EVT.ITEM_BOX_HIT, ({ kart, position }) => sfx('boxHit', { kart, position, volume: isP(kart) ? 1 : 0.6 }));
    on(EVT.ITEM_ROULETTE, ({ kart, duration }) => {
      if (!isP(kart)) return;
      this._roll.dur = duration || 1.8;
    });
    on(EVT.ITEM_GET, ({ kart }) => {
      if (!isP(kart)) return;
      sfx('itemGet', { noVary: true });
    });
    on(EVT.ITEM_THROW, ({ kart, item, direction }) => {
      const vol = isP(kart) ? 1 : 0.6;
      if (direction === 'back') sfx(item === 'banana' || item === 'banana3' || item === 'bomb' ? 'drop' : 'throwBack', { kart, volume: vol });
      else sfx('throw', { kart, volume: vol });
    });
    on(EVT.ITEM_HIT, ({ kart, item, position }) => {
      const t = this.ctx?.currentTime ?? 0;
      this._lastItemHit.set(kart, t);
      const vol = isP(kart) ? 1 : 0.7;
      const base = String(item ?? '').replace(/3$/, '');
      if (base === 'banana') sfx('slip', { kart, position, volume: vol });
      else if (base === 'bouncer' || base === 'seeker') sfx('orbHit', { kart, position, volume: vol });
      if (base === 'comet') this._cometSirenStop();
    });
    on(EVT.ITEM_BLOCK, ({ kart, position }) => sfx('block', { kart, position, volume: isP(kart) ? 1 : 0.7 }));
    on(EVT.ITEM_EXPLODE, ({ position, radius, item }) => {
      sfx('explosion', { position, size: clamp((radius ?? 7) / 7, 0.6, 1.5), noVary: false });
      if (item === 'comet') this._cometSirenStop();
      const p = g.player;
      if (p && position && Math.hypot(p.position.x - position.x, p.position.z - position.z) < 25) this.duckMusic(0.35, 0.3, 0.9);
    });
    on(EVT.ITEM_DESTROY, ({ position }) => sfx('destroy', { position, volume: 0.6 }));
    on(EVT.ITEM_LIGHTNING, () => {
      sfx('lightning', { noVary: true, global: true });
      this.duckMusic(0.5, 1.4, 1.2);
    });
    on(EVT.ITEM_COMET_WARN, ({ target }) => {
      if (isP(target)) sfx('siren', { noVary: true, dur: 3.2 });
    });
  }

  _cometSirenStop() {
    // sirens are short one-shots (3.2s); nothing persistent to stop, but clear the cooldown so a new warning can play
    this._sfxState.get('siren')?.ends.splice(0);
  }

  _setPauseFx(paused) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.musicFilter.frequency.cancelScheduledValues(now);
    this.musicFilter.frequency.setTargetAtTime(paused ? 650 : 20000, now, paused ? 0.06 : 0.25);
    const d = this.musicDuck.gain;
    d.cancelScheduledValues(now);
    d.setValueAtTime(d.value, now);
    d.linearRampToValueAtTime(paused ? 0.55 : 1, now + (paused ? 0.15 : 0.4));
  }

  // ==================================================================================================
  // spatial
  // ==================================================================================================
  /** Returns { gain, pan } for a sound source, or null when inaudible. Player / global sounds are centred. */
  _spatial(o) {
    const g = this.game;
    if (o.global || (o.kart && o.kart === g.player)) return { gain: 1, pan: 0 };
    const pos = o.position ?? o.kart?.position;
    const cam = g.camera;
    if (!pos || !cam) return { gain: 1, pan: 0 };
    const cp = cam.position;
    const dx = pos.x - cp.x, dy = pos.y - cp.y, dz = pos.z - cp.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > HEAR_RANGE) return null;
    const gain = 1 / (1 + Math.pow(dist / 14, 1.5));
    if (gain < 0.035) return null;
    const e = cam.matrixWorld?.elements;
    let pan = 0;
    if (e && dist > 0.001) pan = clamp(((dx * e[0] + dy * e[1] + dz * e[2]) / dist) * 0.85, -0.85, 0.85);
    return { gain, pan };
  }

  // ==================================================================================================
  // engines
  // ==================================================================================================
  _buildEngines() {
    if (this._engines || !this.ctx || !this.game.player) return;
    const ctx = this.ctx;
    this._engines = {
      player: new EngineVoice(ctx, this.engineBus, { player: true }),
      cpus: Array.from({ length: CPU_VOICES }, () => ({ voice: new EngineVoice(ctx, this.engineBus, { player: false }), kart: null })),
    };
    this._assignT = 0;
  }

  _destroyEngines() {
    const e = this._engines;
    if (!e) return;
    e.player.dispose();
    for (const c of e.cpus) c.voice.dispose();
    this._engines = null;
  }

  /** Tyre-squeal intensity 0..1 from the kart's slip (Kart.slipAmount) and drifting state; silent airborne / off-road. */
  _skid(k) {
    if (k.airborne ?? k.grounded === false) return 0;
    if (k.surface === 'offroad') return 0;
    const drift = k.drifting ? 0.5 + 0.35 * Math.abs(k.steerAmount ?? 0) : 0;
    return clamp(Math.max(drift, (k.slipAmount ?? 0) * 0.9), 0, 1);
  }

  _kartRpm(kart, dt) {
    let r = this._rpm.get(kart);
    if (r === undefined) r = rpmTarget(kart);
    const tgt = rpmTarget(kart);
    const lambda = tgt > r ? 9 : 4;
    r += (tgt - r) * (1 - Math.exp(-lambda * dt));
    this._rpm.set(kart, r);
    return r;
  }

  _updateEngines(dt) {
    const g = this.game;
    if (g.state !== 'race' || !g.player) {
      if (this._engines) this._destroyEngines();
      return;
    }
    if (!this._engines) this._buildEngines();
    const e = this._engines;
    if (!e) return;
    // hushed during the intro flyover, full presence from the countdown (revving) on, faded out under the results
    const quiet = this._paused ? 0 : this._engineScale * (g.race?.phase === 'intro' ? 0.3 : 1);
    const p = g.player;
    const pv = p.velocity;

    // ---- player
    {
      const rpm = this._kartRpm(p, dt);
      const top = Math.max(p.topSpeed || 30, 10);
      e.player.update(dt, {
        rpm,
        throttle: p.throttleAmount ?? 0,
        boost: p.boostTime > 0 ? clamp(p.boostPower ?? 1, 0, 1.3) : 0,
        skid: this._skid(p),
        skidLevel: p.driftLevel || 0,
        offroad: p.surface === 'offroad' ? clamp(Math.abs(p.speed) / top, 0, 1) : 0,
        gain: 0.85 * quiet,
        pan: 0,
        pitch: p.shrinkTime > 0 ? 1.35 : 1,
      });
    }

    // ---- CPU voices: the 3 nearest karts get a voice, attenuated & panned from the camera
    this._assignT -= dt;
    const cam = g.camera;
    if (this._assignT <= 0) {
      this._assignT = 0.25;
      const cands = [];
      for (const k of g.karts) {
        if (k === p) continue;
        const dx = k.position.x - cam.position.x, dz = k.position.z - cam.position.z;
        cands.push({ k, d: Math.hypot(dx, dz) });
      }
      cands.sort((a, b) => a.d - b.d);
      const want = cands.slice(0, CPU_VOICES).filter((c) => c.d < HEAR_RANGE).map((c) => c.k);
      // keep existing assignments that are still wanted
      for (const slot of e.cpus) if (slot.kart && !want.includes(slot.kart)) slot.kart = null;
      for (const k of want) {
        if (e.cpus.some((s) => s.kart === k)) continue;
        const free = e.cpus.find((s) => !s.kart);
        if (free) free.kart = k;
      }
    }
    const el = cam.matrixWorld?.elements;
    for (const slot of e.cpus) {
      const k = slot.kart;
      if (!k) {
        slot.voice.update(dt, { rpm: 0.2, throttle: 0, boost: 0, skid: 0, gain: 0 });
        continue;
      }
      const dx = k.position.x - cam.position.x, dy = k.position.y - cam.position.y, dz = k.position.z - cam.position.z;
      const dist = Math.max(0.5, Math.hypot(dx, dy, dz));
      const nx = dx / dist, ny = dy / dist, nz = dz / dist;
      const rpm = this._kartRpm(k, dt);
      const att = 1 / (1 + Math.pow(dist / 11, 1.4));
      const vrel = (k.velocity.x - pv.x) * nx + (k.velocity.y - pv.y) * ny + (k.velocity.z - pv.z) * nz;
      slot.voice.update(dt, {
        rpm,
        throttle: k.throttleAmount ?? k.input?.throttle ?? 0,
        boost: 0,
        skid: this._skid(k) * 0.9,
        skidLevel: k.driftLevel || 0,
        gain: att * 0.8 * quiet,
        pan: el ? clamp((nx * el[0] + ny * el[1] + nz * el[2]) * 0.9, -0.9, 0.9) : 0,
        pitch: clamp(1 / (1 + vrel / 130), 0.86, 1.16) * (k.shrinkTime > 0 ? 1.35 : 1),
        airCut: 2600 + 15000 * att,
        air: clamp(0.55 + att, 0.55, 1),
      });
    }
  }

  /** Re-attempt ctx.resume() at most twice a second, and only once the page has had a user gesture (no console spam). */
  _tryResume(dt) {
    this._resumeT = (this._resumeT ?? 0) - dt;
    if (this._resumeT > 0) return;
    this._resumeT = 0.5;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    this.ctx.resume?.().catch(() => {});
  }

  // ==================================================================================================
  // frame
  // ==================================================================================================
  update(dt) {
    if (!this.ctx) return;
    try {
      this._update(dt);
    } catch (e) {
      const key = String(e?.message ?? e);
      const seen = (this._errSeen ??= new Map());
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n <= 3) console.error('[audio] update error:', e);
    }
  }

  _update(dt) {
    const ctx = this.ctx;
    if (ctx.state !== 'running' && this.unlocked && !document.hidden) this._tryResume(dt);
    const g = this.game;
    const p = g.player;
    const pm = this._pendingMusic;
    if (pm && performance.now() >= pm.at) {
      this._pendingMusic = null;
      this._musicBase = pm.key;
      this._applyMusic(1.0);
    }

    if (g.state === 'race' && p) {
      // star power → frantic music, back to the race song afterwards
      const star = p.starTime > 0 && g.race.phase !== 'results';
      if (star !== this._starActive) {
        this._starActive = star;
        this._applyMusic(0.5);
      }
      // roulette ticks (same cadence as the HUD)
      const r = this._roll;
      if (this._paused) {
        // frozen while paused
      } else if (p.rouletteTime > 0) {
        if (!r.active) {
          r.active = true;
          r.clock = 0;
          r.idx = 0;
        }
        const progress = clamp(1 - p.rouletteTime / r.dur, 0, 1);
        r.clock += dt;
        if (r.clock >= 0.05 + 0.16 * progress * progress) {
          r.clock = 0;
          r.idx++;
          this.playSfx('rouletteTick', { index: r.idx % 9, noVary: true });
        }
      } else r.active = false;
    } else if (this._starActive) {
      this._starActive = false;
    }
    this._updateEngines(dt);
  }
}

export { SFX_NAMES, TRACK_MUSIC, SONGS };
