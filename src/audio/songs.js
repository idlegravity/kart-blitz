/**
 * The soundtrack: eight original songs written in the sequencer DSL (see music.js).
 * Keys: 'menu' (funk, F major), 'meadow' (bright major, C), 'canyon' (surf/western, A minor), 'glacier' (crystal, D minor),
 * 'neon' (eurobeat/synthwave, A minor), 'results' (triumphant, C), 'victory' (fanfare + loop, C), 'star' (invincibility, C).
 * OWNER: Presentation.
 */

const bars = (...b) => b.join(' | ');

// ==================================================================================================
// MENU — funky upbeat, 118 BPM, F major (I–vi–ii–V)
// ==================================================================================================
const menu = {
  bpm: 118,
  swing: 0.12,
  gain: 0.85,
  mix: {
    drums: { vol: 0.82, rev: 0.05 },
    bass: { vol: 0.95 },
    keys: { vol: 0.5, rev: 0.14, pan: -0.15 },
    horns: { vol: 0.34, rev: 0.12, pan: 0.2 },
    pad: { vol: 0.3, rev: 0.25 },
    lead: { vol: 0.5, rev: 0.16 },
    sparkle: { vol: 0.32, rev: 0.3, pan: 0.25 },
  },
  parts: [
    {
      bars: 8,
      chords: ['Fmaj7', 'Dm7', 'Gm7', 'C7', 'Fmaj7', 'Dm7', 'Bbmaj7', 'C7'],
      drums: {
        kick: ['x.....x..x......', 'x.....x..x..x...'],
        snare: '....X.g.g..gX..g',
        hat: 'XgxgXgxgXgxgXgxg',
        ohat: '..............x.',
        fill: { snare: '....X...X.XxXxXX', kick: 'x.....x..x.x....' },
      },
      layers: {
        bass: { inst: 'bassFunk', low: 33, pat: ['R:3 r:1 R:2 8:1 r:1 b7:2 5:2 R:2 r:2', 'R:2 R:1 r:1 5:2 R:2 8:1 r:1 b7:2 5:2 r:2'] },
        keys: { kind: 'stab', inst: 'epiano', low: 58, len: 3, rhythm: ['x..x..x...x.x...', 'x..x..x..x..x.x.'] },
        pad: { kind: 'pad', inst: 'padSoft', low: 53 },
        lead: {
          kind: 'lead', inst: 'saw',
          notes: bars(
            'A5:2 C6:2 A5:2 G5:2 A5:4 r:4',
            'A5:2 D6:2 A5:2 F5:2 A5:4 r:4',
            'Bb5:2 D6:2 Bb5:2 A5:2 G5:4 r:4',
            'G5:2 A5:2 Bb5:2 A5:2 G5:4 E5:4',
            'C6:2 A5:2 C6:2 D6:2 F6:4 r:4',
            'D6:2 C6:2 A5:2 F5:2 D5:4 r:4',
            'D6:2 F6:2 D6:2 C6:2 Bb5:4 A5:4',
            'G5:2 Bb5:2 C6:2 E6:2 D6:4 C6:2 Bb5:2',
          ),
        },
      },
    },
    {
      bars: 8,
      chords: ['Bbmaj7', 'Am7', 'Gm7', 'C7', 'Fmaj7', 'Dm7', 'Gm7', 'C7'],
      drums: {
        kick: ['x.....x..x..x...', 'x.....x..x......'],
        snare: '....X.g.g..gX..g',
        clap: '....x.......x...',
        hat: 'XgxgXgxgXgxgXgxg',
        ohat: '..............x.',
        fill: { snare: '....X...X.XxXxXX', kick: 'x.....x..x.x....' },
      },
      layers: {
        bass: { inst: 'bassFunk', low: 33, pat: ['R:3 r:1 R:2 8:1 r:1 b7:2 5:2 R:2 r:2', 'R:2 R:1 r:1 5:2 R:2 8:1 r:1 b7:2 5:2 r:2'] },
        keys: { kind: 'stab', inst: 'epiano', low: 58, len: 3, rhythm: ['x..x..x...x.x...', 'x..x..x..x..x.x.'] },
        horns: { kind: 'stab', inst: 'brass', low: 58, len: 2, rhythm: ['x..x..x...x.....', 'x..x..x...x..x..'] },
        pad: { kind: 'pad', inst: 'padSoft', low: 53 },
        sparkle: { kind: 'arp', inst: 'glock', low: 67, pat: 'R:2 5:2 8:2 5:2 R:2 5:2 8:2 10:2' },
        lead: {
          kind: 'lead', inst: 'saw',
          notes: bars(
            'D6:4 F6:2 D6:2 C6:4 Bb5:4',
            'C6:4 E6:2 C6:2 A5:4 G5:4',
            'Bb5:4 D6:2 Bb5:2 G5:4 D5:4',
            'E5:2 G5:2 Bb5:2 C6:2 E6:8',
            'A5:2 C6:2 F6:4 E6:2 D6:2 C6:4',
            'A5:2 D6:2 F6:4 E6:2 D6:2 A5:4',
            'G5:2 Bb5:2 D6:2 G6:2 F6:2 D6:2 Bb5:4',
            'C6:2 E6:2 G6:4 F6:2 E6:2 C6:2 Bb5:2',
          ),
        },
      },
    },
  ],
};

