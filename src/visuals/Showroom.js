/**
 * Showroom — the 3D stage rendered behind the menus (Game renders showroom.scene / showroom.camera whenever
 * state !== 'race'). Contract (ARCHITECTURE.md §6.7):
 *   scene, camera, update(dt), resize(w, h), showCharacter(id), setMode(mode, data)
 *   'title'  — all 8 racers in an arc, centred in the lower ~55% of the screen
 *   'menu'   — two-tier lineup framed into the right ~60%
 *   'select' { characterId } — one racer on a glowing turntable at ~70% width, pop-in swap on change
 *   'track'  { trackId }     — glowing hologram miniature of the track outline on the right half
 *   'podium' { characterIds: [1st, 2nd, 3rd] } — 3-step podium, gold trophy, confetti, celebrating racers
 * Screen placement uses camera.setViewOffset so the subject can sit anywhere without distorting the perspective.
 * Additions: getMode(), pulse(), dispose().
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { CHARACTERS, getCharacter } from '../data/characters.js';
import { EVT } from '../core/events.js';
import { TRACK_LIST, getTrackOutline } from '../track/index.js';
import { KartModel } from './KartModel.js';
import { getStudioEnvironment } from './environment.js';
import { prewarmPortraits } from './portraits.js';
import { ParticleSystem } from '../fx/ParticleSystem.js';
import { CELL } from '../fx/sprites.js';
import { Spring } from './animation.js';
import { damp, clamp } from '../core/math.js';
import { createBackdrop, createFloor, createTurntable, createPodium, createTrophy, createTrackMiniature } from './showroomParts.js';

const R = Math.random;
const rr = (a, b) => a + (b - a) * R();

/** Camera presets: position, look-at, fov, and where the look-at point lands on screen (0..1 from the top-left). */
const CAMS = {
  title: { p: [0, 2.7, 19], l: [0, 0.95, 0], fov: 34, sx: 0.5, sy: 0.7 },
  menu: { p: [0, 3.5, 17.5], l: [0, 1.5, -1.6], fov: 32, sx: 0.69, sy: 0.55 },
  select: { p: [0, 2.15, 8.4], l: [0, 0.9, 0], fov: 30, sx: 0.7, sy: 0.6 },
  track: { p: [0, 9.8, 9.6], l: [0, 0.6, 0], fov: 32, sx: 0.73, sy: 0.52 },
  podium: { p: [0, 3.4, 13.6], l: [0, 1.45, 0], fov: 34, sx: 0.5, sy: 0.54 },
};

/** Backdrop / light palettes per mode ('select' and 'track' are derived from the character / track colours). */
const THEMES = {
  title: { top: '#070b34', mid: '#3a1a86', bot: '#0b0f2e', glow: '#ff4fa8', streak: '#5ad8ff', tint: '#39d8ff', pool: '#ff4fa8', floor: '#161c48' },
  menu: { top: '#080d3a', mid: '#26208f', bot: '#0b0f2e', glow: '#36c8ff', streak: '#ff5ad8', tint: '#ff5ad8', pool: '#36c8ff', floor: '#161c48' },
  podium: { top: '#140c40', mid: '#5a2090', bot: '#0d0a28', glow: '#ffb020', streak: '#ffe27a', tint: '#ffc830', pool: '#ffb020', floor: '#1a1546' },
};

const TITLE_ORDER = ['rex', 'mochi', 'pepper', 'blaze', 'bolt', 'frost', 'nova', 'grizz'];
const MENU_FRONT = ['blaze', 'bolt', 'mochi', 'pepper'];
const MENU_BACK = ['rex', 'frost', 'nova', 'grizz'];

const _c = new THREE.Color();

export class Showroom {
  constructor(game) {
    this.game = game;
    this.quality = game.settings?.quality ?? 'high';
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.time = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, this.w / this.h, 0.1, 400);
    const r = game.renderer;
    this.scene.environment = getStudioEnvironment(r);
    this.scene.environmentIntensity = 0.9;

