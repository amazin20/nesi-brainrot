import * as THREE from 'three';
import {createEvidenceDriver,aimEvidencePoint} from './LabEvidence.js';
const assert=(c,m)=>{if(!c)throw Error(m);};
/** Uses only normal movement, pickup and raycast shots. No position fixtures. */
export function runPhysicsJourney(g) {
 const d=createEvidenceDriver(g),l=g.firstLevel,i=g.levelIndex,marks=[];
 const mark=name=>{const data={name,player:g.playerPosition.toArray(),cargo:g.cargo.position.toArray(),teleports:g.teleportCount,lift:l.lift?.y};marks.push(data);if(globalThis.process)console.log(name,JSON.stringify(data));};
 const identity=g.cargo.group.uuid,body=g.physics.cargoBody;
 let resets=0,respawns=0;const reset=g.resetRun,respawn=g.respawn;g.resetRun=(...a)=>{resets++;return reset.apply(g,a);};g.respawn=(...a)=>{respawns++;return respawn.apply(g,a);};
 const move=(x,z)=>d.goto(x,z,35);
 const shoot=(slot,panel)=>{let target=panel.userData.portalFrame?.().center.clone()||panel.userData.center.clone();if(!panel.userData.portalFrame&&Math.abs(panel.userData.normal.y)<.1)target.y=Math.max(1.75,target.y-.25);aimEvidencePoint(g,target);assert(g.placePortal(slot),'Raycast portal rejected '+slot+': '+JSON.stringify({at:g.playerPosition.toArray(),target:target.toArray()}));};
 const pickup=()=>{const c=g.cargo.position;move(c.x,c.z+1.1);d.pressE();d.step(.5);assert(g.heldCube,'Could not pick up companion');};
 const clearInput=()=>g.input.keys.clear();
 function flyDrop(x,z) {
   // Step off the gantry onto the visible floor plate; after crossing release
   // input and let gravity and transported velocity produce the trajectory.
   let transported=false,base=g.teleportCount;
   for(let j=0;j<600;j++) {const dx=x-g.playerPosition.x,dz=z-g.playerPosition.z;g.yaw=Math.atan2(-dx,-dz);d.key('KeyW');d.step(1/60);if(g.teleportCount>base){transported=true;break;}}
   clearInput();assert(transported,'Did not enter lower portal '+g.playerPosition.toArray());mark('momentum exit');
   for(let j=0;j<200&&!g.playerGrounded;j++)d.step(1/60);
   mark('landing');assert(g.playerGrounded&&g.playerPosition.y>=l.goal.y-.15,'Flight missed landing platform');
 }
 try {
 g.state='playing';d.step(.7);
 if(i===0){
  shoot(0,l.points.entry);shoot(1,l.points.exit);pickup();
  move(-6.2,g.portals.portals[0].position.z);
  const base=g.teleportCount;g.yaw=Math.PI/2;d.key('KeyW');for(let j=0;j<180&&g.teleportCount===base;j++)d.step(1/60);clearInput();d.step(.3);assert(g.teleportCount>base,'First passage failed');mark('first portal with companion');
 }else if(i===1){
  move(-3.7,3);shoot(1,l.points.exit);shoot(0,l.points.entry);pickup();
  move(-9,7.6);move(-9,-2.25);mark('top of ramp');flyDrop(-9,-4.55);
 }else if(i===2||i===4){
  if(i===4){move(-7.7,9.6);d.pressE();d.step(2);assert(l.rotating.activated,'Terminal did not turn panel');move(-2.4,9);move(-2.4,1);}
  else {move(-2.5,10);move(-2.5,0);}
  shoot(1,l.points.exit);shoot(0,l.points.entry);move(-2.5,9);pickup();
  move(-5,9);move(-5,7.0);move(-5,4);d.step(5.4);mark('lift upper stop');assert(g.playerPosition.y>5.3,'Lift did not carry player');
  move(-5,-2.6);flyDrop(-5,-4.85);
 }else if(i===3){
  pickup();move(-5.4,7.95);g.yaw=0;g.facing=Math.PI;d.step(.4);d.pressE();d.step(2.8);assert(l.pads[0].pressed,'Companion not settled on pressure surface');
  move(0,5);move(0,-2.23);move(2.6,-2.23);move(2.6,-5.2);mark('bridge crossed');move(5.4,-7.8);
  shoot(1,l.points.exit);move(2.6,-2.23);move(-5.4,-2.23);move(-5.4,-3.8);shoot(0,l.points.entry);d.step(1.8);assert(!l.pads[0].pressed,'Companion did not fall through pressure portal');move(-5.4,-9);move(4,-9);pickup();move(6.9,-12.5);
 }
 move((l.goal.minX+l.goal.maxX)/2,(l.goal.minZ+l.goal.maxZ)/2);d.step(.5);
 assert(g.state==='won','Both actors did not reach goal '+g.playerPosition.toArray());assert(g.cargo.group.uuid===identity&&g.physics.cargoBody===body,'Companion identity changed');
 assert(resets===0&&respawns===0,'Route used a reset');
 assert((g.crossingEvents||[]).every(e=>Math.abs(e.incomingSpeed-e.outgoingSpeed)<1e-6),'Portal changed speed magnitude');
 return {pass:true,level:i+1,title:l.title,playerRespawns:respawns,cargoResets:resets,sameCompanion:true,portalCrossings:g.crossingEvents,marks};
 }finally{g.resetRun=reset;g.respawn=respawn;clearInput();}
}
