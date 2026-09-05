import './styles.css';
import {LabGame} from './game/LabGame.js';
import {CAMPAIGN} from './game/LabCampaignLevels.js';
import {LabPreferences,QUALITY_PRESETS,applyLabQuality} from './game/LabPreferences.js';
import {LabPlatform,loadYandexSDK} from './game/LabPlatform.js';
const $=s=>document.querySelector(s),query=new URLSearchParams(location.search);
const debug=query.get('debug')==='1'||query.get('smoke')==='1';
const yandex=import.meta.env.MODE==='yandex';
let storage;try{storage=localStorage;}catch{}
const preferences=new LabPreferences(storage),holds=new Set();
const screens=['loading','start-screen','pause-screen','win-screen','error-screen'];
let platform,entering=false,hintBusy=false;
function screen(id,visible){const e=$('#'+id);e.classList.toggle('screen--active',visible);e.setAttribute('aria-hidden',String(!visible));e.inert=!visible;}
function hideScreens(){screens.forEach(id=>screen(id,false));}
function clearInput(){const i=game.input;if(!i)return;i.keys.clear();i.jumpQueued=i.restartQueued=i.pauseQueued=false;i.mobileMove?.set(0,0);game.interactQueued=false;$('#joystick-knob').style.transform='translate(0,0)';}
function syncActivity(){const active=game.state==='playing'&&!holds.size;platform?.gameplay(active);game.audio?.block('menu',game.state!=='playing'&&game.state!=='won');game.audio?.block('external',holds.size>0);}
function setState(state){document.body.dataset.playState=state;document.documentElement.dataset.runtimeState=state;
  const mobile=$('#mobile-controls'),active=state==='playing';mobile.classList.toggle('mobile-controls--active',active);mobile.inert=!active;mobile.setAttribute('aria-hidden',String(!active));syncActivity();}
function hold(reason,on){on?holds.add(reason):holds.delete(reason);game.externalBlocked=holds.size>0;
  if(on){clearInput();game.accumulator=0;}game.lastFrame=performance.now();document.body.dataset.externalPause=String(holds.size>0);syncActivity();}
function diagnostics(){const d=game.diagnostics();Object.assign(document.documentElement.dataset,{gameReady:String(d.modelsLoaded>0&&!d.missingModels.length),modelsLoaded:String(d.modelsLoaded),levelIndex:String(game.levelIndex)});
  if(debug)window.__NESI_DEMO_DIAGNOSTICS__={...d,settings:preferences.value,adBusy:platform?.busy};return d;}
