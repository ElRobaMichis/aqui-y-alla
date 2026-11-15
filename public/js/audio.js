// Música y efectos 100% sintetizados con Web Audio: 0 bytes descargados.
// La música es generativa: progresión tranquila tipo lo-fi con piano eléctrico,
// bajo suave, escobillas y un poco de crujido de vinilo.

let ctx = null;
let master, musicBus, sfxBus, reverb, reverbSend;
let musicOn = localStorage.getItem('aya:music') !== '0';
let sfxOn = localStorage.getItem('aya:sfx') !== '0';
let musicTimer = null;
let crackle = null;

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function impulse(seconds = 2.6, decay = 3) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

function noiseBuffer(seconds = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
let noise = null;

/** Debe llamarse dentro de un gesto del usuario (click/tecla). */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    reverb = ctx.createConvolver(); reverb.buffer = impulse();
    reverbSend = ctx.createGain(); reverbSend.gain.value = 0.35;
    reverbSend.connect(reverb).connect(master);

    musicBus = ctx.createGain(); musicBus.gain.value = 0;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 2600;
    musicBus.connect(warm).connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.8 : 0;
    sfxBus.connect(master);
    noise = noiseBuffer(1);
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  if (musicOn && !musicTimer) startMusic();
}

/** iOS "interrumpe" el audio al salir de la app; al volver hay que reanudarlo. */
export function resume() {
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
}

export const isMusicOn = () => musicOn;
export const isSfxOn = () => sfxOn;

export function setMusic(on) {
  musicOn = on;
  localStorage.setItem('aya:music', on ? '1' : '0');
  if (!ctx) return;
  if (on) startMusic(); else stopMusic();
}
export function setSfx(on) {
  sfxOn = on;
  localStorage.setItem('aya:sfx', on ? '1' : '0');
  if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.02);
}

/* ───────────── instrumentos ───────────── */

function epiano(midi, t, dur, vel, out) {
  const f = mtof(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.012);
  g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  // fundamental + campanita suave (tipo Rhodes)
  const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f; o1.detune.value = (Math.random() - 0.5) * 8;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.18, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  o1.connect(g); o2.connect(g2).connect(g);
  g.connect(out);
  const send = ctx.createGain(); send.gain.value = 0.5; g.connect(send).connect(reverbSend);
  o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}

function bass(midi, t, dur, out) {
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(midi);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.32, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp).connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}

function brush(t, vel, out) {
  const s = ctx.createBufferSource(); s.buffer = noise;
  const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 7000; hp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  s.connect(hp).connect(g).connect(out);
  s.start(t, Math.random() * 0.5, 0.12);
}

function kick(t, out) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g).connect(out); o.start(t); o.stop(t + 0.35);
}

