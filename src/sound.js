// Quiet night sounds, all generated in the browser: wind, crickets, steps per surface,
// now and then an owl, the chapel bell, the fountain. Starts only after the first click
// (browser rule) and can be switched off; the browser remembers the choice.

const KEY = 'graveyard.sound';

function read() { try { return localStorage.getItem(KEY); } catch { return null; } }
function write(v) { try { localStorage.setItem(KEY, v); } catch { /* ignore */ } }

export class Sound {
  constructor() {
    this.on = read() !== 'off';
    this.ctx = null;
    this.time = 0;
    this.nextOwl = 18 + Math.random() * 20;
    this.nextBell = 40;
    this.zone = 'village';
  }

  // on the first click or key press
  start() {
    if (this.ctx || !this.on) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    this.ctx = c;
    this.main = c.createGain();
    this.main.gain.value = 0;
    this.main.gain.linearRampToValueAtTime(0.9, c.currentTime + 2.5);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    this.main.connect(comp).connect(c.destination);
    // reverb for bell, owl and steps on cobbles
    this.hall = c.createConvolver();
    this.hall.buffer = this.impulse(2.8, 2.2);
    this.hallLevel = c.createGain();
    this.hallLevel.gain.value = 0.35;
    this.hall.connect(this.hallLevel).connect(this.main);
    this.noiseBuffer = this.noise(4);
    this.brown = this.brownNoise(6);
    this.wind();
    this.crickets();
    this.well();
  }

