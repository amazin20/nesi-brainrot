import './styles.css';
import { LabGame } from './game/LabGame.js';

const $ = (selector) => document.querySelector(selector);
const query = new URLSearchParams(location.search);
const smokeMode = query.get('smoke') === '1';
const evidenceMode = query.get('evidence') === '1';
const debugMode = smokeMode || query.get('debug') === '1';
const elements = {
  game: $('#game'), loading: $('#loading'), loadingBar: $('#loading-bar'),
  loadingLabel: $('#loading-label'), loadingPercent: $('#loading-percent'),
  start: $('#start-screen'), play: $('#play-button'), hud: $('#hud'),
  cargo: $('#cargo-status'), chamber: $('#chamber'), portalStatus: $('#portal-status'),
  toast: $('#toast'), pause: $('#pause-screen'), pauseButton: $('#pause-button'),
  resume: $('#resume-button'), restart: $('#restart-button'), win: $('#win-screen'),
  playAgain: $('#play-again-button'),
  mobile: $('#mobile-controls'), joystick: $('#joystick'), knob: $('#joystick-knob'),
  jump: $('#jump-button'), error: $('#error-screen'), errorDetail: $('#error-detail'),
};
document.documentElement.dataset.runtimeState = 'loading';
document.documentElement.dataset.gameReady = 'false';
document.body.dataset.playState = 'loading';

