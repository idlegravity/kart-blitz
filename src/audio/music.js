/**
 * Music engine: a lookahead step-sequencer that plays songs written in a small text DSL (see songs.js).
 *
 * Song DSL (16th-note grid, 4/4):
 *   song  = { bpm, swing, gain, mix:{layer:{vol,rev,duck,pan,lp}}, parts:[part], loopFrom }
 *   part  = { bars, once?, chords:['Am','F','C|G',...] (one per bar, "X|Y" = two chords per bar),
 *             drums:{ kick:'x...x...', snare, hat, ohat, clap, rim, tom, cow, shaker, tamb, crash, fill:{...}, fillEvery },
 *             layers:{ key:{ kind:'bass'|'pad'|'arp'|'stab'|'lead', inst, pat|rhythm|notes, low, vol, mask, opts } } }
 *   Note streams: "E5:2 G5 A5:4 r:2" — tokens separated by spaces, `|` ignored, `:N` = length in 16ths and is sticky.
 *   Chord-relative streams (bass/arp): degrees R 2 b3 3 4 5 b6 6 b7 7 8 9 10 12, `+`/`-` = octave shift.
 *
 * compileSong() is pure (no WebAudio) so it can be validated in Node. OWNER: Presentation.
 */
import { noteToMidi } from './synth.js';
import { DRUMS, VOICES } from './instruments.js';

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITIES = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  5: [0, 7], add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14], '7sus4': [0, 5, 7, 10], m7b5: [0, 3, 6, 10], maj9: [0, 4, 7, 11, 14],
};
const DEG = { R: 0, 2: 2, b3: 3, 4: 5, b5: 6, b6: 8, 6: 9, b7: 10, 8: 12, 9: 14, 11: 17, 13: 21 };
const STEPS = 16;

/** Parse a chord symbol → { pc, ivs } */
export function parseChord(sym) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(sym);
  if (!m) throw new Error(`bad chord "${sym}"`);
  const ivs = QUALITIES[m[3]];
  if (!ivs) throw new Error(`unknown chord quality "${m[3]}" in "${sym}"`);
  return { sym, pc: (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, ivs };
}

const rootMidi = (pc, low) => low + ((((pc - low) % 12) + 12) % 12);

function degreeOffset(tok, ch) {
  switch (tok) {
    case '3': return ch.ivs.find((i) => i === 3 || i === 4) ?? 4;
    case '5': return ch.ivs.find((i) => i === 6 || i === 7 || i === 8) ?? 7;
    case '7': return ch.ivs.find((i) => i === 10 || i === 11) ?? 10;
    case '10': return (ch.ivs.find((i) => i === 3 || i === 4) ?? 4) + 12;
    case '12': return (ch.ivs.find((i) => i === 6 || i === 7 || i === 8) ?? 7) + 12;
    default: {
      const v = DEG[tok];
      if (v === undefined) throw new Error(`bad degree "${tok}"`);
      return v;
    }
  }
}

/** Tokenise a note stream into [{ rest, head, shift, len }] with sticky lengths. Returns { toks, steps }. */
function tokenize(str, sticky0 = 2) {
  const toks = [];
  let sticky = sticky0, steps = 0;
  for (const raw of String(str).replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean)) {
    const [head0, lenStr] = raw.split(':');
    if (lenStr !== undefined) sticky = Number(lenStr);
    let head = head0, shift = 0;
    while (head.length > 1 && (head.endsWith('+') || head.endsWith('-')) && !/-?\d$/.test(head)) {
      shift += head.endsWith('+') ? 1 : -1;
      head = head.slice(0, -1);
    }
    toks.push({ rest: head === 'r' || head === '.', head, shift, len: sticky, start: steps });
    steps += sticky;
  }
  return { toks, steps };
}

const cyc = (v, i) => (Array.isArray(v) ? v[i % v.length] : v);

function expandChords(list, bars) {
  const out = [];
  for (let b = 0; b < bars; b++) {
    const spec = list[b % list.length];
    const syms = spec.split('|').map((s) => s.trim());
    const seg = 16 / syms.length;
    out.push(syms.map((s, i) => ({ ch: parseChord(s), from: i * seg, to: (i + 1) * seg })));
  }
  return out;
}
const chordAt = (barChords, step) => barChords.find((c) => step >= c.from && step < c.to)?.ch ?? barChords[0].ch;