  toggle() {
    this.on = !this.on;
    write(this.on ? 'on' : 'off');
    if (this.on) {
      if (!this.ctx) this.start();
      else { this.ctx.resume(); this.main.gain.cancelScheduledValues(this.ctx.currentTime); this.main.gain.linearRampToValueAtTime(0.9, this.ctx.currentTime + 0.8); }
    } else if (this.ctx) {
      this.main.gain.cancelScheduledValues(this.ctx.currentTime);
      this.main.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.4);
      setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 500);
    }
    return this.on;
  }

  // ---------- building blocks ----------
  noise(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  brownNoise(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let l = 0;
    for (let i = 0; i < n; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; }
    return b;
  }
  impulse(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let k = 0; k < 2; k++) { const d = b.getChannelData(k); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }
  source(buffer, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.loop = loop;
    return s;
  }

  // wind: brown noise through a slowly wandering band-pass filter
  wind() {
    const c = this.ctx;
    const s = this.source(this.brown);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.16;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(f.frequency);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.045;
    const lfo2G = c.createGain(); lfo2G.gain.value = 0.07;
    lfo2.connect(lfo2G).connect(g.gain);
    s.connect(f).connect(g).connect(this.main);
    s.start(); lfo.start(); lfo2.start();
    this.windLevel = g;
  }

  // crickets: short chirps around 4.6 kHz, every cricket with its own beat and place in the stereo image
  crickets() {
    const c = this.ctx;
    this.cricketsLevel = c.createGain();
    this.cricketsLevel.gain.value = 0.05;
    this.cricketsLevel.connect(this.main);
    this.cricketsList = Array.from({ length: 5 }, (_, i) => ({
      beat: 0.55 + Math.random() * 0.5, next: Math.random() * 2, sound: 4300 + Math.random() * 900,
      pan: (i / 4) * 1.6 - 0.8, pause: 0, loud: 0.5 + Math.random() * 0.5,
    }));
  }
  chirp(gr) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = gr.sound;
    const at = c.createGain(); at.gain.value = 0;
    const p = c.createStereoPanner(); p.pan.value = gr.pan;
    // three pulses per chirp
    for (let k = 0; k < 3; k++) {
      const a = t + k * 0.034;
      at.gain.setValueAtTime(0, a);
      at.gain.linearRampToValueAtTime(gr.loud, a + 0.006);
      at.gain.exponentialRampToValueAtTime(0.001, a + 0.026);
    }
    o.connect(at).connect(p).connect(this.cricketsLevel);
    o.start(t); o.stop(t + 0.14);
  }

  // fountain: splashing from bright noise, louder the closer you are
  well() {
    const c = this.ctx;
    const s = this.source(this.noiseBuffer);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.9;
    const f2 = c.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 3200; f2.gain.value = 4;
    const g = c.createGain(); g.gain.value = 0;
    s.connect(f).connect(f2).connect(g).connect(this.main);
    s.start();
    this.wellLevel = g;
  }

  // step per surface
  step(ground, pace) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime;
    const s = this.source(this.noiseBuffer, false);
    const off = Math.random() * 3;
    const f = c.createBiquadFilter();
    const g = c.createGain();
    const loud = 0.1 + Math.min(1, pace / 7) * 0.08;
    let duration = 0.09;
    if (ground === 'paving') { f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 500; f.Q.value = 1.6; duration = 0.06; }
    else if (ground === 'gravel') { f.type = 'highpass'; f.frequency.value = 1500; duration = 0.16; }
    else if (ground === 'earth') { f.type = 'lowpass'; f.frequency.value = 420; duration = 0.1; }
    else { f.type = 'lowpass'; f.frequency.value = 900 + Math.random() * 300; duration = 0.12; }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(loud * (ground === 'gravel' ? 0.7 : 1), t + 0.008);
    if (ground === 'gravel') {
      // crunch: several small grains
      for (let k = 1; k < 5; k++) g.gain.setValueAtTime(loud * (0.25 + Math.random() * 0.5), t + k * 0.03);
    }
    g.gain.exponentialRampToValueAtTime(0.0008, t + duration);
    s.connect(f).connect(g).connect(this.main);
    if (ground === 'paving') { const h = c.createGain(); h.gain.value = 0.5; g.connect(h).connect(this.hall); }
    s.start(t, off, duration + 0.05);
  }

  // owl: two soft calls, "hoo ... hoooo"
  owl() {
    const c = this.ctx, t = c.currentTime + 0.05;
    const p = c.createStereoPanner(); p.pan.value = Math.random() * 1.4 - 0.7;
    const g = c.createGain(); g.gain.value = 0;
    const o = c.createOscillator(); o.type = 'sine';
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const call = (a, d, f0) => {
      o.frequency.setValueAtTime(f0, a);
      o.frequency.linearRampToValueAtTime(f0 * 0.93, a + d);
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(0.07, a + 0.06);
      g.gain.setValueAtTime(0.07, a + d - 0.1);
      g.gain.linearRampToValueAtTime(0, a + d);
    };
    call(t, 0.32, 410);
    call(t + 0.62, 0.95, 395);
    o.connect(lp).connect(g).connect(p);
    p.connect(this.main);
    const hg = c.createGain(); hg.gain.value = 0.8; p.connect(hg).connect(this.hall);
    o.start(t); o.stop(t + 1.8);
  }

  // chapel bell: inharmonic partials, long decay
  bell(loud = 0.09) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + 0.05;
    const f0 = 196;
    const part = [[0.5, 0.5, 6], [1, 1, 5], [1.19, 0.5, 3.6], [1.5, 0.35, 3], [2, 0.42, 2.6], [2.52, 0.2, 2], [3.01, 0.15, 1.6]];
    for (const [r, a, d] of part) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * r;
      const g = c.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(loud * a, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(this.main);
      const h = c.createGain(); h.gain.value = 1.2; g.connect(h).connect(this.hall);
      o.start(t); o.stop(t + d + 0.1);
    }
  }

  // short sounds for the interface
  ui(kind) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t = c.currentTime + 0.01;
    const notes = { respect: [523.25, 659.25], flower: [659.25, 783.99], candle: [587.33, 880], click: [880], open: [440, 554.37], close: [554.37, 440] }[kind] || [660];
    notes.forEach((f, i) => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = c.createGain(); g.gain.value = 0;
      const a = t + i * 0.09;
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(kind === 'click' ? 0.025 : 0.05, a + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, a + (kind === 'click' ? 0.12 : 0.9));
      o.connect(g).connect(this.main);
      const h = c.createGain(); h.gain.value = 0.6; g.connect(h).connect(this.hall);
      o.start(a); o.stop(a + 1);
    });
  }

  // per frame: levels by place, crickets and owl keep their beat
  update(dt, { x, z, zone, map }) {
    if (!this.ctx || !this.on) return;
    this.time += dt;
    const c = this.ctx, t = c.currentTime;
    const graveyard = zone === 'graveyard';
    const dBr = Math.hypot(x, z);
    this.wellLevel.gain.setTargetAtTime(Math.max(0, 1 - dBr / 22) ** 2 * 0.12 * (1 - map), t, 0.25);
    this.cricketsLevel.gain.setTargetAtTime((graveyard ? 0.025 : 0.05) * (1 - map * 0.7), t, 0.8);
    this.windLevel.gain.setTargetAtTime((graveyard ? 0.2 : 0.14) + map * 0.08, t, 1.5);
    for (const gr of this.cricketsList) {
      gr.next -= dt;
      if (gr.next > 0) continue;
      if (gr.pause > 0) { gr.pause -= 1; gr.next = gr.beat; continue; }
      this.chirp(gr);
      gr.next = gr.beat * (0.9 + Math.random() * 0.2);
      if (Math.random() < 0.06) gr.pause = 3 + Math.floor(Math.random() * 6);
    }
    this.nextOwl -= dt;
    if (this.nextOwl <= 0) { this.owl(); this.nextOwl = 28 + Math.random() * 45; }
    if (zone !== this.zone) {
      if (zone === 'graveyard') this.bell(0.08);
      this.zone = zone;
    }
    this.nextBell -= dt;
    if (graveyard && this.nextBell <= 0) { this.bell(0.06); this.nextBell = 75 + Math.random() * 60; }
  }
}
