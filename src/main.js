import './styles.css';
import { LabGame } from './game/LabGame.js';
import { CAMPAIGN_V8 as CAMPAIGN } from './game/LabCampaignV8.js';
import { LabPlatform } from './game/LabPlatform.js';

const $ = (selector) => document.querySelector(selector);
const query = new URLSearchParams(location.search);
let preferences = {};
try { preferences=JSON.parse(localStorage.getItem('nesi-v8-settings')||'{}')||{}; } catch {}
const saveSettings=()=>{try{localStorage.setItem('nesi-v8-settings',JSON.stringify(preferences));}catch{}};
for(const id of ['level-select','pause-level-select']) {
  const select=document.getElementById(id);
  for(const [index,level] of CAMPAIGN.entries()) { const option=document.createElement('option');option.value=String(index);option.textContent=`${String(index+1).padStart(2,'0')} · ${level.title}`;select.append(option); }
}
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
  // Only actionable errors enter the optional bottom lesson area.
  if (/Сначала|не помещается|препятствие|белую|Раздвинь|свободное|лицевую/.test(message)) game.tutorial.explain(message);
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
  if(typeof platform !== 'undefined') platform.gameplay(active);
  game.audio?.pause?.('menu',!active);
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
    levelIndex: String(report.levelIndex ?? 0),
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
    platform.ready(); refreshHint(); publishDiagnostics();
    if (debugMode) {
      window.__NESI_DEMO_GAME__ = game;
      window.__NESI_RUN_LEVEL_ROUTE__ = async () => {
        const {runPhysicsJourney:runCampaignJourney}=await import('./game/LabJourneyV8.js');
        game.renderer.setAnimationLoop(null);
        return runCampaignJourney(game);
      };
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
    if (paused) { $('#pause-level-select').value=String(game.levelIndex);refreshHint(); }
    if (paused) elements.resume.focus({ preventScroll: true });
    else document.activeElement?.blur?.();
  },
  onWin: () => {
    preferences.completed=[...new Set([...(preferences.completed||[]),game.levelIndex])];saveSettings();
    setPlayState('won');
    showScreen(elements.win, true);
    elements.playAgain.textContent = game.levelIndex < CAMPAIGN.length - 1 ? 'Следующий уровень →' : 'Пройти ещё раз ↻';
    $('#win-screen .muted').textContent = game.levelIndex < CAMPAIGN.length - 1 ? 'Друг с тобой. Впереди другая мастерская и новая задача.' : 'Первые пять испытаний пройдены. Никого не забыли.';
    elements.playAgain.focus({ preventScroll: true });
    publishDiagnostics();
  },
});
let adPreviousState='paused';
const platform = new LabPlatform({preview:!__YANDEX_BUILD__,storage:(()=>{try{return localStorage;}catch{return null;}})(),
  pause:()=>{adPreviousState=game.state;game.state='ad';clearQueuedInputs();game.audio?.pause('ad',true);document.exitPointerLock?.();},
  resume:()=>{game.state=adPreviousState;game.audio?.pause('ad',false);clearQueuedInputs();game.lastFrame=performance.now();game.accumulator=0;setPlayState(game.state);}
});
let entering = false;
function refreshHint(){
 const id=CAMPAIGN[game.levelIndex].id, count=platform.unlocked(id);
 $('#hint-status').textContent=platform.preview?'Демо без рекламы: подсказки открываются бесплатно.':'Новая подсказка — за добровольный просмотр рекламы. Обучение бесплатно.';
 $('#hint-text').textContent=CAMPAIGN[game.levelIndex].hints.slice(0,count).join(' ');
 $('#hint-button').disabled=count>=3||platform.busy;
 $('#hint-button').textContent=count>=3?'Все три подсказки открыты':platform.preview?`Открыть подсказку ${count+1}/3 · демо`:`Посмотреть рекламу → подсказка ${count+1}/3`;
}
$('#hint-button').addEventListener('click',async()=>{
 $('#hint-button').disabled=true;
 const result=await platform.hint(CAMPAIGN[game.levelIndex].id);refreshHint();
 if(!result.rewarded)$('#hint-status').textContent='Реклама недоступна или просмотр не засчитан. Можно продолжать играть без подсказки.';
});