/**
 * Choose the chord voicing (inversion/octave) closest to `prev` inside [low, low+span].
 * `extra` intervals (e.g. 14 = the 9th) are added as open notes ABOVE the chord, never as a tight cluster.
 */
function voiceLead(prev, ch, low, span = 14, extra = []) {
  const tones = ch.ivs.filter((iv) => iv < 12);
  let best = null, bestCost = Infinity;
  for (let rot = 0; rot < tones.length; rot++) {
    for (let k = -1; k <= 2; k++) {
      const notes = tones.map((iv, i) => ch.pc + iv + 12 * (i < rot ? 1 : 0));
      const shiftBase = low + ((((notes[rot % notes.length] - low) % 12) + 12) % 12) - notes[rot % notes.length];
      const placed = notes.map((n) => n + shiftBase + 12 * k).sort((a, b) => a - b);
      if (placed[0] < low || placed[placed.length - 1] > low + span + 6) continue;
      const cost = prev ? placed.reduce((s, n, i) => s + Math.abs(n - prev[Math.min(i, prev.length - 1)]), 0) : Math.abs(placed[0] - (low + 2));
      if (cost < bestCost) {
        bestCost = cost;
        best = placed;
      }
    }
  }
  if (!best) best = tones.map((iv) => rootMidi(ch.pc, low) + iv);
  best = best.slice();
  for (const e of extra) {
    const top = best[best.length - 1];
    const pc = (ch.pc + e) % 12;
    let p = top + ((((pc - top) % 12) + 12) % 12);
    if (p - top < 3) p += 12;
    best.push(p);
  }
  return best;
}

const DRUM_CHARS = { x: 0.8, X: 1, g: 0.35, o: 0.85 };

