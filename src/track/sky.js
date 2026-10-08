/**
 * Sky dome (camera-centred, drawn at the far plane) + PMREM environment.
 * Gradient sky, sun disc & glow, procedural cumulus clouds by day, stars / nebula / moon by night.
 * OWNER: World agent.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith, uMid, uHorizon, uGround, uSunDir, uSunColor, uCloudColor, uCloudShade;
uniform float uTime, uCloudCover, uCloudSpeed, uSunSize, uStars, uNebula, uEnv, uHaze;
varying vec3 vDir;

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 hash22(vec2 p) { float n = hash21(p); return vec2(n, hash21(p + n * 17.0)); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.32, h));
  col = mix(col, uZenith, smoothstep(0.18, 0.95, h));
  // ground / below-horizon haze
  col = mix(col, uGround, smoothstep(0.015, -0.18, h));
  // horizon haze band
  col = mix(col, uHorizon, (1.0 - smoothstep(0.0, 0.16, abs(h))) * uHaze * 0.55);

  float sd = max(dot(d, uSunDir), 0.0);
  float env = mix(1.0, 0.35, uEnv);

  // ---------------- stars / nebula (night) ----------------
  if (uStars > 0.5 && h > -0.05) {
    vec2 g = vec2(atan(d.x, d.z) * 46.0, asin(clamp(d.y, -1.0, 1.0)) * 92.0);
    vec2 id = floor(g), f = fract(g);
    float rnd = hash21(id + 3.7);
    vec2 jit = hash22(id) * 0.6 + 0.2;
    float star = step(0.955, rnd) * smoothstep(0.16, 0.0, length(f - jit));
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + rnd * 4.0) + rnd * 40.0);
    vec3 sc = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.85, 0.7), hash21(id + 9.1));
    col += sc * star * tw * (1.2 + 3.0 * step(0.992, rnd)) * smoothstep(0.0, 0.2, h);
    // small far stars
    vec2 g2 = g * 2.3 + 11.0;
    vec2 id2 = floor(g2), f2 = fract(g2);
    float r2 = hash21(id2);
    col += vec3(0.7, 0.8, 1.0) * step(0.965, r2) * smoothstep(0.2, 0.0, length(f2 - 0.5)) * 0.35 * smoothstep(0.0, 0.2, h);
  }
  if (uNebula > 0.5) {
    vec2 nuv = d.xz / (abs(h) + 0.6) * 1.3;
    float n1 = fbm(nuv * 1.1 + 3.0), n2 = fbm(nuv * 2.4 - 7.0), n3 = fbm(nuv * 0.6 + 20.0);
    float neb = smoothstep(0.42, 0.85, n1) * (0.35 + 0.65 * n3);
    vec3 nc = mix(vec3(0.55, 0.08, 0.75), vec3(0.06, 0.45, 1.0), smoothstep(0.35, 0.7, n2));
    nc = mix(nc, vec3(1.0, 0.2, 0.55), smoothstep(0.65, 0.9, n3) * 0.6);
    // milky band across the sky
    vec3 bn = normalize(vec3(0.35, 0.2, 0.9));
    float band = exp(-pow(dot(d, bn) * 3.2, 2.0));
    col += nc * neb * (0.30 + band * 0.85) * smoothstep(-0.05, 0.3, h);
    col += vec3(0.5, 0.45, 0.9) * band * fbm(nuv * 6.0) * 0.12 * smoothstep(0.0, 0.3, h);
  }

  // ---------------- clouds ----------------
  if (uCloudCover > 0.001 && h > 0.0) {
    vec2 uv = d.xz / (h + 0.16) * 0.5;
    uv += vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.35);
    float n = fbm(uv * 1.15);
    float thr = 0.74 - uCloudCover * 0.34;
    float cov = smoothstep(thr, thr + 0.17, n);
    float n2 = fbm(uv * 1.15 + uSunDir.xz * 0.09 / max(0.25, uSunDir.y + 0.4));
    float lit = clamp(0.80 + (n - n2) * 5.0, 0.0, 1.0);
    float thick = smoothstep(thr, thr + 0.32, n);
    vec3 cc = mix(uCloudShade, uCloudColor, lit * (1.0 - 0.22 * thick) + 0.18 * (1.0 - thick));
    cc += uSunColor * pow(sd, 6.0) * 0.35 * (1.0 - thick * 0.6);
    // silver lining / backlit rim
    cc += uSunColor * pow(sd, 3.0) * 0.12 * (1.0 - cov);
    float fade = smoothstep(0.0, 0.22, h);
    col = mix(col, cc, cov * fade * 0.96);
    // thin high wisps
    vec2 wu = vec2(d.x * 1.3, d.z * 0.42) / (h + 0.3) + uTime * uCloudSpeed * 0.6;
    float w = smoothstep(0.55, 0.85, fbm(wu * 2.2 + 40.0)) * 0.35 * uCloudCover;
    col = mix(col, uCloudColor, w * smoothstep(0.05, 0.4, h));
  }

  // ---------------- sun / moon ----------------
  float ang = acos(clamp(sd, -1.0, 1.0));
  float r = 0.026 * uSunSize;
  float disc = 1.0 - smoothstep(r * 0.9, r * 1.1, ang);
  float glow = exp(-ang * 9.0 / uSunSize) * 0.55 + exp(-ang * 2.6 / uSunSize) * 0.16;
  if (uStars > 0.5) {
    // moon: soft disc with faint maria
    float maria = 0.86 + 0.14 * fbm(d.xz * 60.0 + d.y * 30.0);
    col += uSunColor * disc * 1.7 * maria * env;
    col += uSunColor * glow * 0.32;
  } else {
    col += uSunColor * (disc * 12.0 * env + glow * mix(1.0, 0.45, uEnv));
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Create the sky dome.
 * @param {object} sky theme.sky block
 * @param {THREE.Vector3} sunDir unit vector toward the sun
 * @param {{env?: boolean}} [opts]
 */
export function createSky(sky, sunDir, opts = {}) {
  const c = (hex) => new THREE.Color(hex);
  const uniforms = {
    uZenith: { value: c(sky.zenith) },
    uMid: { value: c(sky.mid) },
    uHorizon: { value: c(sky.horizon) },
    uGround: { value: c(sky.ground) },
    uSunDir: { value: sunDir.clone() },
    uSunColor: { value: c(sky.sunColor) },
    uCloudColor: { value: c(sky.cloudColor) },
    uCloudShade: { value: c(sky.cloudShade) },
    uTime: { value: 0 },
    uCloudCover: { value: sky.cloudCover ?? 0 },
    uCloudSpeed: { value: sky.cloudSpeed ?? 0.005 },
    uSunSize: { value: sky.sunSize ?? 1 },
    uStars: { value: sky.stars ? 1 : 0 },
    uNebula: { value: sky.nebula ? 1 : 0 },
    uEnv: { value: opts.env ? 1 : 0 },
    uHaze: { value: sky.hazeStrength ?? 0.5 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const geometry = new THREE.SphereGeometry(1, 48, 32);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  mesh.name = 'sky';
  return { mesh, material, geometry, uniforms };
}

/** PMREM environment from the sky (karts need reflections). Returns the render target (dispose it later). */
export function createEnvironment(renderer, sky, sunDir) {
  const { mesh, material, geometry } = createSky(sky, sunDir, { env: true });
  const scene = new THREE.Scene();
  scene.add(mesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.0, 0.1, 10);
  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  return rt;
}
