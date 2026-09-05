import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CHAMBERS, LabGame } from '../src/game/LabGame.js';
import { LabPortals, transformPortalDirection, transformPortalPoint } from '../src/game/LabPortals.js';
import { LabPhysics } from '../src/game/LabPhysics.js';
import { LabCamera } from '../src/game/LabCamera.js';

const STEP = 1 / 120;
const colorHandle = () => ({ material: { color: new THREE.Color() } });

function addWall(game, x, y, z, width, height, depth, { kinematic = false, parent = game.scene } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z); parent.add(mesh); mesh.updateWorldMatrix(true, false);
  const collider = { mesh, box: new THREE.Box3().setFromObject(mesh), enabled: true, kinematic };
  game.colliders.push(collider); game.cameraBlockers.push(mesh); game.aimBlockers.push(mesh);
  game.physics?.addStaticBox(mesh.uuid, collider.box, { kinematic });
  return collider;
}

function addFloor(game, minX, maxX, minZ, maxZ, y) {
  const collider = addWall(game, (minX + maxX) / 2, y - .2, (minZ + maxZ) / 2, maxX - minX, .4, maxZ - minZ);
  game.floors.push({ minX, maxX, minZ, maxZ, y, mesh: collider.mesh });
  return collider;
}

function movingPlatform(game, x, z, width, depth, minY, maxY) {
  const group = new THREE.Group(); group.position.set(x, minY, z); game.scene.add(group);
  const collider = addWall(game, 0, -.18, 0, width, .36, depth, { parent: group, kinematic: true });
  const floor = { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2, y: minY, mesh: collider.mesh };
  game.floors.push(floor);
  return { group, mesh: collider.mesh, collider, floor, minY, maxY, y: minY, previousY: minY,
    position: new THREE.Vector3(x, minY, z), active: false, dwell: 0, progress: 0, links: [] };
}

// The fixture supplies only authored leaf extents; production updateDoors and
// syncCollision still animate and register the actual Three/Cannon colliders.
function slidingDoor(game, z) {
  const art = new THREE.Group(); art.position.z = z; game.scene.add(art);
  const mechanism = {
    progress: 0,
    update(progress) { this.progress = progress; },
    getLeafBoxes(progress = this.progress) {
      return [-1, 1].map(sign => {
        const center = sign * (1.55 + progress * 3.3);
        return new THREE.Box3(new THREE.Vector3(center - 1.55, 0, z - .19), new THREE.Vector3(center + 1.55, 5, z + .19));
      });
    },
  };
  const leafColliders = mechanism.getLeafBoxes().map(bounds => {
    const center = bounds.getCenter(new THREE.Vector3());
    return addWall(game, center.x, center.y, center.z, 3.1, 5, .38, { kinematic: true });
  });
  return { mesh: leafColliders[0].mesh, collider: leafColliders[0], leafColliders, art, mechanism, z,
    opened: false, progress: 0, previousProgress: 0, contact: 0, buttonRing: colorHandle() };
}

