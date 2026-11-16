// 歩いて見る — 地図を遠近法で描く一人称の散歩（外部ライブラリなし）
import { W, H, idx, canWalk } from './game.js';
import { skyPhase } from './render.js';

const NEAR = 0.08;
const EYE = 0.5;
const hash = (i, n = 0) => {
  let x = Math.imul(i * 374761393 + n * 668265263, 1274126177);
  x = Math.imul(x ^ (x >>> 13), 1103515245);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const lerp = (a, b, t) => a + (b - a) * t;
const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

function groundColor(tile, t, x, y) {
  switch (tile.k) {
    case 'grass': case 'orchard': case 'house': case 'well': case 'school': case 'flower':
      return mix([92, 152, 72], [112, 176, 82], hash(idx(x, y), 9));
    case 'field': return tile.g >= 1 ? [196, 170, 80] : mix([110, 82, 56], [120, 160, 70], tile.g);
    case 'soil': case 'open': return [126, 96, 66];
    case 'rubble': return [120, 112, 102];
    case 'weeds': return [136, 122, 86];
    case 'bed': return [196, 178, 140];
    case 'sand': return [234, 218, 178];
    case 'stream': case 'spring': return mix([60, 130, 190], [90, 170, 220], 0.5 + 0.5 * Math.sin(t * 1.5 + x * 0.7 + y));
    case 'sea': return mix([40, 150, 190], [20, 90, 160], 0.5 + 0.5 * Math.sin(t * 0.8 + x * 0.4));
    default: return [120, 120, 120];
  }
}

export class Walker {
  constructor(canvas, renderer) {
    this.c = canvas;
    this.r = renderer;
    this.cam = { x: 2.5, y: 2.5, a: 0 };
    this.keys = new Set();
    this.pad = { fwd: 0, turn: 0 };
    this.stepAcc = 0;
    this.near = new Set();
    this.onStep = () => {};
    this.onNear = () => {};
    window.addEventListener('keydown', (e) => { if (this.active) { this.keys.add(e.key); if (e.key.startsWith('Arrow')) e.preventDefault(); } });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { if (this.active) drag = e.clientX; });
    window.addEventListener('pointermove', (e) => { if (this.active && drag !== null) { this.cam.a += (e.clientX - drag) * 0.006; drag = e.clientX; } });
    window.addEventListener('pointerup', () => { drag = null; });
  }

  enter(s) {
    this.active = true;
    this.near.clear();
    // 泉の近くの歩ける場所から、谷の中央を向いて始める
    const spring = s.tiles.findIndex((t) => t.k === 'spring');
    const sx = spring % W, sy = Math.floor(spring / W);
    let best = null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!canWalk(s, x + 0.5, y + 0.5)) continue;
      const d = Math.hypot(x - sx - 1, y - sy);
      if (!best || d < best.d) best = { x: x + 0.5, y: y + 0.5, d };
    }
    this.cam = { x: best ? best.x : 1.5, y: best ? best.y : 1.5, a: Math.atan2(H / 2 - (best ? best.y : 1.5), W / 2 - (best ? best.x : 1.5)) };
  }

  exit() { this.active = false; this.keys.clear(); this.pad = { fwd: 0, turn: 0 }; }

  update(s, dt) {
    const k = this.keys;
    const turn = (k.has('ArrowLeft') || k.has('a') ? -1 : 0) + (k.has('ArrowRight') || k.has('d') ? 1 : 0) + this.pad.turn;
    const fwd = (k.has('ArrowUp') || k.has('w') ? 1 : 0) + (k.has('ArrowDown') || k.has('s') ? -1 : 0) + this.pad.fwd;
    this.cam.a += turn * dt * 1.6;
    if (fwd) {
      const sp = fwd * dt * 1.6;
      const nx = this.cam.x + Math.cos(this.cam.a) * sp, ny = this.cam.y + Math.sin(this.cam.a) * sp;
      if (canWalk(s, nx, this.cam.y)) this.cam.x = nx; // 壁に沿って滑る
      if (canWalk(s, this.cam.x, ny)) this.cam.y = ny;
      this.stepAcc += Math.abs(sp);
      if (this.stepAcc > 0.45) { this.stepAcc = 0; this.onStep(); }
    }
    // 近くの家や看板を知らせる（離れるまで繰り返さない）
    s.tiles.forEach((t, i) => {
      if (!(t.p || t.s)) return;
      const d = Math.hypot((i % W) + 0.5 - this.cam.x, Math.floor(i / W) + 0.5 - this.cam.y);
      const key = `${i}`;
      if (d < 1.7 && !this.near.has(key)) { this.near.add(key); this.onNear(t); } else if (d > 2.4) this.near.delete(key);
    });
  }

  project(px, py) {
    const dx = px - this.cam.x, dy = py - this.cam.y;
    const c = Math.cos(this.cam.a), s = Math.sin(this.cam.a);
    return { f: dx * c + dy * s, sd: -dx * s + dy * c };
  }

  draw(s, m, t) {
    const r = this.r, g = r.g, w = this.c.width, h = this.c.height;
    const horizon = Math.round(h * 0.45);
    const focal = w * 0.55;
    const sky = skyPhase(t);
    const life = Math.min(1, m.total / 100);
    const fogC = mix(mix([170, 165, 160], [200, 225, 240], life), [20, 25, 60], sky.night);
    // 空（地図用の空をそのまま地平線まで伸ばして使う）
    const keep = r.skyH; r.skyH = horizon; r.drawSky(sky, life, t); r.skyH = keep;
    const gr = g.createLinearGradient(0, horizon, 0, h);
    gr.addColorStop(0, rgb(fogC)); gr.addColorStop(1, rgb(mix([90, 85, 70], [70, 120, 60], life)));
    g.fillStyle = gr; g.fillRect(0, horizon, w, h - horizon);

    const toScreen = (p) => ({ x: w / 2 + (p.sd / p.f) * focal, y: horizon + (EYE / p.f) * focal });
    // 地面のマス：遠い順に描く
    const tiles = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = this.project(x + 0.5, y + 0.5);
      const d = Math.hypot(x + 0.5 - this.cam.x, y + 0.5 - this.cam.y);
      if (c.f < -1 || d > 26) continue;
      tiles.push({ x, y, d, c });
    }
    tiles.sort((a, b) => b.d - a.d);
    for (const T of tiles) {
      const corners = [[T.x, T.y], [T.x + 1, T.y], [T.x + 1, T.y + 1], [T.x, T.y + 1]].map(([px, py]) => this.project(px, py));
      const poly = clipNear(corners);
      if (poly.length < 3) continue;
      const fog = Math.min(1, T.d / 22);
      g.fillStyle = rgb(mix(groundColor(s.tiles[idx(T.x, T.y)], t, T.x, T.y), fogC, fog * 0.85));
      g.beginPath();
      poly.forEach((p, k) => { const q = toScreen(p); if (k) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
      g.closePath(); g.fill();
    }
    // 立っている物：遠い順
    const items = [];
    for (const T of tiles) {
      if (T.c.f < NEAR + 0.15 || T.d > 18) continue;
      const size = focal / T.c.f;
      const sx = w / 2 + (T.c.sd / T.c.f) * focal;
      if (sx < -size * 2 || sx > w + size * 2) continue;
      items.push({ ...T, size, sx, sy: horizon + (EYE / T.c.f) * focal });
    }
    for (const it of items) {
      const i = idx(it.x, it.y), tile = s.tiles[i];
      g.save();
      g.globalAlpha = 1 - Math.min(1, it.d / 18) * 0.6;
      const X = it.sx - it.size / 2, Y = it.sy - it.size * 0.8;
      this.decor(tile, i, it.sx, it.sy, it.size, t);
      if (['orchard', 'house', 'well', 'school'].includes(tile.k) || tile.a || tile.s) r.objectAt(tile, i, X, Y, it.size, t, sky);
      g.restore();
    }
    // 夜
    if (sky.night > 0) {
      g.fillStyle = `rgba(10,18,48,${sky.night * 0.5})`;
      g.fillRect(0, horizon, w, h - horizon);
      g.save(); g.globalCompositeOperation = 'lighter';
      for (const it of items) {
        const tile = s.tiles[idx(it.x, it.y)];
        if (tile.k !== 'house' || !tile.p) continue;
        const rad = it.size * 1.2;
        const glow = g.createRadialGradient(it.sx, it.sy - it.size * 0.3, 0, it.sx, it.sy - it.size * 0.3, rad);
        glow.addColorStop(0, `rgba(255,190,90,${0.5 * sky.night})`); glow.addColorStop(1, 'rgba(255,190,90,0)');
        g.fillStyle = glow; g.fillRect(it.sx - rad, it.sy - it.size * 0.3 - rad, rad * 2, rad * 2);
      }
      // 蛍
      for (let k = 0; k < Math.min(40, m.green / 4); k++) {
        const fx = (hash(k, 1) * w + Math.sin(t * 0.5 + k) * 40) % w, fy = horizon + hash(k, 2) * (h - horizon) * 0.8 + Math.cos(t * 0.7 + k) * 20;
        const a = (0.5 + 0.5 * Math.sin(t * 2.5 + k * 3)) * sky.night;
        g.fillStyle = `rgba(220,255,140,${a})`; g.beginPath(); g.arc(fx, fy, 2.5 * r.dpr, 0, 7); g.fill();
      }
      g.restore();
    } else if (m.green > 20) {
      // 蝶
      for (let k = 0; k < Math.min(14, m.green / 10); k++) {
        const fx = (hash(k, 3) * w + t * 30 * (hash(k, 4) - 0.5) * r.dpr + w * 10) % w;
        const fy = horizon + (0.2 + hash(k, 5) * 0.5) * (h - horizon) + Math.sin(t * 1.3 + k) * 25;
        const flap = Math.abs(Math.sin(t * 12 + k)) * 6 * r.dpr;
        g.fillStyle = `hsla(${[45, 200, 330, 25, 280][k % 5]},85%,70%,0.9)`;
        g.beginPath(); g.ellipse(fx - 4, fy, flap, 6 * r.dpr, -0.4, 0, 7); g.ellipse(fx + 4, fy, flap, 6 * r.dpr, 0.4, 0, 7); g.fill();
      }
    }
  }

  // 地面に生えている物（畑の穂・花・草・がれき・枯れ草）
  decor(tile, i, sx, sy, size, t) {
    const g = this.r.g;
    const n = size > 60 ? 7 : 4;
    const stalk = (col, hgt, k) => {
      const px = sx + (hash(i, 10 + k) - 0.5) * size * 0.9;
      const py = sy - (hash(i, 20 + k)) * size * 0.25;
      const sway = Math.sin(t * 1.5 + px * 0.02) * size * 0.03;
      g.strokeStyle = col; g.lineWidth = Math.min(Math.max(1, size * 0.02), 3 * this.r.dpr);
      g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + sway * 0.5, py - hgt * 0.5, px + sway, py - hgt); g.stroke();
      return [px + sway, py - hgt];
    };
    switch (tile.k) {
      case 'field':
        for (let k = 0; k < n * 2; k++) {
          const [hx, hy] = stalk(tile.g >= 1 ? '#c9a640' : '#6aa84f', size * (0.1 + 0.3 * tile.g), k);
          if (tile.g >= 1) { g.fillStyle = '#e8c860'; g.beginPath(); g.ellipse(hx, hy, size * 0.02, size * 0.045, 0, 0, 7); g.fill(); }
        }
        break;
      case 'grass': case 'orchard': case 'house': case 'school':
        for (let k = 0; k < n; k++) stalk('rgba(50,110,45,0.8)', size * 0.08, k);
        break;
      case 'flower':
        for (let k = 0; k < n; k++) {
          const [hx, hy] = stalk('#4f8f3f', size * 0.12, k);
          g.fillStyle = `hsl(${[350, 45, 280, 200, 20, 320][(k + tile.v) % 6]},80%,70%)`;
          g.beginPath(); g.arc(hx, hy, size * 0.03, 0, 7); g.fill();
        }
        break;
      case 'weeds':
        for (let k = 0; k < n; k++) stalk('rgba(110,95,55,0.9)', size * 0.18, k);
        break;
      case 'rubble':
        for (let k = 0; k < 3; k++) {
          const px = sx + (hash(i, 30 + k) - 0.5) * size * 0.8, rr = size * (0.06 + hash(i, 40 + k) * 0.08);
          g.fillStyle = `rgb(${110 + k * 15},${108 + k * 15},${104 + k * 15})`;
          g.beginPath(); g.ellipse(px, sy - rr * 0.6, rr * 1.3, rr, 0, Math.PI, 0); g.fill();
        }
        break;
      default: break;
    }
  }
}

// 近すぎる部分（カメラの後ろ）を切り落とす
function clipNear(pts) {
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const ain = a.f >= NEAR, bin = b.f >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const tt = (NEAR - a.f) / (b.f - a.f);
      out.push({ f: NEAR, sd: a.sd + (b.sd - a.sd) * tt });
    }
  }
  return out;
}
