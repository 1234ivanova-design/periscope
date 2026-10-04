// Игровая логика: море, корабли, торпеды, попадания, счёт, бонус, конец партии.
// Ничего не рисует и не играет звуков (ТЗ §11): всё, что игрок должен увидеть
// или услышать, логика сообщает через список событий game.events.
//
// Координаты: перископ в точке (0, 0), ось y смотрит на север (пеленг 0°),
// ось x — на восток (пеленг 90°). Расстояния в метрах, время в секундах.

const DEG = Math.PI / 180;

export function normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360;
}

// Угол от направления перископа до цели: от −180 (левее) до +180 (правее).
export function relativeAngle(bearing, heading) {
  const d = normalizeAngle(bearing - heading);
  return d > 180 ? d - 360 : d;
}

export function bearingOf(x, y) {
  return normalizeAngle(Math.atan2(x, y) / DEG);
}

export function dirVector(deg) {
  return { x: Math.sin(deg * DEG), y: Math.cos(deg * DEG) };
}

export function createGame(config, random = Math.random) {
  const game = {
    config,
    random,
    time: 0,
    heading: 0,
    ships: [],
    torpedoes: [],
    nextId: 1,
    ammo: config.ammo.initial,
    initialResolved: 0, // сколько первоначальных торпед уже попало или промахнулось
    initialHits: 0,
    bonusGranted: false,
    stats: { fired: 0, hits: 0, misses: 0, sunk: 0, tonnage: 0 },
    over: false,
    paused: false,
    spawnCooldown: 0,
    events: [],
  };
  // К началу партии море уже заполнено: корабли в разных точках своих маршрутов.
  for (let i = 0; i < config.ships.maxCount; i++) spawnShip(game, true);
  return game;
}

// На паузе время стоит, а поворот и пуск не работают: иначе можно было бы
// прицелиться по замершей цели без упреждения.
export function setPaused(game, value) {
  game.paused = Boolean(value) && !game.over;
}

export function rotate(game, deltaDeg) {
  if (game.paused) return;
  game.heading = normalizeAngle(game.heading + deltaDeg);
}

export function fire(game) {
  if (game.over || game.paused || game.ammo <= 0) return false;
  game.ammo--;
  game.stats.fired++;
  game.torpedoes.push({
    id: game.nextId++,
    x: 0,
    y: 0,
    course: game.heading, // курс фиксируется в момент пуска (ТЗ §5)
    initial: !game.bonusGranted,
  });
  game.events.push({ type: 'launch', course: game.heading });
  return true;
}

export function addShip(game, { type, x, y, course, speed }) {
  const t = game.config.ships.types[type];
  const ship = {
    id: game.nextId++,
    type,
    tonnage: t.tonnage,
    length: t.length,
    portholes: t.portholes,
    x,
    y,
    course: normalizeAngle(course),
    speed,
    state: 'moving', // moving → sinking → sunk
    sinkTime: 0,
  };
  game.ships.push(ship);
  return ship;
}

export function isWaiting(game) {
  return !game.over && game.ammo === 0 && game.torpedoes.length > 0;
}

export function accuracy(stats) {
  return stats.fired ? Math.round((stats.hits / stats.fired) * 100) : 0;
}

// Один шаг игрового времени длиной dt секунд. Все перемещения умножаются
// на dt, поэтому скорость не зависит от частоты кадров (ТЗ §11).
export function update(game, dt) {
  if (game.over || game.paused) return;
  const { config } = game;
  game.time += dt;

  // Куда корабли сдвинутся за шаг. Сдвигаем после проверки торпед,
  // чтобы столкновения считались по движению и торпеды, и корабля.
  const moves = new Map();
  for (const ship of game.ships) {
    const v = dirVector(ship.course);
    const slowdown = ship.state === 'sinking' ? Math.max(0, 1 - ship.sinkTime / config.effects.sink) : 1;
    const step = ship.speed * slowdown * dt;
    moves.set(ship, { x: ship.x + v.x * step, y: ship.y + v.y * step });
  }

  const flying = [];
  for (const torpedo of game.torpedoes) {
    const v = dirVector(torpedo.course);
    const from = { x: torpedo.x, y: torpedo.y };
    const to = { x: from.x + v.x * config.torpedo.speed * dt, y: from.y + v.y * config.torpedo.speed * dt };
    const target = findHit(game, from, to, moves);
    if (target) {
      sinkShip(game, target, moves.get(target));
      resolveTorpedo(game, torpedo, true);
    } else if (Math.hypot(to.x, to.y) > config.world.radius) {
      game.events.push({ type: 'miss', torpedoId: torpedo.id });
      resolveTorpedo(game, torpedo, false);
    } else {
      torpedo.x = to.x;
      torpedo.y = to.y;
      flying.push(torpedo);
    }
  }
  game.torpedoes = flying;

  for (const ship of game.ships) {
    const m = moves.get(ship);
    ship.x = m.x;
    ship.y = m.y;
    if (ship.state === 'sinking') {
      ship.sinkTime += dt;
      if (ship.sinkTime >= config.effects.sink) ship.state = 'sunk';
    }
  }
  game.ships = game.ships.filter((s) => s.state !== 'sunk' && !(s.state === 'moving' && leftTheSea(game, s)));

  game.spawnCooldown -= dt;
  const moving = game.ships.filter((s) => s.state === 'moving').length;
  if (moving < config.ships.maxCount && game.spawnCooldown <= 0) {
    spawnShip(game, false);
    game.spawnCooldown = config.ships.spawnInterval;
  }

  // Конец партии: торпед нет, все в пути торпеды отработали,
  // анимации потопления закончились (ТЗ §10).
  const sinking = game.ships.some((s) => s.state === 'sinking');
  if (game.ammo === 0 && game.torpedoes.length === 0 && !sinking) {
    game.over = true;
    game.events.push({ type: 'gameOver' });
  }
}

