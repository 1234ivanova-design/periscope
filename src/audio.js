// Звуки синтезируются прямо в браузере (Web Audio) — без звуковых файлов.
// Браузер разрешает звук только после действия игрока, поэтому unlock()
// вызывается при первом щелчке или нажатии клавиши.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noise = null;

  function unlock() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
      const limiter = ctx.createDynamicsCompressor();
      limiter.connect(ctx.destination);
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(limiter);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  // pan: −1 — звук слева, +1 — справа.
  function output(pan) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(master);
    return panner;
  }

  function noiseBurst(dest, t, { type, from, to, q, gain, attack, decay }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(filter).connect(env).connect(dest);
    src.start(t, Math.random());
    src.stop(t + attack + decay + 0.05);
  }

  function thump(dest, t, { from, to, gain, decay }) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(env).connect(dest);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  // Пуск торпеды: толчок сжатого воздуха и уходящее шипение.
  function launch() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = output(0);
    thump(out, t, { from: 140, to: 45, gain: 0.7, decay: 0.3 });
    noiseBurst(out, t, { type: 'bandpass', from: 2400, to: 300, q: 0.7, gain: 0.45, attack: 0.02, decay: 1.1 });
  }

  // Взрыв: удар и долгий раскат. Чем дальше цель, тем тише; pan — с какой стороны.
  function explosion(pan, distance) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = output(pan);
    const loud = Math.max(0.35, Math.min(1, 900 / distance));
    thump(out, t, { from: 90, to: 28, gain: loud, decay: 1.2 });
    noiseBurst(out, t, { type: 'lowpass', from: 3500, to: 120, q: 0.5, gain: 0.9 * loud, attack: 0.01, decay: 2.2 });
  }

  // Залп салюта: хлопок и треск рассыпающихся искр.
  function salute(pan) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = output(pan * 0.8);
    thump(out, t, { from: 160, to: 50, gain: 0.5, decay: 0.25 });
    noiseBurst(out, t + 0.05, { type: 'highpass', from: 3000, to: 1500, q: 0.7, gain: 0.25, attack: 0.01, decay: 0.6 });
  }

  // Сигнал горна: восходящие ноты соль — до — ми — соль.
  function bugle() {
    if (!ctx) return;
    const out = output(0);
    const notes = [
      [392.0, 0, 0.16],
      [523.25, 0.18, 0.16],
      [659.25, 0.36, 0.16],
      [783.99, 0.54, 0.7],
    ]; // [частота, начало, длительность]
    for (const [freq, at, len] of notes) {
      const t = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2200; // смягчаем «пилу» до медного тембра
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      env.gain.setValueAtTime(0.22, t + len - 0.05);
      env.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(filter).connect(env).connect(out);
      osc.start(t);
      osc.stop(t + len + 0.05);
    }
  }

  return { unlock, launch, explosion, salute, bugle };
}
