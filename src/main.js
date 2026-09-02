import './styles.css';
import { Game } from './game/Game.js';
import { formatTime } from './game/rules.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  game: $('#game'),
  loading: $('#loading'),
  loadingBar: $('#loading-bar'),
  loadingLabel: $('#loading-label'),
  loadingPercent: $('#loading-percent'),
  start: $('#start-screen'),
  play: $('#play-button'),
  hud: $('#hud'),
  objective: $('#objective'),
  cargoStatus: $('#cargo-status'),
  timer: $('#timer'),
  bestTime: $('#best-time'),
  progressValue: $('#progress-value'),
  progressBar: $('#progress-bar'),
  checkpoint: $('#checkpoint'),
  toast: $('#toast'),
  pause: $('#pause-screen'),
  pauseButton: $('#pause-button'),
  resumeButton: $('#resume-button'),
  restartButton: $('#restart-button'),
  win: $('#win-screen'),
  resultTime: $('#result-time'),
  recordMessage: $('#record-message'),
  playAgainButton: $('#play-again-button'),
  mobileControls: $('#mobile-controls'),
  joystick: $('#joystick'),
  joystickKnob: $('#joystick-knob'),
  jumpButton: $('#jump-button'),
};

let toastTimer;
function showScreen(element, visible) {
  element.classList.toggle('screen--active', visible);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('toast--active');
  toastTimer = window.setTimeout(() => elements.toast.classList.remove('toast--active'), 1900);
}

const game = new Game({
  container: elements.game,
  touch: {
    joystick: elements.joystick,
    joystickKnob: elements.joystickKnob,
    jumpButton: elements.jumpButton,
  },
  onProgress: ({ completed, total, label }) => {
    const percent = Math.round((completed / total) * 100);
    elements.loadingBar.style.width = `${percent}%`;
    elements.loadingPercent.textContent = `${percent}%`;
    elements.loadingLabel.textContent = label;
  },
  onReady: () => {
    showScreen(elements.loading, false);
    showScreen(elements.start, true);
  },
  onHud: ({ elapsed, best, progress, objective, hasCargo, checkpoint }) => {
    elements.timer.textContent = formatTime(elapsed);
    elements.bestTime.textContent = Number.isFinite(best) ? `РЕКОРД ${formatTime(best)}` : 'РЕКОРД —';
    elements.objective.textContent = objective;
    elements.cargoStatus.textContent = hasCargo ? 'БРЕЙНРОТ У ТЕБЯ' : 'ГРУЗ НЕ ПОДОБРАН';
    elements.cargoStatus.classList.toggle('cargo-status--ok', hasCargo);
    const percent = Math.round(progress * 100);
    elements.progressValue.textContent = String(percent);
    elements.progressBar.style.width = `${percent}%`;
    elements.checkpoint.textContent = `ЧЕКПОИНТ ${checkpoint}/2`;
  },
  onToast: showToast,
  onPause: (paused) => showScreen(elements.pause, paused),
  onWin: ({ elapsed, newRecord }) => {
    elements.resultTime.textContent = formatTime(elapsed);
    elements.recordMessage.textContent = newRecord ? 'НОВЫЙ РЕКОРД!' : 'Брейнрот доставлен в целости';
    showScreen(elements.win, true);
    elements.mobileControls.classList.remove('mobile-controls--active');
  },
});

function enterGame() {
  showScreen(elements.start, false);
  showScreen(elements.pause, false);
  showScreen(elements.win, false);
  elements.hud.classList.add('hud--active');
  elements.hud.setAttribute('aria-hidden', 'false');
  elements.mobileControls.classList.add('mobile-controls--active');
  game.start();
}

elements.play.addEventListener('click', enterGame);
elements.playAgainButton.addEventListener('click', enterGame);
elements.pauseButton.addEventListener('click', () => game.togglePause());
elements.resumeButton.addEventListener('click', () => game.togglePause(false));
elements.restartButton.addEventListener('click', () => {
  showScreen(elements.pause, false);
  game.restart();
});

game.init().catch((error) => {
  console.error(error);
  elements.loadingLabel.textContent = 'Не удалось запустить игру. Обнови страницу.';
  elements.loadingPercent.textContent = '!';
});
