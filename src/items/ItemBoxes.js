/**
 * ItemBoxes — the rotating iridescent "?" cubes that hand out items.
 *
 * One InstancedMesh for the translucent rainbow cubes (custom shader: fresnel-driven hue, glowing "?" on every
 * face, frame glow), one for the inner gem cores. Boxes float `hover` metres above `track.itemBoxSlots`, bob and
 * spin, hide when collected and pop back after `respawn` seconds.
 *
 * OWNER: Gameplay agent.
 */
import * as THREE from 'three';
import { buildBoxGeometry, buildBoxCoreGeometry, buildBoxFaceTexture } from './itemGeometry.js';
import { TUNING } from './itemTables.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

const easeOutBack = (t) => {
  const c1 = 1.9, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute float aPhase;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  varying vec2 vUv;
  varying float vPhase;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    mat3 nm = mat3(modelMatrix) * mat3(instanceMatrix);
    float sc = length(instanceMatrix[0].xyz);
    vNormalW = normalize(nm * normal / max(sc, 1e-4));
    vViewDirW = cameraPosition - wp.xyz;
    vPhase = aPhase;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uFace;
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  varying vec2 vUv;
  varying float vPhase;
  #include <fog_pars_fragment>
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }
  void main() {
    vec4 f = texture2D(uFace, vUv);
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewDirW);
    if (!gl_FrontFacing) N = -N;
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, 2.0);
    float hue = fract(vPhase + uTime * 0.11 + fres * 0.5 + (vUv.x + vUv.y) * 0.14);
    vec3 rain = hsv2rgb(vec3(hue, 0.9, 1.0));
    float front = gl_FrontFacing ? 1.0 : 0.0;
    float qv = mix(0.16, 1.0, front); // the mirrored "?" seen through the far faces stays faint
    vec3 col = rain * (0.55 + 1.35 * fres + 1.05 * f.g * mix(0.6, 1.0, front) + 0.5 * f.b * qv);
    col += mix(vec3(1.0), rain, 0.2) * f.r * 4.2 * qv;
    float a = clamp(0.4 + fres * 0.45 + f.g * 0.6 * mix(0.6, 1.0, front) + f.b * 0.3 * qv + f.r * 0.9 * qv, 0.0, 0.95);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class ItemBoxes {
  /**
   * @param {THREE.Group} group
   * @param {Array<{position:THREE.Vector3, s:number, lateral:number}>} slots
   */
  constructor(group, slots) {
    this.group = group;
    const T = TUNING.boxes;
    this.T = T;
    this.time = 0;
    /** Public list (ItemSystem.boxes): { position (cube centre), active, s, lateral, ... } */
    this.list = [];
    const n = slots.length;
    for (let i = 0; i < n; i++) {
      const sl = slots[i];
      this.list.push({
        position: new THREE.Vector3(sl.position.x, sl.position.y + (Number.isFinite(sl.hover) ? sl.hover : T.hover), sl.position.z),
        active: true,
        s: sl.s,
        lateral: sl.lateral,
        slot: sl,
        index: i,
        timer: 0, // respawn countdown
        pop: 1, //   0..1 pop-in progress (1 = settled)
        phase: (i * 0.6180339887) % 1,
      });
    }

    this.faceTex = buildBoxFaceTexture();
    this.cubeGeo = buildBoxGeometry(T.size);
    this.coreGeo = buildBoxCoreGeometry(T.size);
    const phases = new Float32Array(Math.max(1, n));
    for (let i = 0; i < n; i++) phases[i] = this.list[i].phase;
    this.cubeGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    // NB: UniformsUtils.merge clones textures, so only merge the fog block and add ours by reference
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.uFace = { value: this.faceTex };
    uniforms.uTime = { value: 0 };
    this.cubeMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

    const cap = Math.max(1, n);
    this.cubes = new THREE.InstancedMesh(this.cubeGeo, this.cubeMat, cap);
    this.cores = new THREE.InstancedMesh(this.coreGeo, this.coreMat, cap);
    for (const im of [this.cubes, this.cores]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = n;
    }
    this.cores.setColorAt(0, _c.set(1, 1, 1));
    this.cores.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.cubes.renderOrder = 10;
    this.cores.renderOrder = 11;
    this.cubes.name = 'items:boxes';
    this.cores.name = 'items:boxCores';
    group.add(this.cubes, this.cores);
    this.update(0);
  }

  /** Mark a box collected. */
  collect(box) {
    box.active = false;
    box.timer = this.T.respawn;
    box.pop = 0;
  }

  /** First active box whose centre is within the pickup radius of the kart centre (or null). */
  find(kart, radius = this.T.pickupRadius) {
    const kx = kart.position.x, ky = kart.position.y + 0.6, kz = kart.position.z;
    const r2 = radius * radius;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (!b.active) continue;
      const dx = b.position.x - kx, dy = b.position.y - ky, dz = b.position.z - kz;
      if (dx * dx + dy * dy + dz * dz < r2) return b;
    }
    return null;
  }

  update(dt) {
    const T = this.T;
    this.time += dt;
    const t = this.time;
    this.cubeMat.uniforms.uTime.value = t;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active) {
        b.timer -= dt;
        if (b.timer <= 0) {
          b.active = true;
          b.pop = 0;
        }
      }
      let scale;
      if (!b.active) scale = 0;
      else {
        if (b.pop < 1) b.pop = Math.min(1, b.pop + dt / T.popTime);
        scale = b.pop >= 1 ? 1 : Math.max(0, easeOutBack(b.pop));
      }
      const ph = b.phase * Math.PI * 2;
      const bob = Math.sin(t * T.bobSpeed + ph) * T.bobAmp;
      _p.set(b.position.x, b.position.y + bob, b.position.z);
      _e.set(0.32 + 0.12 * Math.sin(t * 1.1 + ph), t * T.spin + ph, 0.22 * Math.sin(t * 0.9 + ph * 1.3), 'YXZ');
      _q.setFromEuler(_e);
      b.scale = scale;
      b.bobY = bob;
      _s.setScalar(scale);
      _m.compose(_p, _q, _s);
      this.cubes.setMatrixAt(i, _m);
      // core: counter-rotating gem that breathes
      _e.set(t * 1.7 + ph, -t * 2.3, t * 1.1);
      _q.setFromEuler(_e);
      _s.setScalar(scale * (0.92 + 0.12 * Math.sin(t * 5 + ph)));
      _m.compose(_p, _q, _s);
      this.cores.setMatrixAt(i, _m);
      // rainbow core colour (HDR so bloom picks it up)
      _c.setHSL((b.phase + t * 0.17) % 1, 1, 0.55).multiplyScalar(2.6);
      this.cores.setColorAt(i, _c);
    }
    this.cubes.instanceMatrix.needsUpdate = true;
    this.cores.instanceMatrix.needsUpdate = true;
    this.cores.instanceColor.needsUpdate = true;
  }

  /** Soft rainbow beacons behind every live box (drawn through the shared additive glow mesh) so boxes read from afar. */
  addHalos(R) {
    const t = this.time;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active || !(b.scale > 0.02)) continue;
      _c.setHSL((b.phase + t * 0.17) % 1, 0.9, 0.55);
      _p.set(b.position.x, b.position.y + (b.bobY ?? 0), b.position.z);
      R.addGlow(_p, _c.r * 0.9, _c.g * 0.9, _c.b * 0.9, 1.75 * b.scale);
    }
  }

  dispose() {
    this.group.remove(this.cubes, this.cores);
    this.cubes.dispose?.();
    this.cores.dispose?.();
    this.cubeGeo.dispose();
    this.coreGeo.dispose();
    this.cubeMat.dispose();
    this.coreMat.dispose();
    this.faceTex.dispose();
    this.list.length = 0;
  }
}
