/**
 * PostFX — the whole frame pipeline.
 *   RenderPass (HDR HalfFloat target, MSAA 4/2/0 by quality) → UnrealBloomPass (only HDR emissives / sparks / hot
 *   speculars glow) → custom grade pass (radial speed blur, chromatic aberration, anime speed lines, screen flash,
 *   hit vignette, vignette, exposure / saturation / contrast) → OutputPass (ACES + sRGB) → FXAA (low quality only).
 * Contract (ARCHITECTURE.md §6.6): render(scene, camera, dt), setSize(w, h), setQuality(q).
 * Additions: flash(intensity, color, duration), hitPulse(amount), setLook(partial), stats.
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
import { clamp, damp } from '../core/math.js';

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

    const size = r.getSize(new THREE.Vector2());
    // the composer treats a supplied target's size as LOGICAL size and applies the pixel ratio itself
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(r, rt);
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(size.x, size.y);

    this.scenePass = new SceneRenderPass(game.scene, game.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 1.05);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.fxaa = new FXAAPass();
    const u = this.grade.uniforms;
    u.uCenter.value = new THREE.Vector2(0.5, 0.42);
    u.uFlashColor.value = new THREE.Color(1, 1, 1);
    u.uTint.value = new THREE.Color(1, 1, 1);
    for (const p of [this.scenePass, this.bloom, this.grade, this.output, this.fxaa]) this.composer.addPass(p);

    this.look = { ...LOOKS.race };
    this._lookName = 'race';
    this.blur = 0;
    this.ca = 0;
    this.lines = 0;
    this.flashV = 0;
    this.flashDecay = 4;
    this.hitV = 0;
    this.time = 0;
    this.stats = { calls: 0, triangles: 0 };
    this._applyQuality();
  }

  // ---------------------------------------------------------------------------------------------------------------
  /** Render the full frame for `scene` / `camera` (race scene or showroom). */
  render(scene, camera, dt = 0) {
    const g = this.game;
    const r = this.renderer;
    const inRace = g.state === 'race' && scene === g.scene;
    const p = inRace ? g.player : null;

    // ---- look profile ----
    const wantLook = inRace ? 'race' : 'menu';
    if (wantLook !== this._lookName) {
      this._lookName = wantLook;
      Object.assign(this.look, LOOKS[wantLook]);
    }

    // ---- speed effects (races only) ----
    let tBlur = 0, tCA = 0, tLines = 0;
    if (p && !g.paused && g.race?.phase !== 'intro') {
      const top = Math.max(1, p.topSpeed || 30);
      const spd = clamp(Math.abs(p.speed ?? 0) / top, 0, 1.4);
      // boostPower can exceed 1 (rocket start, gold nitro): normalise so it saturates gently
      const boost = clamp((p.boostPower ?? 0) / 1.5, 0, 1);
      tBlur = clamp(boost * 0.55 + Math.max(0, spd - 0.95) * 0.45, 0, 0.7);
      tCA = clamp(boost * 0.7 + Math.max(0, spd - 0.98) * 0.4, 0, 0.8);
      tLines = boost > 0.3 ? clamp(boost, 0, 1) * 0.5 : 0;
    }
    this.blur = damp(this.blur, tBlur, tBlur > this.blur ? 9 : 3.5, dt);
    this.ca = damp(this.ca, tCA, tCA > this.ca ? 9 : 3.5, dt);
    this.lines = damp(this.lines, tLines, tLines > this.lines ? 12 : 5, dt);
    this.flashV = Math.max(0, this.flashV - dt * this.flashDecay);
    this.hitV = Math.max(0, this.hitV - dt * 2.2);
    this.time += dt;

    const u = this.grade.uniforms;
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

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this._applyQuality(); // MSAA sample count depends on the drawing-buffer size
  }

  /** 'low': no bloom, no MSAA, FXAA. 'medium': bloom + MSAA x2. 'high': bloom + MSAA x4. */
  setQuality(q) {
    if (!q || q === this.quality) return;
    this.quality = q;
    this._applyQuality();
  }

  _applyQuality() {
    const q = this.quality;
    const max = this.renderer.capabilities.maxSamples ?? 4;
    const buf = this.renderer.getDrawingBufferSize(_sz);
    const bigFrame = buf.x * buf.y > 6.0e6; // ~4K+: 4x MSAA on an HDR target gets expensive
    const samples = Math.min(max, q === 'high' ? (bigFrame ? 2 : 4) : q === 'medium' ? 2 : 0);
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
  flash(intensity = 1, color = 0xffffff, duration = 0.3) {
    this.flashV = Math.max(this.flashV, clamp(intensity, 0, 1));
    this.flashDecay = 1 / Math.max(0.05, duration);
    this.grade.uniforms.uFlashColor.value.set(color);
  }

  /** Red damage vignette pulse. */
  hitPulse(amount = 1) {
    this.hitV = Math.max(this.hitV, clamp(amount, 0, 1));
  }

  /** Override parts of the current look (e.g. the Showroom tints its grade). */
  setLook(partial) {
    Object.assign(this.look, partial);
  }

  dispose() {
    this.composer.dispose();
    for (const p of [this.bloom, this.grade, this.output, this.fxaa]) p.dispose?.();
  }
}

const _sz = new THREE.Vector2();
