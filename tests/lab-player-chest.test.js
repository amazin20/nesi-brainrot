import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeadlessGame} from '../scripts/lab-headless.mjs';
import {LAB_PLAYER_BONE,resolveLabPlayerSkin} from '../src/game/LabPlayerAnimator.js';

test('rib cage and shoulders counter-rotate while the original physics root stays untouched',async()=>{
 const g=await createHeadlessGame(),a=g.animator,origin=g.playerPosition.clone();
 assert.equal(a.bones.ArmL.parent,a.bones.Chest);assert.equal(a.bones.Head.parent,a.bones.Chest);
 assert.equal(a.bones.ThighL.parent,a.bones.Body);
 let cross=0,bb=0,cc=0;
 for(let i=0;i<180;i++){
  a.update({dt:1/60,speed:2.6,grounded:true,weapon:false});
  if(i>40){const b=a.bones.Body.rotation.z,c=a.bones.Chest.rotation.z;cross+=b*c;bb+=b*b;cc+=c*c;}
 }
 assert.ok(cross/Math.sqrt(bb*cc)<-.65,'shoulders and pelvis must oppose each other, not move as one block');
 assert.ok(cc>.1,'chest motion must be visible, not a numerically tiny test-only change');
 assert.ok(g.playerPosition.equals(origin));assert.equal(a.rig.skeleton.bones.length,15);
 a.reset();assert.ok(a.bones.Chest.quaternion.w>.999999);
 g.physics.dispose();g.portals.dispose();
});
test('upper pack is rigid on chest; device docking region is rigid on pelvis',()=>{
 for(const p of [[0,-.25,-.52],[-.21,-.28,-.56],[.2,-.24,-.60]]){
  const skin=resolveLabPlayerSkin(...p);assert.equal(skin.indices[0],LAB_PLAYER_BONE.Chest);assert.equal(skin.weights[0],1);
 }
 const dock=resolveLabPlayerSkin(.1545,-.141,-.455);
 assert.equal(dock.indices[0],LAB_PLAYER_BONE.Body);assert.equal(dock.weights[0],1);
});
