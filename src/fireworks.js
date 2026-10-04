// Салют: частицы на отдельном холсте поверх игры (ТЗ §9, поздравление за 10 из 10).
// Это только оформление: с игровой логикой салют не связан и идёт по настоящему
// времени — поэтому продолжается, пока игра стоит на паузе.

const COLORS = ['#ff3b30', '#ffd34d', '#ffffff', '#4cd964', '#ff9f1a'];

export function createFireworks(canvas, { onBurst } = {}) {
  const ctx = canvas.getContext('2d');
  let particles = [];
  let active = false;
  let untilNextBurst = 0;
  let w = 0;
  let h = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth || window.innerWidth;
    h = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function burst() {
    const x = w * (0.1 + Math.random() * 0.8);
    const y = h * (0.1 + Math.random() * 0.45);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const power = 120 + Math.random() * 120;
    const count = 70;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.1;
      const speed = power * (0.6 + Math.random() * 0.4);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 1.3 + Math.random() * 0.7,
        color,
      });
    }
    onBurst?.((x / w) * 2 - 1); // где взорвалось: −1 слева, +1 справа — для звука
  }

  function start() {
    active = true;
    untilNextBurst = 0;
    canvas.hidden = false;
    resize();
    canvas.classList.add('dim');
  }

  // Новые залпы прекращаются, уже взлетевшие искры догорают.
  function stop() {
    active = false;
    canvas.classList.remove('dim');
  }

  function frame(dt) {
    if (!active && particles.length === 0) {
      if (!canvas.hidden) {
        ctx.clearRect(0, 0, w, h);
        canvas.hidden = true;
      }
      return;
    }
    if (active) {
      untilNextBurst -= dt;
      if (untilNextBurst <= 0) {
        burst();
        untilNextBurst = 0.35 + Math.random() * 0.5;
      }
    }

    // Прошлый кадр не стираем целиком, а приглушаем — так у искр остаются хвосты.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      p.life += dt;
      p.vx *= 1 - 1.2 * dt; // сопротивление воздуха
      p.vy *= 1 - 1.2 * dt;
      p.vy += 60 * dt; // искры оседают вниз
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = 1 - p.life / p.maxLife;
      if (k <= 0) continue;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6 + k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    particles = particles.filter((p) => p.life < p.maxLife);
  }

  function reset() {
    active = false;
    particles = [];
    canvas.classList.remove('dim');
  }

  return { resize, start, stop, frame, reset };
}
