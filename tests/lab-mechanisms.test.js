import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {LabDoorMechanism,LabBarrierMechanism} from '../src/game/LabMechanisms.js';
async function loadSource(file) {
  const sandbox = { console, TextDecoder, module: { exports: {} } };
  const dracoSource = fs.readFileSync(new URL('../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', import.meta.url), 'utf8');
  vm.runInNewContext(dracoSource, sandbox);
  const draco = await sandbox.DracoDecoderModule();
  const glb = fs.readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  const jsonLength = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + jsonLength));
  const primitive = doc.meshes[0].primitives[0];
  const compression = primitive.extensions.KHR_draco_mesh_compression;
  const view = doc.bufferViews[compression.bufferView];
  const bin = glb.subarray(28 + jsonLength);
  const buffer = new draco.DecoderBuffer();
  buffer.Init(new Int8Array(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)), view.byteLength);
  const decoder = new draco.Decoder(), mesh = new draco.Mesh();
  const status = decoder.DecodeBufferToMesh(buffer, mesh);
  assert.ok(status.ok());
  const sourceGeometry = new THREE.BufferGeometry();
  for (const [semantic, name, size] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]]) {
    const attribute = decoder.GetAttributeByUniqueId(mesh, compression.attributes[semantic]);
    const decoded = new draco.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, attribute, decoded);
    const values = new Float32Array(mesh.num_points() * size);
    for (let index = 0; index < values.length; index += 1) values[index] = decoded.GetValue(index);
    sourceGeometry.setAttribute(name, new THREE.BufferAttribute(values, size));
    draco.destroy(decoded);
  }
  const decodedFace = new draco.DracoInt32Array();
  const indices = new Uint32Array(mesh.num_faces() * 3);
  for (let face = 0; face < mesh.num_faces(); face += 1) {
    decoder.GetFaceFromMesh(mesh, face, decodedFace);
    for (let k = 0; k < 3; k += 1) indices[face * 3 + k] = decodedFace.GetValue(k);
  }
  sourceGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  draco.destroy(decodedFace); draco.destroy(mesh); draco.destroy(decoder); draco.destroy(buffer);

 return sourceGeometry;
}

let doorGeometry, door, doorRoot, originalMesh, fieldGeometry, field, fieldRoot;
before(async()=>{
  doorGeometry=await loadSource('model-17-lab-door.glb');
  originalMesh=new THREE.Mesh(doorGeometry,new THREE.MeshStandardMaterial({side:THREE.DoubleSide}));originalMesh.rotation.x=Math.PI/2;
  doorRoot=new THREE.Group();doorRoot.add(originalMesh);door=new LabDoorMechanism(doorRoot);
  fieldGeometry=await loadSource('model-20-energy-barrier.glb');fieldRoot=new THREE.Group();
  const mesh=new THREE.Mesh(fieldGeometry,new THREE.MeshStandardMaterial());mesh.rotation.x=Math.PI/2;fieldRoot.add(mesh);field=new LabBarrierMechanism(fieldRoot);
});
function area(geometry){const p=geometry.attributes.position,idx=geometry.index,a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();let sum=0;for(let i=0;i<(idx?.count??p.count);i+=3){a.fromBufferAttribute(p,idx?idx.getX(i):i);b.fromBufferAttribute(p,idx?idx.getX(i+1):i+1);c.fromBufferAttribute(p,idx?idx.getX(i+2):i+2);sum+=b.sub(a).cross(c.sub(a)).length()*.5;}return sum;}
test('real door: closed partition covers every original surface without duplicate areas or holes',()=>{
  const before=area(doorGeometry);let after=0;for(const group of door.groups)group.traverse(o=>{if(o.isMesh)after+=area(o.geometry);});assert.ok(Math.abs(after-before)<before*1e-6,`${before} versus ${after}`);
  assert.equal(originalMesh.geometry,doorGeometry);assert.equal(originalMesh.geometry.attributes.skinIndex,undefined);
  for(const group of door.groups)group.traverse(o=>{if(o.isMesh)assert.equal(o.material,originalMesh.material);});
});
test('real door: closed front surface and UVs match the uploaded mesh after surgical clipping',()=>{
  door.update(0);const reference=originalMesh.clone();reference.visible=true;reference.updateMatrixWorld(true);const ray=new THREE.Raycaster();const rendered=[];door.groups.forEach(g=>g.traverse(o=>{if(o.isMesh)rendered.push(o);}));let checked=0;
  for(let x=0;x<19;x++)for(let y=0;y<17;y++){
    ray.set(new THREE.Vector3(door.bounds.min.x+(x+.43)/19*(door.bounds.max.x-door.bounds.min.x),door.bounds.min.y+(y+.37)/17*(door.bounds.max.y-door.bounds.min.y),2),new THREE.Vector3(0,0,-1));
    const a=ray.intersectObject(reference)[0],b=ray.intersectObjects(rendered)[0];assert.equal(Boolean(a),Boolean(b));if(!a)continue;checked++;assert.ok(a.point.distanceTo(b.point)<2e-6);assert.ok(a.uv.distanceTo(b.uv)<.0001);
  }assert.ok(checked>220);
});
test('real door: leaf colliders follow horizontal opening while frame and model origin stay fixed',()=>{
  const frameBoxes=door.getFrameBoxes().map(b=>b.clone()),origin=doorRoot.position.clone();door.update(1);const opened=door.getLeafBoxes();assert.ok(opened[0].max.x<door.opening.min.x);assert.ok(opened[1].min.x>door.opening.max.x);assert.deepEqual(doorRoot.position,origin);assert.deepEqual(door.getFrameBoxes(),frameBoxes);assert.equal(door.left.position.y,0);assert.equal(door.right.position.y,0);
  door.update(.5);const half=door.getLeafBoxes();assert.ok(half[0].max.x<door.centerX);assert.ok(half[0].max.x>opened[0].max.x);
});
test('real energy barrier: only field fades; posts and source materials remain stable',()=>{
  const areaBefore=area(fieldGeometry);let areaAfter=0;field.groups.forEach(g=>g.traverse(o=>{if(o.isMesh)areaAfter+=area(o.geometry);}));assert.ok(Math.abs(areaAfter-areaBefore)<areaBefore*1e-6);
  const frame=field.frame.matrix.clone(),origin=fieldRoot.position.clone();field.update(.5,2);assert.equal(field.uniforms.strength.value,.5);assert.equal(field.solid,true);field.update(1,3);assert.equal(field.interior.visible,false);assert.equal(field.solid,false);assert.deepEqual(field.frame.matrix,frame);assert.deepEqual(fieldRoot.position,origin);field.update(0,4);assert.equal(field.interior.visible,true);assert.equal(field.uniforms.strength.value,1);
});