function failure(error){console.error(error);game.renderer?.setAnimationLoop(null);game.state='error';setState('error');hideScreens();$('#error-detail').textContent=error?.message||String(error);screen('error-screen',true);}
function choices(){for(const selector of ['#level-select','#settings-level-select']){const e=$(selector),old=e.value;e.replaceChildren();CAMPAIGN.forEach((l,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`${String(i+1).padStart(2,'0')} · ${l.title}${preferences.value.completed.includes(i)?' ✓':''}`;e.append(option);});e.value=old||String(game.levelIndex);}}
function pauseInfo(){ $('#settings-level-select').value=String(game.levelIndex);$('#pause-course').textContent=`${game.levelIndex+1} / 5 · ${CAMPAIGN[game.levelIndex].title}`;$('#hint-detail').hidden=true;}
function showHints(){
  const count=preferences.value.hints[game.levelIndex]||0;$('#hint-detail').hidden=false;$('#hint-text').replaceChildren();
  CAMPAIGN[game.levelIndex].hints.slice(0,count).forEach((text,i)=>{const p=document.createElement('p');p.textContent=`${i+1}. ${text}`;$('#hint-text').append(p);});
  if(!count)$('#hint-text').textContent='Открой сначала намёк. Следующие подсказки раскрывают решение подробнее.';
  const button=$('#hint-unlock');button.hidden=count>=3;button.disabled=hintBusy;
  button.textContent=yandex?'Посмотреть рекламу · следующий намёк':'Следующий намёк · бесплатно в демо';
  $('#ad-status').textContent=yandex?'Подсказка открывается после подтверждённого просмотра. Прочитанные подсказки остаются доступны.':'В демо на GitHub рекламы нет. В сборке для Яндекс Игр здесь добровольный просмотр.';
}
const game=new LabGame({container:$('#game'),touch:{joystick:$('#joystick'),joystickKnob:$('#joystick-knob'),jumpButton:$('#jump-button')},
  onProgress:p=>{const n=Math.max(0,Math.min(100,p.percent||0));$('#loading-bar').style.width=n+'%';$('#loading-percent').textContent=n+'%';$('#loading-label').textContent=p.label||'Загрузка';$('#loading-progress').setAttribute('aria-valuenow',String(n));},
  onReady:()=>{hideScreens();setState('ready');screen('start-screen',true);platform?.ready();
    game.audio.configure(preferences.value);applyLabQuality(game,preferences.value.quality);diagnostics();
    if(debug){window.__NESI_DEMO_GAME__=game;window.__NESI_PLATFORM__=platform;window.__NESI_PREFS__=preferences;
      window.__NESI_RUN_LEVEL_ROUTE__=async()=>{const {runV8Journey}=await import('./game/LabV8Journey.js');game.renderer.setAnimationLoop(null);hideScreens();setState('playing');
        try{return await runV8Journey(game,{onMilestone:()=>game.render()});}finally{game.render();clearInput();setState(game.state);diagnostics();}};}
    $('#play-button').focus({preventScroll:true});if(query.get('smoke')==='1')enterLevel(game.levelIndex,'initial');},
  onHud:({chamber,objective,hasCargo,portalsReady})=>{$('#chamber').textContent=chamber;$('#objective').textContent=objective||'';$('#cargo-status').textContent=hasCargo?'Друг на руках':'Друг ждёт';$('#portal-status').textContent=portalsReady?'Связаны':'Два портала';},
  onToast:message=>{if(/Сначала|не помещается|препятствие|белую|Раздвинь|свободное|лицевую/.test(message))game.tutorial.explain(message);},
  onPause:paused=>{clearInput();screen('pause-screen',paused);setState(paused?'paused':'playing');if(paused){pauseInfo();$('#resume-button').focus({preventScroll:true});}},
  onRestartRequest:()=>restartLevel(),
  onWin:()=>{preferences.complete(game.levelIndex);choices();clearInput();setState('won');screen('win-screen',true);
    const last=game.levelIndex===CAMPAIGN.length-1;$('#play-again-button').textContent=last?'К первому испытанию ↻':'Следующий уровень →';
    $('#win-screen .muted').textContent=last?'Пять первых испытаний завершены. Друг добрался вместе с тобой.':'Получилось! Следующее испытание добавит новую идею.';diagnostics();},
});
game.quality={...QUALITY_PRESETS[preferences.value.quality]};game.tutorial.enabled=preferences.value.tutorial;
const requested=Number(query.get('level')||1)-1;game.levelIndex=Number.isInteger(requested)&&CAMPAIGN[requested]?requested:0;
choices();$('#level-select').value=String(game.levelIndex);
async function enterLevel(index,reason='next'){
  if(entering||holds.size)return;entering=true;clearInput();game.audio?.unlock();
  try{
    // All interstitials are tied to an explicit menu transition, never a timer during play.
    if(reason!=='initial')await platform?.interstitial('next');
    hideScreens();screen('loading',true);game.state='loading';setState('loading');
    if(index!==game.levelIndex)await game.selectLevel(index,false);
    game.start();game.renderer.setAnimationLoop(game.animate);hideScreens();setState('playing');$('#level-select').value=String(index);$('#settings-level-select').value=String(index);diagnostics();
  }catch(error){failure(error);}finally{entering=false;}
}
async function restartLevel(){
  if(entering||holds.size)return;entering=true;clearInput();
  try{if(game.state==='playing')game.togglePause(true);await platform?.interstitial('restart');
    hideScreens();game.restart();game.audio.unlock();game.renderer.setAnimationLoop(game.animate);setState('playing');game.renderer.domElement.requestPointerLock?.()?.catch?.(()=>{});
  }catch(error){failure(error);}finally{entering=false;}
}
function resume(){if(holds.size)return;game.audio.unlock();game.togglePause(false);game.renderer.setAnimationLoop(game.animate);}
$('#play-button').addEventListener('click',()=>enterLevel(Number($('#level-select').value),game.state==='ready'&&!preferences.value.completed.length?'initial':'next'));
$('#play-again-button').addEventListener('click',()=>enterLevel((game.levelIndex+1)%CAMPAIGN.length));
$('#resume-button').addEventListener('click',resume);$('#restart-button').addEventListener('click',restartLevel);
for(const id of ['pause-button','quick-settings'])$('#'+id).addEventListener('click',()=>game.togglePause(true));
$('#quick-hint').addEventListener('click',()=>{game.togglePause(true);showHints();});$('#hint-button').addEventListener('click',showHints);
$('#hint-unlock').addEventListener('click',async()=>{
  if(hintBusy||holds.size||(preferences.value.hints[game.levelIndex]||0)>=3)return;
  hintBusy=true;const index=game.levelIndex;showHints();
  try{const result=await platform.hint(()=>preferences.unlockHint(index));showHints();if(!result.rewarded)$('#ad-status').textContent='Просмотр не подтверждён или реклама недоступна. Намёк не списан; игру можно продолжить.';}
  finally{hintBusy=false;$('#hint-unlock').disabled=false;}
});
$('#settings-level-select').addEventListener('change',e=>enterLevel(Number(e.target.value)));
$('#level-menu-button').addEventListener('click',()=>{if(holds.size)return;hideScreens();game.state='ready';setState('ready');screen('start-screen',true);$('#level-select').value=String(game.levelIndex);});
$('#tutorial-toggle').checked=preferences.value.tutorial;$('#tutorial-toggle').addEventListener('change',e=>{game.tutorial.enabled=e.target.checked;preferences.save({tutorial:e.target.checked});});
$('#quality-select').value=preferences.value.quality;$('#quality-select').addEventListener('change',e=>{preferences.save({quality:e.target.value});applyLabQuality(game,e.target.value);});
$('#mute-toggle').checked=preferences.value.muted;$('#volume-control').value=preferences.value.volume*100;
$('#mute-toggle').addEventListener('change',e=>{preferences.save({muted:e.target.checked});game.audio.configure(preferences.value);});
$('#volume-control').addEventListener('input',e=>{preferences.save({volume:Number(e.target.value)/100});game.audio.configure(preferences.value);});
$('#reload-button').addEventListener('click',()=>location.reload());
let captured=false;document.addEventListener('pointerlockchange',()=>{const locked=document.pointerLockElement===game.renderer?.domElement;const lost=captured&&!locked;captured=locked;
  if(lost&&!holds.size&&game.state==='playing'){clearInput();game.togglePause(true);}});
