# 楽園をつくろう 第1章 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 荒れた谷を一日ずつ楽園に変えていく、映像と音のある家族向けWebゲーム（第1章）。

**Architecture:** ビルドなしの静的サイト。純粋ロジック `js/game.js`（Nodeでテスト）を、描画 `js/render.js`（Canvas 2D）、音 `js/audio.js`（Web Audio合成）、UI `js/main.js` が使う。保存は localStorage。

**Tech Stack:** HTML/CSS、ES Modules、Canvas 2D、Web Audio API、`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-16-paradise-design.md`

## Global Constraints
- 外部素材ゼロ（画像・音声ファイル・CDNなし）。
- 新世界訳の本文を載せない。聖句は「箇所＋自分の言葉の要約＋jw.org リンク」`https://www.jw.org/finder?wtlocale=J&pub=nwtsty&bible=BBCCCVVV[-BBCCCVVV]`。
- 日本語UI。時間制限・失敗なし。ハルマゲドンの破壊描写なし。

## Review Focus
1. 壊れた／古い保存データ → 初期状態で起動し、落ちない（`loadState` テスト）。
2. 条件を満たさない行動（水なしで家など）→ 何も変えず理由を返す（`act` テスト）。
3. 労力ゼロでの行動 → 拒否（`act` テスト）。
4. 音は最初のタップまで鳴らせない（ブラウザ制約）→ 「はじめる」ボタンで AudioContext 開始。
5. 希望ノートに長文・HTML文字 → textContent で表示し、長さを80字に制限（`addHope` テスト）。

---

### Task 1: ゲームロジック `js/game.js` と文章 `js/content.js`

**Interfaces – Produces:**
- `W=20, H=12`
- `newState(seed?:number) -> State` … `{day, energy, maxEnergy:6, tiles:Tile[H*W], hopes:[], unlocked:[], log:[]}`、`Tile={k:'rubble'|'weeds'|'soil'|'grass'|'field'|'orchard'|'flower'|'well'|'channel'|'house'|'stream', g:number(成長0-1), a?:string(動物), p?:string(住人名)}`。小川の通り道 `streamPath` は干上がった `'bed'` 種別。
- `ACTIONS: {clear, field, orchard, flower, well, channel, house, animal, welcome}` 各 `{label, cost, on:Tile種別[]}`
- `act(state, action, x, y, opt?) -> {ok:boolean, reason?:string, card?:string}`（state を破壊的に更新）
- `endDay(state) -> {grown:number, card?:string}`：作物成長＋0.34、果樹+0.15、労力回復、水の伝播。
- `metrics(state) -> {green, food, homes, water, animals, people, total(0-100)}`
- `addHope(state, who, text, kind:'do'|'person')`、`saveState/loadState(storage)`。
- `content.js`: `CARDS[id] = {title, ref, link, summary, question}`（10枚、spec 記載の聖句）。

**Tests (`test/game.test.js`):** 初期状態にがれきと干上がった川床がある／整地で soil・労力-1／労力0で拒否／水なしの家は拒否 reason「水」を含む／水源に繋がる水路で `bed`→`stream`／畑→endDay×3で g>=1 & food 増／家は畑＋水で可、welcome で p=名前・people+1／metrics.total が単調増加／loadState に壊れたJSON→newState／addHope 80字で切る／初回の節目でカードid返却し unlocked に1回だけ入る。

- [ ] テスト作成 → `node --test` で失敗確認 → 実装 → 成功確認 → commit

### Task 2: 音 `js/audio.js`
**Produces:** `class Soundscape { start(); setMix({green, water, night, total}); sfx(name:'dig'|'plant'|'hammer'|'water'|'animal'|'welcome'|'card'); setVolume(v); }` 風=ピンクノイズ+lowpass揺らぎ、小川=bandpassノイズ、鳥=周波数スイープのチャープを確率発生、虫=高音の断続、パッド=5度和音をゆっくり移行。
- [ ] 実装 → ブラウザで鳴ることを確認（ヘッドレスでは構文確認のみ）→ commit

### Task 3: 描画 `js/render.js`
**Produces:** `class Renderer { constructor(canvas); draw(state, metrics, t:number /*秒*/, hover?:{x,y}); tileAt(px,py)->{x,y}|null }` 空（昼夜周期90秒、楽園度で灰→青）、太陽/月/星、雲、谷の地形タイル、揺れる草、成長する木、水のきらめき、粒子（蝶・花びら・蛍）、動物と人の歩行、夜の家の灯り。
- [ ] 実装 → Chromeヘッドレスでスクリーンショット確認 → commit

### Task 4: UI `index.html` `js/main.js` `style.css`
タイトル画面（はじめる）→ ツールバー（行動選択）、指標バー、「一日を終える」、カード表示モーダル・カード一覧、希望ノート（家族名・したいこと・迎えたい人）、迎える時の名前選択、設定（音量・書き出し/読み込み・最初から）。
- [ ] 実装 → スクリーンショット確認 → commit

### Task 5: README・公開
- [ ] README（遊び方・家族の崇拝での使い方・ロードマップ）→ PR → マージ → GitHub Pages
