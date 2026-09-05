// CPU reference capture of actual runtime skin deformation. No WebGL/PBR claim.
// node scripts/render-player-motion.mjs [/tmp/nesi-player-motion]
// python3 scripts/render-player-motion.py /tmp/nesi-player-motion /tmp/nesi-raster
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabPlayerAnimator } from '../src/game/LabPlayerAnimator.js';
import { LabHeldDevice } from '../src/game/LabHeldDevice.js';
const output = path.resolve(process.argv[2] || '/tmp/nesi-player-motion');
fs.mkdirSync(output, { recursive: true });
const scope = { console, TextDecoder, module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', import.meta.url), 'utf8'), scope);
const draco = await scope.DracoDecoderModule();
async function load(file, textureName) {
  const bytes = fs.readFileSync(file), length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length)), bin = bytes.subarray(28 + length);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const types = { 5120: [Int8Array, 1, 'getInt8'], 5121: [Uint8Array, 1, 'getUint8'],
    5122: [Int16Array, 2, 'getInt16'], 5123: [Uint16Array, 2, 'getUint16'],
    5125: [Uint32Array, 4, 'getUint32'], 5126: [Float32Array, 4, 'getFloat32'] };
  function accessor(id) {
    const acc = doc.accessors[id], view = doc.bufferViews[acc.bufferView];
    const [Type, size, getter] = types[acc.componentType], width = components[acc.type];
    const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), array = new Type(acc.count * width);
    const start = (view.byteOffset || 0) + (acc.byteOffset || 0), stride = view.byteStride || size * width;
    for (let i = 0; i < acc.count; i++) for (let j = 0; j < width; j++) array[i * width + j] = data[getter](start + i * stride + j * size, true);
    return new THREE.BufferAttribute(array, width, !!acc.normalized);
  }
  function mesh(primitive) {
    const geometry = new THREE.BufferGeometry(), ext = primitive.extensions?.KHR_draco_mesh_compression;
    const semantics = [['POSITION','position',3],['NORMAL','normal',3],['TEXCOORD_0','uv',2]];
    if (ext) {
      const view = doc.bufferViews[ext.bufferView], buffer = new draco.DecoderBuffer();
      buffer.Init(new Int8Array(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)), view.byteLength);
      const decoder = new draco.Decoder(), decoded = new draco.Mesh();
      assert.ok(decoder.DecodeBufferToMesh(buffer, decoded).ok(), `Decode failed: ${file}`);
      for (const [semantic, name, size] of semantics) {
        if (!(semantic in ext.attributes)) continue;
        const attribute = decoder.GetAttributeByUniqueId(decoded, ext.attributes[semantic]);
        const data = new draco.DracoFloat32Array(); decoder.GetAttributeFloatForAllPoints(decoded, attribute, data);
        const array = new Float32Array(decoded.num_points() * size);
        for (let i = 0; i < array.length; i++) array[i] = data.GetValue(i);
        geometry.setAttribute(name, new THREE.BufferAttribute(array, size)); draco.destroy(data);
      }
      const face = new draco.DracoInt32Array(), indices = new Uint32Array(decoded.num_faces() * 3);
      for (let i = 0; i < decoded.num_faces(); i++) { decoder.GetFaceFromMesh(decoded, i, face); for (let k = 0; k < 3; k++) indices[i * 3 + k] = face.GetValue(k); }
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      draco.destroy(face); draco.destroy(decoded); draco.destroy(decoder); draco.destroy(buffer);
    } else {
      for (const [semantic, name] of semantics) if (semantic in primitive.attributes) geometry.setAttribute(name, accessor(primitive.attributes[semantic]));
      if (primitive.indices !== undefined) geometry.setIndex(accessor(primitive.indices));
    }
    const material = doc.materials[primitive.material];
    const texture = doc.textures[material.pbrMetallicRoughness.baseColorTexture.index];
    const source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    const image = doc.images[source], imageView = doc.bufferViews[image.bufferView];
    fs.writeFileSync(`${output}/${textureName}.webp`, bin.subarray(imageView.byteOffset || 0, (imageView.byteOffset || 0) + imageView.byteLength));
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
  }
  const nodes = doc.nodes.map(node => {
    const object = new THREE.Group();
    if (node.mesh !== undefined) for (const primitive of doc.meshes[node.mesh].primitives) object.add(mesh(primitive));
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.translation) object.position.fromArray(node.translation);
    if (node.scale) object.scale.fromArray(node.scale);
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    return object;
  });
  doc.nodes.forEach((node, i) => { for (const child of node.children || []) nodes[i].add(nodes[child]); });
  const group = new THREE.Group(); for (const id of doc.scenes[doc.scene || 0].nodes) group.add(nodes[id]); return group;
}