let toastTimer;
function showScreen(screen, visible) {
  screen.classList.toggle('screen--active', visible);
  screen.setAttribute('aria-hidden', String(!visible));
  screen.inert = !visible;
}
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('toast--active');
  toastTimer = setTimeout(() => elements.toast.classList.remove('toast--active'), 3500);
}
function clearQueuedInputs() {
  if (!game.input) return;
  game.input.keys.clear();
  game.input.jumpQueued = false;
  game.input.restartQueued = false;
  game.input.pauseQueued = false;
  game.input.mobileMove.set(0, 0);
  game.interactQueued = false;
  elements.knob.style.transform = 'translate(0, 0)';
}
function setPlayState(state) {
  document.body.dataset.playState = state;
  document.documentElement.dataset.runtimeState = state;
  const active = state === 'playing';
  const showHud = active || state === 'paused';
  elements.hud.classList.toggle('hud--active', showHud);
  elements.hud.setAttribute('aria-hidden', String(!showHud));
  elements.hud.inert = !showHud;
  elements.mobile.classList.toggle('mobile-controls--active', active);
  elements.mobile.setAttribute('aria-hidden', String(!active));
  elements.mobile.inert = !active;
}
function publishDiagnostics() {
  const report = game.diagnostics();
  const missing = Array.isArray(report.missingModels) ? report.missingModels.length : Number(report.missingModels ?? 0);
  const ready = report.modelsLoaded > 0 && missing === 0 && report.thirdPerson;
  Object.assign(document.documentElement.dataset, {
    gameReady: String(ready), runtimeState: report.state,
    modelsLoaded: String(report.modelsLoaded), modelFallbacks: String(missing),
    levelSmoke: ready ? 'pass' : 'fail', isCarrying: String(Boolean(game.heldCube)),
    checkpointIndex: String(report.stage),
  });
  if (debugMode) window.__NESI_DEMO_DIAGNOSTICS__ = {
    ...report, suspiciousFallbacks: missing,
    winScreenVisible: elements.win.classList.contains('screen--active'),
  };
  return report;
}
function showRuntimeError(error) {
  if (document.body.dataset.playState === 'error') return;
  console.error(error);
  clearInterval(window.__NESI_DEMO_DIAGNOSTIC_TIMER__);
  game.renderer?.setAnimationLoop(null);
  document.documentElement.dataset.gameReady = 'false';
  document.documentElement.dataset.levelSmoke = 'fail';
  setPlayState('error');
  for (const screen of [elements.loading, elements.start, elements.pause, elements.win]) showScreen(screen, false);
  elements.errorDetail.textContent = error?.message || String(error);
  showScreen(elements.error, true);
  if (debugMode) window.__NESI_DEMO_ERROR__ = String(error?.stack || error);
}
const game = new LabGame({
  container: elements.game,
  touch: { joystick: elements.joystick, joystickKnob: elements.knob, jumpButton: elements.jump },
  onProgress: ({ percent: measuredPercent, completed, total, label, loadedBytes, totalBytes, phase }) => {
    const percent = Math.max(0, Math.min(100, Number.isFinite(measuredPercent) ? measuredPercent : total > 0 ? Math.round(completed / total * 100) : 0));
    elements.loadingBar.style.width = percent + '%';
    elements.loadingPercent.textContent = percent + '%';
    elements.loadingLabel.textContent = phase === 'download' && totalBytes > 0
      ? `${(loadedBytes / 1e6).toFixed(1)} / ${(totalBytes / 1e6).toFixed(1)} МБ · ${label}` : label;
    $('#loading-progress').setAttribute('aria-valuenow', String(percent));
  },
  onReady: () => {
    showScreen(elements.loading, false);
    setPlayState('ready');
    showScreen(elements.start, !smokeMode);
    publishDiagnostics();
    if (debugMode) {
      window.__NESI_DEMO_GAME__ = game;
      window.__NESI_DEMO_DIAGNOSTIC_TIMER__ = setInterval(publishDiagnostics, 200);
    }
    if (smokeMode && !evidenceMode) setTimeout(enterGame, 60);
    else elements.play.focus({ preventScroll: true });
  },
  onHud: ({ chamber, objective, hasCargo, portalsReady, friendStatus }) => {
    elements.chamber.textContent = chamber;
    $('#objective').textContent = objective || '';
    elements.cargo.textContent = friendStatus || (hasCargo ? 'Друг на руках' : 'Друг ждёт тебя');
    elements.cargo.classList.toggle('status--active', hasCargo);
    elements.portalStatus.textContent = portalsReady ? 'Порталы связаны' : 'Нужна пара порталов';
    elements.portalStatus.classList.toggle('status--active', portalsReady);
    document.documentElement.dataset.runtimeState = game.state;
  },
  onToast: showToast,
  onPause: (paused) => {
    clearQueuedInputs();
    showScreen(elements.pause, paused);
    setPlayState(paused ? 'paused' : 'playing');
    if (paused) elements.resume.focus({ preventScroll: true });
    else document.activeElement?.blur?.();
  },
  onWin: () => {
    setPlayState('won');
    showScreen(elements.win, true);
    elements.playAgain.focus({ preventScroll: true });
    publishDiagnostics();
  },
});
function enterGame() {
  for (const screen of [elements.start, elements.pause, elements.win]) showScreen(screen, false);
  setPlayState('playing');
  document.activeElement?.blur?.();
  clearQueuedInputs();
  try { game.start(); } catch (error) { showRuntimeError(error); return; }
  publishDiagnostics();
}
function resumeGame() {
  clearQueuedInputs();
  game.togglePause(false);
}
function restartGame() {
  clearQueuedInputs();
  game.restart();
  // Restart itself resets the simulation; the explicit resume also requests
  // pointer capture from this click/key gesture when restarting from a menu.
  game.togglePause(false);
}
for (const screen of document.querySelectorAll('.screen:not(.screen--active)')) showScreen(screen, false);
elements.play.addEventListener('click', enterGame);
elements.playAgain.addEventListener('click', enterGame);
elements.pauseButton.addEventListener('click', () => game.togglePause(true));
elements.resume.addEventListener('click', resumeGame);
elements.restart.addEventListener('click', restartGame);
addEventListener('keydown', (event) => {
  if (game.state === 'paused' && ['KeyR', 'Escape'].includes(event.code)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (event.code === 'KeyR') restartGame();
    else resumeGame();
  } else if (game.state !== 'playing' && ['KeyR', 'Escape', 'Space'].includes(event.code)) {
    // Menu keystrokes must not become a jump/restart on the first game frame.
    // Keep the default Space action so focused buttons remain accessible.
    event.stopImmediatePropagation();
  }
}, true);
let hadPointerLock = false;
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === game.renderer?.domElement;
  const lost = hadPointerLock && !locked;
  hadPointerLock = locked;
  if (lost && game.state === 'playing') {
    // Browsers may reserve Escape for releasing the mouse without forwarding
    // keydown. Clear any forwarded Escape too, avoiding a second toggle.
    clearQueuedInputs();
    game.togglePause(true);
  }
});
$('#reload-button').addEventListener('click', () => location.reload());
addEventListener('error', (event) => { if (event.error) showRuntimeError(event.error); });
addEventListener('unhandledrejection', (event) => {
  // A denied pointer capture does not invalidate the loaded game.
  if (/pointer.?lock|user gesture|document is not focused/i.test(String(event.reason?.message ?? event.reason))) {
    event.preventDefault();
    return;
  }
  showRuntimeError(event.reason);
});
game.init().then(async () => {
  if (evidenceMode) {
    for (const screen of [elements.start, elements.pause, elements.win]) showScreen(screen, false);
    game.resetRun(true); setPlayState('playing');
    const { mountLabEvidence } = await import('./game/LabEvidence.js');
    mountLabEvidence(game);
  }
}).catch(showRuntimeError);