    // ---- backdrop, floor ----
    this.backdrop = createBackdrop();
    this.scene.add(this.backdrop.mesh);
    const pr = r.getPixelRatio();
    this.floor = createFloor(this.quality, this.w, this.h, pr);
    this.scene.add(this.floor.mesh);

    // ---- lights ----
    this.key = new THREE.SpotLight(0xfff0dd, 340, 60, 0.75, 0.85, 2);
    this.key.position.set(-6, 10, 9);
    this.key.target.position.set(0, 1, 0);
    this.key.castShadow = this.quality !== 'low';
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0003;
    this.key.shadow.camera.near = 4;
    this.key.shadow.camera.far = 40;
    this.rimA = new THREE.DirectionalLight(0x40dcff, 1.2);
    this.rimA.position.set(-9, 4, -9);
    this.rimB = new THREE.DirectionalLight(0xff4fd0, 1.05);
    this.rimB.position.set(9, 4, -9);
    this.scene.add(this.key, this.key.target, this.rimA, this.rimB, new THREE.HemisphereLight(0xbcd0ff, 0x30285a, 0.55));

    // ---- props ----
    this.turntable = createTurntable();
    this.turntable.group.visible = false;
    this.scene.add(this.turntable.group);
    this.podium = createPodium();
    this.podium.group.visible = false;
    this.scene.add(this.podium.group);
    this.trophy = createTrophy();
    this.trophy.group.position.set(0, 1.2, -3.2);
    this.trophy.group.scale.setScalar(1.85);
    this.trophy.group.visible = false;
    this.scene.add(this.trophy.group);
    this.riser = this._makeRiser();
    this.riser.position.y = -1.4;
    this.riser.visible = false;
    this.scene.add(this.riser);
    this.trackMini = null;
    this.trackId = null;

    // ---- ambient particles (own instance: bokeh, motes, confetti, sparkles) ----
    this.fx = new ParticleSystem({ additive: 2600, alpha: 1400, overlay: 200 });
    this.scene.add(this.fx.group);
    this.acc = { bokeh: 0, mote: 0, confetti: 0, trail: 0 };

    // ---- camera / theme state ----
    const c0 = CAMS.title;
    this.cam = { px: c0.p[0], py: c0.p[1], pz: c0.p[2], lx: c0.l[0], ly: c0.l[1], lz: c0.l[2], fov: c0.fov, sx: c0.sx, sy: c0.sy };
    this.tcam = { ...this.cam };
    this.theme = {};
    for (const k of ['top', 'mid', 'bot', 'glow', 'streak', 'tint', 'pool', 'floor']) this.theme[k] = new THREE.Color(THEMES.title[k]);
    this.ttheme = {};
    for (const k of Object.keys(THEMES.title)) this.ttheme[k] = new THREE.Color(THEMES.title[k]);
    this.focus = new THREE.Vector2(0, 0);
    this.tfocus = new THREE.Vector2(0, 0);

