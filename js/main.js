import { ACTIONS, act, endDay, metrics, addHope, saveState, loadState, parseState, newState, unlock, idx } from './game.js';
import { CARDS, CARD_ORDER, ANIMALS } from './content.js';
import { Renderer, skyPhase, DAY_SECONDS } from './render.js';
import { Soundscape } from './audio.js';

const $ = (id) => document.getElementById(id);
const memory = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const store = (() => { try { localStorage.getItem('paradise.v1'); return localStorage; } catch { return memory(); } })();
const pref = (k, v) => { try { if (v === undefined) return store.getItem(k); store.setItem(k, v); } catch { /* 容量不足など */ } return null; };

let state = loadState(store);
const renderer = new Renderer($('world'));
const audio = new Soundscape();
let tool = 'look';
let hover = null;
let clockOffset = DAY_SECONDS * 0.08; // 朝から始める
const clockParam = Number(new URLSearchParams(location.search).get('clock')); // 例 ?clock=0.85 で夜を確認
if (clockParam > 0 && clockParam < 1) clockOffset = DAY_SECONDS * clockParam;
let busy = false;
const cardQueue = [];

const ICONS = { look: '👆', clear: '🪨', channel: '💧', well: '⛲', field: '🌾', orchard: '🍇', flower: '🌸', house: '🏠', animal: '🐑', welcome: '🤝', sign: '🪧' };
const SFX = { clear: 'dig', channel: 'water', well: 'water', field: 'plant', orchard: 'plant', flower: 'plant', house: 'hammer', animal: 'animal', welcome: 'welcome', sign: 'plant' };
const NAMES = { rubble: 'がれき', weeds: '枯れた雑草', soil: '土', grass: '草地', flower: '花畑', field: '畑', orchard: '果樹', well: '井戸', bed: '干上がった川床', open: '掘った水路（まだ水が来ていない）', stream: '小川', spring: '泉', house: '家' };

// ---------- 小さなDOMヘルパー（利用者の文字は必ず textContent で入れる） ----------
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') Object.entries(v).forEach(([ev, fn]) => e.addEventListener(ev, fn));
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => e.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return e;
}

let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

let onModalClose = null;
function openModal(...content) {
  const b = $('modalBody'); b.replaceChildren(...content);
  $('modal').classList.add('show');
}
function closeModal() {
  $('modal').classList.remove('show');
  const fn = onModalClose; onModalClose = null; if (fn) fn();
  if (cardQueue.length) setTimeout(nextCard, 250);
}
$('modal').querySelector('.close').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modal').classList.contains('show')) closeModal(); });

// ---------- 黙想カード ----------
function queueCards(ids = []) { ids.filter(Boolean).forEach((id) => cardQueue.push(id)); nextCard(); }
function nextCard() { if (busy || $('modal').classList.contains('show')) return; const id = cardQueue.shift(); if (id) showCard(id); }
function cardView(id) {
  const c = CARDS[id];
  return el('div', { class: 'card' },
    el('h2', {}, c.title),
    el('a', { class: 'ref', href: c.link, target: '_blank', rel: 'noopener' }, `📖 ${c.ref}（jw.orgで読む）`),
    el('p', { class: 'sum' }, c.summary),
    el('div', { class: 'q' }, el('b', {}, '家族で話し合おう'), c.question));
}
function showCard(id) {
  audio.sfx('card');
  openModal(cardView(id), el('div', { class: 'row' }, el('button', { class: 'primary', on: { click: closeModal } }, 'とじる')));
}
function showCardList() {
  const list = el('div', { class: 'cardlist' });
  CARD_ORDER.forEach((id) => {
    const open = state.unlocked.includes(id);
    list.append(el('button', open ? { on: { click: () => showCard(id) } } : { class: 'locked', disabled: '' }, open ? `📖 ${CARDS[id].title}（${CARDS[id].ref}）` : '🔒 まだ見つかっていません'));
  });
  openModal(el('h2', {}, '黙想カード'), el('p', { class: 'muted' }, '楽園づくりの節目で見つかります。家族の崇拝で一枚ずつ読んで話し合えます。'), list);
}

// ---------- 希望ノート ----------
function showHopes() {
  const who = el('input', { type: 'text', placeholder: '名前（例：お父さん）', maxlength: '20', value: pref('paradise.who') || '' });
  const kind = el('select', {}, el('option', { value: 'do' }, '楽園でしたいこと'), el('option', { value: 'person' }, '迎えたい人'));
  const text = el('input', { type: 'text', placeholder: '例：家族で川で泳ぐ／おばあちゃん', maxlength: '80' });
  const list = el('ul', { class: 'hopes' });
  const render = () => {
    list.replaceChildren(...(state.hopes.length ? state.hopes.slice().reverse().map((h) =>
      el('li', {}, el('span', { class: 'who' }, `${h.who}・${h.kind === 'person' ? '迎えたい人' : 'したいこと'}`), h.text))
      : [el('li', { class: 'muted' }, 'まだ何も書かれていません。家族一人一人の希望を書いてみましょう。')]));
  };
  kind.addEventListener('change', () => { text.maxLength = kind.value === 'person' ? 20 : 80; });
  const form = el('form', { class: 'row', on: { submit: (e) => {
    e.preventDefault();
    const h = addHope(state, who.value, text.value, kind.value);
    if (!h) return toast('希望を書いてください');
    pref('paradise.who', h.who);
    text.value = ''; save(); render(); audio.sfx('plant');
  } } }, who, kind, text, el('button', { class: 'primary', type: 'submit' }, '書く'));
  render();
  openModal(el('h2', {}, '希望ノート'),
    el('p', { class: 'muted' }, '「したいこと」は🪧希望の看板として大地に立てられます。「迎えたい人」は🤝迎えるときに名前として選べます。'),
    form, list);
}

