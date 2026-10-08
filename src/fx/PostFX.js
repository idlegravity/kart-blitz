/**
 * PostFX — the whole frame pipeline.
 *   RenderPass (HDR HalfFloat target, MSAA 4/2/0 by quality) → UnrealBloomPass (only HDR emissives / sparks / hot
 *   speculars glow) → custom grade pass (radial speed blur, chromatic aberration, anime speed lines, screen flash,
 *   hit vignette, vignette, exposure / saturation / contrast) → OutputPass (ACES + sRGB) → FXAA (low quality only).
 * Contract (ARCHITECTURE.md §6.6): render(scene, camera, dt), setSize(w, h), setQuality(q).
 * Additions: flash(intensity, color, duration, kart?), hitPulse(amount, kart?), setLook(partial), stats.
 * Split-screen: renderViews(scene, views, dt) runs the SAME pipeline once per viewport (one shared composer resized
 * to the viewport; the final pass draws straight into the viewport rect of the canvas). Per-view speed blur / CA /
 * lines / flash / hit state is driven by view.kart. Split mode caps MSAA at x2 and re-aims the track's shadow camera
 * (track.setShadowFocus) at each view's kart before drawing it.
 * `renderer.info` is kept meaningful for the debug overlay: calls / triangles report the SCENE pass (incl. shadows),
 * not the post-processing quads.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GradeShader } from './postShaders.js';
import { MobilePost } from './MobilePost.js';
import { clamp, damp } from '../core/math.js';
import { MAX_PLAYERS } from '../core/constants.js';

class SceneRenderPass extends RenderPass {
  constructor(scene, camera) {
    super(scene, camera);
    this.stats = { calls: 0, triangles: 0, points: 0, lines: 0 };
  }
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    const r = renderer.info.render;
    this.stats.calls = r.calls;
    this.stats.triangles = r.triangles;
    this.stats.points = r.points;
    this.stats.lines = r.lines;
  }
}

/** Look presets (bloom + grade). Race is restrained (only emissives glow); menu is a touch dreamier. */
const OVERVIEW_BG = '#0b0d24';

function makeViewState() {
  return { blur: 0, ca: 0, lines: 0, flashV: 0, flashDecay: 4, flashColor: new THREE.Color(1, 1, 1), hitV: 0 };
}

const LOOKS = {
  race: { bloom: 0.36, radius: 0.5, threshold: 1.45, knee: 1.3, vignette: 0.26, saturation: 1.16, contrast: 1.07, exposure: 1.0 },
  menu: { bloom: 0.34, radius: 0.55, threshold: 1.7, knee: 1.5, vignette: 0.34, saturation: 1.12, contrast: 1.08, exposure: 1.0 },
};

export class PostFX {
  constructor(game) {
    this.game = game;
    const r = game.renderer;
    this.renderer = r;
    this.quality = game.settings?.quality ?? 'high';
    r.info.autoReset = false;

    /** 'mobile' preset → cheap single-target pipeline (MobilePost); everything else → EffectComposer pipeline. */
    this.mobile = this.quality === 'mobile';
    this.composer = null;
    this._mp = null;
    this._ensurePipeline();

    this.look = { ...LOOKS.race };
    this._lookName = 'race';
    this.blur = 0;
    this.ca = 0;
    this.lines = 0;
    this.flashV = 0;
    this.flashDecay = 4;
    this.hitV = 0;
    this.time = 0;
    this.stats = { calls: 0, triangles: 0, views: 1 };
    /** per-viewport FX state (index = player index) for renderViews() */
    this._vs = Array.from({ length: MAX_PLAYERS }, makeViewState);
    this._split = 0; // number of views the composer is currently sized for (0 = full screen)
    this._splitW = 0;
    this._splitH = 0;
    this._navy = new THREE.Color(OVERVIEW_BG);
    this._applyQuality();
  }

