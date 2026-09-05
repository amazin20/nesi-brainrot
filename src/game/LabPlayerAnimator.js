import * as THREE from 'three';
import {
  LabPlayerAnimator as BaseAnimator,
  LAB_PLAYER_JOINTS as BASE_JOINTS,
  LAB_PLAYER_BONE as BASE_BONE,
  createLabPlayerRig as createBaseRig,
  resolveLabPlayerSkin as resolveBaseSkin,
  solveLabArm,
} from './LabPlayerAnimatorBase.js';
export {sampleLabFootCycle, solveLabLeg, solveLabArm} from './LabPlayerAnimatorBase.js';

// Keep all existing bone indices stable; append the rib cage. This preserves
// old attachment/foot contracts while giving shoulders an independent rhythm.
export const LAB_PLAYER_JOINTS=Object.freeze([
  ...BASE_JOINTS.map(j=>['Head','ArmL','ArmR'].includes(j.name)?{...j,parent:'Chest'}:j),
  {name:'Chest',parent:'Body',point:[0,0,-.48]},
]);
export const LAB_PLAYER_BONE=Object.freeze({...BASE_BONE,Chest:BASE_JOINTS.length});
const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

export function resolveLabPlayerSkin(x,y,z,indices=new Uint16Array(4),weights=new Float32Array(4)){
  resolveBaseSkin(x,y,z,indices,weights);
  x=Math.round(x*100000)/100000;y=Math.round(y*100000)/100000;z=Math.round(z*100000)/100000;
  const h=-z,chest=y<-.17&&h>.50?1:smooth(.49,.57,h),values=[];
  for(let i=0;i<4;i++){
    if(weights[i]<=.000001)continue;
    if(indices[i]===BASE_BONE.Body){
      if(weights[i]*(1-chest)>.000001)values.push([BASE_BONE.Body,weights[i]*(1-chest)]);
      if(weights[i]*chest>.000001)values.push([LAB_PLAYER_BONE.Chest,weights[i]*chest]);
    }else values.push([indices[i],weights[i]]);
  }
  values.sort((a,b)=>b[1]-a[1]||a[0]-b[0]);const chosen=values.slice(0,4),total=chosen.reduce((n,v)=>n+v[1],0)||1;
  indices.fill(0);weights.fill(0);chosen.forEach(([id,w],i)=>{indices[i]=id;weights[i]=w/total;});return {indices,weights};
}
function articulateChest(rig){
  if(rig.bones.Chest)return rig;
  const chest=new THREE.Bone();chest.name='LabChest';chest.position.set(0,0,-.135);
  rig.bones.Body.add(chest);rig.bones.Chest=chest;rig.rest.Chest=chest.position.clone();
  for(const name of ['Head','ArmL','ArmR']){
    const b=rig.bones[name];chest.add(b);b.position.sub(chest.position);rig.rest[name]=b.position.clone();
  }
  rig.mesh.updateWorldMatrix(true,true);
  const original=rig.skeleton;
  rig.skeleton=new THREE.Skeleton([...original.bones,chest],[...original.boneInverses.map(m=>m.clone()),chest.matrixWorld.clone().invert()]);
  rig.mesh.bind(rig.skeleton,rig.mesh.bindMatrix.clone());original.dispose();
  const p=rig.mesh.geometry.getAttribute('position'),ids=rig.mesh.geometry.getAttribute('skinIndex'),w=rig.mesh.geometry.getAttribute('skinWeight');
  const indices=new Uint16Array(4),weights=new Float32Array(4);
  for(let i=0;i<p.count;i++){
    resolveLabPlayerSkin(p.getX(i),p.getY(i),p.getZ(i),indices,weights);
    ids.setXYZW(i,...indices);w.setXYZW(i,...weights);
  }
  ids.needsUpdate=w.needsUpdate=true;rig.skeleton.update();return rig;
}
export function createLabPlayerRig(visual){return articulateChest(createBaseRig(visual));}

/** Production locomotion extension. Base clips/foot locks remain independently
 * tested. New motion is applied BEFORE world-space hand contact, never to the
 * physics capsule, camera, or the companion body. No authored asset is replaced. */
