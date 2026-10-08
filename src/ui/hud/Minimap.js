/**
 * HUD minimap: the track outline from `game.track.minimap` ({ points:[x,z][], bounds }) drawn once to an
 * offscreen layer, plus kart dots (character colours) and a player heading arrow redrawn every frame.
 * Screen x = world x, screen y = world z.
 */
import { h } from '../dom.js';

const INK = '#0c0625';

export class Minimap {
  constructor(hud) {
    this.hud = hud;
    this.canvas = document.createElement('canvas');
    this.ctx2d = this.canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this.el = h('div.hud-map', this.canvas);
    this.size = 0;
    this.dpr = 1;
    this.track = null;
    this.karts = [];
    this.valid = false;
    this._k = 1;
    this._ox = 0;
    this._oy = 0;
    this._pad = 0;
    this._accum = 0;
  }

  setup(track, karts) {
    this.track = track;
    this.karts = karts;
    const mm = track?.minimap;
    this.valid = !!(mm && mm.points && mm.points.length > 2 && mm.bounds);
    this.el.style.display = this.valid ? '' : 'none';
    this._sizeKey = '';
    if (this.valid) this._prepare();
  }

  /** (Re)build the static layer when the on-screen size changed. */
  _prepare() {
    const rect = this.el.getBoundingClientRect();
    const css = Math.max(64, Math.round(rect.width || 200));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${css}@${dpr}`;
    if (key === this._sizeKey) return;
    this._sizeKey = key;
    this.size = css;
    this.dpr = dpr;
    const px = Math.round(css * dpr);
    for (const c of [this.canvas, this.layer]) {
      c.width = px;
      c.height = px;
    }
    const { bounds, points } = this.track.minimap;
    const w = bounds.maxX - bounds.minX, hgt = bounds.maxZ - bounds.minZ;
    const pad = css * 0.13;
    this._pad = pad;
    const k = (css - pad * 2) / Math.max(w, hgt, 1);
    this._k = k;
    this._ox = css / 2 - ((bounds.minX + bounds.maxX) / 2) * k;
    this._oy = css / 2 - ((bounds.minZ + bounds.maxZ) / 2) * k;

    const g = this.lctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, css, css);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = () => {
      g.beginPath();
      points.forEach(([x, z], i) => {
        const sx = x * k + this._ox, sy = z * k + this._oy;
        if (i) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
      g.closePath();
    };
    const lw = css * 0.07;
    path();
    g.strokeStyle = INK;
    g.lineWidth = lw + css * 0.03;
    g.stroke();
    path();
    g.strokeStyle = '#8f9bd6';
    g.lineWidth = lw;
    g.stroke();
    path();
    g.strokeStyle = '#e4e9ff';
    g.lineWidth = lw * 0.55;
    g.stroke();
    // direction chevrons
    g.fillStyle = 'rgba(40,50,120,.85)';
    const n = points.length, step = Math.max(6, Math.floor(n / 9));
    for (let i = step; i < n; i += step) {
      const a = points[i], b = points[(i + 2) % n];
      const ax = a[0] * k + this._ox, ay = a[1] * k + this._oy;
      const ang = Math.atan2((b[1] - a[1]) * k, (b[0] - a[0]) * k);
      g.save();
      g.translate(ax, ay);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(lw * 0.32, 0);
      g.lineTo(-lw * 0.2, -lw * 0.26);
      g.lineTo(-lw * 0.2, lw * 0.26);
      g.closePath();
      g.fill();
      g.restore();
    }
    // start / finish line
    const p0 = points[0], p1 = points[Math.min(2, n - 1)];
    const sx = p0[0] * k + this._ox, sy = p0[1] * k + this._oy;
    const ang = Math.atan2((p1[1] - p0[1]) * k, (p1[0] - p0[0]) * k);
    g.save();
    g.translate(sx, sy);
    g.rotate(ang);
    g.fillStyle = INK;
    g.fillRect(-lw * 0.32, -lw * 0.95, lw * 0.64, lw * 1.9);
    const cell = lw * 0.3;
    for (let r = 0; r < 6; r++) {
      g.fillStyle = r % 2 ? '#fff' : '#161616';
      g.fillRect(-cell, -lw * 0.9 + r * cell * 1.05, cell * 2, cell * 1.05);
    }
    g.fillStyle = '#fff';
    g.fillRect(-cell * 0.4, -lw * 0.9, cell * 0.8, lw * 1.8);
    g.restore();
  }

  update(dt) {
    if (!this.valid) return;
    // re-fit when the layout size changes (window resize / quality change)
    this._accum += dt;
    if (this._accum > 0.5) {
      this._accum = 0;
      this._prepare();
    }
    const g = this.ctx2d, css = this.size, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, css, css);
    g.drawImage(this.layer, 0, 0, css, css);
    const k = this._k, ox = this._ox, oy = this._oy;
    let player = null;
    // rivals first (leader on top of the pack), player last
    const karts = this.karts;
    for (let i = karts.length - 1; i >= 0; i--) {
      const kt = karts[i];
      if (kt.isPlayer) {
        player = kt;
        continue;
      }
      this._dot(g, kt.position.x * k + ox, kt.position.z * k + oy, css * 0.033, kt.character.colors.primary, false);
    }
    if (player) {
      const px = player.position.x * k + ox, py = player.position.z * k + oy;
      const yaw = player.yaw ?? 0;
      const ang = Math.atan2(Math.cos(yaw), Math.sin(yaw));
      g.save();
      g.translate(px, py);
      g.rotate(ang);
      const r = css * 0.062;
      g.fillStyle = '#fff';
      g.strokeStyle = INK;
      g.lineWidth = css * 0.022;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(r * 1.75, 0);
      g.lineTo(r * 0.35, -r * 0.95);
      g.lineTo(r * 0.35, r * 0.95);
      g.closePath();
      g.stroke();
      g.fill();
      g.restore();
      this._dot(g, px, py, css * 0.05, player.character.colors.primary, true);
    }
  }

  _dot(g, x, y, r, color, player) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = Math.max(1.5, r * 0.42);
    g.strokeStyle = player ? '#fff' : INK;
    g.stroke();
    if (player) {
      g.beginPath();
      g.arc(x, y, r + g.lineWidth * 0.5, 0, Math.PI * 2);
      g.lineWidth = Math.max(1, r * 0.28);
      g.strokeStyle = INK;
      g.stroke();
    }
  }
}
