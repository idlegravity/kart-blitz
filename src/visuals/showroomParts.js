/**
 * Building blocks of the menu Showroom: gradient backdrop dome with animated light streaks, glossy reflective floor,
 * character turntable + light beam, podium + trophy, glowing track miniature.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// =================================================================================================================
// backdrop
// =================================================================================================================
export function createBackdrop() {
  const uniforms = {
    uTime: { value: 0 },
    uTop: { value: new THREE.Color('#0a0e3a') },
    uMid: { value: new THREE.Color('#361a80') },
    uBot: { value: new THREE.Color('#0c1030') },
    uGlow: { value: new THREE.Color('#ff4fa8') },
    uStreak: { value: new THREE.Color('#5ad8ff') },
    uStreakAmt: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uStreakAmt;
      uniform vec3 uTop, uMid, uBot, uGlow, uStreak;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 horizon = mix(uMid, uGlow, 0.35) * 0.9;
        vec3 col = mix(uBot, uMid, smoothstep(-0.3, 0.12, h));
        col = mix(col, uTop, smoothstep(0.08, 0.85, h));
        col = mix(col, horizon, 1.0 - smoothstep(-0.02, 0.06, h)); // seamless with the floor fog below the horizon
        col += uGlow * exp(-abs(h - 0.03) * 8.0) * 0.45;
        // slow diagonal light streaks
        float a = atan(d.x, -d.z);
        float s = sin(a * 6.0 + h * 5.0 + uTime * 0.22) * sin(a * 3.0 - h * 8.0 - uTime * 0.16);
        col += uStreak * smoothstep(0.62, 1.0, s) * 0.2 * uStreakAmt * smoothstep(-0.05, 0.4, h);
        float s2 = sin(a * 11.0 - h * 14.0 + uTime * 0.3);
        col += uGlow * smoothstep(0.9, 1.0, s2) * 0.1 * uStreakAmt * smoothstep(0.0, 0.5, h);
        // twinkling stars in the upper dome
        vec2 gp = vec2(a * 46.0, h * 70.0);
        vec2 g = floor(gp);
        float r = hash(g);
        vec2 f = fract(gp) - 0.5 - (vec2(hash(g + 3.1), hash(g + 7.7)) - 0.5) * 0.5;
        float tw = 0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
        col += vec3(1.0) * step(0.975, r) * smoothstep(0.16, 0.0, length(f)) * tw * 0.9 * smoothstep(0.1, 0.5, h);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(120, 40, 20), mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// =================================================================================================================
// floor
// =================================================================================================================
export const FloorShader = {
  name: 'ShowroomFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uTint: { value: new THREE.Color('#39d8ff') },
    uGlow: { value: new THREE.Color('#ff4fa8') },
    uFog: { value: new THREE.Color('#0c1030') },
    uFocus: { value: new THREE.Vector2(0, 0) },
    uGrid: { value: 1 },
    uRefl: { value: 1 },
    uPool: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color, uTint, uGlow, uFog;
    uniform sampler2D tDiffuse;
    uniform vec2 uFocus;
    uniform float uTime, uGrid, uRefl, uPool;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vec2 uv = vUv.xy / vUv.w;
      float r = length(vWorld.xz);
      float k = 0.0022 + 0.0045 * smoothstep(2.0, 26.0, r);
      vec3 refl = texture2D(tDiffuse, uv).rgb * 0.2;
      refl += texture2D(tDiffuse, uv + vec2(k, 0.0)).rgb * 0.2;
      refl += texture2D(tDiffuse, uv - vec2(k, 0.0)).rgb * 0.2;
      refl += texture2D(tDiffuse, uv + vec2(0.0, k)).rgb * 0.2;
      refl += texture2D(tDiffuse, uv - vec2(0.0, k)).rgb * 0.2;
      refl = min(refl, vec3(1.6)); // no HDR blow-outs in the mirror
      float fade = exp(-r * 0.05);
      float d = length(vWorld.xz - uFocus);
      vec3 base = color * (0.5 + 0.9 * exp(-d * 0.12));
      vec3 pool = uGlow * exp(-d * d * 0.04) * 0.5 * uPool;
      vec2 gp = vWorld.xz / 1.5;
      vec2 gl = abs(fract(gp - 0.5) - 0.5) / max(fwidth(gp), vec2(1e-4));
      float line = 1.0 - min(min(gl.x, gl.y), 1.0);
      vec3 grid = uTint * line * 0.4 * exp(-r * 0.085) * uGrid;
      vec3 col = base + pool + grid + refl * (0.3 + 0.3 * fade) * uRefl;
      col = mix(col, uFog, smoothstep(30.0, 95.0, r));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Reflective (or plain, on low quality) floor disc. */
