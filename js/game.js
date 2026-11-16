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

// ---------- 地域 ----------
export const REGIONS = {
  valley: { name: '谷', icon: '🏞', note: '最初の土地。泉と小川のある谷' },
  coast: { name: '海辺', icon: '🏖', note: '青い海と白い砂浜の島の土地' },
  mountain: { name: '山里', icon: '⛰', note: '岩の多い、空に近い山あいの土地' },
  desert: { name: '荒れ野', icon: '🏜', note: '砂に覆われた乾いた土地' },
};
const REGION_SALT = { valley: 0, coast: 101, mountain: 202, desert: 303 };

export function genRegion(seed, id = 'valley') {
  const r = rng(seed + REGION_SALT[id]);
  const tiles = [];
  for (let i = 0; i < W * H; i++) {
    const v = r();
    let k;
    if (id === 'desert') k = v < 0.78 ? 'sand' : v < 0.93 ? 'rubble' : 'weeds';
    else if (id === 'mountain') k = v < 0.62 ? 'rubble' : v < 0.92 ? 'weeds' : 'soil';
    else k = v < 0.45 ? 'rubble' : v < 0.88 ? 'weeds' : 'soil';
    tiles.push({ k, g: 0, v: Math.floor(r() * 4) });
  }
  const maxY = id === 'coast' ? H - 5 : H - 2;
  if (id === 'coast') {
    for (let x = 0; x < W; x++) {
      for (let y = H - 3; y < H; y++) tiles[idx(x, y)] = { k: 'sea', g: 0, v: 0 };
      tiles[idx(x, H - 4)] = { k: 'sand', g: 0, v: Math.floor(r() * 4) };
    }
  }
  // 干上がった川床：左端の泉から右端へ蛇行
  let y = 2 + Math.floor(r() * 2);
  tiles[idx(0, y)] = { k: 'spring', g: 0, v: 0 };
  for (let x = 0; x < W; x++) {
    if (x > 0) tiles[idx(x, y)] = { k: 'bed', g: 0, v: 0 };
    if (x > 0 && x < W - 1 && r() < 0.45) {
      const ny = Math.min(maxY, Math.max(1, y + (r() < 0.35 ? -1 : 1)));
      if (ny !== y) { y = ny; tiles[idx(x, y)] = { k: 'bed', g: 0, v: 0 }; }
    }
  }
  return tiles;
}

export function newState(seed = Math.floor(Math.random() * 1e9)) {
  const tiles = genRegion(seed, 'valley');
  return {
    version: 2, seed, day: 1, energy: BASE_ENERGY, maxEnergy: BASE_ENERGY, chapter: 1,
    region: 'valley', regions: { valley: tiles }, tiles, hopes: [], unlocked: [], log: [],
  };
}

// ---------- 水と指標 ----------
const WET = new Set(['spring', 'stream', 'well']);
function wetAt(tiles, x, y) {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx, ny = y + dy;
    if (inside(nx, ny) && WET.has(tiles[idx(nx, ny)].k)) return true;
  }
  return false;
}
export const isWatered = (s, x, y) => wetAt(s.tiles, x, y);

const GREEN = new Set(['grass', 'flower', 'orchard', 'field']);
export const WILD = new Set(['lion', 'bear', 'wolf', 'leopard']);
export function metricsOf(tiles) {
  let green = 0, food = 0, homes = 0, water = 0, animals = 0, people = 0, taught = 0, wild = 0, schools = 0, land = 0;
  for (const t of tiles) {
    if (t.k !== 'sea') land++;
    if (GREEN.has(t.k)) green++;
    if (t.k === 'field' && t.g >= 1) food += 1;
    if (t.k === 'orchard' && t.g >= 1) food += 2;
    if (t.k === 'house') { homes++; if (t.p) people++; if (t.p && t.t) taught++; }
    if (t.k === 'school') schools++;
    if (t.k === 'stream') water++;
    if (t.k === 'well') water += 3;
    if (t.a) { animals++; if (WILD.has(t.a)) wild++; }
  }
  const c = (v, m) => Math.min(v, m) / m;
  const total = Math.round(
    100 * (0.4 * c(green, land * 0.7) + 0.15 * c(food, 20) + 0.15 * c(homes + schools, 10)
      + 0.1 * c(water, 40) + 0.1 * c(animals, 10) + 0.1 * c(people, 10)),
  );
  return { green, food, homes, water, animals, people, taught, wild, schools, total };
}
export const metrics = (s) => metricsOf(s.tiles);