function fixture() {
  const scene = new THREE.Scene(), move = new THREE.Vector2();
  const game = new LabGame({ container: null, touch: false });
  Object.assign(game, {
    scene, state: 'playing', camera: new THREE.PerspectiveCamera(),
    playerGroup: new THREE.Group(), playerPosition: new THREE.Vector3(0, 0, 18),
    previousPlayerPosition: new THREE.Vector3(0, 0, 18), move, jumpQueued: false,
    audio: { tone() {}, jump() {}, pickup() {}, checkpoint() {}, win() {} },
    animator: { update() {}, reset() {}, trigger() {}, triggerLanding() {}, triggerInteraction() {}, triggerJump() {} },
    heldDevice: { update() {}, reset() {} }, companionAnimator: { update() {}, reset() {}, trigger() {} },
    cameraRig: { reset() {}, update() {} }, prompt: { textContent: '' },
    keyLight: { position: new THREE.Vector3(), target: { position: new THREE.Vector3() } },
    portals: new LabPortals({ scene }),
  });
  game.input = { keys: new Set(), getMove: () => move,
    consumeJump: () => { const value = game.jumpQueued; game.jumpQueued = false; return value; },
    consumePause: () => false, consumeRestart: () => false };
  addFloor(game, -12, 12, -51, 22, 0);
  const lift = movingPlatform(game, -6, -18.5, 3, 3, 0, 2.2);
  const barrierCollider = addWall(game, 0, 2.65, -15, 4, 5.3, .18, { kinematic: true });
  game.mechanisms = {
    bridges: [], terminals: [], lift,
    barrier: { mesh: barrierCollider.mesh, collider: barrierCollider, art: new THREE.Group(), indicator: colorHandle(),
      baseY: 2.65, artBaseY: .02, progress: 0, previousProgress: 0, opened: false, links: [] },
    chargePad: { position: new THREE.Vector3(-4, 0, -10), ring: colorHandle() },
    doorLinks: CHAMBERS.map(colorHandle),
  };
  game.doors = CHAMBERS.map(chamber => slidingDoor(game, chamber.end));
  game.physics = new LabPhysics();
  for (const collider of game.colliders) game.physics.addStaticBox(collider.mesh.uuid, collider.box, { kinematic: collider.kinematic });
  const group = new THREE.Group(); scene.add(group);
  game.cargo = { group, position: new THREE.Vector3(...CHAMBERS[0].cube), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  game.cubes = [game.cargo]; game.physics.createCargo({ position: game.cargo.position });
  game.close = () => { game.physics.dispose(); game.portals.dispose(); };
  return game;
}

function putCargo(game, x, y, z, velocity = [0, 0, 0]) {
  game.physics.resetCargo({ position: [x, y, z], velocity });
  game.cargo.position.set(x, y, z); game.cargo.group.position.copy(game.cargo.position); game.cargo.velocity.fromArray(velocity);
}

function run(game, seconds, method = 'updatePlaying') {
  for (let i = 0; i < Math.round(seconds / STEP); i++) game[method](STEP);
}

function openDoor(game, index) {
  const door = game.doors[index]; door.opened = true; door.progress = door.previousProgress = 1;
  game.updateDoors(0);
}

function portalPair(game) {
  const wall = addWall(game, 0, 3, 0, 20, 6, .4);
  game.portals.place(0, new THREE.Vector3(0, 1.6, .236), new THREE.Vector3(0, 0, 1));
  game.portals.place(1, new THREE.Vector3(8, 1.6, -10), new THREE.Vector3(1, 0, 0));
  game.portalSurfaceIds[0] = wall.mesh.uuid;
}

test('walking and sprinting stop at walls while diagonal motion can slide', () => {
  for (const sprint of [false, true]) {
    const game = fixture(); addWall(game, 0, 3, 0, 20, 6, .4);
    game.playerPosition.set(0, 0, 2); game.move.set(.5, -1).normalize();
    if (sprint) game.input.keys.add('ShiftLeft');
    run(game, 1.5, 'updatePlayer');
    assert.ok(game.playerPosition.z >= .629); assert.ok(game.playerPosition.x > 1, 'contact preserves tangential motion');
    assert.ok(Math.abs(game.playerVelocity.z) < .001); assert.equal(game.teleportCount, 0); game.close();
  }
});

test('ordinary gun fire places a portal without activating aim or moving the camera', () => {
  const game = fixture();
  const panel = addWall(game, 0, 3, 10, 12, 6, .2).mesh;
  Object.assign(panel.userData, { portalable: true, collisionProxy: true,
    center: new THREE.Vector3(0, 3, 10.1), normal: new THREE.Vector3(0, 0, 1) });
  panel.visible = false;
  game.camera = new THREE.PerspectiveCamera(62, 16 / 9, .06, 160);
  game.cameraRig = new LabCamera({ camera: game.camera, blockers: game.cameraBlockers,
    isBlocker: object => game.isActiveBlocker(object) });
  game.pitch = 0; game.cameraRig.reset(game.playerPosition, game.yaw, game.pitch);
  let shots = 0; game.heldDevice.fire = () => { shots++; };
  for (let i = 0; i < 180; i++) game.updateVisuals(1 / 60, 1);
  const position = game.camera.position.clone(), orientation = game.camera.quaternion.clone(), fov = game.camera.fov;
  assert.equal(game.isAiming(), false);
  assert.equal(game.placePortal(0), true, 'the production raycast must hit an invisible white-panel proxy');
  assert.equal(shots, 1); assert.equal(game.isAiming(), false);
  assert.equal(game.portalSurfaceIds[0], panel.uuid);
  for (let i = 0; i < 60; i++) {
    game.updatePlaying(STEP); game.updatePlaying(STEP); game.updateVisuals(1 / 60, 1);
    assert.equal(game.isAiming(), false);
    assert.ok(game.camera.position.distanceTo(position) < 1e-6, 'shot displaced the whole camera');
    assert.ok(game.camera.quaternion.angleTo(orientation) < 1e-6, 'shot rotated the whole camera');
    assert.ok(Math.abs(game.camera.fov - fov) < 1e-7, 'shot changed field of view');
  }
  game.input.keys.add('KeyF');
  assert.equal(game.isAiming(), true, 'explicit aim must still work'); game.close();
});

test('game placement retains free hit coordinates and permits separate portals on one white panel', () => {
  const game = fixture();
  const panel = addWall(game, 0, 3, 10, 12, 6, .2).mesh;
  Object.assign(panel.userData, { portalable: true, center: new THREE.Vector3(0, 3, 10.1), normal: new THREE.Vector3(0, 0, 1) });
  const left = new THREE.Vector3(-3.1, 2.2, 10.1), right = new THREE.Vector3(3.2, 3.8, 10.1);
  assert.equal(game.placeOnPanel(0, panel, left), true); assert.equal(game.placeOnPanel(1, panel, right), true);
  assert.ok(game.portals.portals[0].position.distanceTo(left) < 1e-8);
  assert.ok(game.portals.portals[1].position.distanceTo(right) < 1e-8);
  assert.equal(game.portalSurfaceIds[0], game.portalSurfaceIds[1]);
  const exit = game.portals.portals[1];
  assert.equal(game.placeOnPanel(1, panel, left), false);
  assert.equal(game.portals.portals[1], exit); game.close();
});

test('an unladen player crosses the portal centre but the aperture edge stays solid', () => {
  for (const x of [0, 1]) {
    const game = fixture(); portalPair(game); putCargo(game, 5, .4, 10);
    const body = game.physics.cargoBody, group = game.cargo.group;
    game.playerPosition.set(x, 0, 1); game.move.set(0, -1);
    for (let i = 0; i < 180 && !game.teleportCount; i++) game.updatePlaying(STEP);
    if (x === 0) {
      assert.equal(game.teleportCount, 1);
      assert.ok(game.playerPosition.x >= game.portals.portals[1].position.x + .43 + .025 - 1e-7);
      assert.ok(Math.abs(game.yaw + Math.PI / 2) < 1e-7); assert.ok(game.playerVelocity.x > 0);
    } else { assert.equal(game.teleportCount, 0); assert.ok(game.playerPosition.z >= .629); }
    assert.equal(game.physics.cargoBody, body); assert.equal(game.cargo.group, group);
    assert.ok(game.cargo.position.distanceTo(new THREE.Vector3(5, .39, 10)) < .03, 'cargo stays at its physical location');
    game.close();
  }
});

test('player and held companion share one portal transform without replacing the rigid body', () => {
  const game = fixture(); portalPair(game);
  game.playerPosition.set(0, 0, 1.5); game.facing = Math.PI;
  putCargo(game, 0, 1.06, .78); game.heldCube = game.cargo;
  const body = game.physics.cargoBody, cargo = game.cargo, group = cargo.group;
  const originalTeleport = game.physics.teleportCargo.bind(game.physics); let transformed = 0;
  game.physics.teleportCargo = args => {
    const sample = () => {
      const value = game.physics.sample(1);
      return { position: new THREE.Vector3().copy(value.position), velocity: new THREE.Vector3().copy(value.velocity),
        angularVelocity: new THREE.Vector3().copy(value.angularVelocity), quaternion: new THREE.Quaternion().copy(value.quaternion) };
    };
    const before = sample(), entry = game.portals.portals[0], exit = game.portals.portals[1];
    const relativeBefore = before.position.clone().sub(game.playerPosition.clone().add(new THREE.Vector3(0, 1.2, 0)));
    originalTeleport(args); transformed++;
    const after = sample();
    assert.ok(after.velocity.distanceTo(transformPortalDirection(before.velocity, entry, exit)) < 1e-8, 'portal changed momentum magnitude');
    assert.ok(after.angularVelocity.distanceTo(transformPortalDirection(before.angularVelocity, entry, exit)) < 1e-8);
    assert.ok(after.quaternion.angleTo(before.quaternion.clone().premultiply(args.rotation)) < 1e-7);
    const transformedPlayer = transformPortalPoint(game.playerPosition.clone().add(new THREE.Vector3(0, 1.2, 0)), entry, exit);
    const shift = args.position.clone().sub(transformPortalPoint(before.position, entry, exit));
    assert.ok(after.position.clone().sub(transformedPlayer.add(shift)).distanceTo(relativeBefore.applyQuaternion(args.rotation)) < 1e-7,
      'held object lost its relative placement during the warp');
  };
  game.move.set(0, -1);
  for (let i = 0; i < 240 && !game.teleportCount; i++) {
    game.updatePlaying(STEP);
    assert.equal(game.heldCube, cargo); assert.equal(game.physics.cargoBody, body); assert.equal(game.cargo.group, group);
  }
  assert.equal(game.teleportCount, 1); assert.equal(transformed, 1);
  assert.ok(game.playerPosition.x >= game.portals.portals[1].position.x + .43 + .025 - 1e-7);
  assert.ok(game.cargo.position.x > game.playerPosition.x);
  assert.ok(game.cargo.position.distanceTo(game.playerPosition.clone().add(new THREE.Vector3(0, 1.06, 0))) < 1);
  run(game, .5);
  assert.equal(game.heldCube, cargo); assert.equal(game.cargo.group.visible, true); assert.equal(game.cubes.length, 1);
  assert.ok(game.playerPosition.x > 9.5 && game.cargo.position.x > 10, 'both continued walking on the exit side');
  game.close();
});

test('the same held companion crosses a doorway in both directions without disappearing', () => {
  const game = fixture(); openDoor(game, 0);
  game.playerPosition.set(0, 0, -2); game.previousPlayerPosition.copy(game.playerPosition);
  putCargo(game, 0, 1.06, -2.82); game.heldCube = game.cargo; game.move.set(0, -1);
  const body = game.physics.cargoBody, cargo = game.cargo, uuid = cargo.group.uuid;
  let previous = cargo.position.clone();
  for (let i = 0; i < 150; i++) {
    game.updatePlaying(STEP); game.updateVisuals(STEP, 1);
    assert.equal(game.heldCube, cargo); assert.equal(game.physics.cargoBody, body);
    assert.equal(cargo.group.uuid, uuid); assert.equal(cargo.group.visible, true);
    assert.ok(cargo.position.distanceTo(previous) < .12, 'room transitions cannot snap cargo'); previous.copy(cargo.position);
  }
  assert.equal(game.stage, 1); assert.equal(game.cubes.length, 1);
  game.move.set(0, 1); run(game, 1.5);
  assert.equal(game.stage, 0); assert.equal(game.heldCube, cargo); game.close();
});

test('settled weight opens sliding leaves; removing weight closes them with the frame fixed', () => {
  const game = fixture(), door = game.doors[0], pad = CHAMBERS[0].button;
  const framePosition = door.art.position.clone();
  putCargo(game, pad[0], .4, pad[2]); game.cargo.velocity.set(4, 0, 0);
  run(game, .7, 'updateDoors'); assert.equal(door.opened, false, 'a fast pass does not latch');
  game.cargo.velocity.set(0, 0, 0); game.heldCube = game.cargo;
  run(game, .7, 'updateDoors'); assert.equal(door.opened, false, 'a held object is not weight on the switch');
  game.heldCube = null; run(game, .1, 'updateDoors'); assert.equal(door.opened, false);
  for (let i = 0; i < 30 && !door.opened; i++) game.updateDoors(STEP);
  assert.equal(door.opened, true);
  const push = () => {
    const position = new THREE.Vector3(0, 0, door.z + .3);
    game.resolveBody(position, new THREE.Vector3(0, 0, door.z + 1), new THREE.Vector3(0, 0, -4), .43, 2.4);
    return position.z;
  };
  assert.ok(push() >= door.z + .59, 'a newly activated door remains solid');
  run(game, 1.5, 'updateDoors');
  assert.equal(door.opened, true, 'weight holds the circuit open');
  assert.ok(door.leafColliders[0].box.max.x < -.5 && door.leafColliders[1].box.min.x > .5, 'leaves move sideways clear of the capsule');
  assert.ok(door.leafColliders.every(collider => collider.box.min.y === 0 && collider.box.max.y === 5 && collider.enabled));
  assert.ok(door.art.position.equals(framePosition), 'the entire door model must not travel upward');
  assert.ok(Math.abs(push() - (door.z + .3)) < .001);
  putCargo(game, 5, .4, 8); run(game, 1.5, 'updateDoors');
  assert.equal(door.opened, false, 'removing weight must immediately release the circuit');
  assert.ok(door.progress < .003, 'unoccupied doorway closes again');
  assert.ok(push() >= door.z + .59); game.close();
});

test('pickup requires line of sight, including invisible collision proxies', () => {
  const game = fixture(); const wall = addWall(game, 0, 2, 0, 10, 4, .3); wall.mesh.visible = false;
  game.playerPosition.set(0, 0, 1); putCargo(game, 0, 1.06, -1);
  assert.equal(game.toggleCube(), false); assert.equal(game.heldCube, null);
  game.cameraBlockers = game.cameraBlockers.filter(mesh => mesh !== wall.mesh);
  assert.equal(game.toggleCube(), true); assert.equal(game.heldCube, game.cargo); game.close();
});

test('an opened energy field stops blocking pickup, carry targets and the camera; closing restores them', () => {
  const game = fixture(), barrier = game.mechanisms.barrier;
  barrier.mesh.visible = false; barrier.mesh.userData.collisionProxy = true;
  game.playerPosition.set(0, 0, -14); game.facing = Math.PI;
  putCargo(game, 0, 1.06, -16);
  assert.equal(game.toggleCube(), false, 'a closed invisible field must still block pickup');
  putCargo(game, -4, .4, -10); run(game, 1.5, 'updateMechanisms');
  putCargo(game, 0, 1.06, -16);
  assert.equal(barrier.collider.enabled, false);
  assert.equal(game.toggleCube(), true, 'the disabled field cannot remain an invisible interaction wall');
  game.playerPosition.set(0, 0, -14.5); putCargo(game, 0, 1.06, -14.7); game.heldCube = game.cargo;
  game.updateCubes(STEP);
  assert.ok(Math.abs(game.physics.carryTarget.position.z + 15.22) < 1e-8, 'the carry target must extend naturally through the open field');
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, .06, 160);
  const rig = new LabCamera({ camera, blockers: game.cameraBlockers, isBlocker: object => game.isActiveBlocker(object) });
  rig.reset(new THREE.Vector3(0, 0, -16), 0, -.15);
  assert.equal(rig.obstructed, false); assert.ok(rig.distance > 6.2, 'camera collapsed against a deactivated field');
  game.heldCube = null; game.playerPosition.set(3, 0, -14); putCargo(game, 3, .4, -16);
  run(game, 1.5, 'updateMechanisms');
  assert.equal(barrier.collider.enabled, true);
  game.playerPosition.set(0, 0, -14); putCargo(game, 0, 1.06, -16);
  assert.equal(game.toggleCube(), false, 'closing must restore interaction collision');
  rig.reset(new THREE.Vector3(0, 0, -16), 0, -.15);
  assert.equal(rig.obstructed, true); assert.ok(rig.distance < 1, 'closing must restore camera collision');
  game.close();
});

