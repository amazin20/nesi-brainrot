import test from 'node:test';import assert from 'node:assert/strict';
import {LabPlatform} from '../src/game/LabPlatform.js';
import {LabPreferences,sanitizePreferences} from '../src/game/LabPreferences.js';
function fixture(){let clock=0,callbacks;const events={},holds=[],calls=[];const sdk={features:{LoadingAPI:{ready(){calls.push('ready');}},GameplayAPI:{start(){calls.push('start');},stop(){calls.push('stop');}}},on:(e,f)=>events[e]=f,off:e=>delete events[e],adv:{showRewardedVideo:x=>{callbacks=x.callbacks;calls.push('reward');},showFullscreenAdv:x=>{callbacks=x.callbacks;calls.push('full');}}};
 const platform=new LabPlatform({sdk,demo:false,hold:(...x)=>holds.push(x),now:()=>clock,timeout:5000});return {platform,events,holds,calls,get callbacks(){return callbacks;},time:n=>clock=n};}
test('v8 rewarded hint is opt-in, grants once only onRewarded and releases pause on close',async()=>{
 const f=fixture();let granted=0;assert.deepEqual(f.calls,[]);const p=f.platform.hint(()=>granted++);assert.equal(granted,0);assert.equal(f.platform.busy,true);f.callbacks.onOpen();f.callbacks.onRewarded();f.callbacks.onRewarded();assert.equal(granted,1);f.callbacks.onClose();assert.equal((await p).rewarded,true);assert.deepEqual(f.holds.at(-1),['ad',false]);
});
test('v8 closing, error or absence of rewarded video never grants a hint',async()=>{
 for(const action of ['onClose','onError']){const f=fixture();let grants=0;const p=f.platform.hint(()=>grants++);f.callbacks[action]();await p;assert.equal(grants,0);assert.equal(f.platform.busy,false);}
 const p=new LabPlatform({demo:false});assert.equal((await p.hint(()=>assert.fail())).reason,'unavailable');
});
test('v8 restart advert has a five minute session-wide cooldown and next is a safe transition request',async()=>{
 const f=fixture();assert.equal((await f.platform.interstitial('restart')).reason,'cooldown');f.time(299999);assert.equal((await f.platform.interstitial('restart')).reason,'cooldown');f.time(300001);let p=f.platform.interstitial('restart');f.callbacks.onOpen();f.callbacks.onClose(true);await p;
 f.time(599999);assert.equal((await f.platform.interstitial('restart')).reason,'cooldown');f.time(600002);p=f.platform.interstitial('next');f.callbacks.onClose(false);assert.equal((await p).shown,false);
 assert.equal((await f.platform.interstitial('timer')).reason,'invalid-transition');
});
test('v8 busy blocks duplicate ad requests and errors allow continuing',async()=>{
 const f=fixture();const a=f.platform.hint(()=>{});assert.equal((await f.platform.hint(()=>{})).reason,'busy');f.callbacks.onError();await a;assert.equal(f.platform.busy,false);
});
test('v8 SDK lifecycle and pause events have independent locks',()=>{
 const f=fixture();f.platform.ready();f.platform.ready();f.platform.gameplay(true);f.platform.gameplay(true);f.platform.gameplay(false);assert.deepEqual(f.calls,['ready','start','stop']);f.events.game_api_pause();f.events.game_api_resume();assert.deepEqual(f.holds,[['sdk',true],['sdk',false]]);f.platform.dispose();assert.deepEqual(f.events,{});
});
test('v8 a silent unavailable SDK cannot leave the game held indefinitely',async()=>{
 const holds=[];const p=new LabPlatform({sdk:{adv:{showFullscreenAdv(){}}},demo:false,hold:(...x)=>holds.push(x),timeout:8});
 assert.equal((await p.interstitial('next')).reason,'timeout');assert.deepEqual(holds.at(-1),['ad',false]);
});
test('v8 watchdog never resumes play underneath an opened advert',async()=>{
 const f=fixture();f.platform.timeout=5;const p=f.platform.hint(()=>{});f.callbacks.onOpen();await new Promise(r=>setTimeout(r,15));assert.equal(f.platform.busy,true);assert.deepEqual(f.holds.at(-1),['ad',true]);f.callbacks.onClose();await p;
});
test('v8 GitHub demo says no ads and permits free hints without SDK calls',async()=>{
 const p=new LabPlatform({demo:true});let n=0;assert.equal((await p.hint(()=>n++)).reason,'free-demo');assert.equal(n,1);assert.equal((await p.interstitial('next')).reason,'demo');
});
test('v8 preferences are durable, validated and retain unlocked hints',()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
 const p=new LabPreferences(storage);p.save({volume:.25,quality:'low',muted:true});p.unlockHint(2);p.complete(3);
 const q=new LabPreferences(storage);assert.equal(q.value.volume,.25);assert.equal(q.value.quality,'low');assert.equal(q.value.muted,true);assert.equal(q.value.hints[2],1);assert.deepEqual(q.value.completed,[3]);
 assert.equal(sanitizePreferences({volume:NaN,quality:'ultra',hints:{x:100}}).quality,'balanced');
 const broken=new LabPreferences({getItem(){throw Error();},setItem(){throw Error();}});broken.save({volume:2});assert.equal(broken.value.volume,1);
});

test('v8 late callbacks cannot release the lock of a newer advert',async()=>{
 const f=fixture();f.platform.timeout=5;const expired=f.platform.hint(()=>assert.fail('late reward'));
 const old=f.callbacks;assert.equal((await expired).reason,'timeout');
 f.platform.timeout=1000;const current=f.platform.hint(()=>{}),next=f.callbacks;next.onOpen();
 old.onClose();assert.deepEqual(f.holds.at(-1),['ad',true]);assert.equal(f.platform.busy,true);
 old.onOpen();next.onClose();await current;assert.deepEqual(f.holds.at(-1),['ad',true]);
 assert.equal((await f.platform.interstitial('next')).reason,'busy');
 old.onClose();assert.deepEqual(f.holds.at(-1),['ad',false]);
});