function normalize(source, size, height = false) {
  const root = new THREE.Group();
  let box = new THREE.Box3().setFromObject(source), dimensions = box.getSize(new THREE.Vector3());
  source.scale.multiplyScalar(size / (height ? dimensions.y : Math.max(...dimensions.toArray())));
  box = new THREE.Box3().setFromObject(source);
  const center = box.getCenter(new THREE.Vector3());
  source.position.add(new THREE.Vector3(-center.x, -box.min.y, -center.z));
  root.add(source); return root;
}
const root = new THREE.Group(), carrier = new THREE.Group(); root.add(carrier);
const visual = normalize(await load(new URL('../public/models/runtime/model-01-player.glb', import.meta.url), 'player'), 2.4, true);
root.add(visual);
const animator = new LabPlayerAnimator({ visual, carrier });
const gun = normalize(await load(new URL('../public/models/runtime/model-11-portal-gun.glb', import.meta.url), 'gun'), .7);
const held = new LabHeldDevice({ model: gun, bones: animator.bones, playerRoot: root, size: .7 });
const streams = [];
function geometry(mesh, key) {
  const g = mesh.geometry;
  fs.writeFileSync(`${output}/${key}-uv.bin`, Buffer.from(g.attributes.uv.array.buffer));
  const indices = Uint32Array.from(g.index.array);
  fs.writeFileSync(`${output}/${key}-indices.bin`, Buffer.from(indices.buffer));
  streams.push({ key, mesh });
}
geometry(animator.rig.mesh, 'player');
gun.traverse(object => { if (object.isMesh) geometry(object, 'gun'); });
const frames = [];
const point = new THREE.Vector3();
function capture(name, index, time) {
  root.updateMatrixWorld(true); animator.rig.skeleton.update();
  const meshes = [];
  for (const { key, mesh } of streams) {
    const g = mesh.geometry, positions = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).sub(root.position);
      point.toArray(positions, i * 3);
    }
    const normalGeometry = new THREE.BufferGeometry();
    normalGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); normalGeometry.setIndex(g.index);
    normalGeometry.computeVertexNormals();
    const prefix = `${name}-${String(index).padStart(3, '0')}-${key}`;
    fs.writeFileSync(`${output}/${prefix}-position.bin`, Buffer.from(positions.buffer));
    fs.writeFileSync(`${output}/${prefix}-normal.bin`, Buffer.from(normalGeometry.attributes.normal.array.buffer));
    normalGeometry.dispose(); meshes.push({ key, prefix });
  }
  frames.push({ name, index, time, y: root.position.y, meshes, cadence: animator.cadenceHz,
    phase: animator.diagnostics.airborne.phase, contacts: animator.diagnostics.groundContact });
}
function step({ speed = 0, carrying = false, grounded = true, vy = 0, y = 0 } = {}) {
  const dt = 1 / 60; root.position.z += speed * dt; root.position.y = y;
  const targets = carrying ? {
    left: root.position.clone().add(new THREE.Vector3(-.20, 1.045, .52)),
    right: root.position.clone().add(new THREE.Vector3(.20, 1.045, .52)),
  } : null;
  animator.update({ dt, speed, velocity: new THREE.Vector3(0, vy, speed), grounded, carrying,
    carryGripTargets: targets, sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0) }) });
  held.update({ dt, carrying });
}
for (const [name, speed, carrying] of [['idle', 0, false], ['walk', 3.3, false], ['run', 5, false], ['carry', 2.9, true]]) {
  animator.reset(); held.reset(); root.position.set(0, 0, 0);
  for (let i = 0; i < 120; i++) step({ speed, carrying });
  for (let i = 0; i < 90; i++) { step({ speed, carrying }); if (i % 3 === 0) capture(name, i / 3, i / 60); }
  console.log(`Captured ${name}: cadence ${animator.cadenceHz.toFixed(3)} cycles/s`);
}
animator.reset(); held.reset(); root.position.set(0, 0, 0);
for (let i = 0; i < 90; i++) step({ speed: 3.3 });
animator.triggerJump();
for (let i = 0; i < 66; i++) {
  const age = i / 60 - .05, air = age > 0 && age < 2 * 7.8 / 19.5;
  step({ speed: 3.3, grounded: !air, vy: air ? 7.8 - 19.5 * age : 0,
    y: air ? 7.8 * age - 19.5 * age * age / 2 : 0 });
  if (i % 2 === 0) capture('jump', i / 2, i / 60);
}
fs.writeFileSync(`${output}/frames.json`, JSON.stringify({ method: 'Actual runtime mesh, production LabPlayerAnimator and foot contact, CPU skinning; orthographic base texture capture; no browser/PBR claim', frames }, null, 2));
console.log(`Exported ${frames.length} mesh frames to ${output}`);
