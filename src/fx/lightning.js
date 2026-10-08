/**
 * Lightning bolts: jagged camera-facing ribbons (core + glow layer + short forks) in one dynamic mesh (1 draw call).
 * Bolts live ~0.5 s and re-roll their jitter ~25 times a second so they crackle.
 * OWNER: Visuals.
 */
import * as THREE from 'three';

const MAX_BOLTS = 8;
const MAIN_SEG = 32; // must be powers of two (midpoint subdivision)
const FORK_SEG = 8;
const FORKS = 2;
const PTS = MAIN_SEG + 1 + FORKS * (FORK_SEG + 1);
const VERTS_PER_BOLT = PTS * 2 * 2; // 2 layers × 2 sides

const VERT = /* glsl */ `
attribute vec3 aOther;
attribute vec3 aSW;   // perpendicular offset side (sign-corrected), width, across coordinate (-1 / +1)
attribute float aLayer;
varying float vSide;
varying float vLayer;
void main() {
  vec4 a = modelViewMatrix * vec4(position, 1.0);
  vec4 b = modelViewMatrix * vec4(aOther, 1.0);
  vec2 dir = b.xy - a.xy;
  float l = length(dir);
  dir = l > 1e-5 ? dir / l : vec2(0.0, 1.0);
  a.xy += vec2(-dir.y, dir.x) * aSW.x * aSW.y;
  vSide = aSW.z;
  vLayer = aLayer;
  gl_Position = projectionMatrix * a;
}`;
const FRAG = /* glsl */ `
uniform float uIntensity;
varying float vSide;
varying float vLayer;
void main() {
  // each vertex carries side = ±1 (magnitude removed above), interpolation gives the across coordinate
  float across = abs(vSide);
  float a = 1.0 - across * across;
  vec3 core = vec3(2.6, 2.9, 4.0);
  vec3 glow = vec3(0.55, 0.32, 1.7);
  vec3 col = mix(core, glow, vLayer);
  float alpha = mix(a * a, a * 0.55, vLayer) * uIntensity;
  gl_FragColor = vec4(col, alpha);
}`;

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

