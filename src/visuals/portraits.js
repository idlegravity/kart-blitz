/**
 * Portraits — 3D-rendered head/bust of every racer as a transparent PNG data URL (cached).
 *   getPortrait(game, characterId, size = 128) → string
 * Renders the real KartModel driver (bust only) with 3-point lighting into a supersampled HDR MSAA target using
 * game.renderer (all renderer state is saved/restored), tone maps + sRGB-encodes with an un-premultiply pass,
 * reads the pixels back and downsamples through a 2D canvas.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { getCharacter } from '../data/characters.js';
import { KartModel } from './KartModel.js';
import { getStudioEnvironment } from './environment.js';

const cache = new Map(); //   `${id}:${size}` → data URL
const masters = new Map(); // id → master canvas (MASTER px)
const MASTER = 384;
let rig = null;

const FINISH_VS = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const FINISH_FS = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    vec3 rgb = c.a > 0.002 ? c.rgb / c.a : vec3(0.0);
    rgb = ACESFilmicToneMapping(rgb);
    gl_FragColor = sRGBTransferOETF(vec4(rgb, c.a));
  }`;

function makeRig(renderer) {
  const scene = new THREE.Scene();
  scene.environment = getStudioEnvironment(renderer);
  scene.environmentIntensity = 0.7;
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4);
  key.position.set(-1.6, 2.2, 3.2);
  const fill = new THREE.DirectionalLight(0xbcd8ff, 0.8);
  fill.position.set(2.6, 0.6, 2.2);
  const rimA = new THREE.DirectionalLight(0x6fe6ff, 2.0);
  rimA.position.set(2.2, 1.6, -2.6);
  const rimB = new THREE.DirectionalLight(0xff7ad9, 1.3);
  rimB.position.set(-2.4, 1.2, -2.2);
  scene.add(key, fill, rimA, rimB, new THREE.HemisphereLight(0xffffff, 0x5a6280, 0.55));
  const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 30);
  const finishMat = new THREE.RawShaderMaterial({
    name: 'PortraitFinish',
    uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 } },
    vertexShader: FINISH_VS,
    fragmentShader: FINISH_FS,
    defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
    depthTest: false,
    depthWrite: false,
  });
  return { scene, camera, key, rimA, finish: new FullScreenQuad(finishMat), finishMat, size: 0, rtHDR: null, rtLDR: null };
}

function ensureTargets(r, S) {
  if (r.size === S) return;
  r.rtHDR?.dispose();
  r.rtLDR?.dispose();
  r.rtHDR = new THREE.WebGLRenderTarget(S, S, { type: THREE.HalfFloatType, samples: 4 });
  r.rtLDR = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType });
  r.size = S;
}

function fallback(character, size) {
  const c = character.colors;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  g.fillStyle = c.primary;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${size * 0.5}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(character.name[0], size / 2, size / 2 + size * 0.03);
  return cv.toDataURL('image/png');
}

/**
 * Render a portrait (transparent PNG data URL).
 * @param {object} game needs game.renderer
 * @param {string} characterId
 * @param {number} [size=128] output size in px (square)
 */
export function getPortrait(game, characterId, size = 128) {
  const key = `${characterId}:${size}`;
  if (cache.has(key)) return cache.get(key);
  const character = getCharacter(characterId);
  let url;
  try {
    let master = masters.get(character.id);
    if (!master || (size > MASTER && master.width < size)) {
      master = render(game.renderer, character, Math.max(MASTER, size));
      masters.set(character.id, master);
    }
    url = fromMaster(master, size);
  } catch (e) {
    console.warn('[portraits] render failed, using fallback', e);
    url = fallback(character, size);
  }
  cache.set(key, url);
  return url;
}

function fromMaster(master, size) {
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = true;
  og.imageSmoothingQuality = 'high';
  og.drawImage(master, 0, 0, size, size);
  return out.toDataURL('image/png');
}

/**
 * Render every portrait one per idle tick so the character select never stalls (call once after boot).
 * @param {object} game
 * @param {string[]} ids character ids
 */
