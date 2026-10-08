/**
 * ItemRenderer — every visible item (except the item boxes and the comet body) is drawn through a handful of
 * InstancedMeshes: banana, green orb, red orb, bomb + one additive billboard mesh for all glows/sparks.
 * That is 5 draw calls no matter how many items are in play. The simulation calls begin() / add*() / end()
 * every frame; nothing here allocates per frame.
 *
 * OWNER: Gameplay agent.
 */
import * as THREE from 'three';
import {
  buildBananaGeometry, buildBouncerGeometry, buildSeekerGeometry, buildBombGeometry, BOMB_FUSE_TIP,
  buildCometCoreGeometry, buildCometWingGeometry,
} from './itemGeometry.js';
import { TUNING } from './itemTables.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _yAxis = new THREE.Vector3(0, 1, 0);

/** Radial-gradient texture used by glow points (comet trail). */
function makeGlowTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeInstanced(geo, mat, cap, castShadow = true) {
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  return mesh;
}

export class ItemRenderer {
  /** @param {THREE.Group} group parent for every mesh */
  constructor(group, caps = {}) {
    this.group = group;
    const cap = { banana: 64, orb: 40, bomb: 28, glow: 128, ...caps };
    this.cap = cap;
    this._geos = [];
    this._mats = [];
    const track = (g) => (this._geos.push(g), g);
    const trackM = (m) => (this._mats.push(m), m);

    // ---- glossy candy materials ----
    const candy = () =>
      trackM(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.25 }));
    const bananaMat = trackM(
      new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide, envMapIntensity: 1.0 })
    );

    this.banana = makeInstanced(track(buildBananaGeometry()), bananaMat, cap.banana);
    this.orbGreen = makeInstanced(track(buildBouncerGeometry(TUNING.orb.radius)), candy(), cap.orb);
    this.orbRed = makeInstanced(track(buildSeekerGeometry(TUNING.orb.radius)), candy(), cap.orb);
    this.bomb = makeInstanced(track(buildBombGeometry(TUNING.bomb.radius)), candy(), cap.bomb);
    this.bomb.material.roughness = 0.14;
    this.banana.name = 'items:banana';
    this.orbGreen.name = 'items:bouncer';
    this.orbRed.name = 'items:seeker';
    this.bomb.name = 'items:bomb';

    // ---- additive billboard glows (orb halos, fuse sparks, comet flare) ----
    const glowMat = trackM(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: true,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vCol;
          varying float vHeight;
          void main() {
            vUv = uv;
            #ifdef USE_INSTANCING_COLOR
              vCol = instanceColor;
            #else
              vCol = vec3(1.0);
            #endif
            // billboard in world space; instanceMatrix[1].x carries the ground height under the glow
            vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            vec3 wc = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float sc = length(instanceMatrix[0].xyz);
            vec3 wp = wc + (camRight * position.x + camUp * position.y) * sc;
            vHeight = wp.y - instanceMatrix[1].x;
            gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vCol;
          varying float vHeight;
          void main() {
            float d = length(vUv * 2.0 - 1.0);
            float a = clamp(1.0 - d, 0.0, 1.0);
            a = a * a * smoothstep(0.0, 0.45, vHeight);
            gl_FragColor = vec4(vCol, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      })
    );
    const quad = track(new THREE.PlaneGeometry(2, 2));
    this.glow = makeInstanced(quad, glowMat, cap.glow, false);
    this.glow.setColorAt(0, _c.set(1, 1, 1));
    this.glow.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.glow.renderOrder = 20;
    this.glow.name = 'items:glow';

    this._meshes = [this.banana, this.orbGreen, this.orbRed, this.bomb, this.glow];
    for (const m of this._meshes) group.add(m);
    this._n = { banana: 0, green: 0, red: 0, bomb: 0, glow: 0 };
    this.fuseTip = BOMB_FUSE_TIP;
  }

  begin() {
    const n = this._n;
    n.banana = n.green = n.red = n.bomb = n.glow = 0;
  }

  /** Banana lying on the ground at `pos` (ground contact), rotated `yaw`, uniform `scale`. `tiltQ` optional. */
  addBanana(pos, yaw, scale = 1, tiltQ = null) {
    const i = this._n.banana;
    if (i >= this.cap.banana) return;
    _q.setFromAxisAngle(_yAxis, yaw);
    if (tiltQ) _q.premultiply(tiltQ);
    _s.set(scale, scale, scale);
    _m.compose(pos, _q, _s);
    this.banana.setMatrixAt(i, _m);
    this._n.banana = i + 1;
  }

  /** Orb: kind 0 = green bouncer, 1 = red seeker. */
  addOrb(kind, pos, quat, scale = 1) {
    const mesh = kind === 0 ? this.orbGreen : this.orbRed;
    const key = kind === 0 ? 'green' : 'red';
    const i = this._n[key];
    if (i >= this.cap.orb) return;
    _s.set(scale, scale, scale);
    _m.compose(pos, quat, _s);
    mesh.setMatrixAt(i, _m);
    this._n[key] = i + 1;
  }

  addBomb(pos, quat, scale = 1) {
    const i = this._n.bomb;
    if (i >= this.cap.bomb) return;
    _s.set(scale, scale, scale);
    _m.compose(pos, quat, _s);
    this.bomb.setMatrixAt(i, _m);
    this._n.bomb = i + 1;
  }

  /** World-space fuse tip of a bomb at (pos, quat, scale), written into `out`. */
  bombFuseWorld(pos, quat, scale, out) {
    return out.copy(this.fuseTip).multiplyScalar(scale).applyQuaternion(quat).add(pos);
  }

  /** Additive glow billboard. r,g,b are HDR (>1 blooms). `size` = radius in metres. groundY fades the glow out near the ground. */
  addGlow(pos, r, g, b, size, groundY = -1e4) {
    const i = this._n.glow;
    if (i >= this.cap.glow) return;
    _q.identity();
    _s.set(size, size, size);
    _m.compose(pos, _q, _s);
    _m.elements[4] = groundY;
    this.glow.setMatrixAt(i, _m);
    this.glow.setColorAt(i, _c.setRGB(r, g, b));
    this._n.glow = i + 1;
  }

  end() {
    const n = this._n;
    this.banana.count = n.banana;
    this.orbGreen.count = n.green;
    this.orbRed.count = n.red;
    this.bomb.count = n.bomb;
    this.glow.count = n.glow;
    if (n.banana) this.banana.instanceMatrix.needsUpdate = true;
    if (n.green) this.orbGreen.instanceMatrix.needsUpdate = true;
    if (n.red) this.orbRed.instanceMatrix.needsUpdate = true;
    if (n.bomb) this.bomb.instanceMatrix.needsUpdate = true;
    if (n.glow) {
      this.glow.instanceMatrix.needsUpdate = true;
      this.glow.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of this._meshes) {
      this.group.remove(m);
      m.dispose?.();
    }
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) m.dispose();
    this._meshes.length = this._geos.length = this._mats.length = 0;
  }
}

