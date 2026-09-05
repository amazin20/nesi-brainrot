import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { resolveLabPlayerSkin } from '../src/game/LabPlayerAnimator.js';
import * as THREE from 'three';
import { LAB_DEVICE_CALIBRATION, LAB_DEVICE_TRANSITION_SECONDS, LabHeldDevice } from '../src/game/LabHeldDevice.js';

function makeDevice(sourceGeometry = null) {
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
  const geometry = sourceGeometry || new THREE.BufferGeometry();
  if (!sourceGeometry) geometry.setAttribute('position', new THREE.Float32BufferAttribute([...accessor.min, ...accessor.max], 3));
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

test('stow and draw move continuously between the palm and hip without a visibility blink', () => {
  const { device, Body, HandR } = makeDevice();
  device.fire(1);
  for (const carrying of [true, false]) {
    let before = device.attachment.getWorldPosition(new THREE.Vector3());
    let previousRotation = device.attachment.getWorldQuaternion(new THREE.Quaternion());
    device.update({ dt: 0, carrying });
    assert.ok(device.attachment.getWorldPosition(new THREE.Vector3()).distanceTo(before) < 1e-12);
    for (let frame = 0; frame < 32; frame += 1) {
      device.update({ dt: .01, carrying });
      const position = device.attachment.getWorldPosition(new THREE.Vector3());
      const rotation = device.attachment.getWorldQuaternion(new THREE.Quaternion());
      assert.ok(position.distanceTo(before) < .03, `position popped during frame ${frame}`);
      assert.ok(rotation.angleTo(previousRotation) < .16, `orientation popped during frame ${frame}`);
      assert.equal(device.model.visible, true);
      assert.equal(device.attachment.visible, true);
      assert.ok(device.diagnostics.socketDistance < 1e-12);
      if (frame < 31) {
        assert.equal(device.state, carrying ? 'stowing' : 'drawing');
        assert.equal(device.fire(0), false);
        assert.equal(device.attachment.parent, Body);
      }
      before = position; previousRotation = rotation;
    }
    assert.equal(device.state, carrying ? 'holstered' : 'held');
    assert.equal(device.attachment.parent, carrying ? Body : HandR);
    assert.equal(device.holsterProgress, carrying ? 1 : 0);
    assert.equal(device.flash.visible, false);
  }
  assert.ok(device.diagnostics.handDistance < 1e-12);
});

test('reversing a partial stow preserves the exact pose and retraces the continuous path', () => {
  const { device } = makeDevice();
  for (let frame = 0; frame < 13; frame += 1) device.update({ dt: .01, carrying: true });
  const progress = device.holsterProgress;
  const position = device.attachment.getWorldPosition(new THREE.Vector3());
  const rotation = device.attachment.getWorldQuaternion(new THREE.Quaternion());
  device.update({ dt: 0, carrying: false });
  assert.equal(device.state, 'drawing');
  assert.equal(device.holsterProgress, progress);
  assert.ok(device.attachment.getWorldPosition(new THREE.Vector3()).distanceTo(position) < 1e-12);
  assert.ok(device.attachment.getWorldQuaternion(new THREE.Quaternion()).angleTo(rotation) < 1e-7);
  for (let frame = 0; frame < 13; frame += 1) device.update({ dt: .01, carrying: false });
  assert.equal(device.state, 'held');
  assert.ok(device.diagnostics.handDistance < 1e-12);
  device.update({ carrying: true }); device.reset();
  assert.equal(device.state, 'held');
  assert.equal(device.holsterProgress, 0);
});

test('every transition frame follows a portal transform instantly, with no world-space lag', () => {
  const { device, playerRoot, HandR, Body } = makeDevice();
  const inverse = new THREE.Matrix4();
  for (let frame = 0; frame < 27; frame += 1) {
    HandR.rotation.x = -.67 + Math.sin(frame * .13) * .2;
    Body.rotation.z = Math.sin(frame * .07) * .08;
    device.update({ dt: .01, carrying: true });
    playerRoot.updateWorldMatrix(true, true);
    inverse.copy(playerRoot.matrixWorld).invert();
    const localBefore = inverse.clone().multiply(device.attachment.matrixWorld);
    playerRoot.position.add(new THREE.Vector3(11, 3, -8));
    playerRoot.rotation.y += .73;
    device.update({ dt: 0, carrying: true });
    playerRoot.updateWorldMatrix(true, true);
    inverse.copy(playerRoot.matrixWorld).invert();
    const localAfter = inverse.clone().multiply(device.attachment.matrixWorld);
    for (let i = 0; i < 16; i += 1) assert.ok(Math.abs(localBefore.elements[i] - localAfter.elements[i]) < 1e-11);
    assert.ok(device.diagnostics.socketDistance < 1e-11);
  }
});

test('handoff duration and pose agree at equal elapsed time across render frame rates', () => {
  const devices = [30, 60, 120].map((fps) => {
    const { device } = makeDevice();
    for (let i = 0; i < fps / 5; i += 1) device.update({ dt: 1 / fps, carrying: true });
    return device;
  });
  const expected = .2 / LAB_DEVICE_TRANSITION_SECONDS;
  for (const device of devices) {
    assert.ok(Math.abs(device.holsterProgress - expected) < 1e-12);
    assert.ok(device.attachment.position.distanceTo(devices[0].attachment.position) < 1e-12);
    assert.ok(device.attachment.quaternion.angleTo(devices[0].attachment.quaternion) < 1e-7);
  }
});

test('small wrist yaw cannot flip the half-turn holster interpolation to its other side', () => {
  const { device, HandR } = makeDevice();
  for (let frame = 0; frame < 16; frame += 1) device.update({ dt: .01, carrying: true });
  HandR.rotation.y = -.00001;
  device.update({ dt: 0, carrying: true });
  const before = device.attachment.quaternion.clone();
  HandR.rotation.y = .00001;
  device.update({ dt: 0, carrying: true });
  assert.ok(before.angleTo(device.attachment.quaternion) < .0001);
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


async function runtimePositions(file) {
  const scope = { console, TextDecoder, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(new URL('../public/draco/draco_decoder.js', import.meta.url), 'utf8'), scope);
  const draco = await scope.DracoDecoderModule();
  const bytes = fs.readFileSync(new URL(`../public/models/runtime/${file}`, import.meta.url));
  const length = bytes.readUInt32LE(12), doc = JSON.parse(bytes.subarray(20, 20 + length)), bin = bytes.subarray(28 + length);
  const ext = doc.meshes[0].primitives[0].extensions.KHR_draco_mesh_compression, view = doc.bufferViews[ext.bufferView];
  const buffer = new draco.DecoderBuffer();
  buffer.Init(new Int8Array(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)), view.byteLength);
  const decoder = new draco.Decoder(), decoded = new draco.Mesh();
  assert.ok(decoder.DecodeBufferToMesh(buffer, decoded).ok());
  const attribute = decoder.GetAttributeByUniqueId(decoded, ext.attributes.POSITION), array = new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(decoded, attribute, array);
  const values = new Float32Array(decoded.num_points() * 3);
  for (let i = 0; i < values.length; i++) values[i] = array.GetValue(i);
  draco.destroy(array); draco.destroy(decoded); draco.destroy(decoder); draco.destroy(buffer);
  return new THREE.Float32BufferAttribute(values, 3);
}

test('real optimized jacket and holstered casing both physically meet the docking clip', async () => {
  const gunPositions = await runtimePositions('model-11-portal-gun.glb');
  const playerPositions = await runtimePositions('model-01-player.glb');
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', gunPositions);
  const { device, mesh, Body, playerRoot } = makeDevice(geometry);
  device.setSocket(true);
  device.holsterMount.geometry.computeBoundingBox();
  const clip = device.holsterMount.geometry.boundingBox.clone().translate(device.holsterMount.position);
  const gun = [], jacket = [], point = new THREE.Vector3();
  let casingContact = Infinity, jacketContact = Infinity;
  for (let i = 0; i < gunPositions.count; i++) {
    point.fromBufferAttribute(gunPositions, i); mesh.localToWorld(point); Body.worldToLocal(point);
    casingContact = Math.min(casingContact, clip.distanceToPoint(point));
    if (clip.distanceToPoint(point) < .035) gun.push(point.clone());
  }
  for (let i = 0; i < playerPositions.count; i++) {
    point.fromBufferAttribute(playerPositions, i);
    const skin = resolveLabPlayerSkin(point.x, point.y, point.z);
    let bodyWeight = 0; for (let j = 0; j < 4; j++) if (skin.indices[j] === 0) bodyWeight += skin.weights[j];
    if (bodyWeight < .98 || point.x < .08 || point.z > -.3 || point.z < -.6) continue;
    point.z += .345;
    jacketContact = Math.min(jacketContact, clip.distanceToPoint(point)); jacket.push(point.clone());
  }
  assert.ok(casingContact < .001, `Casing misses docking clip by ${casingContact}`);
  assert.ok(jacketContact < .001, `Docking clip misses jacket by ${jacketContact}`);
  let casingJacketGap = Infinity;
  for (const a of gun) for (const b of jacket) casingJacketGap = Math.min(casingJacketGap, a.distanceTo(b));
  const scale = Body.getWorldScale(new THREE.Vector3()).x;
  assert.ok(casingJacketGap * scale < .030, `World gap ${casingJacketGap * scale}`);
  // The clip follows the same rigid torso as the casing through runs/portals.
  const mountRelative = device.holsterMount.position.clone();
  for (let i = 0; i < 24; i++) {
    Body.rotation.set(Math.sin(i) * .14, i * .05, Math.cos(i) * .08);
    playerRoot.position.set(i * 3, Math.sin(i) * 2, -i * 5); playerRoot.rotation.y = i * .3;
    device.update({ dt: 1 / 60, carrying: true });
    assert.equal(device.attachment.parent, Body);
    assert.deepEqual(device.holsterMount.position, mountRelative);
    const worldScale = mesh.getWorldScale(new THREE.Vector3());
    geometry.computeBoundingBox();
    assert.ok(Math.abs(worldScale.x * (geometry.boundingBox.max.x - geometry.boundingBox.min.x) - .7) < 1e-6);
    assert.ok(device.diagnostics.socketDistance < 1e-10);
  }
});

test('disposing the docking clip releases only controller-owned resources', () => {
  const { device, mesh } = makeDevice();
  const disposed = { clip: false, clipMaterial: false, source: false, material: false };
  device.holsterMount.geometry.addEventListener('dispose', () => disposed.clip = true);
  device.mountMaterial.addEventListener('dispose', () => disposed.clipMaterial = true);
  mesh.geometry.addEventListener('dispose', () => disposed.source = true);
  mesh.material.addEventListener('dispose', () => disposed.material = true);
  device.dispose();
  assert.deepEqual(disposed, { clip: true, clipMaterial: true, source: false, material: false });
  assert.equal(device.holsterMount.parent, null);
});