test('drop preserves pose and momentum and cannot pass through a nearby wall', () => {
  const game = fixture(); addWall(game, 0, 3, 0, 10, 6, .4);
  game.playerPosition.set(0, 0, 1.65); game.facing = Math.PI;
  putCargo(game, 0, 1.06, .84); game.heldCube = game.cargo; run(game, .6, 'updateCubes');
  const before = game.physics.sample(1); assert.equal(game.toggleCube(), true); const after = game.physics.sample(1);
  assert.deepEqual(after.position, before.position); assert.deepEqual(after.quaternion, before.quaternion);
  assert.deepEqual(after.velocity, before.velocity); assert.deepEqual(after.angularVelocity, before.angularVelocity);
  run(game, 2, 'updateCubes');
  assert.ok(game.cargo.position.z > .56); assert.ok(Math.abs(game.cargo.position.y - .39) < .015, `drop settled at ${game.cargo.position.toArray()}`);
  assert.equal(game.cubes.length, 1); game.close();
});

test('player collision climbs 35 cm steps and respects ceilings', () => {
  const game = fixture();
  addFloor(game, -2, 2, 0, .7, .35); addFloor(game, -2, 2, .7, 1.4, .7); addFloor(game, -2, 2, 1.4, 2.6, 1.05);
  game.playerPosition.set(0, 0, -.6); game.move.set(0, 1); run(game, .72, 'updatePlayer');
  assert.ok(game.playerPosition.z > 1.4); assert.ok(game.playerPosition.y >= 1.049, 'capsule climbs connected steps');
  assert.equal(game.playerGrounded, true);
  game.move.set(0, 0); game.playerVelocity.set(0, 0, 0); game.playerPosition.set(5, 0, 8);
  addWall(game, 5, 2.9, 8, 4, .4, 4); game.jumpQueued = true; let maxY = 0;
  for (let i = 0; i < 90; i++) { game.updatePlayer(STEP); maxY = Math.max(maxY, game.playerPosition.y); }
  assert.ok(maxY > .15 && maxY <= .301, `jump must stop at ceiling: ${maxY}`); game.close();
});

