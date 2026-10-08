/**
 * Offline rendering + analysis helpers shared by the jukebox and the spectrogram viewer (no DOM at import time).
 */
import { SONGS } from '/src/audio/songs.js';
import { SFX, SFX_META } from '/src/audio/sfx.js';
import { MusicEngine } from '/src/audio/music.js';
import { EngineVoice, rpmTarget } from '/src/audio/engine.js';
import { impulseResponse } from '/src/audio/synth.js';

export const SR = 44100;

export async function renderSong(key, seconds = 20, { tempo = 1 } = {}) {
  const off = new OfflineAudioContext(2, Math.floor(SR * seconds), SR);
  const master = off.createGain();
  master.gain.value = 0.9;
  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
  master.connect(comp).connect(off.destination);
  const musicIn = off.createGain();
  musicIn.gain.value = 0.81;
  musicIn.connect(master);
  const conv = off.createConvolver();
  conv.buffer = impulseResponse(off, 2.6, 2.8, { damp: 0.45 });
  const revIn = off.createGain();
  revIn.connect(conv).connect(musicIn);
  const eng = new MusicEngine(off, { dest: musicIn, reverb: revIn, songs: SONGS });
  eng.tempoScale = tempo;
  eng.renderSong(key, seconds);
  return off.startRendering();
}

export async function renderSfx(name, opts = {}, seconds = 4) {
  const off = new OfflineAudioContext(2, Math.floor(SR * seconds), SR);
  const master = off.createGain();
  master.connect(off.destination);
  const conv = off.createConvolver();
  conv.buffer = impulseResponse(off, 1.9, 3.2, { damp: 0.5 });
  const rev = off.createGain();
  rev.connect(conv).connect(master);
  const out = off.createGain();
  out.connect(master);
  const meta = SFX_META[name] ?? {};
  if (meta.rev) {
    const send = off.createGain();
    send.gain.value = meta.rev;
    out.connect(send).connect(rev);
  }
  SFX[name]({ ctx: off, out, t: 0.05, v: 1, p: 1, o: opts });
  return off.startRendering();
}

/** Render the engine voice at a fixed set of states (each `hold` seconds). states: [{ speed, throttle, boost, skid, offroad }] */
export async function renderEngine(states, hold = 1.2, player = true) {
  const total = states.length * hold;
  const off = new OfflineAudioContext(2, Math.floor(SR * total), SR);
  const master = off.createGain();
  master.connect(off.destination);
  const v = new EngineVoice(off, master, { player });
  // automate with the same setTargetAtTime calls the game makes, but pre-scheduled per 16 ms frame
  const kart = { topSpeed: 30, speed: 0, throttleAmount: 0, grounded: true, controlLocked: false };
  let rpm = 0.2;
  const dt = 1 / 60;
  const frames = Math.floor(total * 60);
  // OfflineAudioContext can't run a live loop, so emulate: schedule params by calling update() with a fake clock
  const realNow = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(off), 'currentTime');
  let clock = 0;
  Object.defineProperty(off, 'currentTime', { get: () => clock, configurable: true });
  for (let f = 0; f < frames; f++) {
    clock = f * dt;
    const st = states[Math.min(states.length - 1, Math.floor(clock / hold))];
    kart.speed = st.speed * 30;
    kart.throttleAmount = st.throttle;
    const tgt = rpmTarget(kart);
    rpm += (tgt - rpm) * (1 - Math.exp(-(tgt > rpm ? 9 : 4) * dt));
    v.update(dt, { rpm, throttle: st.throttle, boost: st.boost ?? 0, skid: st.skid ?? 0, skidLevel: 2, offroad: st.offroad ?? 0, gain: 0.85, pan: 0 });
  }
  Object.defineProperty(off, 'currentTime', realNow ?? { get: () => 0, configurable: true });
  delete off.currentTime;
  return off.startRendering();
}