async function enterGame() {
  if (entering) return;
  entering = true;
  const level = Number($('#level-select').value);
  try {
    for (const screen of [elements.start, elements.pause, elements.win]) showScreen(screen, false);
    clearQueuedInputs(); document.activeElement?.blur?.();
    if (level !== game.levelIndex) {
      await platform.interstitial('level');
      showScreen(elements.loading, true); setPlayState('loading');
      await game.selectLevel(level, false); showScreen(elements.loading, false);
    }
    preferences.level=level;saveSettings();
    setPlayState('playing'); game.start(); game.audio?.pause('menu',false);publishDiagnostics();
  } catch (error) { showRuntimeError(error); }
  finally { entering = false; }
}
function resumeGame() {
  if(platform.busy)return;
  game.audio.unlock(); clearQueuedInputs();
  game.togglePause(false);
}
async function restartGame() {
  if(platform.busy||entering)return;
  entering=true;clearQueuedInputs();
  await platform.interstitial('restart');
  game.restart();game.togglePause(false);entering=false;
}
game.requestRestart=restartGame;

for (const screen of document.querySelectorAll('.screen:not(.screen--active)')) showScreen(screen, false);
elements.play.addEventListener('click', enterGame);
elements.playAgain.addEventListener('click', () => { $('#level-select').value = String((game.levelIndex + 1) % CAMPAIGN.length); enterGame(); });
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
const requestedLevel = Number(query.get('level') || ((Number(preferences.level)||0)+1)) - 1;
game.levelIndex = Number.isInteger(requestedLevel) && requestedLevel >= 0 && requestedLevel < CAMPAIGN.length ? requestedLevel : 0;
$('#level-select').value = String(game.levelIndex);
$('#tutorial-toggle').checked=preferences.tutorial!==false;
game.tutorial.enabled=preferences.tutorial!==false;
$('#tutorial-toggle').addEventListener('change',event=>{preferences.tutorial=game.tutorial.enabled=event.target.checked;saveSettings();});
$('#level-menu-button').addEventListener('click',()=>{if(platform.busy)return;$('#level-select').value=$('#pause-level-select').value;enterGame();});
function applyQuality(value){
  const [ratio,resolution] = {low:[.85,512],balanced:[1.25,800],high:[1.75,1280]}[value]||[1.25,800];
  game.quality={pixelRatio:ratio,portalResolution:resolution};
  if(game.renderer){game.renderer.setPixelRatio(Math.min(devicePixelRatio,ratio));game.renderer.setSize(innerWidth,innerHeight);game.renderer.shadowMap.enabled=value!=='low';}
  if(game.portals)game.portals.maxResolution=resolution;game.performanceMonitor.reset();
}
$('#quality-select').value=['low','balanced','high'].includes(preferences.quality)?preferences.quality:'balanced';
applyQuality($('#quality-select').value);
$('#quality-select').addEventListener('change',e=>{preferences.quality=e.target.value;applyQuality(e.target.value);saveSettings();});
$('#sound-toggle').checked=preferences.sound!==false;
$('#volume-range').value=Number.isFinite(preferences.volume)?preferences.volume:55;
$('#sound-toggle').addEventListener('change',e=>{preferences.sound=e.target.checked;game.audio.unlock();game.audio.setMuted(!preferences.sound);saveSettings();});
$('#volume-range').addEventListener('input',e=>{preferences.volume=Number(e.target.value);game.audio.unlock();game.audio.setVolume(preferences.volume/100);saveSettings();});
const focusPause=()=>{game.audio?.pause('focus',true);if(game.state==='playing')game.togglePause(true);platform.gameplay(false);};
addEventListener('blur',focusPause);
addEventListener('focus',()=>game.audio?.pause('focus',document.hidden));
document.addEventListener('visibilitychange',()=>{if(document.hidden)focusPause();else game.audio?.pause('focus',false);});
const sdkReady=platform.init();
game.init().then(async () => {
  game.audio.setVolume(Number($('#volume-range').value)/100);game.audio.setMuted(!$('#sound-toggle').checked);applyQuality($('#quality-select').value);
  await sdkReady;platform.ready();refreshHint();
  if (evidenceMode) {
    for (const screen of [elements.start, elements.pause, elements.win]) showScreen(screen, false);
    game.resetRun(true); setPlayState('playing');
    const { mountLabEvidence } = await import('./game/LabEvidence.js');
    mountLabEvidence(game);
  }
}).catch(showRuntimeError);
