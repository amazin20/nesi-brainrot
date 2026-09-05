import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHeadlessGame} from '../scripts/lab-headless.mjs';
import {CAMPAIGN} from '../src/game/LabCampaignLevels.js';
import {CAMPAIGN_ASSET_IDS} from '../src/game/labAssets.js';
import {sampleLabFootCycle} from '../src/game/LabPlayerAnimator.js';
const g=await createHeadlessGame();
test('v8 five courses have distinct geometry, declared purposeful assets and readable portal surfaces',async()=>{
 assert.equal(CAMPAIGN.length,5);assert.equal(CAMPAIGN[0].assets.length,4);assert.deepEqual([...new Set(CAMPAIGN.flatMap(l=>l.assets))].sort((a,b)=>a-b),[...CAMPAIGN_ASSET_IDS]);
 const layouts=new Set();
 for(let i=0;i<5;i++){
  if(i!==g.levelIndex)await g.selectLevel(i,false);const l=g.firstLevel;
  layouts.add(JSON.stringify([l.bounds,l.spawn,l.goal.position.toArray(),l.fixtures.map(x=>x.id)]));
  for(const s of l.world.surfaces){assert.equal(!!s.mesh.userData.portalable,s.portal);assert.equal(s.mesh.visible,false);assert.ok(s.width>0&&s.height>0);}
  for(const f of l.fixtures){assert.ok(CAMPAIGN[i].assets.includes(f.id));assert.ok(f.role.length>8);}
  assert.equal(l.launchPad,null,'introductory sequence must not add an unexplained impulse pad');
 }
 assert.equal(layouts.size,5);
});
test('v8 low first level contains no lift, weight switch or unexplained furniture',async()=>{
 await g.selectLevel(0,false);const l=g.firstLevel;assert.equal(l.pads.length,0);assert.equal(l.fixtures.length,0);assert.equal(l.terminals.length,0);assert.equal(l.lift,null);assert.equal(l.world.surfaces.filter(s=>s.portal).length,2);
});
test('v8 gravity fling retains momentum with no input, not airborne velocity damping',()=>{
 g.resetRun(true);g.playerPosition.set(0,6,0);g.previousPlayerPosition.copy(g.playerPosition);g.playerGrounded=false;g.playerVelocity.set(8,0,0);
 for(let i=0;i<24;i++)g.updatePlayer(1/120);assert.ok(Math.abs(g.playerVelocity.x-8)<1e-10);assert.ok(Math.abs(g.playerVelocity.y+3.9)<1e-10);assert.ok(Math.abs(g.playerPosition.x-1.6)<1e-10);
});
test('v8 lift uses one real visible deck, invisible collision and interpolates its attached portal with the same transform',async()=>{
 await g.selectLevel(3,false);g.resetRun(true);const l=g.firstLevel,m=l.lift;assert.equal(m.mesh.visible,false);
 const sourceBox=new THREE.Box3().setFromObject(m.art);assert.ok(Math.abs(sourceBox.max.y)<.001);
 g.playerPosition.set(3.5,0,7.3);assert.equal(l.interact(),true);
 const before=l.panels.lift.getFrame().center.clone();for(let i=0;i<240;i++)l.update(1/120);
 const after=l.panels.lift.getFrame().center;assert.ok(after.y>before.y+4);assert.ok(Math.abs(after.y-before.y-m.y)<.0001);
 l.renderUpdate(.5);assert.ok(Math.abs(m.group.position.y-(m.y+m.previousY)/2)<1e-10);l.renderUpdate(1);
});
test('v8 rotated plate does not collide with air in front of its actual surface',async()=>{
 await g.selectLevel(4,false);g.resetRun(true);const p=g.firstLevel.receiverPanel;p.target=1;for(let i=0;i<240;i++)g.firstLevel.update(1/120);
 const f=p.mechanism.getPortalFrame(),position=f.center.clone().addScaledVector(f.normal,2.2);position.y-=1.2;
 const previous=position.clone(),velocity=f.normal.clone().multiplyScalar(10);g.resolveBody(position,previous,velocity,.43,2.4,true);
 assert.ok(velocity.dot(f.normal)>9.9,'tilted world AABB killed an outward fling');
});
test('v8 wrong exit angle cannot reach a higher island merely by keeping the same speed',()=>{
 const gravity=19.5,top=3.5,feet=4.2-1.2,maxWalkingVertical=3.3;
 assert.ok(feet+maxWalkingVertical**2/(2*gravity)<top,'upright exit would bypass the angle puzzle');
 const f=g.firstLevel.receiverPanel.mechanism.getPortalFrame();
 const extent=.43+(1.2-.43)*f.normal.y+.025;
 const launchFeet=f.center.y+extent*f.normal.y-1.2;
 const speed=Math.sqrt(2*gravity*(5+1.2-.018)),up=speed*f.normal.y,forward=speed*f.normal.z;
 const time=(4.5-f.center.z-extent*f.normal.z)/forward;
 assert.ok(launchFeet+up*time-.5*gravity*time*time>top,'designed tilted ballistic arc does not reach island');
});
test('v8 exit requires grounded player and same nearby companion; flying through outline is not a win',()=>{
 const l=g.firstLevel;g.playerPosition.copy(l.goal.position);g.cargo.position.copy(l.goal.position).y+=.4;g.playerGrounded=false;assert.equal(l.isWon(),false);
 g.playerGrounded=true;assert.equal(l.isWon(),true);g.cargo.position.x+=10;assert.equal(l.isWon(),false);
});
test('v8 heel reception, toe-off and swing are distinct smooth poses',()=>{
 const a=sampleLabFootCycle(.01,.07,0),b=sampleLabFootCycle(.55,.07,0),c=sampleLabFootCycle(.8,.07,0);
 assert.ok(a.roll<-.10);assert.ok(b.roll>.2);assert.ok(c.lift>.025);assert.equal(c.planted,false);
 for(const seam of [0,.57,1]){assert.ok(Math.abs(sampleLabFootCycle(seam-1e-6,.07).roll-sampleLabFootCycle(seam+1e-6,.07).roll)<.0001);}
});
test('v8 switching levels does not accumulate colliders, scene roots or change cached source geometry',async()=>{
 await g.selectLevel(0,false);const count=g.colliders.length,roots=g.scene.children.length,asset=g.assets.get(1);
 for(const i of [3,1,4,2,0])await g.selectLevel(i,false);
 assert.equal(g.colliders.length,count);assert.equal(g.scene.children.length,roots);assert.equal(g.assets.get(1),asset);g.physics.dispose();g.portals.dispose();
});

test('v8 duplicate forced pause preserves the existing hint/settings panel',()=>{
 const old=g.callbacks.onPause;let notifications=0;g.callbacks.onPause=()=>notifications++;
 g.state='playing';g.togglePause(true);g.togglePause(true);g.togglePause(true);
 assert.equal(g.state,'paused');assert.equal(notifications,1);
 g.callbacks.onPause=old;g.resetRun(true);
});
