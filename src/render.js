// Отображение: рисует вид через перископ на <canvas> по состоянию игры.
// Только читает состояние — в логику не вмешивается (ТЗ §11).
import { relativeAngle, bearingOf, dirVector } from './logic.js';

const DEG = Math.PI / 180;
const HUD_HEIGHT = 64; // нижняя панель с показателями (в разметке — #hud)

// Силуэты кораблей в долях длины корпуса: x — от кормы (−0.5) к носу (+0.5),
// высота отсчитывается вверх от палубы.
const SHAPES = {
  small: {
    freeboard: 0.13,
    blocks: [[-0.2, 0.16, 0.1], [0.0, 0.13, 0.17]], // [x от, x до, высота]
    funnels: [], // [x центра, ширина, высота]
    masts: [[0.06, 0.34]], // [x, высота]
  },
  medium: {
    freeboard: 0.11,
    blocks: [[0.1, 0.3, 0.1], [0.14, 0.27, 0.16]],
    funnels: [[-0.12, 0.07, 0.18]],
    masts: [[0.4, 0.24], [-0.34, 0.24]],
  },
  large: {
    freeboard: 0.1,
    blocks: [[-0.34, 0.3, 0.06], [-0.24, 0.2, 0.11], [0.06, 0.18, 0.15]],
    funnels: [[-0.14, 0.06, 0.22], [0.0, 0.06, 0.22]],
    masts: [[0.4, 0.22], [-0.42, 0.18]],
  },
};

