import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  W, H, newState, act, endDay, metrics, addHope, saveState, loadState, unlock, idx, isWatered,
} from '../js/game.js';

const find = (s, k) => {
  const i = s.tiles.findIndex((t) => t.k === k);
  return { x: i % W, y: Math.floor(i / W) };
};
const memStore = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };

// 水のある土地を用意するヘルパー：川を全部開いて流す
function openStream(s) {
  s.energy = 999;
  s.tiles.forEach((t, i) => { if (t.k === 'bed') act(s, 'channel', i % W, Math.floor(i / W)); });
}
function wateredSoil(s) {
  for (let i = 0; i < s.tiles.length; i++) {
    const x = i % W, y = Math.floor(i / W);
    const t = s.tiles[i];
    if ((t.k === 'rubble' || t.k === 'weeds') && isWatered(s, x, y)) { act(s, 'clear', x, y); return { x, y }; }
    if (t.k === 'soil' && isWatered(s, x, y)) return { x, y };
  }
  throw new Error('no watered soil');
}

test('初期状態：がれき・雑草・干上がった川床と泉がある', () => {
  const s = newState(1);
  assert.equal(s.tiles.length, W * H);
  assert.ok(s.tiles.some((t) => t.k === 'rubble'));
  assert.ok(s.tiles.some((t) => t.k === 'weeds'));
  assert.ok(s.tiles.filter((t) => t.k === 'bed').length >= W - 2);
  assert.equal(s.tiles.filter((t) => t.k === 'spring').length, 1);
  assert.equal(s.day, 1);
  assert.equal(s.energy, s.maxEnergy);
});

test('整地すると土になり労力が1減る', () => {
  const s = newState(1);
  const { x, y } = find(s, 'rubble');
  const e = s.energy;
  const r = act(s, 'clear', x, y);
  assert.equal(r.ok, true);
  assert.equal(s.tiles[idx(x, y)].k, 'soil');
  assert.equal(s.energy, e - 1);
});

test('労力が足りないと拒否され、何も変わらない', () => {
  const s = newState(1);
  s.energy = 0;
  const { x, y } = find(s, 'rubble');
  const r = act(s, 'clear', x, y);
  assert.equal(r.ok, false);
  assert.match(r.reason, /労力/);
  assert.equal(s.tiles[idx(x, y)].k, 'rubble');
});

test('対象外のマスには行動できない', () => {
  const s = newState(1);
  const { x, y } = find(s, 'rubble');
  const r = act(s, 'field', x, y);
  assert.equal(r.ok, false);
  assert.equal(s.tiles[idx(x, y)].k, 'rubble');
});

test('水のない場所に家は建てられず、理由に「水」が含まれる', () => {
  const s = newState(1);
  s.energy = 99;
  // 泉や川床から遠い場所を探して整地
  let target = null;
  for (let i = 0; i < s.tiles.length && !target; i++) {
    const x = i % W, y = Math.floor(i / W);
    if (s.tiles[i].k === 'rubble' || s.tiles[i].k === 'weeds') { act(s, 'clear', x, y); if (!isWatered(s, x, y)) target = { x, y }; }
  }
  const r = act(s, 'house', target.x, target.y);
  assert.equal(r.ok, false);
  assert.match(r.reason, /水/);
});

test('泉につながる川床を開くと水が流れ、最初の一回だけカードが出る', () => {
  const s = newState(1);
  s.energy = 999;
  const cards = [];
  s.tiles.forEach((t, i) => { if (t.k === 'bed') { const r = act(s, 'channel', i % W, Math.floor(i / W)); if (r.card) cards.push(r.card); } });
  assert.ok(s.tiles.filter((t) => t.k === 'stream').length >= W - 2);
  assert.deepEqual(cards.filter((c) => c === 'water'), ['water']);
  assert.equal(s.unlocked.filter((c) => c === 'water').length, 1);
});

test('畑は3日で実り、食物が増える', () => {
  const s = newState(1);
  openStream(s);
  const { x, y } = wateredSoil(s);
  assert.equal(act(s, 'field', x, y).ok, true);
  const before = metrics(s).food;
  endDay(s); endDay(s); endDay(s);
  assert.ok(s.tiles[idx(x, y)].g >= 1);
  assert.ok(metrics(s).food > before);
});

test('一日を終えると日が進み労力が回復する', () => {
  const s = newState(1);
  s.energy = 0;
  endDay(s);
  assert.equal(s.day, 2);
  assert.equal(s.energy, s.maxEnergy);
});

