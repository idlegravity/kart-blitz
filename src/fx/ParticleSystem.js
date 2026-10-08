/**
 * Pooled GPU particle system. Particles are analytic: the CPU only writes the spawn description into a ring buffer
 * (instanced attributes) and the vertex shader evaluates position / size / colour / alpha from the particle age, so
 * there is no per-particle CPU update. Two layers (additive + alpha blended) = 2 draw calls.
 *
 * Per particle:  p0.xyz + birth | v.xyz + life | c0.rgba (start) | c1.rgba (end) | size0, size1, cell, rot0 |
 *                gravity, drag, spin|stretch, mode
 * Modes: 0 camera-facing billboard, 1 velocity-stretched billboard (length = size * stretch), 2 flat on the ground
 *        (rings / dust discs), 3 fluttering billboard (confetti).
 * Colours can exceed 1 (HDR) on the additive layer to feed the bloom.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { createSpriteAtlas } from './sprites.js';

const VERT = /* glsl */ `
attribute vec4 aP0;
attribute vec4 aV;
attribute vec4 aC0;
attribute vec4 aC1;
attribute vec4 aS;
attribute vec4 aM;
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;

vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

void main() {
  float age = uTime - aP0.w;
  float life = aV.w;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vColor = vec4(0.0);
    return;
  }
  float t = age / life;
  float drag = aM.y;
  float tt = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec3 pos = aP0.xyz + aV.xyz * tt;
  pos.y -= 0.5 * aM.x * age * age;

  float te = 1.0 - (1.0 - t) * (1.0 - t);
  float size = mix(aS.x, aS.y, te);
  vec2 c = position.xy; // quad corner in [-0.5, 0.5]
  float mode = aM.w;
  vec4 mv;
  if (mode < 0.5) {
    float rot = aS.w + aM.z * age;
    mv = viewMatrix * vec4(pos, 1.0);
    mv.xy += rot2(c, rot) * size;
  } else if (mode < 1.5) {
    vec3 vel = aV.xyz * exp(-drag * age);
    vel.y -= aM.x * age;
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    vec2 dir = vv.xy;
    float dl = length(dir);
    dir = dl > 1e-4 ? dir / dl : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = size * aM.z;
    mv = viewMatrix * vec4(pos, 1.0);
    mv.xy += perp * c.x * size + dir * c.y * len;
  } else if (mode < 2.5) {
    float rot = aS.w + aM.z * age;
    vec2 r = rot2(c, rot) * size;
    mv = viewMatrix * vec4(pos + vec3(r.x, 0.0, r.y), 1.0);
  } else {
    float ph = aS.w * 7.0 + age * aM.z;
    vec2 cc = vec2(c.x * cos(ph * 1.3), c.y);
    mv = viewMatrix * vec4(pos, 1.0);
    mv.xy += rot2(cc, aS.w + age * aM.z * 0.35) * size;
  }
  gl_Position = projectionMatrix * mv;

  float cell = aS.z;
  float col = mod(cell, 4.0);
  float row = floor(cell / 4.0);
  vec2 uv = position.xy + 0.5;
  vUv = vec2((col + uv.x) * 0.25, 1.0 - (row + 1.0 - uv.y) * 0.25);
  float fadeIn = smoothstep(0.0, 0.05, t);
  float fadeOut = 1.0 - smoothstep(0.55, 1.0, t);
  vColor = vec4(mix(aC0.rgb, aC1.rgb, t), mix(aC0.a, aC1.a, t) * fadeIn * fadeOut);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  float a = vColor.a * tex.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * tex.rgb, a);
}
`;

