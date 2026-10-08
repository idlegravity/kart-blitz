/**
 * Shared studio environment map (PMREM) for the menu showroom and the portrait renderer:
 * three.js RoomEnvironment plus a few coloured HDR softboxes so glossy paint / chrome pick up cyan, magenta and warm
 * highlights. Built once per renderer.
 * OWNER: Visuals.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const cache = new WeakMap();

/**
 * @param {THREE.WebGLRenderer} renderer
 * @returns {THREE.Texture} PMREM environment texture
 */
export function getStudioEnvironment(renderer) {
  let tex = cache.get(renderer);
  if (tex) return tex;
  const room = new RoomEnvironment();
  // RoomEnvironment sits 3.5 m lower; local y = world y + 3.5 relative to the capture point
  const panel = (color, intensity, w, h, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(x, y + 3.5, z);
    m.lookAt(0, 3.5, 0);
    room.add(m);
  };
  panel('#38d8ff', 1.7, 1.4, 7, -9, 3, -1); //   cyan strip, left
  panel('#ff3fd0', 1.7, 1.4, 7, 9, 3, -2); //    magenta strip, right
  panel('#ffb060', 2.3, 8, 2.2, 0, 8, 5); //     warm overhead softbox, front
  panel('#8fb4ff', 1.4, 6, 2, -3, 6, -8); //     cool back softbox
  const pm = new THREE.PMREMGenerator(renderer);
  tex = pm.fromScene(room, 0.03).texture;
  pm.dispose();
  room.traverse((o) => {
    o.geometry?.dispose?.();
    o.material?.dispose?.();
  });
  cache.set(renderer, tex);
  return tex;
}
