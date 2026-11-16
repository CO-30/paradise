import {
  ACTIONS, act, endDay, metrics, allMetrics, addHope, saveState, loadState, parseState, newState, unlock, idx,
  REGIONS, switchRegion, CHAPTERS, CHAPTER_GOALS,
} from './game.js';
import { CARDS, CARD_ORDER, ANIMALS, weeklyTheme, season } from './content.js';
import { Renderer, skyPhase, DAY_SECONDS } from './render.js';
import { Soundscape, speak, canSpeak } from './audio.js';
import { Walker } from './walk.js';

const $ = (id) => document.getElementById(id);
const memory = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const store = (() => { try { localStorage.getItem('paradise.v1'); return localStorage; } catch { return memory(); } })();
const pref = (k, v) => { try { if (v === undefined) return store.getItem(k); store.setItem(k, v); } catch { /* 容量不足など */ } return null; };

let state = loadState(store);
const renderer = new Renderer($('world'));
renderer.season = season();
const walker = new Walker($('world'), renderer);
const audio = new Soundscape();
let tool = 'look';
let hover = null;
let mode = 'map'; // 'map' | 'walk'
let clockOffset = DAY_SECONDS * 0.08; // 朝から始める
const clockParam = Number(new URLSearchParams(location.search).get('clock')); // 例 ?clock=0.85 で夜を確認
if (clockParam > 0 && clockParam < 1) clockOffset = DAY_SECONDS * clockParam;
let busy = false;
const cardQueue = [];