function pickFromHopes(kindWanted, title, placeholder, onPick) {
  const options = [...new Set(state.hopes.filter((h) => h.kind === kindWanted).map((h) => h.text))];
  const input = el('input', { type: 'text', placeholder, maxlength: kindWanted === 'person' ? '20' : '80' });
  const done = (v) => { const val = String(v || '').trim(); if (!val) return toast('入力してください'); onModalClose = null; $('modal').classList.remove('show'); onPick(val); if (cardQueue.length) setTimeout(nextCard, 250); };
  openModal(el('h2', {}, title),
    options.length ? el('div', { class: 'pick' }, ...options.map((o) => el('button', { on: { click: () => done(o) } }, o))) : el('p', { class: 'muted' }, '希望ノートに書いておくと、ここから選べます。'),
    el('form', { class: 'row', on: { submit: (e) => { e.preventDefault(); done(input.value); } } }, input, el('button', { class: 'primary', type: 'submit' }, '決める')));
  setTimeout(() => input.focus(), 50);
}

// ---------- 設定 ----------
function showSettings() {
  const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(audio.volume) });
  vol.addEventListener('input', () => { audio.setVolume(Number(vol.value)); pref('paradise.vol', vol.value); });
  const mute = el('button', { on: { click: () => { audio.setMuted(!audio.muted); pref('paradise.mute', audio.muted ? '1' : '0'); mute.textContent = audio.muted ? '🔇 消音中' : '🔊 音あり'; } } }, audio.muted ? '🔇 消音中' : '🔊 音あり');
  const file = el('input', { type: 'file', accept: 'application/json,.json' });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f || busy) return;
    const s = parseState(await f.text());
    if (!s) return toast('読み込めないファイルでした');
    state = s; cardQueue.length = 0; save(); closeModal(); toast(`${state.day}日目の楽園を読み込みました`);
  });
  const reset = el('button', { on: { click: () => {
    if (busy) return;
    if (reset.dataset.armed) { state = newState(); cardQueue.length = 0; save(); closeModal(); toast('新しい大地で始めます'); queueCards([unlock(state, 'morning')]); return; }
    reset.dataset.armed = '1'; reset.textContent = '本当に最初から？もう一度押すと消えます';
  } } }, '最初からやり直す');
  openModal(el('h2', {}, '設定'),
    el('div', { class: 'row' }, '音量 ', vol, mute),
    el('div', { class: 'row' }, el('button', { on: { click: exportSave } }, '💾 保存データを書き出す')),
    el('div', { class: 'row' }, '📂 読み込む：', file),
    el('p', { class: 'muted' }, '保存はこの端末のブラウザに自動で残ります。機種変更のときは書き出して、新しい端末で読み込んでください。'),
    el('div', { class: 'row' }, reset));
}
function exportSave() {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `paradise-${state.day}日目.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- 作業 ----------
function buildTools() {
  const nav = $('tools');
  const entries = [['look', { label: '見る', cost: 0 }], ...Object.entries(ACTIONS)];
  nav.replaceChildren(...entries.map(([k, a]) => el('button', { 'data-k': k, title: a.hint || 'マスを調べる', on: { click: () => { tool = k; buildTools(); if (a.hint) toast(`${a.label}：${a.hint}`); } }, class: k === tool ? 'sel' : '' },
    el('span', { class: 'ic' }, ICONS[k]), a.label, el('span', { class: 'c' }, a.cost ? `労力${a.cost}` : '　'))));
}

function describe(x, y) {
  const t = state.tiles[idx(x, y)];
  let s = NAMES[t.k] || t.k;
  if (t.k === 'field' || t.k === 'orchard') s += t.g >= 1 ? '（実っています）' : `（育ち具合 ${Math.round(t.g * 100)}%）`;
  if (t.k === 'house') s += t.p ? `：${t.p}さんの家` : '（空き家・🤝で人を迎えられます）';
  if (t.a) s += `・${ANIMALS[t.a] || '動物'}がいます`;
  if (t.s) s += `・🪧「${t.s}」`;
  return s;
}

function doAction(x, y, opt) {
  const r = act(state, tool, x, y, opt);
  if (!r.ok) { audio.sfx('deny'); toast(r.reason); return; }
  audio.sfx(SFX[tool]);
  if (tool === 'welcome') toast(`🤝 ${state.tiles[idx(x, y)].p}さんを迎えました！`);
  else if (tool === 'animal') toast(`${ANIMALS[state.tiles[idx(x, y)].a]}がやって来ました`);
  save(); queueCards(r.cards);
}

function onTap(px, py) {
  if (busy) return;
  const p = renderer.tileAt(px, py);
  if (!p) return;
  if (tool === 'look') return toast(describe(p.x, p.y));
  if (tool === 'welcome') {
    const t = state.tiles[idx(p.x, p.y)];
    if (t.k !== 'house' || t.p) return doAction(p.x, p.y, {}); // 理由はロジックに任せる
    return pickFromHopes('person', '🤝 だれを迎えますか？', '名前（例：おじいちゃん）', (name) => doAction(p.x, p.y, { name }));
  }
  if (tool === 'sign') {
    const t = state.tiles[idx(p.x, p.y)];
    if (!ACTIONS.sign.on.includes(t.k)) return doAction(p.x, p.y, {});
    return pickFromHopes('do', '🪧 看板に書く希望', '例：家族で川で泳ぐ', (text) => doAction(p.x, p.y, { text }));
  }
  doAction(p.x, p.y);
}

const canvas = $('world');
canvas.addEventListener('click', (e) => onTap(e.clientX, e.clientY));
canvas.addEventListener('mousemove', (e) => { hover = renderer.tileAt(e.clientX, e.clientY); });
canvas.addEventListener('mouseleave', () => { hover = null; });
window.addEventListener('resize', () => renderer.resize());

$('btnDay').addEventListener('click', () => {
  if (busy) return;
  busy = true;
  audio.sfx('night');
  $('fadeText').textContent = `${state.day}日目が終わります…`;
  $('fade').classList.add('show');
  setTimeout(() => {
    let r = { grown: 0, cards: [] };
    try {
      r = endDay(state);
      save();
      clockOffset += DAY_SECONDS - (now() % DAY_SECONDS) + DAY_SECONDS * 0.06; // 画面も朝へ
      $('fadeText').textContent = `${state.day}日目の朝`;
    } catch (e) { console.error(e); }
    setTimeout(() => {
      $('fade').classList.remove('show');
      busy = false;
      toast(r.grown ? `夜の間に ${r.grown} か所が育ちました` : '新しい一日が始まりました');
      queueCards(r.cards);
    }, 1300);
  }, 1400);
});
const unlessBusy = (fn) => () => { if (!busy) fn(); };
$('btnCards').addEventListener('click', unlessBusy(showCardList));
$('btnHopes').addEventListener('click', unlessBusy(showHopes));
$('btnSettings').addEventListener('click', unlessBusy(showSettings));
$('btnStart').addEventListener('click', () => {
  try { audio.start(); audio.setVolume(Number(pref('paradise.vol') ?? 0.8)); audio.setMuted(pref('paradise.mute') === '1'); } catch (e) { console.error(e); }
  $('title').classList.remove('show');
  queueCards([unlock(state, 'morning')]);
  save();
});

let warnedSave = false;
function save() {
  if (saveState(store, state)) { warnedSave = false; return; }
  if (!warnedSave) { warnedSave = true; toast('この端末に保存できませんでした。⚙設定から書き出しておいてください'); }
}

// ---------- HUD と描画ループ ----------
function hud(m) {
  $('day').textContent = state.day;
  const dots = $('energy');
  if (dots.childElementCount !== state.maxEnergy || dots.dataset.e !== String(state.energy)) {
    dots.replaceChildren(...Array.from({ length: state.maxEnergy }, (_, i) => el('i', i < state.energy ? {} : { class: 'off' })));
    dots.dataset.e = state.energy;
  }
  $('pbar').style.width = `${m.total}%`;
  $('ptotal').textContent = m.total;
  $('mstats').textContent = `🌿${m.green} 🌾${m.food} 🏠${m.homes} 💧${m.water} 🐑${m.animals} 🤝${m.people}`;
}

const now = () => performance.now() / 1000 + clockOffset;
let lastHud = 0;
let lastDraw = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  if (ms - lastDraw < 32) return; // 毎秒30コマ程度に抑えて古いタブレットでも軽く
  lastDraw = ms;
  try { drawFrame(); } catch (e) { console.error(e); }
}
function drawFrame() {
  const t = now();
  const m = metrics(state);
  renderer.draw(state, m, t, tool === 'look' ? null : hover);
  if (t - lastHud > 0.25) {
    lastHud = t; hud(m);
    const sky = skyPhase(t);
    audio.setMix({ green: Math.min(1, m.green / 120), water: Math.min(1, m.water / 25), night: sky.night, total: m.total / 100 });
  }
}

buildTools();
if (state.day > 1 || state.unlocked.length) $('btnStart').textContent = `${state.day}日目から続ける`;
requestAnimationFrame(frame);
