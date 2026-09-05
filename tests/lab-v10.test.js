import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {createHeadlessGame} from '../scripts/lab-headless.mjs';
import {resolvePortalPlacement} from '../src/game/LabPortals.js';
const g=await createHeadlessGame();
test('v10: portal fits the actual rotated plate at every intermediate angle, but real obstacles still block',async()=>{
 await g.selectLevel(4,false);g.resetRun(true);const p=g.firstLevel.receiverPanel;
 for(const progress of [0,.15,.45,.75,1]){
  p.mechanism.update(progress);g.syncCollision(p.collider,p.mechanism.getPanelBox(),1/120);
  const f=p.mechanism.getPortalFrame(),surface=p.portalMeshes[0];
  const result=resolvePortalPlacement(surface,f.center,{blockers:g.colliders});assert.ok(result.ok,`progress ${progress}: ${result.reason}`);
  const point=f.center.clone().addScaledVector(f.normal,.42),blocker={enabled:true,mesh:new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3)),box:new THREE.Box3(point.clone().addScalar(-.15),point.clone().addScalar(.15))};
  assert.equal(resolvePortalPlacement(surface,f.center,{blockers:[...g.colliders,blocker]}).reason,'obstructed');
 }
});
test('v10: level five separation exceeds a sprint jump with extra stack height and airborne steering',()=>{
 const l=g.firstLevel,target=l.world.floors.find(f=>f.y===3.5),source=l.world.floors.find(f=>f.y===5&&f.maxX===-3);
 const t=(7.8+Math.sqrt(7.8**2+2*19.5*(source.y+.9-target.y)))/19.5;
 const maxTravel=5*t+1.4*t*t+.86;
 assert.ok(target.minX-source.maxX>maxTravel,`Gap ${target.minX-source.maxX} must exceed ${maxTravel}`);
});
test('v10: pickup nearest friend is not stolen by a nearby terminal and E releases a carried friend',async()=>{
 await g.selectLevel(3,false);g.resetRun(true);
 g.playerPosition.set(1.8,0,6);g.cargo.position.set(.9,.4,6);g.physics.cargoBody.position.copy(g.cargo.position);g.updateVisuals(1/60,1);
 assert.equal(g.interact(),true);assert.ok(g.heldCube);const before=g.firstLevel.lift.target;
 assert.equal(g.interact(),true);assert.equal(g.heldCube,null);assert.equal(g.firstLevel.lift.target,before);
});
test('v10: flight bracing is visual, bounded and settles back without altering actor transforms',()=>{
 const original=g.playerPosition.clone(),velocity=new THREE.Vector3(16,-2,0);
 for(let i=0;i<90;i++)g.animator.update({dt:1/60,elapsed:i/60,speed:16,velocity,grounded:false,weapon:true});
 assert.ok(g.animator.flightBrace>.8);assert.ok(Math.abs(g.animator.bones.Chest.rotation.x)<.5);assert.deepEqual(g.playerPosition,original);
 for(let i=0;i<180;i++)g.animator.update({dt:1/60,elapsed:1.5+i/60,speed:0,velocity:new THREE.Vector3(),grounded:true});
 assert.ok(g.animator.flightBrace<.001);
 const rig=g.companionRig;assert.ok(rig);
 for(let i=0;i<120;i++)rig.update({dt:1/60,elapsed:i/60,speed:16,grounded:false,carrying:true,tumbling:true});
 assert.ok(rig.flightBrace>.99);assert.ok(Math.abs(rig.bones.FinL.rotation.x)>.1);
 rig.reset();assert.equal(rig.flightBrace,0);
});