// ==================================================================================================
// MEADOW — bright happy major, 140 BPM, C major (I–V–vi–IV)
// ==================================================================================================
const meadow = {
  bpm: 140,
  swing: 0,
  gain: 0.8,
  mix: {
    drums: { vol: 0.75, rev: 0.05 },
    bass: { vol: 0.85 },
    strum: { vol: 0.5, rev: 0.1, pan: -0.2 },
    pad: { vol: 0.24, rev: 0.22 },
    lead: { vol: 0.62, rev: 0.16 },
    glock: { vol: 0.34, rev: 0.3, pan: 0.25 },
    harmony: { vol: 0.26, rev: 0.2, pan: -0.25 },
  },
  parts: [
    {
      bars: 8,
      chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'],
      drums: {
        kick: 'x.......x.......',
        snare: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        tamb: '..x...x...x...x.',
        fill: { snare: '....x...x.x.xxxx', hat: 'x.x.x.x.xxxxxxxx' },
      },
      layers: {
        bass: { inst: 'bassSquare', low: 36, pat: 'R:3 r:1 5:3 r:1 R:3 r:1 5:3 r:1' },
        strum: { kind: 'stab', inst: 'pluck', low: 60, len: 2, rhythm: ['....x.......x...', '....x..x....x.x.'] },
        pad: { kind: 'pad', inst: 'padSoft', low: 55 },
        lead: {
          kind: 'lead', inst: 'whistle',
          notes: bars(
            'E5:2 G5:2 C6:4 B5:2 G5:2 E5:4',
            'D5:2 G5:2 B5:4 A5:2 G5:2 D5:4',
            'E5:2 A5:2 C6:4 B5:2 A5:2 E5:4',
            'F5:2 A5:2 C6:4 A5:2 F5:2 C5:4',
            'E5:2 G5:2 C6:2 E6:2 D6:4 C6:2 G5:2',
            'D6:2 B5:2 G5:2 B5:2 D6:4 r:4',
            'C6:2 A5:2 F5:2 A5:2 C6:4 A5:2 F5:2',
            'G5:2 B5:2 D6:2 G6:2 F6:4 D6:4',
          ),
        },
      },
    },
    {
      bars: 8,
      chords: ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C'],
      drums: {
        kick: ['x.......x.......', 'x.......x.....x.'],
        snare: '....x.......x...',
        clap: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        tamb: '..x...x...x...x.',
        fill: { snare: '....x...x.x.xxxx', clap: '................' },
      },
      layers: {
        bass: { inst: 'bassSquare', low: 36, pat: ['R:3 r:1 5:3 r:1 R:3 r:1 5:3 r:1', 'R:3 r:1 5:3 r:1 R:2 5:2 8:3 r:1'] },
        strum: { kind: 'stab', inst: 'pluck', low: 60, len: 2, rhythm: ['....x..x....x.x.', '..x.x...x.x.x...'] },
        pad: { kind: 'pad', inst: 'padSoft', low: 55 },
        glock: { kind: 'arp', inst: 'glock', low: 67, pat: '5:2 8:2 10:2 8:2 5:2 8:2 12:2 8:2' },
        harmony: {
          kind: 'lead', inst: 'pluck',
          notes: bars(
            'r:16', 'r:16', 'r:16', 'r:16',
            'C5:4 A4:4 C5:4 F5:4', 'D5:4 B4:4 D5:4 G5:4', 'E5:4 G5:4 C6:8', 'E5:4 G5:4 E5:4 G5:4',
          ),
        },
        lead: {
          kind: 'lead', inst: 'whistle',
          notes: bars(
            'A5:4 C6:4 F6:4 E6:2 C6:2',
            'D6:4 B5:4 G5:4 B5:2 D6:2',
            'E6:4 B5:4 G5:4 B5:4',
            'C6:2 E6:2 A6:4 G6:2 E6:2 C6:4',
            'A5:2 C6:2 F6:4 E6:2 D6:2 C6:4',
            'B5:2 D6:2 G6:4 F6:2 D6:2 B5:4',
            'C6:2 E6:2 G6:4 E6:2 C6:2 G5:4',
            'C6:6 r:2 G5:2 A5:2 B5:2 D6:2',
          ),
        },
      },
    },
  ],
};

