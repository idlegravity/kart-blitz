/**
 * MobilePost — the cheap frame pipeline used by the 'mobile' quality preset (docs/MOBILE.md §3.3).
 *   scene → one HDR RenderTarget (no MSAA)
 *   → [cheap bloom: bright-pass + 4-tap downsample to 1/4 res, separable 5-tap blur x2 (all 1/4 res)]
 *   → ONE final pass straight to the canvas: speed blur (4 taps) + bloom add + speed lines + exposure/sat/contrast +
 *     vignette + hit/flash + ACES tone mapping + sRGB.
 * No EffectComposer (so no extra full-resolution ping-pong targets), no FXAA, no per-frame allocation.
 * The final material exposes the same uniform names as GradeShader so PostFX drives both paths identically.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const VERT = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const BRIGHT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel; // 1 / source size
  uniform float uThreshold, uKnee;
  varying vec2 vUv;
  vec3 hi(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return c * smoothstep(uThreshold, uThreshold + uKnee, l);
  }
  void main() {
    vec3 a = hi(min(texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb, vec3(24.0)));
    vec3 b = hi(min(texture2D(tDiffuse, vUv + uTexel * vec2(1.0, -1.0)).rgb, vec3(24.0)));
    vec3 c = hi(min(texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, 1.0)).rgb, vec3(24.0)));
    vec3 d = hi(min(texture2D(tDiffuse, vUv + uTexel * vec2(1.0, 1.0)).rgb, vec3(24.0)));
    gl_FragColor = vec4((a + b + c + d) * 0.25, 1.0);
  }`;

const BLUR_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uDir; // texel step (already scaled)
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.2270270;
    c += (texture2D(tDiffuse, vUv + uDir * 1.3846154).rgb + texture2D(tDiffuse, vUv - uDir * 1.3846154).rgb) * 0.3162162;
    c += (texture2D(tDiffuse, vUv + uDir * 3.2307692).rgb + texture2D(tDiffuse, vUv - uDir * 3.2307692).rgb) * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
  }`;

const FINAL_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform float uTime, uAspect, uBlur, uCA, uLines, uFlash, uHit, uVignette, uExposure, uSaturation, uContrast;
  uniform vec2 uCenter;
  uniform vec3 uFlashColor, uTint;
  varying vec2 vUv;

  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    vec2 uv = vUv;
    vec2 d = uv - uCenter;
    vec2 dA = vec2(d.x * uAspect, d.y);
    float dist = length(dA);

    vec3 col;
    if (uBlur > 0.001 || uCA > 0.001) {
      float k = (uBlur + uCA * 0.5) * 0.06 * smoothstep(0.1, 0.65, dist);
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        float f = float(i) / 3.0;
        acc += texture2D(tDiffuse, uCenter + d * (1.0 - k * f)).rgb;
      }
      col = acc * 0.25;
    } else {
      col = texture2D(tDiffuse, uv).rgb;
    }
    col += texture2D(tBloom, uv).rgb * uBloom;

    if (uLines > 0.001) {
      float ang = atan(dA.y, dA.x);
      float seg = floor(ang * 26.0 + floor(uTime * 24.0) * 3.7);
      float h = hash11(seg);
      float width = 0.35 + 0.5 * hash11(seg + 17.0);
      float streak = smoothstep(width, 1.0, h) * smoothstep(0.34, 0.95, dist);
      streak *= step(0.55, hash11(seg * 1.7 + floor(uTime * 24.0)));
      col += vec3(1.0, 0.98, 0.92) * streak * uLines * 1.35;
    }

    col *= uExposure * uTint;
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, uSaturation);
    col = pow(max(col / 0.18, vec3(0.0)), vec3(uContrast)) * 0.18;

    float v = smoothstep(0.42, 1.25, length(dA * 1.05));
    col *= 1.0 - uVignette * v;

    col = mix(col, col * vec3(1.0, 0.35, 0.3) + vec3(0.25, 0.0, 0.0) * v, uHit * (0.35 + 0.65 * v));
    float fl = clamp(uFlash, 0.0, 1.0);
    col = col * (1.0 + fl * 0.5) + uFlashColor * fl * fl * 1.1;

    gl_FragColor = vec4(col, 1.0);
    #if defined( ACES_FILMIC_TONE_MAPPING )
      gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
    #elif defined( LINEAR_TONE_MAPPING )
      gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
    #endif
    #ifdef SRGB_TRANSFER
      gl_FragColor = sRGBTransferOETF(gl_FragColor);
    #endif
  }`;

export class MobilePost {
  /** @param {THREE.WebGLRenderer} renderer */
  constructor(renderer) {
    this.renderer = renderer;
    this.bloomOn = true;
    this.fxaaOn = true;
    this.bloomStrength = 0.36;
    this.threshold = 1.45;
    this.knee = 1.3;
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, samples: 0 };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { ...opt, depthBuffer: true });
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opt);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opt);
    // LDR (sRGB-encoded) target the final pass writes into when FXAA is on
    this.ldRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, samples: 0 });
    this.fxaaMat = new THREE.ShaderMaterial({ name: FXAAShader.name, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), vertexShader: FXAAShader.vertexShader, fragmentShader: FXAAShader.fragmentShader, depthTest: false, depthWrite: false });
    this.w = 0;
    this.h = 0;

    const raw = (frag, uniforms, defines) => new THREE.RawShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines: defines ?? {}, depthTest: false, depthWrite: false });
    this.brightMat = raw(BRIGHT_FRAG, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.45 }, uKnee: { value: 1.3 } });
    this.blurMat = raw(BLUR_FRAG, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.uniforms = {
      tDiffuse: { value: null },
      tBloom: { value: null },
      uBloom: { value: 0 },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uCenter: { value: new THREE.Vector2(0.5, 0.42) },
      uBlur: { value: 0 },
      uCA: { value: 0 },
      uLines: { value: 0 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uHit: { value: 0 },
      uVignette: { value: 0.28 },
      uExposure: { value: 1 },
      uSaturation: { value: 1.1 },
      uContrast: { value: 1.06 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      toneMappingExposure: { value: 1 },
    };
    this.finalMat = raw(FINAL_FRAG, this.uniforms, {});
    this._tm = -1;
    this._cs = null;
    this.quad = new FullScreenQuad(this.brightMat);
  }

  /** Size in device pixels. */
  setSize(w, h) {
    w = Math.max(2, Math.floor(w));
    h = Math.max(2, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.sceneRT.setSize(w, h);
    this.ldRT.setSize(w, h);
    this.fxaaMat.uniforms.resolution.value.set(1 / w, 1 / h);
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);
    this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  /** Render the scene into the HDR target (shadows included); caller reads renderer.info afterwards. */
  renderScene(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
  }

  /** Bloom + final pass to the canvas (or the current viewport). */
  finish() {
    const r = this.renderer;
    const q = this.quad;
    const scene = this.sceneRT.texture;
    const bw = this.rtA.width, bh = this.rtA.height;
    const doBloom = this.bloomOn && this.bloomStrength > 0.001;
    if (doBloom) {
      const bu = this.brightMat.uniforms;
      bu.tDiffuse.value = scene;
      bu.uThreshold.value = this.threshold;
      bu.uKnee.value = this.knee;
      q.material = this.brightMat;
      r.setRenderTarget(this.rtA);
      q.render(r);
      const bl = this.blurMat.uniforms;
      q.material = this.blurMat;
      bl.tDiffuse.value = this.rtA.texture;
      bl.uDir.value.set(1.6 / bw, 0);
      r.setRenderTarget(this.rtB);
      q.render(r);
      bl.tDiffuse.value = this.rtB.texture;
      bl.uDir.value.set(0, 1.6 / bh);
      r.setRenderTarget(this.rtA);
      q.render(r);
    }
    const u = this.uniforms;
    u.tDiffuse.value = scene;
    u.tBloom.value = this.rtA.texture;
    u.uBloom.value = doBloom ? this.bloomStrength * 1.6 : 0;
    u.toneMappingExposure.value = r.toneMappingExposure;
    if (this._tm !== r.toneMapping || this._cs !== r.outputColorSpace) {
      this._tm = r.toneMapping;
      this._cs = r.outputColorSpace;
      const d = {};
      if (THREE.ColorManagement.getTransfer(this._cs) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
      if (this._tm === THREE.ACESFilmicToneMapping) d.ACES_FILMIC_TONE_MAPPING = '';
      else if (this._tm === THREE.LinearToneMapping) d.LINEAR_TONE_MAPPING = '';
      this.finalMat.defines = d;
      this.finalMat.needsUpdate = true;
    }
    q.material = this.finalMat;
    r.setRenderTarget(this.fxaaOn ? this.ldRT : null);
    q.render(r);
    if (this.fxaaOn) {
      this.fxaaMat.uniforms.tDiffuse.value = this.ldRT.texture;
      q.material = this.fxaaMat;
      r.setRenderTarget(null);
      q.render(r);
    }
  }

  dispose() {
    this.sceneRT.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.ldRT.dispose();
    this.fxaaMat.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.finalMat.dispose();
    this.quad.dispose();
  }
}
