// Точка входа: связывает логику, отображение, звук и управление в игровой цикл.
import { CONFIG } from './config.js';
import { createGame, update, fire, rotate, setPaused, relativeAngle, bearingOf } from './logic.js';
import { createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';

const canvas = document.getElementById('view');
const renderer = createRenderer(canvas, CONFIG);
const audio = createAudio();
const hud = createHud(newGame);

let game = createGame(CONFIG);
let fx = freshEffects();

const input = createInput(canvas, CONFIG, {
  onRotate: (deg) => rotate(game, deg),
  // На паузе кнопка пуска не стреляет, а снимает паузу.
  onFire: () => (game.paused ? setPaused(game, false) : fire(game)),
  onGesture: () => audio.unlock(),
  onPauseToggle: () => setPaused(game, !game.paused),
  // Отпустили мышь (Esc) — пауза; снова захватили щелчком — игра продолжается.
  onCaptureChange: (captured) => setPaused(game, !captured),
});

// Свернули вкладку или переключились на другую — тоже пауза.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(game, true);
});

function freshEffects() {
  return { time: 0, flashes: [], bonusUntil: -1 };
}

// Новая игра полностью сбрасывает партию (ТЗ §10).
function newGame() {
  game = createGame(CONFIG);
  fx = freshEffects();
  hud.hideResults();
  audio.unlock();
  input.capture();
}

// Логика сообщает, что произошло, — здесь решаем, как это показать и озвучить.
function handle(event) {
  switch (event.type) {
    case 'launch':
      audio.launch();
      break;
    case 'hit': {
      const rel = relativeAngle(bearingOf(event.x, event.y), game.heading);
      audio.explosion(Math.sin((rel * Math.PI) / 180), Math.hypot(event.x, event.y));
      fx.flashes.push({ shipId: event.shipId, x: event.x, y: event.y, length: event.length, t: fx.time });
      break;
    }
    case 'bonus':
      fx.bonusUntil = fx.time + CONFIG.effects.bonusMessage;
      break;
    case 'gameOver':
      document.exitPointerLock?.();
      hud.showResults(game.stats);
      break;
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, CONFIG.maxFrameDt);
  last = now;
  // Пламя и вспышки идут и на паузе: иначе вспышка, пойманная паузой,
  // застывает на полной яркости и засвечивает обзор. Корабли и торпеды стоят.
  fx.time += dt;
  if (!game.paused) {
    rotate(game, input.rotation(dt));
    update(game, dt);
  }
  for (const event of game.events.splice(0)) handle(event);
  fx.flashes = fx.flashes.filter((f) => fx.time - f.t < CONFIG.effects.flash);
  renderer.draw(game, fx);
  hud.update(game, fx, input.captured());
  requestAnimationFrame(frame);
}

// Режим отладки (адрес с ?debug): состояние игры доступно из консоли браузера
// как periscope.game — чтобы проверять приёмку, не играя партию целиком.
if (new URLSearchParams(location.search).has('debug')) {
  window.periscope = { get game() { return game; } };
}

window.addEventListener('resize', renderer.resize);
renderer.resize();
requestAnimationFrame(frame);
