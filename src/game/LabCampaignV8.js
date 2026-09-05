import * as THREE from 'three';
import { LabTileWorld } from './LabTileWorld.js';
import { LabPressurePlatform, LabCounterweightBridge, LabRotatingPanel } from './LabArticulatedProps.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const inside=(p,f,margin=0)=>p&&p.x>=f.minX+margin&&p.x<=f.maxX-margin&&p.z>=f.minZ+margin&&p.z<=f.maxZ-margin;
const damp=THREE.MathUtils.damp;
export const CAMPAIGN_V8=Object.freeze([
 {id:'first-link',title:'Первая связь',description:'Только порталы и друг. Научись соединять две стороны.',models:[1,2,11,23,24,26],
  hints:['Портал держится только на гладкой светлой плите с бронзовым ободком. Ребристый металл не подходит.','Одна светлая плита стоит рядом, другая — за провалом. Соедини их разными порталами.','Поставь оба портала, возьми друга клавишей E и войди в ближайший проход. Дойдите до двух колец вместе.']},
 {id:'fall-speed',title:'Падение — это скорость',description:'Преврати падение со склона в полёт через разрыв.',models:[1,2,11,23,24,26,27],
  hints:['Выход поворачивает скорость падения в горизонтальную. Сам портал не разгоняет тебя.','Низкого падения не хватает. Поднимись по пандусу над напольной плитой.','Свяжи напольную плиту со светлой плитой на высокой опоре. Возьми друга, поднимись на склон и шагни в нижний портал с верхней площадки.']},
 {id:'gravity-lift',title:'Лифт гравитации',description:'Набери высоту, чтобы долететь до верхнего балкона.',models:[1,2,11,23,24,26,19],
  hints:['Подъёмник нужен не просто для подъёма: высота перед падением определяет скорость после портала.','Выход уже расположен высоко, но с пола не набрать нужную дальность. Поднимись вместе с другом.','Сначала свяжи нижнюю плиту и плиту на опоре. Встань на лифт, дождись остановки наверху, пройди по площадке и спрыгни в нижний портал.']},
 {id:'counterweight-return',title:'Обратный вес',description:'Друг опускает мост. Как забрать его с другого берега?',models:[1,2,11,23,24,26,29,30],
  hints:['Мост остаётся опущенным, пока на нажимной плите есть реальный груз. Заберёшь груз — противовес поднимет настил.','Портал можно поставить прямо в светлую поверхность нажимной плиты. Друг провалится через неё к тебе.','Поставь друга на плиту, перейди мост и уже с дальнего берега свяжи плиту с принимающей панелью. Подбери друга и дойдите до колец.']},
 {id:'vector-workshop',title:'Поворот импульса',description:'Поверни выход, чтобы направить скорость вверх и вперёд.',models:[1,2,11,23,24,26,19,22,28],
  hints:['Высота даёт скорость, а наклон выходной панели задаёт направление. Горизонтально до высокого балкона не добраться.','Терминал поворачивает настоящую панель вместе с уже установленным порталом. Выбери наклон вверх.','Нажми E у терминала, свяжи нижнюю плиту и наклонённую панель. Поднимись на лифте с другом и упади в напольный портал. Не гаси полёт встречным движением.']},
]);
export function campaignAssets(index){return CAMPAIGN_V8[index]?.models??CAMPAIGN_V8[0].models;}
export const CAMPAIGN_ASSET_IDS=Object.freeze([...new Set(CAMPAIGN_V8.flatMap(x=>x.models))]);

/** Five authored layouts, one shared physical rule set. Puzzles may be solved in
 * more than one way; no invisible "solution order" is required to win. */
