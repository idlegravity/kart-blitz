/**
 * Animated lake: a grid at the water level with per-vertex depth (from the terrain grid) driving colour,
 * alpha, shore foam; procedural wave normals, fresnel sky reflection, sun glitter. OWNER: World agent.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aDepth;
varying vec3 vW; varying float vDepth;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz; vDepth = aDepth;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uSkyTop, uSkyHorizon;
varying vec3 vW; varying float vDepth;
#include <fog_pars_fragment>
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec2 p = vW.xz;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(cos(p.x * 0.35 + t * 0.9 + p.y * 0.12), cos(p.y * 0.31 - t * 0.7 + p.x * 0.09)) * 0.07;
  g += vec2(cos(p.x * 0.9 - t * 1.6 + p.y * 0.5), cos(p.y * 0.8 + t * 1.4 - p.x * 0.4)) * 0.035;
  g += vec2(cos(p.x * 2.1 + t * 2.4), cos(p.y * 2.3 - t * 2.1)) * 0.014;
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  float fr = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 refl = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(refl.y * 1.5, 0.0, 1.0));
  float sd = max(dot(refl, uSunDir), 0.0);
  float sun = pow(sd, 260.0) * 16.0 + pow(sd, 20.0) * 0.4;
  float dep = clamp(vDepth / 3.2, 0.0, 1.0);
  vec3 body = mix(uShallow, uDeep, sqrt(dep));
  vec3 col = mix(body, sky, fr * 0.8) + uSunColor * sun;
  // glitter
  vec2 gc = floor(p * 5.0 + vec2(t * 0.7, -t * 0.45));
  float gr = hash21(gc);
  float gl = step(0.982, gr) * (0.5 + 0.5 * sin(t * 9.0 + gr * 40.0));
  col += vec3(1.0, 0.97, 0.88) * gl * 1.6 * smoothstep(0.0, 0.7, sd + 0.25);
  // shore foam
  float foam = smoothstep(0.6, 0.05, vDepth) * (0.55 + 0.45 * sin(vDepth * 16.0 - t * 2.4 + hash21(floor(p * 0.6)) * 6.0));
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(1.0), foam * 0.7);
  float alpha = smoothstep(-0.08, 0.45, vDepth) * mix(0.70, 0.96, dep);
  alpha = max(alpha, foam * 0.85 * step(-0.12, vDepth));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * @param {Track} track built track (terrain available)
 * @param {{mats: MatLib}} ctx
 * @param {{x:number,z:number,rx:number,rz:number,level:number}} lake
 */
export function buildWater(track, ctx, lake, tint = {}) {
  const terrain = track.terrain;
  const step = 2.2;
  const pad = 1.45;
  const nx = Math.ceil((lake.rx * 2 * pad) / step), nz = Math.ceil((lake.rz * 2 * pad) / step);
  const x0 = lake.x - lake.rx * pad, z0 = lake.z - lake.rz * pad;
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const dep = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = i + j * (nx + 1);
      const x = x0 + i * step, z = z0 + j * step;
      pos[k * 3] = x; pos[k * 3 + 1] = lake.level; pos[k * 3 + 2] = z;
      dep[k] = lake.level - terrain.heightAt(x, z);
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = i + j * (nx + 1), b = a + 1, c = a + nx + 1, d = c + 1;
      if (Math.max(dep[a], dep[b], dep[c], dep[d]) < -0.5) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const th = track.themeDef;
  const col = (h) => new THREE.Color(h);
  const mat = ctx.mats.shader({
    uniforms: {
      uTime: ctx.mats.time,
      uSunDir: { value: track.sunDirection },
      uSunColor: { value: col(th.sky.sunColor) },
      uDeep: { value: col(tint.deep ?? '#0d5aa8') },
      uShallow: { value: col(tint.shallow ?? '#2fd0d8') },
      uSkyTop: { value: col(th.sky.mid) },
      uSkyHorizon: { value: col(th.sky.horizon) },
    },
    vertex: VERT,
    fragment: FRAG,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 5;
  mesh.name = 'water';
  track.group.add(mesh);
  return mesh;
}
