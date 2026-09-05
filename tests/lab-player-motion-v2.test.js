import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LAB_PLAYER_JOINTS, LabPlayerAnimator } from '../src/game/LabPlayerAnimator.js';

function makeAnimator() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.25, 0.025, -0.34, 0.26, 0.025, -0.34,
    -0.11, 0.01, -0.20, 0.12, 0.01, -0.20,
    0, -0.25, -0.52, 0, 0.15, -0.78,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1, 0.5, 0, 0.5, 1], 2));
  const root = new THREE.Group();
  root.position.set(2, 3, -4);
  root.rotation.y = 0.7;
  const visual = new THREE.Group();
  visual.scale.setScalar(2.3);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.rotation.x = Math.PI / 2;
  visual.add(mesh);
  const carrier = new THREE.Group();
  root.add(visual, carrier);
  const states = [];
  const animator = new LabPlayerAnimator({ visual, carrier, onStateChange: ({ state }) => states.push(state) });
  return { animator, root, visual, carrier, geometry, states };
}

function advance(animator, frames, input = {}) {
  for (let i = 0; i < frames; i += 1) animator.update({ dt: 1 / 60, ...input });
}

function localHand(animator, side) {
  return animator.rig.mesh.worldToLocal(animator.bones[`Hand${side}`].getWorldPosition(new THREE.Vector3()));
}

function assertFinitePose(animator) {
  for (const bone of Object.values(animator.bones)) {
    assert.ok(bone.position.toArray().every(Number.isFinite), `${bone.name} position became non-finite`);
    assert.ok(bone.quaternion.toArray().every(Number.isFinite), `${bone.name} rotation became non-finite`);
    assert.ok(Math.abs(bone.quaternion.lengthSq() - 1) < 1e-9, `${bone.name} quaternion lost normalization`);
  }
}

test('default device hold is right-handed while the free left arm keeps a sustained walking swing', () => {
  const { animator } = makeAnimator();
  const restRight = localHand(animator, 'R');
  advance(animator, 90);
  assert.ok(localHand(animator, 'R').y > restRight.y + 0.07, 'right glove did not move forward into its hold');
  assert.ok(animator.bones.ForearmR.rotation.x < -0.4, 'right elbow did not support the device');
  assert.ok(animator.bones.ForearmL.rotation.x > -0.15, 'left hand must remain free');
  const samples = { L: [], R: [] };
  advance(animator, 60, { speed: 3 });
  for (let frame = 0; frame < 180; frame += 1) {
    animator.update({ speed: 3 });
    for (const side of ['L', 'R']) samples[side].push(animator.bones[`Arm${side}`].rotation.x);
  }
  const range = (values) => Math.max(...values) - Math.min(...values);
  assert.ok(range(samples.L) > 0.22, 'free arm did not keep swinging');
  assert.ok(range(samples.L) > range(samples.R) * 5, 'device hand swung like a free hand');
  assertFinitePose(animator);
});

test('aim raises the right hold, follows vertical pitch, and blends back without joint snaps', () => {
  const { animator } = makeAnimator();
  advance(animator, 90);
  const base = localHand(animator, 'R');
  const flatRotation = animator.bones.HandR.getWorldQuaternion(new THREE.Quaternion());
  const previous = Object.fromEntries(LAB_PLAYER_JOINTS.map(({ name }) => [name, animator.bones[name].quaternion.clone()]));
  for (let frame = 0; frame < 90; frame += 1) {
    animator.update({ aiming: true, aimPitch: 0.5 });
    for (const { name } of LAB_PLAYER_JOINTS) {
      const q = animator.bones[name].quaternion;
      assert.ok(q.angleTo(previous[name]) < 0.12, `${name} snapped while aiming`);
      previous[name].copy(q);
    }
  }
  assert.equal(animator.state, 'aim_idle');
  assert.ok(localHand(animator, 'R').z < base.z - 0.025, 'aim pose did not lift the hand');
  assert.ok(flatRotation.angleTo(animator.bones.HandR.getWorldQuaternion(new THREE.Quaternion())) > 0.4);
  assert.ok(Math.abs(animator.bones.ArmR.rotation.x) < 0.5, 'aim over-rotated the fused shoulder sleeve');
  assert.ok(Math.abs(animator.bones.ForearmR.rotation.x) < 0.7, 'aim over-rotated the sleeve elbow');
  advance(animator, 90);
  const recovered = makeAnimator().animator;
  advance(recovered, 270);
  assert.ok(localHand(animator, 'R').distanceTo(localHand(recovered, 'R')) < 0.001, 'aim did not recover to the current idle pose');
});

