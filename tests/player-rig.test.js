import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PLAYER_BONE_INDEX,
  PLAYER_RIG_SPEC,
  createPlayerRig,
  resolvePlayerSkin,
} from '../src/game/PlayerRig.js';
import { PlayerAnimator } from '../src/game/FullBodyPlayerAnimator.js';

const influenceMap = (x, y, z) => {
  const { indices, weights } = resolvePlayerSkin(x, y, z);
  return Object.fromEntries([...indices].map((index, slot) => [index, weights[slot]]));
};

const makeAnimator = ({ modelScale = 1 } = {}) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.2, 0, -0.5,
    0.2, 0, -0.5,
    0, 0, -0.7,
  ], 3));
  const visual = new THREE.Group();
  const modelSpace = new THREE.Group();
  modelSpace.scale.setScalar(modelScale);
  modelSpace.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  visual.add(modelSpace);
  const root = new THREE.Group();
  root.add(visual);
  const carrier = new THREE.Group();
  const world = new THREE.Group();
  world.add(root, carrier);
  const animator = new PlayerAnimator({ visual, carrier });
  animator.snapCarrierToBody();
  return { animator, visual, carrier, root, world };
};

test('player skin weights stay normalized across anatomical landmarks', () => {
  const landmarks = [
    [-0.12, 0, -1], [0, 0.12, -0.91], [-0.23, 0.02, -0.36],
    [0.1, 0.04, -0.06], [0, -0.3, -0.6], [0, 0, -0.42],
  ];
  for (const landmark of landmarks) {
    const { weights } = resolvePlayerSkin(...landmark);
    const total = [...weights].reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-6, `weights at ${landmark.join(',')} sum to ${total}`);
    assert.ok([...weights].every((weight) => weight >= 0 && weight <= 1));
  }
});

test('ears, hands, feet and cape use independent bones', () => {
  assert.ok(influenceMap(-0.12, 0, -1)[PLAYER_BONE_INDEX.EarL] > 0.5);
  assert.ok(influenceMap(0.12, 0, -1)[PLAYER_BONE_INDEX.EarR] > 0.5);
  assert.ok(influenceMap(-0.23, 0.02, -0.35)[PLAYER_BONE_INDEX.HandL] > 0);
  assert.equal(influenceMap(0.11, 0.03, -0.06)[PLAYER_BONE_INDEX.FootR], 1);
  assert.ok(influenceMap(0, -0.3, -0.6)[PLAYER_BONE_INDEX.Cape] > 0.5);
  const shoulder = influenceMap(-0.17, 0, -0.65);
  assert.ok(shoulder[PLAYER_BONE_INDEX.Chest] > 0, 'shoulder must retain chest influence');
  assert.ok(shoulder[PLAYER_BONE_INDEX.UpperArmL] > 0, 'shoulder must blend into the upper arm');
});

test('runtime rig creates a skeleton and bone rotation deforms vertices', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.22, 0, -0.48, -0.23, 0, -0.42, -0.18, 0, -0.58,
  ], 3));
  const source = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const visual = new THREE.Group();
  visual.add(source);
  const rig = createPlayerRig(visual);
  assert.equal(rig.mesh.isSkinnedMesh, true);
  assert.equal(rig.skeleton.bones.length, PLAYER_RIG_SPEC.length);
  assert.ok(rig.mesh.geometry.getAttribute('skinIndex'));
  assert.ok(rig.mesh.geometry.getAttribute('skinWeight'));
  visual.updateMatrixWorld(true);
  const before = rig.mesh.getVertexPosition(0, new THREE.Vector3()).clone();
  rig.bones.UpperArmL.rotation.x = 0.65;
  visual.updateMatrixWorld(true);
  rig.skeleton.update();
  const after = rig.mesh.getVertexPosition(0, new THREE.Vector3()).clone();
  assert.ok(before.distanceTo(after) > 0.01);
});