// ======================================================================================================
// Comet visual (there is at most one in play, so plain meshes are fine: 3 draw calls + trail)
// ======================================================================================================
const TRAIL_N = 44;

export class CometVisual {
  constructor(group) {
    this.group = group;
    this.root = new THREE.Group();
    this.root.name = 'items:comet';
    this.root.visible = false;
    const coreGeo = buildCometCoreGeometry(TUNING.comet.radius);
    const wingGeo = buildCometWingGeometry();
    this.coreMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new THREE.Color('#1a4dff'), emissiveIntensity: 0.28, envMapIntensity: 0.95 });
    this.wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, emissive: new THREE.Color('#9fd0ff'), emissiveIntensity: 0.2, side: THREE.DoubleSide });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.wingR = new THREE.Mesh(wingGeo, this.wingMat);
    this.wingL = new THREE.Mesh(wingGeo, this.wingMat);
    this.wingL.scale.x = -1;
    for (const m of [this.core, this.wingR, this.wingL]) {
      m.castShadow = true;
      m.frustumCulled = false;
    }
    this.body = new THREE.Group(); // oriented along the flight direction (+Z forward)
    this.body.add(this.wingR, this.wingL);
    this.spin = new THREE.Group();
    this.spin.add(this.core);
    this.body.add(this.spin);
    this.root.add(this.body);

    // sparkle trail
    this._trailPos = new Float32Array(TRAIL_N * 3);
    this._trailCol = new Float32Array(TRAIL_N * 3);
    this._trailAge = new Float32Array(TRAIL_N);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this._trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this._trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    this._glowTex = makeGlowTexture();
    this.trailMat = new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, map: this._glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.trail = new THREE.Points(tg, this.trailMat);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this._trailHead = 0;
    this._trailTimer = 0;
    this._trailCount = 0;
    group.add(this.root, this.trail);
    this.t = 0;
  }

  /** Show/orient the comet body. dir = flight direction (unit). */
  place(pos, dir, dt) {
    this.root.visible = true;
    this.trail.visible = true;
    this.t += dt;
    this.body.position.copy(pos);
    this.body.scale.setScalar(1.55); // the comet is a big menacing thing (collision radius stays small)
    _p.copy(pos).add(dir);
    this.body.lookAt(_p);
    this.spin.rotation.z += dt * 5;
    const flap = Math.sin(this.t * 17) * 0.55 + 0.15;
    this.wingR.rotation.z = flap;
    this.wingL.rotation.z = -flap;
    // trail: drop a particle every ~0.02 s at the tail
    this._trailTimer += dt;
    while (this._trailTimer >= 0.02) {
      this._trailTimer -= 0.02;
      const h = this._trailHead;
      this._trailPos[h * 3] = pos.x - dir.x * 0.6 + (Math.random() - 0.5) * 0.35;
      this._trailPos[h * 3 + 1] = pos.y - dir.y * 0.6 + (Math.random() - 0.5) * 0.35;
      this._trailPos[h * 3 + 2] = pos.z - dir.z * 0.6 + (Math.random() - 0.5) * 0.35;
      this._trailAge[h] = 0;
      this._trailHead = (h + 1) % TRAIL_N;
      this._trailCount = Math.min(TRAIL_N, this._trailCount + 1);
    }
    for (let i = 0; i < TRAIL_N; i++) {
      this._trailAge[i] += dt;
      const f = Math.max(0, 1 - this._trailAge[i] / 0.85);
      const live = i < this._trailCount || this._trailCount === TRAIL_N ? f : 0;
      this._trailCol[i * 3] = 0.35 * live * 2.4;
      this._trailCol[i * 3 + 1] = 0.62 * live * 2.4;
      this._trailCol[i * 3 + 2] = 1.0 * live * 2.4;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
  }

  hide() {
    this.root.visible = false;
    this.trail.visible = false;
    this._trailCount = 0;
    this._trailHead = 0;
    this._trailTimer = 0;
    this._trailAge.fill(9);
  }

  dispose() {
    this.group.remove(this.root, this.trail);
    this.core.geometry.dispose();
    this.wingR.geometry.dispose();
    this.trail.geometry.dispose();
    this.coreMat.dispose();
    this.wingMat.dispose();
    this.trailMat.dispose();
    this._glowTex.dispose();
  }
}
