// APU（音频处理器）：2 个方波 + 1 个三角波 + 1 个噪声 + 1 个采样声道，用 WebAudio 模拟
export const CHANNELS = ['pulse1', 'pulse2', 'triangle', 'noise', 'dmc'];

export class APU {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = { pulse1: 0, pulse2: 0, triangle: 0, noise: 0, dmc: 0 };
    this._waves = {};
  }

  // 浏览器要求用户有过操作后才能出声
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.master.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this._noise = this.ctx.createBuffer(1, n, n);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() < 0.5 ? -1 : 1;
      // 采样声道：一段 1 位增量编码风格的"鼓声"
      this._kick = this.ctx.createBuffer(1, Math.floor(n * 0.25), n);
      const k = this._kick.getChannelData(0);
      let lv = 0;
      for (let i = 0; i < k.length; i++) {
        const t = i / n;
        const target = Math.sin(2 * Math.PI * (120 - 300 * t) * t) * Math.exp(-t * 14);
        if (i % 6 === 0) lv += target > lv ? 0.06 : -0.06; // 每次只能升或降一级
        k[i] = lv;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _ok() { return this.ctx && !this.muted; }
  _env(t, dur, vol) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    return g;
  }
  _wave(duty) {
    if (!this._waves[duty]) {
      const N = 32, re = new Float32Array(N), im = new Float32Array(N);
      for (let n = 1; n < N; n++) {
        re[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * duty);
        im[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * duty));
      }
      this._waves[duty] = this.ctx.createPeriodicWave(re, im);
    }
    return this._waves[duty];
  }
  _osc(ch, setup, { freq, to, dur = 0.1, vol = 0.5, at = 0 }) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator();
    setup(o);
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    o.connect(this._env(t, dur, vol));
    o.start(t);
    o.stop(t + dur + 0.02);
    this.last[ch] = performance.now() + at * 1000;
  }
  pulse(o, ch = 'pulse1') { this._osc(ch, (n) => n.setPeriodicWave(this._wave(o.duty || 0.5)), o); }
  tri(o) { this._osc('triangle', (n) => { n.type = 'triangle'; }, { vol: 0.9, ...o }); }
  noise({ dur = 0.15, vol = 0.5, rate = 1, at = 0 } = {}) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime + at;
    const s = this.ctx.createBufferSource();
    s.buffer = this._noise;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(this._env(t, dur, vol));
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
    this.last.noise = performance.now() + at * 1000;
  }
  dmc({ at = 0, vol = 1 } = {}) {
    if (!this._ok()) return;
    const t = this.ctx.currentTime + at;
    const s = this.ctx.createBufferSource();
    s.buffer = this._kick;
    s.connect(this._env(t, 0.25, vol));
    s.start(t);
    this.last.dmc = performance.now() + at * 1000;
  }

  // 一小段原创旋律，四个声道各司其职
  song() {
    this.ensure();
    if (!this._ok()) return;
    const N = { C4: 261.6, D4: 293.7, E4: 329.6, G4: 392, A4: 440, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, C3: 130.8, F3: 174.6, G3: 196, A3: 220 };
    const beat = 0.16;
    const lead = ['E5', 'G5', 'E5', 'C5', 'D5', 'E5', 'D5', 'A4', 'C5', 'E5', 'G5', 'E5', 'D5', 'C5', 'D5', 'C5'];
    const bass = ['C3', 'C3', 'A3', 'A3', 'F3', 'F3', 'G3', 'G3'];
    lead.forEach((n, i) => {
      this.pulse({ freq: N[n], dur: beat * 0.9, vol: 0.45, duty: 0.25, at: i * beat }, 'pulse1');
      if (i % 2 === 0) this.pulse({ freq: N[n] / 2 * 1.5, dur: beat * 1.8, vol: 0.22, duty: 0.5, at: i * beat }, 'pulse2');
    });
    bass.forEach((n, i) => this.tri({ freq: N[n], dur: beat * 1.9, at: i * beat * 2 }));
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) this.dmc({ at: i * beat });
      else if (i % 2 === 0) this.noise({ dur: 0.07, vol: 0.35, rate: 1.2, at: i * beat });
      else this.noise({ dur: 0.03, vol: 0.15, rate: 2, at: i * beat });
    }
  }
}
