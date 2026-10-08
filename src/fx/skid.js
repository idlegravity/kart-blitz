/**
 * Pooled skid-mark ribbons: one ring-buffered quad mesh (1 draw call) shared by every kart.
 * Each wheel keeps its previous left/right edge points; a new quad is written every ~0.4 m of travel.
 * OWNER: Visuals.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aBirth;
attribute float aAcross;
attribute float aInt;
uniform float uTime;
varying float vAge;
varying float vAcross;
varying float vInt;
void main() {
  vAge = uTime - aBirth;
  vAcross = aAcross;
  vInt = aInt;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAge;
varying float vAcross;
varying float vInt;
void main() {
  float fade = 1.0 - smoothstep(5.0, 13.0, vAge);
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vAcross));
  float a = 0.62 * fade * edge * vInt;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export class SkidMarks {
  constructor(uTime, maxQuads = 1000) {
    this.max = maxQuads;
    this.head = 0;
    this.dmin = Infinity;
    this.dmax = -1;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(maxQuads * 4 * 3), 3);
    this.birth = new THREE.BufferAttribute(new Float32Array(maxQuads * 4).fill(-1e6), 1);
    this.across = new THREE.BufferAttribute(new Float32Array(maxQuads * 4), 1);
    this.inten = new THREE.BufferAttribute(new Float32Array(maxQuads * 4).fill(1), 1);
    for (const a of [this.pos, this.birth, this.across, this.inten]) a.setUsage(THREE.DynamicDrawUsage);
    const idx = new Uint32Array(maxQuads * 6);
    for (let i = 0; i < maxQuads; i++) {
      const v = i * 4, k = i * 6;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], k);
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('position', this.pos);
    g.setAttribute('aBirth', this.birth);
    g.setAttribute('aAcross', this.across);
    g.setAttribute('aInt', this.inten);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime, uColor: { value: new THREE.Color(0.012, 0.012, 0.016) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.time = uTime;
  }

  /** Append the quad (prevL, prevR, newR, newL). Points are [x,y,z] arrays. */
  addQuad(pl, pr, nr, nl, intensity = 1) {
    const i = this.head;
    this.head = (i + 1) % this.max;
    const t = this.time.value;
    const P = this.pos.array;
    const k = i * 12;
    const set = (o, p) => {
      P[k + o] = p[0]; P[k + o + 1] = p[1]; P[k + o + 2] = p[2];
    };
    set(0, pl); set(3, pr); set(6, nr); set(9, nl);
    const b = i * 4;
    this.birth.array[b] = this.birth.array[b + 1] = this.birth.array[b + 2] = this.birth.array[b + 3] = t;
    this.across.array[b] = -1; this.across.array[b + 1] = 1; this.across.array[b + 2] = 1; this.across.array[b + 3] = -1;
    this.inten.array[b] = this.inten.array[b + 1] = this.inten.array[b + 2] = this.inten.array[b + 3] = intensity;
    if (i < this.dmin) this.dmin = i;
    if (i > this.dmax) this.dmax = i;
  }

  flush() {
    if (this.dmax < 0) return;
    const wrapped = this.dmax - this.dmin > this.max * 0.6;
    const ranges = [[this.pos, 12], [this.birth, 4], [this.across, 4], [this.inten, 4]];
    for (const [a, stride] of ranges) {
      a.clearUpdateRanges();
      if (!wrapped) a.addUpdateRange(this.dmin * stride, (this.dmax - this.dmin + 1) * stride);
      a.needsUpdate = true;
    }
    this.dmin = Infinity;
    this.dmax = -1;
  }

  clear() {
    this.pos.array.fill(0);
    this.birth.array.fill(-1e6);
    this.head = 0;
    for (const a of [this.pos, this.birth, this.across, this.inten]) {
      a.clearUpdateRanges();
      a.needsUpdate = true;
    }
    this.dmin = Infinity;
    this.dmax = -1;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