/** Compile a song definition into per-bar/per-step event lists. */
export function compileSong(def) {
  const warnings = [];
  const transpose = def.transpose ?? 0;
  const parts = def.parts.map((part, pi) => {
    const bars = part.bars;
    const chords = expandChords(part.chords, bars);
    const events = Array.from({ length: bars }, () => Array.from({ length: STEPS }, () => []));
    const put = (b, s, ev) => {
      if (s >= 0 && s < STEPS) events[b][s].push(ev);
    };

    // ---- drums
    if (part.drums) {
      const d = part.drums;
      const fillEvery = d.fillEvery ?? 4;
      const mask = d.mask;
      for (const name of Object.keys(DRUMS)) {
        const pat = d[name];
        if (!pat) continue;
        for (let b = 0; b < bars; b++) {
          if (mask && mask[b % mask.length] === '.') continue;
          const isFill = d.fill && d.fill[name] !== undefined && b % fillEvery === fillEvery - 1;
          const p = isFill ? cyc(d.fill[name], b) : cyc(pat, b);
          if (p.length !== STEPS) warnings.push(`part ${pi} drum ${name} bar ${b}: pattern length ${p.length} != 16`);
          for (let s = 0; s < Math.min(STEPS, p.length); s++) {
            const v = DRUM_CHARS[p[s]];
            if (v) put(b, s, { layer: 'drums', drum: name, vel: v });
          }
        }
      }
    }

    // ---- melodic layers
    for (const [key, L] of Object.entries(part.layers ?? {})) {
      const kind = L.kind ?? key;
      const mask = L.mask;
      const on = (b) => !mask || mask[b % mask.length] !== '.';
      const base = { layer: key, inst: L.inst, opts: L.opts, vel: L.vel ?? 1 };
      if (kind === 'bass' || kind === 'arp') {
        const low = L.low ?? (kind === 'bass' ? 33 : 60);
        for (let b = 0; b < bars; b++) {
          if (!on(b)) continue;
          const { toks, steps } = tokenize(cyc(L.pat, b), 2);
          if (steps !== STEPS) warnings.push(`part ${pi} layer ${key} bar ${b}: pattern is ${steps} steps, expected 16`);
          for (const t of toks) {
            if (t.rest) continue;
            const ch = chordAt(chords[b], t.start);
            const midi = rootMidi(ch.pc, low) + degreeOffset(t.head, ch) + 12 * t.shift + transpose;
            put(b, t.start, { ...base, kind, notes: [midi], len: t.len });
          }
        }
      } else if (kind === 'pad' || kind === 'stab') {
        const low = L.low ?? (kind === 'pad' ? 55 : 60);
        let prev = null;
        if (kind === 'pad') {
          // hold identical consecutive chords across bar lines
          const segs = [];
          for (let b = 0; b < bars; b++) {
            for (const c of chords[b]) {
              const last = segs[segs.length - 1];
              if (last && last.ch.sym === c.ch.sym && L.merge !== false) last.len += c.to - c.from;
              else segs.push({ b, from: c.from, ch: c.ch, len: c.to - c.from });
            }
          }
          for (const sg of segs) {
            const notes = voiceLead(prev, sg.ch, low, L.span ?? 14, L.extra ?? []);
            prev = notes;
            if (!on(sg.b)) continue;
            put(sg.b, sg.from, { ...base, kind, notes: notes.map((n) => n + transpose), len: sg.len });
          }
        } else {
          for (let b = 0; b < bars; b++) {
            const rp = cyc(L.rhythm, b);
            if (rp.length !== STEPS) warnings.push(`part ${pi} layer ${key} bar ${b}: rhythm length ${rp.length} != 16`);
            for (let s = 0; s < Math.min(STEPS, rp.length); s++) {
              if (rp[s] !== 'x' && rp[s] !== 'X') continue;
              const ch = chordAt(chords[b], s);
              const notes = voiceLead(prev, ch, low, L.span ?? 12, L.extra ?? []);
              prev = notes;
              if (!on(b)) continue;
              put(b, s, { ...base, kind, notes: notes.map((n) => n + transpose), len: L.len ?? 2, vel: (L.vel ?? 1) * (rp[s] === 'X' ? 1 : 0.8) });
            }
          }
        }
      } else if (kind === 'lead') {
        const { toks, steps } = tokenize(L.notes, 2);
        if (steps !== bars * STEPS) warnings.push(`part ${pi} layer ${key}: notes are ${steps} steps, expected ${bars * STEPS}`);
        let prevMidi = null;
        for (const t of toks) {
          if (t.rest) {
            prevMidi = null;
            continue;
          }
          const midi = noteToMidi(t.head);
          if (Number.isNaN(midi)) {
            warnings.push(`part ${pi} layer ${key}: bad note "${t.head}"`);
            continue;
          }
          const b = Math.floor(t.start / STEPS);
          if (b >= bars || !on(b)) continue;
          put(b, t.start % STEPS, { ...base, kind, notes: [midi + (L.shift ?? 0) + transpose], len: t.len, opts: { ...(L.opts ?? {}), ...(L.glide && prevMidi ? { from: prevMidi + (L.shift ?? 0) + transpose } : {}) } });
          prevMidi = midi;
        }
      } else {
        warnings.push(`part ${pi}: unknown layer kind "${kind}"`);
      }
    }
    return { bars, once: !!part.once, events };
  });
  return { def, parts, warnings };
}

// ==================================================================================================
// runtime
// ==================================================================================================
const LOOKAHEAD = 0.55; // seconds scheduled ahead (desktop)
const TICK_MS = 35;
/** A scheduler that fell more than this far behind the audio clock (main-thread stall / throttled timer) skips ahead instead of dumping a burst of late notes. */
const MAX_LATE = 0.3;

/** Plays one compiled song into `dest`. */
class MusicPlayer {
  constructor(engine, key, compiled, { part = 0, bar = 0, startTime, gain = 1 }) {
    this.engine = engine;
    this.key = key;
    this.compiled = compiled;
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.partIdx = part;
    this.bar = bar;
    this.step = 0;
    this.nextTime = startTime;
    this.endTime = Infinity;
    this.stopped = false;
    this.playedSteps = 0;
    const def = compiled.def;
    this.bus = ctx.createGain();
    this.bus.gain.value = gain;
    this.master = ctx.createGain();
    this.master.gain.value = def.gain ?? 0.8;
    this.bus.connect(this.master);
    this.master.connect(engine.dest);
    this.layers = new Map();
    this._buildLayers(def);
    this.loopFrom = def.loopFrom ?? 0;
  }

  _layer(key) {
    return this.layers.get(key);
  }

