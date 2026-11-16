// 楽園をつくろう — ゲームロジック（描画・音から独立。node --test で検証）
export const W = 20;
export const H = 12;
const KEY = 'paradise.v1';
const BASE_ENERGY = 6;

export const idx = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newState(seed = Math.floor(Math.random() * 1e9)) {
  const r = rng(seed);
  const tiles = [];
  for (let i = 0; i < W * H; i++) {
    const v = r();
    tiles.push({ k: v < 0.45 ? 'rubble' : v < 0.88 ? 'weeds' : 'soil', g: 0, v: Math.floor(r() * 4) });
  }
  // 干上がった川床：左端の泉から右端へ蛇行
  let y = 2 + Math.floor(r() * 2);
  tiles[idx(0, y)] = { k: 'spring', g: 0, v: 0 };
  for (let x = 0; x < W; x++) {
    if (x > 0) tiles[idx(x, y)] = { k: 'bed', g: 0, v: 0 };
    if (x > 0 && x < W - 1 && r() < 0.45) {
      const ny = Math.min(H - 2, Math.max(1, y + (r() < 0.35 ? -1 : 1)));
      if (ny !== y) { y = ny; tiles[idx(x, y)] = { k: 'bed', g: 0, v: 0 }; }
    }
  }
  return {
    version: 1, seed, day: 1, energy: BASE_ENERGY, maxEnergy: BASE_ENERGY,
    tiles, hopes: [], unlocked: [], log: [],
  };
}

const WET = new Set(['spring', 'stream', 'well']);
export function isWatered(s, x, y) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx, ny = y + dy;
    if (inside(nx, ny) && WET.has(s.tiles[idx(nx, ny)].k)) return true;
  }
  return false;
}

const GREEN = new Set(['grass', 'flower', 'orchard', 'field']);
export function metrics(s) {
  let green = 0, food = 0, homes = 0, water = 0, animals = 0, people = 0;
  for (const t of s.tiles) {
    if (GREEN.has(t.k)) green++;
    if (t.k === 'field' && t.g >= 1) food += 1;
    if (t.k === 'orchard' && t.g >= 1) food += 2;
    if (t.k === 'house') { homes++; if (t.p) people++; }
    if (t.k === 'stream') water++;
    if (t.k === 'well') water += 3;
    if (t.a) animals++;
  }
  const c = (v, m) => Math.min(v, m) / m;
  const total = Math.round(
    100 * (0.4 * c(green, W * H * 0.7) + 0.15 * c(food, 20) + 0.15 * c(homes, 10)
      + 0.1 * c(water, 40) + 0.1 * c(animals, 10) + 0.1 * c(people, 10)),
  );
  return { green, food, homes, water, animals, people, total };
}

export function unlock(s, id) {
  if (s.unlocked.includes(id)) return null;
  s.unlocked.push(id);
  return id;
}

function flow(s) {
  // 泉から開いた水路・川床をたどって水を流す
  const start = s.tiles.findIndex((t) => t.k === 'spring');
  const seen = new Set([start]);
  const q = [start];
  let added = 0;
  while (q.length) {
    const i = q.shift();
    const x = i % W, y = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (seen.has(j)) continue;
      const t = s.tiles[j];
      if (t.k === 'open') { t.k = 'stream'; added++; }
      if (t.k === 'stream') { seen.add(j); q.push(j); }
    }
  }
  return added;
}

const ANIMAL_CYCLE = ['sheep', 'deer', 'rabbit', 'cow', 'lion', 'bear'];
const LAND = ['soil', 'grass'];

export const ACTIONS = {
  clear: { label: '整地', cost: 1, on: ['rubble', 'weeds'], hint: 'がれきや雑草を片づけて土に戻す' },
  channel: { label: '水路', cost: 1, on: ['bed', 'soil', 'grass'], hint: '川床や土を掘って泉の水を導く' },
  well: { label: '井戸', cost: 3, on: LAND, hint: 'まわりの土地を潤す' },
  field: { label: '畑', cost: 2, on: LAND, water: true, hint: '3日で実る穀物と野菜' },
  orchard: { label: '果樹', cost: 2, on: LAND, water: true, hint: 'ぶどう・いちじく。ゆっくり育ち、実りが多い' },
  flower: { label: '花', cost: 1, on: LAND, hint: '地を美しく彩る' },
  house: { label: '家', cost: 4, on: LAND, water: true, hint: '水と実った食物があれば建てられる' },
  animal: { label: '動物', cost: 1, on: ['grass', 'flower'], hint: '緑が増えると動物がやって来る' },
  welcome: { label: '迎える', cost: 1, on: ['house'], hint: '空き家に復活した人を迎える' },
  sign: { label: '看板', cost: 0, on: ['soil', 'grass', 'flower'], hint: '家族の希望を書いて立てる' },
};

