import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {
  LAB_PLAYER_BONE, LAB_PLAYER_JOINTS, LabPlayerAnimator,
  createLabPlayerRig, resolveLabPlayerSkin, solveLabLeg,
} from '../src/game/LabPlayerAnimator.js';

let sourceGeometry, original, actualRig;

before(async () => {
  // These regressions decode the user's REAL model, not a substitute triangle.
  // The bundled Draco JS decoder keeps the test offline and reproducible.
  const sandbox = { console, TextDecoder, module: { exports: {} } };
  const dracoSource = fs.readFileSync(new URL('../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', import.meta.url), 'utf8');
  vm.runInNewContext(dracoSource, sandbox);
  const draco = await sandbox.DracoDecoderModule();
  const glb = fs.readFileSync(new URL('../public/models/model-01-player.glb', import.meta.url));
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
  sourceGeometry = new THREE.BufferGeometry();
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
  const visual = new THREE.Group();
  original = new THREE.Mesh(sourceGeometry, new THREE.MeshStandardMaterial());
  original.rotation.x = Math.PI / 2;
  visual.add(original);
  visual.scale.setScalar(2.3);
  actualRig = createLabPlayerRig(visual);
});

test('real player: all original vertices retain their exact bind silhouette', () => {
  const attribute = sourceGeometry.getAttribute('position');
  assert.equal(attribute.count, 509541);
  const expected = new THREE.Vector3(), actual = new THREE.Vector3();
  let maximum = 0;
  for (let vertex = 0; vertex < attribute.count; vertex += 1) {
    expected.fromBufferAttribute(attribute, vertex);
    actualRig.mesh.getVertexPosition(vertex, actual);
    maximum = Math.max(maximum, expected.distanceTo(actual));
  }
  assert.ok(maximum < 1e-7, `bind silhouette drift: ${maximum}`);
});

test('real player: source geometry, UV, normals, indices and materials remain unchanged', () => {
  assert.equal(actualRig.mesh.material, original.material);
  assert.equal(original.geometry, sourceGeometry);
  for (const name of ['position', 'normal', 'uv']) {
    assert.deepEqual(actualRig.mesh.geometry.getAttribute(name).array, sourceGeometry.getAttribute(name).array);
  }
  assert.deepEqual(actualRig.mesh.geometry.index.array, sourceGeometry.index.array);
  assert.equal(sourceGeometry.getAttribute('skinIndex'), undefined);
  assert.equal(sourceGeometry.getAttribute('skinWeight'), undefined);
});

test('real player: duplicate seam vertices share identical bone weights', () => {
  const p = sourceGeometry.getAttribute('position');
  const indices = actualRig.mesh.geometry.getAttribute('skinIndex').array;
  const weights = actualRig.mesh.geometry.getAttribute('skinWeight').array;
  const seen = new Map();
  let duplicates = 0;
  for (let vertex = 0; vertex < p.count; vertex += 1) {
    const key = [p.getX(vertex), p.getY(vertex), p.getZ(vertex)].map((value) => Math.round(value * 100000)).join(',');
    if (seen.has(key)) {
      const first = seen.get(key);
      for (let slot = 0; slot < 4; slot += 1) {
        assert.equal(indices[vertex * 4 + slot], indices[first * 4 + slot]);
        assert.equal(weights[vertex * 4 + slot], weights[first * 4 + slot]);
      }
      duplicates += 1;
    } else seen.set(key, vertex);
  }
  assert.ok(duplicates > 10000, 'the real model seam coverage unexpectedly vanished');
});

test('backpack and rear shoulder decorations never inherit arm or wing bones', () => {
  for (const point of [[0, -0.25, -0.52], [-0.21, -0.28, -0.56], [0.2, -0.24, -0.60]]) {
    const { indices, weights } = resolveLabPlayerSkin(...point);
    assert.equal(indices[0], LAB_PLAYER_BONE.Body);
    assert.equal(weights[0], 1);
  }
  assert.ok(LAB_PLAYER_JOINTS.every(({ name }) => !/Cape|Wing|Ear/.test(name)));
  for (const point of [[0, 0.18, -0.78], [0.1, -0.15, -1.01]]) {
    const { indices, weights } = resolveLabPlayerSkin(...point);
    assert.equal(indices[0], LAB_PLAYER_BONE.Head);
    assert.equal(weights[0], 1);
  }
});

test('whole shoes stay rigid and the belt centre does not split between thighs', () => {
  for (const point of [[-0.1, -0.06, -0.13], [0.13, 0.11, -0.06]]) {
    const { indices, weights } = resolveLabPlayerSkin(...point);
    assert.equal(indices[0], point[0] < 0 ? LAB_PLAYER_BONE.FootL : LAB_PLAYER_BONE.FootR);
    assert.equal(weights[0], 1);
  }
  const centre = resolveLabPlayerSkin(0.005, 0.11, -0.30);
  assert.equal(centre.indices[0], LAB_PLAYER_BONE.Body);
  assert.equal(centre.weights[0], 1);
});

function makeAnimator() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.25, 0.025, -0.34, 0.26, 0.025, -0.34,
    -0.11, 0.01, -0.20, 0.12, 0.01, -0.20,
    0, -0.25, -0.52, 0, 0.15, -0.78,
  ], 3));
  const visual = new THREE.Group();
  visual.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  return new LabPlayerAnimator({ visual });
}

test('locomotion bends both hips, knees, shoulders and elbows with continuous finite poses', () => {
  const animator = makeAnimator();
  const required = ['ArmL', 'ArmR', 'ForearmL', 'ForearmR', 'ThighL', 'ThighR', 'ShinL', 'ShinR'];
  const extremes = Object.fromEntries(required.map((name) => [name, 0]));
  let previous = Object.fromEntries(required.map((name) => [name, animator.bones[name].quaternion.clone()]));
  for (let frame = 0; frame < 240; frame += 1) {
    const airborne = frame >= 100 && frame < 125;
    animator.update({ dt: 1 / 60, speed: frame < 180 ? 4.2 : 0, grounded: !airborne,
      carrying: frame >= 160, velocity: new THREE.Vector3(0, airborne ? 2 - (frame - 100) * 0.3 : 0, 0) });
    for (const name of required) {
      const q = animator.bones[name].quaternion;
      assert.ok(q.toArray().every(Number.isFinite));
      assert.ok(q.angleTo(previous[name]) < 0.6, `${name} snapped across a transition`);
      extremes[name] = Math.max(extremes[name], q.angleTo(new THREE.Quaternion()));
      previous[name].copy(q);
    }
  }
  for (const name of required) assert.ok(extremes[name] > 0.06, `${name} never articulated`);
  assert.equal(animator.diagnostics.backpackRigid, true);
  animator.reset();
  for (const bone of Object.values(animator.bones)) assert.deepEqual(bone.quaternion.toArray(), [0, 0, 0, 1]);
});

test('leg solver keeps contact orientation finite throughout its reachable range', () => {
  for (const forward of [-0.15, 0, 0.15]) {
    const result = solveLabLeg(forward, 0.21);
    assert.ok(Object.values(result).every(Number.isFinite));
    assert.ok(result.knee > 0 && result.knee < Math.PI);
    assert.ok(Math.abs(result.hip + result.knee + result.ankle) < 1e-12);
  }
});
