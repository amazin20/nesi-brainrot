import * as THREE from 'three';
import {LabTileWorld as StructuralWorld} from './LabTileWorldBase.js';

const FINISHES=new Map([
 [0x507683,{wall:0x51565a,floor:0x74797d,sky:0x4d555b}],
 [0x526761,{wall:0x424b48,floor:0x656d65,sky:0x465049}],
 [0x3c526e,{wall:0x3d4653,floor:0x647183,sky:0x444e60}],
 [0x626575,{wall:0x4e4b48,floor:0x746f65,sky:0x544e48}],
 [0x566d76,{wall:0x464a50,floor:0x62686d,sky:0x555963}],
]);
/** Neutral industrial finishes over the tested modular surface/collision kit.
 * White framed insets alone accept portals. Structural panels stay graphite;
 * the skylight-coloured missing roof is replaced by a complete ceiling. */
export class LabTileWorld extends StructuralWorld{
 constructor(game,palette){
  super(game,{...palette,...(FINISHES.get(palette.wall)||{})});
  this.materials.trim.color.setHex(0x262a2e);
 }
 walls(bounds,height,base=-.2){
  const {minX,maxX,minZ,maxZ}=bounds;
  // Leave room for the complete third-person capsule and early experiments.
  height=Math.max(9,height);super.walls(bounds,height,base);
  this.game.scene.background=new THREE.Color(this.palette.sky);
  if(this.game.scene.fog)this.game.scene.fog.color.setHex(this.palette.sky);
  this.game.materials.wall.color.setHex(this.palette.wall);
  this.surface({name:'Non-portal ceiling tiles',position:[(minX+maxX)/2,height+.34,(minZ+maxZ)/2],
    normal:[0,-1,0],width:maxX-minX,height:maxZ-minZ});
  for(const x of [minX+.04,maxX-.04]){
   this.box([x,base+.12,(minZ+maxZ)/2],[.09,.24,maxZ-minZ],this.materials.trim,false);
   this.box([x,height-.13,(minZ+maxZ)/2],[.10,.18,maxZ-minZ],this.materials.trim,false);
  }
  // Recessed luminous trays belong to the lighting system, not puzzle props.
  for(let z=minZ+2;z<maxZ;z+=7){
   this.box([(minX+maxX)/2,height+.02,z],[Math.min(6,maxX-minX-1),.08,.42],this.materials.trim,false);
   this.box([(minX+maxX)/2,height-.025,z],[Math.min(5.8,maxX-minX-1.2),.02,.29],this.materials.lamp,false);
  }
 }
}
