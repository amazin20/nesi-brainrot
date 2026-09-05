import * as THREE from 'three';
const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const material = color => new THREE.MeshStandardMaterial({color, roughness:.88, metalness:.08});

/** Construction geometry is also the collision/placement contract. A ceramic
 * portal tile is never merely a white decoration on an unmarked white wall. */
export class LabTileWorld {
  constructor(game, palette) {
    this.game=game; this.palette=palette; this.group=new THREE.Group();
    this.group.name='Modular tiled construction'; game.scene.add(this.group);
    this.metal=material(0x374954); this.wallMat=material(palette.wall); this.edge=material(0x22343e);
    this.copper=material(0xb89365); this.light=new THREE.MeshBasicMaterial({color:0x93ddce});
    this.unit=new THREE.BoxGeometry(1,1,1); this.plates=[]; this.usage=[];
    this.tile=game.model(23,1); this.tile.updateWorldMatrix(true,true);
    this.tileBox=new THREE.Box3().setFromObject(this.tile);
    this.tileSize=this.tileBox.getSize(V());
    this.tileCenter=this.tileBox.getCenter(V());
  }
  box(x,y,z,w,h,d,mat=this.metal,solid=true) {
    const mesh=new THREE.Mesh(this.unit,mat); mesh.position.set(x,y,z);mesh.scale.set(w,h,d);
    mesh.receiveShadow=true;this.group.add(mesh);mesh.updateWorldMatrix(true,false);
    if(solid) this.game.colliders.push({mesh,box:new THREE.Box3().setFromObject(mesh),enabled:true});
    if(solid){this.game.cameraBlockers.push(mesh);this.game.aimBlockers.push(mesh);}
    mesh.userData.portalForbidden=true;return mesh;
  }
  floor(x0,x1,z0,z1,y=0,{tint=this.palette.floor}={}) {
    if(x1-x0<.01||z1-z0<.01)return null;
    const mesh=this.box((x0+x1)/2,y-.15,(z0+z1)/2,x1-x0,.3,z1-z0);
    mesh.visible=false;mesh.userData.collisionProxy=true;
    const f={minX:x0,maxX:x1,minZ:z0,maxZ:z1,y,mesh,enabled:true};this.game.floors.push(f);
    const nx=Math.max(1,Math.ceil((x1-x0)/3.4)),nz=Math.max(1,Math.ceil((z1-z0)/3.4));
    const w=(x1-x0)/nx,d=(z1-z0)/nz;
    const normalize=new THREE.Matrix4().makeTranslation(-this.tileCenter.x,-this.tileBox.max.y,-this.tileCenter.z);
    this.tile.traverse(source=>{
      if(!source.isMesh)return;
      const mats=(Array.isArray(source.material)?source.material:[source.material]).map(m=>{
        const c=m.clone();c.color.setHex(tint);c.metalness=.06;c.roughness=.85;return c;
      });
      const inst=new THREE.InstancedMesh(source.geometry,Array.isArray(source.material)?mats:mats[0],nx*nz);
      const basis=normalize.clone().multiply(source.matrixWorld);
      let i=0;
      for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++) {
        const transform=new THREE.Matrix4().makeTranslation(x0+(ix+.5)*w,y,z0+(iz+.5)*d)
          .multiply(new THREE.Matrix4().makeScale((w-.024)/this.tileSize.x,.12/this.tileSize.y,(d-.024)/this.tileSize.z)).multiply(basis);
        inst.setMatrixAt(i,transform);inst.setColorAt(i++,new THREE.Color().setScalar(1-((ix*3+iz*7)%5)*.018));
      }
      inst.receiveShadow=true;inst.name='23 / walkable floor slabs';inst.userData.role='walkable-floor';
      inst.computeBoundingBox();inst.computeBoundingSphere();this.group.add(inst);
    });
    // Dark backing closes the joints below the visible tiles, without a second coplanar top.
    this.box((x0+x1)/2,y-.18,(z0+z1)/2,x1-x0,.12,z1-z0,this.edge,false);
    return f;
  }
  floorExcept(x0,x1,z0,z1,y,holes=[]) {
    let rects=[[x0,x1,z0,z1]];
    for(const h of holes) {
      const next=[];
      for(const [a,b,c,d] of rects) {
        const l=Math.max(a,h.minX),r=Math.min(b,h.maxX),n=Math.max(c,h.minZ),s=Math.min(d,h.maxZ);
        if(l>=r||n>=s){next.push([a,b,c,d]);continue;}
        next.push([a,l,c,d],[r,b,c,d],[l,r,c,n],[l,r,s,d]);
      }
      rects=next.filter(([a,b,c,d])=>b-a>.01&&d-c>.01);
    }
    return rects.map(r=>this.floor(...r,y));
  }
  wall(axis,p,a,b,bottom=0,top=7,normal=1) {
    const nx=Math.max(1,Math.ceil((b-a)/2.8)),ny=Math.max(1,Math.ceil((top-bottom)/2.8));
    const w=(b-a)/nx,h=(top-bottom)/ny;
    const slab=axis==='x'?this.box(p,(bottom+top)/2,(a+b)/2,.30,top-bottom,b-a,this.edge):
      this.box((a+b)/2,(bottom+top)/2,p,b-a,top-bottom,.30,this.edge);
    const instances=new THREE.InstancedMesh(this.unit,this.wallMat,nx*ny);
    const ribs=new THREE.InstancedMesh(this.unit,this.metal,nx*ny*2);let i=0,r=0;
    for(let x=0;x<nx;x++)for(let y=0;y<ny;y++) {
      const along=a+(x+.5)*w,up=bottom+(y+.5)*h;
      const position=axis==='x'?V(p+normal*.155,up,along):V(along,up,p+normal*.155);
      const size=axis==='x'?V(.09,h-.05,w-.05):V(w-.05,h-.05,.09);
      instances.setMatrixAt(i++,new THREE.Matrix4().compose(position,new THREE.Quaternion(),size));
      // Two recessed horizontal ribs distinguish forbidden surfaces by shape as well as colour.
      for(const t of [-.30,.30]) {
        const rp=position.clone();rp.y+=h*t;rp[axis]+=normal*.049;
        const rs=axis==='x'?V(.018,.033,w*.8):V(w*.8,.033,.018);
        ribs.setMatrixAt(r++,new THREE.Matrix4().compose(rp,new THREE.Quaternion(),rs));
      }
    }
    instances.receiveShadow=true;instances.name='Ribbed non-portal wall slabs';ribs.name='Non-portal surface ribs';
    instances.computeBoundingBox();instances.computeBoundingSphere();ribs.computeBoundingBox();ribs.computeBoundingSphere();
    this.group.add(instances,ribs);return slab;
  }
  shell(bounds,height) {
    const {minX,maxX,minZ,maxZ}=bounds;
    this.wall('x',minX-.15,minZ,maxZ,-4,height,1);this.wall('x',maxX+.15,minZ,maxZ,-4,height,-1);
    this.wall('z',minZ-.15,minX,maxX,-4,height,1);this.wall('z',maxZ+.15,minX,maxX,-4,height,-1);
    // Open skylights, with structural cross-beams and fixed lighting, not a white ceiling sheet.
    for(let z=minZ+1;z<maxZ;z+=7) {
      this.box((minX+maxX)/2,height,z,maxX-minX+.5,.22,.25,this.edge,false);
      this.box((minX+maxX)/2,height-.15,z,Math.min(9,maxX-minX-2),.035,.12,this.light,false);
    }
  }
  portalTile(center,normal,{width=4.1,height=4.3,name='ceramic',floor=false}={}) {
    const game=this.game,n=V(...normal),c=V(...center);
    const art=game.model(24,1),b=new THREE.Box3().setFromObject(art),s=b.getSize(V());
    art.scale.set(width/s.x,height/s.y,.12/s.z);
    // Fit the measured model into a plate-local group; its face is the only white material.
    const panel=new THREE.Group();panel.name='24 / '+name;panel.userData.role='portal-surface';
    art.updateWorldMatrix(true,true);const fitted=new THREE.Box3().setFromObject(art),mid=fitted.getCenter(V());
    art.position.sub(mid);art.position.z-=.062;panel.add(art);
    const up=floor?V(0,0,-1):V(0,1,0),right=up.clone().cross(n).normalize(),trueUp=n.clone().cross(right).normalize();
    panel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,trueUp,n));panel.position.copy(c);this.group.add(panel);
    const backing=new THREE.Mesh(new THREE.BoxGeometry(width,height,.14),this.metal);
    backing.position.z=-.07;backing.visible=false;backing.userData.collisionProxy=true;panel.add(backing);
    panel.updateWorldMatrix(true,true);
    const collider={mesh:backing,box:new THREE.Box3().setFromObject(backing),enabled:true};game.colliders.push(collider);
    game.aimBlockers.push(backing);game.cameraBlockers.push(backing);
    game.markPortalSurface(backing,c,n,width/2-.05,height/2-.05);backing.userData.portalUp=trueUp;
    backing.userData.tileKind='ceramic';backing.userData.portalForbidden=false;backing.name=name;
    // The bronze border is outside the placement bounds, never a hidden blocking rim.
    for(const [x,y,w,h] of [[-width/2-.065,0,.13,height+.26],[width/2+.065,0,.13,height+.26],[0,-height/2-.065,width,.13],[0,height/2+.065,width,.13]]) {
      const rim=new THREE.Mesh(this.unit,this.copper);rim.position.set(x,y,-.07);rim.scale.set(w,h,.16);panel.add(rim);
    }
    if(floor) game.floors.push({minX:c.x-width/2,maxX:c.x+width/2,minZ:c.z-height/2,maxZ:c.z+height/2,y:c.y,mesh:backing,enabled:true});
    this.plates.push(backing);this.usage.push({id:24,role:'portal-surface',name});return backing;
  }
  rail(x,z,length,y=0,along='x') {
    // The railing actually prevents side falls. The imported shape is visual;
    // one thin continuous collider avoids collisions with each small strut.
    const art=this.game.model(26,1),size=new THREE.Box3().setFromObject(art).getSize(V());
    art.scale.set(length/size.x,1.05/size.y,.13/size.z);art.position.set(x,y,z);if(along==='z')art.rotation.y=Math.PI/2;
    art.userData.role='fall-protection';this.group.add(art);art.updateWorldMatrix(true,true);
    const h=new THREE.Box3().setFromObject(art).getSize(V()).y;
    const proxy=along==='x'?this.box(x,y+h*.5,z,length,h,.13):this.box(x,y+h*.5,z,.13,h,length);
    proxy.visible=false;proxy.userData.collisionProxy=true;
    this.game.aimBlockers=this.game.aimBlockers.filter(m=>m!==proxy);
    art.traverse(m=>{if(m.isMesh)this.game.aimBlockers.push(m);});return art;
  }
  goal(bounds) {
    const x=(bounds.minX+bounds.maxX)/2,z=(bounds.minZ+bounds.maxZ)/2,y=bounds.y;
    const floorLight=new THREE.MeshBasicMaterial({color:0x74c7b3});
    // Two docking circles show that the player AND the companion must arrive.
    for(const dx of [-.70,.70]) {
      const ring=new THREE.Mesh(new THREE.TorusGeometry(.45,.035,6,36),floorLight);
      ring.rotation.x=Math.PI/2;ring.position.set(x+dx,y+.04,z);this.group.add(ring);
    }
    this.box(x,y+.018,bounds.minZ,bounds.maxX-bounds.minX,.025,.05,floorLight,false);
    return bounds;
  }
}