  /** Create the pipeline objects for the current mode (lazy: a phone never allocates the desktop composer). */
  _ensurePipeline() {
    const r = this.renderer;
    const size = r.getSize(new THREE.Vector2());
    if (this.mobile) {
      if (!this._mp) this._mp = new MobilePost(r);
      const qs = new URLSearchParams(location.search);
      this._mp.bloomOn = qs.get('bloom') !== '0';
      this._mp.fxaaOn = qs.get('fxaa') !== '0';
      this._mpSize();
      return;
    }
    if (this.composer) return;
    // the composer treats a supplied target's size as LOGICAL size and applies the pixel ratio itself
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    this.scenePass = new SceneRenderPass(this.game.scene, this.game.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 1.05);
    this.gradePass = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.fxaa = new FXAAPass();
    const u = this.gradePass.uniforms;
    u.uCenter.value = new THREE.Vector2(0.5, 0.42);
    u.uFlashColor.value = new THREE.Color(1, 1, 1);
    u.uTint.value = new THREE.Color(1, 1, 1);
    for (const p of [this.scenePass, this.bloom, this.gradePass, this.output, this.fxaa]) this.composer.addPass(p);
    this._applyQuality();
  }

  _mpSize() {
    const r = this.renderer;
    const s = r.getDrawingBufferSize(_sz);
    this._mp.setSize(s.x, s.y);
  }

  /** Grade uniforms of the active pipeline. */
  get gradeUniforms() {
    return this.mobile ? this._mp.uniforms : this.gradePass.uniforms;
  }

  // ---------------------------------------------------------------------------------------------------------------
  /** Render the full frame for `scene` / `camera` (race scene or showroom). */
  render(scene, camera, dt = 0) {
    const g = this.game;
    const r = this.renderer;
    const inRace = g.state === 'race' && scene === g.scene;
    const p = inRace ? g.player : null;

    // ---- look profile ----
    if (this._split) this._leaveSplit();
    const wantLook = inRace ? 'race' : 'menu';
    if (wantLook !== this._lookName) {
      this._lookName = wantLook;
      Object.assign(this.look, LOOKS[wantLook]);
    }

    // ---- speed effects (races only) ----
    this._speedTargets(p && !g.paused && g.race?.phase !== 'intro' ? p : null);
    const { tBlur, tCA, tLines } = _tg;
    this.blur = damp(this.blur, tBlur, tBlur > this.blur ? 9 : 3.5, dt);
    this.ca = damp(this.ca, tCA, tCA > this.ca ? 9 : 3.5, dt);
    this.lines = damp(this.lines, tLines, tLines > this.lines ? 12 : 5, dt);
    this.flashV = Math.max(0, this.flashV - dt * this.flashDecay);
    this.hitV = Math.max(0, this.hitV - dt * 2.2);
    this.time += dt;

    const u = this.gradeUniforms;
    const L = this.look;
    const size = r.getSize(_sz);
    u.uAspect.value = size.x / Math.max(1, size.y);
    u.uTime.value = this.time;
    u.uBlur.value = this.blur;
    u.uCA.value = this.ca;
    u.uLines.value = this.lines;
    u.uFlash.value = this.flashV;
    u.uHit.value = this.hitV;
    u.uVignette.value = L.vignette;
    u.uSaturation.value = L.saturation;
    u.uContrast.value = L.contrast;
    u.uExposure.value = L.exposure;
    if (this.mobile) {
      const mp = this._mp;
      mp.bloomStrength = L.bloom;
      mp.threshold = L.threshold;
      mp.knee = L.knee;
      r.info.reset();
      mp.renderScene(scene, camera);
      this.stats.calls = r.info.render.calls;
      this.stats.triangles = r.info.render.triangles;
      mp.finish();
      r.info.render.calls = this.stats.calls;
      r.info.render.triangles = this.stats.triangles;
      return;
    }
    this.bloom.strength = L.bloom;
    this.bloom.radius = L.radius;
    this.bloom.threshold = L.threshold;
    this.bloom.highPassUniforms.smoothWidth.value = L.knee;

    // ---- render ----
    this.scenePass.scene = scene;
    this.scenePass.camera = camera;
    const c = this.composer;
    // the scene pass draws into the composer's initial read buffer (the MSAA one): restore that parity every frame
    c.readBuffer = c.renderTarget2;
    c.writeBuffer = c.renderTarget1;
    r.info.reset();
    c.render(dt);
    r.info.render.calls = this.scenePass.stats.calls;
    r.info.render.triangles = this.scenePass.stats.triangles;
    this.stats.calls = this.scenePass.stats.calls;
    this.stats.triangles = this.scenePass.stats.triangles;
  }

