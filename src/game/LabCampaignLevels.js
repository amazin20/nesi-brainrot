import * as THREE from 'three';
import { LabTileWorld } from './LabTileWorld.js';
import { LabPressurePlatform, LabRotatingPanel } from './LabArticulatedProps.js';
import { createArchitecturalGate } from './LabArchitecturalGate.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
export const CAMPAIGN = Object.freeze([
  {id:'two-banks',title:'Два берега',description:'Только движение и два связанных портала.',assets:[1,2,11,24],concept:'Связь пространства',
    hints:['Светлая керамика принимает портал. Тёмный металл — нет.','Один портал оставь на своём берегу, другой создай на дальнем.','Войди в ближний портал и подойди к другу в отмеченной зоне.']},
  {id:'return-path',title:'Обратный путь',description:'Вес открывает дверь. Портал возвращает друга.',assets:[1,2,11,24,29],concept:'Вес и независимый путь',
    hints:['Плита опускается только под свободно стоящим другом. На руках его вес не нажимает плиту.','Светлый центр нажимной плиты тоже принимает портал. Вход можно подготовить заранее.','Оставь один портал в плите, поставь друга, пройди дверь. За поворотом создай выход и забери его.']},
  {id:'fall-fling',title:'Падение — это разгон',description:'Высота превращается в скорость, а портал меняет её направление.',assets:[1,2,11,23,24],concept:'Сохранение скорости',
    hints:['Простой шаг в напольный портал не даст нужной скорости. Посмотри на высоту балкона.','Напольный вход принимает скорость падения; боковой выход превращает её в полёт.','Свяжи белую плиту внизу с боковой стеной. Возьми друга и упади в портал с верхнего края.']},
  {id:'moving-address',title:'Подвижный адрес',description:'Портал остаётся на своей плите, даже когда она движется.',assets:[1,2,11,24,19,22],concept:'Движущийся портал',
    hints:['Белая панель закреплена на подъёмнике. Портал поедет вместе с ней.','Терминал вызывает подъёмник вверх или вниз. Два положения устойчивы, спешить не нужно.','Создай портал на подъёмнике и на стене рядом. Подними его терминалом, возьми друга, войди в ближний портал.']},
  {id:'choose-angle',title:'Угол решает',description:'Соедини падение, поворот панели и выход на высокий остров.',assets:[1,2,11,23,28,22],concept:'Направление импульса',
    hints:['Высокий остров не достигается горизонтальным вылетом. Скорости мало без правильного направления.','Терминал наклоняет выходную панель. Портал должен смотреть немного вверх.','Подготовь вход на дне шахты и выход на поворотной панели. Наклони панель, возьми друга и упади во вход с балкона.']},
]);
const PALETTES=[
  {wall:0x507683,floor:0x597b85,accent:0x80e6d3,sky:0xc5dde2},
  {wall:0x526761,floor:0x788277,accent:0xffc678,sky:0xd6ddd0},
  {wall:0x3c526e,floor:0x526d87,accent:0x82cdf4,sky:0xb3cbdc},
  {wall:0x626575,floor:0x697786,accent:0xf1ba8b,sky:0xcdd7e6},
  {wall:0x566d76,floor:0x728481,accent:0xffdc89,sky:0xddd6c7},
];

/** Five authored layouts, not one room repeated with new props. No random
 * topology, progress checkpoints, fake gravity boosters, or invisible wins. */
