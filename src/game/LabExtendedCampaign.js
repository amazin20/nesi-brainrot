import * as THREE from 'three';
import { LabTileWorld } from './LabTileWorld.js';
import { LabPressurePlatform, LabRotatingPanel } from './LabArticulatedProps.js';
import { createArchitecturalGate } from './LabArchitecturalGate.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);

export const EXTENDED_CAMPAIGN=Object.freeze([
 {id:'borrowed-height',title:'Высота взаймы',description:'Подними адрес выхода, затем верни источник подъёмной силы.',assets:[1,2,11,19,24,29],concept:'Нагрузка, высота и независимый путь',
  hints:['Друг на плите поднимает лифт. Снятие нагрузки опускает его — это не сохранённое нажатие.','Сначала перейди через поднятый портал на неподвижную галерею. Найди за перегородками место для нового выхода.','Замени выход лифта порталом за перегородками. Вернись к краю галереи и создай вход под другом; затем забери его за поворотом.']},
 {id:'impulse-relay',title:'Эстафета импульса',description:'Два разгона, два направления и одна портальная пара.',assets:[1,2,11,22,23,24,28],concept:'Повторное использование импульса',
  hints:['Первая площадка — не выход. За проходом находится вторая шахта.','Перед каждым перелётом подготовь и наклон, и оба портала. С другом на руках стрелять нельзя.','Пройди первую шахту с другом. На промежуточном балконе поставь его, настрой новую пару и вторую панель, затем повтори разгон.']},
 {id:'three-debts',title:'Три долга',description:'Два шлюза и лифт. Один друг — три разные нагрузки.',assets:[1,2,11,19,24,29],concept:'Обратимые физические цепи',
  hints:['Оставленный груз нужен дальше. Ни один механизм не запоминает его вес.','За каждым шлюзом есть новый приёмник. Найди его, затем вернись к месту, откуда видна грузовая плита.','Дважды открой шлюз весом друга и верни его через напольный портал. В последней секции используй груз для подъёма выхода, а друга забери уже с верхней галереи.']},
 {id:'price-of-height',title:'Цена высоты',description:'Сначала получить высоту. Потом сохранить её в траектории.',assets:[1,2,11,19,22,23,24,28,29],concept:'Высота как ресурс',
  hints:['Поднятый лифт — промежуточный этап, а не финиш. Друг должен покинуть нижнюю плиту.','Забери друга на неподвижную галерею, прежде чем готовить дальний перелёт.','С верхней галереи верни груз через независимую пару. За проходом оставь друга на балконе, настрой наклонённый выход и вход внизу; затем перенеси обоих одним падением.']},
 {id:'route-architect',title:'Архитектор маршрута',description:'Два шлюза, подъём, две шахты. Построй весь маршрут сам.',assets:[1,2,11,19,22,23,24,28,29],concept:'Составная пространственная система',
  hints:['Рассматривай каждую секцию как долг: открыл путь весом — верни друга, прежде чем двигаться дальше.','Здесь одна портальная пара на весь маршрут. Переноси её только после того, как оба оказались на устойчивой стороне.','Верни друга после каждого из двух шлюзов, затем после грузового лифта. Пройди две шахты по очереди: сначала настрой вход и угол выхода, потом бери друга и используй падение.']},
]);

/** Larger authored chambers use the same rigid bodies and portal rules as 1–5.
 * Stage data describes space for tests and hints; it is never a win-condition
 * checklist. Doors and lifts respond to the live weight, not progress flags. */
