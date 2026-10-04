// Автотесты игровой логики. Запуск: npm test
// Номера в названиях — пункты критериев приёмки из ТЗ (§12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import {
  createGame,
  update,
  fire,
  rotate,
  setPaused,
  addShip,
  dirVector,
  relativeAngle,
  bearingOf,
  isWaiting,
  accuracy,
} from '../src/logic.js';

// Пустое море: корабли ставим в тестах вручную.
function emptySea() {
  const config = structuredClone(CONFIG);
  config.ships.maxCount = 0;
  return createGame(config);
}

// Стоящий корабль прямо по курсу перископа.
function shipAhead(game, { type = 'small', distance = 600 } = {}) {
  const v = dirVector(game.heading);
  return addShip(game, { type, x: v.x * distance, y: v.y * distance, course: game.heading + 90, speed: 0 });
}

function runUntilResolved(game, step = 0.05) {
  for (let t = 0; game.torpedoes.length > 0 && t < 60; t += step) update(game, step);
}

function shootAhead(game, type = 'small') {
  shipAhead(game, { type });
  fire(game);
  runUntilResolved(game);
}

function shootEmptySea(game) {
  fire(game);
  runUntilResolved(game);
}

// Простой генератор случайных чисел с зерном — чтобы тест был воспроизводимым.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('1. Перископ вращается на 360° без скачка на переходе 359° → 0°', () => {
  const game = emptySea();
  rotate(game, -1);
  assert.equal(game.heading, 359);
  rotate(game, 2);
  assert.equal(game.heading, 1);
  assert.equal(relativeAngle(1, 359), 2);
  assert.equal(relativeAngle(359, 1), -2);
});

test('2. Одно нажатие — одна торпеда; без боезапаса пуск невозможен', () => {
  const game = emptySea();
  for (let i = 0; i < 10; i++) assert.equal(fire(game), true);
  assert.equal(game.torpedoes.length, 10);
  assert.equal(game.ammo, 0);
  assert.equal(fire(game), false);
  assert.equal(game.stats.fired, 10);
});

test('3–4. Корабли идут разными курсами и скоростями; у типов 3, 5, 8 иллюминаторов', () => {
  const game = createGame(CONFIG, seeded(42));
  assert.equal(game.ships.length, CONFIG.ships.maxCount);
  const courses = new Set(game.ships.map((s) => Math.round(s.course)));
  const speeds = new Set(game.ships.map((s) => Math.round(s.speed)));
  assert.ok(courses.size >= 5, 'курсы должны различаться');
  assert.ok(speeds.size >= 5, 'скорости должны различаться');
  for (const ship of game.ships) {
    assert.ok(ship.speed >= CONFIG.ships.speedMin && ship.speed <= CONFIG.ships.speedMax);
    assert.ok(Math.hypot(ship.x, ship.y) <= CONFIG.world.radius);
  }
  const { small, medium, large } = CONFIG.ships.types;
  assert.deepEqual([small.portholes, medium.portholes, large.portholes], [3, 5, 8]);
  assert.deepEqual([small.tonnage, medium.tonnage, large.tonnage], [1000, 3000, 6000]);
});

test('5. По движущейся цели без упреждения — промах, с упреждением — попадание', () => {
  // Корабль в 1000 м строго на север идёт на восток со скоростью 30 м/с.
  const place = (game) => addShip(game, { type: 'small', x: 0, y: 1000, course: 90, speed: 30 });

  const direct = emptySea();
  place(direct);
  fire(direct);
  runUntilResolved(direct);
  assert.equal(direct.stats.hits, 0);

  // Упреждение: момент t, когда торпеда и корабль окажутся в одной точке.
  const vt = CONFIG.torpedo.speed;
  const t = Math.sqrt(1000 ** 2 / (vt ** 2 - 30 ** 2));
  const lead = bearingOf(30 * t, 1000);
  const aimed = emptySea();
  place(aimed);
  rotate(aimed, lead);
  fire(aimed);
  runUntilResolved(aimed);
  assert.equal(aimed.stats.hits, 1);
});

