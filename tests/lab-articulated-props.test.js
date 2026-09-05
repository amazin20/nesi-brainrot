import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { LabPressurePlatform, LabRotatingPanel, LabCounterweightBridge } from '../src/game/LabArticulatedProps.js';

let draco;
before(async () => {
  const scope = { console, TextDecoder, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(new URL('../public/draco/draco_decoder.js', import.meta.url), 'utf8'), scope);
  draco = await scope.DracoDecoderModule();
});
function load(file, size = 5) {
  const bytes = fs.readFileSync(new URL(`../public/models/runtime/${file}`, import.meta.url));
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + length)), bin = bytes.subarray(28 + length);
  const primitive = doc.meshes[0].primitives[0], ext = primitive.extensions.KHR_draco_mesh_compression;
  const view = doc.bufferViews[ext.bufferView], buffer = new draco.DecoderBuffer();
  buffer.Init(new Int8Array(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)), view.byteLength);
  const decoder = new draco.Decoder(), decoded = new draco.Mesh();
  assert.ok(decoder.DecodeBufferToMesh(buffer, decoded).ok());
  const geometry = new THREE.BufferGeometry();
  for (const [semantic, name, width] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]]) {
    const attribute = decoder.GetAttributeByUniqueId(decoded, ext.attributes[semantic]), array = new draco.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(decoded, attribute, array);
    const values = new Float32Array(decoded.num_points() * width);
    for (let i = 0; i < values.length; i++) values[i] = array.GetValue(i);
    geometry.setAttribute(name, new THREE.BufferAttribute(values, width)); draco.destroy(array);
  }
  const face = new draco.DracoInt32Array(), indices = new Uint32Array(decoded.num_faces() * 3);
  for (let i = 0; i < decoded.num_faces(); i++) {
    decoder.GetFaceFromMesh(decoded, i, face); for (let k = 0; k < 3; k++) indices[i * 3 + k] = face.GetValue(k);
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  draco.destroy(face); draco.destroy(decoded); draco.destroy(decoder); draco.destroy(buffer);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
  mesh.quaternion.fromArray(doc.nodes[0].rotation);
  const normalized = new THREE.Group(); normalized.add(mesh);
  let box = new THREE.Box3().setFromObject(normalized), extent = box.getSize(new THREE.Vector3());
  normalized.scale.setScalar(size / Math.max(extent.x, extent.y, extent.z));
  box = new THREE.Box3().setFromObject(normalized);
  const center = box.getCenter(new THREE.Vector3()); normalized.position.set(-center.x, -box.min.y, -center.z);
  const art = new THREE.Group(); art.add(normalized);
  art.position.set(3, .4, -7); art.rotation.y = .7; art.updateWorldMatrix(true, true);
  return { art, mesh, geometry };
}
function area(mesh) {
  const p = mesh.geometry.attributes.position, idx = mesh.geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let total = 0;
  for (let i = 0; i < (idx?.count ?? p.count); i += 3) {
    a.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
    total += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return total;
}

test('actual new models retain original textures, attributes and every source surface after partition', () => {
  for (const [file, Type] of [['model-28-rotating-panel.glb', LabRotatingPanel],
    ['model-29-pressure-platform.glb', LabPressurePlatform], ['model-30-counterweight-bridge.glb', LabCounterweightBridge]]) {
    const { art, mesh, geometry } = load(file), positions = geometry.attributes.position.array.slice();
    const before = area(mesh), prop = new Type(art);
    for (const group of prop.groups) group.rotation.set(0, 0, 0);
    art.updateWorldMatrix(true, true); let after = 0;
    for (const group of prop.groups) group.traverse(child => {
      if (!child.isMesh || child === prop.link) return;
      assert.equal(child.material, mesh.material); assert.ok(child.geometry.attributes.uv);
      after += area(child);
    });
    assert.ok(Math.abs(after - before) / before < .00001, `${file}: ${before} vs ${after}`);
    assert.deepEqual(geometry.attributes.position.array, positions);
    assert.equal(mesh.geometry, geometry); assert.equal(mesh.visible, false);
  }
});

test('pressure platform moves only its real inset and reported portal plane stays on that inset', () => {
  const { art } = load('model-29-pressure-platform.glb'); const prop = new LabPressurePlatform(art);
  const frame = prop.getFrameBox().clone(), origin = art.position.clone();
  const unpressed = prop.getPortalFrame(); prop.update(1, 1 / 60); const pressed = prop.getPortalFrame();
  assert.ok(unpressed.center.y - pressed.center.y > .02);
  assert.ok(unpressed.center.y - pressed.center.y < .06);
  assert.deepEqual(prop.getFrameBox(), frame); assert.deepEqual(art.position, origin);
  assert.ok(pressed.normal.y > .99999); assert.equal(pressed.anchor.isMesh, undefined);
  const ray = new THREE.Raycaster(pressed.center.clone().add(new THREE.Vector3(0, .3, 0)), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObject(prop.top, true)[0]; assert.ok(hit);
  assert.ok(Math.abs(hit.point.y - pressed.center.y) < .005);
  assert.ok(Math.abs(prop.getSupport().heightAt(pressed.center.x, pressed.center.z) - hit.point.y) < .005);
});

test('portal panel rotates around its bearings with stationary feet and a usable horizontal face', () => {
  const { art } = load('model-28-rotating-panel.glb'); const prop = new LabRotatingPanel(art);
  const frame = prop.getFrameBox().clone(), pivot = prop.panel.getWorldPosition(new THREE.Vector3());
  const initial = prop.getPortalFrame(); prop.update(1, 1 / 60); const tilted = prop.getPortalFrame();
  assert.ok(Math.abs(initial.normal.y) < 1e-6); assert.ok(tilted.normal.y > .99999);
  assert.deepEqual(prop.getFrameBox(), frame);
  assert.ok(prop.panel.getWorldPosition(new THREE.Vector3()).distanceTo(pivot) < 1e-8);
  assert.ok(Math.abs(tilted.halfWidth - initial.halfWidth) < 1e-7);
  const ray = new THREE.Raycaster(tilted.center.clone().addScaledVector(tilted.normal, .3), tilted.normal.clone().negate());
  const hit = ray.intersectObject(prop.panel, true)[0]; assert.ok(hit);
  assert.ok(hit.point.distanceTo(tilted.center) < .01);
});

test('counterweight bridge opens a level real deck while towers remain fixed', () => {
  const { art } = load('model-30-counterweight-bridge.glb', 8); const prop = new LabCounterweightBridge(art);
  prop.update(1); const open = prop.getSupport(), frames = prop.getFrameBoxes();
  assert.ok(open.enabled); assert.ok(open.normal.y > .99999);
  assert.ok(Math.max(...open.corners.map(p => p.y)) - Math.min(...open.corners.map(p => p.y)) < 1e-5);
  for (const fraction of [-.75, 0, .75]) {
    const point = open.center.clone().addScaledVector(open.up, open.halfHeight * fraction);
    const ray = new THREE.Raycaster(point.clone().add(new THREE.Vector3(0, .3, 0)), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(prop.deck, true)[0]; assert.ok(hit, `Missing visible deck at ${fraction}`);
    assert.ok(Math.abs(hit.point.y - point.y) < .045, `Visible/support disagreement ${hit.point.y - point.y}`);
  }
  const tip = open.corners[0].clone();
  prop.update(0); const raised = prop.getSupport();
  assert.equal(raised.enabled, false); assert.deepEqual(prop.getFrameBoxes(), frames);
  assert.ok(raised.corners.some(p => p.y > tip.y + 2));
  assert.ok(Math.abs(prop.deck.rotation.x - prop.counterweight.rotation.x) < 1e-8);
  assert.ok(prop.link.parent === prop.counterweight);
});
