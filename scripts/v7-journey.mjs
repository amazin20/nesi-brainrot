import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHeadlessGame } from './lab-headless.mjs';
import { runCampaignJourney } from '../src/game/LabEvidence.js';
const game=await createHeadlessGame(), reports=[];
const originalCount=game.colliders.length;
const shared=[];for(const source of game.assets.values())source.traverse(node=>{
  if(node.geometry)node.geometry.addEventListener('dispose',()=>shared.push(node.geometry.uuid));
});
for(const index of [1,2]){
  await game.selectLevel(index);
  reports.push(runCampaignJourney(game,index));
  console.log('Level',index+1,'complete with same companion and no resets.');
}
await game.selectLevel(0);
assert.equal(game.colliders.length,originalCount,'Level switches accumulated collision bodies');
assert.equal(shared.length,0,'Level switch disposed shared model geometry');
game.playerPosition.z=-25;game.respawn(false);
assert.ok(game.playerPosition.distanceTo(new game.playerPosition.constructor(...game.firstLevel.spawn))<.001,'Respawn used an implicit checkpoint');
fs.mkdirSync('qa',{recursive:true});
fs.writeFileSync('qa/v7-campaign.json',JSON.stringify({pass:true,reports,checks:{sharedAssetsRetained:true,noColliderAccumulation:true,noCheckpoints:true}},null,2));
game.physics.dispose();game.portals.dispose();
