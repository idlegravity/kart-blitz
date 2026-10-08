/**
 * AI debugging helpers (dev only). Load from a snap with:
 *   --eval="import('/dev/gameplay/aidebug.js').then(m => m.start())"
 *   --actions="...;eval:__aidbg.plot();shot:snaps/gameplay/line.png"
 *   --probe="__aidbg.report()"
 * start() records per-kart statistics from the game's events; plot() draws the track, the racing line
 * (coloured by curvature), corners, pads/ramps/boxes, kart traces and current positions on a full-window overlay.
 */
const G = () => window.__game;

const state = {
  offs: [],
  stats: new Map(),
  traces: new Map(),
  t: 0,
  lastTrace: 0,
  raf: 0,
  log: [],
};

function st(kart) {
  let s = state.stats.get(kart);
  if (!s) {
    s = { name: kart.name, driftStart: 0, driftEnd: 0, mini: [0, 0, 0, 0], walls: 0, wallImpact: 0, hitsTaken: 0, hitTypes: {}, itemsGot: {}, itemsUsed: {}, stalls: 0, respawns: 0, falls: 0, boosts: {}, laps: [], maxSpeed: 0, offroadT: 0, wrongWay: 0 };
    state.stats.set(kart, s);
  }
  return s;
}

export function start() {
  stop();
  const g = G();
  const on = (n, fn) => state.offs.push(g.events.on(n, fn));
  on('kart:driftStart', ({ kart }) => st(kart).driftStart++);
  on('kart:driftEnd', ({ kart, level }) => {
    const s = st(kart);
    s.driftEnd++;
    s.mini[level]++;
  });
  on('kart:wall', ({ kart, impact }) => {
    const s = st(kart);
    s.walls++;
    s.wallImpact += impact;
  });
  on('kart:hit', ({ kart, type, source }) => {
    const s = st(kart);
    s.hitsTaken++;
    s.hitTypes[type] = (s.hitTypes[type] || 0) + 1;
    state.log.push(`${g.race.time.toFixed(1)} ${kart.name} hit ${type} by ${source?.name ?? '-'}`);
  });
  on('item:get', ({ kart, item }) => {
    const s = st(kart);
    s.itemsGot[item] = (s.itemsGot[item] || 0) + 1;
  });
  on('item:use', ({ kart, item }) => {
    const s = st(kart);
    s.itemsUsed[item] = (s.itemsUsed[item] || 0) + 1;
    state.log.push(`${g.race.time.toFixed(1)} ${kart.name} uses ${item}`);
  });
  on('kart:stall', ({ kart }) => st(kart).stalls++);
  on('kart:bump', ({ a, b }) => {
    st(a).bumps = (st(a).bumps || 0) + 1;
    st(b).bumps = (st(b).bumps || 0) + 1;
    // geometry of the contact in a's frame: rear-end (long) vs side (lat)
    const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
    const ds = dx * a.forward.x + dz * a.forward.z, dl = dx * a.right.x + dz * a.right.z;
    const kind = Math.abs(ds) > Math.abs(dl) * 1.3 ? 'rear' : 'side';
    (state.bumpKinds ||= { rear: 0, side: 0 })[kind]++;
    const g2 = G();
    const where = g2.track.deltaS(0, a.trackS);
    (state.bumpS ||= []).push(Math.round(((where % g2.track.length) + g2.track.length) % g2.track.length / 20) * 20);
  });
  on('race:place', ({ kart }) => (st(kart).placeChanges = (st(kart).placeChanges || 0) + 1));
  on('kart:fall', ({ kart }) => {
    st(kart).falls++;
    state.log.push(`${g.race.time.toFixed(1)} ${kart.name} FELL/respawn s=${kart.trackS.toFixed(0)} lat=${kart.lateral.toFixed(1)}`);
  });
  on('kart:boost', ({ kart, source }) => {
    const s = st(kart);
    s.boosts[source] = (s.boosts[source] || 0) + 1;
  });
  on('race:lap', ({ kart, lap, lapTime }) => st(kart).laps.push(+lapTime.toFixed(2)));
  on('race:finish', ({ kart, place, time }) => {
    state.log.push(`${g.race.time.toFixed(1)} FINISH ${kart.name} place ${place} time ${time.toFixed(2)}`);
    st(kart).finish = { place, time: +time.toFixed(2) };
  });
  const tick = () => {
    const gg = G();
    if (gg?.karts?.length) {
      const now = gg.race.time;
      for (const k of gg.karts) {
        const s = st(k);
        // speed when crossing the start of each ramp
        for (const r of gg.track.ramps ?? []) {
          const prev = k._dbgPrevS ?? k.trackS;
          if (gg.track.deltaS(prev, r.s) > 0 && gg.track.deltaS(k.trackS, r.s) <= 0 && gg.track.deltaS(prev, k.trackS) > 0) {
            (s.rampSpeeds ||= []).push(+k.speed.toFixed(1));
            (s.rampLat ||= []).push(+k.lateral.toFixed(1));
          }
        }
        k._dbgPrevS = k.trackS;
        s.maxSpeed = Math.max(s.maxSpeed, k.speed);
        if (k.surface === 'offroad') s.offroadT += 1 / 60;
        if (k.wrongWay) s.wrongWay += 1 / 60;
      }
      if (now - state.lastTrace > 0.2 && gg.race.phase !== 'countdown') {
        state.lastTrace = now;
        for (const k of gg.karts) {
          let tr = state.traces.get(k);
          if (!tr) state.traces.set(k, (tr = []));
          tr.push(k.position.x, k.position.z, k.drifting ? 1 : 0);
        }
      }
    }
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
  window.__aidbg = { report, plot, stop, state, log: () => state.log.slice(-60), bumps: () => ({ kinds: state.bumpKinds, hist: Object.entries((state.bumpS || []).reduce((h, s) => ((h[s] = (h[s] || 0) + 1), h), {})).sort((a, b) => b[1] - a[1]).slice(0, 12) }) };
  return 'aidebug started';
}

export function stop() {
  state.offs.forEach((o) => o());
  state.offs = [];
  cancelAnimationFrame(state.raf);
  state.stats.clear();
  state.traces.clear();
  state.log = [];
}

export function report() {
  const out = {};
  for (const [k, s] of state.stats) {
    out[s.name] = {
      place: k.place,
      lap: k.lap,
      finish: s.finish,
      laps: s.laps,
      drifts: s.driftStart,
      mini: s.mini.slice(1).join('/'),
      walls: s.walls,
      wallAvg: s.walls ? +(s.wallImpact / s.walls).toFixed(1) : 0,
      hits: s.hitsTaken,
      hitTypes: s.hitTypes,
      got: s.itemsGot,
      used: s.itemsUsed,
      stalls: s.stalls,
      falls: s.falls,
      boosts: s.boosts,
      vmax: +s.maxSpeed.toFixed(1),
      offroad: +s.offroadT.toFixed(1),
      wrongWay: +s.wrongWay.toFixed(1),
      rampSpeeds: s.rampSpeeds,
      rampLat: s.rampLat,
      bumps: s.bumps || 0,
      placeChanges: s.placeChanges || 0,
    };
  }
  return out;
}

const COLORS = ['#ff5a5a', '#ffd93b', '#ff8ad8', '#5fe36a', '#4fb5ff', '#b98cff', '#c98a5a', '#ffa030'];

/** Draw the track + line + karts on a full-window overlay canvas. */
export function plot(opts = {}) {
  const g = G();
  const track = g.track;
  const line = track._aiLine;
  let cv = document.getElementById('__aiplot');
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = '__aiplot';
    cv.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#0d1020;';
    document.body.appendChild(cv);
  }
  cv.width = innerWidth;
  cv.height = innerHeight;
  const c = cv.getContext('2d');
  // bounds
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  const N = line ? line.N : 0;
  const pts = [];
  for (let i = 0; i < track.length; i += 4) {
    const f = track.getFrameAt(i);
    pts.push([f.position.x, f.position.z, f.halfWidth]);
    minX = Math.min(minX, f.position.x);
    maxX = Math.max(maxX, f.position.x);
    minZ = Math.min(minZ, f.position.z);
    maxZ = Math.max(maxZ, f.position.z);
  }
  const pad = 40;
  const sc = Math.min((cv.width - pad * 2) / (maxX - minX), (cv.height - pad * 2) / (maxZ - minZ));
  const ox = (cv.width - (maxX - minX) * sc) / 2 - minX * sc;
  const oz = (cv.height - (maxZ - minZ) * sc) / 2 - minZ * sc;
  const X = (x) => x * sc + ox;
  const Z = (z) => cv.height - (z * sc + oz); // screen y up = +z... keep minimap convention flipped for readability
  c.clearRect(0, 0, cv.width, cv.height);
  // road ribbon
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = '#2c3350';
  c.lineWidth = 2 * 10 * sc;
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Z(p[1])) : c.moveTo(X(p[0]), Z(p[1]))));
  c.closePath();
  c.stroke();
  c.strokeStyle = '#3a4266';
  c.lineWidth = 1;
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Z(p[1])) : c.moveTo(X(p[0]), Z(p[1]))));
  c.closePath();
  c.stroke();
  if (line) {
    // racing line coloured by |curvature|
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const k = Math.min(1, Math.abs(line.curv[i]) / 0.04);
      c.strokeStyle = `hsl(${120 - 120 * k},90%,55%)`;
      c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(X(line.px[i]), Z(line.pz[i]));
      c.lineTo(X(line.px[j]), Z(line.pz[j]));
      c.stroke();
    }
    // corners
    c.font = '11px monospace';
    line.corners.forEach((cn, ci) => {
      const mid = (cn.i0 + Math.floor(cn.count / 2)) % N;
      c.fillStyle = cn.dir > 0 ? '#ff9f9f' : '#9fd0ff';
      c.fillText(`${ci}${cn.dir > 0 ? 'R' : 'L'} ${(cn.angle * 57.3) | 0}°`, X(line.cx[mid]) + 6, Z(line.cz[mid]) - 6);
    });
    // start marker
    c.fillStyle = '#fff';
    c.fillRect(X(line.cx[0]) - 4, Z(line.cz[0]) - 4, 8, 8);
  }
  // pads / ramps / boxes
  for (const p of track.boostPads ?? []) {
    const f = track.getFrameAt(p.s + p.length / 2);
    c.fillStyle = '#25e6ff';
    c.fillRect(X(f.position.x + f.right.x * p.lateral) - 4, Z(f.position.z + f.right.z * p.lateral) - 4, 8, 8);
  }
  for (const r of track.ramps ?? []) {
    const f = track.getFrameAt(r.s + r.length / 2);
    c.fillStyle = '#ff9a2b';
    c.fillRect(X(f.position.x + f.right.x * r.lateral) - 5, Z(f.position.z + f.right.z * r.lateral) - 5, 10, 10);
  }
  for (const b of g.items.boxes ?? []) {
    c.fillStyle = b.active ? '#ffe45c' : '#665c20';
    c.beginPath();
    c.arc(X(b.position.x), Z(b.position.z), 2.5, 0, 7);
    c.fill();
  }
  // hazards
  for (const h of g.items.hazards ?? []) {
    c.fillStyle = h.type === 'bomb' ? '#ff4040' : '#ffd93b';
    c.beginPath();
    c.arc(X(h.position.x), Z(h.position.z), 3, 0, 7);
    c.fill();
  }
  // traces (drifting segments in white)
  if (opts.traces !== false) {
    let idx = 0;
    for (const k of g.karts) {
      const tr = state.traces.get(k);
      if (tr && tr.length > 6) {
        c.lineWidth = 1.3;
        for (let i = 3; i < tr.length; i += 3) {
          c.strokeStyle = tr[i + 2] ? '#ffffff' : COLORS[idx % COLORS.length];
          c.globalAlpha = tr[i + 2] ? 0.95 : 0.55;
          c.beginPath();
          c.moveTo(X(tr[i - 3]), Z(tr[i - 2]));
          c.lineTo(X(tr[i]), Z(tr[i + 1]));
          c.stroke();
        }
        c.globalAlpha = 1;
      }
      idx++;
    }
  }
  // karts
  g.karts.forEach((k, i) => {
    c.fillStyle = COLORS[i % COLORS.length];
    c.beginPath();
    c.arc(X(k.position.x), Z(k.position.z), 5, 0, 7);
    c.fill();
    c.strokeStyle = '#000';
    c.stroke();
    c.fillStyle = '#fff';
    c.fillText(`${k.place}${k.name[0]}`, X(k.position.x) + 7, Z(k.position.z) + 4);
  });
  c.fillStyle = '#cde';
  c.font = '13px monospace';
  c.fillText(`${track.id}  L=${track.length.toFixed(0)}m  line N=${N}  corners=${line?.corners.length}  t=${g.race.time.toFixed(1)}`, 14, 22);
  return 'plotted';
}
