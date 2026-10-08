/**
 * Floating "P1".."P4" tag above a human kart in split-screen. One Sprite (1 draw call), no shadows, kept at a roughly
 * constant on-screen size by scaling with camera distance. Hidden in the owner's own view when `window.__game.views`
 * is available (otherwise shown everywhere).
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { PLAYER_COLORS } from '../core/constants.js';

const W = 256, H = 220;
const texCache = [];
let fontHooked = false;

function draw(ctx, index) {
  const col = PLAYER_COLORS[index] ?? '#ffffff';
  ctx.clearRect(0, 0, W, H);
  const x = 14, y = 12, w = W - 28, h = 132, r = 44;
  // pointer
  const tri = () => {
    ctx.beginPath();
    ctx.moveTo(W / 2 - 34, y + h - 6);
    ctx.lineTo(W / 2, H - 14);
    ctx.lineTo(W / 2 + 34, y + h - 6);
    ctx.closePath();
  };
  const pill = () => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };
  ctx.lineJoin = 'round';
  // dark outline
  ctx.fillStyle = '#12142b';
  ctx.strokeStyle = '#12142b';
  ctx.lineWidth = 22;
  pill(); ctx.stroke(); ctx.fill();
  tri(); ctx.stroke(); ctx.fill();
  // coloured body + pointer
  ctx.fillStyle = col;
  pill(); ctx.fill();
  tri(); ctx.fill();
  // darker lower half for a chunky look
  ctx.save();
  pill(); ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.38)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  // inner white rim
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x + 8, y + 8, w - 16, h - 16, r - 8);
  ctx.stroke();
  // text
  ctx.font = '104px "Lilita One", "Arial Black", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#12142b';
  ctx.strokeText(`P${index + 1}`, W / 2, y + h / 2 + 6);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`P${index + 1}`, W / 2, y + h / 2 + 6);
}

function getTexture(index) {
  let t = texCache[index];
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  draw(ctx, index);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.userData = { ctx, index };
  texCache[index] = t;
  if (!fontHooked && document.fonts?.ready) {
    fontHooked = true;
    document.fonts.load?.('104px "Lilita One"').catch(() => {});
    document.fonts.ready.then(() => {
      for (const tt of texCache) if (tt) { draw(tt.userData.ctx, tt.userData.index); tt.needsUpdate = true; }
    });
  }
  return t;
}

const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * @param {THREE.Group} root kart model root (the marker is parented to it)
 * @param {number} playerIndex 0..3
 * @param {number} height local y of the marker's tip above the ground contact point
 * @returns {{sprite: THREE.Sprite, dispose: () => void}}
 */
export function createPlayerMarker(root, playerIndex, height = 2.3) {
  const mat = new THREE.SpriteMaterial({
    map: getTexture(playerIndex), transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
  });
  mat.color.setScalar(1.15);
  const sprite = new THREE.Sprite(mat);
  sprite.name = `playerMarker${playerIndex + 1}`;
  sprite.center.set(0.5, 0);
  sprite.position.set(0, height, 0);
  sprite.renderOrder = 20;
  sprite.castShadow = false;
  sprite.receiveShadow = false;
  const aspect = W / H;
  // onBeforeRender runs after the scene's matrices were updated: apply the new scale to this draw ourselves
  const sync = () => {
    sprite.updateMatrix();
    sprite.matrixWorld.multiplyMatrices(root.matrixWorld, sprite.matrix);
  };
  sprite.onBeforeRender = (renderer, scene, camera) => {
    sprite.getWorldPosition(_p);
    const dist = _p.distanceTo(camera.position);
    root.getWorldScale(_s);
    const own = typeof window !== 'undefined' ? window.__game?.views?.[playerIndex]?.camera : null;
    if (own && own === camera) {
      sprite.scale.setScalar(0.0001);
      sync();
      return;
    }
    // ~8.5% of the view height, clamped so close karts don't get huge and distant ones stay readable
    const fov = camera.isPerspectiveCamera ? camera.fov : 70;
    const worldH = 2 * dist * Math.tan((fov * Math.PI) / 360) * 0.085;
    const hh = Math.min(3.2, Math.max(0.6, worldH)) / Math.max(0.05, _s.y);
    sprite.scale.set(hh * aspect, hh, 1);
    // fade out when the kart is right next to this camera, where the min size would cover the viewer's HUD
    mat.opacity = Math.min(1, Math.max(0, (dist - 6) / 6));
    sync();
  };
  sprite.scale.set(0.9 * aspect, 0.9, 1);
  root.add(sprite);
  return {
    sprite,
    dispose() {
      sprite.removeFromParent();
      mat.dispose(); // the texture is shared/cached
    },
  };
}
