// Управление: мышь и клавиатура → поворот перископа и пуск торпеды (ТЗ §3).
//
// Чтобы мышью можно было крутить перископ на 360°, указатель «захватывается»
// (Pointer Lock): курсор прячется и не упирается в край экрана. Первый щелчок
// по перископу только захватывает мышь, Esc — отпускает.
// P — пауза. Клавиши определяются по положению, поэтому P работает и в русской раскладке («З»).

const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right' };

export function createInput(canvas, config, { onRotate, onFire, onGesture, onPauseToggle, onCaptureChange }) {
  const held = { left: false, right: false };
  // Если браузер не даёт захватить мышь, работаем без захвата.
  let lockFailed = typeof canvas.requestPointerLock !== 'function';

  const captured = () => document.pointerLockElement === canvas;

  function capture() {
    if (lockFailed) return;
    try {
      const request = canvas.requestPointerLock();
      if (request && typeof request.catch === 'function') request.catch(() => (lockFailed = true));
    } catch {
      lockFailed = true;
    }
  }

  document.addEventListener('pointerlockerror', () => (lockFailed = true));
  document.addEventListener('pointerlockchange', () => onCaptureChange(captured()));

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    onGesture();
    if (captured() || lockFailed) onFire();
    else capture();
  });

  document.addEventListener('mousemove', (e) => {
    if (captured() || lockFailed) onRotate(e.movementX * config.periscope.mouseSensitivity);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement) return; // пробел на кнопке «Новая игра» — это нажатие кнопки
    if (ARROWS[e.code]) {
      held[ARROWS[e.code]] = true;
      e.preventDefault();
    } else if (e.code === 'Space') {
      e.preventDefault();
      onGesture();
      if (!e.repeat) onFire(); // удержание пробела не стреляет очередью (ТЗ §3)
    } else if (e.code === 'KeyP' && !e.repeat) {
      onPauseToggle();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (ARROWS[e.code]) held[ARROWS[e.code]] = false;
  });

  window.addEventListener('blur', () => {
    held.left = false;
    held.right = false;
  });

  return {
    captured,
    capture,
    // Поворот стрелками за прошедшее время dt — тоже не зависит от частоты кадров.
    rotation: (dt) => ((held.right ? 1 : 0) - (held.left ? 1 : 0)) * config.periscope.rotateSpeed * dt,
  };
}
