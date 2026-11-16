// 楽園の映像 — Canvas 2D で手続き的に描く（画像ファイルなし）
import { W, H, idx } from './game.js';

export const DAY_SECONDS = 120; // 朝→昼→夕→夜の一巡

const hash = (i, n = 0) => {
  let x = Math.imul(i * 374761393 + n * 668265263, 1274126177);
  x = Math.imul(x ^ (x >>> 13), 1103515245);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
const lerp = (a, b, t) => a + (b - a) * t;
const mixRGB = (a, b, t) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export function skyPhase(t) {
  const p = (t % DAY_SECONDS) / DAY_SECONDS; // 0=夜明け
  const day = p < 0.75 ? Math.sin((p / 0.75) * Math.PI) : 0; // 前3/4が昼
  const night = clamp(1 - day * 3);
  return { p, day, night };
}

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.particles = [];
    this.region = 'valley';
    this.season = 'spring';
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    const w = this.c.width, h = this.c.height;
    // 縦長の画面では谷を90度回して大きく見せる（絵そのものは回さない）
    this.rot = h > w * 1.1;
    const cols = this.rot ? H : W, rows = this.rot ? W : H;
    const mobile = r.width < 700;
    const bottom = (mobile ? 205 : 100) * dpr;
    const right = (mobile ? 0 : 170) * dpr;
    this.skyH = Math.max(Math.round(h * (this.rot ? 0.14 : 0.2)), (mobile ? 118 : 60) * dpr); // 上の表示に地図が隠れないように
    this.ts = Math.floor(Math.min((w - right - 8 * dpr) / cols, (h - this.skyH - bottom) / rows));
    this.ox = Math.round((w - right - this.ts * cols) / 2);
    this.oy = this.skyH + Math.round((h - this.skyH - bottom - this.ts * rows) / 2);
    this.mapW = this.ts * cols; this.mapH = this.ts * rows;
  }

  pos(x, y) {
    return this.rot ? [this.ox + y * this.ts, this.oy + x * this.ts] : [this.ox + x * this.ts, this.oy + y * this.ts];
  }

  tileAt(px, py) {
    const a = Math.floor((px * this.dpr - this.ox) / this.ts);
    const b = Math.floor((py * this.dpr - this.oy) / this.ts);
    const x = this.rot ? b : a, y = this.rot ? a : b;
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
  }

  draw(s, m, t, hover) {
    const g = this.g, w = this.c.width, h = this.c.height;
    const life = clamp(m.total / 100);
    const sky = skyPhase(t);
    this.drawSky(sky, life, t);
    // 地面の下地
    g.fillStyle = mixRGB(this.region === 'desert' ? [190, 165, 120] : [92, 84, 72], [70, 120, 60], life);
    g.fillRect(0, this.skyH, w, h - this.skyH);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.drawTile(s, x, y, t, life);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) this.drawObject(s, x, y, t, sky);
    this.drawParticles(s, m, t, sky, life);
    // 荒れ地のくすみ
    if (life < 0.5) { g.fillStyle = `rgba(120,115,110,${(0.5 - life) * 0.35})`; g.fillRect(0, this.skyH, w, h - this.skyH); }
    // 夜
    if (sky.night > 0) {
      g.fillStyle = `rgba(10,18,48,${sky.night * 0.55})`;
      g.fillRect(0, this.skyH, w, h - this.skyH);
      this.drawLights(s, t, sky);
    }
    if (hover) {
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2 * this.dpr;
      const [hx, hy] = this.pos(hover.x, hover.y);
      g.strokeRect(hx + 1, hy + 1, this.ts - 2, this.ts - 2);
    }
  }

  drawSky(sky, life, t) {
    const g = this.g, w = this.c.width, sh = this.skyH;
    const grayTop = [120, 120, 125], blueTop = [60, 130, 220], nightTop = [8, 12, 40];
    const grayLow = [170, 165, 160], blueLow = [200, 230, 250], duskLow = [250, 170, 120];
    const top = mixRGB(mixRGB2(grayTop, blueTop, life), nightTop, sky.night);
    const dusk = sky.day > 0 && sky.day < 0.35 ? 1 - sky.day / 0.35 : 0;
    const low = mixRGB(mixRGB2(mixRGB2(grayLow, blueLow, life), duskLow, dusk * 0.8), [20, 25, 60], sky.night);
    const gr = g.createLinearGradient(0, 0, 0, sh);
    gr.addColorStop(0, top); gr.addColorStop(1, low);
    g.fillStyle = gr; g.fillRect(0, 0, w, sh);
    // 星
    if (sky.night > 0.2) {
      for (let i = 0; i < 90; i++) {
        const tw = 0.5 + 0.5 * Math.sin(t * 2 + i * 7);
        g.fillStyle = `rgba(255,255,240,${sky.night * tw * 0.9})`;
        g.fillRect(hash(i, 1) * w, hash(i, 2) * sh * 0.8, this.dpr * 1.5, this.dpr * 1.5);
      }
    }
    // 太陽・月
    const p = sky.p;
    if (p < 0.75) {
      const a = p / 0.75;
      const sx = a * w, sy = sh * (0.95 - 0.8 * Math.sin(a * Math.PI));
      const r = sh * 0.12;
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, r * 4);
      glow.addColorStop(0, `rgba(255,240,200,${0.5 + life * 0.3})`); glow.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = glow; g.fillRect(sx - r * 4, sy - r * 4, r * 8, r * 8);
      g.fillStyle = life < 0.2 ? 'rgba(255,250,235,0.7)' : '#fff6d8';
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
    } else {
      const a = (p - 0.75) / 0.25;
      const mx = a * w, my = sh * (0.9 - 0.6 * Math.sin(a * Math.PI));
      g.fillStyle = '#f4f1dc'; g.beginPath(); g.arc(mx, my, sh * 0.08, 0, Math.PI * 2); g.fill();
    }
    // 雲（荒れ地では厚く灰色、楽園では白く少なく）
    const clouds = Math.round(lerp(9, 4, life));
    for (let i = 0; i < clouds; i++) {
      const speed = 6 + hash(i, 3) * 10;
      const cx = ((hash(i, 4) * w + t * speed * this.dpr) % (w + 400)) - 200;
      const cy = sh * (0.15 + hash(i, 5) * 0.45);
      const cw = sh * (0.4 + hash(i, 6) * 0.5);
      const shade = Math.round(lerp(150, 255, life) * (1 - sky.night * 0.7));
      g.fillStyle = `rgba(${shade},${shade},${shade},${lerp(0.75, 0.6, life)})`;
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(cx + k * cw * 0.3, cy + Math.sin(k) * cw * 0.08, cw * 0.32, cw * 0.18, 0, 0, Math.PI * 2); g.fill(); }
    }
    // 遠くの景色：地域ごとに変える
    const region = this.region;
    if (region === 'coast') {
      const hy = sh * 0.8;
      g.fillStyle = mixRGB(mixRGB2([120, 130, 140], [40, 120, 190], life), [10, 20, 50], sky.night * 0.8);
      g.fillRect(0, hy, w, sh - hy);
      g.fillStyle = `rgba(255,255,255,${0.35 * (1 - sky.night)})`;
      for (let k = 0; k < 30; k++) { const x = (hash(k, 7) * w + t * 10 * this.dpr) % w; g.fillRect(x, hy + hash(k, 8) * (sh - hy), 6 * this.dpr, this.dpr); }
      g.fillStyle = mixRGB(mixRGB2([110, 110, 105], [60, 120, 80], life), [15, 20, 40], sky.night * 0.8);
      g.beginPath(); g.ellipse(w * 0.82, hy, w * 0.08, sh * 0.12, 0, Math.PI, 0); g.fill(); // 遠くの島
    } else {
      const amp = region === 'mountain' ? 0.45 : region === 'desert' ? 0.1 : 0.18;
      for (let layer = 0; layer < 2; layer++) {
        const base = region === 'desert' ? (layer ? [200, 165, 120] : [220, 190, 140]) : layer ? [110, 105, 100] : [130, 125, 120];
        const green = layer ? [50, 110, 70] : [90, 150, 110];
        g.fillStyle = mixRGB(mixRGB2(base, green, region === 'desert' ? life * 0.6 : life), [15, 20, 40], sky.night * 0.8);
        g.beginPath(); g.moveTo(0, sh);
        for (let x = 0; x <= w; x += 8 * this.dpr) {
          const n = Math.sin(x * 0.004 + layer * 2) * 0.5 + Math.sin(x * 0.011 + layer) * 0.3 + Math.sin(x * 0.027) * 0.1;
          g.lineTo(x, sh * (0.78 + layer * 0.1) - n * sh * amp - (region === 'mountain' && !layer ? sh * 0.15 : 0));
        }
        g.lineTo(w, sh); g.fill();
      }
      if (region === 'mountain' && sky.night < 0.8) { // 雪をかぶった頂
        g.fillStyle = `rgba(255,255,255,${0.7 * (1 - sky.night)})`;
        for (let k = 0; k < 4; k++) { const px = w * (0.1 + k * 0.25); g.beginPath(); g.moveTo(px - sh * 0.08, sh * 0.32); g.lineTo(px, sh * 0.2); g.lineTo(px + sh * 0.08, sh * 0.32); g.fill(); }
      }
    }
  }

  drawTile(s, x, y, t, life) {
    const g = this.g, ts = this.ts;
    const [X, Y] = this.pos(x, y);
    const i = idx(x, y), tile = s.tiles[i];
    const r = (n) => hash(i, n);
    const fill = (c) => { g.fillStyle = c; g.fillRect(X, Y, ts + 1, ts + 1); };
    const grass = () => {
      fill(mixRGB([88, 150, 70], [110, 175, 80], r(9)));
      g.strokeStyle = 'rgba(40,100,40,0.55)'; g.lineWidth = Math.max(1, ts / 40);
      for (let k = 0; k < 7; k++) {
        const bx = X + r(10 + k) * ts, by = Y + r(20 + k) * ts;
        const sway = Math.sin(t * 1.6 + bx * 0.05) * ts * 0.05;
        g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + sway * 0.5, by - ts * 0.08, bx + sway, by - ts * 0.16); g.stroke();
      }
    };
    const soil = (dark = 0) => {
      fill(mixRGB([125, 95, 65], [100, 72, 50], dark + r(9) * 0.3));
      g.fillStyle = 'rgba(70,45,25,0.35)';
      for (let k = 0; k < 4; k++) g.fillRect(X + r(30 + k) * ts, Y + r(40 + k) * ts, ts * 0.08, ts * 0.05);
    };
    switch (tile.k) {
      case 'rubble':
        fill(mixRGB([118, 110, 100], [100, 95, 90], r(9)));
        for (let k = 0; k < 5; k++) {
          const cx = X + (0.15 + r(k) * 0.7) * ts, cy = Y + (0.15 + r(k + 5) * 0.7) * ts, rr = ts * (0.07 + r(k + 11) * 0.1);
          g.fillStyle = mixRGB([140, 138, 135], [85, 82, 80], r(k + 20));
          g.beginPath();
          for (let a = 0; a < 6; a++) { const ang = a * 1.05 + r(k + a); g.lineTo(cx + Math.cos(ang) * rr * (0.7 + r(a + k * 3) * 0.5), cy + Math.sin(ang) * rr * (0.7 + r(a + k * 4) * 0.5)); }
          g.fill();
        }
        break;
      case 'weeds':
        fill(mixRGB([135, 120, 85], [120, 110, 80], r(9)));
        g.strokeStyle = 'rgba(95,85,45,0.9)'; g.lineWidth = Math.max(1, ts / 36);
        for (let k = 0; k < 9; k++) {
          const bx = X + r(k) * ts, by = Y + (0.3 + r(k + 9) * 0.7) * ts;
          const sway = Math.sin(t * 2.2 + bx * 0.07) * ts * 0.06;
          g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + sway - ts * 0.05, by - ts * 0.25); g.moveTo(bx, by); g.lineTo(bx + sway + ts * 0.06, by - ts * 0.2); g.stroke();
        }
        break;
      case 'soil': soil(); break;
      case 'grass': grass(); break;
      case 'flower':
        grass();
        for (let k = 0; k < 6; k++) {
          const fx = X + (0.12 + r(50 + k) * 0.76) * ts, fy = Y + (0.15 + r(60 + k) * 0.75) * ts;
          const sway = Math.sin(t * 1.5 + k) * ts * 0.02;
          const rr = ts * 0.055 * (0.4 + 0.6 * tile.g);
          const hue = [350, 45, 280, 200, 20, 320][(k + tile.v) % 6];
          g.fillStyle = `hsl(${hue},80%,70%)`;
          for (let a = 0; a < 5; a++) { g.beginPath(); g.arc(fx + sway + Math.cos(a * 1.257) * rr, fy + Math.sin(a * 1.257) * rr, rr * 0.8, 0, 7); g.fill(); }
          g.fillStyle = '#ffe680'; g.beginPath(); g.arc(fx + sway, fy, rr * 0.6, 0, 7); g.fill();
        }
        break;
      case 'field': {
        soil(0.4);
        const rows = 4;
        for (let k = 0; k < rows; k++) {
          const ry = Y + (k + 0.7) * ts / rows;
          for (let j = 0; j < 6; j++) {
            const bx = X + (j + 0.5) * ts / 6;
            const hgt = ts * 0.06 + ts * 0.18 * tile.g;
            const sway = Math.sin(t * 1.4 + bx * 0.03 + k) * ts * 0.03 * tile.g;
            g.strokeStyle = tile.g >= 1 ? '#d8b54a' : mixRGB([90, 170, 60], [170, 180, 70], tile.g);
            g.lineWidth = Math.max(1.5, ts / 26);
            g.beginPath(); g.moveTo(bx, ry); g.lineTo(bx + sway, ry - hgt); g.stroke();
            if (tile.g >= 1) { g.fillStyle = '#e8c860'; g.beginPath(); g.ellipse(bx + sway, ry - hgt, ts * 0.025, ts * 0.05, 0, 0, 7); g.fill(); }
          }
        }
        break;
      }
      case 'orchard': case 'house': case 'well': case 'school': grass(); break;
      case 'sand':
        fill(mixRGB([236, 220, 180], [222, 204, 160], r(9)));
        g.fillStyle = 'rgba(170,150,110,0.35)';
        for (let k = 0; k < 6; k++) g.fillRect(X + r(30 + k) * ts, Y + r(40 + k) * ts, ts * 0.03, ts * 0.03);
        if (this.region === 'desert') {
          g.strokeStyle = 'rgba(190,160,110,0.5)'; g.lineWidth = Math.max(1, ts / 40);
          for (let k = 0; k < 2; k++) { const ly = Y + (0.3 + k * 0.4) * ts; g.beginPath(); g.moveTo(X, ly); g.quadraticCurveTo(X + ts / 2, ly - ts * 0.1, X + ts, ly); g.stroke(); }
        }
        break;
      case 'sea': {
        const deep = (y - (H - 3)) / 3;
        fill(mixRGB([70, 190, 205], [20, 90, 160], clamp(deep + 0.15 * Math.sin(t * 0.7 + x * 0.5))));
        g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = Math.max(1, ts / 35);
        for (let k = 0; k < 2; k++) {
          const off = ((t * ts * 0.25 + r(k) * ts + y * 7) % ts);
          const ly = Y + (0.3 + k * 0.4) * ts + Math.sin(t * 1.3 + x + k) * ts * 0.05;
          g.beginPath(); g.moveTo(X + off - ts * 0.2, ly); g.quadraticCurveTo(X + off, ly - ts * 0.05, X + off + ts * 0.2, ly); g.stroke();
        }
        if (y > 0 && s.tiles[idx(x, y - 1)].k !== 'sea') { // 波打ちぎわの白い泡
          const fy = Y + ts * (0.08 + 0.06 * Math.sin(t * 1.2 + x));
          g.fillStyle = 'rgba(255,255,255,0.75)';
          for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(X + (k + 0.5) * ts / 5, fy, ts * 0.06, 0, 7); g.fill(); }
        }
        break;
      }
      case 'bed':
        fill(mixRGB([196, 178, 140], [180, 160, 125], r(9)));
        g.strokeStyle = 'rgba(120,100,70,0.6)'; g.lineWidth = Math.max(1, ts / 50);
        for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(X + r(k) * ts, Y + r(k + 4) * ts); g.lineTo(X + r(k + 8) * ts, Y + r(k + 12) * ts); g.stroke(); }
        break;
      case 'open': soil(0.8); break;
      case 'stream': case 'spring': {
        fill(mixRGB([60, 130, 190], [80, 160, 210], 0.5 + 0.5 * Math.sin(t * 0.8 + x * 0.6 + y)));
        g.strokeStyle = 'rgba(230,248,255,0.55)'; g.lineWidth = Math.max(1, ts / 40);
        for (let k = 0; k < 3; k++) {
          const off = ((t * ts * 0.35 + r(k) * ts) % ts);
          const ly = Y + (0.2 + k * 0.3) * ts;
          g.beginPath(); g.moveTo(X + off - ts * 0.15, ly); g.lineTo(X + off + ts * 0.1, ly + Math.sin(t * 3 + k) * ts * 0.03); g.stroke();
        }
        if (tile.k === 'spring') {
          for (let k = 0; k < 4; k++) {
            const a = (t * 0.7 + k / 4) % 1;
            g.strokeStyle = `rgba(255,255,255,${0.6 * (1 - a)})`;
            g.beginPath(); g.arc(X + ts / 2, Y + ts / 2, ts * 0.45 * a, 0, 7); g.stroke();
          }
        }
        break;
      }
      default: fill('#777');
    }
  }

  drawObject(s, x, y, t, sky) {
    const [X, Y] = this.pos(x, y);
    const i = idx(x, y);
    this.objectAt(s.tiles[i], i, X, Y, this.ts, t, sky);
  }

  // 1マス分の物（木・家・動物など）を X,Y,ts の箱に描く。歩いて見るでも使う
  objectAt(tile, i, X, Y, ts, t, sky) {
    const g = this.g;
    const cx = X + ts / 2, cy = Y + ts / 2;
    if (tile.k === 'orchard') {
      const gr = 0.35 + 0.65 * tile.g;
      const sway = Math.sin(t * 0.9 + i) * ts * 0.02;
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(cx + ts * 0.08, cy + ts * 0.32, ts * 0.32 * gr, ts * 0.1 * gr, 0, 0, 7); g.fill();
      g.fillStyle = '#6b4a2b'; g.fillRect(cx - ts * 0.04, cy, ts * 0.08, ts * 0.32);
      const fig = tile.v % 2 === 0;
      const autumn = this.season === 'autumn' && hash(i, 33) < 0.45;
      g.fillStyle = autumn ? (fig ? '#c8902e' : '#b5652a') : (fig ? '#3f8f3a' : '#4e9a3f');
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(cx + sway + Math.cos(k * 1.6) * ts * 0.13 * gr, cy - ts * 0.08 + Math.sin(k * 1.6) * ts * 0.1 * gr, ts * 0.2 * gr, 0, 7); g.fill();
      }
      if (tile.g >= 1) {
        g.fillStyle = fig ? '#7a3d6b' : '#5b2f7a';
        for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(cx + sway + (hash(i, 70 + k) - 0.5) * ts * 0.45, cy - ts * 0.1 + (hash(i, 80 + k) - 0.5) * ts * 0.3, ts * 0.04, 0, 7); g.fill(); }
      }
    } else if (tile.k === 'well') {
      g.fillStyle = '#9a948a'; g.beginPath(); g.arc(cx, cy, ts * 0.3, 0, 7); g.fill();
      g.fillStyle = mixRGB([60, 130, 190], [90, 170, 220], 0.5 + 0.5 * Math.sin(t * 2)); g.beginPath(); g.arc(cx, cy, ts * 0.2, 0, 7); g.fill();
      g.strokeStyle = '#6d675e'; g.lineWidth = ts * 0.04; g.beginPath(); g.arc(cx, cy, ts * 0.3, 0, 7); g.stroke();
    } else if (tile.k === 'house') {
      const b = tile.g;
      const hw = ts * 0.62, hh = ts * 0.4 * (0.4 + 0.6 * b);
      const bx = cx - hw / 2, by = cy + ts * 0.28 - hh;
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(bx + ts * 0.06, by + hh - ts * 0.02, hw, ts * 0.08);
      g.fillStyle = ['#f1e6cf', '#e9dcc0', '#f3eee4', '#e8d6b8'][tile.v % 4]; g.fillRect(bx, by, hw, hh);
      g.fillStyle = ['#c2553a', '#b5643c', '#8a5a3c', '#c97a3a'][tile.v % 4];
      g.beginPath(); g.moveTo(bx - ts * 0.06, by); g.lineTo(cx, by - ts * 0.26); g.lineTo(bx + hw + ts * 0.06, by); g.fill();
      g.fillStyle = '#6b4a2b'; g.fillRect(cx - ts * 0.06, by + hh - ts * 0.2, ts * 0.12, ts * 0.2);
      const lit = sky.night > 0.3 && tile.p;
      g.fillStyle = lit ? '#ffd77a' : '#7aa7c7';
      g.fillRect(bx + ts * 0.06, by + ts * 0.06, ts * 0.12, ts * 0.1);
      g.fillRect(bx + hw - ts * 0.18, by + ts * 0.06, ts * 0.12, ts * 0.1);
      if (tile.p) {
        const wx = cx + Math.sin(t * 0.4 + i) * ts * 0.35, wy = cy + ts * 0.38;
        this.person(wx, wy, ts, i, t);
        g.font = `${Math.round(ts * 0.2)}px sans-serif`; g.textAlign = 'center';
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillText(tile.p, cx + 1, Y - ts * 0.02 + 1);
        g.fillStyle = '#fff'; g.fillText(tile.p, cx, Y - ts * 0.02);
        if (tile.t) { g.fillStyle = '#ffe680'; g.fillText('✦', cx + g.measureText(tile.p).width / 2 + ts * 0.1, Y - ts * 0.02); }
      }
    }
    if (tile.k === 'school') {
      const b = 0.5 + 0.5 * tile.g;
      const hw = ts * 0.8, hh = ts * 0.38 * b;
      const bx = cx - hw / 2, by = cy + ts * 0.3 - hh;
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(bx + ts * 0.06, by + hh - ts * 0.02, hw, ts * 0.08);
      g.fillStyle = '#f7f3e8'; g.fillRect(bx, by, hw, hh);
      g.fillStyle = '#3f6fa0';
      g.beginPath(); g.moveTo(bx - ts * 0.05, by); g.lineTo(bx + hw * 0.5, by - ts * 0.22); g.lineTo(bx + hw + ts * 0.05, by); g.fill();
      g.fillStyle = sky.night > 0.3 ? '#ffd77a' : '#9cc3dd';
      for (let k = 0; k < 3; k++) g.fillRect(bx + ts * (0.08 + k * 0.24), by + ts * 0.07, ts * 0.14, ts * 0.12);
      // 開いた本のしるし
      g.fillStyle = '#fff'; g.strokeStyle = '#3f6fa0'; g.lineWidth = Math.max(1, ts * 0.015);
      g.beginPath(); g.moveTo(cx, by - ts * 0.08); g.quadraticCurveTo(cx - ts * 0.08, by - ts * 0.12, cx - ts * 0.13, by - ts * 0.08); g.lineTo(cx - ts * 0.13, by - ts * 0.02); g.quadraticCurveTo(cx - ts * 0.07, by - ts * 0.05, cx, by - ts * 0.02); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(cx, by - ts * 0.08); g.quadraticCurveTo(cx + ts * 0.08, by - ts * 0.12, cx + ts * 0.13, by - ts * 0.08); g.lineTo(cx + ts * 0.13, by - ts * 0.02); g.quadraticCurveTo(cx + ts * 0.07, by - ts * 0.05, cx, by - ts * 0.02); g.closePath(); g.fill(); g.stroke();
    }
    if (tile.s) {
      g.fillStyle = '#7a5532'; g.fillRect(cx + ts * 0.22, cy - ts * 0.1, ts * 0.05, ts * 0.38);
      g.fillStyle = '#e9d6a8'; g.fillRect(cx + ts * 0.06, cy - ts * 0.26, ts * 0.38, ts * 0.2);
      g.fillStyle = '#7a5532'; for (let k = 0; k < 2; k++) g.fillRect(cx + ts * 0.1, cy - ts * (0.22 - k * 0.07), ts * 0.28, ts * 0.025);
    }
    if (tile.a) this.animal(tile.a, cx, cy, ts, i, t);
  }

  person(x, y, ts, i, t) {
    const g = this.g;
    const bob = Math.abs(Math.sin(t * 3 + i)) * ts * 0.02;
    g.fillStyle = ['#4a7bd0', '#d0614a', '#5aa868', '#c08a3a'][i % 4];
    g.fillRect(x - ts * 0.05, y - ts * 0.16 - bob, ts * 0.1, ts * 0.14);
    g.fillStyle = '#e8c4a0'; g.beginPath(); g.arc(x, y - ts * 0.21 - bob, ts * 0.055, 0, 7); g.fill();
  }

  animal(kind, cx, cy, ts, i, t) {
    const g = this.g;
    const wx = cx + Math.sin(t * 0.25 + i * 1.7) * ts * 0.6;
    const wy = cy + Math.sin(t * 0.18 + i) * ts * 0.35;
    const dir = Math.cos(t * 0.25 + i * 1.7) >= 0 ? 1 : -1;
    const bob = Math.abs(Math.sin(t * 2.5 + i)) * ts * 0.02;
    const leg = (dx, c) => { g.fillStyle = c; g.fillRect(wx + dx * ts - ts * 0.015, wy, ts * 0.03, ts * 0.12); };
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(wx, wy + ts * 0.13, ts * 0.18, ts * 0.05, 0, 0, 7); g.fill();
    const body = (c, rw, rh) => { g.fillStyle = c; g.beginPath(); g.ellipse(wx, wy - bob, ts * rw, ts * rh, 0, 0, 7); g.fill(); };
    const head = (c, r, dx = 0.17, dy = -0.08) => { g.fillStyle = c; g.beginPath(); g.arc(wx + dir * ts * dx, wy + ts * dy - bob, ts * r, 0, 7); g.fill(); };
    switch (kind) {
      case 'sheep':
        [-0.08, 0.08].forEach((d) => leg(d, '#444'));
        g.fillStyle = '#f6f3ea'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(wx + (k - 2) * ts * 0.05, wy - bob - (k % 2) * ts * 0.04, ts * 0.08, 0, 7); g.fill(); }
        head('#3a3a3a', 0.05); break;
      case 'deer':
        [-0.08, 0.08].forEach((d) => leg(d, '#7a4f2a'));
        body('#b07a45', 0.14, 0.07); head('#b07a45', 0.05, 0.16, -0.14);
        g.strokeStyle = '#5a3a1a'; g.lineWidth = ts * 0.015; g.beginPath(); g.moveTo(wx + dir * ts * 0.16, wy - ts * 0.18 - bob); g.lineTo(wx + dir * ts * 0.12, wy - ts * 0.27 - bob); g.stroke(); break;
      case 'rabbit':
        body('#e9e1d6', 0.07, 0.05); head('#e9e1d6', 0.04, 0.07, -0.05);
        g.fillStyle = '#e9e1d6'; g.fillRect(wx + dir * ts * 0.06, wy - ts * 0.16 - bob, ts * 0.02, ts * 0.08); break;
      case 'cow':
        [-0.09, 0.09].forEach((d) => leg(d, '#555'));
        body('#f4f4f0', 0.16, 0.08); g.fillStyle = '#2c2c2c'; g.beginPath(); g.arc(wx - ts * 0.04, wy - bob, ts * 0.04, 0, 7); g.fill();
        head('#f4f4f0', 0.055, 0.18, -0.05); break;
      case 'lion':
        [-0.09, 0.09].forEach((d) => leg(d, '#c08a3a'));
        body('#d9a548', 0.15, 0.08); head('#8a5a24', 0.085, 0.17, -0.07); head('#e0b05a', 0.055, 0.18, -0.07); break;
      case 'wolf':
        [-0.09, 0.09].forEach((d) => leg(d, '#5f6368'));
        body('#8d9399', 0.15, 0.07); head('#8d9399', 0.055, 0.17, -0.08);
        g.fillStyle = '#8d9399'; g.beginPath(); g.moveTo(wx + dir * ts * 0.14, wy - ts * 0.13 - bob); g.lineTo(wx + dir * ts * 0.16, wy - ts * 0.19 - bob); g.lineTo(wx + dir * ts * 0.19, wy - ts * 0.13 - bob); g.fill();
        g.strokeStyle = '#8d9399'; g.lineWidth = ts * 0.03; g.beginPath(); g.moveTo(wx - dir * ts * 0.14, wy - bob); g.lineTo(wx - dir * ts * 0.24, wy - ts * 0.06 - bob); g.stroke(); break;
      case 'leopard':
        [-0.09, 0.09].forEach((d) => leg(d, '#c99a3e'));
        body('#e2b456', 0.15, 0.065); head('#e2b456', 0.05, 0.17, -0.07);
        g.fillStyle = '#5a3d1a'; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(wx + (hash(i, 40 + k) - 0.5) * ts * 0.24, wy - bob + (hash(i, 50 + k) - 0.5) * ts * 0.08, ts * 0.014, 0, 7); g.fill(); }
        break;
      case 'bear':
        [-0.09, 0.09].forEach((d) => leg(d, '#4a2f1c'));
        body('#6b452a', 0.16, 0.09); head('#6b452a', 0.065, 0.17, -0.06); break;
      default: body('#ccc', 0.1, 0.06);
    }
  }

  drawLights(s, t, sky) {
    const g = this.g, ts = this.ts;
    g.save(); g.globalCompositeOperation = 'lighter';
    s.tiles.forEach((tile, i) => {
      if (tile.k !== 'house' || !tile.p) return;
      const [px, py] = this.pos(i % W, Math.floor(i / W));
      const x = px + ts / 2, y = py + ts / 2;
      const r = ts * (1.1 + 0.05 * Math.sin(t * 3 + i));
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,190,90,${0.45 * sky.night})`); gr.addColorStop(1, 'rgba(255,190,90,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    });
    g.restore();
  }

  drawParticles(s, m, t, sky, life) {
    const g = this.g, ts = this.ts;
    const { mapW, mapH } = this;
    // 蝶（昼）と蛍（夜）。数は緑の量に比例
    const n = Math.min(40, Math.floor(m.green / 6));
    for (let k = 0; k < n; k++) {
      const px = this.ox + ((hash(k, 90) * mapW + Math.sin(t * 0.3 + k) * ts * 2 + t * ts * 0.1 * (hash(k, 91) - 0.5)) % mapW + mapW) % mapW;
      const py = this.oy + ((hash(k, 92) * mapH + Math.cos(t * 0.4 + k * 2) * ts * 1.2) % mapH + mapH) % mapH;
      if (sky.night > 0.5) {
        const a = (0.5 + 0.5 * Math.sin(t * 2.5 + k * 3)) * sky.night;
        const gr = g.createRadialGradient(px, py, 0, px, py, ts * 0.15);
        gr.addColorStop(0, `rgba(220,255,140,${a})`); gr.addColorStop(1, 'rgba(220,255,140,0)');
        g.fillStyle = gr; g.fillRect(px - ts * 0.15, py - ts * 0.15, ts * 0.3, ts * 0.3);
      } else {
        const flap = Math.abs(Math.sin(t * 12 + k)) * ts * 0.06;
        g.fillStyle = `hsla(${[45, 200, 330, 25, 280][k % 5]},85%,70%,${0.9 * (1 - sky.night)})`;
        g.beginPath(); g.ellipse(px - ts * 0.03, py, flap, ts * 0.05, -0.4, 0, 7); g.ellipse(px + ts * 0.03, py, flap, ts * 0.05, 0.4, 0, 7); g.fill();
      }
    }
    // 春は花びら、秋は木の葉が舞う
    if ((this.season === 'spring' || this.season === 'autumn') && sky.night < 0.5) {
      const col = this.season === 'spring' ? '255,190,210' : '220,140,60';
      for (let k = 0; k < Math.floor(life * 25); k++) {
        const fall = (t * (0.04 + hash(k, 97) * 0.04) + hash(k, 98)) % 1;
        const px = this.ox + (hash(k, 99) * mapW + Math.sin(t + k) * ts) % mapW;
        const py = this.oy + fall * mapH;
        g.fillStyle = `rgba(${col},0.85)`; g.beginPath(); g.ellipse(px, py, ts * 0.04, ts * 0.025, t + k, 0, 7); g.fill();
      }
    }
    // 鳥の群れ（空）
    const birds = Math.floor(life * 10 * (1 - sky.night));
    g.strokeStyle = 'rgba(40,40,50,0.7)'; g.lineWidth = this.dpr * 1.5;
    for (let k = 0; k < birds; k++) {
      const bx = ((hash(k, 95) * this.c.width + t * (25 + k * 3) * this.dpr) % (this.c.width + 100)) - 50;
      const by = this.skyH * (0.2 + hash(k, 96) * 0.4) + Math.sin(t + k) * 6;
      const f = Math.sin(t * 8 + k) * 4 * this.dpr;
      g.beginPath(); g.moveTo(bx - 7 * this.dpr, by - f); g.lineTo(bx, by); g.lineTo(bx + 7 * this.dpr, by - f); g.stroke();
    }
  }
}

function mixRGB2(a, b, t) { return a.map((v, i) => lerp(v, b[i], t)); }
// mixRGB は配列を受け取るので、mixRGB2 の結果をそのまま渡せる