// ==================================================================================================
// CANYON — surf-rock / western twang, 150 BPM, A minor (harmonic) then Andalusian cadence
// ==================================================================================================
const canyon = {
  bpm: 150,
  swing: 0,
  gain: 0.85,
  mix: {
    drums: { vol: 0.85, rev: 0.12 },
    bass: { vol: 0.85 },
    gtr: { vol: 0.8, rev: 0.28, pan: -0.25 },
    lead: { vol: 0.9, rev: 0.34, pan: 0.1 },
    pad: { vol: 0.2, rev: 0.3 },
  },
  parts: [
    {
      bars: 8,
      chords: ['Am', 'Am', 'Dm', 'Am', 'F', 'E', 'Am', 'E7'],
      drums: {
        kick: 'x.....x.x.......',
        snare: '....X.......X...',
        rim: '.......g.......g',
        hat: 'x.x.x.x.x.x.x.x.',
        fill: { tom: '........x.x.xxxx', hat: 'x.x.x.x.........' },
        tom: '................',
      },
      layers: {
        bass: { inst: 'bassSquare', low: 33, pat: ['R:2 R:2 R:2 R:2 R:2 R:2 R:2 R:2', 'R:2 R:2 R:2 5:2 R:2 R:2 R:2 5:2'] },
        gtr: { kind: 'stab', inst: 'twang', low: 57, len: 1, span: 9, rhythm: 'x.x.x.x.x.x.x.x.', vel: 0.8 },
        pad: { kind: 'pad', inst: 'padSoft', low: 53 },
        lead: {
          kind: 'lead', inst: 'twang', opts: { trem: true },
          notes: bars(
            'A5:2 A5:1 C6:1 E6:2 D6:2 C6:2 B5:2 A5:4',
            'E6:2 E6:1 D6:1 C6:2 B5:2 A5:2 G#5:2 A5:4',
            'D6:2 D6:1 F6:1 A6:2 G6:2 F6:2 E6:2 D6:4',
            'C6:2 B5:2 A5:2 G#5:2 A5:8',
            'F6:2 E6:2 D6:2 C6:2 A5:4 C6:4',
            'B5:2 E6:2 G#6:2 E6:2 B5:4 G#5:4',
            'A5:2 C6:2 E6:2 A6:2 G#6:2 E6:2 C6:2 A5:2',
            'B5:2 D6:2 E6:4 G#6:2 E6:2 D6:2 B5:2',
          ),
        },
      },
    },
    {
      bars: 8,
      chords: ['Am', 'G', 'F', 'E', 'Am', 'G', 'F', 'E'],
      drums: {
        kick: ['x.....x.x.......', 'x.....x.x.x.....'],
        snare: '....X.......X...',
        clap: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        ohat: '..............x.',
        fill: { tom: '........x.x.xxxx' },
        tom: '................',
      },
      layers: {
        bass: { inst: 'bassSquare', low: 33, pat: ['R:2 R:2 R:2 R:2 R:2 R:2 R:2 R:2', 'R:2 R:2 R:2 5:2 R:2 R:2 5:2 R:2'] },
        gtr: { kind: 'stab', inst: 'twang', low: 57, len: 1, span: 9, rhythm: ['x.x.x.x.x.x.x.x.', 'x..xx..xx..xx..x'], vel: 0.8 },
        pad: { kind: 'pad', inst: 'padSoft', low: 53 },
        lead: {
          kind: 'lead', inst: 'twang', opts: { trem: true },
          notes: bars(
            'E6:4 D6:2 C6:2 A5:8',
            'D6:4 C6:2 B5:2 G5:8',
            'C6:4 B5:2 A5:2 F5:8',
            'B5:2 G#5:2 B5:2 E6:2 G#6:4 E6:4',
            'A5:2 C6:2 E6:2 A6:2 G6:4 E6:4',
            'G5:2 B5:2 D6:2 G6:2 E6:4 D6:4',
            'F5:2 A5:2 C6:2 F6:2 E6:4 C6:4',
            'E6:2 D6:2 B5:2 G#5:2 E5:8',
          ),
        },
      },
    },
  ],
};

