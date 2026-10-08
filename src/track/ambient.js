/**
 * Camera-local ambient particles (snow, pollen, dust motes, neon sparks): one THREE.Points whose positions
 * are computed entirely in the vertex shader (wrapped into a box around the camera) — zero CPU per frame.
 * OWNER: World agent.
 */
import * as THREE from 'three';
import { hash2 } from './noise.js';
import { makeFlakeTexture } from './textures.js';

/**
 * @param {Track} track
 * @param {{mats: MatLib, density?: number}} ctx
 * @param {{ count?:number, box?:number[], size?:number, color?:string|number[], vel?:number[], wobble?:number,
 *           alpha?:number, additive?:boolean, twinkle?:number, sizeClamp?:number[], name?:string }} o
 */
export function buildAmbient(track, ctx, o = {}) {
  const count = Math.round((o.count ?? 1500) * Math.max(0.45, ctx.density ?? 1));
  const box = o.box ?? [80, 46, 80];
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    seeds[i * 3] = hash2(i, 1, 71);
    seeds[i * 3 + 1] = hash2(i, 2, 71);
    seeds[i * 3 + 2] = hash2(i, 3, 71);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  const tex = ctx.mats.add(makeFlakeTexture());
  const uCam = { value: new THREE.Vector3() };
  const color = new THREE.Color(typeof o.color === 'string' || typeof o.color === 'number' ? o.color : 0xffffff);
  const vel = o.vel ?? [1.6, -3.0, 0.4];
  const mat = ctx.mats.add(new THREE.ShaderMaterial({
    uniforms: {
      uTime: ctx.mats.time, uCam, uBox: { value: new THREE.Vector3(...box) }, uSize: { value: o.size ?? 5 },
      uVel: { value: new THREE.Vector3(...vel) }, uColor: { value: color.multiplyScalar(o.intensity ?? 1) },
      uWobble: { value: o.wobble ?? 1 }, uAlpha: { value: o.alpha ?? 0.85 }, uTwinkle: { value: o.twinkle ?? 0 },
      uClamp: { value: new THREE.Vector2(...(o.sizeClamp ?? [1.5, 22])) }, uTex: { value: tex },
    },
    vertexShader: /* glsl */ `
uniform float uTime, uSize, uWobble, uTwinkle; uniform vec3 uCam, uBox, uVel; uniform vec2 uClamp;
attribute vec3 aSeed; varying float vA;
void main() {
  vec3 p = aSeed * uBox;
  float t = uTime;
  p += uVel * t * (0.7 + aSeed.x * 0.6);
  p.x += sin(t * 0.7 + aSeed.z * 20.0) * 1.3 * uWobble;
  p.z += sin(t * 0.5 + aSeed.y * 30.0) * 0.9 * uWobble;
  p.y += sin(t * 0.9 + aSeed.x * 25.0) * 0.5 * uWobble;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * (260.0 / max(1.0, -mv.z)) * (0.55 + aSeed.y * 0.9), uClamp.x, uClamp.y);
  float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(t * (2.0 + aSeed.x * 4.0) + aSeed.z * 60.0));
  vA = (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(rel.xz))) * (1.0 - smoothstep(uBox.y * 0.35, uBox.y * 0.5, abs(rel.y))) * tw;
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D uTex; uniform vec3 uColor; uniform float uAlpha; varying float vA;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(uColor, t.a * vA * uAlpha);
}`,
    transparent: true,
    depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  }));
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 8;
  pts.name = o.name ?? 'ambient';
  track.group.add(pts);
  track.animators.push(() => {
    const cam = track.game?.camera;
    if (cam) uCam.value.copy(cam.position);
  });
  return pts;
}