test('backward and strafe gaits change actual leg trajectories in character-local directions', () => {
  const pose = (moveForward, moveRight) => {
    const { animator } = makeAnimator();
    advance(animator, 120, { speed: 2, moveForward, moveRight });
    animator.gait = 0.1;
    animator.update({ dt: 0, speed: 2, moveForward, moveRight });
    return animator;
  };
  const forward = pose(1, 0), backward = pose(-1, 0), right = pose(0, 1), left = pose(0, -1);
  assert.equal(backward.state, 'walk_backward');
  assert.equal(right.state, 'strafe_right');
  assert.equal(left.state, 'strafe_left');
  assert.ok(forward.jointTargets.ThighL.x < backward.jointTargets.ThighL.x - 0.2, 'backpedaling reused the forward hip trajectory');
  assert.ok(right.jointTargets.ThighL.y > 0.08, 'strafe did not move the left leg sideways');
  assert.ok(left.jointTargets.ThighL.y < -0.08, 'left strafe did not reverse the leg motion');
  assert.ok(Math.abs(right.jointTargets.ThighL.y + right.jointTargets.FootL.y) < 1e-9, 'strafe tilted a planted sole');
  const diagonal = pose(4, 4).diagnostics.movementDirection;
  assert.ok(Math.abs(Math.hypot(diagonal.forward, diagonal.right) - 1) < 1e-8, 'diagonal inputs were not normalized');
});

test('starts and stops produce opposing body inertia and preserve the authoritative physics transforms', () => {
  const { animator, root, visual, states } = makeAnimator();
  const rootTransform = [root.position.toArray(), root.quaternion.toArray(), root.scale.toArray()];
  const visualTransform = [visual.position.toArray(), visual.quaternion.toArray(), visual.scale.toArray()];
  advance(animator, 8, { speed: 4 });
  assert.equal(animator.state, 'start');
  assert.ok(animator.diagnostics.bodyInertia.forward > 0.3);
  const startPitch = animator.jointTargets.Body.x;
  advance(animator, 120, { speed: 4 });
  assert.ok(startPitch > animator.jointTargets.Body.x + 0.01, 'start had no forward weight shift');
  advance(animator, 8);
  assert.equal(animator.state, 'stop');
  assert.ok(animator.diagnostics.bodyInertia.forward < -0.3);
  assert.ok(animator.jointTargets.Body.x < 0, 'braking did not shift the torso backward');
  advance(animator, 120);
  assert.equal(animator.state, 'idle');
  assert.ok(Math.abs(animator.diagnostics.bodyInertia.forward) < 0.001);
  assert.ok(states.includes('start') && states.includes('stop') && states.includes('run'));
  assert.deepEqual([root.position.toArray(), root.quaternion.toArray(), root.scale.toArray()], rootTransform);
  assert.deepEqual([visual.position.toArray(), visual.quaternion.toArray(), visual.scale.toArray()], visualTransform);
});

test('turn-in-place alternates support and reverses the torso yaw with turn direction', () => {
  const { animator } = makeAnimator();
  let releasedLeft = false, releasedRight = false;
  for (let frame = 0; frame < 120; frame += 1) {
    animator.update({ turnRate: 1.8 });
    releasedLeft ||= animator.footContact.L === 0;
    releasedRight ||= animator.footContact.R === 0;
  }
  assert.equal(animator.state, 'turn_right');
  assert.ok(animator.jointTargets.Body.z < -0.02);
  assert.ok(releasedLeft && releasedRight, 'turning pivoted on frozen feet');
  advance(animator, 90, { turnRate: -1.8 });
  assert.equal(animator.state, 'turn_left');
  assert.ok(animator.jointTargets.Body.z > 0.02);
  advance(animator, 90);
  assert.equal(animator.state, 'idle');
  assert.ok(Math.abs(animator.jointTargets.Body.z) < 0.001);
});

