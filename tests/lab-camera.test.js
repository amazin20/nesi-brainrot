import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabCamera } from '../src/game/LabCamera.js';
import { makePortalFrame, portalRotation, transformPortalPoint, transformPortalDirection } from '../src/game/LabPortals.js';

function setup(blockers = []) {
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.06, 160);
  const rig = new LabCamera({ camera, blockers });
  rig.reset(new THREE.Vector3(), 0, -0.2);
  return { camera, rig };
}

function wall(x, z, width = 12) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 8, 0.2), new THREE.MeshBasicMaterial());
  mesh.position.set(x, 3, z);
  mesh.updateMatrixWorld();
  return mesh;
}

test('third-person default frames a 2.5 m character with no camera roll', () => {
  const { camera } = setup();
  assert.ok(camera.position.z > 6.2 && camera.position.z < 6.5);
  assert.ok(camera.position.y > 2.5 && camera.position.y < 2.8);
  for (const point of [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.5, 0)]) {
    const ndc = point.project(camera);
    assert.ok(Math.abs(ndc.x) < 0.85 && Math.abs(ndc.y) < 0.85, 'head and feet stay inside the frame');
  }
  assert.deepEqual(camera.up.toArray(), [0, 1, 0]);
});

test('critical follow and orbit agree during motion at 30 and 120 fps', () => {
  const simulate = (fps) => {
    const { camera, rig } = setup();
    for (let i = 0; i < fps * 0.2; i += 1) {
      rig.update({ dt: 1 / fps, target: new THREE.Vector3(2, 0.5, -1), yaw: 0.55, pitch: -0.32 });
    }
    return camera;
  };
  const slow = simulate(30);
  const fast = simulate(120);
  assert.ok(slow.position.distanceTo(fast.position) < 1e-8);
  assert.ok(slow.quaternion.angleTo(fast.quaternion) < 1e-6);
});

test('camera retracts on the first blocked frame and releases smoothly', () => {
  const blockers = [];
  const { camera, rig } = setup(blockers);
  blockers.push(wall(0, 3));
  rig.update({ dt: 1 / 120, target: new THREE.Vector3(), yaw: 0, pitch: -0.2 });
  assert.equal(rig.obstructed, true);
  assert.ok(camera.position.z < 2.7, 'lens and near plane remain before the wall');
  const retracted = camera.position.clone();
  blockers.pop();
  rig.update({ dt: 1 / 60, target: new THREE.Vector3(), yaw: 0, pitch: -0.2 });
  assert.ok(camera.position.distanceTo(retracted) < 0.12, 'removing an obstruction does not pop the camera back');
  for (let i = 0; i < 120; i += 1) rig.update({ dt: 1 / 60, target: new THREE.Vector3(), yaw: 0, pitch: -0.2 });
  assert.ok(camera.position.z > 6.2);
});

test('camera volume detects a wall edge missed by the centre ray', () => {
  const { camera, rig } = setup([wall(0.6, 3, 0.22)]);
  assert.equal(rig.obstructed, true);
  assert.ok(camera.position.z < 2.8);
});

test('teleport clears spring velocity and snaps to the destination side of a wall', () => {
  const { camera, rig } = setup([wall(0, 3)]);
  const target = new THREE.Vector3(0, 0, -6);
  rig.update({ dt: 1 / 60, target, yaw: 0, pitch: -0.2, teleported: true });
  assert.ok(camera.position.z < 1, 'no interpolation from the old chamber');
  assert.ok(rig.focus.distanceTo(target.clone().add(new THREE.Vector3(0, 1.32, 0))) < 1e-10);
  assert.equal(rig.focusVelocity.lengthSq(), 0);
  assert.equal(rig.yawVelocity, 0);
});

test('orbit remains on the player side around corners with a wide near plane', () => {
  const blockers = [wall(0, 3)];
  const { camera, rig } = setup(blockers);
  camera.aspect = 3.2;
  camera.near = 0.2;
  camera.updateProjectionMatrix();
  for (let i = 0; i < 120; i += 1) {
    rig.update({ dt: 1 / 60, target: new THREE.Vector3(0, 0, 1), yaw: Math.sin(i / 30) * 0.7, pitch: -0.1 });
    assert.ok(camera.position.z < 2.7);
    assert.ok(camera.position.toArray().every(Number.isFinite));
  }
});