test('食物と水があれば家を建て、名前を付けて人を迎えられる', () => {
  const s = newState(1);
  openStream(s);
  const f = wateredSoil(s);
  act(s, 'field', f.x, f.y);
  // 食物なしでは家は不可
  const h = wateredSoil(s);
  assert.match(act(s, 'house', h.x, h.y).reason, /食物/);
  endDay(s); endDay(s); endDay(s);
  s.energy = 99;
  assert.equal(act(s, 'house', h.x, h.y).ok, true);
  const r = act(s, 'welcome', h.x, h.y, { name: 'おばあちゃん' });
  assert.equal(r.ok, true);
  assert.equal(s.tiles[idx(h.x, h.y)].p, 'おばあちゃん');
  assert.equal(metrics(s).people, 1);
  assert.equal(r.card, 'welcome');
  // 迎えた人は働き手になる
  assert.ok(s.maxEnergy > 6);
  // 同じ家に二人目は不可
  assert.equal(act(s, 'welcome', h.x, h.y, { name: 'x' }).ok, false);
});

test('楽園度は作業を進めると増え、0〜100に収まる', () => {
  const s = newState(1);
  const m0 = metrics(s).total;
  openStream(s);
  const m1 = metrics(s).total;
  const f = wateredSoil(s);
  act(s, 'field', f.x, f.y);
  endDay(s); endDay(s); endDay(s);
  const m2 = metrics(s).total;
  assert.ok(m0 < m1 && m1 < m2, `${m0} ${m1} ${m2}`);
  assert.ok(m2 >= 0 && m2 <= 100);
});

test('壊れた保存データでも初期状態で起動する', () => {
  const st = memStore();
  st.setItem('paradise.v1', '{壊れた');
  const s = loadState(st);
  assert.equal(s.day, 1);
  assert.equal(s.tiles.length, W * H);
  st.setItem('paradise.v1', JSON.stringify({ day: 3, tiles: [1, 2] }));
  assert.equal(loadState(st).tiles.length, W * H);
});

test('保存して読み込むと同じ状態に戻る', () => {
  const st = memStore();
  const s = newState(2);
  act(s, 'clear', find(s, 'rubble').x, find(s, 'rubble').y);
  endDay(s);
  saveState(st, s);
  const t = loadState(st);
  assert.equal(t.day, 2);
  assert.deepEqual(t.tiles, s.tiles);
});

test('希望ノートは80字で切られ、空文字は無視される', () => {
  const s = newState(1);
  assert.equal(addHope(s, 'りょう', '   ', 'do'), null);
  const e = addHope(s, 'りょう', 'あ'.repeat(200), 'do');
  assert.equal(e.text.length, 80);
  assert.equal(s.hopes.length, 1);
  assert.equal(addHope(s, 'みき', '<b>祖父</b>', 'person').text, '<b>祖父</b>');
});

test('看板に希望を書いて置ける', () => {
  const s = newState(1);
  const { x, y } = find(s, 'rubble');
  act(s, 'clear', x, y);
  assert.equal(act(s, 'sign', x, y, { text: '家族で川で泳ぐ' }).ok, true);
  assert.equal(s.tiles[idx(x, y)].s, '家族で川で泳ぐ');
});

test('unlock は同じカードを二度返さない', () => {
  const s = newState(1);
  assert.equal(unlock(s, 'morning'), 'morning');
  assert.equal(unlock(s, 'morning'), null);
});

test('読み込みデータの危ない値は丸められる（監査対応）', async () => {
  const { parseState } = await import('../js/game.js');
  const s = newState(3);
  const o = JSON.parse(JSON.stringify(s));
  o.maxEnergy = 1e9; o.energy = -5; o.hopes = [null, { text: 'x'.repeat(500), who: 1 }, 'bad'];
  o.tiles[5].p = 'y'.repeat(5000); o.tiles[6].a = 'dragon'; o.tiles[7].g = 99;
  const t = parseState(JSON.stringify(o));
  assert.equal(t.maxEnergy, 6);
  assert.equal(t.energy, 0);
  assert.equal(t.hopes.length, 1);
  assert.equal(t.hopes[0].text.length, 80);
  assert.equal(t.tiles[5].p, undefined); // 家以外の住人名は捨てる
  assert.equal(t.tiles[6].a, undefined);
  assert.equal(t.tiles[7].g, 1);
  o.tiles[0].k = 'castle';
  assert.equal(parseState(JSON.stringify(o)), null);
});

test('看板の上でも作業でき、看板は片づく', () => {
  const s = newState(1);
  s.energy = 99;
  const { x, y } = find(s, 'rubble');
  act(s, 'clear', x, y);
  act(s, 'sign', x, y, { text: '泳ぐ' });
  assert.equal(act(s, 'flower', x, y).ok, true);
  assert.equal(s.tiles[idx(x, y)].s, undefined);
});

test('迎えたい人の名前は20字まで', () => {
  const s = newState(1);
  assert.equal(addHope(s, 'a', 'い'.repeat(50), 'person').text.length, 20);
});
