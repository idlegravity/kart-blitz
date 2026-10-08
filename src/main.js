/**
 * Entry point. OWNER: orchestrator.
 */
import { Game } from './Game.js';

function showFatal(err) {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:auto 12px 12px 12px;z-index:100000;max-height:40vh;overflow:auto;background:#300;color:#fdd;padding:12px;border-radius:8px;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap';
  el.textContent = `Kart Blitz crashed:\n${err?.stack || err}`;
  document.body.appendChild(el);
}

try {
  const game = new Game(document.getElementById('app'));
  game.start();
} catch (err) {
  showFatal(err);
}
