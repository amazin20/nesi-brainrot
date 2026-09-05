import fs from 'node:fs';import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage();
try{page.setDefaultTimeout(120000);await page.setViewport({width:1024,height:768});
 await page.setRequestInterception(true);page.on('request',r=>{
  if(new URL(r.url()).pathname==='/sdk.js')r.respond({status:200,contentType:'application/javascript',body:`
   window.__adLog=[];window.__reward=true;window.__sdkEvents={};
   window.YaGames={init:async()=>({on:(k,f)=>window.__sdkEvents[k]=f,off:k=>delete window.__sdkEvents[k],
    features:{LoadingAPI:{ready:()=>window.__adLog.push('ready')},GameplayAPI:{start:()=>window.__adLog.push('start'),stop:()=>window.__adLog.push('stop')}},
    adv:{showFullscreenAdv:({callbacks:c})=>{window.__adLog.push('interstitial');c.onOpen();setTimeout(()=>c.onClose(true),100);},
     showRewardedVideo:({callbacks:c})=>{window.__adLog.push('rewarded');c.onOpen();setTimeout(()=>{if(window.__reward){c.onRewarded();c.onRewarded();}c.onClose();},100);}}
   })};`});else r.continue();
 });
 await page.goto('http://127.0.0.1:4174/?debug=1',{waitUntil:'networkidle2'});await page.waitForFunction(()=>window.__NESI_DEMO_GAME__?.state==='ready');
 assert.equal(await page.evaluate(()=>window.__NESI_PLATFORM__.demo),false);await page.click('#play-button');await page.waitForFunction(()=>window.__NESI_DEMO_GAME__?.state==='playing' && window.__NESI_DEMO_GAME__.performanceMonitor.stats.fps>0);await page.evaluate(()=>document.exitPointerLock?.());await page.waitForFunction(()=>!document.pointerLockElement);if(await page.evaluate(()=>window.__NESI_DEMO_GAME__.state==='playing'))await page.click('#quick-settings');await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.state==='paused');await page.click('#hint-button');await page.waitForSelector('#hint-unlock',{visible:true});
 await page.click('#hint-unlock');await page.waitForFunction(()=>window.__NESI_PREFS__.value.hints[0]===1&&!window.__NESI_PLATFORM__.busy);
 assert.equal(await page.evaluate(()=>window.__NESI_DEMO_GAME__.state),'paused');
 await page.evaluate(()=>window.__reward=false);await page.click('#hint-unlock');await page.waitForFunction(()=>!window.__NESI_PLATFORM__.busy);
 assert.equal(await page.evaluate(()=>window.__NESI_PREFS__.value.hints[0]),1,'closing ad without reward must not unlock');
 await page.select('#settings-level-select','1');await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.levelIndex===1&&window.__NESI_DEMO_GAME__.state==='playing');
 const log=await page.evaluate(()=>window.__adLog);assert.equal(log.filter(x=>x==='ready').length,1);assert.ok(log.includes('interstitial'));assert.equal(log.filter(x=>x==='rewarded').length,2);
 await page.evaluate(()=>window.__sdkEvents.game_api_pause());assert.equal(await page.evaluate(()=>window.__NESI_DEMO_GAME__.externalBlocked),true);
 await page.evaluate(()=>window.__sdkEvents.game_api_resume());assert.equal(await page.evaluate(()=>window.__NESI_DEMO_GAME__.externalBlocked),false);
 fs.mkdirSync('smoke-artifacts',{recursive:true});fs.writeFileSync('smoke-artifacts/yandex-mock.json',JSON.stringify({pass:true,note:'SDK contract stub, NOT live ad delivery or revenue verification',log},null,2));
 console.log('Yandex build: SDK contract mock, opt-in, single reward, ad close, transition and pause/resume passed.');
}catch(error){
 fs.mkdirSync('smoke-artifacts',{recursive:true});await page.screenshot({path:'smoke-artifacts/yandex-failure.png'}).catch(()=>{});
 const state=await page.evaluate(()=>({state:window.__NESI_DEMO_GAME__?.state,blocked:window.__NESI_DEMO_GAME__?.externalBlocked,adLog:window.__adLog,hints:window.__NESI_PREFS__?.value.hints,menu:document.querySelector('#pause-screen')?.className,hintHidden:document.querySelector('#hint-detail')?.hidden})).catch(()=>null);
 fs.writeFileSync('smoke-artifacts/yandex-failure.json',JSON.stringify({error:String(error),state},null,2));throw error;
}finally{await browser.close();}