test('the player jumps onto a 1.1 m tabletop, lands on its collider and remains supported', () => {
  const game = fixture();
  const table = addWall(game, 0, 1.02, 5, 3, .16, 3);
  for (const x of [-1.15, 1.15]) for (const z of [3.85, 6.15]) addWall(game, x, .47, z, .2, .94, .2);
  game.playerPosition.set(0, 0, 7.5); game.move.set(0, -1);
  run(game, .7, 'updatePlayer');
  assert.ok(game.playerPosition.z >= 6.929, 'walking must not auto-step onto a table');
  assert.equal(game.playerPosition.y, 0);
  let jumps = 0, landings = 0, maxY = 0;
  game.animator.triggerJump = () => { jumps++; };
  game.animator.triggerLanding = impact => { assert.ok(impact > 1); landings++; };
  game.jumpQueued = true;
  for (let i = 0; i < 96; i++) {
    game.updatePlayer(STEP); maxY = Math.max(maxY, game.playerPosition.y);
  }
  game.move.set(0, 0); run(game, .5, 'updatePlayer');
  assert.equal(jumps, 1); assert.ok(landings >= 1);
  assert.ok(maxY > 1.4 && maxY < 1.6, `the jump needs usable table clearance: ${maxY}`);
  assert.ok(game.playerPosition.z > 3.5 && game.playerPosition.z < 6.5, 'player actually landed over the tabletop');
  assert.ok(Math.abs(game.playerPosition.y - table.box.max.y) < .001, 'support must come from the tabletop collider');
  assert.equal(game.playerGrounded, true); assert.equal(game.playerVelocity.y, 0); game.close();
});

