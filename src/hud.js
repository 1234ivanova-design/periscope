// Текстовая часть интерфейса поверх перископа (ТЗ §9–10): показатели,
// сообщения, поздравление за 10 из 10 и итоговый экран. Разметка — в index.html.
import { isWaiting, accuracy } from './logic.js';

const fmt = (n) => n.toLocaleString('ru-RU');

// 1 призовая торпеда, 3 призовые торпеды, 5 призовых торпед.
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function createHud(onNewGame) {
  const $ = (id) => document.getElementById(id);
  const el = {
    heading: $('hud-heading'),
    ammo: $('hud-ammo'),
    pips: $('hud-pips'),
    sunk: $('hud-sunk'),
    tonnage: $('hud-tonnage'),
    message: $('message'),
    hint: $('hint'),
    results: $('results'),
    celebration: $('celebration'),
  };
  $('new-game').addEventListener('click', onNewGame);
  let pipsFor = '';

  function set(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function update(game, fx, mouseCaptured) {
    set(el.heading, String(Math.round(game.heading) % 360).padStart(3, '0') + '°');
    set(el.ammo, String(game.ammo));
    set(el.sunk, String(game.stats.sunk));
    set(el.tonnage, `${fmt(game.stats.tonnage)} т`);

    const key = `${game.ammo}/${game.bonusGranted}`;
    if (key !== pipsFor) {
      pipsFor = key;
      el.pips.replaceChildren(
        ...Array.from({ length: game.ammo }, () => {
          const pip = document.createElement('span');
          pip.className = game.bonusGranted ? 'pip bonus' : 'pip';
          return pip;
        }),
      );
    }

    let message = '';
    if (fx.celebratingSince) message = ''; // вместо надписи — табличка с поздравлением
    else if (game.paused) message = 'Пауза — щёлкните по перископу или нажмите P';
    else if (isWaiting(game)) message = 'Ожидание результатов выстрелов';
    set(el.message, message);
    el.message.hidden = !message;
    el.hint.hidden = mouseCaptured || game.over || Boolean(fx.celebratingSince);
  }

  function showCelebration(config) {
    const n = config.ammo.initial;
    const bonus = config.ammo.bonus;
    $('cel-score').textContent = `${n} из ${n} — все цели поражены`;
    $('cel-award').textContent = `${bonus} ${plural(bonus, 'призовая торпеда', 'призовые торпеды', 'призовых торпед')}`;
    el.celebration.hidden = false;
  }

  function hideCelebration() {
    el.celebration.hidden = true;
  }

  function showResults(stats) {
    $('res-tonnage').textContent = `${fmt(stats.tonnage)} т`;
    $('res-sunk').textContent = String(stats.sunk);
    $('res-fired').textContent = String(stats.fired);
    $('res-hits').textContent = String(stats.hits);
    $('res-misses').textContent = String(stats.misses);
    $('res-accuracy').textContent = `${accuracy(stats)} %`;
    el.results.hidden = false;
    $('new-game').focus();
  }

  function hideResults() {
    el.results.hidden = true;
  }

  return { update, showCelebration, hideCelebration, showResults, hideResults };
}
