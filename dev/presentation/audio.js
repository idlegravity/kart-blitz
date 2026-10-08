/**
 * Dev jukebox + offline level tests for the Presentation audio system.
 *   Page:   /dev/presentation/audio.html
 *   Probes: window.__audioTest.songReport(), .sfxReport(), .renderSong('menu', 20)
 */
import { EventBus } from '/src/core/EventBus.js';
import { EVT } from '/src/core/events.js';
import { AudioManager } from '/src/audio/AudioManager.js';
import { SONGS } from '/src/audio/songs.js';
import { SFX_NAMES } from '/src/audio/sfx.js';
import { songSeconds } from '/src/audio/music.js';
import { renderSong, renderSfx, analyse, bandEnergy } from './audio-lib.js';

// ---------------------------------------------------------------------------------------------
// a tiny mock of the Game surface the AudioManager needs
// ---------------------------------------------------------------------------------------------
const events = new EventBus();
const kart = (id, x, z, extra = {}) => ({
  id, isPlayer: false, position: { x, y: 0, z }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, topSpeed: 30, throttleAmount: 0, grounded: true, controlLocked: false,
  drifting: false, driftLevel: 0, steerAmount: 0, boostTime: 0, boostPower: 0, surface: 'road', hit: null, shrinkTime: 0, starTime: 0, rouletteTime: 0, ...extra,
});
const player = kart(0, 0, 0, { isPlayer: true });
const cpus = [kart(1, 12, 20), kart(2, -18, 40), kart(3, 30, -10)];
const game = {
  events,
  settings: { masterVolume: 0.8, musicVolume: 0.55, sfxVolume: 0.85 },
  state: 'menu',
  paused: false,
  player,
  karts: [player, ...cpus],
  race: { phase: 'racing', laps: 3 },
  track: { id: 'meadow' },
  camera: { position: { x: 0, y: 3, z: -7 }, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 3, -7, 1] } },
};
const audio = new AudioManager(game);
window.__audio = audio;
window.__mockGame = game;

const $ = (id) => document.getElementById(id);
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ---------------------------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------------------------
const songsEl = $('songs');
for (const key of Object.keys(SONGS)) {
  const b = document.createElement('button');
  b.className = 'song';
  b.textContent = `${key} (${SONGS[key].bpm} bpm, ${songSeconds(SONGS[key]).toFixed(0)}s)`;
  b.onclick = () => {
    unlock();
    audio.playMusic(key);
  };
  songsEl.appendChild(b);
}
const sfxEl = $('sfx');
const sfxOpts = { miniturbo: { level: 2 }, driftLevel: { level: 2 }, land: { impact: 9 }, wall: { impact: 14 }, explosion: { size: 1 }, rouletteTick: { index: 3 } };
for (const name of SFX_NAMES) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => {
    unlock();
    audio.playSfx(name, { noVary: true, global: true, ...(sfxOpts[name] ?? {}) });
  };
  sfxEl.appendChild(b);
}
// 3 variants of the level-based sfx
for (const n of ['miniturbo', 'driftLevel']) {
  for (const level of [1, 3]) {
    const b = document.createElement('button');
    b.textContent = `${n} L${level}`;
    b.onclick = () => {
      unlock();
      audio.playSfx(n, { level, noVary: true, global: true });
    };
    sfxEl.appendChild(b);
  }
}
const setVol = () => {
  game.settings.masterVolume = Number($('vMaster').value);
  game.settings.musicVolume = Number($('vMusic').value);
  game.settings.sfxVolume = Number($('vSfx').value);
  events.emit(EVT.SETTINGS_CHANGED, { settings: game.settings, key: 'x' });
};
['vMaster', 'vMusic', 'vSfx'].forEach((id) => ($(id).oninput = setVol));
$('bMute').onclick = () => {
  audio.setMuted(!audio.muted);
  $('bMute').classList.toggle('on', audio.muted);
};
$('bPause').onclick = () => {
  unlock();
  game.paused = !game.paused;
  $('bPause').classList.toggle('on', game.paused);
  events.emit(EVT.GAME_PAUSE, { paused: game.paused });
};
$('bTempo').onclick = () => {
  unlock();
  const on = audio.music.tempoScale === 1;
  audio.music.setTempoScale(on ? 1.12 : 1);
  $('bTempo').classList.toggle('on', on);
};
$('bStar').onclick = () => {
  unlock();
  audio._starActive = !audio._starActive;
  audio._applyMusic(0.4);
  $('bStar').classList.toggle('on', audio._starActive);
};
$('bStop').onclick = () => audio.stopMusic(0.6);
$('bDemo').onclick = async () => {
  unlock();
  for (const n of SFX_NAMES) {
    audio.playSfx(n, { noVary: true, global: true, ...(sfxOpts[n] ?? {}) });
    await new Promise((r) => setTimeout(r, ['lightning', 'finishWin', 'finishLose', 'explosion', 'siren'].includes(n) ? 2200 : 700));
  }
};