  _buildLayers(def) {
    const ctx = this.ctx;
    const keys = new Set(['drums']);
    for (const p of def.parts) for (const k of Object.keys(p.layers ?? {})) keys.add(k);
    for (const key of keys) {
      const m = { vol: 0.7, rev: 0, duck: 0, pan: 0, lp: 0, ...(def.mix?.[key] ?? {}) };
      const input = ctx.createGain();
      input.gain.value = m.vol;
      let node = input;
      if (m.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = m.lp;
        node.connect(f);
        node = f;
      }
      const duck = ctx.createGain();
      node.connect(duck);
      let tail = duck;
      if (m.pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = m.pan;
        duck.connect(p);
        tail = p;
      }
      tail.connect(this.bus);
      if (m.rev > 0 && this.engine.reverb) {
        const send = ctx.createGain();
        send.gain.value = m.rev;
        tail.connect(send).connect(this.engine.reverb);
      }
      this.layers.set(key, { input, duck, m });
    }
  }

  /** Schedule every step whose time is before `until`. */
  schedule(until) {
    const eng = this.engine;
    while (!this.stopped && this.nextTime < until && this.nextTime < this.endTime) {
      const c = this.compiled;
      const part = c.parts[this.partIdx];
      const bpm = c.def.bpm * eng.tempoScale;
      const stepDur = 60 / bpm / 4;
      const swing = c.def.swing ?? 0;
      const t = this.nextTime + (this.step % 2 === 1 ? swing * stepDur : 0);
      // stalled (timer throttled / long frame): drop the missed steps, keep the song position, and carry on on the beat grid
      if (!eng.offline && this.nextTime < eng.ctx.currentTime - MAX_LATE) {
        this.nextTime = eng.ctx.currentTime + 0.04;
        this.skipped = (this.skipped ?? 0) + 1;
        continue;
      }
      const evs = part.events[this.bar][this.step];
      // one bad voice must never stall the sequencer (an exception here used to freeze the song forever)
      for (let i = 0; i < evs.length; i++) {
        try {
          this._play(evs[i], t, stepDur);
        } catch (e) {
          this.errors = (this.errors ?? 0) + 1;
          if (this.errors <= 3) console.warn('[music] voice failed', evs[i]?.layer, e);
        }
      }
      this.nextTime += stepDur;
      this.playedSteps++;
      if (++this.step >= STEPS) {
        this.step = 0;
        if (++this.bar >= part.bars) {
          this.bar = 0;
          this.partIdx++;
          if (this.partIdx >= c.parts.length) this.partIdx = this.loopFrom;
        }
      }
    }
  }

  _play(ev, t, stepDur) {
    const layer = this.layers.get(ev.layer);
    if (!layer) return;
    if (ev.drum) {
      if (this.engine.thinDrums?.has(ev.drum)) return;
      const v = ev.vel * (0.94 + Math.random() * 0.12);
      DRUMS[ev.drum](this.ctx, layer.input, t, { vel: v });
      if (ev.drum === 'kick') this._duck(t);
      return;
    }
    const voice = VOICES[ev.inst];
    if (!voice) return;
    voice(this.ctx, layer.input, t, ev.notes, ev.len * stepDur * (ev.kind === 'pad' ? 1 : 0.94), { vel: ev.vel, ...(ev.opts ?? {}) });
  }

  _duck(t) {
    for (const l of this.layers.values()) {
      if (!l.m.duck) continue;
      const p = l.duck.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(1 - l.m.duck, t);
      p.linearRampToValueAtTime(1, t + 0.2);
    }
  }