test('a loaded lift raises the player smoothly and supports the unheld companion', () => {
  const game = fixture(), lift = game.mechanisms.lift;
  game.playerPosition.set(-6.6, 0, -18.5); game.previousPlayerPosition.copy(game.playerPosition);
  putCargo(game, -5.45, .41, -18.5); let previous = game.playerPosition.y;
  for (let i = 0; i < 720; i++) {
    game.updatePlaying(STEP);
    assert.ok(Math.abs(game.playerPosition.y - previous) < .05, 'player cannot pop to the final lift height'); previous = game.playerPosition.y;
  }
  assert.ok(lift.y > 2.18); assert.ok(game.playerPosition.y > 2.18);
  assert.ok(Math.abs(game.cargo.position.y - (lift.y + .39)) < .035, 'rigid cargo rides the same platform');
  assert.equal(game.playerGrounded, true); game.close();
});

test('player recovery leaves cargo at its actual location and preserves completed mechanisms', () => {
  const game = fixture(); game.stage = 1; openDoor(game, 0); game.mechanisms.barrier.opened = true;
  putCargo(game, 8, .4, 8); const body = game.physics.cargoBody, position = game.cargo.position.clone();
  game.heldCube = game.cargo; game.playerPosition.set(2, -13, -8); game.respawn();
  assert.deepEqual(game.playerPosition.toArray(), CHAMBERS[1].start);
  assert.equal(game.heldCube, null); assert.equal(game.physics.cargoBody, body); assert.ok(game.cargo.position.equals(position));
  assert.equal(game.doors[0].opened, true); assert.equal(game.mechanisms.barrier.opened, true); assert.equal(game.stage, 1); game.close();
});