test('jump and landing articulate while a grounded portal crossing preserves foot contact', () => {
  const { animator, states } = makeAnimator();
  advance(animator, 30, { grounded: false, velocity: new THREE.Vector3(0, 3, 0) });
  assert.equal(animator.state, 'jump');
  const jumpKnee = animator.bones.ShinL.rotation.x;
  assert.deepEqual(animator.footContact, { L: 0, R: 0 });
  advance(animator, 30, { grounded: false, velocity: new THREE.Vector3(0, -6, 0) });
  assert.equal(animator.state, 'fall');
  assert.ok(animator.bones.ShinL.rotation.x < jumpKnee - 0.2);
  animator.update({ grounded: true });
  assert.equal(animator.state, 'landing');
  assert.ok(animator.bones.Body.position.z > animator.rig.rest.Body.z + 0.005, 'landing did not compress the body');
  advance(animator, 120);
  assert.equal(animator.state, 'idle');
  assert.ok(Math.abs(animator.bones.Body.position.z - animator.rig.rest.Body.z) < 0.001);
  animator.update({ phase: true });
  assert.equal(animator.state, 'phase');
  assert.ok(animator.footContact.L > .99 && animator.footContact.R > .99);
  assert.ok(states.includes('jump') && states.includes('fall') && states.includes('landing'));
  assertFinitePose(animator);
});

test('shot recoil moves the device arm briefly and is unavailable while carrying or unarmed', () => {
  const { animator } = makeAnimator();
  advance(animator, 90);
  const elbow = animator.bones.ForearmR.quaternion.clone();
  assert.equal(animator.triggerShot(), true);
  advance(animator, 4);
  assert.ok(elbow.angleTo(animator.bones.ForearmR.quaternion) > 0.008, 'shot produced no visible elbow recoil');
  assert.ok(animator.diagnostics.recoil > 0.1);
  advance(animator, 90);
  assert.ok(elbow.angleTo(animator.bones.ForearmR.quaternion) < 0.001, 'recoil did not recover');
  animator.update({ carrying: true });
  assert.equal(animator.triggerShot(), false, 'pickup must immediately suppress shooting');
  advance(animator, 90, { carrying: true });
  assert.equal(animator.triggerShot(), false);
  advance(animator, 90, { weapon: false });
  assert.equal(animator.triggerShot(), false);
});