export function buildExtendedCampaign(game,index){
 const spec=EXTENDED_CAMPAIGN[index-5];if(!spec)throw new RangeError('Unknown extended level');
 const colors=[0x81d5ca,0x9ab8ed,0xeac086,0x9ed39b,0xd1b2eb];
 const world=new LabTileWorld(game,{wall:0x464a50,floor:0x697176,accent:colors[index-5],sky:0x555963});
 const pads=[],gates=[],lifts=[],rotators=[],terminals=[],fixtures=[],panels={},stages=[],extents=[];
 let clock=0;
 const record=(id,role,art)=>{art.userData.gameplayRole=role;fixtures.push({id,role,art});return art;};
 const sync=(c,b,dt)=>{if(c.box.min.distanceToSquared(b.min)+c.box.max.distanceToSquared(b.max)>1e-14||!dt)game.syncCollision(c,b,dt);};
 function patch(name,position,normal,w=4,h=4,parent=world.root,moving=false){
  const p=world.patch(name,position,normal,w,h,parent,moving);panels[name]=p;return p;
 }
 function screen(z,left,right,bottom,top,gapLeft,gapRight,gapTop){
  const strip=(x0,x1,y0,y1)=>{if(x1-x0<.01||y1-y0<.01)return;
   for(const sign of [-1,1])world.surface({name:'Solid tiled partition',position:[(x0+x1)/2,(y0+y1)/2,z+sign*.14],normal:[0,0,sign],width:x1-x0,height:y1-y0});};
  strip(left,gapLeft,bottom,top);strip(gapRight,right,bottom,top);strip(gapLeft,gapRight,gapTop,top);
 }
 function baffle(z,y,rightGap){
  screen(z,-8,8,y-.24,y+8.5,rightGap?3:-8,rightGap?8:-3,y+8.5);
 }
 function pressure(x,y,z){
  const art=record(29,'Live load and recoverable floor portal',game.addProp(29,5.7,[x,y,z],0,0));
  const mechanism=new LabPressurePlatform(art);art.position.y+=y+.2-mechanism.getPortalFrame().center.y;mechanism.update(0);
  const b=mechanism.getFrameBox(),t=mechanism.getTopBox();
  const boxes=[new THREE.Box3(b.min.clone(),V(b.max.x,t.min.y-mechanism.pressTravel-.008,b.max.z)),
   new THREE.Box3(b.min.clone(),V(t.min.x,b.max.y,b.max.z)),new THREE.Box3(V(t.max.x,b.min.y,b.min.z),b.max.clone()),
   new THREE.Box3(V(t.min.x,b.min.y,b.min.z),V(t.max.x,b.max.y,t.min.z)),new THREE.Box3(V(t.min.x,b.min.y,t.max.z),V(t.max.x,b.max.y,b.max.z))];
  boxes.forEach(box=>game.collisionProxy(box,{aim:false}));
  const collider=game.collisionProxy(t,{kinematic:true,aim:false});
  mechanism.top.traverse(m=>{if(m.isMesh){Object.assign(m.userData,{portalable:true,portalFrame:()=>mechanism.getPortalFrame()});game.portalPanels.push(m);game.aimBlockers.push(m);}});
  mechanism.frame.traverse(m=>{if(m.isMesh)game.aimBlockers.push(m);});
  const floor={minX:t.min.x,maxX:t.max.x,minZ:t.min.z,maxZ:t.max.z,y:y+.2,mesh:collider.mesh,enabled:true};game.floors.push(floor);
  const p={art,mechanism,collider,floor,position:V(x,y+.2,z),progress:0,previousProgress:0,pressed:false,contact:0};pads.push(p);return p;
 }
 const weighted=p=>!!game.cargo&&!game.heldCube&&game.cargoOnPad(p.mechanism.getPortalFrame().center,1.15);
 function cable(p,to){
  const a=p.position,b=V(...to),mid=V(b.x,a.y,b.z);
  const material=new THREE.MeshBasicMaterial({color:0xbfa779});
  for(const [s,e] of [[a,V(a.x,a.y,b.z)],[V(a.x,a.y,b.z),mid]]){
   const d=e.clone().sub(s);world.box(s.clone().add(e).multiplyScalar(.5).toArray(),[Math.abs(d.x)+.04,.026,Math.abs(d.z)+.04],material,false);
  }return material;
 }
 function addGate(z){
  const y=0,pad=pressure(-4,y,z+5);
  world.floor(-8,8,z-24,z+14,y);extents.push([-8,8,z-24,z+14,9]);
  const g=createArchitecturalGate(game,{z,roomWidth:16,roomHeight:9,constructWalls:false,floorY:y});
  screen(z,-8,8,y-.2,y+9,-2.4,2.4,y+3.65);
  g.mechanism.getFrameBoxes().forEach(b=>game.collisionProxy(b));
  const leafColliders=g.mechanism.getLeafBoxes().map(b=>game.collisionProxy(b,{kinematic:true}));
  gates.push({...g,pad,z,progress:0,previousProgress:0,opened:false,leafColliders,cable:cable(pad,[0,y,z+.5])});
  baffle(z-4,y,true);baffle(z-8,y,false);
  const receiver=patch(`gate-${stages.length}-receiver`,[7.8,y+2.1,z-13],[-1,0,0]);
  const stage={type:'gate',z,y,pad,receiver,end:V(0,y,z-20)};stages.push(stage);return stage;
 }
 function addLift(z){
  const y=0,pad=pressure(-4,y,z+7);
  world.floor(-8,8,z+2,z+14,0);world.floor(-8,8,z-24,z-8,5);extents.push([-8,8,z-24,z+14,14]);
  const entry=patch(`lift-${stages.length}-entry`,[-7.8,2.1,z+10],[1,0,0]);
  const group=new THREE.Group();group.name='Load-driven elevator';group.position.set(0,0,z-6);game.scene.add(group);
  const art=record(19,'Elevator carries its attached portal',game.model(19,4.8));art.position.y-=new THREE.Box3().setFromObject(art).max.y;group.add(art);
  const mesh=game.box(0,-.11,0,4.8,.22,4,game.materials.dark,{parent:group,camera:false,aim:false});mesh.visible=false;mesh.userData.collisionProxy=true;group.updateWorldMatrix(true,true);
  const collider={mesh,box:new THREE.Box3().setFromObject(mesh),enabled:true,kinematic:true};game.colliders.push(collider);game.cameraBlockers.push(mesh);game.aimBlockers.push(mesh);
  const floor={minX:-2.4,maxX:2.4,minZ:z-8,maxZ:z-4,y:0,mesh,enabled:true};game.floors.push(floor);
  const panel=patch(`lift-${stages.length}-moving`,[-2.2,2.1,0],[1,0,0],3.8,4,group,true);
  const lift={group,art,mesh,collider,floor,panel,pad,minY:0,maxY:5,y:0,previousY:0,target:0,cable:cable(pad,[0,0,z+2])};lifts.push(lift);
  for(const x of [-2.65,2.65])world.box([x,4,z-7.7],[.16,10,.16]);
  baffle(z-10,5,true);baffle(z-14,5,false);
  const receiver=patch(`lift-${stages.length}-receiver`,[7.8,7.1,z-19],[-1,0,0]);
  const stage={type:'lift',z,y,pad,lift,entry,receiver,end:V(0,5,z-21)};stages.push(stage);return stage;
 }
 /** Reuses the proven five-metre well, with a minimum 8.8 m lateral gap.
  * The next well is isolated by an opaque partition with a walkable dog-leg. */
 function addFling(origin=[0,0,0],reverse=false){
  const [ox,oy,oz]=origin,s=reverse?-1:1;
  const point=(x,y,z)=>V(ox+s*x,oy+y,oz+s*z);
  const floor=(x0,x1,z0,z1,y)=>world.floor(Math.min(ox+s*x0,ox+s*x1),Math.max(ox+s*x0,ox+s*x1),Math.min(oz+s*z0,oz+s*z1),Math.max(oz+s*z0,oz+s*z1),oy+y);
  floor(-11,-3,-10,9,0);floor(-9,-3,-10,3,5);
  for(let i=0;i<18;i++)floor(-10.8,-9,5.5-i*.5,6-i*.5,(i+1)*5/18);
  floor(-10.8,-9,-3.5,-2.8,5);
  const input=patch(`fling-${stages.length}-fall`,point(-6,.018,5).toArray(),[0,1,0],4,4);
  const c=point(-6,.018,5);game.floors.push({minX:c.x-2,maxX:c.x+2,minZ:c.z-2,maxZ:c.z+2,y:c.y,mesh:input.mesh,enabled:true});
  const art=record(28,'Hinged panel redirects gravity momentum',game.addProp(28,7.5,point(9,0,-5).toArray(),0,reverse?0:Math.PI));
  const mechanism=new LabRotatingPanel(art,{angle:Math.PI*35/180});art.position.add(point(9,4.2,-5).sub(mechanism.getPortalFrame().center));mechanism.update(0);
  const fb=mechanism.getFrameBox(),pb=mechanism.getPanelBox();
  world.box([(fb.min.x+fb.max.x)/2,oy+(fb.min.y-oy)/2,(fb.min.z+fb.max.z)/2],[fb.max.x-fb.min.x+.16,Math.max(.1,fb.min.y-oy),fb.max.z-fb.min.z+.16]);
  const frameBoxes=[new THREE.Box3(fb.min.clone(),V(fb.max.x,pb.min.y-.02,fb.max.z)),new THREE.Box3(V(fb.min.x,pb.min.y,fb.min.z),V(pb.min.x,fb.max.y,fb.max.z)),new THREE.Box3(V(pb.max.x,pb.min.y,fb.min.z),fb.max.clone())];
  frameBoxes.forEach(b=>game.collisionProxy(b,{aim:false}));const collider=game.collisionProxy(pb,{kinematic:true,aim:false});collider.frontPlane=()=>mechanism.getPortalFrame();
  mechanism.panel.traverse(m=>{if(m.isMesh){Object.assign(m.userData,{portalable:true,portalColliderId:collider.mesh.uuid,portalFrame:()=>mechanism.getPortalFrame()});game.portalPanels.push(m);game.aimBlockers.push(m);}});
  mechanism.frame.traverse(m=>{if(m.isMesh)game.aimBlockers.push(m);});
  const rotator={art,mechanism,collider,target:0,progress:0,previousProgress:0};rotators.push(rotator);
  const at=point(-7,5,-5),terminalArt=record(22,'Adjusts the launch direction',game.addProp(22,1.5,at.toArray(),0,reverse?Math.PI:0));game.collisionProxy(new THREE.Box3().setFromObject(terminalArt));
  terminals.push({position:at.clone().add(V(0,.8,0)),action:()=>{rotator.target=rotator.target?0:1;game.audio?.mechanism?.('switch');},art:terminalArt,kind:'angle',rotator});
  floor(5.8,13,4.5,13,3.5);
  extents.push([Math.min(ox-11*s,ox+14*s),Math.max(ox-11*s,ox+14*s),Math.min(oz-10*s,oz+13*s),Math.max(oz-10*s,oz+13*s),oy+13]);
  const stage={type:'fling',point,origin,reverse,input,rotator,end:point(9,3.5,10),sourceY:oy+5,landingY:oy+3.5};stages.push(stage);return stage;
 }
 function divideFlings(stage){
  const [ox,oy,oz]=stage.origin,s=stage.reverse?-1:1,z=oz+s*13;
  const x=ox+s*9;screen(z,ox-29,ox+29,oy-2,oy+13,x-3,x+3,oy+7.3);
 }
 let spawn,cargoSpawn,last;
 if(index===5){last=addLift(0);spawn=[3,0,11];cargoSpawn=[.2,.55,10];}
 if(index===6){spawn=[-6,5,-3];cargoSpawn=[-4.8,5.55,-2];const first=addFling();divideFlings(first);last=addFling([15,-1.5,23]);}
 if(index===7){addGate(0);addGate(-38);last=addLift(-76);spawn=[3,0,11];cargoSpawn=[.2,.55,10];}
 if(index===8||index===9){
  let z=0;if(index===9){addGate(0);addGate(-38);z=-76;}
  addLift(z);spawn=[3,0,11];cargoSpawn=[.2,.55,10];
  // Sealed interface: only the common floor-height doorway joins the cells.
  screen(z-24,-28,15,-2,19,-3,3,8.8);
  last=addFling([-6,0,z-34],true);
  if(index===9){divideFlings(last);last=addFling([-21,-1.5,z-57],true);}
 }
 const bounds={minX:Math.min(...extents.map(e=>e[0]))-.2,maxX:Math.max(...extents.map(e=>e[1]))+.2,minZ:Math.min(...extents.map(e=>e[2])),maxZ:Math.max(...extents.map(e=>e[3]))};
 const ceiling=Math.max(...extents.map(e=>e[4]));world.walls(bounds,ceiling,-5);
 game.scene.background=new THREE.Color(world.palette.sky);game.scene.fog=new THREE.Fog(world.palette.sky,48,145);
 const goal=world.goal(last.end.toArray(),[4.4,4.4]);
 function update(dt){
  clock+=dt;
  for(const p of pads){p.previousProgress=p.progress;p.contact=weighted(p)?p.contact+dt:0;const before=p.pressed;if(dt>0)p.pressed=p.contact>.12;
   p.progress=THREE.MathUtils.damp(p.progress,p.pressed?1:0,10,dt);p.mechanism.update(p.progress);p.floor.y=p.mechanism.getSupport().center.y;sync(p.collider,p.mechanism.getTopBox(),dt);
   if(before!==p.pressed&&dt>0){game.audio?.mechanism?.('switch');game.companionAnimator?.trigger?.('nod');}}
  for(const g of gates){g.previousProgress=g.progress;const before=g.opened;g.opened=g.pad.pressed;
   const occupied=[game.playerPosition,game.cargo?.position].some(p=>p&&Math.abs(p.x)<2.55&&Math.abs(p.z-g.z)<1.7);
   g.progress=THREE.MathUtils.damp(g.progress,g.opened||(g.progress>.72&&occupied)?1:0,4,dt);g.mechanism.update(g.progress,clock);g.mechanism.getLeafBoxes().forEach((b,i)=>sync(g.leafColliders[i],b,dt));
   g.cable.color.setHex(g.opened?0x82e5cb:0xbfa779);if(before!==g.opened&&dt>0)game.audio?.mechanism?.(g.opened?'open':'close');}
  for(const l of lifts){l.target=l.pad.pressed?l.maxY:l.minY;const next=THREE.MathUtils.damp(l.y,l.target,1.25,dt);if(game.physics)game.moveMechanism(l,Math.abs(next-l.target)<.002?l.target:next,dt);
   l.panel.group.updateWorldMatrix(true,true);l.panel.collider.box.setFromObject(l.panel.mesh);game.physics?.updateStaticBox(l.panel.mesh.uuid,l.panel.collider.box,dt);l.cable.color.setHex(l.pad.pressed?0x82e5cb:0xbfa779);}
  game.audio?.motor?.(lifts.some(l=>Math.abs(l.y-l.target)>.015));
  for(const p of rotators){p.previousProgress=p.progress;p.progress=THREE.MathUtils.damp(p.progress,p.target,3,dt);p.mechanism.update(p.progress);sync(p.collider,p.mechanism.getPanelBox(),dt);}
 }
 function reset(){clock=0;for(const p of pads){p.progress=p.previousProgress=p.contact=0;p.pressed=false;p.mechanism.update(0);}
  for(const g of gates){g.progress=g.previousProgress=0;g.opened=false;g.mechanism.update(0);}
  for(const l of lifts){l.y=l.previousY=l.target=l.minY;l.group.position.y=l.minY;l.floor.y=l.minY;}
  for(const p of rotators){p.progress=p.previousProgress=p.target=0;p.mechanism.update(0);}update(0);}
 function renderUpdate(alpha=1){for(const p of pads)p.mechanism.update(THREE.MathUtils.lerp(p.previousProgress,p.progress,alpha));for(const g of gates)g.mechanism.update(THREE.MathUtils.lerp(g.previousProgress,g.progress,alpha),clock);
  for(const l of lifts)l.group.position.y=THREE.MathUtils.lerp(l.previousY,l.y,alpha);for(const p of rotators)p.mechanism.update(THREE.MathUtils.lerp(p.previousProgress,p.progress,alpha));}
 const near=()=>terminals.find(t=>game.playerPosition.clone().add(V(0,.9,0)).distanceTo(t.position)<2.3);reset();
 return {id:spec.id,title:`${index+1} / ${spec.title}`,index,bounds,spawn,cargoSpawn,world,structure:world.root,panels,pads,gates,lifts,rotators,stages,fixtures,terminals,lift:lifts[0]||null,receiverPanel:rotators[0]||null,
  floors:world.floors,bridges:[],launchPad:null,momentum:true,goal,hints:spec.hints,update,reset,renderUpdate,
  interact:()=>{const t=near();if(!t)return false;t.action();return true;},nearbyInteraction:()=>near()?{label:'E',kind:'angle'}:null,
  getLaunch:()=>null,cargoOnAnyPad:()=>pads.some(weighted),getObjective:()=>spec.description,
  isWon:()=>game.playerGrounded&&goal.contains(game.playerPosition)&&!!game.cargo&&goal.contains(game.cargo.position)&&game.playerPosition.distanceTo(game.cargo.position)<3.3,
  diagnostics:()=>({level:index+1,id:spec.id,noCheckpoints:true,stages:stages.length,concept:spec.concept,tiledSurfaces:world.surfaces.length,portalSurfaces:game.portalPanels.length,fixtures:fixtures.map(f=>({id:f.id,role:f.role})),lifts:lifts.map(l=>l.y),gates:gates.map(g=>g.opened),goal:goal.position.toArray()})};
}