  /** Fade the song bus to silence and stop scheduling. */
  fadeOut(sec) {
    const ctx = this.ctx, now = ctx.currentTime;
    const p = this.bus.gain;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + Math.max(0.02, sec));
    this.endTime = now + sec + 0.05;
    this.killAt = now + sec + 0.6; // let reverb/release tails ring out
  }

  dispose() {
    this.stopped = true;
    try {
      this.bus.disconnect();
      this.master.disconnect();
    } catch {
      /* already disconnected */
    }
    for (const l of this.layers.values()) {
      try {
        l.input.disconnect();
        l.duck.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
}

/** Manages the current song, crossfades, tempo scale and resume positions. */
export class MusicEngine {
  /**
   * @param {BaseAudioContext} ctx
   * @param {{ dest: AudioNode, reverb?: AudioNode, songs: Record<string, object> }} o
   */
  constructor(ctx, { dest, reverb = null, songs, lookahead = LOOKAHEAD, tickMs = TICK_MS, thinDrums = null }) {
    this.ctx = ctx;
    this.lookahead = lookahead;
    this.tickMs = tickMs;
    /** drum names skipped entirely (mobile CPU budget) */
    this.thinDrums = thinDrums;
    this.dest = dest;
    this.reverb = reverb;
    this.songs = songs;
    this.compiled = new Map();
    this.players = [];
    this.current = null;
    this.currentKey = null;
    this.tempoScale = 1;
    this.positions = new Map();
    this._timer = 0;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  }

  _compile(key) {
    let c = this.compiled.get(key);
    if (!c) {
      const def = this.songs[key];
      if (!def) return null;
      c = compileSong(def);
      for (const w of c.warnings) console.warn(`[music:${key}] ${w}`);
      this.compiled.set(key, c);
    }
    return c;
  }

  start() {
    if (this._timer || this.offline) return;
    this._timer = setInterval(() => this.tick(), this.tickMs);
  }

  stopTimer() {
    clearInterval(this._timer);
    this._timer = 0;
  }

  /** Begin (or crossfade to) a song. */
  play(key, { fade = 0.9, resume = false, startAt = null } = {}) {
    if (key === this.currentKey && this.current) return this.current;
    const compiled = this._compile(key);
    if (!compiled) return null;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // fade the old song
    if (this.current) {
      this.positions.set(this.currentKey, { part: this.current.partIdx, bar: this.current.bar });
      this.current.fadeOut(fade);
    }
    let part = 0, bar = 0;
    if (resume) {
      const pos = this.positions.get(key);
      if (pos) {
        part = pos.part;
        bar = pos.bar;
      }
    }
    const p = new MusicPlayer(this, key, compiled, { part, bar, startTime: startAt ?? now + 0.06, gain: 0 });
    const g = p.bus.gain;
    g.setValueAtTime(0.0001, now);
    g.linearRampToValueAtTime(1, now + Math.max(0.02, fade));
    this.players.push(p);
    this.current = p;
    this.currentKey = key;
    this.start();
    try {
      p.schedule(now + this.lookahead);
    } catch (e) {
      console.warn('[music] initial schedule failed', e);
    }
    p.startedAt = now;
    return p;
  }

  stop(fade = 0.8) {
    if (!this.current) return;
    this.positions.set(this.currentKey, { part: this.current.partIdx, bar: this.current.bar });
    this.current.fadeOut(fade);
    this.current = null;
    this.currentKey = null;
  }

  setTempoScale(s) {
    if (Number.isFinite(s) && s > 0.2 && s < 4) this.tempoScale = s;
  }

  /** Driven from the game frame as well as the interval timer, so a throttled/killed timer can't starve the sequencer. */
  pump() {
    if (this.offline || !this.players.length) return;
    if (!this._timer) this.start();
    if (performance.now() - (this.lastTick ?? 0) > this.tickMs * 0.8) this.tick();
  }

  /** Seconds since the current song started (audio time), or 0. */
  get currentAge() {
    return this.current?.startedAt !== undefined ? this.ctx.currentTime - this.current.startedAt : 0;
  }

  tick() {
    const now = this.ctx.currentTime;
    this.lastTick = performance.now();
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      try {
        p.schedule(now + this.lookahead);
      } catch (e) {
        console.warn('[music] schedule failed', e);
      }
      if (p.killAt && now > p.killAt) {
        p.dispose();
        this.players.splice(i, 1);
      }
    }
    if (!this.players.length) this.stopTimer();
  }

  /**
   * Offline rendering helper: schedule `seconds` of `key` up-front (for OfflineAudioContext tests).
   * @returns {MusicPlayer}
   */
  renderSong(key, seconds) {
    const compiled = this._compile(key);
    const p = new MusicPlayer(this, key, compiled, { startTime: 0.02, gain: 1 });
    p.schedule(seconds);
    this.players.push(p);
    return p;
  }

  dispose() {
    this.stopTimer();
    for (const p of this.players) p.dispose();
    this.players = [];
    this.current = null;
  }
}

/** Song length in seconds of one pass through the given song (all parts). */
export function songSeconds(def) {
  const bars = def.parts.reduce((n, p) => n + p.bars, 0);
  return (bars * 16 * 60) / (def.bpm * 4);
}