const regionsOf = (s) => ({ ...s.regions, [s.region]: s.tiles });
export function allMetrics(s) {
  const sum = { green: 0, food: 0, homes: 0, water: 0, animals: 0, people: 0, taught: 0, wild: 0, schools: 0 };
  const totals = {};
  for (const [id, tiles] of Object.entries(regionsOf(s))) {
    const m = metricsOf(tiles);
    totals[id] = m.total;
    for (const k of Object.keys(sum)) sum[k] += m[k];
  }
  return { ...sum, totals };
}

export function unlock(s, id) {
  if (s.unlocked.includes(id)) return null;
  s.unlocked.push(id);
  return id;
}

// ---------- 章 ----------
export const CHAPTERS = {
  1: '清められた大地', 2: '再会', 3: '動物との平和', 4: '地球全体へ', 5: '歩いて見る',
};
const CHAPTER_RULES = {
  2: (a) => a.people >= 1 && (a.totals.valley || 0) >= 35,
  3: (a) => a.people >= 5 && a.taught >= 3,
  4: (a) => a.animals >= 8 && a.wild >= 2,
  5: (a) => Object.entries(a.totals).filter(([id, v]) => id !== 'valley' && v >= 25).length >= 2,
};
export const CHAPTER_GOALS = {
  2: '人を1人迎え、谷の楽園度を35にする',
  3: '迎えた人を5人に、そのうち3人に教える',
  4: '動物を8匹、そのうち野生の動物を2匹迎える',
  5: '谷以外の2つの地域で楽園度を25にする',
};
export function checkChapter(s) {
  const cards = [];
  while (s.chapter < 5 && CHAPTER_RULES[s.chapter + 1](allMetrics(s))) {
    s.chapter += 1;
    const c = unlock(s, `ch${s.chapter}`);
    if (c) cards.push(c);
  }
  return cards;
}

function refreshEnergy(s) {
  s.maxEnergy = BASE_ENERGY + 2 * allMetrics(s).people;
}

function flow(tiles) {
  // 泉から開いた水路・川床をたどって水を流す
  const start = tiles.findIndex((t) => t.k === 'spring');
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
      const t = tiles[j];
      if (t.k === 'open') { t.k = 'stream'; added++; }
      if (t.k === 'stream') { seen.add(j); q.push(j); }
    }
  }
  return added;
}

// ---------- 行動 ----------
const TAME = ['sheep', 'deer', 'rabbit', 'cow'];
const ALL_ANIMALS = ['sheep', 'lion', 'deer', 'wolf', 'rabbit', 'leopard', 'cow', 'bear'];
export const ANIMAL_KINDS = new Set(ALL_ANIMALS);
const LAND = ['soil', 'grass'];

export const ACTIONS = {
  clear: { label: '整地', cost: 1, ch: 1, on: ['rubble', 'weeds', 'sand'], hint: 'がれきや雑草、砂を片づけて土に戻す' },
  channel: { label: '水路', cost: 1, ch: 1, on: ['bed', 'soil', 'grass'], hint: '川床や土を掘って泉の水を導く' },
  well: { label: '井戸', cost: 3, ch: 1, on: LAND, hint: 'まわりの土地を潤す' },
  field: { label: '畑', cost: 2, ch: 1, on: LAND, water: true, hint: '3日で実る穀物と野菜' },
  orchard: { label: '果樹', cost: 2, ch: 1, on: LAND, water: true, hint: 'ぶどう・いちじく。ゆっくり育ち、実りが多い' },
  flower: { label: '花', cost: 1, ch: 1, on: LAND, hint: '地を美しく彩る' },
  house: { label: '家', cost: 4, ch: 1, on: LAND, water: true, hint: '水と実った食物があれば建てられる' },
  animal: { label: '動物', cost: 1, ch: 1, on: ['grass', 'flower'], hint: '緑が増えると動物がやって来る' },
  welcome: { label: '迎える', cost: 1, ch: 1, on: ['house'], hint: '空き家に復活した人を迎える' },
  sign: { label: '看板', cost: 0, ch: 1, on: ['soil', 'grass', 'flower', 'sand'], hint: '家族の希望を書いて立てる' },
  school: { label: '学びの家', cost: 4, ch: 2, on: LAND, hint: '戻って来た人たちが神について学ぶ場所' },
  teach: { label: '教える', cost: 1, ch: 2, on: ['house'], hint: '学びの家がある土地で、住む人に教える' },
};