function startCrackle() {
  // vinilo: chasquidos esporádicos sobre un siseo casi inaudible
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * 0.012;
    if (Math.random() < 0.00018) d[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
  const g = ctx.createGain(); g.gain.value = 0.5;
  s.connect(lp).connect(g).connect(musicBus); s.start();
  crackle = s;
}

/* ───────────── secuenciador ───────────── */

// IVmaj7 – iii7 – ii9 – Imaj9 en Re♭ (cálido y nostálgico)
const KEY = 61; // C#4 / D♭4
const PROG = [
  { root: 5, notes: [0, 4, 7, 11, 14] },  // G♭maj9
  { root: 4, notes: [0, 3, 7, 10] },      // Fm7
  { root: 2, notes: [0, 3, 7, 10, 14] },  // E♭m9
  { root: 0, notes: [0, 4, 7, 11, 14] },  // D♭maj9
];
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
const BPM = 72;
const STEP = 60 / BPM / 2; // corcheas
let step = 0, nextT = 0, lastMel = 4;

function scheduleStep(t) {
  const bar = Math.floor(step / 8) % PROG.length;
  const pos = step % 8;
  const ch = PROG[bar];
  const swing = pos % 2 ? STEP * 0.16 : 0;
  const tt = t + swing;

  if (pos === 0) {
    const base = KEY - 12 + ch.root;
    ch.notes.forEach((n, i) => epiano(base + n, tt + i * 0.028, STEP * 7, 0.07 - i * 0.006, musicBus));
    bass(KEY - 24 + ch.root, tt, STEP * 3.5, musicBus);
  }
  if (pos === 5 && Math.random() < 0.55) {
    const base = KEY - 12 + ch.root;
    ch.notes.slice(1, 4).forEach((n, i) => epiano(base + n, tt + i * 0.02, STEP * 2.5, 0.04, musicBus));
  }
  if (pos === 4) bass(KEY - 24 + ch.root + (Math.random() < 0.4 ? 7 : 0), tt, STEP * 3, musicBus);

  if (pos === 0 || pos === 5) kick(tt, musicBus);
  if (pos === 2 || pos === 6) brush(tt, 0.08, musicBus);
  else if (Math.random() < 0.5) brush(tt, 0.025, musicBus);

  // melodía: un paseo aleatorio por la pentatónica, con silencios
  if (Math.random() < (pos % 2 ? 0.18 : 0.32)) {
    lastMel = Math.max(0, Math.min(PENTA.length - 1, lastMel + Math.round((Math.random() - 0.5) * 3)));
    epiano(KEY + 12 + PENTA[lastMel], tt, STEP * 4, 0.05, musicBus);
  }
}

function tick() {
  // mirada larga hacia adelante: si la pestaña va lenta, la música no se corta
  const ahead = document.hidden ? 2.2 : 0.6;
  while (nextT < ctx.currentTime + ahead) {
    scheduleStep(nextT);
    nextT += STEP;
    step++;
  }
}

function startMusic() {
  if (musicTimer || !ctx) return;
  nextT = ctx.currentTime + 0.1;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setTargetAtTime(0.55, ctx.currentTime, 1.2);
  if (!crackle) startCrackle();
  tick();
  musicTimer = setInterval(tick, 150);
}
function stopMusic() {
  if (!musicTimer) return;
  clearInterval(musicTimer); musicTimer = null;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  if (crackle) { const c = crackle; crackle = null; setTimeout(() => c.stop(), 1500); }
}

/* ───────────── efectos ───────────── */

function tone({ f = 440, f2 = null, type = 'sine', t = 0, dur = 0.15, vel = 0.3, rev = 0.2, attack = 0.005 }) {
  if (!ctx || !sfxOn) return;
  const at = ctx.currentTime + t;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(sfxBus);
  if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(reverbSend); }
  o.start(at); o.stop(at + dur + 0.05);
}

