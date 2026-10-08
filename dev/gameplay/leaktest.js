/** Checks which item component leaks GPU textures across create/dispose cycles. */
import * as THREE from 'three';
import { ItemBoxes } from '/src/items/ItemBoxes.js';
import { ItemRenderer, CometVisual } from '/src/items/ItemRenderer.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run() {
  const g = window.__game;
  g.items.teardownRace();
  await sleep(300);
  const tex = () => g.renderer.info.memory.textures;
  const geo = () => g.renderer.info.memory.geometries;
  const out = { base: [tex(), geo()] };
  for (let i = 0; i < 3; i++) {
    const grp = new THREE.Group();
    g.scene.add(grp);
    const bx = new ItemBoxes(grp, g.track.itemBoxSlots);
    await sleep(250);
    out['boxes_up' + i] = [tex(), geo()];
    g.scene.remove(grp);
    bx.dispose();
    await sleep(250);
    out['boxes_down' + i] = [tex(), geo()];
  }
  for (let i = 0; i < 3; i++) {
    const grp = new THREE.Group();
    g.scene.add(grp);
    const cv = new CometVisual(grp);
    cv.place(new THREE.Vector3(g.karts[0].position.x, g.karts[0].position.y + 5, g.karts[0].position.z), new THREE.Vector3(0, 0, 1), 0.016);
    await sleep(250);
    out['comet_up' + i] = [tex(), geo()];
    g.scene.remove(grp);
    cv.dispose();
    await sleep(250);
    out['comet_down' + i] = [tex(), geo()];
  }
  for (let i = 0; i < 3; i++) {
    const grp = new THREE.Group();
    g.scene.add(grp);
    const r = new ItemRenderer(grp);
    r.begin();
    r.addBanana(g.karts[0].position, 0, 1);
    r.addGlow(g.karts[0].position, 1, 1, 1, 1);
    r.end();
    await sleep(250);
    out['rend_up' + i] = [tex(), geo()];
    g.scene.remove(grp);
    r.dispose();
    await sleep(250);
    out['rend_down' + i] = [tex(), geo()];
  }
  return out;
}
