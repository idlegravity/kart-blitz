/**
 * Shared material factory for a track: procedural terrain shaders per theme, asphalt, foliage with wind,
 * emissive helpers, fog-aware shader helper, boost-pad shader. Tracks every created resource for dispose().
 * OWNER: World agent.
 */
import * as THREE from 'three';
import { makeAsphalt, makeNoiseTexture } from './textures.js';

const GLSL_COMMON = /* glsl */ `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p) { float n = hash21(p); return vec2(n, hash21(p + n * 17.0)); }
`;

// ------------------------------------------------------------------------------------------------
// Terrain colour functions (linear working space). Signature shared by all themes.
// ------------------------------------------------------------------------------------------------
const TERRAIN_GLSL = {
  meadow: /* glsl */ `
vec3 terrainColor(vec3 p, vec3 n, vec3 vc, float dist, float roadD, float m0, float m1) {
  vec4 nA = texture2D(uNoise, p.xz * 0.0042);
  vec4 nB = texture2D(uNoise, p.xz * 0.019 + vec2(0.31, 0.77));
  vec4 nC = texture2D(uNoise, p.xz * 0.16 + vec2(0.62, 0.13));
  float macro = nA.r * 0.55 + nB.g * 0.45;
  vec3 gDark = vec3(0.085, 0.360, 0.038);
  vec3 gMid  = vec3(0.170, 0.540, 0.040);
  vec3 gLite = vec3(0.300, 0.660, 0.070);
  vec3 c = mix(gDark, gMid, smoothstep(0.22, 0.62, macro));
  c = mix(c, gLite, smoothstep(0.55, 0.85, nB.r) * 0.45);
  c *= 0.90 + 0.18 * nC.b;
  c *= 0.94 + 0.12 * texture2D(uNoise, p.xz * 0.83 + 0.21).g;
  // patchwork farm fields on the gentle far slopes (tinted cells + faint crop rows close up)
  {
    float farM = smoothstep(26.0, 74.0, roadD) * smoothstep(0.80, 0.93, n.y);
    if (farM > 0.0) {
      vec2 fq = mat2(0.866, -0.5, 0.5, 0.866) * p.xz;
      vec2 fcell = fq / vec2(85.0, 52.0);
      vec2 fid = floor(fcell);
      float fh = hash21(fid + 7.0);
      vec3 tone = vec3(1.0);
      if (fh < 0.22) tone = vec3(1.22, 1.16, 0.62);       // ripe / canola
      else if (fh < 0.44) tone = vec3(0.80, 0.98, 0.72);   // deep pasture
      else if (fh < 0.62) tone = vec3(1.12, 1.10, 0.86);   // hay
      else if (fh < 0.72) tone = vec3(0.98, 0.80, 0.55);   // ploughed earth
      float rows = 0.5 + 0.5 * sin(dot(fq, vec2(0.0, 1.0)) * 1.9 + fh * 40.0);
      float rowsFade = 1.0 - smoothstep(50.0, 210.0, dist);
      tone *= 1.0 - 0.10 * rows * rowsFade * step(0.3, fh);
      // soft field edges
      vec2 fe = abs(fract(fcell) - 0.5);
      tone *= 1.0 - 0.10 * smoothstep(0.47, 0.5, max(fe.x, fe.y));
      c *= mix(vec3(1.0), tone, farM);
    }
  }
  // gentle mowing bands on open flat ground
  float bands = 0.5 + 0.5 * sin(p.x * 0.11 + p.z * 0.07 + nA.g * 6.0);
  c *= 0.96 + 0.06 * smoothstep(0.35, 0.65, bands);
  // slope: bare earth
  float slope = 1.0 - n.y;
  c = mix(c, vec3(0.36, 0.23, 0.10), smoothstep(0.30, 0.56, slope));
  // dry, dusty verge next to the asphalt
  float wear = 1.0 - smoothstep(0.0, 8.0, roadD);
  c = mix(c, vec3(0.50, 0.44, 0.20), wear * 0.30 * (0.55 + 0.45 * nC.r));
  return c * vc;
}
vec3 terrainEmissive(vec3 p, vec3 n, float dist, float m0, float m1) { return vec3(0.0); }
vec3 terrainBump(vec3 p, vec3 n, float dist) { return vec3(0.0); }
`,

  canyon: /* glsl */ `
vec3 strata(float k) {
  float h = hash21(vec2(k, 3.7));
  vec3 a = vec3(0.50, 0.100, 0.025);
  vec3 b = vec3(0.72, 0.240, 0.055);
  vec3 c = vec3(0.80, 0.420, 0.130);
  vec3 d = vec3(0.42, 0.150, 0.060);
  vec3 e = vec3(0.86, 0.600, 0.300);
  vec3 f = vec3(0.30, 0.095, 0.045);
  if (h < 0.17) return a;
  if (h < 0.34) return b;
  if (h < 0.52) return c;
  if (h < 0.68) return d;
  if (h < 0.84) return e;
  return f;
}
vec3 terrainColor(vec3 p, vec3 n, vec3 vc, float dist, float roadD, float m0, float m1) {
  vec4 nA = texture2D(uNoise, p.xz * 0.0035);
  vec4 nB = texture2D(uNoise, p.xz * 0.016 + vec2(0.3, 0.7));
  vec4 nC = texture2D(uNoise, p.xz * 0.14 + vec2(0.6, 0.1));
  float slope = 1.0 - n.y;
  // layered strata by world height (wobbled by noise so bands undulate)
  float sy = p.y * 0.34 + (nA.r - 0.5) * 3.2 + (nB.g - 0.5) * 0.9;
  float band = floor(sy);
  float fr = fract(sy);
  vec3 sc = strata(band);
  float sFade = smoothstep(260.0, 1200.0, dist);
  sc = mix(sc, vec3(0.62, 0.26, 0.10), sFade * 0.75);
  // slightly lighter top of each band, dark thin seam between bands
  sc *= 0.86 + 0.22 * mix(fr, 0.5, sFade);
  sc *= 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.07, fr)) * (1.0 - sFade);
  sc *= 0.88 + 0.24 * nC.b;
  // sandy flats
  vec3 sand = mix(vec3(0.66, 0.40, 0.16), vec3(0.82, 0.55, 0.26), smoothstep(0.35, 0.7, nB.r));
  sand *= 0.90 + 0.20 * nC.g;
  float fade = 1.0 - smoothstep(30.0, 70.0, dist);
  // pebbles & desert scrub specks
  vec2 sp = p.xz * 0.85;
  float sr = hash21(floor(sp));
  float dots = smoothstep(0.20, 0.11, length(fract(sp) - 0.5 - (hash22(floor(sp)) - 0.5) * 0.5));
  sand = mix(sand, vec3(0.22, 0.24, 0.10), dots * step(0.90, sr) * fade * step(0.75, n.y));
  sand = mix(sand, vec3(0.95, 0.70, 0.45), dots * step(0.72, sr) * step(sr, 0.80) * fade * 0.6);
  float cliff = smoothstep(0.20, 0.50, slope);
  vec3 c = mix(sand, sc, cliff);
  // tint upper edges of ledges lighter (fake rim from height)
  c = mix(c, c * vec3(1.12, 1.05, 0.95), smoothstep(0.4, 0.7, nA.g) * 0.3);
  // dusty verge
  float wear = 1.0 - smoothstep(0.0, 7.0, roadD);
  c = mix(c, vec3(0.72, 0.52, 0.30), wear * 0.32);
  return c * vc;
}
vec3 terrainEmissive(vec3 p, vec3 n, float dist, float m0, float m1) { return vec3(0.0); }
vec3 terrainBump(vec3 p, vec3 n, float dist) {
  float cliff = smoothstep(0.18, 0.5, 1.0 - n.y);
  float fade = 1.0 - smoothstep(70.0, 260.0, dist);
  vec3 a = texture2D(uNoise, p.zy * 0.11 + 0.3).rgb - 0.5;
  vec3 b = texture2D(uNoise, p.xy * 0.11 + 0.7).rgb - 0.5;
  vec3 c = texture2D(uNoise, p.xz * 0.13).rgb - 0.5;
  vec3 g = vec3(a.r + b.g * 0.5, c.b * 0.6, a.g + b.r * 0.5 + c.r);
  return g * (0.9 * cliff + 0.10) * fade;
}
`,

  glacier: /* glsl */ `
vec3 terrainColor(vec3 p, vec3 n, vec3 vc, float dist, float roadD, float m0, float m1) {
  vec4 nA = texture2D(uNoise, p.xz * 0.005);
  vec4 nB = texture2D(uNoise, p.xz * 0.024 + vec2(0.4, 0.2));
  vec4 nC = texture2D(uNoise, p.xz * 0.13 + vec2(0.7, 0.9));
  float slope = 1.0 - n.y;
  vec3 snow = vec3(0.76, 0.86, 0.98);
  vec3 snowB = vec3(0.58, 0.73, 0.93);
  vec3 c = mix(snowB, snow, smoothstep(0.30, 0.70, nA.r * 0.6 + nB.g * 0.4));
  c *= 0.92 + 0.12 * nC.b;
  // wind-carved ripples
  float rip = sin(p.x * 0.35 + p.z * 0.21 + nB.r * 9.0) * 0.5 + 0.5;
  c *= 0.97 + 0.05 * rip;
  // rock on steep faces (strata-ish bluish grey)
  float sy = p.y * 0.5 + (nA.g - 0.5) * 3.0;
  vec3 rock = mix(vec3(0.16, 0.19, 0.27), vec3(0.30, 0.34, 0.42), fract(sy) * 0.8 + 0.1 * nC.r);
  rock = mix(vec3(0.23, 0.265, 0.345), rock, 1.0 - smoothstep(80.0, 300.0, dist));
  float snowLine = smoothstep(40.0, 150.0, p.y);
  c = mix(c, rock, smoothstep(0.30, 0.55, slope) * (1.0 - 0.55 * snowLine));
  // blue ice patches (mask supplied per vertex) with hairline cracks
  vec3 ice = mix(vec3(0.16, 0.42, 0.82), vec3(0.42, 0.72, 0.98), nB.b);
  float crk = min(abs(texture2D(uNoise, p.xz * 0.021 + 0.13).g - 0.5), abs(texture2D(uNoise, p.zx * 0.034 + 0.6).b - 0.5));
  ice *= 1.0 - 0.32 * smoothstep(0.022, 0.0, crk);
  c = mix(c, ice, smoothstep(0.35, 0.7, m0));
  // packed, grey-blue snow near the tarmac
  float wear = 1.0 - smoothstep(0.0, 7.0, roadD);
  c = mix(c, vec3(0.55, 0.66, 0.82), wear * 0.30);
  return c * vc;
}
vec3 terrainEmissive(vec3 p, vec3 n, float dist, float m0, float m1) {
  // glittering snow crystals
  float g = 1.0 - smoothstep(14.0, 55.0, dist);
  vec2 sp = p.xz * 9.0;
  vec2 id = floor(sp);
  float r = hash21(id);
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + r * 5.0) + r * 60.0);
  float d = length(fract(sp) - 0.5 - (hash22(id) - 0.5) * 0.6);
  float sp1 = step(0.985, r) * smoothstep(0.10, 0.0, d) * tw;
  return vec3(0.9, 0.97, 1.0) * sp1 * g * 1.4 * step(0.75, n.y);
}
vec3 terrainBump(vec3 p, vec3 n, float dist) {
  float rockish = smoothstep(0.3, 0.6, 1.0 - n.y);
  float fade = 1.0 - smoothstep(60.0, 220.0, dist);
  vec3 a = texture2D(uNoise, p.zy * 0.12 + 0.3).rgb - 0.5;
  vec3 b = texture2D(uNoise, p.xy * 0.12 + 0.7).rgb - 0.5;
  vec3 c = texture2D(uNoise, p.xz * 0.22).rgb - 0.5;
  vec3 g = vec3(a.r + b.g * 0.5, c.b * 0.5, a.g + b.r * 0.5 + c.r);
  return g * (0.8 * rockish + 0.08) * fade;
}
`,

  neon: /* glsl */ `
vec3 terrainColor(vec3 p, vec3 n, vec3 vc, float dist, float roadD, float m0, float m1) {
  vec4 nA = texture2D(uNoise, p.xz * 0.004);
  return mix(vec3(0.010, 0.008, 0.028), vec3(0.030, 0.018, 0.060), nA.r) * vc;
}
vec3 terrainEmissive(vec3 p, vec3 n, float dist, float m0, float m1) {
  // city street grid glowing far below
  vec2 g = p.xz / 96.0;
  vec2 f = abs(fract(g) - 0.5);
  float lx = 1.0 - smoothstep(0.004, 0.014, 0.5 - f.x);
  float lz = 1.0 - smoothstep(0.004, 0.014, 0.5 - f.y);
  float id = hash21(floor(g));
  vec3 c1 = mix(vec3(0.1, 0.8, 1.0), vec3(1.0, 0.15, 0.8), step(0.5, id));
  float fadeD = 1.0 - smoothstep(500.0, 2200.0, dist);
  float flick = 0.7 + 0.3 * sin(uTime * 1.3 + id * 40.0);
  return c1 * max(lx, lz) * 1.4 * fadeD * flick;
}
vec3 terrainBump(vec3 p, vec3 n, float dist) { return vec3(0.0); }
`,
};

