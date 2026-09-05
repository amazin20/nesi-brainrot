// Uses the real uploaded mesh geometry and production game simulation in Node.
// This is a physics/route check, not a WebGL screenshot or a rendering claim.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabGame } from '../src/game/LabGame.js';
import { CAMPAIGN_ASSETS, runtimeAssetPath } from '../src/game/labAssets.js';

const scope = { console, TextDecoder, module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', import.meta.url), 'utf8'), scope);
const draco = await scope.DracoDecoderModule();
export async function loadHeadlessGLB(file) {
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


export async function createHeadlessGame(index = 0) {
  const game = new LabGame({ container: null, touch: false });
  game.scene = new THREE.Scene(); game.camera = new THREE.PerspectiveCamera(57, 16/9, .1, 130);
  game.materials = Object.fromEntries(['wall','floor','dark','trim','cyan','amber','glass'].map(name => [name,
    new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })]));
  game.audio = { tone() {}, jump() {}, pickup() {}, checkpoint() {}, win() {}, step() {} };
  game.input = { keys: new Set(), jumpQueued: false, getMove() {
    return new THREE.Vector2((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
      (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0)).normalize();
  }, consumeJump() { const value = this.jumpQueued; this.jumpQueued = false; return value; } };
  game.label = () => new THREE.Object3D();
  game.createOverlay = () => { game.prompt = { textContent: '' }; };
  globalThis.document = { exitPointerLock() {} };
  for (const asset of CAMPAIGN_ASSETS) game.assets.set(asset.id, await loadHeadlessGLB(new URL(`../public/${runtimeAssetPath(asset)}`, import.meta.url)));
  game.levelIndex = index; game.buildLevel();
  return game;
}