addEventListener('keydown',event=>{
  if(holds.size){event.preventDefault();event.stopImmediatePropagation();return;}
  if(game.state==='paused'&&['Escape','KeyR'].includes(event.code)){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)(event.code==='KeyR'?restartLevel():resume());}
  else if(game.state!=='playing'&&['Escape','KeyR','Space'].includes(event.code))event.stopImmediatePropagation();
},true);
addEventListener('blur',()=>hold('focus',true));addEventListener('focus',()=>hold('focus',false));
document.addEventListener('visibilitychange',()=>{hold('hidden',document.hidden);if(document.hidden&&game.state==='playing'&&!game.externalBlocked)game.togglePause(true);});
addEventListener('contextmenu',event=>event.preventDefault());
addEventListener('error',event=>{if(event.error)failure(event.error);});
addEventListener('unhandledrejection',event=>{if(/pointer.?lock|user gesture|document is not focused/i.test(String(event.reason))){event.preventDefault();return;}failure(event.reason);});
async function boot(){
  let sdk=null;if(yandex)try{sdk=await loadYandexSDK();}catch(error){console.warn('SDK unavailable; game remains playable',error);}
  platform=new LabPlatform({sdk,demo:!yandex,hold});hideScreens();screen('loading',true);setState('loading');await game.init();
}
boot().catch(failure);
