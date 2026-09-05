import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {CAMPAIGN} from '../src/game/LabCampaignLevels.js';
const root='http://127.0.0.1:4173/',out='smoke-artifacts';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,
 args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();await page.setViewport({width:1280,height:800});page.setDefaultTimeout(120000);
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('.glb'))requests.push(r.url());});
const report={renderer:'CI Chromium / SwiftShader; NOT a user-device FPS benchmark',routes:[],errors};
const ready=()=>page.waitForFunction(()=>window.__NESI_DEMO_GAME__?.state==='ready');
const shot=name=>page.screenshot({path:`${out}/${name}.png`});
try{
 await page.goto(root+'?debug=1',{waitUntil:'networkidle2'});await ready();
 assert.equal(await page.$$eval('#level-select option',a=>a.length),CAMPAIGN.length);assert.equal(requests.length,4);
 await shot('menu');await page.click('#play-button');await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.state==='playing');
 await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.performanceMonitor.stats.fps>0);await shot('level-1-start');
 report.initial=await page.evaluate(()=>({models:window.__NESI_DEMO_GAME__.assets.size,fps:document.querySelector('.lab-fps').textContent,
  oldHudHidden:getComputedStyle(document.querySelector('#hud')).display==='none',audioState:window.__NESI_DEMO_GAME__.audio.context?.state}));
 assert.equal(report.initial.models,4);assert.ok(report.initial.oldHudHidden);assert.equal(report.initial.audioState,'running');
 for(let index=0;index<CAMPAIGN.length;index++){
   if(index>0){await page.click('#play-again-button');await page.waitForFunction(i=>window.__NESI_DEMO_GAME__?.levelIndex===i&&window.__NESI_DEMO_GAME__.state==='playing',{},index);await shot(`level-${index+1}-start`);}
   const result=await page.evaluate(()=>window.__NESI_RUN_LEVEL_ROUTE__());report.routes.push(result);assert.ok(result.pass&&result.resets===0&&result.respawns===0);
   assert.equal(await page.$eval('#level-number',e=>e.textContent),`УРОВЕНЬ ${String(index+1).padStart(2,'0')}`);
   assert.equal(await page.$('#quick-hint'),null);await shot(`level-${index+1}-complete`);
   // Art-only overview: camera changes are explicitly not passage evidence.
   await page.evaluate(()=>{const g=window.__NESI_DEMO_GAME__,l=g.firstLevel;g.cameraRig.restoreProjection?.();g.camera.updateProjectionMatrix();
     document.querySelector('#win-screen').style.visibility='hidden';
     g.camera.position.set(l.index===4?15:17,l.index>=2?22:19,23);g.camera.lookAt(0,l.index>=2?2:0,0);g.camera.updateMatrixWorld(true);g.render();});
   await shot(`level-${index+1}-overview`);
   await page.$eval('#win-screen',e=>e.style.visibility='');
 }
 assert.equal(new Set(requests.map(x=>x.split('?')[0])).size,9);assert.equal(requests.length,9,'cached models must not download twice');
 await page.click('#play-again-button');await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.levelIndex===0&&window.__NESI_DEMO_GAME__.state==='playing');
 await page.evaluate(()=>document.exitPointerLock?.());await page.waitForFunction(()=>!document.pointerLockElement);
 if(await page.evaluate(()=>window.__NESI_DEMO_GAME__.state==='playing'))await page.click('#quick-settings');
 await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.state==='paused');
 await page.select('#quality-select','low');await page.$eval('#volume-control',e=>{e.value='25';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.click('#mute-toggle');
 await page.click('#hint-button');await page.click('#hint-unlock');await page.waitForFunction(()=>window.__NESI_PREFS__.value.hints[0]===1);await shot('settings');
 report.settings=await page.evaluate(()=>({value:window.__NESI_PREFS__.value,shadows:window.__NESI_DEMO_GAME__.renderer.shadowMap.enabled,
  audio:window.__NESI_DEMO_GAME__.audio.context.state,blocked:window.__NESI_DEMO_GAME__.externalBlocked}));
 assert.equal(report.settings.value.volume,.25);assert.equal(report.settings.value.muted,true);assert.equal(report.settings.shadows,false);assert.equal(report.settings.audio,'suspended');
 // Actual settings selector, not a private level-switch fixture.
 await page.select('#settings-level-select','3');await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.levelIndex===3&&window.__NESI_DEMO_GAME__.state==='playing');
 await page.reload({waitUntil:'networkidle2'});await ready();const saved=await page.evaluate(()=>window.__NESI_PREFS__.value);assert.equal(saved.quality,'low');assert.equal(saved.hints[0],1);assert.equal(saved.muted,true);
 report.persistence=true;
 // Original production walk/jump sequence. Rendered frame sequence, not a realtime benchmark.
 await page.setViewport({width:960,height:600});await page.click('#play-button');await page.evaluate(()=>{const g=window.__NESI_DEMO_GAME__;g.renderer.setAnimationLoop(null);g.resetRun(true);});
 fs.mkdirSync(`${out}/walk-frames`,{recursive:true});
 for(let f=0;f<60;f++){
   if(f===0)await page.keyboard.down('w');if(f===22){await page.keyboard.up('w');await page.keyboard.down('d');}if(f===36)await page.keyboard.up('d');if(f===41)await page.keyboard.press('Space');
   await page.evaluate(()=>{const g=window.__NESI_DEMO_GAME__;for(let i=0;i<4;i++)g.updatePlaying(1/120);g.updateVisuals(1/30,1);g.render();});
   await page.screenshot({path:`${out}/walk-frames/${String(f).padStart(3,'0')}.png`});
 }
 report.walkFrames=60;
 // Narrow-screen controls and settings remain inside viewport.
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});await page.reload({waitUntil:'networkidle2'});await ready();
 await page.click('#play-button');await page.evaluate(()=>document.exitPointerLock?.());await page.waitForFunction(()=>!document.pointerLockElement);if(await page.evaluate(()=>window.__NESI_DEMO_GAME__.state==='playing'))await page.click('#quick-settings');await shot('mobile-settings');assert.equal(await page.$eval('#settings-level-select',e=>!!e.getBoundingClientRect().width),true);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));console.log('Campaign WebGL: all active routes, lazy assets, menus, sound and persistence passed.');
}finally{fs.writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}