const ICONS = { look: '👆', clear: '🪨', channel: '💧', well: '⛲', field: '🌾', orchard: '🍇', flower: '🌸', house: '🏠', animal: '🐑', welcome: '🤝', sign: '🪧', school: '🏫', teach: '📖' };
const SFX = { clear: 'dig', channel: 'water', well: 'water', field: 'plant', orchard: 'plant', flower: 'plant', house: 'hammer', school: 'hammer', animal: 'animal', welcome: 'welcome', sign: 'plant', teach: 'card' };
const NAMES = { rubble: 'がれき', weeds: '枯れた雑草', soil: '土', grass: '草地', flower: '花畑', field: '畑', orchard: '果樹', well: '井戸', bed: '干上がった川床', open: '掘った水路（まだ水が来ていない）', stream: '小川', spring: '泉', house: '家', school: '学びの家', sand: '砂地', sea: '海' };

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
const modalOpen = () => $('modal').classList.contains('show') || $('reunion').classList.contains('show');
function openModal(...content) {
  $('modalBody').replaceChildren(...content);
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
function nextCard() { if (busy || modalOpen()) return; const id = cardQueue.shift(); if (id) showCard(id); }
function cardView(id) {
  const c = CARDS[id];
  const parts = [
    el('h2', {}, c.title),
    el('a', { class: 'ref', href: c.link, target: '_blank', rel: 'noopener' }, `📖 ${c.ref}（jw.orgで読む）`),
    el('p', { class: 'sum' }, c.summary),
    el('div', { class: 'q' }, el('b', {}, '家族で話し合おう'), c.question),
  ];
  return el('div', { class: 'card' }, ...parts);
}
function showCard(id) {
  const chapterCard = /^ch\d$/.test(id);
  audio.sfx(chapterCard ? 'chapter' : 'card');
  const c = CARDS[id];
  const row = el('div', { class: 'row' }, el('button', { class: 'primary', on: { click: closeModal } }, 'とじる'));
  if (canSpeak) row.append(el('button', { on: { click: () => speak(`${c.title}。${c.ref}。${c.summary}。家族で話し合おう。${c.question}`) } }, '🔈 読み上げ'));
  const extra = chapterCard ? [el('p', { class: 'chapter-new' }, `第${id[2]}章「${CHAPTERS[id[2]]}」が始まりました。`, chapterNews(Number(id[2])))] : [];
  openModal(...extra, cardView(id), row);
}
function chapterNews(n) {
  return {
    2: ' 🏫学びの家と📖教えるが使えます。希望ノートの「迎えたい人」を迎えると、再会の場面が見られます。',
    3: ' おおかみ・ひょう・ライオン・熊など、野生の動物も迎えられます。',
    4: ' 🗺地域から、海辺・山里・荒れ野へ行けます。',
    5: ' 🚶歩いて見るで、自分たちの楽園の中を散歩できます。',
  }[n] || '';
}
function showCardList() {
  const list = el('div', { class: 'cardlist' });
  CARD_ORDER.forEach((id) => {
    const open = state.unlocked.includes(id);
    list.append(el('button', open ? { on: { click: () => { closeModal(); setTimeout(() => showCard(id), 50); } } } : { class: 'locked', disabled: '' }, open ? `📖 ${CARDS[id].title}（${CARDS[id].ref}）` : '🔒 まだ見つかっていません'));
  });
  openModal(el('h2', {}, `黙想カード（${state.unlocked.filter((u) => CARDS[u]).length}/${CARD_ORDER.length}）`), el('p', { class: 'muted' }, '楽園づくりの節目で見つかります。家族の崇拝で一枚ずつ読んで話し合えます。'), list);
}

// ---------- 今週のテーマ ----------
function showWeekly() {
  const w = weeklyTheme();
  openModal(el('h2', {}, '🗓 今週のテーマ'),
    el('div', { class: 'q' }, el('b', {}, '今週の家族の活動'), w.activity),
    cardView(w.card),
    el('div', { class: 'row' }, el('button', { class: 'primary', on: { click: closeModal } }, 'とじる'),
      canSpeak ? el('button', { on: { click: () => speak(`今週のテーマ。${w.activity}。${CARDS[w.card].summary}`) } }, '🔈 読み上げ') : ''));
}

// ---------- 希望ノート ----------
function showHopes() {
  const who = el('input', { type: 'text', placeholder: '名前（例：お父さん）', maxlength: '20', value: pref('paradise.who') || '' });
  const kind = el('select', {}, el('option', { value: 'do' }, '楽園でしたいこと'), el('option', { value: 'person' }, '迎えたい人'));
  const text = el('input', { type: 'text', placeholder: '例：家族で川で泳ぐ／おばあちゃん', maxlength: '80' });
  kind.addEventListener('change', () => { text.maxLength = kind.value === 'person' ? 20 : 80; });
  const list = el('ul', { class: 'hopes' });
  const render = () => {
    list.replaceChildren(...(state.hopes.length ? state.hopes.slice().reverse().map((h) =>
      el('li', {}, el('span', { class: 'who' }, `${h.who}・${h.kind === 'person' ? '迎えたい人' : 'したいこと'}`), h.text))
      : [el('li', { class: 'muted' }, 'まだ何も書かれていません。家族一人一人の希望を書いてみましょう。')]));
  };
  const form = el('form', { class: 'row', on: { submit: (e) => {
    e.preventDefault();
    const h = addHope(state, who.value, text.value, kind.value);
    if (!h) return toast('希望を書いてください');
    pref('paradise.who', h.who);
    text.value = ''; save(); render(); audio.sfx('plant');
  } } }, who, kind, text, el('button', { class: 'primary', type: 'submit' }, '書く'));
  render();
  openModal(el('h2', {}, '希望ノート'),
    el('p', { class: 'muted' }, '「したいこと」は🪧看板として大地に立てられます。「迎えたい人」は🤝迎えるときに選べて、再会の場面になります。'),
    form, list);
}

function pickFromHopes(kindWanted, title, placeholder, onPick) {
  const options = [...new Set(state.hopes.filter((h) => h.kind === kindWanted).map((h) => h.text))];
  const input = el('input', { type: 'text', placeholder, maxlength: kindWanted === 'person' ? '20' : '80' });
  const done = (v) => {
    const val = String(v || '').trim(); if (!val) return toast('入力してください');
    onModalClose = null; $('modal').classList.remove('show'); onPick(val);
    if (cardQueue.length) setTimeout(nextCard, 250);
  };
  openModal(el('h2', {}, title),
    options.length ? el('div', { class: 'pick' }, ...options.map((o) => el('button', { on: { click: () => done(o) } }, o))) : el('p', { class: 'muted' }, '希望ノートに書いておくと、ここから選べます。'),
    el('form', { class: 'row', on: { submit: (e) => { e.preventDefault(); done(input.value); } } }, input, el('button', { class: 'primary', type: 'submit' }, '決める')));
  setTimeout(() => input.focus(), 50);
}

// ---------- 再会の場面 ----------
function reunionScene(name) {
  const box = $('reunion');
  $('reunionName').textContent = name;
  box.classList.add('show');
  audio.sfx('reunion');
  setTimeout(() => speak(`おかえりなさい、${name}さん。`), 900);
  const close = () => { box.classList.remove('show'); box.removeEventListener('click', close); setTimeout(nextCard, 300); };
  setTimeout(() => box.addEventListener('click', close), 1200);
}

// ---------- 地域 ----------
function showRegions() {
  const a = allMetrics(state);
  openModal(el('h2', {}, '🗺 地域'),
    el('p', { class: 'muted' }, '楽園は谷から地球全体へ広がります。地域ごとに作物や家は別々に育ちます（一日を終えると、すべての地域で育ちます）。'),
    el('div', { class: 'cardlist' }, ...Object.entries(REGIONS).map(([id, R]) => el('button', {
      class: id === state.region ? 'primary' : '',
      on: { click: () => {
        if (busy) return;
        const r = switchRegion(state, id);
        if (!r.ok) return toast(r.reason);
        renderer.region = state.region;
        save(); closeModal(); audio.sfx('water');
        toast(`${R.icon} ${R.name}に来ました`);
        queueCards(r.cards);
      } },
    }, `${R.icon} ${R.name} — ${R.note}${a.totals[id] !== undefined ? `（楽園度 ${a.totals[id]}）` : '（まだ手つかず）'}`))));
}

// ---------- 記念写真 ----------
function takePhoto() {
  const src = $('world');
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const s = Math.max(14, Math.round(c.width / 50));
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, c.height - s * 2.4, c.width, s * 2.4);
  g.fillStyle = '#fff'; g.font = `${s}px sans-serif`; g.textBaseline = 'middle';
  const date = new Date().toLocaleDateString('ja-JP');
  g.fillText(`楽園をつくろう　${REGIONS[state.region].name}　${state.day}日目　楽園度 ${metrics(state).total}　（${date}）`, s, c.height - s * 1.2);
  audio.sfx('photo');
  c.toBlob((blob) => {
    if (!blob) return toast('写真を保存できませんでした');
    const a = el('a', { href: URL.createObjectURL(blob), download: `楽園-${REGIONS[state.region].name}-${state.day}日目.png` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('📷 記念写真を保存しました');
  }, 'image/png');
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
    state = s; renderer.region = state.region; cardQueue.length = 0; leaveWalk(); save(); closeModal(); toast(`${state.day}日目の楽園を読み込みました`);
    queueCards(takePending());
  });
  const reset = el('button', { on: { click: () => {
    if (busy) return;
    if (reset.dataset.armed) {
      state = newState(); renderer.region = 'valley'; cardQueue.length = 0; leaveWalk(); save(); closeModal();
      toast('新しい大地で始めます'); queueCards([unlock(state, 'morning')]); return;
    }
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
  const blob = new Blob([JSON.stringify({ ...state, regions: Object.fromEntries(Object.entries(state.regions).filter(([id]) => id !== state.region)) })], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `paradise-${state.day}日目.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- 作業 ----------
let lastToolsKey = '';
function buildTools() {
  const key = `${tool}|${state.chapter}`;
  if (key === lastToolsKey) return;
  lastToolsKey = key;
  const nav = $('tools');
  const entries = [['look', { label: '見る', cost: 0 }], ...Object.entries(ACTIONS).filter(([, a]) => a.ch <= state.chapter)];
  nav.replaceChildren(...entries.map(([k, a]) => el('button', { 'data-k': k, title: a.hint || 'マスを調べる', on: { click: () => { tool = k; buildTools(); if (a.hint) toast(`${a.label}：${a.hint}`); } }, class: k === tool ? 'sel' : '' },
    el('span', { class: 'ic' }, ICONS[k]), a.label, el('span', { class: 'c' }, a.cost ? `労力${a.cost}` : '　'))));
}

function describe(x, y) {
  const t = state.tiles[idx(x, y)];
  let s = NAMES[t.k] || t.k;
  if (t.k === 'field' || t.k === 'orchard') s += t.g >= 1 ? '（実っています）' : `（育ち具合 ${Math.round(t.g * 100)}%）`;
  if (t.k === 'house') s += t.p ? `：${t.p}さんの家${t.t ? '（学んでいます✦）' : ''}` : '（空き家・🤝で人を迎えられます）';
  if (t.a) s += `・${ANIMALS[t.a] || '動物'}がいます`;
  if (t.s) s += `・🪧「${t.s}」`;
  return s;
}

function doAction(x, y, opt) {
  const r = act(state, tool, x, y, opt);
  if (!r.ok) { audio.sfx('deny'); toast(r.reason); return; }
  audio.sfx(SFX[tool]);
  const t = state.tiles[idx(x, y)];
  if (tool === 'welcome') toast(`🤝 ${t.p}さんを迎えました！`);
  else if (tool === 'animal') toast(`${ANIMALS[t.a]}がやって来ました`);
  else if (tool === 'teach') toast(`📖 ${t.p}さんといっしょに学びました`);
  save();
  buildTools();
  if (r.reunion) { cardQueue.push(...r.cards.filter(Boolean)); reunionScene(t.p); } else queueCards(r.cards);
}

function onTap(px, py) {
  if (busy || mode !== 'map') return;
  const p = renderer.tileAt(px, py);
  if (!p) return;
  if (tool === 'look') return toast(describe(p.x, p.y));
  const t = state.tiles[idx(p.x, p.y)];
  if (tool === 'welcome') {
    if (t.k !== 'house' || t.p) return doAction(p.x, p.y, {}); // 理由はロジックに任せる
    return pickFromHopes('person', '🤝 だれを迎えますか？', '名前（例：おじいちゃん）', (name) => doAction(p.x, p.y, { name }));
  }
  if (tool === 'sign') {
    if (!ACTIONS.sign.on.includes(t.k)) return doAction(p.x, p.y, {});
    return pickFromHopes('do', '🪧 看板に書く希望', '例：家族で川で泳ぐ', (text) => doAction(p.x, p.y, { text }));
  }
  doAction(p.x, p.y);
}

// ---------- 歩いて見る ----------
walker.onStep = () => audio.sfx('step');
walker.onNear = (t) => {
  const msg = t.p ? `${t.p}さんの家です` : `看板「${t.s}」`;
  toast(msg); speak(t.p ? `${t.p}さんの家です。` : t.s);
};
function enterWalk() {
  if (busy || state.chapter < 5) return;
  mode = 'walk'; walker.enter(state);
  document.body.classList.add('walking');
  toast('←→で向きを変え、↑↓で歩きます。画面をドラッグしても向きを変えられます');
}
function leaveWalk() {
  if (mode !== 'walk') return;
  mode = 'map'; walker.exit();
  document.body.classList.remove('walking');
}
document.querySelectorAll('#walkpad [data-move]').forEach((b) => {
  const [kind, v] = b.dataset.move.split(':');
  const on = (e) => { e.preventDefault(); walker.pad[kind] = Number(v); };
  const off = () => { walker.pad[kind] = 0; };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
});
$('btnLeaveWalk').addEventListener('click', leaveWalk);

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
      buildTools();
      toast(r.grown ? `夜の間に ${r.grown} か所が育ちました` : '新しい一日が始まりました');
      queueCards(r.cards);
    }, 1300);
  }, 1400);
});
const unlessBusy = (fn) => () => { if (!busy) fn(); };
$('btnCards').addEventListener('click', unlessBusy(showCardList));
$('btnHopes').addEventListener('click', unlessBusy(showHopes));
$('btnSettings').addEventListener('click', unlessBusy(showSettings));
$('btnWeekly').addEventListener('click', unlessBusy(showWeekly));
$('btnPhoto').addEventListener('click', unlessBusy(takePhoto));
$('btnRegion').addEventListener('click', unlessBusy(showRegions));
$('btnWalk').addEventListener('click', unlessBusy(enterWalk));
$('btnStart').addEventListener('click', () => {
  try { audio.start(); audio.setVolume(Number(pref('paradise.vol') ?? 0.8)); audio.setMuted(pref('paradise.mute') === '1'); } catch (e) { console.error(e); }
  $('title').classList.remove('show');
  queueCards([unlock(state, 'morning'), ...takePending()]);
  save();
});
function takePending() { const p = state.pendingCards || []; delete state.pendingCards; return p; }

let warnedSave = false;
function save() {
  if (saveState(store, state)) { warnedSave = false; return; }
  if (!warnedSave) { warnedSave = true; toast('この端末に保存できませんでした。⚙設定から書き出しておいてください'); }
}

// ---------- HUD と描画ループ ----------
function hud(m) {
  $('day').textContent = state.day;
  $('chapter').textContent = `第${state.chapter}章 ${CHAPTERS[state.chapter]}`;
  $('goal').textContent = state.chapter < 5 ? `次の章へ：${CHAPTER_GOALS[state.chapter + 1]}` : 'すべての章がひらきました';
  $('regionName').textContent = `${REGIONS[state.region].icon} ${REGIONS[state.region].name}`;
  $('btnRegion').hidden = state.chapter < 4;
  $('btnWalk').hidden = state.chapter < 5;
  const dots = $('energy');
  const key = `${state.energy}/${state.maxEnergy}`;
  if (dots.dataset.e !== key) {
    dots.dataset.e = key;
    if (state.maxEnergy <= 12) dots.replaceChildren(...Array.from({ length: state.maxEnergy }, (_, i) => el('i', i < state.energy ? {} : { class: 'off' })));
    else dots.replaceChildren(el('i', state.energy ? {} : { class: 'off' }), el('b', {}, key)); // 働き手が増えたら数字で
  }
  $('pbar').style.width = `${m.total}%`;
  $('ptotal').textContent = m.total;
  $('mstats').textContent = `🌿${m.green} 🌾${m.food} 🏠${m.homes} 💧${m.water} 🐾${m.animals} 🤝${m.people}`;
}

const now = () => performance.now() / 1000 + clockOffset;
let lastHud = 0;
let lastDraw = 0;
function frame(ms) {
  requestAnimationFrame(frame);
  if (ms - lastDraw < 32) return; // 毎秒30コマ程度に抑えて古いタブレットでも軽く
  const dt = Math.min(0.1, (ms - lastDraw) / 1000);
  lastDraw = ms;
  try { drawFrame(dt); } catch (e) { console.error(e); }
}
function drawFrame(dt) {
  const t = now();
  const m = metrics(state);
  renderer.region = state.region;
  if (mode === 'walk') { walker.update(state, dt); walker.draw(state, m, t); } else renderer.draw(state, m, t, tool === 'look' ? null : hover);
  if (t - lastHud > 0.25) {
    lastHud = t; hud(m);
    const sky = skyPhase(t);
    audio.setMix({ green: Math.min(1, m.green / 120), water: Math.min(1, m.water / 25), night: sky.night, total: m.total / 100, sea: state.region === 'coast' ? 1 : 0 });
  }
}

buildTools();
renderer.region = state.region;
if (state.day > 1 || state.unlocked.length) $('btnStart').textContent = `${state.day}日目から続ける`;
// テスト用：?walk=1 で歩いて見るから始める（第5章のときだけ）
if (new URLSearchParams(location.search).get('walk') === '1') setTimeout(() => { $('btnStart').click(); setTimeout(() => { if (modalOpen()) closeModal(); enterWalk(); }, 300); }, 300);
requestAnimationFrame(frame);
