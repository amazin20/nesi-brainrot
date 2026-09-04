import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHAMBERS, LabGame } from '../src/game/LabGame.js';
import { LabPortals } from '../src/game/LabPortals.js';

function fixture() {
  const scene = new THREE.Scene();
  const move = new THREE.Vector2();
  const game = Object.assign(Object.create(LabGame.prototype), {
    scene, state: 'playing', stage: 0, elapsed: 0, hudTimer: 0,
    playerPosition: new THREE.Vector3(), playerVelocity: new THREE.Vector3(),
    playerGroup: new THREE.Group(), playerGrounded: true,
    yaw: 0, pitch: -.15, facing: Math.PI,
    launchTime: 0, portalCooldown: 0, teleportCount: 0,
    portalSurfaceIds: [null, null], heldCube: null, interactQueued: false,
    colliders: [], cameraBlockers: [], aimBlockers: [],
    floors: [{ minX: -12, maxX: 12, minZ: -51, maxZ: 22, y: 0 }],
    input: { keys: new Set(), getMove: () => move, consumeJump: () => false },
    raycaster: new THREE.Raycaster(), portals: new LabPortals({ scene }),
    audio: { tone() {}, jump() {}, pickup() {}, checkpoint() {} },
    callbacks: { onToast() {}, onHud() {} },
    animator: { update() {}, reset() {}, triggerLanding() {} },
    cameraRig: { reset() {} },
  });
  game.move = move;
  game.cubes = CHAMBERS.map((chamber, stage) => {
    const group = new THREE.Group(); group.position.fromArray(chamber.cube); scene.add(group);
    return { group, velocity: new THREE.Vector3(), stage, cooldown: 0 };
  });
  game.doors = CHAMBERS.map(chamber => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(6.2, 5, .38), new THREE.MeshBasicMaterial());
    mesh.position.set(0, 2.5, chamber.end); mesh.updateWorldMatrix(true, false);
    return {
      mesh, art: new THREE.Group(), z: chamber.end, opened: false, progress: 0,
      collider: { mesh, box: new THREE.Box3().setFromObject(mesh), enabled: true },
      buttonRing: { material: { color: new THREE.Color() } },
    };
  });
  return game;
}

function addWall(game, x, y, z, width, height, depth) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z); game.scene.add(mesh); mesh.updateMatrixWorld(true);
  const collider = { mesh, box: new THREE.Box3().setFromObject(mesh), enabled: true };
  game.colliders.push(collider); game.cameraBlockers.push(mesh); game.aimBlockers.push(mesh);
  return collider;
}

test('walking and sprinting cannot penetrate an ordinary wall', () => {
  for (const sprint of [false, true]) {
    const game = fixture();
    addWall(game, 0, 3, 0, 20, 6, .4);
    game.playerPosition.set(0, 0, 2); game.move.set(0, -1);
    if (sprint) game.input.keys.add('ShiftLeft');
    for (let i = 0; i < 90; i++) game.updatePlayer(1 / 60);
    assert.ok(game.playerPosition.z >= .63 - 1e-8);
    assert.equal(game.playerVelocity.z, 0);
    assert.equal(game.teleportCount, 0);
    game.portals.dispose();
  }
});

test('open oval permits the player center to cross its wall, while its edges remain solid', () => {
  for (const x of [0, 1]) {
    const game = fixture();
    const wall = addWall(game, 0, 3, 0, 20, 6, .4);
    game.portals.place(0, new THREE.Vector3(0, 1.6, .236), new THREE.Vector3(0, 0, 1));
    game.portals.place(1, new THREE.Vector3(8, 1.6, -10), new THREE.Vector3(1, 0, 0));
    game.portalSurfaceIds[0] = wall.mesh.uuid;
    game.playerPosition.set(x, 0, 1); game.move.set(0, -1);
    for (let i = 0; i < 60 && !game.teleportCount; i++) game.updatePlaying(1 / 60);
    if (x === 0) {
      assert.equal(game.teleportCount, 1);
      assert.ok(game.playerPosition.x >= 8.53 - 1e-8);
      assert.ok(Math.abs(game.yaw + Math.PI / 2) < 1e-7);
      assert.ok(game.playerVelocity.x > 0);
    } else {
      assert.equal(game.teleportCount, 0);
      assert.ok(game.playerPosition.z >= .63 - 1e-8);
    }
    game.portals.dispose();
  }
});

test('actual crossing transports the carried cube and reorients the third-person view', () => {
  const game = fixture();
  const wall = addWall(game, 0, 3, 0, 20, 6, .4);
  addWall(game, 7.764, 3, -10, .4, 6, 10);
  game.portals.place(0, new THREE.Vector3(0, 1.6, .236), new THREE.Vector3(0, 0, 1));
  game.portals.place(1, new THREE.Vector3(8, 1.6, -10), new THREE.Vector3(1, 0, 0));
  game.portalSurfaceIds[0] = wall.mesh.uuid;
  game.playerPosition.set(0, 0, .25); game.playerVelocity.set(0, 0, -3);
  game.move.set(0, -1); game.heldCube = game.cubes[0];
  game.heldCube.group.position.set(0, 1.25, .8);
  let cameraReset = null;
  game.cameraRig.reset = (position, yaw) => { cameraReset = { position: position.clone(), yaw }; };
  game.updatePlaying(1 / 60);
  assert.equal(game.teleportCount, 1);
  assert.equal(game.heldCube, game.cubes[0]);
  assert.ok(game.heldCube.group.position.x > 8);
  assert.ok(Math.abs(game.heldCube.group.position.z + 10) < 1.3);
  assert.ok(game.heldCube.group.position.distanceTo(game.playerPosition) < 2);
  assert.ok(game.heldCube.group.position.x >= 7.964 + .62 - 1e-7);
  assert.ok(Math.abs(cameraReset.yaw + Math.PI / 2) < 1e-7);
  assert.ok(Math.abs(game.facing - Math.PI / 2) < 1e-7);
  assert.ok(game.portalCooldown > 0 && game.heldCube.cooldown > 0);
  game.portals.dispose();
});