export function createRenderer(canvas, config) {
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, cx: 0, cy: 0, r: 0, f: 0, horizon: 0 };
  const scenery = makeScenery();
  const { fov, eyeHeight } = config.periscope;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    view.w = canvas.clientWidth;
    view.h = canvas.clientHeight;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const usable = Math.max(200, view.h - HUD_HEIGHT);
    view.r = Math.min(view.w * 0.46, usable * 0.47);
    view.cx = view.w / 2;
    view.cy = usable / 2;
    view.f = view.r / Math.tan((fov / 2) * DEG); // «фокусное расстояние» в пикселях
    view.horizon = view.cy;
  }

  // Где на экране точка моря с пеленгом bearing на расстоянии distance.
  function project(bearing, distance, heading) {
    const rel = relativeAngle(bearing, heading);
    if (Math.abs(rel) > 80) return null;
    return {
      x: view.cx + view.f * Math.tan(rel * DEG),
      y: view.horizon + (view.f * eyeHeight) / distance,
      rel,
    };
  }

  function draw(game, fx) {
    const { w, h, cx, cy, r } = view;
    ctx.fillStyle = '#0b0d10';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    drawSkyAndSea();
    drawClouds(game.heading);
    drawWaves(game.heading, fx.time);
    for (const torpedo of game.torpedoes) drawTorpedo(torpedo, game.heading, fx.time);

    const ships = [...game.ships].sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));
    for (const ship of ships) drawShipInView(ship, game.heading, fx.time);

    drawFlashes(game, fx);
    drawVignette();
    ctx.restore();

    drawReticle();
    drawBearingScale(game.heading);
    drawRim();
  }

  function drawSkyAndSea() {
    const { cx, cy, r, horizon } = view;
    const sky = ctx.createLinearGradient(0, cy - r, 0, horizon);
    sky.addColorStop(0, '#081221');
    sky.addColorStop(1, '#33465f');
    ctx.fillStyle = sky;
    ctx.fillRect(cx - r, cy - r, r * 2, horizon - (cy - r));

    const sea = ctx.createLinearGradient(0, horizon, 0, cy + r);
    sea.addColorStop(0, '#1f3a4e');
    sea.addColorStop(1, '#05101a');
    ctx.fillStyle = sea;
    ctx.fillRect(cx - r, horizon, r * 2, cy + r - horizon);

    // Лёгкая дымка у горизонта.
    const haze = ctx.createLinearGradient(0, horizon - 18, 0, horizon + 6);
    haze.addColorStop(0, 'rgba(120, 145, 170, 0)');
    haze.addColorStop(0.75, 'rgba(120, 145, 170, 0.25)');
    haze.addColorStop(1, 'rgba(120, 145, 170, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(cx - r, horizon - 18, r * 2, 24);
  }

  function drawClouds(heading) {
    for (const cloud of scenery.clouds) {
      const rel = relativeAngle(cloud.bearing, heading);
      if (Math.abs(rel) > fov / 2 + cloud.width) continue;
      const x = view.cx + view.f * Math.tan(rel * DEG);
      const y = view.horizon - view.f * Math.tan(cloud.elevation * DEG);
      const rx = (view.f * cloud.width * DEG) / 2;
      ctx.fillStyle = `rgba(130, 150, 180, ${cloud.alpha})`;
      for (const [dx, dy, k] of cloud.puffs) {
        ctx.beginPath();
        ctx.ellipse(x + dx * rx, y + dy * rx * 0.2, rx * k, rx * k * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawWaves(heading, time) {
    ctx.lineCap = 'round';
    for (const row of scenery.waves) {
      const y0 = view.horizon + (view.f * eyeHeight) / row.distance;
      if (y0 > view.cy + view.r) continue;
      const len = clamp((view.f * 6) / row.distance, 2, 70);
      ctx.lineWidth = clamp((view.f * 0.3) / row.distance, 0.6, 2.5);
      ctx.strokeStyle = `rgba(150, 195, 220, ${clamp(40 / row.distance, 0.05, 0.35)})`;
      ctx.beginPath();
      for (const crest of row.crests) {
        const rel = relativeAngle(crest.bearing + Math.sin(time * 0.4 + crest.phase) * 0.15, heading);
        if (Math.abs(rel) > fov / 2 + 2) continue;
        const x = view.cx + view.f * Math.tan(rel * DEG);
        const y = y0 + Math.sin(time * 1.3 + crest.phase) * len * 0.04;
        ctx.moveTo(x - len / 2, y);
        ctx.lineTo(x + len / 2, y);
      }
      ctx.stroke();
    }
  }

  // Пенный след торпеды: от перископа вдоль её курса до текущего положения.
  function drawTorpedo(torpedo, heading, time) {
    const rel = relativeAngle(torpedo.course, heading);
    if (Math.abs(rel) > fov / 2 + 3) return;
    const x = view.cx + view.f * Math.tan(rel * DEG);
    const dist = Math.max(25, Math.hypot(torpedo.x, torpedo.y));
    const tail = Math.max(20, dist - 500);
    const yAt = (d) => view.horizon + (view.f * eyeHeight) / d;
    const widthAt = (d) => clamp((view.f * 3) / d, 0.8, 14);

    // Полоса следа: точки равномерны по экрану, т. е. по 1/расстояния.
    const N = 24;
    const left = [];
    const right = [];
    for (let i = 0; i <= N; i++) {
      const d = 1 / (1 / tail + (1 / dist - 1 / tail) * (i / N));
      const y = yAt(d);
      const half = widthAt(d) / 2;
      left.push([x - half, y]);
      right.push([x + half, y]);
    }
    ctx.fillStyle = 'rgba(210, 235, 250, 0.3)';
    ctx.beginPath();
    left.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();

    // Пузыри.
    for (let k = 0; k < 50; k++) {
      const u = hash(torpedo.id * 97 + k);
      const d = 1 / (1 / tail + (1 / dist - 1 / tail) * u);
      const wobble = (hash(k * 13 + Math.floor(time * 8)) - 0.5) * widthAt(d);
      ctx.fillStyle = `rgba(235, 248, 255, ${0.35 + 0.6 * u})`;
      ctx.beginPath();
      ctx.arc(x + wobble, yAt(d), Math.max(0.6, widthAt(d) * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.beginPath();
    ctx.arc(x, yAt(dist), Math.max(1.5, widthAt(dist) * 0.3), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawShipInView(ship, heading, time) {
    const dist = Math.hypot(ship.x, ship.y);
    const p = project(bearingOf(ship.x, ship.y), dist, heading);
    if (!p) return;
    const s = (ship.length * view.f) / dist; // длина корабля на экране, px
    if (p.x + s < view.cx - view.r || p.x - s > view.cx + view.r) return;
    // Нос — в сторону видимого движения по экрану.
    const v = dirVector(ship.course);
    const facing = ship.y * v.x - ship.x * v.y >= 0 ? 1 : -1;
    drawShip(ship, p.x, p.y, s, facing, time);
  }

  function drawShip(ship, x, y, s, facing, time) {
    const shape = SHAPES[ship.type];
    const h = shape.freeboard;
    const sink = ship.state === 'sinking' ? Math.min(1, ship.sinkTime / config.effects.sink) : 0;
    const px = 1 / s; // один экранный пиксель в долях длины корабля

    ctx.save();
    ctx.translate(x, y);
    // Всё, что ушло под воду, не рисуем.
    ctx.beginPath();
    ctx.rect(-s * 2, -s * 3, s * 4, s * 3);
    ctx.clip();
    if (sink > 0) {
      ctx.translate(0, sink * sink * s * 0.45);
      ctx.rotate(facing * sink * 0.25); // нос уходит под воду
    }
    ctx.scale(s * facing, s);

    // Корпус: корма слегка скошена, нос приподнят.
    ctx.fillStyle = '#121820';
    ctx.beginPath();
    ctx.moveTo(-0.47, 0);
    ctx.lineTo(-0.5, -h);
    ctx.lineTo(0.5, -h * 1.4);
    ctx.lineTo(0.43, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 190, 210, 0.35)';
    ctx.lineWidth = px;
    ctx.stroke();

    ctx.fillStyle = '#29313b';
    for (const [x0, x1, bh] of shape.blocks) ctx.fillRect(x0, -h - bh, x1 - x0, bh);
    for (const [fx0, fw, fh] of shape.funnels) {
      ctx.fillStyle = '#3b3430';
      ctx.fillRect(fx0 - fw / 2, -h - fh, fw, fh);
      ctx.fillStyle = '#0d0f12';
      ctx.fillRect(fx0 - fw / 2, -h - fh, fw, fh * 0.2);
    }
    ctx.strokeStyle = '#29313b';
    ctx.lineWidth = Math.max(px, 0.008);
    for (const [mx, mh] of shape.masts) {
      ctx.beginPath();
      ctx.moveTo(mx, -h);
      ctx.lineTo(mx, -h - mh);
      ctx.stroke();
    }

    // Иллюминаторы: число задано типом и не зависит от расстояния (ТЗ §4).
    // Радиус не меньше 1,4 px, чтобы огоньки различались и вдали.
    const n = ship.portholes;
    const radius = Math.max(1.4 * px, 0.012);
    ctx.fillStyle = '#ffd36b';
    ctx.shadowColor = 'rgba(255, 200, 90, 0.9)';
    ctx.shadowBlur = 6;
    for (let i = 0; i < n; i++) {
      const hx = -0.39 + (0.76 * i) / (n - 1);
      ctx.beginPath();
      ctx.arc(hx, -h * 0.5, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (sink > 0) drawFire(h, sink, time, ship.id);
    ctx.restore();
  }

  function drawFire(h, sink, time, seed) {
    const fade = sink > 0.8 ? (1 - sink) / 0.2 : 1;
    ctx.save();
    ctx.shadowColor = 'rgba(255, 120, 30, 0.9)';
    ctx.shadowBlur = 12;
    [-0.22, 0.02, 0.24].forEach((x, i) => {
      const flicker = Math.sin(time * 13 + i * 2.3 + seed) * 0.5 + Math.sin(time * 7.1 + i) * 0.5;
      const height = (0.16 + 0.05 * flicker) * fade;
      flame(x, -h, 0.07, height, 'rgba(255, 110, 30, 0.9)');
      flame(x, -h, 0.04, height * 0.6, 'rgba(255, 228, 120, 0.95)');
    });
    ctx.restore();
    for (let k = 0; k < 6; k++) {
      const age = (time * 0.35 + k / 6 + seed * 0.13) % 1;
      ctx.fillStyle = `rgba(30, 30, 34, ${0.45 * (1 - age) * fade})`;
      ctx.beginPath();
      ctx.arc(-0.05 + age * 0.25 + Math.sin(k * 1.7) * 0.06, -h - 0.18 - age * 0.55, 0.05 + age * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function flame(x, base, w, height, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, base);
    ctx.quadraticCurveTo(x - w * 0.45, base - height * 0.6, x, base - height);
    ctx.quadraticCurveTo(x + w * 0.45, base - height * 0.6, x + w / 2, base);
    ctx.closePath();
    ctx.fill();
  }

  // Вспышка взрыва: яркий шар у корабля и засветка всего обзора.
  // Если взрыв вне обзора, засветка слабая — но она есть (ТЗ §6).
  function drawFlashes(game, fx) {
    let glare = 0;
    for (const flash of fx.flashes) {
      const age = (fx.time - flash.t) / config.effects.flash;
      if (age >= 1) continue;
      const ship = game.ships.find((s) => s.id === flash.shipId);
      const x = ship ? ship.x : flash.x;
      const y = ship ? ship.y : flash.y;
      const dist = Math.hypot(x, y);
      const p = project(bearingOf(x, y), dist, game.heading);
      const inView = p && Math.abs(p.rel) < fov / 2 + 3;
      glare = Math.max(glare, (inView ? 0.6 : 0.12) * (1 - age) ** 2);
      if (!inView) continue;
      const s = (flash.length * view.f) / dist;
      const radius = s * (0.3 + age * 0.9) + 10;
      const g = ctx.createRadialGradient(p.x, p.y - s * 0.1, 0, p.x, p.y - s * 0.1, radius);
      g.addColorStop(0, `rgba(255, 255, 240, ${1 - age})`);
      g.addColorStop(0.35, `rgba(255, 200, 90, ${0.8 * (1 - age)})`);
      g.addColorStop(1, 'rgba(255, 120, 30, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y - s * 0.1, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    if (glare > 0) {
      ctx.fillStyle = `rgba(255, 244, 220, ${glare})`;
      ctx.fillRect(view.cx - view.r, view.cy - view.r, view.r * 2, view.r * 2);
    }
  }

  function drawVignette() {
    const { cx, cy, r } = view;
    const g = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // Прицел: перекрестие и риски через 5° — по ним удобно брать упреждение.
  function drawReticle() {
    const { cx, cy, r, f } = view;
    const gap = 14;
    ctx.strokeStyle = 'rgba(190, 225, 255, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap);
    ctx.lineTo(cx, cy + r);
    for (let a = 5; a < fov / 2; a += 5) {
      const dx = f * Math.tan(a * DEG);
      const len = a % 10 === 0 ? 9 : 5;
      for (const x of [cx - dx, cx + dx]) {
        ctx.moveTo(x, cy - len);
        ctx.lineTo(x, cy + len);
      }
    }
    ctx.stroke();
  }

  // Шкала пеленга в верхней части обзора.
  function drawBearingScale(heading) {
    const { cx, cy, r, f } = view;
    const y = cy - r * 0.72;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 200, 97, 0.7)';
    ctx.fillStyle = 'rgba(255, 200, 97, 0.85)';
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.beginPath();
    for (let b = Math.ceil((heading - fov / 2) / 5) * 5; b <= heading + fov / 2; b += 5) {
      const x = cx + f * Math.tan((b - heading) * DEG);
      const deg = Math.round(((b % 360) + 360) % 360);
      const len = deg % 10 === 0 ? 8 : 4;
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      if (deg % 10 === 0) ctx.fillText(String(deg).padStart(3, '0'), x, y - 4);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, y + 11);
    ctx.lineTo(cx - 5, y + 19);
    ctx.lineTo(cx + 5, y + 19);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawRim() {
    const { cx, cy, r } = view;
    ctx.strokeStyle = '#1f2329';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 11, 0, Math.PI * 2);
    ctx.stroke();
  }

  return { resize, draw };
}

// Облака и гребни волн привязаны к пеленгам, поэтому при повороте
// перископа они уплывают в сторону — это и создаёт ощущение вращения.
function makeScenery() {
  const clouds = [];
  for (let i = 0; i < 16; i++) {
    const puffs = [];
    for (let k = 0; k < 4; k++) puffs.push([(hash(i * 31 + k) - 0.5) * 1.2, (hash(i * 17 + k) - 0.5) * 2, 0.4 + hash(i * 7 + k) * 0.5]);
    clouds.push({
      bearing: hash(i * 3 + 1) * 360,
      elevation: 3 + hash(i * 5 + 2) * 14,
      width: 8 + hash(i * 11 + 3) * 16,
      alpha: 0.05 + hash(i * 13 + 4) * 0.07,
      puffs,
    });
  }
  const waves = [];
  for (let k = 0; k < 14; k++) {
    const distance = 40 * 1.35 ** k;
    const spacing = Math.max(0.4, (18 / distance / DEG) * 0.6);
    const crests = [];
    for (let b = 0, i = 0; b < 360; b += spacing, i++) {
      crests.push({ bearing: b + hash(k * 1000 + i) * spacing, phase: hash(k * 77 + i) * 6.28 });
    }
    waves.push({ distance, crests });
  }
  return { clouds, waves };
}

// Детерминированное «случайное» число 0..1 по целому n — пейзаж одинаков от партии к партии.
function hash(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