test('runtime rig preserves the exact source appearance in its bind pose', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.21, 0.03, -0.51,
    0.19, -0.02, -0.49,
    0.02, 0.01, -0.72,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0.5, 1,
  ], 2));
  geometry.setIndex([0, 1, 2]);
  const sourcePositions = geometry.getAttribute('position').array.slice();
  const sourceNormals = geometry.getAttribute('normal').array.slice();
  const sourceUvs = geometry.getAttribute('uv').array.slice();
  const sourceIndices = geometry.index.array.slice();
  const material = new THREE.MeshStandardMaterial({ color: 0x2678ff });
  const visual = new THREE.Group();
  visual.add(new THREE.Mesh(geometry, material));

  const rig = createPlayerRig(visual);
  visual.updateMatrixWorld(true, true);
  rig.skeleton.update();

  assert.strictEqual(rig.mesh.material, material, 'player material must not be replaced');
  assert.deepEqual([...rig.mesh.geometry.getAttribute('position').array], [...sourcePositions]);
  assert.deepEqual([...rig.mesh.geometry.getAttribute('normal').array], [...sourceNormals]);
  assert.deepEqual([...rig.mesh.geometry.getAttribute('uv').array], [...sourceUvs]);
  assert.deepEqual([...rig.mesh.geometry.index.array], [...sourceIndices]);
  for (let vertex = 0; vertex < sourcePositions.length / 3; vertex += 1) {
    const bindPosition = rig.mesh.getVertexPosition(vertex, new THREE.Vector3());
    const sourcePosition = new THREE.Vector3().fromArray(sourcePositions, vertex * 3);
    assert.ok(bindPosition.distanceTo(sourcePosition) < 1e-7, `bind pose changed vertex ${vertex}`);
  }
});

test('a polygon crossing an anatomical transition receives smooth normalized weights', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.17, 0.01, -0.64,
    -0.19, -0.02, -0.61,
    -0.17, 0.02, -0.58,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  const visual = new THREE.Group();
  visual.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  const rig = createPlayerRig(visual);
  const skinWeight = rig.mesh.geometry.getAttribute('skinWeight');
  for (let vertex = 0; vertex < 3; vertex += 1) {
    const weights = [
      skinWeight.getX(vertex), skinWeight.getY(vertex),
      skinWeight.getZ(vertex), skinWeight.getW(vertex),
    ];
    assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-6);
    assert.ok(weights.filter((weight) => weight > 0).length >= 2, `vertex ${vertex} snapped to one bone`);
  }
});

test('carry IK reaches both named grip points', () => {
  const { animator, visual } = makeAnimator();
  for (let frame = 0; frame < 30; frame += 1) {
    animator.update(1 / 60, frame / 60, { grounded: true, hasCargo: true });
  }
  visual.updateWorldMatrix(true, true);
  for (const side of ['L', 'R']) {
    const target = animator.getCarryGripTarget(side).clone();
    const hand = animator.bones[`Hand${side}`].localToWorld(new THREE.Vector3());
    assert.ok(hand.distanceTo(target) < 0.02, `${side} hand missed grip by ${hand.distanceTo(target)}`);
  }
});

test('planted feet stay within two centimeters of their world locks', () => {
  const { animator, root, world } = makeAnimator();
  for (let frame = 0; frame < 30; frame += 1) {
    animator.update(1 / 60, frame / 60, { grounded: true, planarSpeed: 0 });
  }
  for (let frame = 0; frame < 8; frame += 1) {
    root.position.z += 0.003;
    world.updateMatrixWorld(true);
    animator.update(1 / 60, (30 + frame) / 60, {
      grounded: true,
      planarSpeed: 0,
      planarVelocity: new THREE.Vector3(),
    });
  }
  for (const side of ['L', 'R']) {
    const foot = animator.bones[`Foot${side}`].getWorldPosition(new THREE.Vector3());
    assert.ok(
      foot.distanceTo(animator.footLockTarget[side]) < 0.02,
      `${side} planted foot drifted ${foot.distanceTo(animator.footLockTarget[side])}`,
    );
  }
});

test('carry IK keeps both elbows aligned to their pole vectors', () => {
  const { animator, visual } = makeAnimator();
  for (let frame = 0; frame < 30; frame += 1) {
    animator.update(1 / 60, frame / 60, { grounded: true, hasCargo: true });
  }
  visual.updateWorldMatrix(true, true);
  for (const side of ['L', 'R']) {
    const root = animator.bones[`UpperArm${side}`].getWorldPosition(new THREE.Vector3());
    const elbow = animator.bones[`LowerArm${side}`].getWorldPosition(new THREE.Vector3());
    const hand = animator.bones[`Hand${side}`].getWorldPosition(new THREE.Vector3());
    const pole = animator.getArmPoleTarget(side, new THREE.Vector3());
    const axis = hand.clone().sub(root).normalize();
    const elbowPlane = elbow.clone().sub(root);
    elbowPlane.addScaledVector(axis, -elbowPlane.dot(axis)).normalize();
    const polePlane = pole.clone().sub(root);
    polePlane.addScaledVector(axis, -polePlane.dot(axis)).normalize();
    assert.ok(elbowPlane.dot(polePlane) > 0.9, `${side} elbow crossed its bend plane`);
  }
});

