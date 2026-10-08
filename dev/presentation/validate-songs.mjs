// Node validation for the song DSL: node dev/presentation/validate-songs.mjs
import { SONGS } from '../../src/audio/songs.js';
import { compileSong, songSeconds } from '../../src/audio/music.js';
import { VOICES, DRUMS } from '../../src/audio/instruments.js';

let bad = 0;
for (const [key, def] of Object.entries(SONGS)) {
  let c;
  try {
    c = compileSong(def);
  } catch (e) {
    console.log(`[${key}] COMPILE ERROR: ${e.message}`);
    bad++;
    continue;
  }
  let events = 0, maxSimul = 0, lo = 999, hi = 0;
  const layersUsed = new Set();
  for (const p of c.parts) {
    for (const bar of p.events) for (const step of bar) {
      events += step.length;
      maxSimul = Math.max(maxSimul, step.length);
      for (const ev of step) {
        if (ev.drum) { if (!DRUMS[ev.drum]) { console.log(`[${key}] unknown drum ${ev.drum}`); bad++; } continue; }
        if (!VOICES[ev.inst]) { console.log(`[${key}] unknown inst ${ev.inst} (layer ${ev.layer})`); bad++; }
        layersUsed.add(ev.layer);
        for (const n of ev.notes) { lo = Math.min(lo, n); hi = Math.max(hi, n); }
      }
    }
  }
  const mixKeys = Object.keys(def.mix ?? {});
  for (const k of layersUsed) if (!mixKeys.includes(k)) console.log(`[${key}] layer "${k}" has no mix entry (defaults used)`);
  console.log(`[${key}] ${def.bpm}bpm  ${c.parts.map((p) => p.bars).join('+')} bars  ${songSeconds(def).toFixed(1)}s  events=${events} maxSimul=${maxSimul} range=${lo}-${hi}  warnings=${c.warnings.length}`);
  for (const w of c.warnings) { console.log('   WARN', w); bad++; }
}
console.log(bad ? `${bad} problem(s)` : 'all songs OK');
process.exit(bad ? 1 : 0);