test('6. Поворот перископа после пуска не меняет курс торпеды; попадание вне обзора засчитывается', () => {
  const game = emptySea();
  rotate(game, 30);
  shipAhead(game);
  fire(game);
  rotate(game, 150); // отвернулись от цели
  update(game, 0.5);
  const torpedo = game.torpedoes[0];
  assert.equal(torpedo.course, 30);
  assert.ok(Math.abs(bearingOf(torpedo.x, torpedo.y) - 30) < 1e-9);
  runUntilResolved(game);
  assert.equal(game.stats.hits, 1);
});

test('7. Несколько торпед движутся одновременно', () => {
  const game = emptySea();
  fire(game);
  rotate(game, 10);
  fire(game);
  rotate(game, 10);
  fire(game);
  update(game, 1);
  assert.equal(game.torpedoes.length, 3);
});

test('8. Одно попадание топит корабль любого тоннажа и порождает событие взрыва', () => {
  const game = emptySea();
  const ship = shipAhead(game, { type: 'large' });
  fire(game);
  runUntilResolved(game);
  assert.equal(ship.state, 'sinking');
  assert.equal(game.stats.sunk, 1);
  assert.ok(game.events.some((e) => e.type === 'hit' && e.shipId === ship.id));
});

test('9. Тонущий корабль засчитывается один раз — вторая торпеда проходит сквозь него', () => {
  const game = emptySea();
  shipAhead(game);
  fire(game);
  runUntilResolved(game);
  fire(game);
  runUntilResolved(game);
  assert.equal(game.stats.sunk, 1);
  assert.equal(game.stats.hits, 1);
  assert.equal(game.stats.misses, 1);
  assert.equal(game.stats.tonnage, 1000);
});

test('9. Одна торпеда топит только один корабль — ближайший на своём пути', () => {
  const game = emptySea();
  const near = shipAhead(game, { distance: 500 });
  const far = shipAhead(game, { distance: 520 });
  fire(game);
  update(game, 3); // большой шаг: торпеда за один шаг проходит оба корабля
  assert.equal(game.stats.sunk, 1);
  assert.equal(near.state, 'sinking');
  assert.equal(far.state, 'moving');
});

test('Быстрая торпеда не проскакивает корабль между кадрами', () => {
  const game = emptySea();
  shipAhead(game, { distance: 600 });
  fire(game);
  update(game, 4); // за шаг торпеда проходит 1200 м — «сквозь» корабль
  assert.equal(game.stats.hits, 1);
});

test('Движение зависит от времени, а не от числа кадров', () => {
  const make = () => {
    const game = emptySea();
    addShip(game, { type: 'medium', x: 300, y: 900, course: 200, speed: 27 });
    rotate(game, 45);
    fire(game);
    return game;
  };
  const once = make();
  update(once, 1);
  const often = make();
  for (let i = 0; i < 100; i++) update(often, 0.01);
  assert.ok(Math.abs(once.ships[0].x - often.ships[0].x) < 1e-6);
  assert.ok(Math.abs(once.ships[0].y - often.ships[0].y) < 1e-6);
  assert.ok(Math.abs(once.torpedoes[0].x - often.torpedoes[0].x) < 1e-6);
});

test('10–11. Начальный боезапас 10; десять попаданий из десяти дают ровно 3 призовые торпеды', () => {
  const game = emptySea();
  assert.equal(game.ammo, 10);
  for (let i = 0; i < 10; i++) {
    rotate(game, 36);
    shootAhead(game);
  }
  assert.equal(game.bonusGranted, true);
  assert.equal(game.ammo, 3);

  for (let i = 0; i < 3; i++) {
    rotate(game, 36);
    shootAhead(game);
  }
  for (let i = 0; i < 200 && !game.over; i++) update(game, 0.05);
  assert.equal(game.over, true);
  assert.equal(game.stats.fired, 13, 'призовые попадания не дают новых выстрелов');
  assert.equal(game.stats.hits, 13);
  assert.equal(game.events.filter((e) => e.type === 'bonus').length, 1);
});

