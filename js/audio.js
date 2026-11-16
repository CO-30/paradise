// 楽園の音 — すべて Web Audio でその場で合成（音声ファイルなし）
const CHORDS = [
  [261.63, 329.63, 392.0, 493.88, 587.33], // Cmaj9
  [220.0, 261.63, 329.63, 392.0, 493.88], // Am9
  [174.61, 220.0, 261.63, 329.63, 392.0], // Fmaj9
  [196.0, 246.94, 293.66, 329.63, 440.0], // G6/9
];

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.mix = { green: 0, water: 0, night: 0, total: 0, sea: 0 };
    this.volume = 0.8;
    this.chord = 0;
    this.muted = false;
    // iOS などで中断されたら、次の操作や画面復帰で再開する
    const resume = () => { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}); };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
      ['pointerdown', 'touchend', 'keydown'].forEach((ev) => document.addEventListener(ev, resume, { passive: true }));
    }
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.1);
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    c.resume().catch(() => {});
    this.master = c.createGain();
    this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);

    // 共通のノイズ
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { // ピンクノイズ近似
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    this.noise = buf;
    const loop = () => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 3); return s; };

    // 風
    this.windF = c.createBiquadFilter(); this.windF.type = 'lowpass'; this.windF.frequency.value = 500;
    this.windG = c.createGain(); this.windG.gain.value = 0.25;
    loop().connect(this.windF).connect(this.windG).connect(this.master);

    // 小川（2本の帯域で水のざわめき）
    this.streamG = c.createGain(); this.streamG.gain.value = 0;
    this.streamF = [900, 2400].map((f) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 1.2;
      loop().connect(bp).connect(this.streamG); return bp;
    });
    this.streamG.connect(this.master);

    // 波（海辺）：ゆっくり寄せては返す
    this.seaF = c.createBiquadFilter(); this.seaF.type = 'lowpass'; this.seaF.frequency.value = 500;
    this.seaG = c.createGain(); this.seaG.gain.value = 0;
    loop().connect(this.seaF).connect(this.seaG).connect(this.master);

    // 虫（夜）
    this.bugG = c.createGain(); this.bugG.gain.value = 0;
    const bug = c.createOscillator(); bug.frequency.value = 4400;
    const am = c.createGain(); am.gain.value = 0;
    const lfo = c.createOscillator(); lfo.frequency.value = 18;
    const lfoG = c.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    bug.connect(am).connect(this.bugG).connect(this.master);
    bug.start(); lfo.start();

    // 和音のパッド
    this.padG = c.createGain(); this.padG.gain.value = 0.05;
    const padF = c.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 1400;
    this.padG.connect(padF).connect(this.master);
    this.voices = CHORDS[0].map((f, i) => {
      const o = c.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = c.createGain(); g.gain.value = 0;
      o.connect(g).connect(this.padG); o.start();
      return { o, g };
    });

    this.timer = setInterval(() => this.tick(), 250);
    this.chordTimer = setInterval(() => this.nextChord(), 9000);
    this.apply();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  setMix(m) { this.mix = { ...this.mix, ...m }; }

  apply() {
    const { green, water, night, total } = this.mix;
    const t = this.ctx.currentTime;
    // 荒れ地では強めの風、楽園ではそよ風
    this.windG.gain.setTargetAtTime(0.28 - 0.18 * total, t, 1.5);
    this.streamG.gain.setTargetAtTime(0.5 * water, t, 1);
    const swell = 0.5 + 0.5 * Math.sin(t * 0.7);
    this.seaG.gain.setTargetAtTime(this.mix.sea * (0.15 + 0.45 * swell), t, 0.6);
    this.seaF.frequency.setTargetAtTime(300 + 700 * swell, t, 0.6);
    this.bugG.gain.setTargetAtTime(0.012 * night * green, t, 2);
    const layers = 1 + Math.round(total * 4);
    this.voices.forEach((v, i) => v.g.gain.setTargetAtTime(i < layers ? 0.2 / (1 + i * 0.4) : 0, t, 3));
  }

  nextChord() {
    if (!this.ctx) return;
    this.chord = (this.chord + 1) % CHORDS.length;
    const t = this.ctx.currentTime;
    this.voices.forEach((v, i) => v.o.frequency.setTargetAtTime(CHORDS[this.chord][i], t, 1.2));
  }

  tick() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    this.apply();
    const t = c.currentTime;
    this.windF.frequency.setTargetAtTime(300 + Math.random() * 600, t, 1.5);
    this.streamF.forEach((f, i) => f.frequency.setTargetAtTime((i ? 2000 : 800) + Math.random() * 700, t, 0.08));
    const day = 1 - this.mix.night;
    if (Math.random() < 0.35 * this.mix.green * day) this.bird();
  }

  bird() {
    const c = this.ctx, t = c.currentTime;
    const base = 2200 + Math.random() * 2200;
    const notes = 2 + Math.floor(Math.random() * 4);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const g = c.createGain(); g.gain.value = 0.05 + Math.random() * 0.05;
    if (pan) { pan.pan.value = Math.random() * 2 - 1; g.connect(pan).connect(this.master); } else g.connect(this.master);
    for (let n = 0; n < notes; n++) {
      const o = c.createOscillator(); const e = c.createGain();
      const s = t + n * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), s + 0.06);
      e.gain.setValueAtTime(0, s); e.gain.linearRampToValueAtTime(1, s + 0.01); e.gain.exponentialRampToValueAtTime(0.001, s + 0.08);
      o.connect(e).connect(g); o.start(s); o.stop(s + 0.1);
    }
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, at = 0, slide = 0 } = {}) {
    const c = this.ctx, s = c.currentTime + at;
    const o = c.createOscillator(); const e = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, s);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, s + dur);
    e.gain.setValueAtTime(0, s); e.gain.linearRampToValueAtTime(gain, s + 0.01); e.gain.exponentialRampToValueAtTime(0.001, s + dur);
    o.connect(e).connect(this.master); o.start(s); o.stop(s + dur + 0.05);
  }

  burst(dur, freq, gain = 0.3, at = 0) {
    const c = this.ctx, s = c.currentTime + at;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const e = c.createGain(); e.gain.setValueAtTime(gain, s); e.gain.exponentialRampToValueAtTime(0.001, s + dur);
    src.connect(f).connect(e).connect(this.master); src.start(s, Math.random() * 2); src.stop(s + dur);
  }

  sfx(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    switch (name) {
      case 'dig': this.burst(0.25, 700, 0.5); this.burst(0.2, 500, 0.4, 0.18); break;
      case 'plant': this.tone(523, 0.3, { gain: 0.15 }); this.tone(784, 0.4, { gain: 0.12, at: 0.08 }); break;
      case 'hammer': [0, 0.22, 0.44].forEach((a) => { this.tone(160, 0.12, { type: 'triangle', gain: 0.3, at: a, slide: 0.6 }); this.burst(0.06, 2000, 0.2, a); }); break;
      case 'water': for (let i = 0; i < 5; i++) this.tone(400 + Math.random() * 500, 0.12, { gain: 0.1, at: i * 0.07, slide: 1.8 }); break;
      case 'animal': this.tone(220, 0.6, { type: 'triangle', gain: 0.12, slide: 1.3 }); this.tone(330, 0.5, { gain: 0.08, at: 0.2 }); break;
      case 'welcome': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 1.2, { gain: 0.12, at: i * 0.12 })); break;
      case 'card': [784, 1175, 1568].forEach((f, i) => this.tone(f, 1.6, { gain: 0.07, at: i * 0.18 })); break;
      case 'reunion':
        [262, 330, 392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 3.2, { gain: 0.09, at: i * 0.22 }));
        [1568, 2093, 2637].forEach((f, i) => this.tone(f, 2, { gain: 0.04, at: 1.6 + i * 0.3 }));
        break;
      case 'chapter': [392, 494, 587, 784].forEach((f, i) => this.tone(f, 2.4, { gain: 0.09, at: i * 0.3, type: 'triangle' })); break;
      case 'step': this.burst(0.08, 900, 0.12); break;
      case 'photo': this.burst(0.05, 4000, 0.3); this.tone(1200, 0.08, { gain: 0.08, at: 0.05 }); break;
      case 'deny': this.tone(200, 0.15, { type: 'triangle', gain: 0.1 }); break;
      case 'night': [392, 330, 262].forEach((f, i) => this.tone(f, 1, { gain: 0.08, at: i * 0.25 })); break;
      default: break;
    }
  }
}

// 端末の音声合成で日本語を読み上げる（対応していない端末では何もしない）
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
export function speak(text) {
  if (!canSpeak || !text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP'; u.rate = 0.95;
    const v = window.speechSynthesis.getVoices().find((x) => x.lang && x.lang.startsWith('ja'));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch { /* 読み上げできない端末 */ }
}