export function analyse(buf, name = '') {
  const ch = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)];
  const n = buf.length;
  let peak = 0, sum = 0, clipped = 0, silent = 0, nan = false;
  const win = Math.floor(SR * 0.05);
  let winSum = 0, wc = 0;
  const env = [];
  for (let i = 0; i < n; i++) {
    const a = ch[0][i], b = ch[1][i];
    if (a !== a || b !== b) nan = true;
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (m > peak) peak = m;
    if (m >= 0.999) clipped++;
    sum += (a * a + b * b) / 2;
    winSum += m * m;
    if (++wc === win) {
      const r = Math.sqrt(winSum / win);
      env.push(r);
      if (r < 0.0005) silent++;
      winSum = 0;
      wc = 0;
    }
  }
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
  let tail = env.length - 1;
  while (tail > 0 && env[tail] < 0.001) tail--;
  return { name, peakDb: +db(peak).toFixed(1), rmsDb: +db(Math.sqrt(sum / n)).toFixed(1), clipped, silentFrac: +(silent / Math.max(1, env.length)).toFixed(2), tailSec: +((tail + 1) * 0.05).toFixed(2), nan, env };
}

// ---- spectrogram ------------------------------------------------------------------------------------------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Draw a log-frequency spectrogram + waveform into `canvas`. */
export function drawSpectrogram(canvas, buf, { label = '' } = {}) {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#080a1c';
  g.fillRect(0, 0, W, H);
  const N = 2048;
  const data = buf.getChannelData(0);
  const specH = Math.floor(H * 0.78);
  const frames = W;
  const hop = Math.max(1, Math.floor((data.length - N) / frames));
  const re = new Float32Array(N), im = new Float32Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const fMin = 30, fMax = 12000;
  const img = g.createImageData(W, specH);
  for (let x = 0; x < frames; x++) {
    const off = x * hop;
    for (let i = 0; i < N; i++) { re[i] = (data[off + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let y = 0; y < specH; y++) {
      const f = fMin * Math.pow(fMax / fMin, 1 - y / specH);
      const bin = Math.min(N / 2 - 1, Math.round((f / (SR / 2)) * (N / 2)));
      const mag = Math.hypot(re[bin], im[bin]) / N * 4;
      const db = 20 * Math.log10(mag + 1e-7);
      const t = Math.max(0, Math.min(1, (db + 90) / 70));
      const idx = (y * W + x) * 4;
      // magma-ish palette
      img.data[idx] = Math.min(255, 255 * Math.pow(t, 0.8) * 1.4);
      img.data[idx + 1] = Math.min(255, 255 * Math.pow(t, 2.2));
      img.data[idx + 2] = Math.min(255, 140 * Math.sin(Math.min(1, t * 1.6) * Math.PI) * (t < 0.9 ? 1 : 0.5) + 255 * Math.max(0, t - 0.85) * 4);
      img.data[idx + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // freq gridlines
  g.strokeStyle = 'rgba(255,255,255,.18)';
  g.fillStyle = 'rgba(255,255,255,.8)';
  g.font = '11px monospace';
  for (const f of [100, 500, 1000, 2000, 5000, 10000]) {
    const y = specH * (1 - Math.log(f / fMin) / Math.log(fMax / fMin));
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), 4, y - 2);
  }
  // waveform
  const wy = specH + (H - specH) / 2, wh = (H - specH) / 2 - 2;
  g.strokeStyle = '#4dffa6';
  g.beginPath();
  const step = data.length / W;
  for (let x = 0; x < W; x++) {
    let mn = 1, mx = -1;
    for (let i = Math.floor(x * step); i < Math.floor((x + 1) * step); i += 8) { const v = data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    g.moveTo(x, wy - mx * wh);
    g.lineTo(x, wy - mn * wh);
  }
  g.stroke();
  g.fillStyle = '#fff';
  g.font = '13px monospace';
  g.fillText(label, 6, 14);
}

/** Average power (dB) per band over the whole buffer. */
export function bandEnergy(buf) {
  const data = buf.getChannelData(0);
  const N = 4096;
  const bands = [[25, 60], [60, 120], [120, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]];
  const acc = bands.map(() => 0);
  const re = new Float32Array(N), im = new Float32Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  let frames = 0;
  for (let off = 0; off + N < data.length; off += N * 2) {
    for (let i = 0; i < N; i++) { re[i] = data[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    bands.forEach(([lo, hi], b) => {
      let p = 0;
      const k0 = Math.floor((lo / (SR / 2)) * (N / 2)), k1 = Math.max(k0 + 1, Math.floor((hi / (SR / 2)) * (N / 2)));
      for (let k = k0; k < k1; k++) p += (re[k] * re[k] + im[k] * im[k]);
      acc[b] += p;
    });
    frames++;
  }
  return bands.map(([lo, hi], b) => ({ band: `${lo}-${hi}`, db: +(10 * Math.log10(acc[b] / Math.max(1, frames) / (N * N) * 8 + 1e-12)).toFixed(1) }));
}
