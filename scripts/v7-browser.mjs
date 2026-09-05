// Real WebGL smoke. Route simulation has no fixture teleports; camera-only
// architecture stills are labelled separately and are not route evidence.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const out=path.resolve(process.env.EVIDENCE_DIR || 'smoke-artifacts');fs.mkdirSync(out,{recursive:true});
const report={version:'v7',renderer:'CI Chromium / SwiftShader; not device FPS',errors:[],stills:[],routes:[]};
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,protocolTimeout:240000,
  args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
let page;
try {
  page=await browser.newPage();await page.setViewport({width:1280,height:800,deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(String(e.stack||e)));
  const url=new URL(process.env.DEMO_URL || 'http://127.0.0.1:4173/');url.searchParams.set('debug','1');
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__NESI_DEMO_GAME__?.state==='ready'||window.__NESI_DEMO_ERROR__,{timeout:240000});
  assert.equal(await page.evaluate(()=>window.__NESI_DEMO_ERROR__),undefined);
  await page.click('#play-button');
  await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.state==='playing');
  await page.waitForFunction(()=>window.__NESI_DEMO_GAME__?.performanceMonitor.stats.fps>0 && document.querySelector('.lab-fps')?.textContent.includes('FPS'),{timeout:120000});
  report.initial=await page.evaluate(()=>{
    const g=window.__NESI_DEMO_GAME__,hidden=s=>[...document.querySelectorAll(s)].every(e=>getComputedStyle(e).display==='none');
    return {models:g.assets.size,performance:g.performanceMonitor.stats,topHudHidden:hidden('#hud'),centerHintsHidden:hidden('.lab-prompt,.lab-surface-hint,#toast'),fps:document.querySelector('.lab-fps').textContent};
  });
  assert.equal(report.initial.models,16);assert.ok(report.initial.topHudHidden&&report.initial.centerHintsHidden);
  const freeze=()=>page.evaluate(()=>window.__NESI_DEMO_GAME__.renderer.setAnimationLoop(null));
  const shot=async name=>{await page.evaluate(()=>window.__NESI_DEMO_GAME__.render());await page.screenshot({path:path.join(out,name+'.png')});report.stills.push(name+'.png');};
  await freeze();await shot('level-1-start');
  // Sample the production run/jump poses. No custom animation or fake model.
  await page.evaluate(()=>{const g=window.__NESI_DEMO_GAME__;g.input.keys.add('KeyW');g.input.keys.add('ShiftLeft');for(let i=0;i<32;i++){g.updatePlaying(1/60);g.updateVisuals(1/60,1);}g.input.keys.clear();});
  await shot('player-running');
  await page.evaluate(()=>{const g=window.__NESI_DEMO_GAME__;g.input.jumpQueued=true;for(let i=0;i<14;i++){g.updatePlaying(1/60);g.updateVisuals(1/60,1);}});
  await shot('player-jumping');
  // Real menu controls, not a URL-only level replacement.
  await page.evaluate(()=>window.__NESI_DEMO_GAME__.togglePause(true));
  await page.click('#level-menu-button');await page.select('#level-select','1');await page.click('#play-button');
  await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.levelIndex===1&&window.__NESI_DEMO_GAME__.state==='playing',{timeout:180000});
  await freeze();await shot('level-2-start');
  // Fixed-camera architecture details. Only camera transform is changed here.
  for(const [kind,pos,target] of [['door',[6,3,7],[0,2,0]],['barrier',[5,3,-12],[0,2,-18]]]){
    const camera=await page.evaluate(()=>{const c=window.__NESI_DEMO_GAME__.camera;return {p:c.position.toArray(),q:c.quaternion.toArray()};});
    await page.evaluate(({pos,target})=>{const g=window.__NESI_DEMO_GAME__;g.camera.position.fromArray(pos);g.camera.lookAt(...target);g.camera.updateMatrixWorld(true);},{pos,target});
    await shot(kind+'-architecture');
    await page.evaluate(c=>{const camera=window.__NESI_DEMO_GAME__.camera;camera.position.fromArray(c.p);camera.quaternion.fromArray(c.q);camera.updateMatrixWorld(true);},camera);
  }
  report.routes.push(await page.evaluate(()=>window.__NESI_RUN_LEVEL_ROUTE__()));
  await shot('level-2-completed');
  assert.equal(await page.$eval('#win-screen',e=>e.classList.contains('screen--active')),true);
  await page.click('#play-again-button');
  await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.levelIndex===2&&window.__NESI_DEMO_GAME__.state==='playing',{timeout:180000});
  await freeze();await shot('level-3-start');
  report.routes.push(await page.evaluate(()=>window.__NESI_RUN_LEVEL_ROUTE__()));
  await shot('level-3-completed');
  // The last next-button returns to the original course without leaking models.
  await page.click('#play-again-button');
  await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.levelIndex===0&&window.__NESI_DEMO_GAME__.state==='playing',{timeout:180000});
  await freeze();await shot('level-1-after-cycle');
  report.final=await page.evaluate(()=>window.__NESI_DEMO_GAME__.diagnostics());
  assert.equal(report.final.modelsLoaded,16);assert.equal(report.errors.length,0,report.errors.join('\n'));
  report.pass=true;console.log('WebGL: both new routes, actual level menu/next controls, FPS and hidden HUD passed.');
} catch(e){report.pass=false;report.failure=String(e.stack||e);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw e;}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}