test('physical gate blocks until raised far enough, even after its button activates', () => {
  const game = fixture(); const door = game.doors[0];
  game.colliders.push(door.collider);
  const push = () => {
    const position = new THREE.Vector3(0, 0, door.z + .1);
    const previous = new THREE.Vector3(0, 0, door.z + 1);
    game.resolveBody(position, previous, new THREE.Vector3(0, 0, -4), .43, 2.4);
    return position.z;
  };
  assert.ok(push() >= door.z + .62 - 1e-8);
  game.cubes[0].group.position.set(...CHAMBERS[0].button); game.cubes[0].group.position.y = .62;
  game.updateDoors(1 / 60);
  assert.equal(door.opened, true);
  assert.ok(push() >= door.z + .62 - 1e-8);
  for (let i = 0; i < 90; i++) game.updateDoors(1 / 60);
  assert.ok(door.collider.box.min.y > 2.4);
  assert.ok(Math.abs(push() - (door.z + .1)) < 1e-8);
  game.portals.dispose();
});

test('a real floor gap makes the player fall and respawn with the held cube recovered', () => {
  const game = fixture();
  game.floors = [
    { minX: -12, maxX: 12, minZ: 11, maxZ: 22 },
    { minX: -12, maxX: 12, minZ: -3, maxZ: 5 },
  ];
  assert.equal(game.floorHeight(0, 8), null);
  assert.equal(game.floorHeight(0, 18), 0);
  game.playerPosition.set(0, 0, 8); game.heldCube = game.cubes[0];
  game.heldCube.group.position.set(0, 1.25, 7);
  for (let i = 0; i < 120 && game.playerPosition.z === 8; i++) game.updatePlaying(1 / 60);
  assert.deepEqual(game.playerPosition.toArray(), CHAMBERS[0].start);
  assert.equal(game.heldCube, null);
  assert.ok(game.cubes[0].group.position.distanceTo(new THREE.Vector3(...CHAMBERS[0].cube)) < .02);
  assert.equal(game.playerGrounded, true);
  game.portals.dispose();
});

test('stage progression requires its opened gate and clears the old portal pair', () => {
  const game = fixture();
  game.playerPosition.set(0, 0, CHAMBERS[0].end - 1.2);
  game.portals.place(0, new THREE.Vector3(0, 1.6, 10), new THREE.Vector3(0, 0, 1));
  game.portals.place(1, new THREE.Vector3(0, 1.6, 5), new THREE.Vector3(0, 0, -1));
  game.updatePlaying(1 / 60);
  assert.equal(game.stage, 0);
  game.cubes[0].group.position.set(CHAMBERS[0].button[0], .62, CHAMBERS[0].button[2]);
  game.updatePlaying(1 / 60);
  assert.equal(game.stage, 1);
  assert.equal(game.portals.ready, false);
  assert.deepEqual(game.portalSurfaceIds, [null, null]);
  game.portals.dispose();
});

test('taking an old cube past a completed gate does not leave an invisible carried cube', () => {
  const game = fixture();
  game.doors[0].opened = true; game.doors[0].progress = 1;
  game.playerPosition.set(0, 0, CHAMBERS[0].end - 1.2);
  game.heldCube = game.cubes[0]; game.heldCube.group.position.set(0, 1.25, CHAMBERS[0].end - 1.8);
  game.updatePlaying(1 / 60);
  assert.equal(game.stage, 1);
  assert.ok(game.heldCube === null, 'old-stage cube must be released at the next chamber');
  game.playerPosition.copy(game.cubes[1].group.position).add(new THREE.Vector3(0, -.62, 1.5));
  game.toggleCube();
  assert.equal(game.heldCube, game.cubes[1]);
  game.portals.dispose();
});

test('pickup requires an unobstructed path; an invisible collision proxy still blocks it', () => {
  const game = fixture();
  const wall = addWall(game, 0, 2, 0, 10, 4, .3);
  wall.mesh.visible = false;
  game.playerPosition.set(0, 0, 1); game.cubes[0].group.position.set(0, 1.25, -1);
  game.toggleCube(); assert.equal(game.heldCube, null);
  game.cameraBlockers.length = 0;
  game.toggleCube(); assert.equal(game.heldCube, game.cubes[0]);
  game.portals.dispose();
});

test('carrying beside an ordinary wall keeps the entire cube on the player side', () => {
  for (const [cooldown, side] of [[0, 1], [0, -1], [.35, 1], [.35, -1]]) {
    const game = fixture();
    addWall(game, 0, 3, 0, 10, 6, .4);
    game.playerPosition.set(0, 0, side * .63); game.facing = side === 1 ? Math.PI : 0;
    game.heldCube = game.cubes[0]; game.heldCube.group.position.set(0, 1.25, side * 1.5);
    game.portalCooldown = cooldown;
    for (let i = 0; i < 60; i++) game.updateCubes(1 / 60);
    assert.ok(game.heldCube.group.position.z * side >= .82 - 1e-6,
      `cube penetrated wall: z=${game.heldCube.group.position.z}, cooldown=${cooldown}`);
    game.portals.dispose();
  }
});