  /** Target blur / CA / speed-line amounts for a kart (zeros when null). Result in module-level `_tg`. */
  _speedTargets(p) {
    let tBlur = 0, tCA = 0, tLines = 0;
    if (p) {
      const top = Math.max(1, p.topSpeed || 30);
      const spd = clamp(Math.abs(p.speed ?? 0) / top, 0, 1.4);
      // boostPower can exceed 1 (rocket start, gold nitro): normalise so it saturates gently
      const boost = clamp((p.boostPower ?? 0) / 1.5, 0, 1);
      tBlur = clamp(boost * 0.55 + Math.max(0, spd - 0.95) * 0.45, 0, 0.7);
      tCA = clamp(boost * 0.7 + Math.max(0, spd - 0.98) * 0.4, 0, 0.8);
      tLines = boost > 0.3 ? clamp(boost, 0, 1) * 0.5 : 0;
    }
    _tg.tBlur = tBlur;
    _tg.tCA = tCA;
    _tg.tLines = tLines;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // split-screen
  // ---------------------------------------------------------------------------------------------------------------
  /**
   * Render one frame as several viewports. Every view runs the full pipeline (scene → bloom → grade → output) with
   * its own camera and per-kart FX state. `views[i].rect` is normalised, origin TOP-LEFT.
   * @param {THREE.Scene} scene
   * @param {Array<{index:number,kart:object,camera:THREE.Camera,rect:{x:number,y:number,w:number,h:number}}>} views
   * @param {number} dt
   */
  renderViews(scene, views, dt = 0) {
    const g = this.game;
    const r = this.renderer;
    if (!views || !views.length) return this.render(scene, g.camera, dt);
    if ((views.length === 1 && !g.overviewRect) || this.mobile) return this.render(scene, views[0].camera, dt); // phones are single player
    const n = views.length;
    const pr = r.getPixelRatio();
    const buf = r.getDrawingBufferSize(_sz);
    const W = buf.x, H = buf.y;

    // pixel rects (integer, edges shared between neighbours so there are no gaps)
    let tw = 1, th = 1;
    for (let i = 0; i < n; i++) {
      const rc = views[i].rect;
      const x0 = Math.round(rc.x * W), x1 = Math.round((rc.x + rc.w) * W);
      const y0 = Math.round(rc.y * H), y1 = Math.round((rc.y + rc.h) * H);
      const px = (_px[i] ??= { x: 0, y: 0, w: 0, h: 0 });
      px.x = x0; px.w = Math.max(1, x1 - x0); px.y = H - y1; px.h = Math.max(1, y1 - y0); // y flipped to bottom-left
      tw = Math.max(tw, px.w);
      th = Math.max(th, px.h);
    }
    this._enterSplit(n, tw, th);

    // main (1P) state is not used in split: keep it from leaking into a later single-player frame
    this.flashV = 0; this.hitV = 0; this.blur = 0; this.ca = 0; this.lines = 0;
    this.time += dt;
    const inRace = g.state === 'race' && scene === g.scene;
    if (inRace !== (this._lookName === 'race')) {
      this._lookName = inRace ? 'race' : 'menu';
      Object.assign(this.look, LOOKS[this._lookName]);
    }
    const L = this.look;
    const u = this.gradeUniforms;
    const c = this.composer;
    const wasScissor = r.getScissorTest();
    const prevAuto = r.autoClear;

    let calls = 0, tris = 0;

    // dark overview quadrant (3P): clear the free rect to navy
    const ov = g.overviewRect;
    if (ov) {
      const x0 = Math.round(ov.x * W), x1 = Math.round((ov.x + ov.w) * W);
      const y0 = Math.round(ov.y * H), y1 = Math.round((ov.y + ov.h) * H);
      r.setRenderTarget(null);
      r.setScissorTest(true);
      r.setScissor(x0 / pr, (H - y1) / pr, (x1 - x0) / pr, (y1 - y0) / pr);
      r.getClearColor(_cc);
      const ca = r.getClearAlpha();
      r.setClearColor(this._navy, 1);
      r.clear(true, true, true);
      r.setClearColor(_cc, ca);
      r.setScissorTest(wasScissor);
    }

    for (let i = 0; i < n; i++) {
      const v = views[i];
      const px = _px[i];
      const st = this._vs[Math.min(v.index ?? i, this._vs.length - 1)];
      const k = v.kart;
      this._speedTargets(k && !g.paused && g.race?.phase !== 'intro' ? k : null);
      st.blur = damp(st.blur, _tg.tBlur, _tg.tBlur > st.blur ? 9 : 3.5, dt);
      st.ca = damp(st.ca, _tg.tCA, _tg.tCA > st.ca ? 9 : 3.5, dt);
      st.lines = damp(st.lines, _tg.tLines, _tg.tLines > st.lines ? 12 : 5, dt);
      st.flashV = Math.max(0, st.flashV - dt * st.flashDecay);
      st.hitV = Math.max(0, st.hitV - dt * 2.2);

      u.uAspect.value = tw / th;
      u.uTime.value = this.time + i * 3.7;
      u.uBlur.value = st.blur;
      u.uCA.value = st.ca;
      u.uLines.value = st.lines;
      u.uFlash.value = st.flashV;
      u.uFlashColor.value.copy(st.flashColor);
      u.uHit.value = st.hitV;
      u.uVignette.value = L.vignette;
      u.uSaturation.value = L.saturation;
      u.uContrast.value = L.contrast;
      u.uExposure.value = L.exposure;
      this.bloom.strength = L.bloom;
      this.bloom.radius = L.radius;
      this.bloom.threshold = L.threshold;
      this.bloom.highPassUniforms.smoothWidth.value = L.knee;

      if (k && g.track?.setShadowFocus) g.track.setShadowFocus(k.position);

      this.scenePass.scene = scene;
      this.scenePass.camera = v.camera;
      c.readBuffer = c.renderTarget2;
      c.writeBuffer = c.renderTarget1;
      // the last pass draws to the canvas: confine it to this view's rect
      r.setViewport(px.x / pr, px.y / pr, px.w / pr, px.h / pr);
      r.setScissor(px.x / pr, px.y / pr, px.w / pr, px.h / pr);
      r.setScissorTest(true);
      r.info.reset();
      c.render(dt);
      calls += this.scenePass.stats.calls;
      tris += this.scenePass.stats.triangles;
    }

    r.setScissorTest(wasScissor);
    r.autoClear = prevAuto;
    r.setViewport(0, 0, W / pr, H / pr);
    r.setScissor(0, 0, W / pr, H / pr);
    r.info.render.calls = calls;
    r.info.render.triangles = tris;
    this.stats.calls = calls;
    this.stats.triangles = tris;
    this.stats.views = n;
  }

  /** Size the shared composer to one viewport (called every split frame; cheap when nothing changed). */
  _enterSplit(n, w, h) {
    if (this._split === n && this._splitW === w && this._splitH === h) return;
    this._split = n;
    this._splitW = w;
    this._splitH = h;
    this.composer.setPixelRatio(1); // w / h are already device pixels
    this.composer.setSize(w, h);
    this._applyQuality();
  }

  _leaveSplit() {
    this._split = 0;
    const size = this.renderer.getSize(_sz);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    this._applyQuality();
  }

  setSize(w, h) {
    if (this.mobile) {
      this._mpSize();
      return;
    }
    if (this._split) {
      // the next renderViews() re-sizes the composer to the new viewports
      this._split = -1;
      return;
    }
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this._applyQuality(); // MSAA sample count depends on the drawing-buffer size
  }

  /** 'low': no bloom, no MSAA, FXAA. 'medium': bloom + MSAA x2. 'high': bloom + MSAA x4. */
  setQuality(q) {
    if (!q || q === this.quality) return;
    this.quality = q;
    const mobile = q === 'mobile';
    if (mobile !== this.mobile) {
      // switching pipelines: free the one we leave, build the one we enter
      if (this._split) this._leaveSplit();
      this.mobile = mobile;
      if (mobile) {
        this.composer?.dispose();
        for (const p of [this.bloom, this.gradePass, this.output, this.fxaa]) p?.dispose?.();
        this.composer = this.bloom = this.gradePass = this.output = this.fxaa = this.scenePass = null;
      } else {
        this._mp?.dispose();
        this._mp = null;
      }
      this._ensurePipeline();
      return;
    }
    this._applyQuality();
  }

  _applyQuality() {
    if (this.mobile || !this.composer) return;
    const q = this.quality;
    const max = this.renderer.capabilities.maxSamples ?? 4;
    const buf = this.renderer.getDrawingBufferSize(_sz);
    const bigFrame = buf.x * buf.y > 6.0e6; // ~4K+: 4x MSAA on an HDR target gets expensive
    let samples = Math.min(max, q === 'high' ? (bigFrame ? 2 : 4) : q === 'medium' ? 2 : 0);
    if (this._split) samples = Math.min(samples, 2); // each viewport is small: x2 is plenty and keeps 4 passes affordable
    const rt = this.composer.renderTarget2;
    if (rt.samples !== samples) {
      rt.dispose();
      rt.samples = samples;
    }
    this.bloom.enabled = q !== 'low';
    this.fxaa.enabled = q === 'low';
  }

  // ---------------------------------------------------------------------------------------------------------------
  /** Full-screen colour flash (lightning, big explosions). */
  flash(intensity = 1, color = 0xffffff, duration = 0.3, kart = null) {
    const a = clamp(intensity, 0, 1);
    const decay = 1 / Math.max(0.05, duration);
    const apply = (st) => {
      st.flashV = Math.max(st.flashV, a);
      st.flashDecay = decay;
      st.flashColor.set(color);
    };
    if (kart) {
      // only that human's view; ignore CPU karts
      const idx = this._viewIndex(kart);
      if (idx < 0) return;
      apply(this._vs[idx]);
      if (idx === 0) this._applyMain(a, decay, color);
      return;
    }
    for (const st of this._vs) apply(st);
    this._applyMain(a, decay, color);
  }

  /** Red damage vignette pulse. With a kart: only that human's view. */
  hitPulse(amount = 1, kart = null) {
    const a = clamp(amount, 0, 1);
    if (kart) {
      const idx = this._viewIndex(kart);
      if (idx < 0) return;
      this._vs[idx].hitV = Math.max(this._vs[idx].hitV, a);
      if (idx === 0) this.hitV = Math.max(this.hitV, a);
      return;
    }
    for (const st of this._vs) st.hitV = Math.max(st.hitV, a);
    this.hitV = Math.max(this.hitV, a);
  }

  _applyMain(a, decay, color) {
    this.flashV = Math.max(this.flashV, a);
    this.flashDecay = decay;
    this.gradeUniforms.uFlashColor.value.set(color);
  }

  /** View slot for a human kart (-1 for CPUs / unknown). */
  _viewIndex(kart) {
    if (kart.playerIndex >= 0) return Math.min(kart.playerIndex, this._vs.length - 1);
    if (kart.isPlayer || kart === this.game.player) return 0;
    return -1;
  }

  /** WebGL context restored (Game may call this): rebuild every GPU resource of the active pipeline. */
  onContextRestored() {
    if (this.mobile) {
      this._mp?.dispose();
      this._mp = null;
    } else {
      this.composer?.dispose();
      this.composer = null;
    }
    this._split = 0;
    this._ensurePipeline();
    this.setSize(...this.renderer.getSize(_sz).toArray());
  }

  /** Override parts of the current look (e.g. the Showroom tints its grade). */
  setLook(partial) {
    Object.assign(this.look, partial);
  }

  dispose() {
    this.composer?.dispose();
    this._mp?.dispose();
    for (const p of [this.bloom, this.gradePass, this.output, this.fxaa]) p?.dispose?.();
  }
}

const _sz = new THREE.Vector2();
const _cc = new THREE.Color();
const _px = [];
const _tg = { tBlur: 0, tCA: 0, tLines: 0 };