export function createFloor(quality, w, h, pr) {
  const geo = new THREE.CircleGeometry(260, 96);
  if (quality === 'low') {
    // same shader without the mirror (uRefl = 0)
    const uniforms = THREE.UniformsUtils.clone(FloorShader.uniforms);
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    uniforms.tDiffuse.value = black;
    uniforms.textureMatrix.value = new THREE.Matrix4();
    uniforms.color.value = new THREE.Color('#161c48');
    uniforms.uRefl.value = 0;
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: FloorShader.vertexShader, fragmentShader: FloorShader.fragmentShader, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return { mesh, uniforms, reflector: null };
  }
  const scale = quality === 'high' ? 0.6 : 0.4;
  const refl = new Reflector(geo, {
    shader: FloorShader,
    color: new THREE.Color('#161c48'),
    textureWidth: Math.max(128, Math.round(w * pr * scale)),
    textureHeight: Math.max(128, Math.round(h * pr * scale)),
    clipBias: 0.004,
    multisample: 0,
  });
  refl.rotation.x = -Math.PI / 2;
  return { mesh: refl, uniforms: refl.material.uniforms, reflector: refl };
}

// =================================================================================================================
// turntable
// =================================================================================================================
export function createTurntable() {
  const g = new THREE.Group();
  const discMat = new THREE.MeshPhysicalMaterial({ color: '#0b0f28', metalness: 0.25, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.2 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.42, 0.18, 72), discMat);
  disc.position.y = 0.09;
  disc.receiveShadow = true;
  g.add(disc);
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#38d8ff').multiplyScalar(2.0), toneMapped: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#38d8ff'), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.33, 0.045, 10, 96), glowMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.18;
  g.add(rim);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(2.33, 0.26, 8, 96), haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.2;
  g.add(halo);
  const inner = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.018, 8, 96), glowMat);
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.185;
  g.add(inner);
  // tick marks around the rim (single merged look via thin boxes)
  const ticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.02, 0.22), glowMat, 48);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    q.setFromEuler(new THREE.Euler(0, -a, 0));
    m.compose(new THREE.Vector3(Math.sin(a) * 2.0, 0.19, Math.cos(a) * 2.0), q, new THREE.Vector3(1, 1, 1));
    ticks.setMatrixAt(i, m);
  }
  g.add(ticks);
  // light beam
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#38d8ff') }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float h = vUv.y; // 0 bottom .. 1 top
        float edge = pow(abs(dot(normalize(-vN), normalize(vV))), 1.4); // fades to 0 at the silhouette
        float a = pow(1.0 - h, 1.9) * 0.13 * edge;
        float band = 0.85 + 0.15 * sin(vUv.x * 60.0 + uTime * 0.8);
        gl_FragColor = vec4(uColor * 1.2, a * band);
      }`,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.3, 7.5, 56, 1, true), beamMat);
  beam.position.y = 3.8;
  beam.renderOrder = 5;
  g.add(beam);
  return { group: g, glowMat, haloMat, beamMat, disc };
}

// =================================================================================================================
// podium + trophy
// =================================================================================================================
function numberTexture(n, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, 256, 256);
  g.font = '900 190px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(40,20,0,0.55)';
  g.strokeText(String(n), 128, 136);
  g.fillStyle = color;
  g.fillText(String(n), 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPodium() {
  const g = new THREE.Group();
  const specs = [
    { place: 1, x: 0, h: 1.5, color: '#ffc830', num: '#fff2b0' },
    { place: 2, x: -2.65, h: 1.0, color: '#d5dbe8', num: '#ffffff' },
    { place: 3, x: 2.65, h: 0.66, color: '#d98444', num: '#ffe0c0' },
  ];
  const tops = {};
  for (const s of specs) {
    const mat = new THREE.MeshPhysicalMaterial({ color: s.color, metalness: 0.9, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.12 });
    const box = new THREE.Mesh(new RoundedBoxGeometry(2.4, s.h, 2.4, 5, 0.09), mat);
    box.position.set(s.x, s.h / 2, 0);
    box.castShadow = true;
    box.receiveShadow = true;
    g.add(box);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.2),
      new THREE.MeshBasicMaterial({ map: numberTexture(s.place, s.num), transparent: true, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }),
    );
    plate.position.set(s.x, s.h * 0.5, 1.21);
    g.add(plate);
    tops[s.place] = new THREE.Vector3(s.x, s.h, 0);
  }
  // glowing base ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.04, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc830').multiplyScalar(3.6), toneMapped: false }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  ring.scale.set(1, 1, 0.62);
  g.add(ring);
  return { group: g, tops };
}

export function createTrophy() {
  const g = new THREE.Group();
  const gold = new THREE.MeshPhysicalMaterial({ color: '#ffc21a', metalness: 1, roughness: 0.16, clearcoat: 0.6, emissive: new THREE.Color('#ff9a00'), emissiveIntensity: 0.22, envMapIntensity: 1.4 });
  const prof = [
    [0, 0], [0.62, 0], [0.66, 0.06], [0.6, 0.12], [0.34, 0.18], [0.16, 0.34], [0.14, 0.62], [0.3, 0.7], [0.58, 1.05], [0.68, 1.42], [0.62, 1.68],
    [0.5, 1.7], [0.52, 1.58], [0.4, 1.2], [0.0, 1.05],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 48), gold));
  for (const s of [1, -1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.58 * s, 1.32, 0),
      new THREE.Vector3(1.05 * s, 1.42, 0),
      new THREE.Vector3(1.05 * s, 0.98, 0),
      new THREE.Vector3(0.46 * s, 0.78, 0),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.065, 10, false), gold));
  }
  // star emblem
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.13 : 0.3;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) star.moveTo(x, y);
    else star.lineTo(x, y);
  }
  star.closePath();
  const emblem = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 }), new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: new THREE.Color('#ffd23a'), emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.3 }));
  emblem.position.set(0, 1.3, 0.62);
  g.add(emblem);
  return { group: g };
}

// =================================================================================================================
// track miniature
// =================================================================================================================
const TRACK_VS = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    vUv = uv;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const TRACK_FS = /* glsl */ `
  uniform vec3 uColor, uColor2;
  uniform float uTime, uLen;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    float t = vUv.x;
    float p1 = exp(-pow(fract(t - uTime * 0.07) * 14.0, 2.0));
    float p2 = exp(-pow(fract(t * 3.0 - uTime * 0.2) * 6.0, 2.0)) * 0.5;
    float fres = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.0);
    vec3 col = mix(uColor, uColor2, 0.35 + 0.35 * sin(t * 12.566 + uTime * 0.5));
    col = col * (1.1 + fres * 0.7) + vec3(1.0, 0.95, 0.85) * (p1 * 1.3 + p2 * 0.7);
    // start / finish marker
    float sf = smoothstep(0.012, 0.0, min(t, 1.0 - t));
    col = mix(col, vec3(3.0), sf);
    gl_FragColor = vec4(col, 1.0);
  }`;

/**
 * Build the glowing miniature from an [x, z] outline.
 * @returns {{ group: THREE.Group, uniforms: object, curve: THREE.CatmullRomCurve3, bead: THREE.Mesh }}
 */
export function createTrackMiniature(outline, colors) {
  const group = new THREE.Group();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of outline) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const ext = Math.max(maxX - minX, maxZ - minZ, 1e-3);
  const s = 5.4 / ext;
  const pts = outline.map(([x, z], i) => new THREE.Vector3((x - cx) * s, 0.22 + 0.12 * Math.sin((i / outline.length) * Math.PI * 4), (z - cz) * s));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const uniforms = {
    uColor: { value: new THREE.Color(colors.primary).multiplyScalar(1.0) },
    uColor2: { value: new THREE.Color(colors.secondary).multiplyScalar(1.0) },
    uTime: { value: 0 },
    uLen: { value: curve.getLength() },
  };
  const core = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.min(720, pts.length * 4), 0.1, 10, true),
    new THREE.ShaderMaterial({ uniforms, vertexShader: TRACK_VS, fragmentShader: TRACK_FS, toneMapped: false }),
  );
  group.add(core);
  const glow = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.min(480, pts.length * 3), 0.28, 10, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.primary).multiplyScalar(1.3), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  group.add(glow);
  // hologram base
  const baseCol = new THREE.Color(colors.secondary).multiplyScalar(2);
  for (const [r0, r1, op] of [[3.3, 3.35, 1], [3.6, 3.62, 0.5], [2.85, 2.87, 0.3]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 128), new THREE.MeshBasicMaterial({ color: baseCol, transparent: true, opacity: op, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.3, 96),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.primary).multiplyScalar(0.25), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.03;
  group.add(disc);
  // start gate at t = 0
  const p0 = curve.getPointAt(0), tan0 = curve.getTangentAt(0);
  const gate = new THREE.Group();
  const postMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3), toneMapped: false });
  for (const sd of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), postMat);
    post.position.set(sd * 0.5, 0.35, 0);
    gate.add(post);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.1, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.accent).multiplyScalar(2.6), toneMapped: false }));
  bar.position.y = 0.7;
  gate.add(bar);
  gate.position.copy(p0);
  gate.position.y -= 0.3;
  gate.rotation.y = Math.atan2(tan0.x, tan0.z) + Math.PI / 2;
  group.add(gate);
  // moving bead
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.0, 2.6), toneMapped: false }));
  group.add(bead);
  group.position.y = 0.9; // hologram floats above the mirror floor
  return { group, uniforms, curve, bead };
}