// ==================================================================================================
// GLACIER — crystalline bells & arps, 132 BPM, D minor → F major
// ==================================================================================================
const arpA = 'R:1 5:1 8:1 5:1 10:1 8:1 5:1 8:1 R:1 5:1 8:1 5:1 10:1 8:1 12:1 10:1';
const arpB = 'R:1 8:1 5:1 10:1 8:1 12:1 10:1 8:1 5:1 8:1 R:1 5:1 8:1 5:1 3:1 5:1';
const glacier = {
  bpm: 132,
  swing: 0,
  gain: 0.74,
  mix: {
    drums: { vol: 0.55, rev: 0.2 },
    bass: { vol: 0.8 },
    pad: { vol: 0.4, rev: 0.4 },
    arp: { vol: 0.5, rev: 0.4, pan: 0.2 },
    lead: { vol: 0.5, rev: 0.45, pan: -0.1 },
    shimmer: { vol: 0.22, rev: 0.6, pan: -0.3 },
  },
  parts: [
    {
      bars: 8,
      chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'],
      drums: {
        kick: 'x.......x.......',
        rim: '........x.......',
        hat: 'x.x.x.x.x.x.x.x.',
        mask: 'xxxxxxxx',
      },
      layers: {
        bass: { inst: 'bassSub', low: 33, pat: ['R:6 r:2 R:6 r:2', 'R:6 r:2 R:4 5:4'] },
        pad: { kind: 'pad', inst: 'padSoft', low: 57, extra: [14] },
        arp: { kind: 'arp', inst: 'glock', low: 70, pat: [arpA, arpB] },
        lead: {
          kind: 'lead', inst: 'chime',
          notes: bars(
            'A5:6 F5:2 A5:4 D6:4',
            'D6:6 Bb5:2 D6:4 F6:4',
            'C6:6 A5:2 C6:4 F6:4',
            'E6:6 C6:2 E6:4 G6:4',
            'F6:4 E6:4 D6:4 A5:4',
            'D6:4 C6:4 Bb5:4 F5:4',
            'Bb5:4 D6:4 G6:8',
            'A5:4 C#6:4 E6:8',
          ),
        },
      },
    },
    {
      bars: 8,
      chords: ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Bb', 'C'],
      drums: {
        kick: ['x.......x.......', 'x.......x.....x.'],
        snare: '........x.......',
        hat: 'x.x.x.x.x.x.x.x.',
        ohat: '..............x.',
        fill: { snare: '....x...x.x.x.xx' },
      },
      layers: {
        bass: { inst: 'bassSub', low: 33, pat: ['R:4 r:2 R:2 R:4 r:2 5:2', 'R:6 r:2 R:6 r:2'] },
        pad: { kind: 'pad', inst: 'padSoft', low: 57, extra: [14] },
        arp: { kind: 'arp', inst: 'glock', low: 70, pat: [arpB, arpA] },
        shimmer: { kind: 'arp', inst: 'bell', low: 70, pat: 'r:2 5:2 r:2 10:2 r:2 8:2 r:2 12:2' },
        lead: {
          kind: 'lead', inst: 'bell',
          notes: bars(
            'A5:4 C6:4 F6:8',
            'G5:4 C6:4 E6:8',
            'A5:4 D6:4 F6:4 A6:4',
            'D6:4 F6:4 Bb5:8',
            'C6:4 F6:4 A6:8',
            'G6:4 E6:4 C6:8',
            'D6:4 F6:4 Bb6:4 F6:4',
            'G6:4 E6:4 G5:2 C6:2 E6:4',
          ),
        },
      },
    },
  ],
};

