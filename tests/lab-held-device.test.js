import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { LAB_DEVICE_CALIBRATION, LabHeldDevice } from '../src/game/LabHeldDevice.js';

function makeDevice() {
  const scene = new THREE.Group(), playerRoot = new THREE.Group(), visual = new THREE.Group();
  scene.add(playerRoot); playerRoot.add(visual);
  visual.scale.setScalar(2.4 / 1.085291);
  const sourceFrame = new THREE.Group(); sourceFrame.rotation.x = Math.PI / 2; visual.add(sourceFrame);
  const Body = new THREE.Bone(); Body.name = 'LabBody'; Body.position.set(0, 0, -.345); sourceFrame.add(Body);
  const HandR = new THREE.Bone(); HandR.name = 'LabHandR'; HandR.position.set(.26, .027, -.024); Body.add(HandR);
  HandR.rotation.x = -.67;
  // Match the REAL asset accessor bounds and GLB node rotation. Transform
  // correctness doesn't depend on tessellation or WebGL texture decoding.
  const glb = fs.readFileSync(new URL('../public/models/model-11-portal-gun.glb', import.meta.url));
  const doc = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)));
  const accessor = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...accessor.min, ...accessor.max], 3));
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material); mesh.quaternion.fromArray(doc.nodes[0].rotation).normalize();
  const normalized = new THREE.Group(); normalized.add(mesh);
  let bounds = new THREE.Box3().setFromObject(normalized), size = bounds.getSize(new THREE.Vector3());
  normalized.scale.setScalar(.7 / Math.max(size.x, size.y, size.z));
  bounds = new THREE.Box3().setFromObject(normalized);
  const centre = bounds.getCenter(new THREE.Vector3());
  normalized.position.set(-centre.x, -bounds.min.y, -centre.z);
  const model = new THREE.Group(); model.add(normalized);
  const nodeTransform = mesh.matrix.clone(), materialRef = mesh.material;
  const device = new LabHeldDevice({ model, bones: { Body, HandR }, playerRoot });
  return { device, playerRoot, visual, Body, HandR, model, mesh, materialRef, nodeTransform, scene };
}

test('real source grip stays exactly inside the moving, rotating right palm', () => {
  const { device, playerRoot, HandR, Body } = makeDevice();
  for (let frame = 0; frame < 90; frame += 1) {
    playerRoot.position.set(frame * .3, Math.sin(frame) * 2, -frame * .7);
    playerRoot.rotation.y = frame * .073;
    Body.rotation.set(Math.sin(frame * .1) * .1, .04, .02);
    HandR.rotation.set(-.67 + Math.sin(frame * .11) * .4, .05, Math.cos(frame * .12) * .06);
    device.update({ dt: 1 / 60 });
    assert.equal(device.attachment.parent, HandR);
    assert.ok(device.diagnostics.handDistance < 1e-12, `grip drift at frame ${frame}`);
    assert.ok(device.diagnostics.socketDistance < 1e-12);
  }
});

test('source -X emitter faces player forward in the animated hold and follows aim pitch', () => {
  const { device, HandR, playerRoot } = makeDevice();
  assert.ok(new THREE.Vector3().fromArray(device.diagnostics.forwardWorld).distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-6);
  playerRoot.rotation.y = 1.2;
  HandR.rotation.x -= .4;
  device.update();
  const expected = new THREE.Vector3(0, Math.sin(.4), Math.cos(.4)).applyAxisAngle(new THREE.Vector3(0, 1, 0), 1.2);
  assert.ok(new THREE.Vector3().fromArray(device.diagnostics.forwardWorld).distanceTo(expected) < 1e-6);
});

test('device compensates source bone scale and retains original node, geometry and material', () => {
  const { device, visual, mesh, materialRef, nodeTransform } = makeDevice();
  const geometry = mesh.geometry, positions = geometry.getAttribute('position').array.slice();
  for (const scale of [1.1, 2.4 / 1.085291, 3.4]) {
    visual.scale.setScalar(scale);
    device.update();
    const worldScale = mesh.getWorldScale(new THREE.Vector3());
    assert.ok(Math.abs(worldScale.x * (0.538183 + .492971) - .7) < 1e-6);
    assert.ok(device.diagnostics.handDistance < 1e-12);
  }
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, materialRef);
  assert.deepEqual(mesh.geometry.getAttribute('position').array, positions);
  mesh.updateMatrix(); assert.deepEqual(mesh.matrix.elements, nodeTransform.elements);
});

test('carry, teleport and draw transitions stay fixed to a bone with no floating frames', () => {
  const { device, playerRoot, Body, HandR } = makeDevice();
  device.fire(1);
  for (const carrying of [true, true, false, true, false]) {
    playerRoot.position.add(new THREE.Vector3(9, 2, -4));
    playerRoot.rotation.y += .8;
    Body.rotation.x += .1;
    device.update({ dt: 1 / 60, carrying });
    assert.equal(device.attachment.parent, carrying ? Body : HandR);
    assert.equal(device.state, carrying ? 'holstered' : 'held');
    assert.ok(device.diagnostics.socketDistance < 1e-12);
    if (!carrying) assert.ok(device.diagnostics.handDistance < 1e-12);
    else {
      assert.equal(device.fire(0), false);
      assert.equal(device.flash.visible, false);
      assert.equal(device.light.intensity, 0);
    }
  }
  device.update({ carrying: true }); device.reset();
  assert.equal(device.attachment.parent, HandR);
  assert.ok(device.diagnostics.handDistance < 1e-12);
});

test('portal pulse changes only controller-owned effects and expires without moving the grip', () => {
  const { device, mesh } = makeDevice();
  const material = mesh.material, before = device.diagnostics.gripWorld;
  assert.equal(device.fire(1), true);
  assert.equal(device.diagnostics.portalIndex, 1);
  assert.equal(device.flashMaterial.uniforms.color.value.getHex(), 0xffbc68);
  for (let frame = 0; frame < 30; frame += 1) device.update({ dt: 1 / 60 });
  assert.equal(device.flash.visible, false);
  assert.equal(device.light.intensity, 0);
  assert.deepEqual(device.diagnostics.gripWorld, before);
  assert.equal(mesh.material, material);
  assert.equal(LAB_DEVICE_CALIBRATION.asset, 'model-11-portal-gun.glb');
});
