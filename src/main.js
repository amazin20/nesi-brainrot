import './styles.css';
import { Game } from './game/Game.js';
import { formatTime } from './game/rules.js';

const $ = (selector) => document.querySelector(selector);
const query = new URLSearchParams(window.location.search);
const smokeMode = query.get('smoke') === '1';

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

function countSceneVertices(scene) {
  let vertices = 0;
  scene?.traverse?.((child) => {
    vertices += child.geometry?.attributes?.position?.count ?? 0;
  });
  return vertices;
}

function publishDemoDiagnostics(game, referenceMode = false) {
  const assetVertices = [...game.assets.values()].map(countSceneVertices);
  const suspiciousFallbacks = referenceMode
    ? 0
    : assetVertices.filter((vertices) => vertices < 400).length;
  const report = {
    referenceMode,
    state: game.state,
    modelsLoaded: game.assets.size,
    suspiciousFallbacks,
    surfaces: game.surfaces.length,
    hazards: game.hazards.length,
    bouncers: game.bouncers.length,
    checkpoints: game.checkpoints.length,
    hasLevel: Boolean(game.level),
    hasPlayer: Boolean(game.player),
    hasCargo: Boolean(game.cargo),
    hasFinish: Boolean(game.finishGate),
  };

  const playable = referenceMode || (
    report.modelsLoaded === 10
    && report.suspiciousFallbacks === 0
    && report.surfaces >= 11
    && report.hazards >= 6
    && report.bouncers >= 4
    && report.checkpoints === 3
    && report.hasLevel
    && report.hasPlayer
    && report.hasCargo
    && report.hasFinish
  );

  document.documentElement.dataset.gameReady = 'true';
  document.documentElement.dataset.levelSmoke = playable ? 'pass' : 'fail';
  document.documentElement.dataset.runtimeState = report.state;
  document.documentElement.dataset.modelsLoaded = String(report.modelsLoaded);
  document.documentElement.dataset.modelFallbacks = String(report.suspiciousFallbacks);
  window.__NESI_DEMO_DIAGNOSTICS__ = report;
  return report;
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
  onReady: ({ referenceMode = false } = {}) => {
    showScreen(elements.loading, false);
    showScreen(elements.start, !referenceMode);
    if (referenceMode) {
      elements.hud.classList.remove('hud--active');
      elements.mobileControls.classList.remove('mobile-controls--active');
    }
    publishDemoDiagnostics(game, referenceMode);
    if (smokeMode && !referenceMode) {
      window.setTimeout(() => {
        enterGame();
        publishDemoDiagnostics(game, false);
      }, 80);
    }
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
  document.documentElement.dataset.gameReady = 'false';
  document.documentElement.dataset.levelSmoke = 'fail';
  document.documentElement.dataset.runtimeState = 'error';
  window.__NESI_DEMO_ERROR__ = String(error?.stack || error);
  elements.loadingLabel.textContent = 'Для 3D-игры нужен включённый WebGL. Включи аппаратное ускорение и открой страницу снова.';
  elements.loadingPercent.textContent = '!';
});