export function buildLabCampaignLevel(game,index) {
  if(!Number.isInteger(index)||!CAMPAIGN[index])throw new RangeError('Unknown campaign course');
  const spec=CAMPAIGN[index],palette=PALETTES[index],world=new LabTileWorld(game,palette);
  game.scene.background=new THREE.Color(palette.sky);game.scene.fog=new THREE.Fog(palette.sky,48,105);
  game.materials.wall.color.setHex(palette.wall);game.materials.dark.color.setHex(0x304653);
  const panels={},pads=[],gates=[],terminals=[],moving=[],fixtures=[];
  let spawn,cargoSpawn,bounds,goal,lift=null,receiverPanel=null,time=0;
  const record=(role,id,art)=>{art.userData.gameplayRole=role;fixtures.push({role,id,art});return art;};
  const prop=(role,id,size,position,yaw=0)=>record(role,id,game.addProp(id,size,position,0,yaw));
  const patch=(name,position,normal,w=4,h=4)=>{const p=world.patch(name,position,normal,w,h);panels[name]=p;return p;};
  const sync=(collider,box,dt)=>{
    if(collider.box.min.distanceToSquared(box.min)+collider.box.max.distanceToSquared(box.max)<1e-14&&dt>0)return;
    game.syncCollision(collider,box,dt);
  };
  function terminal(position,action) {
    const art=prop('controls a moving mechanism',22,1.5,position);
    game.collisionProxy(new THREE.Box3().setFromObject(art));
    const t={position:V(...position).add(V(0,.8,0)),art,action};terminals.push(t);return t;
  }
  function pressure(x,y,z) {
    const art=prop('weight switch and floor-portal surface',29,5.7,[x,y,z]),mechanism=new LabPressurePlatform(art);
    art.position.y+=y+.2-mechanism.getPortalFrame().center.y;mechanism.update(0);
    const b=mechanism.getFrameBox(),top=mechanism.getTopBox();
    const regions=[new THREE.Box3(b.min.clone(),V(b.max.x,top.min.y-mechanism.pressTravel-.008,b.max.z)),
      new THREE.Box3(b.min.clone(),V(top.min.x,b.max.y,b.max.z)),new THREE.Box3(V(top.max.x,b.min.y,b.min.z),b.max.clone()),
      new THREE.Box3(V(top.min.x,b.min.y,b.min.z),V(top.max.x,b.max.y,top.min.z)),new THREE.Box3(V(top.min.x,b.min.y,top.max.z),V(top.max.x,b.max.y,b.max.z))];
    regions.forEach(b=>game.collisionProxy(b,{aim:false}));
    const collider=game.collisionProxy(top,{kinematic:true,aim:false});let surface;
    mechanism.top.traverse(mesh=>{if(mesh.isMesh){Object.assign(mesh.userData,{portalable:true,portalFrame:()=>mechanism.getPortalFrame()});game.portalPanels.push(mesh);game.aimBlockers.push(mesh);surface??=mesh;}});
    mechanism.frame.traverse(m=>{if(m.isMesh)game.aimBlockers.push(m);});
    const f={minX:top.min.x,maxX:top.max.x,minZ:top.min.z,maxZ:top.max.z,y:mechanism.getSupport().center.y,mesh:collider.mesh,enabled:true};game.floors.push(f);
    const p={art,mechanism,collider,position:V(x,y+.2,z),floor:f,top:surface,progress:0,previousProgress:0,pressed:false,contact:0};pads.push(p);return p;
  }
  const weighted=p=>!!game.cargo&&!game.heldCube&&game.cargoOnPad(p.mechanism.getPortalFrame().center,1.15);
  function doorway(z,pad,roomWidth=16,ceiling=6) {
    const g=createArchitecturalGate(game,{z,roomWidth,roomHeight:ceiling,constructWalls:false});
    for(const s of [-1,1])for(const front of [-1,1])world.surface({name:'gate surround',position:[s*(roomWidth/4+1.2),ceiling/2,z+front*.25],normal:[0,0,front],width:roomWidth/2-2.4,height:ceiling});
    for(const front of [-1,1])world.surface({name:'gate lintel',position:[0,(3.65+ceiling)/2,z+front*.25],normal:[0,0,front],width:4.8,height:ceiling-3.65});
    g.mechanism.getFrameBoxes().forEach(b=>game.collisionProxy(b));
    const leafColliders=g.mechanism.getLeafBoxes().map(b=>game.collisionProxy(b,{kinematic:true}));
    const cable=new THREE.Mesh(new THREE.BoxGeometry(.04,.018,Math.abs(pad.position.z-z)),new THREE.MeshBasicMaterial({color:palette.accent}));
    cable.position.set(pad.position.x,.014,(pad.position.z+z)/2);world.root.add(cable);
    const link=world.box([pad.position.x/2,.015,z+.4],[Math.abs(pad.position.x),.02,.04],cable.material,false);
    const value={...g,z,pad,cable,link,leafColliders,progress:0,previousProgress:0,opened:false};gates.push(value);return value;
  }
  function updateGate(g,dt) {
    g.previousProgress=g.progress;const was=g.opened;g.opened=g.pad.pressed;
    const occupied=[game.playerPosition,game.cargo?.position].some(p=>p&&Math.abs(p.x)<2.55&&Math.abs(p.z-g.z)<1.7);
    g.progress=THREE.MathUtils.damp(g.progress,g.opened||(g.progress>.72&&occupied)?1:0,4,dt);g.mechanism.update(g.progress,time);
    g.mechanism.getLeafBoxes().forEach((b,i)=>sync(g.leafColliders[i],b,dt));
    g.cable.material.color.setHex(g.opened?0x82e5cb:0xbfa779);
    if(was!==g.opened&&dt>0)game.audio?.mechanism?.(g.opened?'open':'close');
  }
  if(index===0) {
    bounds={minX:-6,maxX:6,minZ:-14,maxZ:15};spawn=[0,0,10];cargoSpawn=[0,.55,-11.5];
    world.walls(bounds,6,-3.5);world.floor(-6,6,4,15);world.floor(-6,6,-14,-4);world.floor(-6,6,-4,4,-3);
    world.stairs(3.5,5.8,.1,4.1,-3,0);
    patch('entry',[-5.8,2.1,9],[1,0,0]);patch('exit',[-5.8,2.1,-9],[1,0,0]);
    goal=world.goal([0,0,-11.5],[4.8,3.5]);
  } else if(index===1) {
    bounds={minX:-8,maxX:8,minZ:-16,maxZ:16};spawn=[3,0,11];cargoSpawn=[.2,.55,9];
    world.walls(bounds,6);world.floor(-8,8,-16,16);
    const pad=pressure(-4,0,5);doorway(0,pad);
    world.surface({name:'corner baffle',position:[-3,3,-4],width:10,height:6});
    world.surface({name:'corner baffle back',position:[-3,3,-4.22],normal:[0,0,-1],width:10,height:6});
    patch('receiver',[7.8,2.1,-9],[-1,0,0]);goal=world.goal([0,0,-12.5],[4.8,4.0]);
  } else if(index===2) {
    bounds={minX:-7,maxX:7,minZ:-10,maxZ:14};spawn=[0,5,8];cargoSpawn=[1.2,5.55,6.5];
    world.walls(bounds,10,-1);
    world.floor(-3,3,-2,14,0);world.floor(-3,3,2,14,5);
    // Recovery staircase climbs towards the balcony without reaching the exit island.
    for(let i=0;i<18;i++)world.floor(-6.5,-4,12-i*.5,12.5-i*.5,(i+1)*5/18);
    world.floor(-4,-3,3,4.5,5);world.floor(-6.5,-3,12.5,14,0);
    const input=patch('fall',[0,.018,0],[0,1,0],4,4);game.floors.push({minX:-2,maxX:2,minZ:-2,maxZ:2,y:.018,mesh:input.mesh,enabled:true});
    patch('fling',[-6.8,4.2,-5],[1,0,0],4,4);
    world.floor(.3,7,-8,-2.6,1);goal=world.goal([4.7,1,-5.2],[3.8,4]);
  } else if(index===3) {
    bounds={minX:-6,maxX:6,minZ:-16,maxZ:15};spawn=[0,0,9.5];cargoSpawn=[-1.4,.55,8];
    world.walls(bounds,11,-3);world.floor(-6,6,2,15);world.floor(-6,6,-16,-8,5);
    patch('entry',[-5.8,2.1,8],[1,0,0]);
    const group=new THREE.Group();group.name='Lift assembly / one interpolated transform';group.position.set(0,0,-6);game.scene.add(group);
    const art=record('moving support deck',19,game.model(19,4.8));
    const b=new THREE.Box3().setFromObject(art);art.position.y-=b.max.y;group.add(art);
    // Collision is invisible. The GLB is the ONLY visible deck surface.
    const mesh=game.box(0,-.11,0,4.8,.22,4,game.materials.dark,{parent:group,camera:false,aim:false});
    mesh.visible=false;mesh.userData.collisionProxy=true;group.updateWorldMatrix(true,true);
    const collider={mesh,box:new THREE.Box3().setFromObject(mesh),enabled:true,kinematic:true};game.colliders.push(collider);game.cameraBlockers.push(mesh);game.aimBlockers.push(mesh);
    const f={minX:-2.4,maxX:2.4,minZ:-8,maxZ:-4,y:0,mesh,enabled:true};game.floors.push(f);
    const aboard=world.patch('lift portal',[-2.20,2.10,0],[1,0,0],3.8,4,group,true);panels.lift=aboard;
    lift={group,art,mesh,collider,floor:f,position:V(0,0,-6),minY:0,maxY:5,y:0,previousY:0,target:0,panel:aboard};
    // Guide rails are supports, not separate interactables.
    for(const x of [-2.65,2.65])world.box([x,3,-7.7],[.14,10,.14]);
    terminal([3.5,0,6],()=>{lift.target=lift.target>0?0:5;game.audio?.mechanism?.('switch');});
    goal=world.goal([0,5,-12.5],[4.6,4]);
  } else {
    bounds={minX:-11,maxX:8,minZ:-10,maxZ:14};spawn=[-6,5,-3];cargoSpawn=[-4.8,5.55,-2];
    world.walls(bounds,11,-1);world.floor(-11,-3,-10,9,0);world.floor(-9,-3,-10,3,5);
    for(let i=0;i<18;i++)world.floor(-10.8,-9,5.5-i*.5,6-i*.5,(i+1)*5/18);
    world.floor(-10.8,-9,-3.5,-2.8,5);
    const input=patch('fall',[-6,.018,5],[0,1,0],4,4);game.floors.push({minX:-8,maxX:-4,minZ:3,maxZ:7,y:.018,mesh:input.mesh,enabled:true});
    const art=prop('changes exit momentum direction',28,7.5,[3,0,-5],Math.PI);
    const mechanism=new LabRotatingPanel(art,{angle:Math.PI*35/180});
    // Align the hinge's portal face with the desired launch origin.
    art.position.add(V(3,4.2,-5).sub(mechanism.getPortalFrame().center));mechanism.update(0);
    const fb=mechanism.getFrameBox(),pb=mechanism.getPanelBox();
    // The bearing frame sits on a physical foundation, never suspended in air.
    if(fb.min.y>0.01)world.box([(fb.min.x+fb.max.x)/2,fb.min.y/2,(fb.min.z+fb.max.z)/2],
      [fb.max.x-fb.min.x+.16,fb.min.y,fb.max.z-fb.min.z+.16]);
    const frameCollider=[
      new THREE.Box3(fb.min.clone(),V(fb.max.x,pb.min.y-.02,fb.max.z)),
      new THREE.Box3(V(fb.min.x,pb.min.y,fb.min.z),V(pb.min.x,fb.max.y,fb.max.z)),
      new THREE.Box3(V(pb.max.x,pb.min.y,fb.min.z),fb.max.clone()),
    ].map(b=>game.collisionProxy(b,{aim:false}));
    const collider=game.collisionProxy(pb,{kinematic:true,aim:false});
    collider.frontPlane=()=>mechanism.getPortalFrame();
    const portalMeshes=[];
    mechanism.panel.traverse(m=>{if(m.isMesh){Object.assign(m.userData,{portalable:true,portalColliderId:collider.mesh.uuid,portalFrame:()=>mechanism.getPortalFrame()});game.portalPanels.push(m);game.aimBlockers.push(m);portalMeshes.push(m);}});
    mechanism.frame.traverse(m=>{if(m.isMesh)game.aimBlockers.push(m);});
    receiverPanel={art,mechanism,collider,frameCollider,portalMeshes,progress:0,previousProgress:0,target:0};
    terminal([-7,5,-5],()=>{receiverPanel.target=receiverPanel.target?0:1;game.audio?.mechanism?.('switch');});
    world.floor(-.2,7,4.5,13.8,3.5);goal=world.goal([3,3.5,9.7],[4.4,4.5]);
  }
  function update(dt) {
    time+=dt;
    for(const p of pads) {
      p.previousProgress=p.progress;p.contact=weighted(p)?p.contact+dt:0;
      const before=p.pressed;if(dt>0)p.pressed=p.contact>.12;
      p.progress=THREE.MathUtils.damp(p.progress,p.pressed?1:0,10,dt);p.mechanism.update(p.progress);
      p.floor.y=p.mechanism.getSupport().center.y;sync(p.collider,p.mechanism.getTopBox(),dt);
      if(before!==p.pressed&&dt>0)game.audio?.mechanism?.('switch');
    }
    gates.forEach(g=>updateGate(g,dt));
    if(lift) {
      const next=THREE.MathUtils.damp(lift.y,lift.target,1.25,dt);
      if(game.physics)game.moveMechanism(lift,Math.abs(next-lift.target)<.002?lift.target:next,dt);
      lift.panel.group.updateWorldMatrix(true,true);lift.panel.collider.box.setFromObject(lift.panel.mesh);
      game.physics?.updateStaticBox(lift.panel.mesh.uuid,lift.panel.collider.box,dt);
      game.audio?.motor?.(Math.abs(lift.y-lift.target)>.01);
    }
    if(receiverPanel) {
      const p=receiverPanel;p.previousProgress=p.progress;p.progress=THREE.MathUtils.damp(p.progress,p.target,3,dt);p.mechanism.update(p.progress);
      sync(p.collider,p.mechanism.getPanelBox(),dt);
    }
  }
  function reset() {
    time=0;pads.forEach(p=>{p.progress=p.previousProgress=p.contact=0;p.pressed=false;p.mechanism.update(0);});
    gates.forEach(g=>{g.progress=g.previousProgress=0;g.opened=false;g.mechanism.update(0);});
    if(lift){lift.y=lift.previousY=lift.target=0;lift.group.position.y=0;lift.floor.y=0;}
    if(receiverPanel){receiverPanel.progress=receiverPanel.previousProgress=receiverPanel.target=0;receiverPanel.mechanism.update(0);}
    update(0);
  }
  function renderUpdate(alpha=1) {
    pads.forEach(p=>p.mechanism.update(THREE.MathUtils.lerp(p.previousProgress,p.progress,alpha)));
    gates.forEach(g=>g.mechanism.update(THREE.MathUtils.lerp(g.previousProgress,g.progress,alpha),time));
    if(lift)lift.group.position.y=THREE.MathUtils.lerp(lift.previousY,lift.y,alpha);
    if(receiverPanel)receiverPanel.mechanism.update(THREE.MathUtils.lerp(receiverPanel.previousProgress,receiverPanel.progress,alpha));
  }
  const near=()=>terminals.find(t=>game.playerPosition.clone().add(V(0,.9,0)).distanceTo(t.position)<2.3);
  reset();
  return {id:spec.id,title:`0${index+1} / ${spec.title.toUpperCase()}`,index,bounds,spawn,cargoSpawn,world,structure:world.root,panels,pads,gates,lift,receiverPanel,fixtures,
    floors:world.floors,bridges:[],terminals,launchPad:null,momentum:true,update,reset,renderUpdate,
    interact:()=>{const t=near();if(!t)return false;t.action();return true;},nearbyInteraction:()=>near()?{label:'E',kind:index===3?'lift':'angle'}:null,
    getLaunch:()=>null,cargoOnAnyPad:()=>pads.some(weighted),getObjective:()=>spec.description,
    isWon:()=>game.playerGrounded&&goal.contains(game.playerPosition)&&!!game.cargo&&goal.contains(game.cargo.position)&&game.playerPosition.distanceTo(game.cargo.position)<3.3,
    goal,hints:spec.hints,diagnostics:()=>({level:index+1,id:spec.id,noCheckpoints:true,concept:spec.concept,tiledSurfaces:world.surfaces.length,
      portalSurfaces:game.portalPanels.length,fixtures:fixtures.map(f=>({id:f.id,role:f.role})),liftY:lift?.y??null,panelAngle:receiverPanel?.progress*35||0,
      gates:gates.map(g=>({opened:g.opened,progress:g.progress})),goal:goal.position.toArray()})};
}