export function act(s, action, x, y, opt = {}) {
  const A = ACTIONS[action];
  if (!A || !inside(x, y)) return { ok: false, reason: 'そこでは何もできません' };
  if (s.chapter < A.ch) return { ok: false, reason: `「${A.label}」は第${A.ch}章からです` };
  const t = s.tiles[idx(x, y)];
  if (!A.on.includes(t.k)) return { ok: false, reason: `「${A.label}」はこの場所ではできません` };
  if (t.a && action !== 'animal' && action !== 'sign') return { ok: false, reason: '動物が休んでいます' };
  if (s.energy < A.cost) return { ok: false, reason: '今日の労力を使い切りました。「一日を終える」で休みましょう' };
  if (A.water && !isWatered(s, x, y)) return { ok: false, reason: '近くに水がありません。水路か井戸を作りましょう' };
  const m = metrics(s);
  const cards = [];
  const got = (id) => { const c = unlock(s, id); if (c) cards.push(c); };
  let reunion = false;

  switch (action) {
    case 'clear': t.k = 'soil'; t.g = 0; got('care'); break;
    case 'channel': t.k = 'open'; if (flow(s.tiles) > 0) got('water'); break;
    case 'well': t.k = 'well'; break;
    case 'field': t.k = 'field'; t.g = 0; got('field'); break;
    case 'orchard': t.k = 'orchard'; t.g = 0; break;
    case 'flower': t.k = 'flower'; t.g = 0; break;
    case 'house':
      if (m.food < m.homes + 1) return { ok: false, reason: 'まず食物が必要です。畑や果樹を実らせましょう' };
      t.k = 'house'; t.g = 0; got('house'); break;
    case 'school':
      t.k = 'school'; t.g = 0; got('learn'); break;
    case 'teach':
      if (!t.p) return { ok: false, reason: 'この家にはまだだれも住んでいません' };
      if (t.t) return { ok: false, reason: 'この家の人はもう学んでいます' };
      if (!m.schools) return { ok: false, reason: 'この土地にまず🏫学びの家を建てましょう' };
      t.t = 1; got('taught'); break;
    case 'animal': {
      if (t.a) return { ok: false, reason: 'もう動物がいます' };
      if (m.green < (m.animals + 1) * 5) return { ok: false, reason: 'もっと緑を増やすと動物がやって来ます' };
      const list = s.chapter >= 3 ? ALL_ANIMALS : TAME;
      const kind = ANIMAL_KINDS.has(opt.kind) ? opt.kind : list[m.animals % list.length];
      if (WILD.has(kind) && s.chapter < 3) return { ok: false, reason: '野生の動物は第3章「動物との平和」から迎えられます' };
      t.a = kind; got('animal');
      if (WILD.has(kind)) got('lionstraw');
      break;
    }
    case 'welcome': {
      if (t.p) return { ok: false, reason: 'この家にはもう住む人がいます' };
      if (m.food < m.people + 1) return { ok: false, reason: '迎える人の食物を用意しましょう' };
      t.p = String(opt.name || '').trim().slice(0, 20) || 'なつかしい友';
      reunion = s.hopes.some((h) => h.kind === 'person' && h.text === t.p);
      got('welcome');
      if (allMetrics(s).people >= 3) got('tears');
      refreshEnergy(s);
      break;
    }
    case 'sign': {
      const text = String(opt.text || '').trim().slice(0, 80);
      if (!text) return { ok: false, reason: '看板に書く希望を選んでください' };
      t.s = text; break;
    }
    default: break;
  }
  if (!['sign', 'animal', 'welcome', 'teach'].includes(action)) delete t.s; // 作業すると看板は片づける
  s.energy -= A.cost;
  s.log.unshift({ day: s.day, text: `${A.label}（${x + 1},${y + 1}）` });
  s.log.length = Math.min(s.log.length, 30);
  cards.push(...checkChapter(s));
  return { ok: true, card: cards[0], cards, reunion };
}

export function switchRegion(s, id) {
  if (!REGIONS[id]) return { ok: false, reason: 'その地域はありません' };
  if (id !== 'valley' && s.chapter < 4) return { ok: false, reason: 'ほかの地域へは第4章「地球全体へ」から行けます' };
  if (id === s.region) return { ok: true, cards: [] };
  s.regions[s.region] = s.tiles;
  if (!s.regions[id]) s.regions[id] = genRegion(s.seed, id);
  s.tiles = s.regions[id];
  s.region = id;
  const cards = [];
  if (id !== 'valley') { const c = unlock(s, id); if (c) cards.push(c); }
  return { ok: true, card: cards[0], cards };
}

export function endDay(s) {
  let grown = 0;
  const cards = [];
  const got = (id) => { const c = unlock(s, id); if (c) cards.push(c); };
  for (const tiles of Object.values(regionsOf(s))) {
    tiles.forEach((t, i) => {
      const x = i % W, y = Math.floor(i / W);
      const wet = wetAt(tiles, x, y);
      const rate = { field: 0.34, orchard: 0.15, flower: 0.5, house: 1, school: 1 }[t.k];
      if (rate && t.g < 1 && (wet || t.k === 'flower' || t.k === 'house' || t.k === 'school')) {
        t.g = Math.min(1, t.g + rate); grown++;
        if (t.k === 'orchard' && t.g >= 1) got('fig');
      } else if (t.k === 'soil' && wet) { t.k = 'grass'; grown++; }
    });
    flow(tiles);
  }
  s.day += 1;
  s.energy = s.maxEnergy;
  if (s.day >= 7) got('health');
  cards.push(...checkChapter(s));
  return { grown, card: cards[0], cards };
}