test('movement start and stop impulses settle into stable locomotion states', () => {
  const { animator } = makeAnimator();
  const forward = new THREE.Vector3(0, 0, 1.5);

  animator.update(1 / 60, 0, {
    grounded: true,
    planarSpeed: 1.5,
    planarVelocity: forward,
    desiredSpeed: 8,
  });
  assert.equal(animator.state, 'move_start');

  for (let frame = 1; frame <= 24; frame += 1) {
    animator.update(1 / 60, frame / 60, {
      grounded: true,
      planarSpeed: 4,
      planarVelocity: new THREE.Vector3(0, 0, 4),
      desiredSpeed: 8,
    });
  }
  assert.equal(animator.state, 'walk');

  animator.update(1 / 60, 25 / 60, {
    grounded: true,
    planarSpeed: 3,
    planarVelocity: new THREE.Vector3(0, 0, 3),
    desiredSpeed: 0,
  });
  assert.equal(animator.state, 'move_stop');

  for (let frame = 26; frame <= 50; frame += 1) {
    animator.update(1 / 60, frame / 60, {
      grounded: true,
      planarSpeed: 0,
      planarVelocity: new THREE.Vector3(),
      desiredSpeed: 0,
    });
  }
  assert.equal(animator.state, 'idle');
});

test('foot IK stays deformation-safe during a hard stop', () => {
  const { animator, world } = makeAnimator({ modelScale: 2.25 });
  const solveTwoBoneIK = animator.solveTwoBoneIK.bind(animator);
  let maximumLegInfluence = 0;
  animator.solveTwoBoneIK = (...parameters) => {
    if (parameters[0].startsWith('UpperLeg')) {
      maximumLegInfluence = Math.max(maximumLegInfluence, parameters[4]);
    }
    return solveTwoBoneIK(...parameters);
  };

  animator.phase = 0;
  for (let frame = 0; frame < 45; frame += 1) {
    world.updateMatrixWorld(true);
    animator.applyFootIK('move_stop', true, 1 / 60);
  }

  assert.ok(maximumLegInfluence > 0.1, 'foot IK never became active');
  assert.ok(maximumLegInfluence <= 0.421, `foot IK over-corrected by ${maximumLegInfluence}`);
});

test('state transition preserves finite rotations under a physics spike', () => {
  const { animator } = makeAnimator();
  animator.update(0.2, 0, {
    planarSpeed: 8.7,
    planarVelocity: new THREE.Vector3(8.7, 0, 0),
    grounded: true,
  });
  for (const spring of Object.values(animator.joints)) {
    assert.ok(Number.isFinite(spring.value.x));
    assert.ok(Number.isFinite(spring.value.y));
    assert.ok(Number.isFinite(spring.value.z));
    assert.ok(spring.velocity.length() <= spring.maxVelocity + 1e-6);
  }
});

test('throw keeps the grip through windup and releases it during follow-through', () => {
  const { animator, visual } = makeAnimator();
  for (let frame = 0; frame < 30; frame += 1) {
    animator.update(1 / 60, frame / 60, { grounded: true, hasCargo: true });
  }
  animator.triggerInteraction('throw');
  for (let frame = 0; frame < 10; frame += 1) {
    animator.update(1 / 60, (30 + frame) / 60, { grounded: true, hasCargo: true });
  }
  visual.updateWorldMatrix(true, true);
  let grip = animator.getCarryGripTarget('R').clone();
  let hand = animator.bones.HandR.localToWorld(new THREE.Vector3());
  assert.ok(hand.distanceTo(grip) < 0.04, 'windup must retain the cargo grip');

  for (let frame = 0; frame < 25; frame += 1) {
    animator.update(1 / 60, (40 + frame) / 60, { grounded: true, hasCargo: true });
  }
  visual.updateWorldMatrix(true, true);
  grip = animator.getCarryGripTarget('R').clone();
  hand = animator.bones.HandR.localToWorld(new THREE.Vector3());
  assert.ok(hand.distanceTo(grip) > 0.1, 'follow-through must release the cargo grip');
});
