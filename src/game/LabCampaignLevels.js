import * as THREE from 'three';
import { createArchitecturalGate } from './LabArchitecturalGate.js';
import { LabPressurePlatform } from './LabArticulatedProps.js';
const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const UP = V(0,1,0);
const within = (p, f, margin=0) => p && p.x > f.minX-margin && p.x < f.maxX+margin && p.z > f.minZ-margin && p.z < f.maxZ+margin;
export const CAMPAIGN = Object.freeze([
  { title: 'Мост для двоих', description: 'Вес, мост и возвращение друга.' },
  { title: 'Тихий атриум', description: 'Два двора, два независимых шлюза.' },
  { title: 'Верхняя мастерская', description: 'Подъём вдвоём и доставка на балкон.' },
]);

/** Two distinct, self-contained levels. All puzzle state is local to one level;
 * no checkpoints, random blockers, consumable keys, or one-way permanent locks. */
export function buildLabCampaignLevel(game, index) {
  if (![1,2].includes(index)) throw new RangeError('Campaign level must be 1 or 2');
  const high = index === 2, ceiling = high ? 8.8 : 6.2;
  const structure = new THREE.Group(); structure.name = CAMPAIGN[index].title; game.scene.add(structure);
  const palette = { wall: high ? 0xd6ddd4 : 0xe5e4d8, dark: high ? 0x506976 : 0x547b77, floor: high ? 0xb9c9ca : 0xd7ded7 };
  game.materials.wall.color.setHex(palette.wall); game.materials.dark.color.setHex(palette.dark);
  game.materials.floor.color.setHex(palette.floor);
  const mat = color => new THREE.MeshStandardMaterial({ color, roughness:.85, metalness:.02 });
  const lightMat = new THREE.MeshBasicMaterial({color:0xffeac4});
  const padList = [], gates = [], floors = [], panels = [], scenery = [];
  const bounds = {minX:-9,maxX:9,minZ:-29,maxZ:20};
  const spawn = [0,0,14.5], cargoSpawn=[-2.8,.6,12];
  const box = (x,y,z,w,h,d,m=game.materials.wall,solid=true) => game.box(x,y,z,w,h,d,m,{solid});
  function floor(x0,x1,z0,z1,y=0) {
    const mesh=box((x0+x1)/2,y-.16,(z0+z1)/2,x1-x0,.32,z1-z0,game.materials.floor);
    const f={minX:x0,maxX:x1,minZ:z0,maxZ:z1,y,mesh,enabled:true};
    floors.push(f);game.floors.push(f);
    return f;
  }
  floor(-9,9,-29,20);
  for(const sign of [-1,1]) box(sign*9.15,ceiling/2,-4.5, .3,ceiling,49.3);
  box(0,ceiling/2,20.15,18.3,ceiling,.3);box(0,ceiling/2,-29.15,18.3,ceiling,.3);
  // Skylight rafters rather than another low, sealed warehouse ceiling.
  box(0,ceiling+.12,-4.5,18.6,.24,49.6,mat(0xc6d7d9));
  for(const z of [13,5,-4,-12,-23]) {
    box(0,ceiling-.12,z,18.1,.24,.30,game.materials.dark,false);
    box(0,ceiling-.26,z,9,.04,.13,lightMat,false);
  }
  // Closed clerestory panels and a low dado make the rooms readable without
  // opening holes in the shell or adding physical obstacles to the route.
  const glass=mat(high?0x91b1bd:0xb2c9c0);
  for(const sign of [-1,1]) {
    box(sign*8.98,.45,-4.5,.025,.9,49,game.materials.dark,false);
    for(const z of [10,-9,-22]) {
      box(sign*8.97,ceiling-1.6,z,.04,1.65,4.6,glass,false);
      for(const dz of [-2.3,0,2.3]) box(sign*8.94,ceiling-1.6,z+dz,.035,1.72,.05,game.materials.dark,false);
    }
  }
  const fill=new THREE.PointLight(high?0xe0edff:0xffe8c9,28,38,2);fill.position.set(0,ceiling-1,-5);game.scene.add(fill);
  // Authored modules 23 and furniture provide detail without per-tile bodies.
  const tile=game.model(23,3), tileBounds=new THREE.Box3().setFromObject(tile), tileSize=tileBounds.getSize(V());
  tile.updateWorldMatrix(true,true);
  const deckY=high?3.2:0;
  const placements=[];
  for(const z of [13,10,7,4]) for(const x of [-6,-3,0,3,6]) placements.push([x,0,z]);
  for(const z of [-4,-7,-10,-13,-19,-22,-25]) for(const x of [-6,-3,0,3,6]) placements.push([x,deckY,z]);
  tile.traverse(source=>{
    if(!source.isMesh)return;
    const instances=new THREE.InstancedMesh(source.geometry,source.material,placements.length);
    placements.forEach(([x,y,z],i)=>instances.setMatrixAt(i,new THREE.Matrix4().makeTranslation(x,y-tileSize.y-.001,z).multiply(source.matrixWorld)));
    instances.receiveShadow=true;instances.computeBoundingBox();instances.computeBoundingSphere();structure.add(instances);
  });
  for(const [id,size,pos,yaw] of [[14,2.2,[-6.7,0,12.8],.3],[13,1.2,[-7.3,0,10.4],.8],[22,1.4,[7.3,deckY,-25.2],-.7]])
    scenery.push(game.addProp(id,size,pos,0,yaw,{solid:true}));
  // Small planted alcoves share simple materials and never occupy the route.
  const leaf=mat(0x6e9680), pot=mat(0xb5beb4);
  for(const [x,y,z] of [[7.4,0,13],[-7.4,deckY,-20.5]]) {
    box(x,y+.38,z,1.2,.76,1.2,pot);
    for(let i=0;i<3;i++) {
      const plant=new THREE.Mesh(new THREE.SphereGeometry(.5,10,7),leaf);
      plant.scale.set(.75,1.6,.75);plant.position.set(x+(i-1)*.27,y+1.25,z+Math.sin(i)*.22);structure.add(plant);
    }
  }
  function receiver(x,y,z,normal) {
    const mesh=box(x,y+2.1,z,.12,4.2,4.4,game.materials.wall);
    mesh.name='White receiving surface';
    game.markPortalSurface(mesh,V(x+normal*.062,y+1.85,z),V(normal,0,0),2.2,2.1);
    // The geometric bounds, not the aiming centre, define available height.
    mesh.userData.center=V(x+normal*.062,y+2.1,z);
    mesh.userData.stage=index;
    panels.push(mesh);return mesh;
  }
  function pad(x,y,z) {
    const art=game.addProp(29,5.7,[x,y,z]);
    const mechanism=new LabPressurePlatform(art);
    art.position.y+=y+.20-mechanism.getPortalFrame().center.y;mechanism.update(0);
    const fixed=mechanism.getFrameBox(), top=mechanism.getTopBox();
    const proxies=[
      new THREE.Box3(fixed.min.clone(),V(fixed.max.x,top.min.y-mechanism.pressTravel-.008,fixed.max.z)),
      new THREE.Box3(fixed.min.clone(),V(top.min.x,fixed.max.y,fixed.max.z)),
      new THREE.Box3(V(top.max.x,fixed.min.y,fixed.min.z),fixed.max.clone()),
      new THREE.Box3(V(top.min.x,fixed.min.y,fixed.min.z),V(top.max.x,fixed.max.y,top.min.z)),
      new THREE.Box3(V(top.min.x,fixed.min.y,top.max.z),V(top.max.x,fixed.max.y,fixed.max.z)),
    ].map(b=>game.collisionProxy(b,{aim:false}));
    const collider=game.collisionProxy(top,{kinematic:true,aim:false});
    const meshes=[];
    mechanism.top.traverse(mesh=>{
      if(!mesh.isMesh)return;
      Object.assign(mesh.userData,{portalable:true,portalFrame:()=>mechanism.getPortalFrame()});
      game.portalPanels.push(mesh);game.aimBlockers.push(mesh);meshes.push(mesh);
    });
    mechanism.frame.traverse(mesh=>{if(mesh.isMesh)game.aimBlockers.push(mesh);});
    const support=mechanism.getSupport();
    const f={minX:top.min.x,maxX:top.max.x,minZ:top.min.z,maxZ:top.max.z,y:support.center.y,mesh:collider.mesh,enabled:true};game.floors.push(f);
    const indicator=box(x+2.15,y+.15,z,.06,.10,1.0,new THREE.MeshBasicMaterial({color:0xe4ba79}),false);
    const result={art,mechanism,collider,frameColliders:proxies,position:V(x,y+.20,z),floor:f,
      top:meshes[0],portalMeshes:meshes,indicator,progress:0,previousProgress:0,contact:0,pressed:false};
    padList.push(result);return result;
  }
  const onPad=pad=>{
    if(!game.cargo||game.heldCube)return false;
    const c=game.cargo.position,f=pad.mechanism.getPortalFrame();
    return Math.hypot(c.x-f.center.x,c.z-f.center.z)<1.28&&c.y>f.center.y+.14&&c.y<f.center.y+.75&&game.cargo.velocity.length()<1;
  };
  function gate(z,pad,kind='door',floorY=0) {
    const build=createArchitecturalGate(game,{z,kind,floorY,roomWidth:high?14:18,roomHeight:ceiling-floorY});
    const leafColliders=kind==='door'?build.mechanism.getLeafBoxes().map(b=>game.collisionProxy(b,{kinematic:true})):
      [game.collisionProxy(build.opening,{kinematic:true})];
    build.mechanism.getFrameBoxes().forEach(b=>game.collisionProxy(b));
    const value={...build,z,pad,leafColliders,progress:0,previousProgress:0,opened:false};gates.push(value);
    // Thin floor cable points at the corresponding doorway; no text overlay.
    const line=new THREE.Mesh(new THREE.BoxGeometry(.025,.015,Math.abs(z-pad.position.z)),new THREE.MeshBasicMaterial({color:0xc39860}));
    line.position.set(pad.position.x,floorY+.015,(z+pad.position.z)/2);structure.add(line);value.line=line;
    return value;
  }
  let lift=null;
  if(high) {
    floor(-7,7,-29,-2,3.2);
    box(0,1.44,-2.13,14,2.88,.26,game.materials.dark);
    // Continuous inner balcony walls prevent walking around the upper gate.
    for(const sign of [-1,1]) box(sign*7.15,6,-15.5,.30,5.6,27.3);
    const group=new THREE.Group();group.position.set(0,0,0);game.scene.add(group);
    const art=game.model(19,4), b=new THREE.Box3().setFromObject(art);art.position.y-=b.max.y;group.add(art);
    const mesh=game.box(0,-.10,0,4,.20,4,game.materials.dark,{solid:true,parent:group});
    const collider=game.colliders.at(-1);collider.kinematic=true;
    const f={minX:-2,maxX:2,minZ:-2,maxZ:2,y:0,mesh,enabled:true};game.floors.push(f);
    lift={group,art,mesh,collider,floor:f,position:V(0,0,0),minY:0,maxY:3.2,y:0,previousY:0,hold:0,boardTime:0};
    const p=pad(-3.6,3.2,-9.5);gate(-17,p,'door',3.2);receiver(6.82,3.2,-24,-1);
  } else {
    const first=pad(-4,0,6.2);gate(0,first);receiver(8.82,0,-4,-1);
    // An offset courtyard opening: this is an L-shaped route, not the old bridge.
    box(-3.5,3.1,-7,11,6.2,.30);
    const second=pad(4,0,-11.7);gate(-18,second,'barrier');receiver(-8.82,0,-25,1);
  }
  let time=0;
  function update(dt) {
    time+=dt;
    for(const p of padList) {
      p.previousProgress=p.progress;p.contact=onPad(p)?p.contact+dt:0;
      if(dt>0)p.pressed=p.contact>.12;
      p.progress=THREE.MathUtils.damp(p.progress,p.pressed?1:0,10,dt);p.mechanism.update(p.progress);
      const f=p.mechanism.getSupport();p.floor.y=f.center.y;
      game.syncCollision(p.collider,p.mechanism.getTopBox(),dt);
      p.indicator.material.color.setHex(p.pressed?0x8bcbb6:0xe4ba79);
    }
    for(const g of gates) {
      g.previousProgress=g.progress;
      const occupied=[game.playerPosition,game.cargo?.position].some(p=>p&&Math.abs(p.x)<2.45&&Math.abs(p.z-g.z)<1.7&&p.y>=g.specification.floorY-.2);
      const previouslyOpen=g.opened;g.opened=g.pad.pressed;
      const target=g.opened||(g.progress>.72&&occupied)?1:0;
      g.progress=THREE.MathUtils.damp(g.progress,target,4,dt);g.mechanism.update(g.progress,time);
      if(g.field){g.leafColliders[0].enabled=!(!g.mechanism.solid);game.physics?.setStaticEnabled(g.leafColliders[0].mesh.uuid,g.mechanism.solid);}
      else g.mechanism.getLeafBoxes().forEach((b,i)=>game.syncCollision(g.leafColliders[i],b,dt));
      g.line.material.color.setHex(g.opened?0x8bcbb6:0xc39860);
      if(g.opened&&!previouslyOpen)game.companionAnimator?.trigger('nod');
    }
    if(lift) {
      const aboard=within(game.playerPosition,lift.floor,-.15)&&Math.abs(game.playerPosition.y-lift.y)<.20||
        within(game.cargo?.position,lift.floor,-.15)&&Math.abs(game.cargo.position.y-lift.y-.39)<.3;
      lift.boardTime=aboard?lift.boardTime+dt:0;
      const upperCall=game.playerPosition.y>3&&game.playerPosition.z>-4.2&&Math.abs(game.playerPosition.x)<2.7;
      lift.hold=lift.boardTime>.45||upperCall?2.5:Math.max(0,lift.hold-dt);
      const target=lift.hold>0?lift.maxY:lift.minY;
      const y=THREE.MathUtils.damp(lift.y,target,1.3,dt);
      if(game.physics)game.moveMechanism(lift,Math.abs(y-target)<.003?target:y,dt);
    }
  }
  function reset() {
    time=0;
    for(const p of padList){p.contact=p.progress=p.previousProgress=0;p.pressed=false;}
    for(const g of gates){g.progress=g.previousProgress=0;g.opened=false;}
    if(lift){lift.y=lift.previousY=lift.hold=lift.boardTime=0;lift.floor.y=0;lift.group.position.y=0;}
    update(0);
  }
  function renderUpdate(alpha=1,visualTime=time) {
    const t=THREE.MathUtils.clamp(alpha,0,1);
    padList.forEach(p=>p.mechanism.update(THREE.MathUtils.lerp(p.previousProgress,p.progress,t)));
    gates.forEach(g=>g.mechanism.update(THREE.MathUtils.lerp(g.previousProgress,g.progress,t),visualTime));
    if(lift)lift.group.position.y=THREE.MathUtils.lerp(lift.previousY,lift.y,t);
  }
  reset();
  return {title:`0${index+1} / ${CAMPAIGN[index].title.toUpperCase()}`,bounds,spawn,cargoSpawn,structure,floors,panels,pads:padList,gates,lift,
    bridges:[],terminals:[],launchPad:null,update,reset,renderUpdate,interact:()=>false,nearbyInteraction:()=>null,getLaunch:()=>null,
    cargoOnAnyPad:()=>padList.some(onPad),getObjective:()=>high?'Доберитесь вдвоём на верхний балкон.':'Пройдите оба двора вместе.',
    isWon:()=>game.playerPosition.z<-24&&game.cargo?.position.z<-23.6&&game.playerPosition.y>deckY-.3&&game.cargo.position.y>deckY&&game.playerPosition.distanceTo(game.cargo.position)<3.5,
    diagnostics:()=>({level:index+1,name:CAMPAIGN[index].title,noCheckpoints:true,gates:gates.map(g=>({opened:g.opened,progress:g.progress})),liftY:lift?.y??null})};
}
