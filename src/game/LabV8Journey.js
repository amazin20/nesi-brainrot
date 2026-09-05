import * as THREE from 'three';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
/** Test driver uses the public movement vector, interaction button and camera
 * controls. Actor positions, portal positions, mechanism targets and win flags
 * are never assigned by the route. Run only in a debug build or Node test. */
export async function runV8Journey(game,{onMilestone=()=>{}}={}) {
  const oldMove=game.input.getMove,move=new THREE.Vector2();game.input.getMove=()=>move.clone();
  game.resetRun(true);const level=game.firstLevel,index=game.levelIndex;
  const identity=game.cargo.group.uuid,body=game.physics.cargoBody.id,report={level:index+1,id:level.id,pass:false,milestones:[],respawns:0,resets:0,frames:0};
  const respawn=game.respawn,resetCargo=game.physics.resetCargo;
  game.respawn=function(...args){report.respawns++;return respawn.apply(this,args);};
  game.physics.resetCargo=function(...args){report.resets++;return resetCargo.apply(this,args);};
  function frame(){
    if(game.state==='playing'){game.updatePlaying(1/120);if(game.state==='playing')game.updatePlaying(1/120);}
    game.updateVisuals(1/60,1);report.frames++;
    assert(report.respawns===0&&report.resets===0,`Level ${index+1}: unexpected reset at ${game.playerPosition.toArray()}`);
    assert(game.cargo.group.uuid===identity&&game.physics.cargoBody.id===body,'Companion identity changed');
  }
  function stop(){move.set(0,0);game.input.keys.clear();}
  function worldMove(x,z){const v=V(x,0,z).applyAxisAngle(V(0,1,0),-game.yaw);move.set(v.x,v.z);}
  function wait(seconds){stop();for(let n=0;n<Math.ceil(seconds*60);n++)frame();}
  function until(condition,seconds,label){stop();for(let n=0;n<seconds*60;n++){if(condition())return;frame();}assert(condition(),`${label}: ${game.playerPosition.toArray()} / friend ${game.cargo.position.toArray()}`);}
  function walk(x,z,seconds=20){
    const target=V(x,0,z);let best=Infinity,stuck=0;
    for(let n=0;n<seconds*60&&game.state==='playing';n++){
      const delta=target.clone().sub(game.playerPosition);delta.y=0;const d=delta.length();
      if(d<.11){stop();return;}
      if(d<best-.012){best=d;stuck=0;}else stuck++;
      const pace=Math.min(1,d*1.5);delta.normalize().multiplyScalar(pace);worldMove(delta.x,delta.z);frame();
      if(stuck>420)throw new Error(`Blocked walking to ${x},${z} at ${game.playerPosition.toArray()}`);
    }
    stop();assert(game.state==='won'||Math.hypot(game.playerPosition.x-x,game.playerPosition.z-z)<.3,`Walk timed out at ${game.playerPosition.toArray()} target ${x},${z}`);
  }
  function aim(index,point){
    stop();game.aimHeld=true;
    for(let n=0;n<240;n++){
      game.scene.updateMatrixWorld(true);
      if(point.clone().sub(game.camera.position).dot(game.camera.getWorldDirection(V()))<0){game.yaw+=.18;frame();continue;}
      const ndc=point.clone().project(game.camera);
      if(n>20&&Math.abs(ndc.x)<.01&&Math.abs(ndc.y)<.01)break;
      game.yaw-=THREE.MathUtils.clamp(ndc.x,-1,1)*.22;
      game.pitch=THREE.MathUtils.clamp(game.pitch+THREE.MathUtils.clamp(ndc.y,-1,1)*.19,-1.15,1.15);frame();
    }
    const okay=game.placePortal(index);game.aimHeld=false;
    if(!okay) console.error('Aim blockers',game.raycaster.intersectObjects(game.aimBlockers,true).slice(0,6).map(h=>({name:h.object.name,point:h.point.toArray(),portal:h.object.userData.portalable,proxy:h.object.userData.collisionProxy})));
    assert(okay,`Could not shoot portal ${index} at ${point.toArray()} from ${game.playerPosition.toArray()}; camera ${game.camera.position.toArray()}`);
  }
  function pickup(){game.interact();assert(game.heldCube,'Pickup failed');wait(.55);}
  function mark(name){const item={name,player:game.playerPosition.toArray(),cargo:game.cargo.position.toArray(),teleports:game.teleportCount};report.milestones.push(item);onMilestone(item,game);}
  function enter(patch,seconds=4){
    const f=patch.getFrame(),before=game.teleportCount;
    walk(f.center.x+f.normal.x*1.35,f.center.z+f.normal.z*1.35);
    for(let n=0;n<seconds*60&&game.teleportCount===before;n++){worldMove(-f.normal.x,-f.normal.z);frame();}
    stop();assert(game.teleportCount>before,'Entry traversal failed');wait(.6);
  }
  function fallFromEdge(edgeZ,direction){
    walk(index===4?-6:0,edgeZ);const before=game.teleportCount;
    for(let n=0;n<180&&game.playerGrounded;n++){worldMove(0,direction);frame();}
    stop();assert(!game.playerGrounded,'Failed to leave balcony');
    until(()=>game.teleportCount>before,4,'Falling portal missed');mark('fall velocity transported');
    until(()=>game.playerGrounded,5,'Landing island missed');mark('landed on island');
  }
  try {
    wait(.5);
    if(index===0){
      aim(0,level.panels.entry.getFrame().center);aim(1,level.panels.exit.getFrame().center);
      enter(level.panels.entry);mark('crossed the trench');walk(0,-11.5);
    }else if(index===1){
      aim(0,level.pads[0].mechanism.getPortalFrame().center);
      walk(.2,10.0);pickup();walk(-4,6.0);wait(.3);game.interact();wait(1.5);
      assert(level.pads[0].pressed,'Friend did not hold pad');mark('live weight opens door');
      walk(0,2);walk(0,-3.1);walk(5,-3.1);walk(5,-7);
      aim(1,level.panels.receiver.getFrame().center);wait(1.5);mark('retrieved friend through floor');
      const c=game.cargo.position;walk(c.x-1,c.z);pickup();walk(0,-12.5);
    }else if(index===2){
      walk(0,2.5);aim(0,level.panels.fall.getFrame().center);aim(1,level.panels.fling.getFrame().center);
      walk(1.2,7.5);pickup();walk(0,5);fallFromEdge(2.35,-1);walk(4.7,-11.2);
    }else if(index===3){
      aim(0,level.panels.entry.getFrame().center);aim(1,level.panels.lift.getFrame().center);
      walk(3.5,7.3);game.interact();until(()=>level.lift.y>4.98,10,'Lift did not rise');mark('portal rises with its panel');
      walk(-1.4,9);pickup();enter(level.panels.entry);assert(game.playerPosition.y>4.9,'Wrong lift exit height');walk(0,-12.5);
    }else{
      walk(-6,2.4);aim(0,level.panels.fall.getFrame().center);aim(1,level.receiverPanel.mechanism.getPortalFrame().center);
      walk(-6.7,-3.65);game.interact();until(()=>level.receiverPanel.progress>.99,5,'Panel did not tilt');mark('exit tilted upward');
      aim(1,level.receiverPanel.mechanism.getPortalFrame().center);
      walk(-4.8,-1);pickup();walk(-6,1);fallFromEdge(2.65,1);walk(9,9.7);
    }
    until(()=>game.state==='won',3,'Goal did not complete');
    assert(game.heldCube||index===0,'Friend lost from hands');mark('both at exit');
    report.pass=true;report.teleports=game.teleportCount;return report;
  } finally {
    stop();game.input.getMove=oldMove;game.respawn=respawn;game.physics.resetCargo=resetCargo;
  }
}
