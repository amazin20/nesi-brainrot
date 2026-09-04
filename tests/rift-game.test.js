import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RiftGame } from '../src/game/RiftGame.js';
import { buildRiftRoute, makeRiftFrame } from '../src/game/riftMath.js';

function gameFixture() {
  return Object.assign(Object.create(RiftGame.prototype), {
    playerPosition: new THREE.Vector3(0, 0, 0),
    playerVelocity: new THREE.Vector3(),
    playerGroup: new THREE.Group(),
    playerAppearance: { update() {} },
    playerFacing: Math.PI,
    tempVector: new THREE.Vector3(),
    cube: new THREE.Group(),
    cubeVelocity: new THREE.Vector3(),
    heldCube: false,
    riftTravel: null,
    phaseHalo: { visible: false },
    yaw: 0,
    pitch: 0,
    buttonActivated: false,
    doorProgress: 0,
    aimBlockers: [],
    cameraBlockers: [],
    cameraRaycaster: new THREE.Raycaster(),
    camera: new THREE.PerspectiveCamera(),
    cameraForward: new THREE.Vector3(),
    callbacks: { onToast() {} },
    audio: { pickup() {}, tone() {} },
  });
}

function wall(x, y, z, width, height, depth) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

test('starter beacon faces the spawn chamber and exits clear of the wall', () => {
  const game = gameFixture();
  game.world = new THREE.Group();
  game.createRiftSystem();
  assert.ok(game.riftBeacon.position.z > 8.17);
  assert.equal(game.riftBeacon.normal.z, 1);
  const route = buildRiftRoute(new THREE.Vector3(0, 0, 17), game.riftBeacon);
  assert.ok(route.end.z < 8 - 0.17 - 0.78);
});

test('held cube cannot be pushed through either side of a phase wall', () => {
  for (const side of [-1, 1]) {
    const game = gameFixture();
    game.heldCube = true;
    game.playerPosition.z = -3.6 + side * 0.65;
    game.cube.position.set(0, 1.03, -3.6 + side * 1.3);
    game.yaw = side === 1 ? 0 : Math.PI;
    for (let frame = 0; frame < 60; frame += 1) game.updateCube(1 / 60);
    assert.ok((game.cube.position.z + 3.6) * side >= 0.95 - 1e-9);
  }
});

test('carried cube crosses during phase travel and stays across on its final frame', () => {
  for (const yaw of [0, Math.PI]) {
    const game = gameFixture();
    game.heldCube = true;
    game.yaw = yaw;
    game.playerPosition.set(-4.8, 0, 1.8);
    game.cube.position.set(-4.8, 1.03, 1.8);
    const anchor = makeRiftFrame(new THREE.Vector3(0, 1.34, -3.37), new THREE.Vector3(0, 0, 1));
    game.riftTravel = {
      route: buildRiftRoute(game.playerPosition, anchor),
      elapsed: 0,
      duration: 0.85,
      incomingVelocity: new THREE.Vector3(0, 0, -5),
    };
    for (let frame = 0; frame < 50 && game.riftTravel; frame += 1) {
      game.updateRiftTravel(0.04);
      game.updateCube(0.04);
    }
    assert.equal(game.riftTravel, null);
    assert.ok(game.playerPosition.z < -4.1);
    assert.ok(game.cube.position.z <= -4.55 + 1e-9);
    assert.equal(game.heldCube, true);
  }
});

test('cube pickup requires unobstructed line of sight', () => {
  const game = gameFixture();
  game.playerPosition.set(0, 0, -2.6);
  game.cube.position.set(0, 0.79, -4.6);
  game.aimBlockers.push(wall(0, 3, -3.6, 24, 6, 0.34));
  game.toggleCube();
  assert.equal(game.heldCube, false);
  game.aimBlockers.length = 0;
  game.toggleCube();
  assert.equal(game.heldCube, true);
});

test('exit only allows the central doorway after the panel has physically cleared the player', () => {
  for (const [x, progress, blocked] of [[0, 0.1, true], [0, 1, false], [5, 1, true]]) {
    const game = gameFixture();
    game.buttonActivated = true;
    game.doorProgress = progress;
    game.playerPosition.set(x, 0, -14.4);
    game.playerVelocity.z = -5;
    game.resolvePlayerCollisions(new THREE.Vector3(x, 0, -13.3));
    assert.equal(game.playerPosition.z >= -13.35 - 1e-9, blocked);
  }
});

test('open exit sidewalls still block a loose cube', () => {
  const game = gameFixture();
  game.buttonActivated = true;
  game.doorProgress = 1;
  game.cube.position.set(5, 0.79, -12.9);
  game.cubeVelocity.z = -8;
  game.updateCube(0.1);
  assert.ok(game.cube.position.z >= -13.05 - 1e-9);
});

test('camera immediately retracts before a wall closer than the former minimum distance', () => {
  const game = gameFixture();
  game.camera.position.set(0.72, 1.42, 6.2);
  game.cameraBlockers.push(wall(0, 1.42, 0.8, 10, 8, 0.2));
  game.updateCamera(0.001);
  assert.ok(game.camera.position.z < 0.5);
  assert.ok(game.camera.position.distanceTo(new THREE.Vector3(0, 1.42, 0)) < 0.5);
});

test('camera checks the smoothed ray around corners, not only the target ray', () => {
  const game = gameFixture();
  game.camera.position.set(5, 1.42, 0);
  game.cameraBlockers.push(wall(1, 1.42, 0, 0.2, 8, 1));
  game.updateCamera(0.01);
  assert.ok(game.camera.position.x < 0.9);
});
