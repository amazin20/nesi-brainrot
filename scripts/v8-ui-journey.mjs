import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const dir='smoke-artifacts';fs.mkdirSync(dir,{recursive:true});
const report={pass:false,renderer:'CI SwiftShader, not a user-device FPS measurement',levels:[],errors:[]};
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
let page;
try {
 page=await browser.newPage();await page.setViewport({width:1280,height:800,deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource'))report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400&&!new URL(r.url()).pathname.endsWith('/favicon.ico'))report.errors.push(`${r.status()} ${r.url()}`);});
 await page.goto('http://127.0.0.1:4173/?debug=1',{waitUntil:'networkidle0',timeout:120000});
 await page.waitForFunction(()=>window.__NESI_DEMO_GAME__?.state==='ready',{timeout:120000});
 assert.equal(await page.evaluate(()=>window.__NESI_DEMO_GAME__.assets.size),6);
 await page.screenshot({path:`${dir}/v8-menu.png`});
 for(let i=0;i<5;i++) {
  report.requestedLevel=i+1;console.log('Starting course',i+1);
  await page.click(i?'#play-again-button':'#play-button');
  await page.waitForFunction(n=>window.__NESI_DEMO_GAME__.levelIndex===n&&window.__NESI_DEMO_GAME__.state==='playing',{timeout:120000},i);
  await page.evaluate(()=>{const g=window.__NESI_DEMO_GAME__;g.renderer.setAnimationLoop(null);g.updateVisuals(0,1);g.render();});
  await page.screenshot({path:`${dir}/v8-level-${i+1}.png`});
  const before=await page.evaluate(()=>{const g=window.__NESI_DEMO_GAME__;return{loaded:g.assets.size,mechanics:g.firstLevel.diagnostics(),calls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles};});
  const route=await page.evaluate(()=>window.__NESI_RUN_LEVEL_ROUTE__());
  report.levels.push({index:i+1,before,route});assert.equal(route.pass,true);
  await page.evaluate(()=>window.__NESI_DEMO_GAME__.render());
  await page.screenshot({path:`${dir}/v8-level-${i+1}-finish.png`});
 }
 await page.click('#play-again-button');
 await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.levelIndex===0&&window.__NESI_DEMO_GAME__.state==='playing',{timeout:120000});
 await page.evaluate(()=>window.__NESI_DEMO_GAME__.togglePause(true));
 assert.equal(await page.$$eval('#pause-level-select option',a=>a.length),5);
 await page.select('#pause-level-select','2');await page.click('#level-menu-button');
 await page.waitForFunction(()=>window.__NESI_DEMO_GAME__.levelIndex===2&&window.__NESI_DEMO_GAME__.state==='playing',{timeout:120000});
 await page.evaluate(()=>window.__NESI_DEMO_GAME__.togglePause(true));
 await page.select('#quality-select','low');
 await page.$eval('#volume-range',e=>{e.value='23';e.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.click('#sound-toggle');await page.click('#hint-button');
 await page.waitForFunction(()=>document.querySelector('#hint-text').textContent.length>15);
 report.settings=await page.evaluate(()=>({saved:JSON.parse(localStorage.getItem('nesi-v8-settings')),enabled:window.__NESI_DEMO_GAME__.audio.enabled,hint:document.querySelector('#hint-text').textContent}));
 assert.equal(report.settings.saved.volume,23);assert.equal(report.settings.saved.quality,'low');assert.equal(report.settings.enabled,false);
 await page.screenshot({path:`${dir}/v8-settings.png`});
 await page.reload({waitUntil:'networkidle0',timeout:120000});
 await page.waitForFunction(()=>window.__NESI_DEMO_GAME__?.state==='ready',{timeout:120000});
 assert.equal(await page.$eval('#volume-range',e=>e.value),'23');assert.equal(await page.$eval('#sound-toggle',e=>e.checked),false);
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await page.screenshot({path:`${dir}/v8-mobile-menu.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(report.errors,[]);report.pass=true;console.log('Five courses, real Next buttons and settings PASS');
} catch(error) {
 report.failure=String(error.stack||error);
 if(page){report.failureState=await page.evaluate(()=>({index:window.__NESI_DEMO_GAME__?.levelIndex,state:window.__NESI_DEMO_GAME__?.state,loading:document.querySelector('#loading-label')?.textContent,error:document.querySelector('#error-detail')?.textContent,active:[...document.querySelectorAll('.screen--active')].map(e=>e.id)})).catch(()=>null);await page.screenshot({path:`${dir}/v8-failure.png`}).catch(()=>{});}
 console.log('V8 UI failure',JSON.stringify(report));throw error;
} finally {fs.writeFileSync(`${dir}/v8-browser.json`,JSON.stringify(report,null,2));await browser.close();}
