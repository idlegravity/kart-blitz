/**
 * Neon Skyway world: an elevated glowing highway over the void with a figure-eight crossover, a dense
 * city skyline with emissive procedural windows (instanced), neon rails (with deliberate rail-less
 * stretches), light gates, billboards and light pillars. Tuned for bloom (emissive >= 2). OWNER: World agent.
 */
import * as THREE from 'three';
import { fbm, smooth, hash2 } from '../noise.js';
import { buildWalls } from '../walls.js';
import { InstanceSet } from '../scatter.js';
import { GeoBuilder, rgb } from '../geo.js';
import { buildGantry } from '../landmarks.js';
import { makeCanvas, canvasTexture } from '../textures.js';
import { turnArrowList } from './common.js';
import { buildAmbient } from '../ambient.js';

const tint = (r, g, b) => new THREE.Color().setRGB(r, g, b);

// --------------------------------------------------------------------------------------------- materials
function cityMaterial(mats) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.06, color: 0xffffff });
  mat.customProgramCacheKey = () => 'kb-city';
  const time = mats.time;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWP; varying vec3 vWN; varying vec3 vLoc; varying vec2 vTB;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  mat4 im = instanceMatrix;
  vec4 wp = modelMatrix * im * vec4(transformed, 1.0);
  vWP = wp.xyz;
  vWN = normalize(mat3(modelMatrix) * mat3(im) * objectNormal);
  vLoc = transformed;
  vTB = vec2(im[3][1], im[3][1] + im[1][1]);
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
varying vec3 vWP; varying vec3 vWN; varying vec3 vLoc; varying vec2 vTB;
vec3 cityEmis = vec3(0.0);
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 N = normalize(vWN);
  float seed = vColor.r * 97.0 + vColor.g * 13.0;
  diffuseColor.rgb = vec3(0.014, 0.015, 0.034) * (0.6 + 0.9 * vColor.b);
  float vert = step(0.5, max(abs(N.x), abs(N.z)));
  float along = abs(N.x) > 0.5 ? vWP.z : vWP.x;
  float lc = abs(N.x) > 0.5 ? vLoc.z : vLoc.x;
  vec2 cell = vec2(along / 3.4, vWP.y / 3.9);
  vec2 cid = floor(cell), cf = fract(cell);
  float win = step(0.16, cf.x) * step(cf.x, 0.84) * step(0.2, cf.y) * step(cf.y, 0.8);
  float edgeM = smoothstep(0.03, 0.07, 0.5 - abs(lc));
  float rnd = h21(cid + seed);
  float rowLit = h21(vec2(cid.y, seed + 1.7));
  float lit = step(0.50, rnd) * (0.25 + 0.75 * step(0.3, rowLit));
  vec3 wc = mix(vec3(1.0, 0.80, 0.46), vec3(0.22, 0.85, 1.0), step(0.86, h21(cid + seed + 3.0)));
  wc = mix(wc, vec3(1.0, 0.22, 0.8), step(0.94, h21(cid + seed + 7.0)));
  float flick = 0.86 + 0.14 * sin(uTime * (0.8 + rnd * 3.0) + rnd * 40.0);
  float inside = step(vWP.y, vTB.y - 1.2) * step(vTB.x + 2.0, vWP.y);
  cityEmis = wc * lit * win * vert * edgeM * 1.85 * flick * inside;
  float roof = step(0.5, N.y);
  float rim = step(0.45, max(abs(vLoc.x), abs(vLoc.z)));
  vec3 trim = mix(vec3(0.15, 0.85, 1.0), vec3(1.0, 0.18, 0.78), step(0.5, h21(vec2(seed, 5.0)))) * 2.6;
  cityEmis += trim * roof * rim;
  // faint vertical sheen on the glass
  cityEmis += vec3(0.05, 0.08, 0.16) * vert * (0.5 + 0.5 * sin(along * 0.3 + seed));
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += cityEmis;`);
  };
  return mats.add(mat);
}

function billboardTexture(text, colA, colB, sub = '') {
  const w = 1024, h = 512;
  const c = makeCanvas(w, h);
  const draw = () => {
    const g = c.getContext('2d');
    g.fillStyle = '#05040f';
    g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, colA);
    grd.addColorStop(1, colB);
    g.strokeStyle = grd;
    g.lineWidth = 18;
    g.strokeRect(24, 24, w - 48, h - 48);
    g.lineWidth = 5;
    g.strokeRect(50, 50, w - 100, h - 100);
    let size = 210;
    g.font = `${size}px 'Lilita One', 'Arial Black', Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    while (g.measureText(text).width > w - 200 && size > 60) { size -= 8; g.font = `${size}px 'Lilita One', 'Arial Black', Impact, sans-serif`; }
    g.shadowColor = colA;
    g.shadowBlur = 40;
    g.fillStyle = grd;
    g.fillText(text, w / 2, sub ? h * 0.44 : h / 2);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.85;
    g.fillText(text, w / 2, sub ? h * 0.44 : h / 2);
    g.globalAlpha = 1;
    if (sub) {
      g.font = "64px 'Lilita One', 'Arial Black', Impact, sans-serif";
      g.fillStyle = colB;
      g.shadowColor = colB;
      g.shadowBlur = 24;
      g.fillText(sub, w / 2, h * 0.78);
      g.shadowBlur = 0;
    }
  };
  draw();
  const tex = canvasTexture(c, { aniso: 8 });
  try {
    document.fonts?.load("100px 'Lilita One'").then(() => { draw(); tex.needsUpdate = true; }).catch(() => {});
  } catch {}
  return tex;
}