export class LabPlayerAnimator extends BaseAnimator{
  constructor(options){
    super(options);articulateChest(this.rig);
    this.chestTarget=new THREE.Euler();this.chestQuaternion=new THREE.Quaternion();
    this.jointTargets.Chest=this.chestTarget;this.basePose.Chest=new THREE.Quaternion();
    this.headBefore=new THREE.Quaternion();this.headTarget=new THREE.Euler();this.headQuaternion=new THREE.Quaternion();
    this.reset();
  }
  reset(){
    super.reset();this.flightBrace=0;
    if(this.bones.Chest){this.bones.Chest.quaternion.identity();this.basePose?.Chest?.identity();this.bones.Chest.position.copy(this.rig.rest.Chest);this.rig.mesh.updateWorldMatrix(true,true);this.rig.skeleton.update();this.snapCarrierToBody();}
  }
  update(input={}){super.update(input);this.basePose.Chest.copy(this.bones.Chest.quaternion);}
  get diagnostics(){return {...super.diagnostics,boneCount:LAB_PLAYER_JOINTS.length,profile:'flight-brace-v10',chestIndependent:true};}
  stepPose(input){
    this.headBefore.copy(this.bones.Head.quaternion);super.stepPose(input);
    const dt=input.dt||0,run=smooth(2.5,5.7,this.speed),moving=this.moveBlend*(1-this.airBlend);
    const cadence=this.gait*Math.PI*2,body=this.jointTargets.Body,relaxed=(1-.8*this.aimBlend)*(1-.55*this.carryBlend);
    this.chestTarget.set(-body.x*.24+.018*this.carryBlend+Math.sin(this.elapsed*1.6)*.006*this.idleBlend+this.airBlend*.045*(1-this.ascentBlend),
      -body.y*.45+Math.sin(cadence-.45)*.026*moving*relaxed,
      -Math.sin(cadence-.22)*.105*moving*relaxed+this.turn*.016);
    // A fast portal flight has a held, braced silhouette, not a walking loop.
    const flight=this.airBlend*smooth(6,14,Math.hypot(input.velocity?.x||0,input.velocity?.z||0));
    this.flightBrace=THREE.MathUtils.damp(this.flightBrace||0,flight,9,dt);
    this.chestTarget.x+=.075*this.flightBrace*(1-.65*this.carryBlend);
    this.chestTarget.y-=this.turn*.018*this.flightBrace;
    this.chestQuaternion.setFromEuler(this.chestTarget);
    this.bones.Chest.quaternion.slerp(this.chestQuaternion,1-Math.exp(-12*dt));
    const head=this.jointTargets.Head;
    this.headTarget.set(head.x-this.chestTarget.x*.65,head.y-this.chestTarget.y*.65,head.z-this.chestTarget.z*.65);
    this.headQuaternion.setFromEuler(this.headTarget);this.bones.Head.quaternion.copy(this.headBefore).slerp(this.headQuaternion,1-Math.exp(-8*dt));
    // Slightly wider free-arm travel without disturbing the held-device hand.
    const free=(1-this.carryBlend)*(1-this.interactionBlend)*(1-this.aimBlend);
    this.bones.ArmL.rotateX(Math.sin(cadence+.31)*(.009+.004*run)*moving*free*dt*60);
    this.bones.ArmL.rotateZ(-.035*this.flightBrace*free);
  }
  applyCarryReach(){
    const blend=smooth(.01,.985,this.reachBlend);this.carryReach.blend=blend;
    this.carryReach.leftError=this.carryReach.rightError=null;this.carryReach.leftClamped=this.carryReach.rightClamped=false;
    if(blend<1e-6)return;this.rig.mesh.updateWorldMatrix(true,true);
    for(const [side,key] of [['L','left'],['R','right']]){
      const arm=this.bones[`Arm${side}`],forearm=this.bones[`Forearm${side}`],hand=this.bones[`Hand${side}`];
      const local=arm.parent.worldToLocal(this.gripTargets[key].clone());
      const solved=solveLabArm(arm.position,local,this.rig.rest[`Forearm${side}`],this.rig.rest[`Hand${side}`],side);
      arm.quaternion.slerp(solved.arm,blend);forearm.quaternion.slerp(solved.forearm,blend);
      arm.updateWorldMatrix(true,true);hand.updateWorldMatrix(true,false);
      this.carryReach[`${key}Error`]=hand.getWorldPosition(new THREE.Vector3()).distanceTo(this.gripTargets[key]);this.carryReach[`${key}Clamped`]=solved.clamped;
    }
  }
}
