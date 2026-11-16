import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  W, H, idx, newState, act, endDay, allMetrics, switchRegion, saveState, loadState, parseState, canWalk, addHope, metrics, isWatered, genRegion,
} from '../js/game.js';
import { CARDS, CARD_ORDER, weeklyTheme, season } from '../js/content.js';

const memStore = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const xy = (i) => [i % W, Math.floor(i / W)];

// 谷を一気に育てるヘルパー
function grow(s) {
  s.energy = 1e9;
  s.tiles.forEach((t, i) => { if (t.k === 'bed') act(s, 'channel', ...xy(i)); });
  s.tiles.forEach((t, i) => { if (['rubble', 'weeds', 'sand'].includes(t.k)) act(s, 'clear', ...xy(i)); });
  endDay(s); s.energy = 1e9;
  s.tiles.forEach((t, i) => { if ((t.k === 'grass' || t.k === 'soil') && i % 3 === 0) act(s, 'field', ...xy(i)); else if (t.k === 'soil' && i % 5 === 1) act(s, 'orchard', ...xy(i)); });
  for (let d = 0; d < 7; d++) { endDay(s); s.energy = 1e9; }
}
function freeWetLand(s) {
  const i = s.tiles.findIndex((t, j) => (t.k === 'grass' || t.k === 'soil') && !t.a && isWatered(s, ...xy(j)));
  return xy(i);
}

test('すべてのカードに要約・問い・jw.orgリンクがある', () => {
  assert.equal(CARD_ORDER.length, 20);
  for (const id of CARD_ORDER) {
    const c = CARDS[id];
    assert.ok(c && c.summary && c.question && c.link.startsWith('https://www.jw.org/finder'), id);
  }
});

test('新しい行動は章が来るまで使えない', () => {
  const s = newState(4);
  s.energy = 99;
  const [x, y] = xy(s.tiles.findIndex((t) => t.k === 'soil'));
  const r = act(s, 'school', x, y);
  assert.equal(r.ok, false);
  assert.match(r.reason, /第2章/);
  assert.equal(switchRegion(s, 'coast').ok, false);
});

test('第2章：人を迎え谷が育つと解放され、学びの家で教えられる', () => {
  const s = newState(4);
  grow(s);
  const [hx, hy] = freeWetLand(s);
  assert.equal(act(s, 'house', hx, hy).ok, true);
  addHope(s, 'りょう', 'おばあちゃん', 'person');
  const r = act(s, 'welcome', hx, hy, { name: 'おばあちゃん' });
  assert.equal(r.reunion, true);
  assert.equal(s.chapter >= 2, true, `total ${metrics(s).total}`);
  assert.ok(s.unlocked.includes('ch2'));
  assert.match(act(s, 'teach', hx, hy).reason, /学びの家/);
  const [sx, sy] = freeWetLand(s);
  assert.equal(act(s, 'school', sx, sy).ok, true);
  assert.equal(act(s, 'teach', hx, hy).ok, true);
  assert.equal(act(s, 'teach', hx, hy).ok, false);
  assert.equal(allMetrics(s).taught, 1);
});

test('名前が希望ノートになければ再会の場面にはならない', () => {
  const s = newState(4);
  grow(s);
  const [hx, hy] = freeWetLand(s);
  act(s, 'house', hx, hy);
  assert.equal(act(s, 'welcome', hx, hy, { name: 'たろう' }).reunion, false);
});

test('野生の動物は第3章から', () => {
  const s = newState(4);
  grow(s);
  const [x, y] = xy(s.tiles.findIndex((t) => t.k === 'grass'));
  assert.match(act(s, 'animal', x, y, { kind: 'lion' }).reason, /第3章/);
  s.chapter = 3;
  const r = act(s, 'animal', x, y, { kind: 'lion' });
  assert.equal(r.ok, true);
  assert.ok(r.cards.includes('lionstraw'));
});