/** One ring-buffered instanced layer. */
export class ParticleLayer {
  constructor(max, blending, atlas, uTime, renderOrder = 10, depthTest = true) {
    this.max = max;
    this.head = 0;
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    g.instanceCount = max;
    const mk = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.attr = { p0: mk(), v: mk(), c0: mk(), c1: mk(), s: mk(), m: mk() };
    // never-born particles: birth far in the future
    for (let i = 0; i < max; i++) this.attr.p0.array[i * 4 + 3] = 1e9;
    g.setAttribute('aP0', this.attr.p0);
    g.setAttribute('aV', this.attr.v);
    g.setAttribute('aC0', this.attr.c0);
    g.setAttribute('aC1', this.attr.c1);
    g.setAttribute('aS', this.attr.s);
    g.setAttribute('aM', this.attr.m);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime, uAtlas: { value: atlas } },
      transparent: true,
      depthWrite: false,
      depthTest,
      blending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.time = uTime;
  }

  /**
   * Spawn one particle. o: { x,y,z, vx,vy,vz, life, s0,s1, cell, rot, spin, r0,g0,b0,a0, r1,g1,b1,a1, grav, drag, mode, stretch }
   */
  add(o) {
    const i = this.head;
    this.head = (i + 1) % this.max;
    const A = this.attr;
    const k = i * 4;
    const t = this.time.value;
    A.p0.array[k] = o.x; A.p0.array[k + 1] = o.y; A.p0.array[k + 2] = o.z; A.p0.array[k + 3] = t;
    A.v.array[k] = o.vx ?? 0; A.v.array[k + 1] = o.vy ?? 0; A.v.array[k + 2] = o.vz ?? 0; A.v.array[k + 3] = o.life ?? 1;
    A.c0.array[k] = o.r0 ?? 1; A.c0.array[k + 1] = o.g0 ?? 1; A.c0.array[k + 2] = o.b0 ?? 1; A.c0.array[k + 3] = o.a0 ?? 1;
    A.c1.array[k] = o.r1 ?? o.r0 ?? 1; A.c1.array[k + 1] = o.g1 ?? o.g0 ?? 1; A.c1.array[k + 2] = o.b1 ?? o.b0 ?? 1; A.c1.array[k + 3] = o.a1 ?? 0;
    const s0 = o.s0 ?? 0.3;
    A.s.array[k] = s0; A.s.array[k + 1] = o.s1 ?? s0; A.s.array[k + 2] = o.cell ?? 0; A.s.array[k + 3] = o.rot ?? 0;
    const mode = o.mode ?? 0;
    A.m.array[k] = o.grav ?? 0; A.m.array[k + 1] = o.drag ?? 0; A.m.array[k + 2] = mode === 1 ? (o.stretch ?? 3) : (o.spin ?? 0); A.m.array[k + 3] = mode;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** Upload dirty instance data. Call once per frame after spawning. */
  flush() {
    if (this.dirtyMax < 0) return;
    const wrapped = this.dirtyMax - this.dirtyMin > this.max * 0.6;
    for (const a of Object.values(this.attr)) {
      a.clearUpdateRanges();
      if (!wrapped) a.addUpdateRange(this.dirtyMin * 4, (this.dirtyMax - this.dirtyMin + 1) * 4);
      a.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  clear() {
    const p = this.attr.p0.array;
    for (let i = 0; i < this.max; i++) p[i * 4 + 3] = 1e9;
    this.head = 0;
    for (const a of Object.values(this.attr)) {
      a.clearUpdateRanges();
      a.needsUpdate = true;
    }
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Additive + alpha layers sharing one atlas and clock. */
export class ParticleSystem {
  /**
   * @param {{additive: number, alpha: number}} caps capacities
   */
  constructor(caps = { additive: 6000, alpha: 3000, overlay: 600 }) {
    this.atlas = createSpriteAtlas();
    this.uTime = { value: 0 };
    this.group = new THREE.Group();
    this.group.name = 'particles';
    this.alpha = new ParticleLayer(caps.alpha, THREE.NormalBlending, this.atlas, this.uTime, 10);
    this.additive = new ParticleLayer(caps.additive, THREE.AdditiveBlending, this.atlas, this.uTime, 11);
    // big flashes / shock rings: additive WITHOUT depth test so the ground can never slice them
    this.overlay = new ParticleLayer(caps.overlay ?? 600, THREE.AdditiveBlending, this.atlas, this.uTime, 12, false);
    this.group.add(this.alpha.mesh, this.additive.mesh, this.overlay.mesh);
  }
  get time() {
    return this.uTime.value;
  }
  update(dt) {
    this.uTime.value += dt;
    this.alpha.flush();
    this.additive.flush();
    this.overlay.flush();
  }
  clear() {
    this.alpha.clear();
    this.additive.clear();
    this.overlay.clear();
  }
  dispose() {
    this.alpha.dispose();
    this.additive.dispose();
    this.overlay.dispose();
    this.atlas.dispose();
  }
}