test('12. Любой промах среди первых десяти исключает бонус', () => {
  const game = emptySea();
  shootEmptySea(game); // промах первым же выстрелом
  for (let i = 0; i < 9; i++) {
    rotate(game, 36);
    shootAhead(game);
  }
  for (let i = 0; i < 200 && !game.over; i++) update(game, 0.05);
  assert.equal(game.bonusGranted, false);
  assert.equal(game.over, true);
  assert.equal(game.stats.fired, 10);
});

test('13. Партия не завершается, пока торпеды в пути', () => {
  const game = emptySea();
  for (let i = 0; i < 10; i++) fire(game);
  update(game, 0.1);
  assert.equal(game.over, false);
  assert.equal(isWaiting(game), true);
  runUntilResolved(game);
  assert.equal(game.over, true);
});

test('13. Итоговый экран ждёт окончания анимации потопления', () => {
  const game = emptySea();
  for (let i = 0; i < 9; i++) shootEmptySea(game);
  shootAhead(game);
  assert.equal(game.over, false, 'корабль ещё тонет');
  update(game, CONFIG.effects.sink + 0.1);
  assert.equal(game.over, true);
});

test('14. Итоговый тоннаж равен сумме тоннажей: 2 малых + 1 крупный = 8 000 т', () => {
  const game = emptySea();
  shootAhead(game, 'small');
  rotate(game, 90);
  shootAhead(game, 'small');
  rotate(game, 90);
  shootAhead(game, 'large');
  assert.equal(game.stats.tonnage, 8000);
  assert.equal(game.stats.sunk, 3);
});

test('Пауза: время стоит, поворот и пуск не работают; после снятия всё продолжается', () => {
  const game = emptySea();
  const ship = addShip(game, { type: 'medium', x: 300, y: 900, course: 200, speed: 27 });
  fire(game);
  update(game, 0.5);
  const shipAt = { x: ship.x, y: ship.y };
  const torpedoAt = { x: game.torpedoes[0].x, y: game.torpedoes[0].y };

  setPaused(game, true);
  update(game, 3);
  rotate(game, 45);
  assert.equal(fire(game), false);
  assert.deepEqual({ x: ship.x, y: ship.y }, shipAt);
  assert.deepEqual({ x: game.torpedoes[0].x, y: game.torpedoes[0].y }, torpedoAt);
  assert.equal(game.heading, 0);
  assert.equal(game.ammo, 9);

  setPaused(game, false);
  update(game, 0.5);
  assert.notDeepEqual({ x: ship.x, y: ship.y }, shipAt);
  assert.equal(fire(game), true);
});

test('После конца партии пауза не включается', () => {
  const game = emptySea();
  for (let i = 0; i < 10; i++) fire(game);
  runUntilResolved(game);
  assert.equal(game.over, true);
  setPaused(game, true);
  assert.equal(game.paused, false);
});

test('Точность стрельбы в процентах', () => {
  assert.equal(accuracy({ fired: 4, hits: 3 }), 75);
  assert.equal(accuracy({ fired: 0, hits: 0 }), 0);
});

test('15. Новая партия начинается с полностью сброшенного состояния', () => {
  const config = structuredClone(CONFIG);
  config.ships.maxCount = 0;
  const old = createGame(config);
  shootAhead(old);
  const fresh = createGame(config);
  assert.equal(fresh.ammo, 10);
  assert.deepEqual(fresh.stats, { fired: 0, hits: 0, misses: 0, sunk: 0, tonnage: 0 });
  assert.equal(fresh.torpedoes.length, 0);
  assert.equal(fresh.ships.length, 0);
  assert.equal(fresh.bonusGranted, false);
  assert.equal(fresh.over, false);
});