test('地域を移動しても他の地域は保たれ、保存しても戻る', () => {
  const s = newState(9);
  s.chapter = 4;
  s.energy = 99;
  const ri = s.tiles.findIndex((t) => t.k === 'rubble');
  act(s, 'clear', ...xy(ri));
  const r = switchRegion(s, 'coast');
  assert.equal(r.ok, true);
  assert.deepEqual(r.cards, ['coast']);
  assert.equal(s.region, 'coast');
  assert.ok(s.tiles.some((t) => t.k === 'sea'));
  assert.ok(s.tiles.some((t) => t.k === 'sand'));
  const st = memStore();
  saveState(st, s);
  const t = loadState(st);
  assert.equal(t.region, 'coast');
  assert.equal(t.regions.valley[ri].k, 'soil');
  switchRegion(t, 'valley');
  assert.equal(t.tiles[ri].k, 'soil');
  assert.equal(t.tiles, t.regions.valley);
});

test('荒れ野は砂が多く、砂を整地すると土になる', () => {
  const tiles = genRegion(5, 'desert');
  assert.ok(tiles.filter((t) => t.k === 'sand').length > W * H * 0.5);
  const s = newState(5); s.chapter = 4; switchRegion(s, 'desert'); s.energy = 9;
  const i = s.tiles.findIndex((t) => t.k === 'sand');
  assert.equal(act(s, 'clear', ...xy(i)).ok, true);
  assert.equal(s.tiles[i].k, 'soil');
});

test('一日を終えると、ほかの地域の作物も育つ', () => {
  const s = newState(9);
  s.chapter = 4; s.energy = 1e9;
  s.tiles.forEach((t, i) => { if (t.k === 'bed') act(s, 'channel', ...xy(i)); });
  const [x, y] = freeWetLand(s.tiles.some((t) => t.k === 'soil' || t.k === 'grass') ? s : s);
  act(s, 'field', x, y);
  switchRegion(s, 'mountain');
  endDay(s); endDay(s); endDay(s);
  assert.ok(s.regions.valley[idx(x, y)].g >= 1);
});

test('第1章の古い保存データ（regions なし）も谷として読める', () => {
  const s = newState(2);
  const old = { seed: s.seed, day: 5, energy: 3, maxEnergy: 6, tiles: s.tiles, hopes: [], unlocked: ['morning'] };
  const t = parseState(JSON.stringify(old));
  assert.equal(t.region, 'valley');
  assert.equal(t.chapter, 1);
  assert.equal(t.day, 5);
  assert.equal(t.tiles, t.regions.valley);
});

test('章の条件を満たさない保存データで別地域にはいられない', () => {
  const s = newState(2);
  const t = parseState(JSON.stringify({ ...s, region: 'desert', chapter: 1, regions: {} }));
  assert.equal(t.region, 'valley');
});

test('歩いて見る：家・海・地図の外には入れない', () => {
  const s = newState(9);
  s.chapter = 4;
  switchRegion(s, 'coast');
  assert.equal(canWalk(s, -1, 3), false);
  assert.equal(canWalk(s, 5.5, H - 1.5), false); // 海
  const i = s.tiles.findIndex((t) => t.k === 'weeds');
  assert.equal(canWalk(s, (i % W) + 0.5, Math.floor(i / W) + 0.5), true);
  s.tiles[i].k = 'house';
  assert.equal(canWalk(s, (i % W) + 0.5, Math.floor(i / W) + 0.5), false);
});

test('今週のテーマは週ごとに決まり、季節は月で決まる', () => {
  const a = weeklyTheme(new Date('2026-11-16T10:00:00'));
  const b = weeklyTheme(new Date('2026-11-22T10:00:00'));
  const c = weeklyTheme(new Date('2026-11-23T10:00:00'));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(CARDS[a.card] && a.activity);
  assert.equal(season(new Date('2026-04-01')), 'spring');
  assert.equal(season(new Date('2026-11-16')), 'autumn');
});