export const sfx = {
  tap() { tone({ f: 1400, f2: 900, type: 'triangle', dur: 0.05, vel: 0.12, rev: 0 }); },
  send() { tone({ f: 520, f2: 1040, dur: 0.11, vel: 0.22, rev: 0.1 }); },
  receive() {
    tone({ f: mtof(85), type: 'triangle', dur: 0.5, vel: 0.16, rev: 0.4 });
    tone({ f: mtof(92), type: 'triangle', t: 0.09, dur: 0.7, vel: 0.14, rev: 0.5 });
  },
  join() { [72, 76, 79, 84].forEach((m, i) => tone({ f: mtof(m), type: 'triangle', t: i * 0.08, dur: 0.6, vel: 0.14, rev: 0.5 })); },
  leave() { [79, 76, 72].forEach((m, i) => tone({ f: mtof(m), type: 'triangle', t: i * 0.1, dur: 0.5, vel: 0.11, rev: 0.5 })); },
  react() {
    const m = 79 + PENTA[Math.floor(Math.random() * 5)];
    tone({ f: mtof(m), f2: mtof(m + 5), dur: 0.16, vel: 0.18, rev: 0.3 });
  },
  nudge() {
    if (!ctx || !sfxOn) return;
    const at = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 70;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 22;
    const lg = ctx.createGain(); lg.gain.value = 25; lfo.connect(lg).connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    g.gain.setValueAtTime(0.35, at + 0.38); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    o.connect(lp).connect(g).connect(sfxBus);
    o.start(at); lfo.start(at); o.stop(at + 0.55); lfo.stop(at + 0.55);
  },
  error() { tone({ f: 300, f2: 200, type: 'triangle', dur: 0.2, vel: 0.2, rev: 0 }); },

  /** plumón sobre papel: ráfagas cortas de ruido filtrado */
  scribble(strokes = 2, bright = 1) {
    if (!ctx || !sfxOn) return;
    const at = ctx.currentTime;
    for (let k = 0; k < strokes; k++) {
      const t0 = at + k * 0.11;
      const s = ctx.createBufferSource(); s.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(1800 * bright, t0);
      bp.frequency.linearRampToValueAtTime(3200 * bright, t0 + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.015);
      // "rasposo": la amplitud tiembla un poco
      for (let i = 1; i < 6; i++) g.gain.setValueAtTime(0.14 + Math.random() * 0.2, t0 + i * 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      s.connect(bp).connect(g).connect(sfxBus);
      s.start(t0, Math.random() * 0.6, 0.12);
    }
  },
  poof() {
    if (!ctx || !sfxOn) return;
    const at = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, at); lp.frequency.exponentialRampToValueAtTime(200, at + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.28, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
    s.connect(lp).connect(g).connect(sfxBus);
    const send = ctx.createGain(); send.gain.value = 0.3; g.connect(send).connect(reverbSend);
    s.start(at, Math.random() * 0.5, 0.35);
    tone({ f: mtof(84), f2: mtof(72), type: 'sine', dur: 0.22, vel: 0.07, rev: 0.3 });
  },
  turn() { tone({ f: mtof(88), type: 'sine', dur: 0.25, vel: 0.09, rev: 0.4 }); },
  invite() {
    tone({ f: mtof(81), type: 'triangle', dur: 0.7, vel: 0.17, rev: 0.5 });
    tone({ f: mtof(77), type: 'triangle', t: 0.22, dur: 0.9, vel: 0.15, rev: 0.5 });
  },
  win() {
    [72, 76, 79, 84, 88].forEach((m, i) => tone({ f: mtof(m), type: 'triangle', t: i * 0.075, dur: 0.5, vel: 0.15, rev: 0.45 }));
    [72, 76, 79, 83].forEach((m) => tone({ f: mtof(m + 12), type: 'sine', t: 0.42, dur: 1.4, vel: 0.06, rev: 0.6 }));
  },
  lose() {
    [76, 74, 71].forEach((m, i) => tone({ f: mtof(m), type: 'triangle', t: i * 0.16, dur: 0.6, vel: 0.12, rev: 0.5 }));
  },
  draw() {
    tone({ f: mtof(76), type: 'triangle', dur: 0.4, vel: 0.12, rev: 0.4 });
    tone({ f: mtof(76), type: 'triangle', t: 0.18, dur: 0.6, vel: 0.1, rev: 0.4 });
  },

  /* ── billar ── (v: velocidad del impacto en m/s, para el volumen) */
  clack(v = 1, when = 0) {
    if (!ctx || !sfxOn) return;
    const at = ctx.currentTime + when;
    const k = Math.min(1, v / 3.5);
    const vel = 0.04 + 0.32 * k;
    // dos parciales inarmónicos muy cortos: el "clac" de resina
    for (const [f, a] of [[2650 + Math.random() * 400, 1], [4150 + Math.random() * 300, 0.5]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vel * a, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
      o.connect(g).connect(sfxBus); o.start(at); o.stop(at + 0.06);
    }
    const s = ctx.createBufferSource(); s.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const g = ctx.createGain(); g.gain.setValueAtTime(vel * 0.5, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.02);
    s.connect(hp).connect(g).connect(sfxBus); s.start(at, Math.random() * 0.5, 0.03);
  },
  rail(v = 1, when = 0) {
    if (!ctx || !sfxOn) return;
    const at = ctx.currentTime + when;
    const vel = 0.05 + 0.3 * Math.min(1, v / 3);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(190, at); o.frequency.exponentialRampToValueAtTime(90, at + 0.09);
    const g = ctx.createGain(); g.gain.setValueAtTime(vel, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    o.connect(g).connect(sfxBus); o.start(at); o.stop(at + 0.14);
    const s = ctx.createBufferSource(); s.buffer = noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(vel * 0.6, at); g2.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    s.connect(lp).connect(g2).connect(sfxBus); s.start(at, Math.random() * 0.5, 0.07);
  },
  pocket(when = 0) {
    if (!ctx || !sfxOn) return;
    const at = ctx.currentTime + when;
    // golpe sordo + la bola rodando por el canal
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, at); o.frequency.exponentialRampToValueAtTime(55, at + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    o.connect(g).connect(sfxBus); o.start(at); o.stop(at + 0.27);
    for (let i = 0; i < 5; i++) {
      const t0 = at + 0.12 + i * (0.07 + Math.random() * 0.03);
      const s = ctx.createBufferSource(); s.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 300; bp.Q.value = 3;
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.18 * (1 - i / 6), t0); g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      s.connect(bp).connect(g2).connect(sfxBus); s.start(t0, Math.random() * 0.5, 0.06);
    }
  },
  cue(power = 0.5) {
    if (!ctx || !sfxOn) return;
    const at = ctx.currentTime;
    const vel = 0.08 + 0.3 * power;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(950, at); o.frequency.exponentialRampToValueAtTime(420, at + 0.04);
    const g = ctx.createGain(); g.gain.setValueAtTime(vel, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    o.connect(g).connect(sfxBus); o.start(at); o.stop(at + 0.08);
  },
};
