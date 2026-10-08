/**
 * The single "uber" material used for every kart part (chassis, wheels, driver...).
 * MeshPhysicalMaterial + a shader patch that reads the per-vertex attributes written by PartBuilder (geo.js):
 *   color (albedo), aSurf (roughness, metalness, emissive amount, clearcoat), aFlex/aPivot (GPU secondary motion).
 * Uniform-driven effects (per model instance): star rainbow, scorch, dither fade (invulnerability flicker),
 * white flash, blink squash, beacon / brake-light pulsing, rim light.
 * OWNER: Visuals.
 */
import * as THREE from 'three';

export const FLEX_CHANNELS = 12;

/** Per-instance uniform set. Shared by every material instance of one KartModel. */
export function makeKartUniforms(atlas = null) {
  return {
    uAtlas: { value: atlas ?? whiteTexture() },
    uTime: { value: 0 },
    uBlink: { value: 0 },
    uBeacon: { value: 1 },
    uBrake: { value: 0 },
    uStar: { value: 0 },
    uScorch: { value: 0 },
    uFade: { value: 1 },
    uFlash: { value: 0 },
    uRimColor: { value: new THREE.Color(0.2, 0.26, 0.4) },
    uFlex: { value: Array.from({ length: FLEX_CHANNELS }, () => new THREE.Vector3()) },
    uWave: { value: Array.from({ length: FLEX_CHANNELS }, () => new THREE.Vector4()) },
  };
}

const VERT_DECL = /* glsl */ `
attribute vec4 aSurf;
attribute vec3 aFlex;
attribute vec3 aPivot;
uniform vec3 uFlex[${FLEX_CHANNELS}];
uniform vec4 uWave[${FLEX_CHANNELS}];
uniform float uTime;
uniform float uBlink;
uniform float uBeacon;
uniform float uBrake;
varying vec4 vSurf;
varying vec3 vWPos;
varying vec3 vLPos;
varying vec2 vAtlasUv;

mat3 flexRot(vec3 v) {
  float a = length(v);
  if (a < 1e-5) return mat3(1.0);
  vec3 k = v / a;
  float s = sin(a), c = cos(a), t = 1.0 - c;
  return mat3(
    t * k.x * k.x + c,       t * k.x * k.y + s * k.z, t * k.x * k.z - s * k.y,
    t * k.x * k.y - s * k.z, t * k.y * k.y + c,       t * k.y * k.z + s * k.x,
    t * k.x * k.z + s * k.y, t * k.y * k.z - s * k.x, t * k.z * k.z + c);
}
`;

const VERT_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
mat3 flexM = mat3(1.0);
float flexOn = 0.0;
vSurf = aSurf;
if (vSurf.z < 0.0) vSurf.z = -vSurf.z * uBeacon; // negative emissive = pulsing beacon
{
  float ch = aFlex.y;
  if (ch > -0.5) {
    if (ch < 11.5) {
      int ci = int(ch + 0.5);
      vec3 ang = uFlex[ci] * aFlex.x;
      vec4 wv = uWave[ci];
      ang += wv.xyz * (sin(uTime * wv.w - aFlex.z * 6.2831853) * aFlex.x);
      flexM = flexRot(ang);
      flexOn = 1.0;
      objectNormal = flexM * objectNormal;
    } else if (ch < 12.5) {
      flexOn = 2.0;
    } else if (ch < 13.5) {
      vSurf.z *= uBeacon;
    } else if (ch < 14.5) {
      vSurf.z *= uBrake;
    }
  }
}
`;

const VERT_BEGIN = /* glsl */ `
vec3 transformed = vec3( position );
if (flexOn > 0.5) {
  if (flexOn < 1.5) transformed = aPivot + flexM * (position - aPivot);
  else transformed.y = aPivot.y + (position.y - aPivot.y) * (1.0 - 0.93 * uBlink);
}
vLPos = transformed;
vAtlasUv = uv;
`;

const VERT_AFTER_PROJECT = /* glsl */ `
#include <project_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_DECL = /* glsl */ `
varying vec4 vSurf;
varying vec3 vWPos;
varying vec3 vLPos;
varying vec2 vAtlasUv;
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uStar;
uniform float uScorch;
uniform float uFade;
uniform float uFlash;
uniform vec3 uRimColor;
`;

const FRAG_COLOR = /* glsl */ `
#include <color_fragment>
{
  vec4 atx = texture2D(uAtlas, vAtlasUv);
  diffuseColor.rgb = mix(diffuseColor.rgb, atx.rgb, atx.a);
  // cartoon saturation curve: deeper, richer albedo (keeps whites, deepens saturated hues)
  diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.16));
}
if (uFade < 0.999) {
  float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (ign > uFade) discard;
}
if (uScorch > 0.001) {
  float soot = 0.5 + 0.5 * sin(vLPos.x * 9.0 + vLPos.y * 13.0) * sin(vLPos.z * 11.0 + vLPos.y * 7.0);
  diffuseColor.rgb *= mix(1.0, 0.1 + 0.12 * soot, uScorch);
}
`;

const FRAG_METAL = /* glsl */ `
#include <metalnessmap_fragment>
roughnessFactor = mix(vSurf.x, 0.9, uScorch);
metalnessFactor = vSurf.y * (1.0 - 0.6 * uScorch);
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vSurf.z;
`;

const FRAG_PHYS = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= vSurf.w * (1.0 - uScorch);
#endif
`;

const FRAG_OPAQUE = /* glsl */ `
{
  vec3 vdir = normalize(vViewPosition);
  float fres = pow(1.0 - saturate(dot(normalize(normal), vdir)), 3.0);
  outgoingLight += uRimColor * fres * (0.55 + 0.45 * vSurf.w) * (1.0 - uScorch);
  if (uStar > 0.001) {
    float h = uTime * 0.9 + vWPos.y * 0.75 + vWPos.x * 0.35 + vWPos.z * 0.2 + fres * 0.6;
    vec3 rb = 0.5 + 0.5 * cos(6.2831853 * (h + vec3(0.0, 0.3333, 0.6667)));
    outgoingLight = mix(outgoingLight, outgoingLight * rb * 1.5, uStar * 0.65) + rb * uStar * (0.28 + 2.4 * fres);
  }
  outgoingLight += uFlash * vec3(1.0, 0.94, 0.82);
}
#include <opaque_fragment>
`;

/**
 * Create a kart material. `uniforms` come from makeKartUniforms() (share one set per model so
 * every mesh of the model reacts to the same state).
 */
export function createKartMaterial(uniforms, { quality = 'high' } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0,
    clearcoat: quality === 'low' || quality === 'mobile' ? 0 : 1,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', VERT_BEGIN)
      .replace('#include <project_vertex>', VERT_AFTER_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <metalnessmap_fragment>', FRAG_METAL)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
      .replace('#include <lights_physical_fragment>', FRAG_PHYS)
      .replace('#include <opaque_fragment>', FRAG_OPAQUE);
  };
  mat.customProgramCacheKey = () => 'kartuber-v1';
  return mat;
}

/** Tiny fully transparent atlas (alpha 0 = no override) for materials that don't need decals. */
let _empty = null;
export function whiteTexture() {
  if (!_empty) {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    _empty = new THREE.CanvasTexture(c);
    _empty.colorSpace = THREE.SRGBColorSpace;
  }
  return _empty;
}
