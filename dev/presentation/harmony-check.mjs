// Node: flags lead notes on strong beats that are not chord tones (sanity check for the hand-written melodies).
import { SONGS } from '../../src/audio/songs.js';
import { compileSong, parseChord } from '../../src/audio/music.js';
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
for (const [key, def] of Object.entries(SONGS)) {
  const c = compileSong(def);
  c.parts.forEach((part, pi) => {
    const spec = def.parts[pi];
    const bad = [];
    let total = 0;
    part.events.forEach((bar, b) => {
      const symsRaw = spec.chords[b % spec.chords.length].split('|').map((s) => s.trim());
      bar.forEach((evs, step) => {
        for (const ev of evs) {
          if (ev.drum || (ev.kind !== 'lead')) continue;
          if (ev.layer === 'harmony') continue;
          if (step % 8 !== 0) continue; // half-bar strong beats
          const ch = parseChord(symsRaw[Math.min(symsRaw.length - 1, Math.floor(step / (16 / symsRaw.length)))]);
          const pcs = ch.ivs.map((iv) => (ch.pc + iv) % 12);
          const pc = ev.notes[0] % 12;
          total++;
          if (!pcs.includes(pc)) bad.push(`bar ${b + 1} step ${step}: ${NAMES[pc]} over ${ch.sym}`);
        }
      });
    });
    console.log(`[${key}] part ${pi}: ${total} strong-beat lead notes, ${bad.length} non-chord-tones${bad.length ? ' -> ' + bad.join('; ') : ''}`);
  });
}