// 歩いて見る：その位置に立てるか（fx, fy はマス単位の実数）
const SOLID = new Set(['house', 'school', 'sea', 'well']);
export function canWalk(s, fx, fy) {
  if (!(fx >= 0.2 && fy >= 0.2 && fx <= W - 0.2 && fy <= H - 0.2)) return false;
  return !SOLID.has(s.tiles[idx(Math.floor(fx), Math.floor(fy))].k);
}

export function addHope(s, who, text, kind = 'do') {
  const t = String(text || '').trim().slice(0, 80);
  if (!t) return null;
  const k = kind === 'person' ? 'person' : 'do';
  const e = { who: String(who || '').trim().slice(0, 20) || '家族', text: k === 'person' ? t.slice(0, 20) : t, kind: k, day: s.day };
  s.hopes.push(e);
  return e;
}

export function saveState(storage, s) {
  try {
    const others = { ...s.regions };
    delete others[s.region]; // 今いる地域は tiles に入れる（重複を避ける）
    storage.setItem(KEY, JSON.stringify({ ...s, regions: others, pendingCards: undefined }));
    return true;
  } catch { return false; }
}

const KINDS = new Set(['rubble', 'weeds', 'soil', 'grass', 'field', 'orchard', 'flower', 'well', 'bed', 'open', 'stream', 'spring', 'house', 'school', 'sand', 'sea']);
const str = (v, n) => (typeof v === 'string' && v.trim() ? v.slice(0, n) : undefined);
const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function cleanTiles(arr) {
  if (!Array.isArray(arr) || arr.length !== W * H) return null;
  if (!arr.every((t) => t && KINDS.has(t.k))) return null;
  if (arr.filter((t) => t.k === 'spring').length !== 1) return null;
  return arr.map((t) => {
    const n = { k: t.k, g: num(t.g, 0, 1, 0), v: Math.floor(num(t.v, 0, 3, 0)) };
    if (ANIMAL_KINDS.has(t.a)) n.a = t.a;
    const p = str(t.p, 20); if (p && t.k === 'house') { n.p = p; if (t.t) n.t = 1; }
    const sg = str(t.s, 80); if (sg) n.s = sg;
    return n;
  });
}

// 読み込んだデータは信用せず、知っている形だけを取り出す（第1章の保存データも読める）
export function parseState(json) {
  try {
    const o = JSON.parse(json);
    if (!o || !Number.isFinite(o.day)) return null;
    const tiles = cleanTiles(o.tiles);
    if (!tiles) return null;
    const chapter = Math.floor(num(o.chapter, 1, 5, 1));
    const region = REGIONS[o.region] ? o.region : 'valley';
    if (region !== 'valley' && chapter < 4) return null; // つじつまの合わないデータは読まない
    const regions = {};
    if (o.regions && typeof o.regions === 'object') {
      for (const id of Object.keys(REGIONS)) {
        if (id === region) continue;
        const r = cleanTiles(o.regions[id]);
        if (r) regions[id] = r;
      }
    }
    regions[region] = tiles;
    const s = {
      version: 2,
      seed: Number.isFinite(o.seed) ? o.seed : 1,
      day: Math.floor(num(o.day, 1, 1e6, 1)),
      chapter, region, regions, tiles,
      hopes: (Array.isArray(o.hopes) ? o.hopes : []).filter((h) => h && str(h.text, 80)).slice(0, 500)
        .map((h) => ({ who: str(h.who, 20) || '家族', text: str(h.text, 80), kind: h.kind === 'person' ? 'person' : 'do', day: Math.floor(num(h.day, 1, 1e6, 1)) })),
      unlocked: (Array.isArray(o.unlocked) ? o.unlocked : []).filter((c) => typeof c === 'string').slice(0, 80),
      log: [],
    };
    refreshEnergy(s);
    s.energy = Math.floor(num(o.energy, 0, s.maxEnergy, s.maxEnergy));
    s.pendingCards = checkChapter(s); // 読み込みで章が進んだときのカード（画面側で表示して消す）
    return s;
  } catch { return null; }
}

export function loadState(storage) {
  let raw = null;
  try { raw = storage.getItem(KEY); } catch { /* 使えない環境 */ }
  return (raw && parseState(raw)) || newState();
}
