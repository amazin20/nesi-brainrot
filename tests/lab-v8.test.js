import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LabPlatform} from '../src/game/LabPlatform.js';
import {CAMPAIGN_V8,campaignAssets,CAMPAIGN_ASSET_IDS} from '../src/game/LabCampaignV8.js';
import {LabPlayerAnimator,LAB_PLAYER_BONE,resolveLabPlayerSkin} from '../src/game/LabPlayerAnimator.js';
import {resolvePortalPlacement,makePortalFrame,portalIntersectsBox} from '../src/game/LabPortals.js';
import {AudioController} from '../src/game/AudioController.js';
const store=()=>{const d=new Map();return{getItem:k=>d.get(k),setItem:(k,v)=>d.set(k,v)};};
function ads(){let callbacks,clock=0,pauses=0,resumes=0;const sdk={adv:{showRewardedVideo:o=>{callbacks=o.callbacks;},showFullscreenAdv:o=>{callbacks=o.callbacks;}}};const p=new LabPlatform({sdk,now:()=>clock,pause:()=>pauses++,resume:()=>resumes++,storage:store()});return{p,sdk,get cb(){return callbacks;},time:t=>clock=t,counts:()=>({pauses,resumes})};}
test('v8: only six dependencies in tutorial, five distinct puzzle roles and no fake 100-level entries',()=>{
 assert.equal(CAMPAIGN_V8.length,5);assert.equal(new Set(CAMPAIGN_V8.map(l=>l.id)).size,5);assert.equal(campaignAssets(0).length,6);
 assert.ok(!campaignAssets(0).includes(19)&&!campaignAssets(0).includes(29));assert.ok(campaignAssets(2).includes(19));assert.ok(campaignAssets(3).includes(29)&&campaignAssets(4).includes(28));
 assert.ok(!CAMPAIGN_ASSET_IDS.includes(13)&&!CAMPAIGN_ASSET_IDS.includes(14)&&!CAMPAIGN_ASSET_IDS.includes(12));
});
test('v8: rewarded hint is granted exactly once only by onRewarded, persists, no extra grant on close',async()=>{
 const a=ads(),promise=a.p.hint('level');assert.equal(a.p.unlocked('level'),0);a.cb.onOpen();a.cb.onRewarded();a.cb.onRewarded();assert.equal(a.p.unlocked('level'),1);a.cb.onClose();a.cb.onError();assert.equal((await promise).rewarded,true);assert.deepEqual(a.counts(),{pauses:1,resumes:1});
 const again=new LabPlatform({storage:a.p.storage});assert.equal(again.unlocked('level'),1);
});
test('v8: cancellation, missing inventory and thrown ad API never grant a hint or lock input',async()=>{
 const a=ads();const no=a.p.hint('test');a.cb.onClose(false);assert.equal((await no).rewarded,false);assert.equal(a.p.unlocked('test'),0);
 a.sdk.adv.showRewardedVideo=()=>{throw Error('offline');};assert.equal((await a.p.hint('test')).rewarded,false);assert.equal(a.p.busy,false);assert.deepEqual(a.counts(),{pauses:2,resumes:2});
 assert.equal((await new LabPlatform().hint('test')).reason,'unavailable');
});
test('v8: GitHub preview labels free hints and never calls advertising SDK',async()=>{
 const p=new LabPlatform({preview:true,sdk:{adv:{showRewardedVideo(){throw Error('must not call');}}}});assert.equal((await p.hint('preview')).preview,true);assert.equal(p.unlocked('preview'),1);
});
test('v8: fullscreen only on boundaries, warmup 120s, restart separation 300s and no back-to-back rewarded/fullscreen',async()=>{
 const a=ads();a.time(60000);assert.equal((await a.p.interstitial('level')).shown,false);
 a.time(125000);let result=a.p.interstitial('level');a.cb.onOpen();a.cb.onClose(true);assert.equal((await result).shown,true);
 a.time(420000);assert.equal((await a.p.interstitial('restart')).shown,false);
 a.time(426000);result=a.p.interstitial('restart');a.cb.onClose(true);assert.equal((await result).shown,true);
 a.time(600000);result=a.p.hint('x');a.cb.onOpen();a.cb.onRewarded();a.cb.onClose();await result;
 assert.equal((await a.p.interstitial('level')).shown,false);
});
test('v8: concurrent ad clicks are ignored and duplicate callbacks do not resume twice',async()=>{
 const a=ads(),one=a.p.hint('x');assert.equal((await a.p.hint('x')).reason,'busy');a.cb.onError();a.cb.onClose();await one;assert.deepEqual(a.counts(),{pauses:1,resumes:1});
});
test('v8: tilted panel ignores only its own explicit host, never neighbouring obstructions',()=>{
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(4.4,4.6,.2),new THREE.MeshBasicMaterial());mesh.userData={portalable:true,center:new THREE.Vector3(),normal:new THREE.Vector3(0,.5,.8660254),portalBounds:{halfWidth:2.2,halfHeight:2.3},portalHostCollider:'host'};
 const host={mesh:{uuid:'host'},box:new THREE.Box3(new THREE.Vector3(-3,-3,-1),new THREE.Vector3(3,3,1))};
 assert.equal(resolvePortalPlacement(mesh,new THREE.Vector3(),{blockers:[host]}).ok,true);
 const obstacle={mesh:{uuid:'obstacle'},box:host.box};assert.equal(resolvePortalPlacement(mesh,new THREE.Vector3(),{blockers:[host,obstacle]}).reason,'obstructed');
 mesh.userData.portalable=false;assert.equal(resolvePortalPlacement(mesh,new THREE.Vector3()).reason,'forbidden');
});
test('v8: source rear upper pack stays rigid on Chest while hip docking region remains on pelvis',()=>{
 let p=resolveLabPlayerSkin(.2,-.24,-.60);assert.equal(p.indices[0],LAB_PLAYER_BONE.Chest);assert.equal(p.weights[0],1);
 p=resolveLabPlayerSkin(.155,-.14,-.455);assert.equal(p.indices[0],LAB_PLAYER_BONE.Body);assert.equal(p.weights[0],1);
});
test('v8: sound pause reasons compose without unmuting during ads, settings clamp volume',()=>{
 const a=new AudioController();a.setVolume(8);assert.equal(a.volume,1);a.setVolume(-2);assert.equal(a.volume,0);a.pause('ad');a.pause('focus');a.pause('ad',false);assert.ok(a.pauses.has('focus'));a.setMuted(true);assert.equal(a.enabled,false);a.pause('focus',false);assert.equal(a.enabled,false);
});