test('yaw follows the shortest arc across the angle wrap and speed FOV stays subtle', () => {
  const { camera, rig } = setup();
  rig.reset(new THREE.Vector3(), Math.PI - 0.01, -0.2);
  for (let i = 0; i < 120; i += 1) {
    rig.update({ dt: 1 / 60, target: new THREE.Vector3(), yaw: -Math.PI + 0.01,
      pitch: -0.2, velocity: new THREE.Vector3(20, 0, 0) });
    assert.ok(Math.abs(rig.yaw - Math.PI) < 0.05);
    assert.ok(camera.fov >= 62 && camera.fov <= 64.2);
  }
});

test('explicit aim blends the shoulder and boom without a first-frame screen kick', () => {
  const { camera, rig } = setup(); const target = new THREE.Vector3();
  const tick = (aiming, dt = 1 / 60) => rig.update({ dt, target, yaw: 0, pitch: -.2, aiming });
  for (let i = 0; i < 120; i++) tick(false);
  const before = camera.position.clone(); const orientation = camera.quaternion.clone();
  tick(true, 0);
  assert.ok(before.distanceTo(camera.position) < 1e-8, 'aim teleported the shoulder before time advanced');
  tick(true);
  assert.ok(before.distanceTo(camera.position) < .025, 'one aim frame abruptly shortened the camera boom');
  assert.ok(orientation.angleTo(camera.quaternion) < .003, 'aim kicked the entire view');
  let previous = camera.position.clone();
  for (let i = 0; i < 90; i++) {
    tick(i < 45);
    assert.ok(previous.distanceTo(camera.position) < .08, 'aim or release popped between camera offsets');
    previous.copy(camera.position);
  }
});

test('aim framing follows the same continuous path at 30, 60 and 144 fps', () => {
  const sample = fps => {
    const { camera, rig } = setup();
    for (let i = 0; i < fps; i++) rig.update({ dt: 1 / fps, target: new THREE.Vector3(), yaw: 0, pitch: -.2, aiming: true });
    return { position: camera.position.clone(), rotation: camera.quaternion.clone(), blend: rig.aimBlend };
  };
  const baseline = sample(60);
  for (const fps of [30, 144]) {
    const result = sample(fps);
    assert.ok(Math.abs(result.blend - baseline.blend) < 1e-10);
    assert.ok(result.position.distanceTo(baseline.position) < .001);
    assert.ok(result.rotation.angleTo(baseline.rotation) < .0001);
  }
});

test('portal transport preserves the rendered lens, momentum, FOV and aim instead of resetting the rig', () => {
  const { camera, rig } = setup();
  const target = new THREE.Vector3(.3, .1, -.4);
  rig.update({ dt: .04, target, yaw: .2, pitch: -.3, aiming: true, velocity: new THREE.Vector3(2, 0, -3) });
  const entry = makePortalFrame(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, 1));
  for (const normal of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(.4, .8, .2).normalize()]) {
    const exit = makePortalFrame(new THREE.Vector3(12, 3, -20), normal, new THREE.Vector3(0, 0, 1));
    const before = {
      lens: camera.position.clone(), rotation: camera.quaternion.clone(), momentum: rig.focusVelocity.clone(),
      fov: camera.fov, distance: rig.distance, aim: rig.aimBlend, fovVelocity: rig.fovVelocity,
    };
    const expected = transformPortalPoint(before.lens, entry, exit);
    const expectedRotation = portalRotation(entry, exit).multiply(before.rotation);
    const destination = transformPortalPoint(target, entry, exit).addScaledVector(exit.normal, .48);
    const controls = rig.applyPortalTransform(entry, exit, { target: destination, yaw: .2, pitch: -.3 });
    assert.ok(camera.position.distanceTo(expected) < 1e-9, 'capsule clearance moved the lens instead of the follow target');
    assert.ok(camera.quaternion.angleTo(expectedRotation) < 1e-7);
    assert.ok(rig.focusVelocity.distanceTo(transformPortalDirection(before.momentum, entry, exit)) < 1e-9);
    assert.equal(camera.fov, before.fov); assert.equal(rig.distance, before.distance);
    assert.equal(rig.aimBlend, before.aim); assert.equal(rig.fovVelocity, before.fovVelocity);
    rig.update({ dt: 0, target: destination, ...controls, aiming: true });
    assert.ok(camera.position.distanceTo(expected) < 1e-9, 'the next update rebuilt a different boom at zero elapsed time');
    assert.ok(camera.quaternion.angleTo(expectedRotation) < 1e-6, 'horizon snapped immediately after transport');
  }
});