export function act(s, action, x, y, opt = {}) {
  const A = ACTIONS[action];
  if (!A || !inside(x, y)) return { ok: false, reason: 'そこでは何もできません' };
  const t = s.tiles[idx(x, y)];
  if (!A.on.includes(t.k)) return { ok: false, reason: `「${A.label}」はこの場所ではできません` };
  if (t.a && action !== 'animal' && action !== 'sign') return { ok: false, reason: '動物が休んでいます' };
  if (t.s && action !== 'sign') return { ok: false, reason: '希望の看板が立っています' };
  if (s.energy < A.cost) return { ok: false, reason: '今日の労力を使い切りました。「一日を終える」で休みましょう' };
  if (A.water && !isWatered(s, x, y)) return { ok: false, reason: '近くに水がありません。水路か井戸を作りましょう' };
  const m = metrics(s);
  const cards = [];
  const got = (id) => { const c = unlock(s, id); if (c) cards.push(c); };

  switch (action) {
    case 'clear': t.k = 'soil'; t.g = 0; got('care'); break;
    case 'channel': t.k = 'open'; if (flow(s) > 0) got('water'); break;
    case 'well': t.k = 'well'; break;
    case 'field': t.k = 'field'; t.g = 0; got('field'); break;
    case 'orchard': t.k = 'orchard'; t.g = 0; break;
    case 'flower': t.k = 'flower'; t.g = 0; break;
    case 'house':
      if (m.food < m.homes + 1) return { ok: false, reason: 'まず食物が必要です。畑や果樹を実らせましょう' };
      t.k = 'house'; t.g = 0; got('house'); break;
    case 'animal': {
      if (t.a) return { ok: false, reason: 'もう動物がいます' };
      if (m.green < (m.animals + 1) * 5) return { ok: false, reason: 'もっと緑を増やすと動物がやって来ます' };
      const kind = opt.kind || ANIMAL_CYCLE[m.animals % ANIMAL_CYCLE.length];
      if ((kind === 'lion' || kind === 'bear') && m.animals < 3) return { ok: false, reason: 'まずおとなしい動物たちを迎えましょう' };
      t.a = kind; got('animal'); break;
    }
    case 'welcome': {
      if (t.p) return { ok: false, reason: 'この家にはもう住む人がいます' };
      if (m.food < m.people + 1) return { ok: false, reason: '迎える人の食物を用意しましょう' };
      t.p = String(opt.name || '').trim().slice(0, 20) || 'なつかしい友';
      s.maxEnergy = BASE_ENERGY + 2 * (m.people + 1);
      got('welcome');
      if (m.people + 1 >= 3) got('tears');
      break;
    }
    case 'sign': {
      const text = String(opt.text || '').trim().slice(0, 80);
      if (!text) return { ok: false, reason: '看板に書く希望を選んでください' };
      t.s = text; break;
    }
  }
  s.energy -= A.cost;
  s.log.unshift({ day: s.day, text: `${A.label}（${x + 1},${y + 1}）` });
  s.log.length = Math.min(s.log.length, 30);
  return { ok: true, card: cards[0], cards };
}

export function endDay(s) {
  let grown = 0;
  const cards = [];
  const got = (id) => { const c = unlock(s, id); if (c) cards.push(c); };
  s.tiles.forEach((t, i) => {
    const x = i % W, y = Math.floor(i / W);
    const wet = isWatered(s, x, y);
    const rate = { field: 0.34, orchard: 0.15, flower: 0.5, house: 1 }[t.k];
    if (rate && t.g < 1 && (wet || t.k === 'flower' || t.k === 'house')) {
      t.g = Math.min(1, t.g + rate); grown++;
      if (t.k === 'orchard' && t.g >= 1) got('fig');
    } else if (t.k === 'soil' && wet) { t.k = 'grass'; grown++; }
  });
  flow(s);
  s.day += 1;
  s.energy = s.maxEnergy;
  if (s.day >= 7) got('health');
  return { grown, card: cards[0], cards };
}

export function addHope(s, who, text, kind = 'do') {
  const t = String(text || '').trim().slice(0, 80);
  if (!t) return null;
  const e = { who: String(who || '').trim().slice(0, 20) || '家族', text: t, kind: kind === 'person' ? 'person' : 'do', day: s.day };
  s.hopes.push(e);
  return e;
}

export function saveState(storage, s) {
  try { storage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export function parseState(json) {
  try {
    const o = JSON.parse(json);
    if (!o || !Array.isArray(o.tiles) || o.tiles.length !== W * H || !Number.isFinite(o.day)) return null;
    if (!o.tiles.every((t) => t && typeof t.k === 'string')) return null;
    return {
      ...newState(o.seed || 1), ...o,
      hopes: Array.isArray(o.hopes) ? o.hopes : [],
      unlocked: Array.isArray(o.unlocked) ? o.unlocked : [],
      log: Array.isArray(o.log) ? o.log : [],
    };
  } catch { return null; }
}

export function loadState(storage) {
  let raw = null;
  try { raw = storage.getItem(KEY); } catch { /* 使えない環境 */ }
  return (raw && parseState(raw)) || newState();
}