export class LightningBolts {
  constructor() {
    const nV = MAX_BOLTS * VERTS_PER_BOLT;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(nV * 3), 3);
    this.other = new THREE.BufferAttribute(new Float32Array(nV * 3), 3);
    this.sw = new THREE.BufferAttribute(new Float32Array(nV * 3), 3);
    this.layer = new THREE.BufferAttribute(new Float32Array(nV), 1);
    for (const a of [this.pos, this.other, this.sw, this.layer]) a.setUsage(THREE.DynamicDrawUsage);
    // static index: for every polyline segment 2 quads (layers)
    const idx = [];
    for (let b = 0; b < MAX_BOLTS; b++) {
      const base = b * VERTS_PER_BOLT;
      const lines = [[0, MAIN_SEG + 1]];
      for (let f = 0; f < FORKS; f++) lines.push([MAIN_SEG + 1 + f * (FORK_SEG + 1), FORK_SEG + 1]);
      for (const [start, n] of lines) {
        for (let layer = 0; layer < 2; layer++) {
          const lb = base + (layer * PTS + start) * 2;
          for (let i = 0; i < n - 1; i++) {
            const a = lb + i * 2;
            idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
          }
        }
      }
    }
    g.setIndex(idx);
    g.setAttribute('position', this.pos);
    g.setAttribute('aOther', this.other);
    g.setAttribute('aSW', this.sw);
    g.setAttribute('aLayer', this.layer);
    this.geometry = g;
    this.uIntensity = { value: 1 };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uIntensity: this.uIntensity },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    // stays visible (all widths are zero when idle => degenerate triangles) so renderer.compile() precompiles its shader
    this.mesh.visible = true;
    this.bolts = [];
    this.nextSlot = 0;
  }

  /** Strike a bolt from `from` down to `to`. life in seconds. */
  strike(from, to, { life = 0.55, width = 0.32 } = {}) {
    const slot = this.nextSlot;
    this.nextSlot = (this.nextSlot + 1) % MAX_BOLTS;
    const existing = this.bolts.findIndex((b) => b.slot === slot);
    if (existing >= 0) this.bolts.splice(existing, 1);
    this.bolts.push({ slot, from: from.clone(), to: to.clone(), t: 0, life, width, reroll: 0, seed: Math.random() * 1000 });
  }

  update(dt) {
    if (!this.bolts.length) return;
    let dirty = false;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.life) {
        this._hide(b.slot);
        this.bolts.splice(i, 1);
        dirty = true;
        continue;
      }
      b.reroll -= dt;
      if (b.reroll <= 0) {
        b.reroll = 0.04;
        this._build(b);
        dirty = true;
      }
    }
    // flicker envelope
    const b0 = this.bolts[0];
    if (b0) {
      const k = b0.t / b0.life;
      this.uIntensity.value = (0.55 + 0.45 * Math.sin(b0.t * 90)) * (1 - k * k) * (k < 0.06 ? k / 0.06 : 1);
    }
    if (dirty) {
      for (const a of [this.pos, this.other, this.sw, this.layer]) a.needsUpdate = true;
    }
  }

  _hide(slot) {
    const base = slot * VERTS_PER_BOLT;
    this.sw.array.fill(0, base * 3, (base + VERTS_PER_BOLT) * 3);
  }

  /** Jagged polyline from→to by midpoint displacement; fork polylines branch off. */
  _polyline(from, to, segs, amp) {
    const pts = [from.clone(), to.clone()];
    let a = amp;
    while (pts.length - 1 < segs) {
      const next = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const m = _p.copy(pts[i]).add(pts[i + 1]).multiplyScalar(0.5);
        _d.subVectors(pts[i + 1], pts[i]);
        // random perpendicular offset
        _q.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).cross(_d).normalize();
        if (_q.lengthSq() < 0.5) _q.set(1, 0, 0);
        m.addScaledVector(_q, (Math.random() - 0.5) * 2 * a);
        next.push(pts[i], m.clone());
      }
      next.push(pts[pts.length - 1]);
      pts.length = 0;
      pts.push(...next);
      a *= 0.55;
    }
    return pts;
  }

  _build(b) {
    const P = this.pos.array, O = this.other.array, SW = this.sw.array, L = this.layer.array;
    const base = b.slot * VERTS_PER_BOLT;
    const len = b.from.distanceTo(b.to);
    const main = this._polyline(b.from, b.to, MAIN_SEG, Math.min(3.2, len * 0.09));
    const lines = [{ pts: main, w: b.width, start: 0 }];
    for (let f = 0; f < FORKS; f++) {
      const at = main[4 + Math.floor(Math.random() * (MAIN_SEG - 10))];
      const end = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 9, -(3 + Math.random() * 6), (Math.random() - 0.5) * 9));
      lines.push({ pts: this._polyline(at, end, FORK_SEG, 0.9), w: b.width * 0.45, start: MAIN_SEG + 1 + f * (FORK_SEG + 1) });
    }
    for (const ln of lines) {
      const n = ln.pts.length;
      for (let layer = 0; layer < 2; layer++) {
        for (let i = 0; i < n; i++) {
          const p = ln.pts[i];
          const o = i < n - 1 ? ln.pts[i + 1] : ln.pts[i - 1];
          const sgn = i < n - 1 ? 1 : -1;
          const taper = (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, (i / (n - 1)) * 0.9 + 0.1))) * (ln.start ? 0.8 : 1);
          const wd = ln.w * (layer === 0 ? 0.28 : 1.0) * taper;
          for (let s = 0; s < 2; s++) {
            const v = base + (layer * PTS + ln.start + i) * 2 + s;
            P[v * 3] = p.x; P[v * 3 + 1] = p.y; P[v * 3 + 2] = p.z;
            O[v * 3] = o.x; O[v * 3 + 1] = o.y; O[v * 3 + 2] = o.z;
            SW[v * 3] = (s === 0 ? -1 : 1) * sgn;
            SW[v * 3 + 1] = wd;
            SW[v * 3 + 2] = s === 0 ? -1 : 1;
            L[v] = layer;
          }
        }
      }
    }
  }

  clear() {
    this.bolts.length = 0;
    this.sw.array.fill(0);
    this.sw.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