// ==================================================================================================
// NEON — synthwave / eurobeat, 160 BPM, A minor (IV–V–iii–vi verses, i–VI–III–VII choruses)
// ==================================================================================================
const eurobass = 'R:1 R+:1 R+:1 R:1 R:1 R+:1 R+:1 R:1 R:1 R+:1 R+:1 R:1 R:1 R+:1 R+:1 R:1';
const euroArp = 'R:1 5:1 8:1 5:1 10:1 5:1 8:1 5:1 R:1 5:1 8:1 5:1 10:1 5:1 12:1 5:1';
const neon = {
  bpm: 160,
  swing: 0,
  gain: 0.95,
  mix: {
    drums: { vol: 0.85, rev: 0.08 },
    bass: { vol: 0.8, duck: 0.35 },
    arp: { vol: 0.34, rev: 0.22, duck: 0.4, pan: 0.2 },
    stab: { vol: 0.34, rev: 0.16, duck: 0.45, pan: -0.2 },
    pad: { vol: 0.3, rev: 0.3, duck: 0.55 },
    lead: { vol: 0.42, rev: 0.28, duck: 0.15 },
  },
  parts: [
    {
      bars: 8,
      chords: ['F', 'G', 'Em', 'Am', 'F', 'G', 'E7', 'Am'],
      drums: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        ohat: '..x...x...x...x.',
        fill: { clap: '....x...x.x.xxxx', crash: 'x...............' },
        crash: '................',
      },
      layers: {
        bass: { inst: 'bassSaw', low: 33, pat: eurobass },
        arp: { kind: 'arp', inst: 'pluckSaw', low: 64, pat: euroArp },
        stab: { inst: 'stab', low: 57, len: 1, rhythm: '..x...x...x...x.', opts: { cutoff: 2600 } },
        pad: { kind: 'pad', inst: 'pad', low: 55, opts: { cutoff: 1500 } },
        lead: {
          kind: 'lead', inst: 'pulse',
          notes: bars(
            'C6:4 r:4 A5:4 C6:4',
            'B5:4 r:4 G5:4 B5:4',
            'G5:4 B5:4 E6:4 B5:4',
            'C6:4 A5:4 E5:8',
            'C6:4 r:4 A5:4 F5:4',
            'D6:4 r:4 B5:4 G5:4',
            'G#5:4 B5:4 D6:4 B5:4',
            'A5:8 E5:4 A5:4',
          ),
        },
      },
    },
    {
      bars: 8,
      chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E7'],
      drums: {
        kick: 'x...x...x...x...',
        clap: '....x.......x...',
        snare: '....x.......x...',
        hat: 'xxxxxxxxxxxxxxxx',
        ohat: '..x...x...x...x.',
        fill: { clap: '....x...x.x.xxxx', crash: 'x...............' },
        crash: 'x...............',
        mask: 'xxxxxxxx',
      },
      layers: {
        bass: { inst: 'bassSaw', low: 33, pat: eurobass },
        arp: { kind: 'arp', inst: 'pluckSaw', low: 64, pat: euroArp },
        stab: { inst: 'stab', low: 57, len: 1, rhythm: '..x...x...x...x.', opts: { cutoff: 2600 } },
        pad: { kind: 'pad', inst: 'pad', low: 55, opts: { cutoff: 1700 } },
        lead: {
          kind: 'lead', inst: 'super',
          notes: bars(
            'A5:2 C6:2 E6:4 D6:2 C6:2 A5:4',
            'A5:2 C6:2 F6:4 E6:2 C6:2 A5:4',
            'G5:2 C6:2 E6:4 D6:2 C6:2 G5:4',
            'G5:2 B5:2 D6:4 B5:2 G5:2 D5:4',
            'E6:4 D6:2 C6:2 A5:4 C6:2 E6:2',
            'F6:4 E6:2 C6:2 A5:4 C6:2 F6:2',
            'G6:4 F6:2 D6:2 B5:4 D6:2 G6:2',
            'E6:4 G#5:2 B5:2 E6:8',
          ),
        },
      },
    },
  ],
};