export default {
  terrain() {
    return null; // no ground: the highway floats over the void (city floor is a far-below plane)
  },

  road(track, mats) {
    return {
      edgeStyle: 'neon', neonLeft: '#22e6ff', neonRight: '#ff2ee6',
      center: 'dash', centerColor: '#8f86ff',
      curbs: false,
      deck: { thickness: 2.7, color: '#2a2c48', underColor: '#0d0e1d' },
      shoulderMat: mats.vcolor({ color: 0x24243c, roughness: 0.5, metalness: 0.3 }),
      turnArrows: turnArrowList(track.cl, 70, 30), arrowColor: '#ffe45c', rampGlow: 1.1,
    };
  },

  build(track, ctx) {
    const { mats, density } = ctx;
    const def = track.def;
    const seed = def.seed ?? 1;
    const cl = track.cl;
    const b = track.bounds;
    const L = cl.length;
    const rf = track.roadField;
    const cityY = track.killY - 34;
    track.cityY = cityY;

    buildWalls(track, ctx);
    buildGantry(track, ctx, { color: '#151934', trim: '#232a66', sign: { top: '#6a1fff', bottom: '#12084a' } });

    // ---------------------------------------------------------------- the city floor (glowing street grid, far below)
    {
      const g = new THREE.PlaneGeometry(9000, 9000, 1, 1);
      g.rotateX(-Math.PI / 2);
      g.translate((b.minX + b.maxX) / 2, cityY, (b.minZ + b.maxZ) / 2);
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      const tm = mats.terrain('neon');
      const m = new THREE.Mesh(g, tm);
      m.receiveShadow = false;
      m.name = 'city-floor';
      track.group.add(m);
    }

    // ---------------------------------------------------------------- skyline (instanced emissive-window boxes)
    {
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, 0.5, 0);
      const city = new InstanceSet(track, box, cityMaterial(mats), { chunk: 260, cull: 2600, cast: false, name: 'skyline' });
      const strips = new InstanceSet(track, (() => {
        const g = new THREE.BoxGeometry(1, 1, 1);
        g.translate(0, 0.5, 0);
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        return g;
      })(), mats.glow(2.8, { roughness: 0.5 }), { chunk: 300, cull: 1800, name: 'neon-strips' });
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const P = { i0: 0, u: 0, s: 0, d: 0, l: 0, fx: 0, fz: 0, y: 0 };
      const cellSize = 64;
      const R = 760;
      const palette = [tint(0.15, 0.9, 1), tint(1, 0.2, 0.85), tint(1, 0.85, 0.25), tint(0.6, 0.35, 1), tint(0.2, 1, 0.55)];
      let count = 0;
      for (let gz = -R; gz <= R; gz += cellSize) {
        for (let gx = -R; gx <= R; gx += cellSize) {
          const r0 = hash2(gx / cellSize + 40, gz / cellSize + 40, seed);
          if (r0 > 0.9 * Math.min(1, 0.55 + density * 0.45)) continue;
          const x = cx + gx + (hash2(gx, gz, seed + 1) - 0.5) * cellSize * 0.55;
          const z = cz + gz + (hash2(gx, gz, seed + 2) - 0.5) * cellSize * 0.55;
          const dc = Math.hypot(x - cx, z - cz);
          const w = 20 + hash2(gx, gz, seed + 3) * 26, d = 20 + hash2(gx, gz, seed + 4) * 26;
          const tall = Math.pow(hash2(gx, gz, seed + 5), 1.7);
          let h = 46 + tall * 210 + smooth(300, 800, dc) * 120 * hash2(gx, gz, seed + 6) + fbm(x * 0.004, z * 0.004, 2, seed) * 30;
          const top = cityY + h;
          const half = Math.hypot(w, d) / 2;
          const has = rf.project(x, z, 90, P);
          if (has) {
            const roadY = P.y;
            const need = top > roadY - 4 ? cl.hw[P.i0] + 15 + half : cl.hw[P.i0] + 3 + half;
            if (P.d < need) {
              if (P.d < cl.hw[P.i0] + 3 + half) continue;
              h = roadY - 6 - cityY; // squat building fits under the deck
            }
            if (P.d < 34 + half && top > roadY - 4) continue;
          }
          const yaw = hash2(gx, gz, seed + 7) < 0.25 ? 0.4 * (hash2(gx, gz, seed + 8) - 0.5) : 0;
          const key = tint(hash2(gx, gz, seed + 9), hash2(gx, gz, seed + 10), hash2(gx, gz, seed + 11));
          city.add(x, cityY - 6, z, yaw, w, h + 6, d, key);
          count++;
          // neon vertical strips on a few towers
          if (h > 90 && hash2(gx, gz, seed + 12) > 0.55) {
            const c = palette[Math.floor(hash2(gx, gz, seed + 13) * palette.length)];
            const sh = h * (0.4 + hash2(gx, gz, seed + 14) * 0.5);
            const fx = Math.cos(yaw), fz = Math.sin(yaw);
            for (const sx of [-1, 1]) strips.add(x + fx * sx * (w / 2 + 0.15), cityY + h * 0.08, z + fz * -sx * (w / 2 + 0.15), yaw, 0.9, sh, 0.9, c);
          }
          if (h > 150) strips.add(x, cityY + h, z, yaw, 1.4, 14 + hash2(gx, gz, seed + 15) * 20, 1.4, tint(1, 0.15, 0.2)); // aviation beacon mast
        }
      }
      city.build();
      strips.build();
      track.cityCount = count;
    }

    // ---------------------------------------------------------------- pillars holding the deck up
    {
      const geo = new THREE.CylinderGeometry(1.7, 2.3, 1, 12, 1, true);
      geo.translate(0, 0.5, 0);
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
      const pillars = new InstanceSet(track, geo, mats.vcolor({ color: 0x1b1d38, roughness: 0.5, metalness: 0.35 }), { chunk: 300, cull: 900, cast: true, name: 'pillars' });
      const cap = new THREE.BoxGeometry(1, 1, 1);
      cap.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap.attributes.position.count * 3).fill(1), 3));
      const caps = new InstanceSet(track, cap, mats.vcolor({ color: 0x24264a, roughness: 0.5, metalness: 0.35 }), { chunk: 300, cull: 900, cast: true, name: 'pier-caps' });
      const P = { i0: 0, u: 0, s: 0, d: 0, l: 0, fx: 0, fz: 0, y: 0 };
      for (let s = 20; s < L; s += 44) {
        const idx = cl.indexAt(s);
        if (cl.gap[idx]) continue;
        const c = cl.sample(s, {});
        // skip if another stretch of road passes near this footprint (the crossover)
        let clash = false;
        for (let i = 0; i < cl.N; i += 3) {
          const ds = Math.abs(((i * cl.ds - s + L * 1.5) % L) - L * 0.5);
          if (ds < 45) continue;
          if (Math.hypot(cl.px[i] - c.px, cl.pz[i] - c.pz) < c.hw + 6) { clash = true; break; }
        }
        if (clash) continue;
        const top = c.py - 2.7;
        const hgt = top - cityY;
        pillars.add(c.px, cityY - 4, c.pz, 0, 1, hgt + 4, 1);
        const yaw = Math.atan2(cl.hx[idx], cl.hz[idx]);
        caps.add(c.px, top - 0.9, c.pz, yaw, c.hw * 1.5, 1.4, 3.8);
      }
      pillars.build();
      caps.build();
    }

    // ---------------------------------------------------------------- underglow along the deck edges
    {
      const gbA = new GeoBuilder(), gbB = new GeoBuilder();
      const tmp = {};
      for (const [gb, side] of [[gbA, -1], [gbB, 1]]) {
        let prev = null;
        for (let i = 0; i <= cl.N; i++) {
          const k = i % cl.N;
          if (cl.gap[k]) { prev = null; continue; }
          const l = side * (side < 0 ? cl.outerL[k] : cl.outerR[k]);
          const x = cl.px[k] + cl.rx[k] * l, z = cl.pz[k] + cl.rz[k] * l, y0 = cl.py[k] - l * cl.tanB[k] - 2.55;
          const nx = side * cl.rx[k] * 0.6, nz = side * cl.rz[k] * 0.6;
          const a = gb.v(x + nx * 0.02, y0, z + nz * 0.02, side * cl.rx[k], 0, side * cl.rz[k]);
          const c = gb.v(x + nx * 0.02, y0 + 0.5, z + nz * 0.02, side * cl.rx[k], 0, side * cl.rz[k]);
          const row = [a, c];
          if (prev) { gb.quad(prev[0], row[0], row[1], prev[1]); gb.quad(prev[0], prev[1], row[1], row[0]); }
          prev = row;
        }
      }
      track.addMesh(gbA.build(), mats.emissive('#22e6ff', 3.6, { params: { side: THREE.DoubleSide } }), { receive: false, name: 'underglowA' });
      track.addMesh(gbB.build(), mats.emissive('#ff2ee6', 3.6, { params: { side: THREE.DoubleSide } }), { receive: false, name: 'underglowB' });
    }

    // ---------------------------------------------------------------- hazard glow along the deck edges at each jump gap
    {
      const gb = new GeoBuilder();
      const amber = [1, 1, 1];
      for (const g of cl.gaps) {
        for (const [idx, dir] of [[g.i0, 1], [g.i1, -1]]) {
          const k = idx % cl.N;
          const hw = cl.hw[k];
          const yaw = Math.atan2(cl.hx[k], cl.hz[k]);
          const x = cl.px[k], z = cl.pz[k], y = cl.py[k];
          gb.box(x - cl.hx[k] * dir * 0.2, y + 0.12, z - cl.hz[k] * dir * 0.2, hw * 2, 0.24, 0.4, amber, yaw);
        }
      }
      if (gb.count) track.addMesh(gb.build(), mats.emissive('#ff7a1a', 4.2), { receive: false, name: 'gap-edge-glow' });
    }

    // ---------------------------------------------------------------- light gates (glowing arches over the road)
    {
      const gates = def.gates ?? [];
      const gbC = new GeoBuilder(), gbM = new GeoBuilder();
      const seg = 28;
      gates.forEach((g, gi) => {
        const c = cl.sample(g.s, {});
        const yaw = Math.atan2(cl.hx[cl.indexAt(g.s)], cl.hz[cl.indexAt(g.s)]);
        const gb = gi % 2 ? gbM : gbC;
        const Rg = c.hw + 3.6, tube = 0.42, rr = 6;
        // upper half-torus in the plane spanned by lateral (x) and up (y)
        const geo = new THREE.TorusGeometry(Rg, tube, rr, seg, Math.PI);
        const p = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index;
        const base = gb.count;
        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        for (let i = 0; i < p.count; i++) {
          const lx = p.getX(i), ly = p.getY(i), lz = p.getZ(i);
          const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
          gb.v(c.px + cosY * lx + sinY * lz, c.py + ly - 0.4, c.pz - sinY * lx + cosY * lz, cosY * nx + sinY * nz, ny, -sinY * nx + cosY * nz);
        }
        for (let i = 0; i < idx.count; i += 3) gb.tri(base + idx.getX(i), base + idx.getY(i), base + idx.getZ(i));
        // feet
        gb.box(c.px + cosY * Rg, c.py + 0.2, c.pz - sinY * Rg, 1.1, 1.0, 1.1, [1, 1, 1], yaw);
        gb.box(c.px - cosY * Rg, c.py + 0.2, c.pz + sinY * Rg, 1.1, 1.0, 1.1, [1, 1, 1], yaw);
      });
      if (gbC.count) track.addMesh(gbC.build(), mats.emissive('#22e6ff', 3.4, { params: { side: THREE.DoubleSide } }), { receive: false, name: 'gates-cyan' });
      if (gbM.count) track.addMesh(gbM.build(), mats.emissive('#ff2ee6', 3.4, { params: { side: THREE.DoubleSide } }), { receive: false, name: 'gates-magenta' });
    }

    // ---------------------------------------------------------------- billboards
    {
      const list = [
        ['KART BLITZ', '#22e6ff', '#ff2ee6', 'RACE THE SKYLINE'], ['NITRO', '#ffe45c', '#ff5a1f', 'FULL THROTTLE'],
        ['TURBO', '#ff2ee6', '#7a3cff', 'BOOST LANE'], ['NEON', '#22e6ff', '#2a6bff', 'SKYWAY'],
        ['BLITZ', '#7cff3a', '#22e6ff', 'GO GO GO'], ['SPEED', '#ff3b6b', '#ffe45c', 'NO LIMITS'],
      ];
      const geo = new THREE.PlaneGeometry(1, 0.5);
      const stations = def.billboards ?? [];
      stations.forEach((bb, i) => {
        const [text, a, bcol, sub] = list[i % list.length];
        const tex = mats.add(billboardTexture(text, a, bcol, sub));
        const mat = mats.add(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: true }));
        mat.color.setScalar(1.9);
        track.animators.push((dt, t) => {
          const f = Math.sin(t * 7.3 + i * 2.1) * Math.sin(t * 2.9 + i);
          mat.color.setScalar(1.75 + 0.22 * Math.sin(t * 2.2 + i) - (f > 0.93 ? 0.9 : 0));
        });
        const c = cl.sample(bb.s, {});
        const lat = bb.side * (c.hw + (bb.offset ?? 30));
        const x = c.px + c.rx * lat, z = c.pz + c.rz * lat, y = c.py - lat * c.tanB + (bb.up ?? 16);
        const m = new THREE.Mesh(geo, mat);
        m.scale.setScalar(bb.size ?? 26);
        m.position.set(x, y, z);
        // face the road
        m.rotation.y = Math.atan2(c.px - x, c.pz - z);
        m.name = 'billboard';
        track.group.add(m);
        // frame + posts
        const fr = new THREE.Mesh(new THREE.BoxGeometry((bb.size ?? 26) + 1.4, (bb.size ?? 26) * 0.5 + 1.4, 0.8), mats.vcolor({ color: 0x10122a, roughness: 0.5, metalness: 0.4 }));
        {
          const n = fr.geometry.attributes.position.count;
          fr.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        }
        fr.position.copy(m.position);
        fr.rotation.y = m.rotation.y;
        fr.translateZ(-0.6);
        track.group.add(fr);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, y - cityY, 8), mats.vcolor({ color: 0x1b1d38, roughness: 0.5, metalness: 0.3 }));
        post.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(post.geometry.attributes.position.count * 3).fill(1), 3));
        post.position.set(x, cityY + (y - cityY) / 2, z);
        track.group.add(post);
      });
    }

    // ---------------------------------------------------------------- light pillars (additive beams)
    {
      const N = Math.round(16 * Math.max(0.6, density));
      const gb = new GeoBuilder();
      const cols = [rgb('#22e6ff'), rgb('#ff2ee6'), rgb('#ffe45c'), rgb('#7a3cff'), rgb('#2aff9a')];
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const P = { i0: 0, u: 0, s: 0, d: 0, l: 0, fx: 0, fz: 0, y: 0 };
      let placed = 0;
      for (let k = 0; k < 200 && placed < N; k++) {
        const a = hash2(k, 1, seed + 50) * 6.283, r = 60 + hash2(k, 2, seed + 50) * 520;
        const x = cx + Math.cos(a) * r * 1.1, z = cz + Math.sin(a) * r * 0.8;
        if (rf.project(x, z, 60, P) && P.d < 45) continue;
        const col = cols[placed % cols.length];
        const h = 260 + hash2(k, 3, seed + 50) * 260, rad = 2 + hash2(k, 4, seed + 50) * 2.2;
        const cyl = new THREE.CylinderGeometry(rad, rad * 1.15, h, 14, 1, true);
        cyl.translate(x, cityY + h / 2 - 10, z);
        const pos = cyl.attributes.position, cc = [];
        for (let i = 0; i < pos.count; i++) {
          const t = (pos.getY(i) - (cityY - 10)) / h;
          cc.push(col[0] * (1 - t * 0.85), col[1] * (1 - t * 0.85), col[2] * (1 - t * 0.85));
        }
        cyl.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cc), 3));
        gb.pos.push(...cyl.attributes.position.array);
        gb.nor.push(...cyl.attributes.normal.array);
        gb.col.push(...cyl.attributes.color.array);
        gb.uv.push(...cyl.attributes.uv.array);
        const base = gb.count;
        for (let i = 0; i < cyl.index.count; i++) gb.idx.push(base + cyl.index.getX(i));
        gb.count += cyl.attributes.position.count;
        placed++;
      }
      const g = gb.build();
      const mat = mats.add(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
      mat.color.setScalar(2.4);
      const m = track.addMesh(g, mat, { receive: false, name: 'light-pillars' });
      m.renderOrder = 6;
      track.animators.push((dt, t) => { mat.opacity = 0.5 + 0.1 * Math.sin(t * 0.8); });
    }

    // ---------------------------------------------------------------- giant rotating holo-rings + sweeping searchlights on the horizon
    {
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const ringMat = (hex) => mats.emissive(hex, 3.0, { params: { side: THREE.DoubleSide } });
      const specs = [
        { a: 0.5, r: 640, y: cityY + 330, R: 70, t: 2.2, hex: '#22e6ff', axis: [1, 0, 0], sp: 0.35 },
        { a: 2.2, r: 720, y: cityY + 380, R: 96, t: 2.6, hex: '#ff2ee6', axis: [0, 0, 1], sp: -0.28 },
        { a: 3.9, r: 600, y: cityY + 300, R: 60, t: 2.0, hex: '#ffe45c', axis: [1, 0, 1], sp: 0.42 },
        { a: 5.3, r: 760, y: cityY + 420, R: 110, t: 3.0, hex: '#7a3cff', axis: [1, 0, 0], sp: -0.22 },
      ];
      const rings = specs.map((sp) => {
        const g = new THREE.TorusGeometry(sp.R, sp.t, 8, 56);
        const m = new THREE.Mesh(g, ringMat(sp.hex));
        m.position.set(cx + Math.cos(sp.a) * sp.r, sp.y, cz + Math.sin(sp.a) * sp.r * 0.85);
        m.lookAt(cx, sp.y, cz);
        m.name = 'holo-ring';
        m.frustumCulled = true;
        track.group.add(m);
        // inner concentric ring for a gyroscope look
        const g2 = new THREE.TorusGeometry(sp.R * 0.66, sp.t * 0.6, 6, 44);
        const m2 = new THREE.Mesh(g2, ringMat(sp.hex));
        m.add(m2);
        return { m, m2, sp };
      });
      const ax = new THREE.Vector3();
      track.animators.push((dt, t) => {
        for (const r of rings) {
          ax.set(...r.sp.axis).normalize();
          r.m.rotateOnAxis(ax, r.sp.sp * dt);
          r.m2.rotation.z = t * -r.sp.sp * 2.2;
          r.m2.rotation.x = t * r.sp.sp * 1.3;
        }
      });
      // searchlights: additive cones rotating around their base
      const beamGeo = new THREE.ConeGeometry(16, 900, 20, 1, true);
      beamGeo.translate(0, -450, 0); // apex at the origin, opening downward; flipped below so it opens upward
      beamGeo.rotateX(Math.PI);
      const beamCols = ['#7ee8ff', '#ff8af0', '#fff0a0', '#9a7cff'];
      const beams = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4, r = 320 + hash2(i, 9, 90) * 260;
        const col = new THREE.Color(beamCols[i % beamCols.length]);
        const mat = mats.add(new THREE.MeshBasicMaterial({ color: col.multiplyScalar(1.6), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }));
        const m = new THREE.Mesh(beamGeo, mat);
        m.position.set(cx + Math.cos(a) * r, cityY + 20 + hash2(i, 4, 90) * 30, cz + Math.sin(a) * r * 0.8);
        m.renderOrder = 6;
        m.name = 'searchlight';
        track.group.add(m);
        beams.push({ m, ph: hash2(i, 1, 90) * 6.28, sp: (0.25 + hash2(i, 2, 90) * 0.25) * (i % 2 ? 1 : -1) });
      }
      track.animators.push((dt, t) => {
        for (const bm of beams) {
          bm.m.rotation.set(Math.sin(t * bm.sp + bm.ph) * 0.42, 0, Math.cos(t * bm.sp * 0.8 + bm.ph) * 0.42);
        }
      });
    }

    // ---------------------------------------------------------------- drifting neon sparks
    buildAmbient(track, ctx, { count: 700, box: [80, 40, 80], size: 3.4, color: '#7ee8ff', intensity: 2.6, vel: [0.6, 1.4, 0.3], wobble: 1.4, alpha: 0.7, additive: true, twinkle: 0.7, sizeClamp: [1.2, 8], name: 'sparks' });

    // ---------------------------------------------------------------- hover-traffic: glowing streaks orbiting the skyline
    {
      const n = Math.round(70 * Math.max(0.5, density));
      const g = new THREE.BoxGeometry(1, 1, 1);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      const im = new THREE.InstancedMesh(g, mats.glow(3.2, { roughness: 0.5 }), n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.name = 'hover-traffic';
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const cols = [tint(0.2, 0.9, 1), tint(1, 0.2, 0.85), tint(1, 0.8, 0.25), tint(0.6, 0.4, 1), tint(1, 0.35, 0.2)];
      const cars = [];
      for (let i = 0; i < n; i++) {
        const lane = i % 5;
        cars.push({
          a0: hash2(i, 1, 60) * 6.283,
          rx: 260 + lane * 70 + hash2(i, 2, 60) * 30,
          rz: 180 + lane * 55 + hash2(i, 3, 60) * 24,
          y: cityY + 90 + lane * 26 + hash2(i, 4, 60) * 18,
          sp: (0.055 + hash2(i, 5, 60) * 0.04) * (lane % 2 ? -1 : 1) * (0.6 + 0.12 * (5 - lane)),
          len: 3.2 + hash2(i, 6, 60) * 3,
        });
        im.setColorAt(i, cols[Math.floor(hash2(i, 7, 60) * cols.length)]);
      }
      im.instanceColor.needsUpdate = true;
      track.group.add(im);
      const q = new THREE.Quaternion(), m4 = new THREE.Matrix4(), pp = new THREE.Vector3(), sc = new THREE.Vector3(), ax = new THREE.Vector3(0, 1, 0);
      track.animators.push((dt, t) => {
        for (let i = 0; i < n; i++) {
          const c = cars[i];
          const a = c.a0 + t * c.sp;
          pp.set(cx + Math.cos(a) * c.rx, c.y + Math.sin(t * 0.5 + i) * 1.5, cz + Math.sin(a) * c.rz);
          const yaw = Math.atan2(-Math.sin(a) * c.rx * Math.sign(c.sp), Math.cos(a) * c.rz * Math.sign(c.sp));
          q.setFromAxisAngle(ax, yaw);
          m4.compose(pp, q, sc.set(c.len * 1.5, 0.75, 1.5));
          im.setMatrixAt(i, m4);
        }
        im.instanceMatrix.needsUpdate = true;
      });
    }
  },
};
