import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createHeadlessGame} from './lab-headless.mjs';
const V=(...p)=>new THREE.Vector3(...p),g=await createHeadlessGame();
const baseline=process.argv.includes('--baseline');
const cases=[
 {index:0,from:[[-4,0,4.5],[0,0,4.5],[4,0,4.5]],to:[[-4,0,-4.4],[0,0,-4.4],[4,0,-4.4]],reached:p=>p.z< -4&&p.y>-.1},
 {index:1,from:[[-1.5,0,2.8],[0,0,2.8],[1.5,0,2.8]],to:[[-1.5,0,-4],[0,0,-4],[1.5,0,-4]],reached:p=>p.z<-.7},
 {index:2,from:[[-2.5,5,2.5],[0,5,2.5],[2.5,5,2.5]],to:[[1,1,-8.9],[4,1,-8.9],[6.5,1,-8.9]],reached:p=>p.z< -8.6&&p.z> -14&&p.x>.3&&p.y>=.99},
 {index:3,from:[[-2,0,2.5],[0,0,2.5],[2,0,2.5]],to:[[-2,5,-8.4],[0,5,-8.4],[2,5,-8.4]],reached:p=>p.z< -8&&p.y>=4.99},
 {index:4,from:[[-3.48,5,2.5],[-3.48,5,1],[-4.5,5,2.5]],to:baseline?[[0,3.5,5],[2,3.5,6],[3,3.5,7]]:[[6,3.5,4.7],[8,3.5,5],[11,3.5,6]],reached:p=>p.x>(baseline?-.2:5.8)&&p.z>4.5&&p.z<13.8&&p.y>=3.49}
];
const report={baseline,scope:'Adversarial fixtures at reachable edges; normal production jump/collision/air control. Includes full sprint and an extra 0.9 m cargo-stack allowance. Not an exhaustive proof of all strategies.',attempts:0,bypasses:[],levels:[]};
for(const c of baseline?cases.filter(c=>c.index===4):cases){
 await g.selectLevel(c.index,false);let attempts=0;const successes=[];
 for(const source of c.from)for(const target of c.to)for(const carried of [false,true])for(const elevation of [0,.9]){
  g.resetRun(true);g.playerPosition.fromArray(source);g.playerPosition.y+=elevation;g.previousPlayerPosition.copy(g.playerPosition);g.playerGrounded=true;g.coyoteTime=.1;
  const move=V(target[0]-source[0],0,target[2]-source[2]).normalize();g.yaw=0;g.input.getMove=()=>new THREE.Vector2(move.x,move.z);
  g.input.keys.add('ShiftLeft');g.input.jumpQueued=true;g.heldCube=carried?g.cargo:null;g.playerVelocity.copy(move).multiplyScalar(carried?4.5:5);
  let hit=false;
  for(let f=0;f<300;f++){g.updatePlayer(1/120);if(c.reached(g.playerPosition)&&g.playerGrounded){hit=true;break;}if(g.playerPosition.y< -9)break;}
  attempts++;if(hit)successes.push({source,target,carried,elevation,land:g.playerPosition.toArray()});
 }
 report.attempts+=attempts;report.levels.push({level:c.index+1,attempts,bypasses:successes.length});report.bypasses.push(...successes.map(s=>({level:c.index+1,...s})));
 console.log('Shortcut audit',c.index+1,attempts,'attempts;',successes.length,'bypasses');
}
fs.mkdirSync('qa',{recursive:true});fs.writeFileSync(`qa/v10-${baseline?'baseline-bypass':'shortcut-audit'}.json`,JSON.stringify(report,null,2));
if(baseline)assert.ok(report.bypasses.length>0,'The old reported jump must be reproduced');else assert.equal(report.bypasses.length,0,'Reachable shortcut found');
g.physics.dispose();g.portals.dispose();