// engine
let engineOn = false;
$('bEngine').onclick = () => {
  unlock();
  engineOn = !engineOn;
  $('bEngine').classList.toggle('on', engineOn);
  game.state = engineOn ? 'race' : 'menu';
  if (!engineOn) audio.teardownRace();
  else audio.setupRace({ track: { id: 'meadow' } });
};
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (engineOn) {
    const auto = $('eAuto').checked;
    if (auto) {
      // sweep through the gears automatically
      const t = now / 1000;
      const v = ((t % 9) / 9) * 1.1;
      $('eSpeed').value = v;
      $('eThr').value = v < 1.05 ? 1 : 0;
    }
    const ratio = Number($('eSpeed').value);
    player.speed = ratio * player.topSpeed;
    player.throttleAmount = Number($('eThr').value);
    player.boostTime = Number($('eBoost').value) > 0 ? 1 : 0;
    player.boostPower = Number($('eBoost').value);
    player.drifting = $('eDrift').checked;
    player.driftLevel = player.drifting ? 2 : 0;
    player.steerAmount = 0.7;
    player.surface = $('eOff').checked ? 'offroad' : 'road';
    player.velocity.z = player.speed;
    // cpus circle around
    cpus.forEach((k, i) => {
      const a = now / 1000 * (0.6 + i * 0.2) + i * 2;
      k.position.x = Math.sin(a) * 25;
      k.position.z = 15 + Math.cos(a) * 30;
      k.velocity.x = Math.cos(a) * 15;
      k.velocity.z = -Math.sin(a) * 18;
      k.speed = 18;
      k.throttleAmount = 1;
    });
    $('eInfo').textContent = `speed ratio ${ratio.toFixed(2)} · rpm ${(audio._rpm.get(player) ?? 0).toFixed(2)}`;
  }
  audio.update(dt);
  const s = audio.stats();
  $('stats').textContent = `ctx: ${s.state}  t=${s.time.toFixed(1)}s  music: ${s.music ?? '-'}  players: ${s.players}  tempo: ${s.tempo}  engines: ${s.engines}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------------------------
// offline rendering & level analysis (shared with spectro.html via audio-lib.js)
// ---------------------------------------------------------------------------------------------
const fmt = (r) => `${r.name.padEnd(14)} peak ${String(r.peakDb).padStart(6)} dB  rms ${String(r.rmsDb).padStart(6)} dB  clip ${r.clipped}  silent ${r.silentFrac}  tail ${r.tailSec}s${r.nan ? '  NaN!' : ''}`;

async function songReport(seconds = 24) {
  const rows = [];
  for (const key of Object.keys(SONGS)) rows.push(analyse(await renderSong(key, seconds), key));
  return rows;
}

async function sfxReport() {
  const rows = [];
  for (const name of SFX_NAMES) rows.push(analyse(await renderSfx(name, sfxOpts[name] ?? {}), name));
  return rows;
}

window.__audioTest = {
  renderSong,
  renderSfx,
  songReport,
  sfxReport,
  analyse,
  bandEnergy,
  async summary() {
    const strip = ({ env, ...r }) => r;
    return { songs: (await songReport()).map(strip), sfx: (await sfxReport()).map(strip) };
  },
};

function drawEnvelope(env, label) {
  const cv = $('viz');
  const g = cv.getContext('2d');
  g.fillStyle = '#0b0d20';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#4dffa6';
  const step = env.length / cv.width;
  for (let x = 0; x < cv.width; x++) {
    const v = Math.min(1, env[Math.floor(x * step)] * 2.2);
    g.fillRect(x, cv.height - v * cv.height, 1, v * cv.height);
  }
  g.fillStyle = '#fff';
  g.font = '12px monospace';
  g.fillText(label, 8, 14);
}

$('bMusicReport').onclick = async () => {
  $('report').textContent = 'rendering songs offline…';
  const rows = await songReport();
  $('report').textContent = rows.map(fmt).join('\n');
  drawEnvelope(rows[0].env, rows[0].name);
};
$('bLoud').onclick = async () => {
  $('report').textContent = 'rendering sfx offline…';
  $('report').textContent = (await sfxReport()).map(fmt).join('\n');
};
