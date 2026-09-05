import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHeadlessGame} from './lab-headless.mjs';
import {runV8Journey} from '../src/game/LabV8Journey.js';
const game=await createHeadlessGame();const reports=[];
for(const index of process.argv[2]?[Number(process.argv[2])-1]:[0,1,2,3,4]){
 if(index!==game.levelIndex)await game.selectLevel(index,false);
 console.log('Course',index+1);
 reports.push(await runV8Journey(game,{onMilestone:m=>console.log(m.name,m.player,m.cargo)}));
}
assert.ok(reports.every(r=>r.pass&&r.resets===0&&r.respawns===0));
fs.mkdirSync('qa',{recursive:true});fs.writeFileSync('qa/v8-journeys.json',JSON.stringify({pass:true,reports},null,2));
console.log('ALL REQUESTED ROUTES PASSED');
game.physics.dispose();game.portals.dispose();