// ==================================================================================================
// RESULTS — triumphant, warm, 104 BPM, C major
// ==================================================================================================
const results = {
  bpm: 104,
  swing: 0.06,
  gain: 1.5,
  mix: {
    drums: { vol: 0.7, rev: 0.08 },
    bass: { vol: 0.9 },
    keys: { vol: 0.36, rev: 0.2, pan: -0.2 },
    pad: { vol: 0.3, rev: 0.3 },
    lead: { vol: 0.5, rev: 0.22 },
    bells: { vol: 0.28, rev: 0.32, pan: 0.25 },
  },
  parts: [
    {
      bars: 8,
      chords: ['C', 'F', 'Dm', 'G', 'C', 'Am', 'F', 'G'],
      drums: {
        kick: ['x.......x.x.....', 'x.......x.......'],
        snare: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        clap: '....x.......x...',
        crash: 'x...............',
        fill: { snare: '....x...x.x.xxxx', crash: '................' },
        mask: 'xxxxxxxx',
      },
      layers: {
        bass: { inst: 'bassPluck', low: 33, pat: ['R:4 r:2 R:2 5:4 r:2 R:2', 'R:6 5:2 8:4 5:2 R:2'] },
        keys: { kind: 'stab', inst: 'marimba', low: 58, len: 2, rhythm: ['x..x..x.x..x..x.', 'x..x..x...x.x...'] },
        pad: { kind: 'pad', inst: 'padSoft', low: 55 },
        bells: { kind: 'arp', inst: 'glock', low: 64, pat: 'r:4 5:2 8:2 r:4 10:2 8:2' },
        lead: {
          kind: 'lead', inst: 'trumpet',
          notes: bars(
            'G5:4 C6:4 E6:6 D6:2',
            'C6:4 F6:4 A6:6 G6:2',
            'F6:4 D6:4 A5:4 D6:4',
            'D6:4 G5:4 B5:4 D6:4',
            'E6:2 D6:2 C6:4 E6:2 G6:2 E6:4',
            'C6:4 E6:4 A6:4 G6:2 E6:2',
            'A5:4 C6:4 F6:4 E6:2 D6:2',
            'D6:4 B5:4 G5:8',
          ),
        },
      },
    },
    {
      bars: 8,
      chords: ['C', 'G|Am', 'F', 'G', 'Am', 'F', 'G', 'C'],
      drums: {
        kick: ['x.......x.x.....', 'x.......x.......'],
        snare: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        clap: '....x.......x...',
        ohat: '..............x.',
        fill: { snare: '....x...x.x.xxxx' },
      },
      layers: {
        bass: { inst: 'bassPluck', low: 33, pat: ['R:4 r:2 R:2 5:4 r:2 R:2', 'R:6 5:2 8:4 5:2 R:2'] },
        keys: { kind: 'stab', inst: 'marimba', low: 58, len: 2, rhythm: ['x..x..x.x..x..x.', 'x..x..x...x.x...'] },
        pad: { kind: 'pad', inst: 'padSoft', low: 55 },
        bells: { kind: 'arp', inst: 'glock', low: 64, pat: '5:2 8:2 10:2 8:2 5:2 8:2 12:2 8:2' },
        lead: {
          kind: 'lead', inst: 'trumpet',
          notes: bars(
            'E6:4 G6:4 C6:8',
            'D6:4 G6:2 B5:2 C6:4 E6:4',
            'F6:4 A5:4 C6:4 F6:4',
            'G6:4 D6:4 B5:4 D6:4',
            'C6:4 E6:4 A6:4 E6:4',
            'F6:4 C6:4 A5:4 C6:4',
            'D6:4 G6:4 B5:2 D6:2 G6:4',
            'E6:2 D6:2 C6:2 E6:2 G6:4 C6:4',
          ),
        },
      },
    },
  ],
};

