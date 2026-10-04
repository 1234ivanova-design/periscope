// Текстовая часть интерфейса поверх перископа (ТЗ §9–10): показатели,
// сообщения и итоговый экран. Разметка — в index.html.
import { isWaiting, accuracy } from './logic.js';

const fmt = (n) => n.toLocaleString('ru-RU');

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
    if (game.paused) message = 'Пауза — щёлкните по перископу или нажмите P';
    else if (fx.time < fx.bonusUntil) message = `${game.config.ammo.bonus} призовые торпеды`;
    else if (isWaiting(game)) message = 'Ожидание результатов выстрелов';
    set(el.message, message);
    el.message.hidden = !message;
    el.hint.hidden = mouseCaptured || game.over;
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

  return { update, showResults, hideResults };
}
