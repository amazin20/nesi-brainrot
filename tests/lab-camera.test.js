import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabCamera } from '../src/game/LabCamera.js';

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
