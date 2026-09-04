import './styles.css';
import { Game } from './game/Game.js';
import { RiftGame } from './game/RiftGame.js';
import { formatTime } from './game/rules.js';

const $ = (selector) => document.querySelector(selector);
const query = new URLSearchParams(window.location.search);
const smokeMode = query.get('smoke') === '1';
const portalMode = ['rift', 'portal'].includes(query.get('mode') ?? 'rift');
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

if (portalMode) {
  document.body.classList.add('portal-mode');
  document.title = 'Brainrot Rift Lab — игра от третьего лица';
  document.querySelector('#loading .eyebrow').textContent = 'ЗАГРУЖАЕМ РЕЗОНАНСНУЮ ЛАБОРАТОРИЮ';
  document.querySelector('#loading h1').innerHTML = 'RIFT<br /><em>LAB</em>';
  document.querySelector('#start-screen .eyebrow').textContent = 'ОРИГИНАЛЬНАЯ ФАЗОВАЯ МЕХАНИКА · ТРЕТЬЕ ЛИЦО';
  elements.start.querySelector('h1').innerHTML = 'RIFT<br /><em>LAB</em>';
  elements.start.querySelector('.lead').textContent = 'Ставь один разлом-маяк и строй к нему управляемый фазовый маршрут сквозь стену. Перенеси Brainrot-куб, совмести резонанс и открой выход.';
  elements.start.querySelector('.control-grid').innerHTML = `
    <div><kbd>WASD</kbd><span>движение</span></div>
    <div><kbd>МЫШЬ</kbd><span>обзор</span></div>
    <div><kbd>ЛКМ</kbd><span>поставить маяк</span></div>
    <div><kbd>ПКМ / Q</kbd><span>фазовый маршрут</span></div>
    <div><kbd>E</kbd><span>взять куб</span></div>
    <div><kbd>SPACE / R</kbd><span>прыжок / заново</span></div>`;
  elements.play.innerHTML = 'ЗАПУСТИТЬ RIFT LAB <span>→</span>';
  elements.start.querySelector('.mobile-note').textContent = 'На ПК кликни по игре, чтобы захватить курсор. Esc — отпустить курсор и поставить паузу.';
  document.querySelector('#win-screen .eyebrow').textContent = 'РЕЗОНАНСНЫЙ МАРШРУТ ЗАВЕРШЕН';
  document.querySelector('#win-screen h2').textContent = 'RIFT LAB ПРОЙДЕН!';
  elements.playAgainButton.textContent = 'ПРОЙТИ ЕЩЁ РАЗ';
}

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
  const activePlayerPosition = portalMode ? game.playerPosition : game.player?.position;
  const playerPosition = activePlayerPosition
    ? { x: activePlayerPosition.x, y: activePlayerPosition.y, z: activePlayerPosition.z }
    : null;
  const report = {
    referenceMode,
    portalMode,
    state: game.state,
    modelsLoaded: game.assets.size,
    assetVertices,
    suspiciousFallbacks,
    surfaces: game.surfaces?.length ?? game.riftSurfaces?.length ?? 0,
    hazards: game.hazards?.length ?? game.motions?.length ?? 0,
    bouncers: game.bouncers?.length ?? 0,
    checkpoints: game.checkpoints?.length ?? (game.buttonRoot ? 2 : 0),
    checkpointIndex: game.checkpointIndex ?? null,
    playerPosition,
    isCarrying: Boolean(portalMode ? game.heldCube : game.player?.hasCargo),
    hasLevel: Boolean(portalMode ? game.world : game.level),
    hasPlayer: Boolean(portalMode ? game.playerPosition : game.player),
    hasCargoObject: Boolean(portalMode ? game.cube : game.cargo),
    hasFinish: Boolean(portalMode ? game.door : game.finishGate),
    thirdPerson: Boolean(portalMode ? game.thirdPerson : true),
    mechanic: portalMode ? 'single-anchor-rift-route' : 'runner',
    winScreenVisible: elements.win.classList.contains('screen--active'),
  };

  const playable = referenceMode || (portalMode
    ? report.modelsLoaded === 11
      && report.suspiciousFallbacks === 0
      && game.riftBeacon?.placed
      && game.thirdPerson === true
      && game.riftSurfaces?.length >= 8
      && report.hasLevel
      && report.hasPlayer
      && report.hasCargoObject
      && report.hasFinish
    : report.modelsLoaded === 10
      && report.suspiciousFallbacks === 0
      && report.surfaces >= 11
      && report.hazards >= 6
      && report.bouncers >= 4
      && report.checkpoints === 3
      && report.hasLevel
      && report.hasPlayer
      && report.hasCargoObject
      && report.hasFinish);

  document.documentElement.dataset.gameReady = 'true';
  document.documentElement.dataset.levelSmoke = playable ? 'pass' : 'fail';
  document.documentElement.dataset.runtimeState = report.state;
  document.documentElement.dataset.modelsLoaded = String(report.modelsLoaded);
  document.documentElement.dataset.modelFallbacks = String(report.suspiciousFallbacks);
  document.documentElement.dataset.isCarrying = String(report.isCarrying);
  document.documentElement.dataset.checkpointIndex = String(report.checkpointIndex ?? '');
  window.__NESI_DEMO_DIAGNOSTICS__ = report;
  return report;
}

const GameMode = portalMode ? RiftGame : Game;
const game = new GameMode({
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
      window.__NESI_DEMO_GAME__ = game;
      window.setTimeout(() => {
        enterGame();
        publishDemoDiagnostics(game, false);
        window.__NESI_DEMO_DIAGNOSTIC_TIMER__ = window.setInterval(
          () => publishDemoDiagnostics(game, false),
          100,
        );
      }, 80);
    }
  },
  onHud: ({ elapsed, best, progress, objective, hasCargo, checkpoint }) => {
    elements.timer.textContent = formatTime(elapsed);
    elements.bestTime.textContent = portalMode ? 'ТЕСТОВАЯ КАМЕРА 01' : Number.isFinite(best) ? `РЕКОРД ${formatTime(best)}` : 'РЕКОРД —';
    elements.objective.textContent = objective;
    elements.cargoStatus.textContent = portalMode
      ? (hasCargo ? 'КУБ В РУКАХ' : 'КУБ НЕ В РУКАХ')
      : (hasCargo ? 'БРЕЙНРОТ У ТЕБЯ' : 'ГРУЗ НЕ ПОДОБРАН');
    elements.cargoStatus.classList.toggle('cargo-status--ok', hasCargo);
    const percent = Math.round(progress * 100);
    elements.progressValue.textContent = String(percent);
    elements.progressBar.style.width = `${percent}%`;
    elements.checkpoint.textContent = portalMode ? `ЭТАП ${checkpoint}/2` : `ЧЕКПОИНТ ${checkpoint}/2`;
  },
  onToast: showToast,
  onPause: (paused) => showScreen(elements.pause, paused),
  onWin: ({ elapsed, newRecord }) => {
    elements.resultTime.textContent = formatTime(elapsed);
    elements.recordMessage.textContent = portalMode
      ? 'Фазовый маршрут стабилен, Brainrot-куб доставлен'
      : newRecord ? 'НОВЫЙ РЕКОРД!' : 'Брейнрот доставлен в целости';
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