test('animations update once per game frame while simulation remains at 120 Hz', () => {
  for (const hz of [30, 60, 144]) {
    const game = fixture(); let steps = 0, animations = 0, renders = 0;
    game.updatePlaying = dt => { assert.equal(dt, STEP); steps++; };
    game.updateVisuals = (dt, alpha) => { assert.ok(alpha >= 0 && alpha <= 1.000001); animations++; };
    game.render = () => { renders++; }; game.lastFrame = 0;
    for (let frame = 1; frame <= hz; frame++) game.animate(frame * 1000 / hz);
    assert.equal(steps, 120); assert.equal(animations, hz); assert.equal(renders, hz); game.close();
  }
});

test('finishing requires the companion at the exit, not merely an opened last door', () => {
  const game = fixture(); openDoor(game, 2); game.playerPosition.set(0, 0, -49);
  let wins = 0; game.win = () => { wins++; };
  putCargo(game, 0, .4, -44); game.updatePlaying(STEP); assert.equal(wins, 0);
  putCargo(game, 0, .4, -47.5); game.updatePlaying(STEP); assert.equal(wins, 1);
  assert.equal(game.cubes.length, 1); game.close();
});

test('a floor portal in a pressure pad retrieves the SAME loose companion and closes the door', () => {
  const game = fixture(), pad = CHAMBERS[0].button;
  const top = addWall(game, pad[0], .07, pad[2], 3.3, .14, 4).mesh;
  game.markPortalSurface(top, new THREE.Vector3(pad[0], .15, pad[2]), new THREE.Vector3(0, 1, 0), 1.65, 2);
  const floor = game.floors[0].mesh;
  game.markPortalSurface(floor, new THREE.Vector3(0, .012, -14.5), new THREE.Vector3(0, 1, 0), 12, 36.5);
  putCargo(game, pad[0], .65, pad[2]); run(game, 1);
  assert.equal(game.doors[0].opened, true);
  assert.equal(game.placeOnPanel(1, floor, new THREE.Vector3(0, .012, -6)), true);
  assert.equal(game.placeOnPanel(0, top, top.userData.center), true);
  const body = game.physics.cargoBody;
  for (let i = 0; i < 120 && game.physics.portalTransports === 0; i++) game.updatePlaying(STEP);
  assert.equal(game.physics.portalTransports, 1, 'free weight must fall through its own plate');
  assert.ok(game.cargo.position.z < -5); assert.equal(game.physics.cargoBody, body);
  game.playerPosition.set(0, 0, -5.1); game.facing = Math.PI;
  assert.equal(game.toggleCube(), true); run(game, 1.5);
  assert.equal(game.heldCube, game.cargo); assert.equal(game.doors[0].opened, false);
  assert.ok(game.doors[0].progress < .01); game.close();
});