// ==================================================================================================
// VICTORY — brass fanfare (plays once) then a jubilant groove, 126 BPM, C major
// ==================================================================================================
const victory = {
  bpm: 126,
  swing: 0.08,
  gain: 0.85,
  loopFrom: 1,
  mix: {
    drums: { vol: 0.8, rev: 0.08 },
    bass: { vol: 0.9 },
    horns: { vol: 0.4, rev: 0.18, pan: -0.2 },
    keys: { vol: 0.34, rev: 0.2, pan: 0.2 },
    pad: { vol: 0.28, rev: 0.3 },
    lead: { vol: 0.52, rev: 0.24 },
    bells: { vol: 0.26, rev: 0.34, pan: 0.25 },
  },
  parts: [
    {
      bars: 2,
      once: true,
      chords: ['C', 'F|G'],
      drums: {
        kick: ['x.......x.......', 'x...x...x.x.x...'],
        snare: ['................', '....x...x.x.xxxx'],
        crash: ['x...............', '................'],
      },
      layers: {
        horns: { kind: 'stab', inst: 'brass', low: 55, len: 3, rhythm: ['x..x..x.x.......', 'x...x...x.......'], opts: { cutoff: 2800 } },
        bass: { inst: 'bassSub', low: 33, pat: ['R:6 R:2 5:4 R:4', 'R:8 R:8'] },
        lead: {
          kind: 'lead', inst: 'trumpet',
          notes: bars('C5:2 E5:2 G5:2 C6:4 r:2 G5:2 C6:2', 'F6:4 E6:2 D6:2 G6:8'),
        },
      },
    },
    {
      bars: 8,
      chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm', 'G'],
      drums: {
        kick: ['x.....x.x.......', 'x.....x.x.x.....'],
        snare: '....x.......x...',
        clap: '....x.......x...',
        hat: 'x.x.x.x.x.x.x.x.',
        ohat: '..............x.',
        fill: { snare: '....x...x.x.xxxx', crash: 'x...............' },
        crash: '................',
      },
      layers: {
        bass: { inst: 'bassFunk', low: 33, pat: ['R:3 r:1 R:2 8:1 r:1 5:2 R:2 R:2 r:2', 'R:2 R:1 r:1 5:2 R:2 8:1 r:1 5:2 3:2 r:2'] },
        keys: { kind: 'stab', inst: 'marimba', low: 58, len: 2, rhythm: ['x..x..x...x.x...', 'x..x..x..x..x.x.'] },
        horns: { kind: 'stab', inst: 'brass', low: 55, len: 2, rhythm: ['x.......x.......', 'x..x..x.x.......'], opts: { cutoff: 2600 } },
        pad: { kind: 'pad', inst: 'padSoft', low: 55 },
        bells: { kind: 'arp', inst: 'glock', low: 64, pat: '5:2 8:2 10:2 8:2 5:2 8:2 12:2 8:2' },
        lead: {
          kind: 'lead', inst: 'trumpet',
          notes: bars(
            'E6:2 E6:2 G6:4 E6:2 C6:2 E6:4',
            'E6:2 E6:2 A6:4 E6:2 C6:2 A5:4',
            'F6:2 F6:2 A6:4 F6:2 C6:2 F6:4',
            'D6:2 D6:2 G6:4 D6:2 B5:2 D6:2 G5:2',
            'G6:4 E6:2 C6:2 E6:2 G6:2 E6:2 C6:2',
            'A6:4 E6:2 C6:2 A5:2 C6:2 E6:4',
            'D6:4 F6:2 A6:2 F6:2 D6:2 A5:4',
            'G5:2 B5:2 D6:2 G6:2 F6:4 D6:2 B5:2',
          ),
        },
      },
    },
  ],
};