    // ---- models ----
    /** @type {Map<string, {id:string, model: KartModel, tx:number, ty:number, tz:number, yaw:number, pop: Spring, want:boolean, delay:number, shown:boolean}>} */
    this.entries = new Map();
    this.pending = [];
    this.mode = null;
    this.data = {};
    this.selectedId = null;
    this.swap = null;
    this.turn = 0;
    this.bounceT = 3;
    this.setMode('title');
    prewarmPortraits(game, CHARACTERS.map((c) => c.id));
    this.resize(this.w, this.h);
    this._off = game.events?.on?.(EVT.SETTINGS_CHANGED, ({ key, settings }) => key === 'quality' && this._onQuality(settings.quality));
  }

  // ===============================================================================================================
  // public API
  // ===============================================================================================================
  getMode() {
    return this.mode;
  }

  showCharacter(characterId) {
    if (this.mode === 'select') this._swapTo(characterId);
    else this.setMode('select', { characterId });
  }

  /**
   * @param {'title'|'menu'|'select'|'track'|'podium'} mode
   * @param {object} [data] select: { characterId } · track: { trackId } · podium: { characterIds: [1st, 2nd, 3rd] }
   */
  setMode(mode, data = {}) {
    if (!CAMS[mode]) mode = 'title';
    const prev = this.mode;
    this.mode = mode;
    this.data = data;
    const cam = CAMS[mode];
    Object.assign(this.tcam, { px: cam.p[0], py: cam.p[1], pz: cam.p[2], lx: cam.l[0], ly: cam.l[1], lz: cam.l[2], fov: cam.fov, sx: cam.sx, sy: cam.sy });
    // reset model wants
    for (const e of this.entries.values()) e.want = false;

    const pick = (ids) => ids.forEach((id, i) => this._want(id, i));
    if (mode === 'title') {
      TITLE_ORDER.forEach((id, i) => {
        const x = (i - 3.5) * 2.3;
        const lead = id === 'blaze' ? 1.2 : id === 'bolt' ? 0.7 : 0;
        const z = -0.045 * x * x + lead;
        const e = this._want(id, i);
        e.tx = x; e.ty = 0; e.tz = z;
        e.yaw = Math.atan2(-x, 19 - z) * 0.75;
        e.celebrate = false;
      });
      this.tfocus.set(0, 0);
    } else if (mode === 'menu') {
      MENU_FRONT.forEach((id, i) => {
        const e = this._want(id, i);
        e.tx = (i - 1.5) * 2.75; e.ty = 0; e.tz = 0.2;
        e.yaw = Math.atan2(-e.tx, 17) * 0.8 - 0.12;
        e.celebrate = false;
      });
      MENU_BACK.forEach((id, i) => {
        const e = this._want(id, i + 4);
        e.tx = (i - 1.5) * 2.75; e.ty = 0.95; e.tz = -3.7;
        e.yaw = Math.atan2(-e.tx, 21) * 0.8 - 0.12;
        e.celebrate = false;
      });
      this.tfocus.set(0, -1.5);
    } else if (mode === 'select') {
      const id = getCharacter(data.characterId).id;
      const e = this._want(id, 0, true);
      e.tx = 0; e.ty = 0.18; e.tz = 0; e.yaw = 0.7; e.celebrate = false;
      if (prev !== 'select' || this.selectedId !== id) {
        e.pop.reset(0);
        e.pop.kick(9);
        this._burstSwap();
      }
      this.selectedId = id;
      this.swap = null;
      this.tfocus.set(0, 0);
    } else if (mode === 'podium') {
      const ids = (data.characterIds ?? []).filter(Boolean);
      const layout = [
        { p: 1, x: 0, y: 1.5, yaw: 0.0 },
        { p: 2, x: -2.65, y: 1.0, yaw: 0.42 },
        { p: 3, x: 2.65, y: 0.66, yaw: -0.42 },
      ];
      ids.slice(0, 3).forEach((id, i) => {
        const L = layout[i];
        const e = this._want(getCharacter(id).id, i, true);
        e.tx = L.x; e.ty = L.y; e.tz = 0.1; e.yaw = L.yaw; e.celebrate = true;
        e.pop.reset(0);
        e.pop.kick(6 + i * 2);
      });
      this.tfocus.set(0, 0);
      this._confettiBurst(260);
    } else if (mode === 'track') {
      this._buildTrack(data.trackId);
      this.tfocus.set(0, 0);
    }

    // theme
    this._setTheme(mode, data);
    this.turntable.group.visible = mode === 'select';
    this.podium.group.visible = mode === 'podium';
    this.trophy.group.visible = mode === 'podium';
    if (this.trackMini) this.trackMini.group.visible = mode === 'track';
    this.riser.visible = mode === 'menu' || this.riser.position.y > -1.3;
    for (const e of this.entries.values()) e.model.setCelebrate(mode === 'podium' && e.want);
  }

  update(dt) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const t = this.time;

    // progressive model creation (keeps boot responsive)
    if (this.pending.length && this.entries.size < 64) {
      const id = this.pending.shift();
      this._ensure(id);
    }

    // ---- camera ----
    const c = this.cam, tc = this.tcam;
    const lam = 3.4;
    for (const k of Object.keys(c)) c[k] = damp(c[k], tc[k], k === 'fov' ? 3 : lam, dt);
    const swayX = Math.sin(t * 0.31) * (this.mode === 'select' ? 0.25 : 0.5);
    const swayY = Math.sin(t * 0.23) * 0.1;
    this.camera.position.set(c.px + swayX, c.py + swayY, c.pz);
    this.camera.lookAt(c.lx, c.ly, c.lz);
    if (Math.abs(this.camera.fov - c.fov) > 0.01) {
      this.camera.fov = c.fov;
    }
    this._applyView(c.sx, c.sy);

    // ---- models ----
    let idx = 0;
    for (const e of this.entries.values()) {
      const m = e.model;
      const goal = e.want ? 1 : 0;
      e.pop.k = goal ? 190 : 420;
      e.pop.c = goal ? 11 : 40;
      if (goal && e.delay > 0) {
        e.delay -= dt;
      } else e.pop.update(dt, goal);
      const s = clamp(e.pop.x, 0, 1.3);
      if (e.want || s > 0.01) {
        if (!m.root.visible) {
          m.root.visible = true;
          m.root.position.set(e.tx, e.ty, e.tz);
        }
        const rp = m.root.position;
        const damping = e.shown ? 4.2 : 100;
        rp.x = damp(rp.x, e.tx, damping, dt);
        rp.y = damp(rp.y, e.ty, damping, dt);
        rp.z = damp(rp.z, e.tz, damping, dt);
        e.shown = true;
        let yaw = e.yaw;
        if (this.mode === 'select' && e.id === this.selectedId) yaw += this.turn;
        m.root.rotation.y = e.ry = e.ry === undefined ? yaw : e.ry + (((yaw - e.ry + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * (1 - Math.exp(-6 * dt));
        m.root.scale.setScalar(Math.max(0.0001, s));
        m.update(dt, null);
      } else if (m.root.visible) {
        m.root.visible = false;
        e.shown = false;
      }
      idx++;
    }
    this.turn += dt * 0.55;

    // ---- swap (select) ----
    if (this.swap) this._updateSwap(dt);

    // ---- title life: random little hops ----
    if (this.mode === 'title' || this.mode === 'menu') {
      this.bounceT -= dt;
      if (this.bounceT <= 0) {
        this.bounceT = rr(1.6, 3.4);
        const shown = [...this.entries.values()].filter((e) => e.want && e.shown);
        if (shown.length) shown[(R() * shown.length) | 0].model.bounce(rr(0.8, 1.4));
      }
    }

    // ---- riser / props ----
    const wantRiser = this.mode === 'menu';
    this.riser.position.y = damp(this.riser.position.y, wantRiser ? 0 : -1.4, 4, dt);
    this.riser.visible = this.riser.position.y > -1.35;
    this.turntable.beamMat.uniforms.uTime.value = t;
    if (this.mode === 'podium') {
      this.trophy.group.rotation.y = t * 0.8;
      this.trophy.group.position.y = 1.2 + Math.sin(t * 1.6) * 0.07;
    }
    if (this.trackMini && this.mode === 'track') this._updateTrack(dt);

    // ---- theme ----
    const k = 1 - Math.exp(-3.2 * dt);
    for (const key of Object.keys(this.theme)) this.theme[key].lerp(this.ttheme[key], k);
    const bu = this.backdrop.uniforms;
    bu.uTime.value = t;
    bu.uTop.value.copy(this.theme.top);
    bu.uMid.value.copy(this.theme.mid);
    bu.uBot.value.copy(this.theme.bot);
    bu.uGlow.value.copy(this.theme.glow);
    bu.uStreak.value.copy(this.theme.streak);
    if (this.floor.uniforms) {
      const fu = this.floor.uniforms;
      fu.uTime.value = t;
      fu.uTint.value.copy(this.theme.tint);
      fu.uGlow.value.copy(this.theme.pool);
      fu.uFog.value.copy(this.theme.mid).lerp(this.theme.glow, 0.35).multiplyScalar(0.9);
      fu.color.value.copy(this.theme.floor);
      this.focus.x = damp(this.focus.x, this.tfocus.x, 3, dt);
      this.focus.y = damp(this.focus.y, this.tfocus.y, 3, dt);
      fu.uFocus.value.copy(this.focus);
      fu.uGrid.value = this.mode === 'track' ? 0.35 : this.mode === 'select' ? 0.6 : 1;
      fu.uPool.value = damp(fu.uPool.value, this.mode === 'track' ? 0.3 : 1, 3, dt);
      fu.uRefl.value = damp(fu.uRefl.value, this.mode === 'track' ? 0.55 : 1, 3, dt);
    }
    this.rimA.color.copy(this.theme.streak);
    this.rimB.color.copy(this.theme.glow);
    this.turntable.glowMat.color.copy(this.theme.tint).multiplyScalar(2.0);
    this.turntable.haloMat.color.copy(this.theme.tint);
    this.turntable.beamMat.uniforms.uColor.value.copy(this.theme.tint);

    // ---- particles ----
    this._ambient(dt);
    this.fx.update(dt);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.camera.aspect = w / h;
    this.camera.fov = this.cam.fov;
    this.camera.updateProjectionMatrix();
    if (this.floor.reflector) {
      const scale = this.quality === 'high' ? 0.6 : 0.4;
      const pr = this.game.renderer.getPixelRatio();
      this.floor.reflector.getRenderTarget().setSize(Math.max(128, Math.round(w * pr * scale)), Math.max(128, Math.round(h * pr * scale)));
    }
  }

  /** Little celebration flourish the UI can trigger (e.g. on confirm). */
  pulse() {
    const c = this.tfocus;
    for (let i = 0; i < 24; i++) this._spark(c.x, 0.3, c.y, [rr(1, 3), rr(1, 3), rr(1, 3)]);
    for (const e of this.entries.values()) if (e.want && e.shown) e.model.bounce(1.3);
  }

  dispose() {
    this._off?.();
    for (const e of this.entries.values()) e.model.dispose();
    this.fx.dispose();
  }

  /** Quality preset changed in the options: rebuild the floor (mirror on/off) and the cached models. */
  _onQuality(q) {
    if (!q || q === this.quality) return;
    this.quality = q;
    this.scene.remove(this.floor.mesh);
    this.floor.reflector?.dispose?.();
    this.floor.mesh.geometry.dispose();
    this.floor.mesh.material.dispose?.();
    this.floor = createFloor(q, this.w, this.h, this.game.renderer.getPixelRatio());
    this.scene.add(this.floor.mesh);
    this.key.castShadow = q !== 'low';
    for (const e of this.entries.values()) {
      this.scene.remove(e.model.root);
      e.model.dispose();
    }
    this.entries.clear();
    this.setMode(this.mode, this.data);
  }

  // ===============================================================================================================
  // internals
  // ===============================================================================================================
  _makeRiser() {
    const g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: '#0d1233', metalness: 0.35, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.3 });
    const geo = new THREE.BoxGeometry(12.6, 0.95, 4.4);
    const body = new THREE.Mesh(geo, mat);
    body.position.set(0, 0.475, -3.7);
    body.receiveShadow = true;
    g.add(body);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.06, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5ad8').multiplyScalar(3.8), toneMapped: false }));
    edge.position.set(0, 0.96, -1.5);
    g.add(edge);
    const front = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color('#36c8ff').multiplyScalar(3.6), toneMapped: false }));
    front.position.set(0, 0.08, -1.49);
    g.add(front);
    g.userData.edge = edge;
    return g;
  }

  _want(id, order = 0, immediate = false) {
    const e = this._ensure(id); // cheap once the geometry cache is warm; the stagger comes from the pop delays
    e.want = true;
    e.delay = immediate ? 0 : order * 0.06;
    return e;
  }

  _ensure(id) {
    let e = this.entries.get(id);
    if (e) return e;
    const character = getCharacter(id);
    const model = new KartModel(character, { isPlayer: false, quality: this.quality });
    model.root.visible = false;
    model.root.scale.setScalar(0.0001);
    this.scene.add(model.root);
    e = { id: character.id, model, tx: 0, ty: 0, tz: 0, yaw: 0, pop: new Spring(190, 11, 0), want: false, delay: 0, shown: false, celebrate: false };
    this.entries.set(character.id, e);
    return e;
  }

  _applyView(sx, sy) {
    const w = this.w, h = this.h;
    // shift the projection so the look-at point lands at (sx, sy) of the screen
    this.camera.setViewOffset(w, h, w / 2 - sx * w, h / 2 - sy * h, w, h);
    this.camera.updateProjectionMatrix();
  }

  _setTheme(mode, data) {
    let th = THEMES[mode];
    if (mode === 'select') {
      const ch = getCharacter(data.characterId);
      const p = new THREE.Color(ch.colors.primary), s = new THREE.Color(ch.colors.secondary), a = new THREE.Color(ch.colors.accent);
      const hsl = {};
      p.getHSL(hsl);
      const dark = (l, sat) => new THREE.Color().setHSL(hsl.h, sat, l, THREE.SRGBColorSpace);
      this.ttheme.top.copy(dark(0.04, 0.6));
      this.ttheme.mid.copy(dark(0.12, 0.8));
      this.ttheme.bot.copy(dark(0.035, 0.5));
      this.ttheme.glow.copy(p).lerp(new THREE.Color(1, 1, 1), 0.15);
      this.ttheme.streak.copy(a).lerp(new THREE.Color(1, 1, 1), 0.25);
      this.ttheme.tint.copy(a).lerp(new THREE.Color(1, 1, 1), 0.2);
      this.ttheme.pool.copy(p);
      this.ttheme.floor.copy(dark(0.07, 0.6));
      return;
    }
    if (mode === 'track') {
      const t = TRACK_LIST.find((d) => d.id === data.trackId) ?? TRACK_LIST[0];
      const p = new THREE.Color(t.colors.primary), s = new THREE.Color(t.colors.secondary), a = new THREE.Color(t.colors.accent);
      const hsl = {};
      p.getHSL(hsl);
      this.ttheme.top.setHSL(hsl.h, 0.55, 0.06, THREE.SRGBColorSpace);
      this.ttheme.mid.setHSL(hsl.h, 0.6, 0.22, THREE.SRGBColorSpace);
      this.ttheme.bot.setHSL(hsl.h, 0.5, 0.05, THREE.SRGBColorSpace);
      this.ttheme.glow.copy(p).multiplyScalar(0.8);
      this.ttheme.streak.copy(s).multiplyScalar(0.9);
      this.ttheme.tint.copy(p);
      this.ttheme.pool.copy(s).multiplyScalar(0.8);
      this.ttheme.floor.setHSL(hsl.h, 0.5, 0.1, THREE.SRGBColorSpace);
      return;
    }
    th = th ?? THEMES.title;
    for (const k of Object.keys(th)) this.ttheme[k].set(th[k]);
  }

  // ---- select swap ----
  _swapTo(id) {
    id = getCharacter(id).id;
    if (id === this.selectedId && !this.swap) return;
    const cur = this.entries.get(this.selectedId);
    this.swap = { to: id, t: 0 };
    if (cur) cur.want = false;
    this.data = { characterId: id };
    this._setTheme('select', this.data);
  }

  _updateSwap(dt) {
    const s = this.swap;
    s.t += dt;
    const cur = this.entries.get(this.selectedId);
    if (!cur || cur.pop.x < 0.12 || s.t > 0.3) {
      const e = this._ensure(s.to);
      e.want = true;
      e.delay = 0;
      e.tx = 0; e.ty = 0.18; e.tz = 0; e.yaw = 0.7;
      e.pop.reset(0);
      e.pop.kick(9.5);
      e.ry = undefined;
      e.model.root.position.set(0, 0.18, 0);
      this.selectedId = s.to;
      this.turn = 0;
      this.swap = null;
      this._burstSwap();
    }
  }

  _burstSwap() {
    const add = this.fx.additive, ov = this.fx.overlay;
    const th = this.ttheme.tint;
    const c = [th.r * 3, th.g * 3, th.b * 3];
    ov.add({ x: 0, y: 0.25, z: 0, life: 0.5, s0: 1.2, s1: 6.5, cell: CELL.RING, mode: 2, r0: c[0], g0: c[1], b0: c[2], a0: 0.9, a1: 0 });
    add.add({ x: 0, y: 0.3, z: 0, life: 0.4, s0: 1.2, s1: 4.2, cell: CELL.GLOW, r0: c[0], g0: c[1], b0: c[2], a0: 0.8, a1: 0 });
    for (let i = 0; i < 18; i++) {
      const a = R() * 6.283, sp = rr(1.5, 4.5);
      add.add({
        x: Math.cos(a) * 0.8, y: 0.4, z: Math.sin(a) * 0.8, vx: Math.cos(a) * sp, vy: rr(2, 6), vz: Math.sin(a) * sp,
        life: rr(0.7, 1.3), s0: rr(0.2, 0.42), s1: 0, cell: R() < 0.5 ? CELL.STAR : CELL.SPARKLE, rot: R() * 6, spin: rr(-4, 4), drag: 1.5, grav: 3,
        r0: c[0], g0: c[1], b0: c[2], a0: 1, a1: 0,
      });
    }
  }

  // ---- track ----
  _buildTrack(id) {
    const def = TRACK_LIST.find((d) => d.id === id) ?? TRACK_LIST[0];
    if (this.trackMini && this.trackId === def.id) {
      this.trackMini.group.visible = true;
      return;
    }
    if (this.trackMini) {
      this.scene.remove(this.trackMini.group);
      this.trackMini.group.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    }
    let outline;
    try {
      outline = getTrackOutline(def.id);
    } catch (e) {
      outline = null;
    }
    if (!outline || outline.length < 8) outline = Array.from({ length: 48 }, (_, i) => [Math.cos((i / 48) * 6.283) * 100 * (1 + 0.3 * Math.sin(i / 48 * 18)), Math.sin((i / 48) * 6.283) * 60]);
    this.trackMini = createTrackMiniature(outline, def.colors);
    this.trackMini.t = 0;
    this.trackId = def.id;
    this.scene.add(this.trackMini.group);
    this.trackMini.group.scale.setScalar(0.001);
    this.trackMini.pop = new Spring(120, 10, 0);
    this.trackMini.pop.kick(5);
  }

  _updateTrack(dt) {
    const tm = this.trackMini;
    tm.pop.update(dt, 1);
    tm.group.scale.setScalar(Math.max(0.001, tm.pop.x));
    tm.group.rotation.y = Math.sin(this.time * 0.22) * 0.3;
    tm.uniforms.uTime.value = this.time;
    tm.t = (tm.t + dt * 0.045) % 1;
    const p = tm.curve.getPointAt(tm.t);
    tm.bead.position.copy(p);
    // comet trail
    this.acc.trail += dt * 60;
    if (this.acc.trail >= 1) {
      const w = tm.group.localToWorld(p.clone());
      const th = this.ttheme.glow;
      while (this.acc.trail >= 1) {
        this.acc.trail -= 1;
        this.fx.additive.add({
          x: w.x + rr(-0.05, 0.05), y: w.y, z: w.z + rr(-0.05, 0.05), vx: rr(-0.2, 0.2), vy: rr(0.1, 0.6), vz: rr(-0.2, 0.2),
          life: rr(0.5, 0.9), s0: rr(0.3, 0.5), s1: 0.02, cell: CELL.GLOW, r0: th.r * 2.4 + 0.6, g0: th.g * 2.4 + 0.6, b0: th.b * 2.4 + 0.6, a0: 0.9, a1: 0,
        });
      }
    }
  }

  // ---- particles ----
  _spark(x, y, z, c) {
    this.fx.additive.add({ x, y, z, vx: rr(-2, 2), vy: rr(2, 5), vz: rr(-2, 2), life: rr(0.5, 1), s0: 0.3, s1: 0, cell: CELL.SPARKLE, rot: R() * 6, spin: rr(-3, 3), grav: 4, drag: 1, r0: c[0], g0: c[1], b0: c[2], a0: 1, a1: 0 });
  }

  _confettiBurst(n) {
    for (let i = 0; i < n; i++) this._confettiPiece(rr(-7, 7), rr(6, 10), rr(-4, 3));
  }

  _confettiPiece(x, y, z) {
    _c.setHSL(R(), 0.95, 0.58, THREE.SRGBColorSpace);
    this.fx.alpha.add({
      x, y, z, vx: rr(-1.2, 1.2), vy: rr(-1, 2), vz: rr(-0.8, 0.8), life: rr(4, 7), s0: rr(0.18, 0.3), s1: rr(0.18, 0.3), cell: CELL.CONFETTI, mode: 3,
      rot: R() * 6.28, spin: rr(4, 10), grav: 1.6, drag: 1.2, r0: _c.r * 1.15, g0: _c.g * 1.15, b0: _c.b * 1.15, a0: 1, a1: 1,
    });
  }

  _ambient(dt) {
    const q = this.quality === 'low' ? 0.5 : 1;
    const th = this.theme;
    const pal = [th.glow, th.streak, th.tint];
    this.acc.bokeh += dt * 5 * q;
    while (this.acc.bokeh >= 1) {
      this.acc.bokeh -= 1;
      const c = pal[(R() * 3) | 0];
      const s = rr(0.8, 3.0);
      this.fx.additive.add({
        x: rr(-26, 26), y: rr(0.6, 13), z: rr(-24, -6), vx: rr(-0.2, 0.2), vy: rr(0.05, 0.3), vz: 0,
        life: rr(7, 12), s0: s, s1: s * 1.15, cell: CELL.BOKEH, r0: c.r * 1.3 + 0.1, g0: c.g * 1.3 + 0.1, b0: c.b * 1.3 + 0.1, a0: rr(0.05, 0.16), a1: 0,
      });
    }
    this.acc.mote += dt * 16 * q;
    while (this.acc.mote >= 1) {
      this.acc.mote -= 1;
      this.fx.additive.add({
        x: rr(-9, 9), y: rr(0, 4), z: rr(-6, 5), vx: rr(-0.15, 0.15), vy: rr(0.15, 0.5), vz: rr(-0.15, 0.15),
        life: rr(4, 8), s0: rr(0.05, 0.11), s1: 0.02, cell: CELL.DOT, r0: 2, g0: 2, b0: 2.4, a0: rr(0.4, 0.9), a1: 0,
      });
    }
    if (this.mode === 'podium') {
      this.acc.confetti += dt * 46;
      while (this.acc.confetti >= 1) {
        this.acc.confetti -= 1;
        this._confettiPiece(rr(-8, 8), rr(8, 11), rr(-4, 4));
      }
      // sparkles around the trophy
      if (R() < dt * 30) {
        const p = this.trophy.group.position;
        this._spark(p.x + rr(-1.3, 1.3), p.y + rr(0.2, 3), p.z + rr(-0.6, 0.6), [3, 2.4, 0.8]);
      }
    }
  }
}