export function buildPhysicsCampaign(game,index) {
 if(!CAMPAIGN_V8[index])throw new RangeError('Unknown campaign level');
 const info=CAMPAIGN_V8[index];const palette=[
  {wall:0x526b70,floor:0x97aaa7,sky:0xb6ced0},
  {wall:0x635e54,floor:0xaaa18d,sky:0xdac9aa},
  {wall:0x4a6178,floor:0x93a5b4,sky:0xabc1d5},
  {wall:0x665d4c,floor:0xa29b81,sky:0xd4d0b6},
  {wall:0x4e5369,floor:0x999cad,sky:0xb6bdd5},
 ][index];
 game.scene.background?.setHex?.(palette.sky);if(!game.scene.background)game.scene.background=new THREE.Color(palette.sky);
 if(game.scene.fog){game.scene.fog.color.setHex(palette.sky);game.scene.fog.near=48;game.scene.fog.far=100;}
 const world=new LabTileWorld(game,palette),pads=[],bridges=[],terminals=[],frames=[],updates=[],renders=[],resetters=[];
 const points={};let time=0,lift=null,rotating=null,goal,spawn,cargoSpawn,bounds;
 function makeLift(x,z,high) {
  const group=new THREE.Group();group.position.set(x,0,z);group.name='19 / gravity lift';game.scene.add(group);
  const art=game.model(19,4);const b=new THREE.Box3().setFromObject(art);art.position.y-=b.max.y;group.add(art);art.userData.role='lift-load-to-drop-height';
  const mesh=game.box(0,-.10,0,4,.20,4,world.metal,{solid:true,parent:group});mesh.visible=false;mesh.userData.collisionProxy=true;
  const collider=game.colliders.at(-1);collider.kinematic=true;
  const floor={minX:x-2,maxX:x+2,minZ:z-2,maxZ:z+2,y:0,mesh,enabled:true};game.floors.push(floor);
  for(const dx of [-2.22,2.22])world.box(x+dx,high/2,z, .14,high+.5,.18,world.edge);
  const l={group,art,mesh,collider,floor,position:V(x,0,z),minY:0,maxY:high,y:0,previousY:0,dwell:0,hold:0,velocity:0};
  updates.push(dt=>{
   const aboard=inside(game.playerPosition,l.floor,.10)&&Math.abs(game.playerPosition.y-l.y)<.18 ||
     inside(game.cargo?.position,l.floor,.12)&&Math.abs(game.cargo.position.y-l.y-.39)<.3;
   const call=game.playerPosition.y>high-.3&&Math.abs(game.playerPosition.x-x)<2.4&&Math.abs(game.playerPosition.z-z)<4.2;
   l.dwell=aboard?l.dwell+dt:0;l.hold=l.dwell>.4||call?2.5:Math.max(0,l.hold-dt);
   const target=l.hold?high:0,old=l.y;
   const desired=Math.sign(target-l.y)*Math.min(1.5,Math.sqrt(2*1.7*Math.abs(target-l.y)));
   l.velocity=damp(l.velocity,desired,4,dt);
   let y=l.y+l.velocity*dt;if(Math.abs(target-l.y)<.008||Math.sign(target-y)!==Math.sign(target-l.y)){y=target;l.velocity=0;}
   if(game.physics)game.moveMechanism(l,y,dt);
   game.audio?.motor?.('lift',Math.abs(y-old)/Math.max(dt,1e-6)/1.5);
  });
  renders.push(alpha=>{l.group.position.y=THREE.MathUtils.lerp(l.previousY,l.y,alpha);});
  resetters.push(()=>{l.y=l.previousY=l.dwell=l.hold=l.velocity=0;l.group.position.y=0;l.floor.y=0;});
  return l;
 }
 function makeRamp(x,z0,z1,high) {
  const art=game.model(27,1);art.updateWorldMatrix(true,true);let b=new THREE.Box3().setFromObject(art),s=b.getSize(V());
  art.scale.set(3.8/s.x,high/s.y,(z1-z0)/s.z);art.updateWorldMatrix(true,true);b=new THREE.Box3().setFromObject(art);
  const c=b.getCenter(V());art.position.add(V(x-c.x,-b.min.y,(z0+z1)/2-c.z));art.userData.role='gain-fall-height';game.scene.add(art);art.updateWorldMatrix(true,true);
  b=new THREE.Box3().setFromObject(art);const ray=new THREE.Raycaster(),profile=[];
  for(let i=0;i<=24;i++) {
   const z=THREE.MathUtils.lerp(z0,z1,i/24);ray.set(V(x,high+1,THREE.MathUtils.clamp(z,z0+.02,z1-.02)),V(0,-1,0));
   const hit=ray.intersectObject(art,true)[0];profile.push({z,y:hit?.point.y??high*(1-i/24)});
  }
  const ramp={id:art.uuid,model:art,minX:x-1.8,maxX:x+1.8,minZ:z0,maxZ:z1,lowY:0,highY:high,highAt:'minZ',profile};game.ramps.push(ramp);
  // Imported deck is both the visible support and an accurate aim/camera surface.
  art.traverse(m=>{if(m.isMesh){m.userData.portalForbidden=true;game.aimBlockers.push(m);game.cameraBlockers.push(m);}});
  return ramp;
 }
 function makePad(x,z) {
  const art=game.addProp(29,5.7,[x,0,z]);art.userData.role='load-controls-counterweight';
  const m=new LabPressurePlatform(art);art.position.y+=.20-m.getPortalFrame().center.y;m.update(0);
  const fixed=m.getFrameBox(),top=m.getTopBox();
  const regions=[new THREE.Box3(fixed.min.clone(),V(fixed.max.x,top.min.y-m.pressTravel-.008,fixed.max.z)),
   new THREE.Box3(fixed.min.clone(),V(top.min.x,fixed.max.y,fixed.max.z)),
   new THREE.Box3(V(top.max.x,fixed.min.y,fixed.min.z),fixed.max.clone()),
   new THREE.Box3(V(top.min.x,fixed.min.y,fixed.min.z),V(top.max.x,fixed.max.y,top.min.z)),
   new THREE.Box3(V(top.min.x,fixed.min.y,top.max.z),V(top.max.x,fixed.max.y,fixed.max.z))];
  regions.forEach(b=>game.collisionProxy(b,{aim:false}));
  const collider=game.collisionProxy(top,{kinematic:true,aim:false}),meshes=[];
  m.top.traverse(node=>{if(node.isMesh){Object.assign(node.userData,{portalable:true,tileKind:'ceramic',portalHostCollider:collider.mesh.uuid,portalFrame:()=>m.getPortalFrame()});game.portalPanels.push(node);game.aimBlockers.push(node);meshes.push(node);}});
  m.frame.traverse(node=>{if(node.isMesh)game.aimBlockers.push(node);});
  const f={minX:top.min.x,maxX:top.max.x,minZ:top.min.z,maxZ:top.max.z,y:m.getSupport().center.y,mesh:collider.mesh,enabled:true};game.floors.push(f);
  const p={art,mechanism:m,position:V(x,.2,z),floor:f,collider,top:meshes[0],portalMeshes:meshes,pressed:false,progress:0,previousProgress:0,load:0,contact:0};pads.push(p);
  updates.push(dt=>{
   p.previousProgress=p.progress;const frame=m.getPortalFrame(),c=game.cargo;
   const contact=c&&!game.heldCube&&Math.hypot(c.position.x-frame.center.x,c.position.z-frame.center.z)<1.25&&c.position.y>frame.center.y+.15&&c.position.y<frame.center.y+.75&&c.velocity.length()<1;
   p.contact=contact?p.contact+dt:0;const was=p.pressed;p.pressed=p.contact>.12;p.load=p.pressed?(game.physics?.cargoBody?.mass??3.2):0;
   p.progress=damp(p.progress,Math.min(1,p.load/3),10,dt);m.update(p.progress);p.floor.y=m.getSupport().center.y;game.syncCollision(p.collider,m.getTopBox(),dt);
   if(was!==p.pressed)game.audio?.switch?.(p.pressed);
  });
  renders.push(alpha=>m.update(THREE.MathUtils.lerp(p.previousProgress,p.progress,alpha)));
  resetters.push(()=>{p.contact=p.load=p.progress=p.previousProgress=0;p.pressed=false;m.update(0);p.floor.y=m.getSupport().center.y;game.syncCollision(collider,m.getTopBox(),0);});return p;
 }
 function makeBridge(pad) {
  const art=game.addProp(30,11,[0,0,0]);art.userData.role='counterweight-crossing';
  const m=new LabCounterweightBridge(art,{raisedAngle:.75});m.update(1);art.position.sub(m.getSupport().center);m.update(1);
  const s=m.getSupport(),deck=game.collisionProxy(m.getDeckBox(),{kinematic:true}),weight=game.collisionProxy(m.getCounterweightBox(),{kinematic:true});
  m.getFrameBoxes().forEach(b=>game.collisionProxy(b));
  const f={minX:s.box.min.x,maxX:s.box.max.x,minZ:s.box.min.z,maxZ:s.box.max.z,y:0,enabled:false,mesh:deck.mesh};game.floors.push(f);
  const b={art,mechanism:m,floor:f,progress:0,previousProgress:0,angularVelocity:0,loaded:false,deckCollider:deck,weightCollider:weight};bridges.push(b);
  // Visible mechanical connection. It changes state with the load, not an unexplained decoration.
  const cable=world.box(pad.position.x/2,.04,3.8,Math.abs(pad.position.x),.04,.04,world.copper,false);
  updates.push(dt=>{
   b.previousProgress=b.progress;b.loaded=pad.load>=3;
   const occupied=b.progress>.94&&[game.playerPosition,game.cargo?.position].some(p=>inside(p,f,-.2)&&p.y>=-.1&&p.y<2.5);
   // Damped hinge response: inertia prevents an instantaneous binary bridge snap.
   const goal=b.loaded||occupied?1:0;b.angularVelocity+=(18*(goal-b.progress)-8.5*b.angularVelocity)*dt;
   b.progress=THREE.MathUtils.clamp(b.progress+b.angularVelocity*dt,0,1);if(Math.abs(b.progress-goal)<.0004&&Math.abs(b.angularVelocity)<.005){b.progress=goal;b.angularVelocity=0;}
   m.update(b.progress);const support=m.getSupport();f.enabled=support.enabled&&b.progress>.97;f.y=support.center.y;
   game.syncCollision(deck,f.enabled?new THREE.Box3(V(f.minX,f.y-.14,f.minZ),V(f.maxX,f.y,f.maxZ)):m.getDeckBox(),dt);game.syncCollision(weight,m.getCounterweightBox(),dt);
   cable.material=pad.pressed?world.light:world.copper;
   game.audio?.motor?.('bridge',Math.abs(b.angularVelocity));
  });
  renders.push(a=>m.update(THREE.MathUtils.lerp(b.previousProgress,b.progress,a)));
  resetters.push(()=>{b.progress=b.previousProgress=b.angularVelocity=0;b.loaded=false;m.update(0);f.enabled=false;game.syncCollision(deck,m.getDeckBox(),0);game.syncCollision(weight,m.getCounterweightBox(),0);});return b;
 }
 function makeRotating() {
  const art=game.addProp(28,7.8,[-5.5,0,-13],0,-Math.PI/2);art.userData.role='rotate-exit-velocity';
  const m=new LabRotatingPanel(art,{angle:Math.PI/6});m.update(0);art.position.y+=3.9-m.getPortalFrame().center.y;m.update(0);
  const collider=game.collisionProxy(m.getPanelBox(),{kinematic:true,aim:false});const fb=m.getFrameBox(),pb=m.getPanelBox();
  for(const b of [new THREE.Box3(fb.min.clone(),V(fb.max.x,pb.min.y-.06,fb.max.z)),new THREE.Box3(fb.min.clone(),V(fb.max.x,fb.max.y,pb.min.z)),new THREE.Box3(V(fb.min.x,fb.min.y,pb.max.z),fb.max.clone())])if(b.getSize(V()).toArray().every(x=>x>.01))game.collisionProxy(b,{aim:false});
  const meshes=[];m.panel.traverse(node=>{if(node.isMesh){Object.assign(node.userData,{portalable:true,tileKind:'ceramic',portalHostCollider:collider.mesh.uuid,portalFrame:()=>m.getPortalFrame()});game.portalPanels.push(node);game.aimBlockers.push(node);meshes.push(node);}});
  m.frame.traverse(node=>{if(node.isMesh)game.aimBlockers.push(node);});
  const terminal=game.addProp(22,1.7,[-7.7,0,8.3],0,Math.PI/2,{solid:true});terminal.userData.role='control-panel-tilt';terminals.push({art:terminal,position:terminal.position});
  const r={art,mechanism:m,collider,top:meshes[0],progress:0,previousProgress:0,activated:false,terminal};
  updates.push(dt=>{r.previousProgress=r.progress;r.progress=damp(r.progress,r.activated?1:0,2.4,dt);m.update(r.progress);game.syncCollision(collider,m.getPanelBox(),dt);});
  renders.push(a=>m.update(THREE.MathUtils.lerp(r.previousProgress,r.progress,a)));
  resetters.push(()=>{r.activated=false;r.progress=r.previousProgress=0;m.update(0);game.syncCollision(collider,m.getPanelBox(),0);});return r;
 }
 if(index===0) {
  bounds={minX:-8,maxX:8,minZ:-15,maxZ:12};spawn=[0,0,7.8];cargoSpawn=[-1.8,.55,5.2];world.shell(bounds,6.2);
  world.floor(-8,8,1.8,12);world.floor(-8,8,-15,-6.3);world.floor(-8,8,-6.3,1.8,-4);
  // The 8.1 m separation exceeds a running jump. Recovery uses the same portals, never checkpoints.
  points.entry=world.portalTile([-7.74,2.08,4.5],[1,0,0],{name:'near ceramic plate'});
  points.exit=world.portalTile([7.74,2.08,-9.6],[-1,0,0],{name:'far ceramic plate'});
  for(const x of [-6,6])world.rail(x,1.85,3.6,0);
  world.rail(0,-6.32,3.6,0);goal=world.goal({minX:-2,maxX:2,minZ:-14,maxZ:-11.2,y:0});
 } else if(index===1) {
  bounds={minX:-12,maxX:14,minZ:-11,maxZ:12};spawn=[-7,0,9];cargoSpawn=[-9.2,.55,7.6];world.shell(bounds,10.4);
  world.floor(-12,-3,-11,12);world.floor(-3,14,-11,12,-4);world.floor(3.3,14,-8.5,-1.5,0);
  const ramp=makeRamp(-9,-1.3,6.5,3.6);points.ramp=ramp;
  world.floor(-10.8,-7.2,-2.5,-1.3,3.55);
  points.entry=world.portalTile([-9,.18,-4.55],[0,1,0],{floor:true,width:4.3,height:4.3,name:'fall floor plate'});
  world.box(-5.5,4,-4.55,.36,8,5.0,world.metal);
  points.exit=world.portalTile([-5.29,5.5,-4.55],[1,0,0],{name:'horizontal velocity exit'});
  goal=world.goal({minX:9.8,maxX:13,minZ:-7.2,maxZ:-3,y:0});
  world.rail(10,-8.35,5.8,0);points.drop=[-9,3.55,-2.3];
 } else if(index===2||index===4) {
  const last=index===4;bounds={minX:-11,maxX:15,minZ:last?-18:-13,maxZ:13};spawn=[-5,0,10];cargoSpawn=[-7.1,.55,9.6];world.shell(bounds,last?12:13.5);
  const hole={minX:-7,maxX:-3,minZ:2,maxZ:6};world.floorExcept(-11,-1.8,bounds.minZ,13,0,[hole]);world.floor(-7,-3,2,6,-.25);
  world.floor(-1.8,15,bounds.minZ,13,-4);
  if(last){
   // A transverse control room makes the final workshop an L-shaped circuit,
   // not a recoloured copy of the vertical well. Its deck is a real route.
   world.floor(-1.8,15,7,13,0);spawn=[9,0,10.3];cargoSpawn=[6.8,.55,9.7];
   world.rail(6.5,7.06,11,0);
   world.wall('z',12.85,-1.8,15,0,4.8,-1);
  }
  lift=makeLift(-5,4,5.5);
  world.floor(-7,-3,-2.8,2,5.5);points.drop=[-5,5.5,-2.6];
  world.rail(-6.92,-.3,4.5,5.5,'z');world.rail(-3.08,-.3,4.5,5.5,'z');
  points.entry=world.portalTile([-5,.18,-4.85],[0,1,0],{floor:true,width:4.3,height:4.3,name:'lower gravitational plate'});
  if(last) {
   rotating=makeRotating();points.exit=rotating.top;
   world.floor(5.5,15,-17,-9.4,2.6);goal=world.goal({minX:9,maxX:13,minZ:-16.4,maxZ:-10,y:2.6});
   world.rail(12,-16.85,5,2.6);
  } else {
   world.box(-3.9,4.5,-9.5,.36,9,5.0,world.metal);
   points.exit=world.portalTile([-3.69,7.2,-9.5],[1,0,0],{name:'balcony velocity exit'});
   world.floor(5.4,15,-12.8,-6.1,3);goal=world.goal({minX:11,maxX:14,minZ:-12,maxZ:-7,y:3});world.rail(12,-12.65,5,3);
  }
 } else {
  bounds={minX:-10,maxX:10,minZ:-18,maxZ:14};spawn=[3.6,0,10.5];cargoSpawn=[1.5,.55,9.5];world.shell(bounds,8.4);
  world.floor(-10,10,3.1,14);world.floorExcept(-10,10,-18,-2.1,0,[{minX:-1.12,maxX:1.12,minZ:-3.10,maxZ:-2.1}]);world.floor(-10,10,-3.1,3.1,-4);
  const pad=makePad(-5.4,7.2),bridge=makeBridge(pad);points.entry=pad.top;points.bridge=bridge;
  points.exit=world.portalTile([9.74,2.08,-8.3],[-1,0,0],{name:'companion receiver'});
  world.wall('z',-11.2,-10,4.2,0,5.5,1); // Offset exit alcove makes the far bank a distinct workshop.
  goal=world.goal({minX:5.0,maxX:9,minZ:-17,maxZ:-13,y:0});
  for(const x of [-6.3,6.3])world.rail(x,3.09,5.8,0);
 }
 const level={version:8,index,title:`0${index+1} / ${info.title}`,bounds,spawn,cargoSpawn,world,points,goal,pads,bridges,terminals,lift,rotating,launchPad:null,
  get terminalActivated(){return !!rotating?.activated;},
  getLaunch:()=>null,
  cargoOnAnyPad:()=>pads.some(p=>p.pressed),
  nearbyInteraction:()=>rotating&&game.playerPosition.distanceTo(rotating.terminal.position)<2.4?{label:'E · повернуть выход'}:null,
  interact(){if(game.state!=='playing'||game.heldCube||!this.nearbyInteraction())return false;rotating.activated=!rotating.activated;game.audio?.switch?.(rotating.activated);game.animator?.trigger?.('curious');return true;},
  getObjective:()=>info.description,
  update(dt){time+=dt;for(const update of updates)update(dt);},
  renderUpdate(alpha=1){for(const render of renders)render(THREE.MathUtils.clamp(alpha,0,1));},
  reset(){time=0;for(const reset of resetters)reset();this.update(0);},
  isWon(){return inside(game.playerPosition,goal)&&inside(game.cargo?.position,goal,-.5)&&Math.abs(game.playerPosition.y-goal.y)<.15&&game.cargo.position.y>goal.y+.1&&game.cargo.position.y<goal.y+2&&game.playerPosition.distanceTo(game.cargo.position)<3.2;},
  diagnostics:()=>({version:8,level:index+1,name:info.title,mechanics:info.models,noCheckpoints:true,portalTiles:game.portalPanels.length,loadedWeight:pads.map(p=>p.load),bridge:bridges.map(b=>b.progress),liftY:lift?.y??null,rotated:rotating?.activated??false})};
 level.reset();return level;
}