export function prewarmPortraits(game, ids) {
  const queue = [...ids];
  const tick = () => {
    const id = queue.shift();
    if (!id) return;
    try {
      getPortrait(game, id, 128);
    } catch {}
    setTimeout(tick, 60);
  };
  setTimeout(tick, 1200);
}

function render(renderer, character, size) {
  rig ??= makeRig(renderer);
  const S = Math.min(1024, Math.max(192, Math.round(size * 2)));
  ensureTargets(rig, S);

  // ---- build the bust ----
  const model = new KartModel(character, { quality: globalThis.__game?.settings?.quality === 'mobile' ? 'low' : 'high' });
  model.setBustOnly(true);
  rig.scene.add(model.root);
  model.update(0, null);
  const D = model.parts.driver;
  model.head.rotation.set(-0.04, -0.34, 0.06);
  model.root.updateMatrixWorld(true);
  const headPos = model.head.getWorldPosition(new THREE.Vector3());
  const bb = model.headMesh.geometry.boundingBox;
  const top = Math.min(bb.max.y, D.h.cy + 0.68);
  const bottom = -0.24;
  const halfH = (top - bottom) / 2;
  const halfW = Math.max(0.36, Math.min(0.55, (bb.max.x - bb.min.x) / 2));
  const half = Math.max(halfH, halfW) * 1.07;
  const cam = rig.camera;
  const dist = half / Math.tan((cam.fov * Math.PI) / 360);
  const cy = (top + bottom) / 2;
  cam.position.set(headPos.x + 0.18 * dist * 0.35, headPos.y + cy + 0.04, headPos.z + dist);
  cam.lookAt(headPos.x, headPos.y + cy, headPos.z);
  cam.updateMatrixWorld(true);
  // accent-tinted rim
  rig.rimA.color.set(character.colors.accent).lerp(new THREE.Color(0x6fe6ff), 0.55);

  // ---- save renderer state ----
  const prevRT = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevVp = renderer.getViewport(new THREE.Vector4());
  const prevSc = renderer.getScissor(new THREE.Vector4());
  const prevScTest = renderer.getScissorTest();
  const prevShadow = renderer.shadowMap.enabled;
  const prevXR = renderer.xr.enabled;
  renderer.xr.enabled = false;
  renderer.shadowMap.enabled = false;
  renderer.setScissorTest(false);
  renderer.autoClear = true;

  // ---- render HDR bust → finish pass (un-premultiply + ACES + sRGB) → read back ----
  // setViewport() is in CSS px (multiplied by the renderer pixel ratio): pass S / pr so the S x S targets are always fully covered
  const pr = renderer.getPixelRatio();
  renderer.setRenderTarget(rig.rtHDR);
  renderer.setViewport(0, 0, S, S);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(rig.scene, cam);
  rig.finishMat.uniforms.tDiffuse.value = rig.rtHDR.texture;
  renderer.setRenderTarget(rig.rtLDR);
  renderer.setViewport(0, 0, S, S);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  rig.finish.render(renderer);
  const buf = new Uint8Array(S * S * 4);
  renderer.readRenderTargetPixels(rig.rtLDR, 0, 0, S, S, buf);

  // ---- restore state ----
  renderer.setRenderTarget(prevRT);
  renderer.setViewport(prevVp);
  renderer.setScissor(prevSc);
  renderer.setScissorTest(prevScTest);
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.autoClear = prevAuto;
  renderer.shadowMap.enabled = prevShadow;
  renderer.xr.enabled = prevXR;

  // ---- master canvas (supersampled S → size) ----
  const big = document.createElement('canvas');
  big.width = big.height = S;
  const g = big.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) img.data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
  g.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = true;
  og.imageSmoothingQuality = 'high';
  og.drawImage(big, 0, 0, size, size);

  rig.scene.remove(model.root);
  model.dispose();
  return out;
}

/** Drop cached portraits (e.g. after a quality change) so they are re-rendered on demand. */
export function clearPortraitCache() {
  cache.clear();
  masters.clear();
}