test('the player can enter a floor portal while carrying and leave a wall portal together', () => {
  const game = fixture(), floor = game.floors[0].mesh;
  game.markPortalSurface(floor, new THREE.Vector3(0, .012, -14.5), new THREE.Vector3(0, 1, 0), 12, 36.5);
  assert.equal(game.placeOnPanel(0, floor, new THREE.Vector3(0, .012, 18)), true);
  game.portals.place(1, new THREE.Vector3(8, 1.6, 5), new THREE.Vector3(-1, 0, 0));
  putCargo(game, 0, 1.06, 17.28); game.heldCube = game.cargo;
  const body = game.physics.cargoBody;
  for (let i = 0; i < 150 && !game.teleportCount; i++) game.updatePlaying(STEP);
  assert.equal(game.teleportCount, 1, 'the floor must open under the full player capsule');
  assert.equal(game.heldCube, game.cargo); assert.equal(game.physics.cargoBody, body);
  assert.ok(game.playerPosition.x < 7.5); assert.ok(game.playerPosition.distanceTo(game.cargo.position) < 2.5);
  assert.ok(game.playerVelocity.x < -1); game.close();
});

test('launch pad accepts a carrying player and a loose companion; firing stays disabled while held', () => {
  const game = fixture(); game.stage = 2; game.launchTime = 0;
  game.playerPosition.set(0, 0, -31.5); putCargo(game, 0, 1.06, -32.22); game.heldCube = game.cargo;
  assert.equal(game.placePortal(0), false);
  game.updatePlaying(STEP);
  assert.ok(game.playerVelocity.y > 9); assert.ok(game.playerVelocity.z < -9);
  assert.equal(game.heldCube, game.cargo);
  game.physics.release(); game.heldCube = null; game.playerPosition.set(4, 0, -30);
  putCargo(game, 0, .39, -31.5); game.physics.grounded = true; game.cargoLaunchCooldown = 0;
  game.updateCubes(STEP);
  assert.ok(game.cargo.velocity.y > 9); assert.ok(game.cargo.velocity.z < -9); game.close();
});

test('a closing doorway waits for the player then closes when the opening is clear', () => {
  const game = fixture(), door = game.doors[0];
  door.opened = true; door.progress = door.previousProgress = 1;
  game.playerPosition.set(0, 0, door.z); putCargo(game, 5, .4, 8);
  run(game, 1, 'updateDoors');
  assert.equal(door.opened, false); assert.ok(door.progress > .99, 'safety sensor protects a crossing');
  game.playerPosition.z -= 2; run(game, 1.5, 'updateDoors');
  assert.ok(door.progress < .003); game.close();
});