test('floor exit horizon and capsule correction recover continuously after transport', () => {
  const { camera, rig } = setup();
  const entry = makePortalFrame(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 0, 1));
  const exit = makePortalFrame(new THREE.Vector3(0, 0, -16), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  const target = new THREE.Vector3(0, .1, -16);
  const controls = rig.applyPortalTransform(entry, exit, { target });
  let previous = camera.quaternion.clone();
  for (let i = 0; i < 180; i++) {
    rig.update({ dt: 1 / 120, target, ...controls });
    assert.ok(camera.quaternion.angleTo(previous) < .09, 'floor exit rolled in one abrupt camera frame');
    assert.ok(camera.position.toArray().every(Number.isFinite));
    previous.copy(camera.quaternion);
  }
  assert.ok(camera.up.distanceTo(new THREE.Vector3(0, 1, 0)) < .015);
});

test('aperture-aware camera collision receives each hit without ignoring the rest of its wall', () => {
  const blocker = wall(0, 3);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, .06, 160);
  let hits = 0;
  const rig = new LabCamera({ camera, blockers: [blocker], isBlocker: (object, hit) => {
    assert.equal(object, blocker); assert.ok(hit.point?.isVector3); hits++;
    return Math.abs(hit.point.x) > 1.18 || Math.abs(hit.point.y - 2) > 1.58;
  } });
  rig.reset(new THREE.Vector3(), 0, -.2);
  assert.ok(hits > 0); assert.equal(rig.obstructed, false);
  rig.reset(new THREE.Vector3(4, 0, 0), 0, -.2);
  assert.equal(rig.obstructed, true);
});

test('transported lens clips the exit backing wall and restores the optical projection after emerging', () => {
  const { camera, rig } = setup();
  const entry = makePortalFrame(new THREE.Vector3(0, 1.32, 0), new THREE.Vector3(0, 0, 1));
  const exit = makePortalFrame(new THREE.Vector3(0, 1.32, -20), new THREE.Vector3(0, 0, -1));
  rig.applyPortalTransform(entry, exit, { target: new THREE.Vector3(0, 0, -20.5) });
  assert.equal(rig.portalExit, exit);
  assert.ok(exit.position.clone().project(camera).z < -1, 'the destination backing wall hides the transported lens');
  const expected = camera.clone(); expected.updateProjectionMatrix();
  assert.notDeepEqual(camera.projectionMatrix.elements, expected.projectionMatrix.elements);
  camera.position.copy(exit.position).addScaledVector(exit.normal, .3);
  rig.updatePortalClipping();
  assert.equal(rig.portalExit, null);
  assert.deepEqual(camera.projectionMatrix.elements, expected.projectionMatrix.elements);
  rig.reset(new THREE.Vector3());
  assert.equal(rig.portalExit, null);
});

test('a vertical portal view does not convert an Euler singularity into an orbit whip', () => {
  const { camera, rig } = setup();
  rig.reset(new THREE.Vector3(), 0, 0);
  rig.yawVelocity = .4; rig.pitchVelocity = -.3;
  const entry = makePortalFrame(new THREE.Vector3(0, 1.32, 0), new THREE.Vector3(0, 0, 1));
  const exit = makePortalFrame(new THREE.Vector3(0, 0, -20), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  const target = new THREE.Vector3(0, .1, -20);
  const controls = rig.applyPortalTransform(entry, exit, { target });
  assert.ok(Math.abs(rig.yawVelocity) < 1 && Math.abs(rig.pitchVelocity) < 1);
  const before = camera.quaternion.clone();
  rig.update({ dt: 1 / 120, target, ...controls });
  assert.ok(before.angleTo(camera.quaternion) < .09);
});