// Попала ли торпеда в корабль за шаг. Считаем в системе отсчёта корабля:
// корпус — неподвижный отрезок, а торпеда смещается на разность скоростей.
// Так даже быстрая торпеда не «проскочит» корабль между кадрами (ТЗ §11).
// Возвращает долю пути торпеды (0..1) в точке сближения или null.
export function sweptHit(torpFrom, torpTo, shipFrom, shipTo, course, length, radius) {
  const a0 = { x: torpFrom.x - shipFrom.x, y: torpFrom.y - shipFrom.y };
  const a1 = { x: torpTo.x - shipTo.x, y: torpTo.y - shipTo.y };
  const u = dirVector(course);
  const half = length / 2;
  const stern = { x: -u.x * half, y: -u.y * half };
  const bow = { x: u.x * half, y: u.y * half };
  const { dist, s } = closestSegmentSegment(a0, a1, stern, bow);
  return dist <= radius ? s : null;
}

// Расстояние между двумя отрезками p1–q1 и p2–q2 и положение ближайших точек
// (алгоритм из книги К. Эриксона «Real-Time Collision Detection», 5.1.9).
export function closestSegmentSegment(p1, q1, p2, q2) {
  const d1 = { x: q1.x - p1.x, y: q1.y - p1.y };
  const d2 = { x: q2.x - p2.x, y: q2.y - p2.y };
  const r = { x: p1.x - p2.x, y: p1.y - p2.y };
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const EPS = 1e-9;
  let s;
  let t;
  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const dx = p1.x + d1.x * s - (p2.x + d2.x * t);
  const dy = p1.y + d1.y * s - (p2.y + d2.y * t);
  return { dist: Math.hypot(dx, dy), s, t };
}

function findHit(game, from, to, moves) {
  const { ships, torpedo } = game.config;
  let best = null;
  let bestS = Infinity;
  for (const ship of game.ships) {
    if (ship.state !== 'moving') continue; // тонущий корабль — уже не цель (ТЗ §6)
    const radius = (ship.length * ships.beamRatio) / 2 + torpedo.hitRadius;
    const s = sweptHit(from, to, ship, moves.get(ship), ship.course, ship.length, radius);
    // Одна торпеда топит один корабль — ближайший по её пути.
    if (s !== null && s < bestS) {
      best = ship;
      bestS = s;
    }
  }
  return best;
}

function sinkShip(game, ship, at) {
  ship.state = 'sinking';
  ship.sinkTime = 0;
  game.stats.sunk++;
  game.stats.tonnage += ship.tonnage;
  game.events.push({ type: 'hit', shipId: ship.id, x: at.x, y: at.y, length: ship.length, tonnage: ship.tonnage });
}

function resolveTorpedo(game, torpedo, hit) {
  if (hit) game.stats.hits++;
  else game.stats.misses++;
  if (!torpedo.initial) return;

  game.initialResolved++;
  if (hit) game.initialHits++;
  // Бонус решается, когда отработали все первоначальные торпеды,
  // в каком бы порядке они ни попадали (ТЗ §7).
  const n = game.config.ammo.initial;
  if (game.initialResolved === n && game.initialHits === n) {
    game.bonusGranted = true;
    game.ammo += game.config.ammo.bonus;
    game.events.push({ type: 'bonus', torpedoes: game.config.ammo.bonus });
  }
}

// Новый корабль идёт по прямой, проходящей от перископа на расстоянии pass.
// anywhere = true — ставим его в случайную точку маршрута, иначе — на границу моря.
function spawnShip(game, anywhere) {
  const { ships, world } = game.config;
  const random = game.random;
  const course = random() * 360;
  const side = random() < 0.5 ? -1 : 1;
  const pass = (ships.passDistanceMin + random() * (ships.passDistanceMax - ships.passDistanceMin)) * side;
  const u = dirVector(course);
  const n = { x: u.y, y: -u.x }; // перпендикуляр к курсу
  const half = Math.sqrt(Math.max(0, world.radius ** 2 - pass ** 2));
  const along = anywhere ? (random() * 2 - 1) * half * 0.8 : -half;
  return addShip(game, {
    type: pickType(ships.types, random),
    x: n.x * pass + u.x * along,
    y: n.y * pass + u.y * along,
    course,
    speed: ships.speedMin + random() * (ships.speedMax - ships.speedMin),
  });
}

function pickType(types, random) {
  const entries = Object.entries(types);
  const total = entries.reduce((sum, [, t]) => sum + t.weight, 0);
  let r = random() * total;
  for (const [key, t] of entries) {
    r -= t.weight;
    if (r < 0) return key;
  }
  return entries[entries.length - 1][0];
}

function leftTheSea(game, ship) {
  const v = dirVector(ship.course);
  const goingAway = ship.x * v.x + ship.y * v.y > 0;
  return goingAway && Math.hypot(ship.x, ship.y) > game.config.world.radius;
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