// ==================================================================================================
// STAR — frantic invincibility loop, 176 BPM, C major with secondary dominants
// ==================================================================================================
const star = {
  bpm: 176,
  swing: 0,
  gain: 0.94,
  mix: {
    drums: { vol: 0.85, rev: 0.06 },
    bass: { vol: 0.8, duck: 0.25 },
    arp: { vol: 0.34, rev: 0.16, duck: 0.35, pan: 0.25 },
    pad: { vol: 0.22, rev: 0.25, duck: 0.5 },
    lead: { vol: 0.45, rev: 0.2 },
    bells: { vol: 0.28, rev: 0.3, pan: -0.25 },
  },
  parts: [
    {
      bars: 8,
      chords: ['C', 'A7', 'Dm', 'G7', 'C', 'E7', 'F', 'G7'],
      drums: {
        kick: 'x...x...x...x...',
        snare: '....x.......x...',
        hat: 'xxxxxxxxxxxxxxxx',
        ohat: '..x...x...x...x.',
        tamb: 'x.x.x.x.x.x.x.x.',
        fill: { snare: '....x...x.x.xxxx', crash: 'x...............' },
        crash: '................',
      },
      layers: {
        bass: { inst: 'bassSaw', low: 36, pat: ['R:2 R:2 5:2 R:2 R:2 R:2 5:2 3:2', 'R:2 R+:2 R:2 5:2 R:2 R+:2 5:2 R:2'] },
        arp: { kind: 'arp', inst: 'pluckSaw', low: 72, pat: 'R:1 3:1 5:1 8:1 5:1 3:1 5:1 8:1 R:1 3:1 5:1 8:1 10:1 8:1 5:1 3:1' },
        pad: { kind: 'pad', inst: 'pad', low: 55, opts: { cutoff: 1800 } },
        bells: { kind: 'arp', inst: 'glock', low: 68, pat: '5:1 r:1 8:1 r:1 10:1 r:1 8:1 r:1 5:1 r:1 8:1 r:1 12:1 r:1 10:1 r:1' },
        lead: {
          kind: 'lead', inst: 'pulse12',
          notes: bars(
            'E5:1 G5:1 C6:1 E6:1 G6:2 E6:2 C6:1 E6:1 G6:1 E6:1 C6:2 r:2',
            'E5:1 A5:1 C#6:1 E6:1 A6:2 E6:2 C#6:1 E6:1 A6:1 E6:1 C#6:2 r:2',
            'F5:1 A5:1 D6:1 F6:1 A6:2 F6:2 D6:1 F6:1 A6:1 F6:1 D6:2 r:2',
            'D5:1 G5:1 B5:1 D6:1 G6:2 D6:2 B5:1 D6:1 G6:1 D6:1 B5:2 r:2',
            'G5:2 E6:2 G5:2 E6:2 C6:2 G6:2 E6:2 C6:2',
            'G#5:2 E6:2 G#5:2 E6:2 B5:2 G#6:2 E6:2 B5:2',
            'A5:2 F6:2 A5:2 F6:2 C6:2 A6:2 F6:2 C6:2',
            'B5:2 D6:2 G6:2 D6:2 F6:2 D6:2 B5:2 G5:2',
          ),
        },
      },
    },
  ],
};

export const SONGS = { menu, meadow, canyon, glacier, neon, results, victory, star };

/** Songs keyed by the track ids (music per race = game.track.id). */
export const TRACK_MUSIC = ['meadow', 'canyon', 'glacier', 'neon'];
