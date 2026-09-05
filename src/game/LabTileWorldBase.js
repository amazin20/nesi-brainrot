import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const Z = V(0,0,1);
/** Readable construction: charcoal structural tiles never accept portals.
 * Only ivory ceramic insets are registered. Seams are visual, not cracks in
 * collision. Every repeat shares geometry and is drawn with instancing. */
export class LabTileWorld {
  constructor(game, palette) {
    this.game = game; this.palette = palette; this.surfaces = []; this.floors = [];
    this.root = new THREE.Group(); this.root.name = 'Tiled architectural shell'; game.scene.add(this.root);
    this.tileGeometry = new RoundedBoxGeometry(1,1,.10,1,.022);
    this.materials = {
      wall: new THREE.MeshStandardMaterial({color:palette.wall,roughness:.88,metalness:.08}),
      floor: new THREE.MeshStandardMaterial({color:palette.floor,roughness:.83,metalness:.10}),
      ceramic: new THREE.MeshStandardMaterial({color:0xe4ebe7,roughness:.66,metalness:.03}),
      trim: new THREE.MeshStandardMaterial({color:0x273f4c,roughness:.62,metalness:.32}),
      accent: new THREE.MeshBasicMaterial({color:palette.accent}),
      lamp: new THREE.MeshBasicMaterial({color:0xfff0d1}),
    };
    this.templates = new Map();
  }
  box(position,size,material=this.materials.trim,solid=true,parent=this.root) {
    return this.game.box(...position,...size,material,{solid,parent});
  }
  template(id) {
    if(this.templates.has(id)) return this.templates.get(id);
    const model=this.game.model(id,1);model.updateWorldMatrix(true,true);
    const b=new THREE.Box3().setFromObject(model),s=b.getSize(V()),c=b.getCenter(V());
    const normalize=new THREE.Matrix4().makeScale(1/s.x,1/s.y,1/s.z).multiply(new THREE.Matrix4().makeTranslation(-c.x,-c.y,-c.z));
    if(id===23) normalize.premultiply(new THREE.Matrix4().makeRotationX(Math.PI/2));
    const parts=[];model.traverse(node=>{if(node.isMesh) parts.push({geometry:node.geometry,material:node.material,matrix:normalize.clone().multiply(node.matrixWorld)});});
    this.templates.set(id,parts);return parts;
  }
  /** Surface position is its front plane. Normal points into usable space. */
  surface({name='structural tiles',position,normal=[0,0,1],width,height,portal=false,kind='wall',parent=this.root,moving=false,authored=false}) {
    const n=V(...normal).normalize(),q=new THREE.Quaternion().setFromUnitVectors(Z,n),center=V(...position);
    const group=new THREE.Group();group.name=name;group.position.copy(center);group.quaternion.copy(q);parent.add(group);
    const cols=Math.ceil(width/2),rows=Math.ceil(height/2),cw=width/cols,ch=height/rows;
    const parts=authored ? this.template(kind==='floor'?23:24) : [{geometry:this.tileGeometry,material:portal?this.materials.ceramic:this.materials[kind],matrix:new THREE.Matrix4()}];
    for(const part of parts) {
      const instances=new THREE.InstancedMesh(part.geometry,part.material,cols*rows);
      instances.name=portal?'Ivory portal tiles':'Non-portal structural tiles';instances.userData.portalTile=portal;
      let i=0;
      for(let x=0;x<cols;x++) for(let y=0;y<rows;y++) {
        // Authored modules are normalized to a full unit-depth box; generic
        // tiles already have 10 cm depth. Both tops end at exactly -3 mm.
        const depth=authored ? .09 : 1;
        const m=new THREE.Matrix4().compose(V(-width/2+cw*(x+.5),-height/2+ch*(y+.5),-.053),new THREE.Quaternion(),V(cw-.035,ch-.035,depth)).multiply(part.matrix);
        instances.setMatrixAt(i++,m);
      }
      instances.computeBoundingBox();instances.computeBoundingSphere();instances.receiveShadow=true;group.add(instances);
    }
    // A dark recessed backing seals the seams. Its front is behind the tile
    // faces: no coincident surface, no lift-style z-fighting.
    const backing=this.game.box(0,0,-.105,width,height,.08,this.materials.trim,{parent:group,camera:false,aim:false});
    const mesh=this.game.box(0,0,-.10,width,height,.20,this.materials.trim,{parent:group,solid:false,camera:false,aim:false});
    mesh.visible=false;mesh.userData.collisionProxy=true;mesh.name=name+' / collision';
    group.updateWorldMatrix(true,true);
    const collider={mesh,box:new THREE.Box3().setFromObject(mesh),enabled:true,kinematic:moving};
    this.game.colliders.push(collider);this.game.cameraBlockers.push(mesh);this.game.aimBlockers.push(mesh);
    const getFrame=()=>{
      group.updateWorldMatrix(true,false);
      return {center:group.localToWorld(V()),normal:Z.clone().applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())),
        right:V(1,0,0).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())),
        up:V(0,1,0).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())),halfWidth:width/2,halfHeight:height/2};
    };
    if(portal) {
      const f=getFrame();this.game.markPortalSurface(mesh,f.center,f.normal,width/2,height/2);
      mesh.userData.center=f.center;mesh.userData.portalUp=f.up;
      if(moving) mesh.userData.portalFrame=getFrame;
      const trim=.045;
      for(const x of [-width/2,width/2])this.game.box(x,0,.008,trim,height+.06,.025,this.materials.accent,{parent:group,camera:false,aim:false});
    }
    const record={name,group,mesh,collider,portal,width,height,normal:n,getFrame,backing};this.surfaces.push(record);return record;
  }
  floor(x0,x1,z0,z1,y=0,{portal=false,name='floor',authored=false}={}) {
    const surface=this.surface({name,position:[(x0+x1)/2,y,(z0+z1)/2],normal:[0,1,0],width:x1-x0,height:z1-z0,kind:'floor',portal,authored});
    const f={minX:x0,maxX:x1,minZ:z0,maxZ:z1,y,mesh:surface.mesh,enabled:true};
    this.game.floors.push(f);this.floors.push(f);surface.floor=f;return surface;
  }
  walls({minX,maxX,minZ,maxZ},height,base=-.2) {
    const cy=(height+base)/2,h=height-base;
    this.surface({position:[minX,cy,(minZ+maxZ)/2],normal:[1,0,0],width:maxZ-minZ,height:h});
    this.surface({position:[maxX,cy,(minZ+maxZ)/2],normal:[-1,0,0],width:maxZ-minZ,height:h});
    this.surface({position:[(minX+maxX)/2,cy,minZ],width:maxX-minX,height:h});
    this.surface({position:[(minX+maxX)/2,cy,maxZ],normal:[0,0,-1],width:maxX-minX,height:h});
    // Roof beams carry the ceiling lights, leaving a readable skylight.
    for(let z=minZ+2;z<maxZ;z+=7) {
      this.box([(minX+maxX)/2,height+.18,z],[maxX-minX,.18,.22],this.materials.trim,false);
      this.box([(minX+maxX)/2,height+.075,z],[Math.min(6,maxX-minX-1),.025,.13],this.materials.lamp,false);
    }
  }
  patch(name,position,normal,width=4,height=4,parent=this.root,moving=false) {
    return this.surface({name,position,normal,width,height,portal:true,parent,moving,authored:true,kind:Math.abs(normal[1])>.9?'floor':'wall'});
  }
  stairs(x0,x1,z0,z1,low,high) {
    const count=Math.ceil((high-low)/.28),length=(z1-z0)/count;
    for(let i=0;i<count;i++)this.floor(x0,x1,z0+i*length,z0+(i+1)*length,low+(high-low)*(i+1)/count);
    // The tread's front faces seal the risers (not floating steps).
    for(let i=0;i<count;i++)this.box([(x0+x1)/2,low+(high-low)*(i+.5)/count,z0+i*length+.035],[x1-x0,(high-low)/count+.02,.07],this.materials.trim);
  }
  goal(position,size=[3.6,3.6]) {
    const [x,y,z]=position,mat=this.materials.accent;
    // Four inlaid corner brackets, rather than a central message or wall text.
    for(const sx of [-1,1])for(const sz of [-1,1]){
      this.box([x+sx*(size[0]/2-.4),y+.009,z+sz*size[1]/2],[.8,.018,.06],mat,false);
      this.box([x+sx*size[0]/2,y+.009,z+sz*(size[1]/2-.4)],[.06,.018,.8],mat,false);
    }
    const point=V(x,y,z);
    return {position:point,contains:p=>Math.abs(p.x-x)<size[0]/2&&Math.abs(p.z-z)<size[1]/2&&p.y>=y-.1&&p.y<y+2.6};
  }
}