/** Give a material a unique program cache key and patch its shaders. */
function patch(mat, key, fn) {
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = fn;
  return mat;
}

/** Owns every material / texture created for one track. */
export class MatLib {
  constructor() {
    this.time = { value: 0 };
    this.wind = { value: 1 };
    this.disposables = [];
    this._noise = null;
  }

  add(x) {
    this.disposables.push(x);
    return x;
  }

  get noise() {
    if (!this._noise) this._noise = this.add(makeNoiseTexture(256, 7));
    return this._noise;
  }

  /** Themed terrain shader (grid + shoulder ribbons). */
  terrain(theme) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    const glsl = TERRAIN_GLSL[theme] ?? TERRAIN_GLSL.meadow;
    const noise = this.noise;
    const time = this.time;
    patch(mat, `kb-terrain-${theme}`, (shader) => {
      shader.uniforms.uNoise = { value: noise };
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aRoadD; attribute float aM0; attribute float aM1;
varying vec3 vWPos; varying vec3 vWNormal; varying float vRoadD; varying float vM0; varying float vM1;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);
vRoadD = aRoadD; vM0 = aM0; vM1 = aM1;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uNoise; uniform float uTime;
varying vec3 vWPos; varying vec3 vWNormal; varying float vRoadD; varying float vM0; varying float vM1;
${GLSL_COMMON}
${glsl}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = terrainColor(vWPos, normalize(vWNormal), vColor.rgb, length(vViewPosition), vRoadD, vM0, vM1);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.14, smoothstep(0.35, 0.7, vM0) * ${theme === 'glacier' ? '1.0' : '0.0'});`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(normal + mat3(viewMatrix) * terrainBump(vWPos, normalize(vWNormal), length(vViewPosition)));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += terrainEmissive(vWPos, normalize(vWNormal), length(vViewPosition), vM0, vM1);`);
    });
    return this.add(mat);
  }

  /** Tileable asphalt (map + normal + roughness). uv = (lateral m, s m) / 8. */
  asphalt(base, speck, extra = {}) {
    const t = makeAsphalt(base, speck);
    for (const k of ['map', 'normalMap', 'roughnessMap']) this.add(t[k]);
    const mat = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
      roughness: 1, metalness: 0, normalScale: new THREE.Vector2(0.55, 0.55), ...extra,
    });
    return this.add(mat);
  }

  /** Vertex-colour (and optional instance colour) material. */
  vcolor(opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...opts });
    return this.add(mat);
  }

  /** Vertex-colour foliage/props with gentle wind sway (instancing aware). */
  foliage(opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, ...opts });
    const time = this.time, wind = this.wind;
    const strength = opts.sway ?? 1;
    delete mat.sway;
    patch(mat, 'kb-foliage', (shader) => {
      shader.uniforms.uTime = time;
      shader.uniforms.uWind = wind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uWind;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec3 iP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 iP = vec3(0.0);
  #endif
  float hgt = max(position.y - 0.8, 0.0);
  float sw = uWind * ${strength.toFixed(3)} * hgt * hgt * 0.010;
  transformed.x += sin(uTime * 1.6 + iP.x * 0.21 + iP.z * 0.13) * sw;
  transformed.z += cos(uTime * 1.25 + iP.z * 0.19 + iP.x * 0.11) * sw * 0.7;
}`);
    });
    return this.add(mat);
  }

  /** Waving cloth. horizontal flags wave with uv.x (pole at u=0); `vertical` banners hang from v=1 and wave toward v=0. */
  flag(opts = {}) {
    const { vertical = false, ...params } = opts;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75, metalness: 0, ...params });
    const time = this.time;
    patch(mat, `kb-flag-${vertical ? 'v' : 'h'}`, (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec3 iP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 iP = vec3(0.0);
  #endif
  float ph = iP.x * 0.31 + iP.z * 0.47;
  float k = ${vertical ? '(1.0 - uv.y)' : 'uv.x'};
  float w = ${vertical ? 'transformed.y * 1.6' : 'transformed.x * 2.8'};
  transformed.z += sin(uTime * 5.5 + w + ph) * 0.20 * k;
  transformed.${vertical ? 'x' : 'y'} += sin(uTime * 4.3 + w * 0.8 + ph * 1.7) * 0.07 * k;
}`);
    });
    return this.add(mat);
  }

  /** Cheering crowd: vertex colours (+ instance colour), everyone bounces with a per-instance phase. */
  crowd(opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...opts });
    const time = this.time;
    patch(mat, 'kb-crowd', (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec3 iP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 iP = vec3(0.0);
  #endif
  float ph = fract(sin(dot(iP.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  float sp = 4.5 + fract(ph * 7.31) * 2.5;
  float bob = pow(abs(sin(uTime * sp + ph)), 2.0) * 0.30;
  transformed.y += bob;
}`);
    });
    return this.add(mat);
  }

  /** Flapping-wing material for instanced birds (wing tips |x| > 0 flap with a per-instance phase). */
  bird(opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9, metalness: 0, ...opts });
    const time = this.time;
    patch(mat, 'kb-bird', (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    float ph = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.53;
  #else
    float ph = 0.0;
  #endif
  transformed.y += sin(uTime * 8.5 + ph) * abs(position.x) * 0.55;
}`);
    });
    return this.add(mat);
  }

  /** Vertex/instance-colour material whose emission equals its own colour * intensity (crystals, neon signs). */
  glow(intensity = 2.5, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0, ...opts });
    const key = `kb-glow-${intensity}`;
    patch(mat, key, (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * ${intensity.toFixed(2)};`);
    });
    return this.add(mat);
  }

  /** Glowing material for bloom (HDR emissive). */
  emissive(color, intensity = 3, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color: opts.base ?? 0x000000, emissive: new THREE.Color(color), emissiveIntensity: intensity,
      roughness: 0.4, metalness: 0, ...opts.params,
    });
    return this.add(mat);
  }

  /** Fog-aware ShaderMaterial. vertex/fragment bodies must include the fog chunks themselves. */
  shader({ vertex, fragment, uniforms = {}, ...params }) {
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
      vertexShader: vertex,
      fragmentShader: fragment,
      fog: true,
      ...params,
    });
    return this.add(mat);
  }

  /** Animated boost-pad chevrons (uv in metres: x lateral centred, y along; attribute aDim = halfWidth, length). */
  boostPad() {
    const time = this.time;
    const mat = this.shader({
      uniforms: { uTime: time },
      vertex: /* glsl */ `
attribute vec2 aDim;
varying vec2 vUv; varying vec2 vDim;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vDim = aDim;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
      fragment: /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying vec2 vDim;
#include <fog_pars_fragment>
void main() {
  float hw = vDim.x, len = vDim.y;
  float ax = abs(vUv.x);
  float ph = (vUv.y + ax * 0.85) / 2.9 - uTime * 0.9;
  float m = fract(ph);
  float chev = smoothstep(0.02, 0.10, m) * (1.0 - smoothstep(0.34, 0.44, m));
  float endFade = smoothstep(0.2, 1.4, vUv.y) * (1.0 - smoothstep(len - 1.4, len - 0.2, vUv.y));
  float sideFade = 1.0 - smoothstep(hw - 1.2, hw - 0.7, ax);
  chev *= endFade * sideFade;
  float bd = min(hw - ax, min(vUv.y, len - vUv.y));
  float border = 1.0 - smoothstep(0.10, 0.36, bd);
  float pulse = 0.78 + 0.22 * sin(uTime * 7.0);
  vec3 plate = vec3(0.012, 0.028, 0.10) + vec3(0.02, 0.06, 0.20) * (0.5 + 0.5 * sin(vUv.y * 1.1 - uTime * 2.2)) * 0.35;
  vec3 col = plate + vec3(1.0, 0.24, 0.0) * chev * 1.55 + vec3(1.0, 0.46, 0.04) * chev * chev * 0.55 + vec3(1.0, 0.42, 0.02) * border * 1.45 * pulse;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    return mat;
  }

  dispose() {
    for (const d of this.disposables) d?.dispose?.();
    this.disposables.length = 0;
  }
}
