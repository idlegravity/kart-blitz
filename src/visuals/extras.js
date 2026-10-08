/**
 * Extras attached to karts: the rescue drone, dizzy stars and the blob contact shadow.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { G, S2, PartBuilder, sweep, tube, TAU } from './geo.js';
import { bar, SURF } from './karts.js';
import { makeKartUniforms, createKartMaterial } from './material.js';

const { chrome, steel, plastic, lamp } = SURF;
const shiny = (color, o = {}) => ({ color, rough: 0.25, clear: 1, ao: 0.25, ...o });

let droneGeo = null;
/**
 * Cute rescue drone. Local origin = the hook point it grips (kart hook). Body hovers ~1.1 m above.
 * Flex channels: 0..3 rotor spin (rotation about Y at each rotor), 4/5 claw fingers (rotation about Z), beacon (13) red lamp,
 * brake (14) green lamp.
 */
export function buildDroneGeometry() {
  if (droneGeo) return droneGeo;
  const b = new PartBuilder();
  const body = shiny('#f7f8fc');
  const orange = shiny('#ff8a1c');
  const Y0 = 1.12;
  b.add(G.ell(0.36, 0.21, 0.36, 22, 14), { p: [0, Y0, 0], ...body });
  b.add(G.torus(0.335, 0.05, 26, 8), { p: [0, Y0 - 0.02, 0], r: [Math.PI / 2, 0, 0], ...orange });
  // camera eye
  b.add(G.ell(0.13, 0.13, 0.06, 14, 10), { p: [0, Y0 + 0.02, 0.32], ...plastic('#101318', { rough: 0.2, clear: 1 }) });
  b.add(G.ell(0.09, 0.09, 0.05, 12, 8), { p: [0, Y0 + 0.02, 0.35], ...lamp('#3fe0ff', 2.6) });
  b.add(G.ell(0.028, 0.03, 0.02, 8, 6), { p: [0.03, Y0 + 0.05, 0.395], ...lamp('#ffffff', 2.4) });
  // beacons
  b.add(G.ell(0.055, 0.05, 0.055, 10, 8), { p: [-0.12, Y0 + 0.22, -0.04], ...lamp('#ff3030', 3), beacon: true });
  b.add(G.ell(0.055, 0.05, 0.055, 10, 8), { p: [0.12, Y0 + 0.22, -0.04], ...lamp('#3cff6a', 3), brake: true });
  b.add(G.cyl(0.02, 0.03, 0.12, 8), { p: [0, Y0 + 0.27, -0.1], r: [0.3, 0, 0], ...steel() });
  // arms + rotors
  const rotors = [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]];
  rotors.forEach(([x, z], i) => {
    const pivot = [x, Y0 + 0.14, z];
    b.add(bar([x * 0.35, Y0 + 0.02, z * 0.35], [x, Y0 + 0.1, z], 0.035, 0.03, { e: 2.6, ring: 8 }), steel({ color: '#3a404c' }));
    b.add(G.cyl(0.06, 0.07, 0.07, 10), { p: [x, Y0 + 0.1, z], ...steel({ color: '#2b303a' }) });
    const dir = i % 2 === 0 ? 1 : -1;
    for (const a of [0, Math.PI / 2]) {
      b.add(G.ell(0.34, 0.012, 0.06, 12, 4), { p: [x, Y0 + 0.16, z], r: [0, a + i, 0], ...orange, flex: { ch: i, pivot, len: 0 } });
    }
    b.add(G.cyl(0.03, 0.03, 0.03, 8), { p: [x, Y0 + 0.18, z], ...chrome(), flex: { ch: i, pivot, len: 0 } });
  });
  // skids
  for (const s of [1, -1]) b.add(tube([[0.2 * s, Y0 - 0.18, 0.3], [0.24 * s, Y0 - 0.28, 0.2], [0.24 * s, Y0 - 0.28, -0.2], [0.2 * s, Y0 - 0.18, -0.3]], 0.018, { segments: 10, ring: 6 }), steel());
  // cable + claw
  b.add(G.cyl(0.014, 0.014, Y0 - 0.32, 6), { p: [0, (Y0 - 0.32) / 2 + 0.28 + 0.02, 0], ...steel({ color: '#2b303a' }) });
  b.add(G.ell(0.06, 0.05, 0.06, 10, 8), { p: [0, 0.3, 0], ...chrome() });
  for (const [ch, s] of [[4, 1], [5, -1]]) {
    b.add(tube([[0.02 * s, 0.28, 0], [0.09 * s, 0.18, 0], [0.1 * s, 0.06, 0], [0.04 * s, -0.02, 0]], 0.02, { segments: 8, ring: 6, capEnd: 0.02 }), {
      ...chrome({ color: '#dfe4ee' }),
      flex: { ch, pivot: [0.02 * s, 0.29, 0], dir: [0, -1, 0], len: 0.3, pow: 0.8 },
    });
  }
  droneGeo = b.build();
  droneGeo.userData.tris = b.tris;
  return droneGeo;
}

export function createDrone(quality) {
  const uniforms = makeKartUniforms(null);
  const mat = createKartMaterial(uniforms, { quality });
  const mesh = new THREE.Mesh(buildDroneGeometry(), mat);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  group.visible = false;
  return { group, mesh, uniforms, mat };
}

let starGeo = null;
/** Merged ring of 4 dizzy stars (additive-looking emissive yellow). */
export function buildDizzyGeometry() {
  if (starGeo) return starGeo;
  const b = new PartBuilder();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const g = G.extrude(S2.star(5, 1, 0.5), 0.35, 0.16, 2, 3);
    b.add(g, {
      p: [Math.cos(a) * 0.4, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.4],
      r: [Math.PI / 2 * 0.3, -a + Math.PI / 2, 0],
      s: 0.085,
      color: i % 2 ? '#ffd23a' : '#fff07a',
      rough: 0.3,
      emis: 2.2,
      ao: 0,
    });
  }
  starGeo = b.build();
  return starGeo;
}

export function createDizzy(quality = 'high') {
  const uniforms = makeKartUniforms(null);
  // same material variant as the kart => same shader program (no compile hitch when the stars first appear)
  const mat = createKartMaterial(uniforms, { quality });
  const mesh = new THREE.Mesh(buildDizzyGeometry(), mat);
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.add(mesh);
  group.visible = false;
  return { group, mesh, mat, uniforms };
}

let blobTex = null;
export function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.5)');
  grd.addColorStop(0.8, 'rgba(0,0,0,0.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}