test('pickup/place reach, recover and blend to two-handed cargo with a carrier at the hand midpoint', () => {
  const { animator, carrier, geometry, states } = makeAnimator();
  advance(animator, 90);
  const skinWeights = animator.rig.mesh.geometry.getAttribute('skinWeight').array.slice();
  const skinIndices = animator.rig.mesh.geometry.getAttribute('skinIndex').array.slice();
  const sourcePositions = geometry.getAttribute('position').array.slice();
  const sourceUV = geometry.getAttribute('uv').array.slice();
  assert.equal(animator.triggerInteraction('unknown'), false);
  assert.equal(animator.triggerInteraction('pickup'), true);
  const previous = Object.fromEntries(LAB_PLAYER_JOINTS.map(({ name }) => [name, animator.bones[name].quaternion.clone()]));
  let previousCarrier = carrier.getWorldPosition(new THREE.Vector3());
  let maxReach = 0;
  for (let frame = 0; frame < 240; frame += 1) {
    if (frame === 120) assert.equal(animator.triggerInteraction('place'), true);
    animator.update({ carrying: frame < 120 });
    maxReach = Math.max(maxReach, animator.interactionBlend);
    for (const { name } of LAB_PLAYER_JOINTS) {
      const q = animator.bones[name].quaternion;
      assert.ok(q.angleTo(previous[name]) < 0.16, `${name} snapped during an item transfer`);
      previous[name].copy(q);
    }
    const midpoint = animator.bones.HandL.getWorldPosition(new THREE.Vector3())
      .add(animator.bones.HandR.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    const currentCarrier = carrier.getWorldPosition(new THREE.Vector3());
    assert.ok(currentCarrier.distanceTo(midpoint) < 1e-9, 'cargo left the supporting hands');
    assert.ok(currentCarrier.distanceTo(previousCarrier) < 0.04, 'cargo carrier teleported during a blend');
    previousCarrier = currentCarrier;
    if (frame === 119) {
      assert.equal(animator.state, 'carry_idle');
      assert.ok(Math.abs(animator.bones.ArmL.rotation.x - animator.bones.ArmR.rotation.x) < 0.001);
      assert.ok(animator.bones.ForearmL.rotation.x < -0.65);
      assert.ok(animator.diagnostics.weaponBlend < 0.001);
      const left = localHand(animator, 'L'), right = localHand(animator, 'R');
      assert.ok(right.x - left.x < 0.46, 'cargo grip stayed wider than the rear sides');
      assert.ok((left.y + right.y) / 2 > 0.17, 'supporting hands did not reach the cargo');
    }
    assertFinitePose(animator);
  }
  assert.ok(maxReach > 0.7, 'interaction never reached its target');
  assert.ok(states.includes('pickup') && states.includes('place'));
  assert.equal(animator.diagnostics.interaction, null);
  assert.equal(animator.state, 'idle');
  assert.equal(animator.rig.skeleton.bones.length, 14);
  assert.deepEqual(animator.rig.mesh.geometry.getAttribute('skinWeight').array, skinWeights);
  assert.deepEqual(animator.rig.mesh.geometry.getAttribute('skinIndex').array, skinIndices);
  assert.deepEqual(geometry.getAttribute('position').array, sourcePositions);
  assert.deepEqual(geometry.getAttribute('uv').array, sourceUV);
});

test('bad numeric inputs remain finite and reset clears all transient animation state', () => {
  const { animator } = makeAnimator();
  animator.triggerShot();
  animator.triggerInteraction('pickup');
  animator.update({ dt: NaN, speed: Infinity, moveForward: NaN, moveRight: Infinity,
    turnRate: Infinity, aimPitch: NaN, velocity: { y: NaN }, aiming: true });
  assertFinitePose(animator);
  advance(animator, 20, { carrying: true, grounded: false });
  animator.reset();
  assert.equal(animator.state, 'idle');
  assert.equal(animator.diagnostics.interaction, null);
  assert.equal(animator.recoil, 0);
  assert.equal(animator.carryBlend, 0);
  assert.deepEqual(animator.footContact, { L: 1, R: 1 });
  for (const bone of Object.values(animator.bones)) assert.deepEqual(bone.quaternion.toArray(), [0, 0, 0, 1]);
});

test('living idle looks around while both feet and the pelvis remain steady', () => {
  const { animator, root } = makeAnimator();
  const rootMatrix = root.matrix.toArray();
  const yaw = [], shift = [];
  let tap = 0, leftReleased = false;
  for (let frame = 0; frame < 360; frame += 1) {
    animator.update();
    yaw.push(animator.bones.Head.rotation.z);
    shift.push(animator.bones.Body.position.x);
    tap = Math.max(tap, animator.diagnostics.idle.footTap);
    leftReleased ||= animator.footContact.L === 0;
  }
  assert.ok(Math.max(...yaw) - Math.min(...yaw) > 0.07, 'idle head stayed frozen');
  assert.ok(Math.max(...shift) - Math.min(...shift) < .000001, 'idle shifted the pelvis over locked feet');
  assert.equal(tap, 0);
  assert.equal(leftReleased, false, 'idle unnecessarily released a planted foot');
  assert.deepEqual(root.matrix.toArray(), rootMatrix);
  assert.equal(animator.state, 'idle');
});

test('curiosity, celebration and jump anticipation create bounded expressions and return to locomotion', () => {
  const { animator, states } = makeAnimator();
  advance(animator, 90);
  assert.equal(animator.trigger('curious'), true);
  advance(animator, 30);
  assert.equal(animator.state, 'curious');
  assert.ok(animator.bones.Head.rotation.y > 0.035, 'curiosity did not cock the head');
  assert.equal(animator.trigger('success'), true);
  const initialRight = animator.bones.ArmR.quaternion.clone();
  let hop = 0, handWave = 0, raisedLeft = 0;
  for (let frame = 0; frame < 90; frame += 1) {
    if (frame === 20) {
      const elapsed = animator.diagnostics.expression.elapsed;
      animator.trigger('celebrate');
      assert.equal(animator.diagnostics.expression.elapsed, elapsed, 'repeated success restarted an active celebration');
    }
    animator.update();
    hop = Math.max(hop, animator.rig.rest.Body.z - animator.bones.Body.position.z);
    handWave = Math.max(handWave, Math.abs(animator.bones.HandL.rotation.z));
    raisedLeft = Math.max(raisedLeft, -animator.bones.ArmL.rotation.x);
    assert.ok(Math.abs(animator.bones.ArmL.rotation.x) < 0.48, 'celebration over-bent the shoulder sleeve');
    assert.ok(Math.abs(animator.bones.ForearmL.rotation.x) < 0.68, 'celebration over-bent the elbow sleeve');
    assert.ok(initialRight.angleTo(animator.bones.ArmR.quaternion) < 0.002, 'celebration disturbed the calibrated device arm');
  }
  assert.ok(hop > 0.007 && handWave > 0.08 && raisedLeft > 0.3, 'celebration lacked a visible bounce and wave');
  assert.equal(animator.diagnostics.expression, null);
  assert.equal(animator.state, 'idle');
  assert.equal(animator.triggerJump(), true);
  advance(animator, 3);
  assert.equal(animator.state, 'anticipate_jump');
  assert.ok(animator.bones.Body.position.z > animator.rig.rest.Body.z + 0.009);
  advance(animator, 15, { grounded: false, velocity: { y: 3 } });
  assert.equal(animator.state, 'jump');
  assert.equal(animator.trigger('unrecognized'), false);
  assert.ok(states.includes('curious') && states.includes('celebrate'));
  assertFinitePose(animator);
});

test('hand-to-body handoff reverses continuously and catch/drop aliases recover to supported cargo', () => {
  const { animator } = makeAnimator();
  advance(animator, 90);
  assert.equal(animator.trigger('catch'), true);
  advance(animator, 9, { carrying: true });
  const midway = animator.diagnostics.handoff;
  assert.ok(midway.progress > 0.45 && midway.progress < 0.5);
  assert.ok(midway.blend > 0.95);
  assert.ok(animator.bones.ForearmR.rotation.x > -0.45, 'device hand never lowered toward its body mount');
  const beforeReverse = animator.bones.ForearmR.quaternion.clone();
  animator.update({ carrying: false });
  assert.ok(animator.diagnostics.handoff.progress < midway.progress);
  assert.ok(animator.diagnostics.handoff.progress > 0.4, 'handoff restarted instead of reversing');
  assert.ok(beforeReverse.angleTo(animator.bones.ForearmR.quaternion) < 0.08);
  advance(animator, 60, { carrying: true });
  assert.equal(animator.diagnostics.handoff.progress, 1);
  assert.equal(animator.state, 'carry_idle');
  assert.equal(animator.trigger('drop'), true);
  advance(animator, 60);
  assert.equal(animator.diagnostics.handoff.progress, 0);
  assert.equal(animator.state, 'idle');
});

test('render-driven motion stays equivalent at 30, 60 and 144 Hz through expressions and movement', () => {
  const sequence = [
    { input: {}, event: 'curious' },
    { input: { speed: 4 } },
    { input: { speed: 3, moveForward: 0, moveRight: 1 } },
    { input: {} },
    { input: { aiming: true, aimPitch: 0.4 } },
    { input: { carrying: true }, event: 'catch' },
    { input: { carrying: true, speed: 2 } },
    { input: { grounded: false, velocity: { y: 3 } }, event: 'drop' },
    { input: { grounded: false, velocity: { y: -5 } } },
    { input: {}, event: 'celebrate' },
    { input: {} },
  ];
  const simulate = (fps) => {
    const { animator } = makeAnimator();
    return sequence.map(({ input, event }) => {
      if (event) animator.trigger(event);
      for (let frame = 0; frame < fps / 2; frame += 1) animator.update({ ...input, dt: 1 / fps });
      return { position: animator.bones.Body.position.clone(), state: animator.state,
        rotations: Object.fromEntries(LAB_PLAYER_JOINTS.map(({ name }) => [name, animator.bones[name].quaternion.clone()])) };
    });
  };
  const reference = simulate(60);
  for (const fps of [30, 144]) {
    const sampled = simulate(fps);
    for (let index = 0; index < reference.length; index += 1) {
      assert.equal(sampled[index].state, reference[index].state, `${fps} Hz changed the state sequence`);
      assert.ok(sampled[index].position.distanceTo(reference[index].position) < 0.002, `${fps} Hz changed body motion`);
      for (const { name } of LAB_PLAYER_JOINTS) {
        const difference = sampled[index].rotations[name].angleTo(reference[index].rotations[name]);
        assert.ok(difference < 0.018, `${fps} Hz ${name} diverged ${difference} radians at segment ${index}`);
      }
    }
  }
});
