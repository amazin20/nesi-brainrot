import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LAB_PLAYER_JOINTS, LabPlayerAnimator, sampleLabFootCycle, solveLabArm } from '../src/game/LabPlayerAnimator.js';

function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.25, .025, -.34, .26, .025, -.34, -.11, .01, -.20, .12, .01, -.20,
    0, -.25, -.52, 0, .15, -.78,
  ], 3));
  const root = new THREE.Group(), visual = new THREE.Group();
  root.position.set(2, 3, -4); root.rotation.y = .7;
  visual.scale.setScalar(2.3);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.rotation.x = Math.PI / 2; visual.add(mesh); root.add(visual);
  const animator = new LabPlayerAnimator({ visual });
  return { animator, root, visual, geometry };
}
function grips(animator, phase = 0) {
  // Contact targets are independent of the solved limbs and remain in the
  // actual animated player coordinate frame. This models moving cargo grips.
  animator.rig.mesh.updateWorldMatrix(true, true);
  return Object.fromEntries([['left', -.15], ['right', .16]].map(([name, x]) => [name,
    animator.rig.mesh.localToWorld(new THREE.Vector3(x + Math.sin(phase) * .008,
      .158 + Math.sin(phase * .7) * .005, -.465 + Math.cos(phase) * .007))]));
}
const advance = (a, n, input = {}) => { for (let i = 0; i < n; i++) a.update({ dt: 1 / 60, ...input }); };

test('foot paths match position, speed and acceleration through toe-off and heel strike', () => {
  const h = 1e-5;
  for (const stride of [.047, .1]) for (const seam of [0, .57, 1]) for (const field of ['path', 'lift']) {
    const at = x => sampleLabFootCycle(x, stride, .6)[field];
    const left = (at(seam - h) - at(seam - 2 * h)) / h;
    const right = (at(seam + 2 * h) - at(seam + h)) / h;
    assert.ok(Math.abs(at(seam - h) - at(seam + h)) < .00002, `${field} position corner`);
    assert.ok(Math.abs(left - right) < .00003, `${field} velocity corner ${seam}: ${left} / ${right}`);
    const accelL = (at(seam) - 2 * at(seam - h) + at(seam - 2 * h)) / h ** 2;
    const accelR = (at(seam + 2 * h) - 2 * at(seam + h) + at(seam)) / h ** 2;
    assert.ok(Math.abs(accelL - accelR) < .025, `${field} acceleration corner ${seam}`);
  }
});

test('world-space two-hand IK keeps contact through movement and player turns without changing bone lengths', () => {
  const { animator, root, geometry } = fixture();
  const source = geometry.getAttribute('position').array.slice();
  const skin = animator.rig.mesh.geometry.getAttribute('skinWeight').array.slice();
  advance(animator, 90);
  for (let frame = 0; frame < 240; frame++) {
    root.rotation.y += .002;
    root.position.x += .001;
    const targets = grips(animator, frame / 35);
    animator.update({ carrying: true, carryGripTargets: targets, speed: 1.5, turnRate: .12 });
    if (frame > 50) for (const key of ['left', 'right']) {
      assert.equal(animator.diagnostics.carryReach[`${key}Clamped`], false, 'reachable cargo was clamped');
      assert.ok(animator.diagnostics.carryReach[`${key}Error`] < .000001,
        `${key} glove detached: ${animator.diagnostics.carryReach[`${key}Error`]}`);
    }
    for (const name of ['ArmL','ForearmL','HandL','ArmR','ForearmR','HandR']) {
      assert.deepEqual(animator.bones[name].position.toArray(), animator.rig.rest[name].toArray(), `${name} length changed`);
      assert.deepEqual(animator.bones[name].scale.toArray(), [1,1,1], `${name} stretched`);
    }
  }
  assert.deepEqual(geometry.getAttribute('position').array, source);
  assert.deepEqual(animator.rig.mesh.geometry.getAttribute('skinWeight').array, skin);
});

test('pickup and drop preserve continuous arm rotations and release fully to the same current FK pose', () => {
  const { animator } = fixture();
  advance(animator, 90);
  const targets = grips(animator);
  const names = ['ArmL','ForearmL','HandL','ArmR','ForearmR','HandR'];
  const previous = Object.fromEntries(names.map(name => [name, animator.bones[name].quaternion.clone()]));
  for (let frame = 0; frame < 240; frame++) {
    animator.update({ carrying: frame < 120, carryGripTargets: frame < 120 ? targets : null });
    for (const name of names) {
      const q = animator.bones[name].quaternion;
      assert.ok(q.angleTo(previous[name]) < .16, `${name} snapped: ${q.angleTo(previous[name])}`);
      previous[name].copy(q);
    }
  }
  assert.ok(animator.diagnostics.carryReach.blend < .00001);
  for (const { name } of LAB_PLAYER_JOINTS) assert.ok(animator.bones[name].quaternion.angleTo(animator.basePose[name]) < .00001);
});

test('unreachable cargo clamps the reach without stretching or non-finite IK', () => {
  const { animator } = fixture();
  const targets = { left: new THREE.Vector3(200, 90, -30), right: new THREE.Vector3(201, 90, -30) };
  advance(animator, 90, { carrying: true, carryGripTargets: targets });
  assert.equal(animator.diagnostics.carryReach.leftClamped, true);
  assert.equal(animator.diagnostics.carryReach.rightClamped, true);
  assert.ok(animator.diagnostics.carryReach.leftError > 100);
  for (const bone of Object.values(animator.bones)) {
    assert.ok(bone.quaternion.toArray().every(Number.isFinite));
    assert.ok(Math.abs(bone.quaternion.lengthSq() - 1) < 1e-9);
  }
  for (const side of ['L','R']) {
    const shoulder = new THREE.Vector3(), upper = new THREE.Vector3(.047,.012,.13), lower = new THREE.Vector3(.037,.015,.093);
    const solved = solveLabArm(shoulder, shoulder, upper, lower, side);
    assert.ok(solved.arm.toArray().every(Number.isFinite));
    assert.ok(solved.forearm.toArray().every(Number.isFinite));
  }
});

test('jump leads with one knee, flows through its apex and extends for landing without pose snaps', () => {
  const { animator } = fixture();
  advance(animator, 90, { speed: 4 }); animator.triggerJump();
  const phases = new Set();
  let asymmetry = 0, previous = animator.bones.ShinL.quaternion.clone(), maxDelta = 0, riseKnee = 0, fallKnee = 0;
  for (let frame = 0; frame < 72; frame++) {
    const vy = 6 - frame * .2;
    animator.update({ speed: 4, grounded: false, velocity: { y: vy } });
    phases.add(animator.diagnostics.airborne.phase);
    asymmetry = Math.max(asymmetry, Math.abs(animator.bones.ShinL.rotation.x - animator.bones.ShinR.rotation.x));
    const q = animator.bones.ShinL.quaternion;
    // Skip the initial gait-to-jump blend when measuring the apex, where the
    // previous binary sign(vy) jump/fall pose caused the visible frozen switch.
    if (frame > 15) maxDelta = Math.max(maxDelta, q.angleTo(previous));
    previous.copy(q);
    if (frame === 20) riseKnee = (animator.bones.ShinL.rotation.x + animator.bones.ShinR.rotation.x) * .5;
    if (frame === 65) fallKnee = (animator.bones.ShinL.rotation.x + animator.bones.ShinR.rotation.x) * .5;
  }
  assert.deepEqual([...phases], ['push_off','float','prepare_land']);
  assert.ok(asymmetry > .2, 'both legs were frozen in the same symmetric jump pose');
  assert.ok(riseKnee - fallKnee > .3, 'legs never prepared for the landing');
  assert.ok(maxDelta < .04, `apex changed abruptly: ${maxDelta}`);
  animator.update({ grounded: true, speed: 1 });
  assert.equal(animator.diagnostics.airborne.phase, 'grounded');
  assert.equal(animator.state, 'landing');
});

test('IK follows the same contact at 30, 60 and 144 render Hz', () => {
  const poses = [30,60,144].map(fps => {
    const { animator } = fixture();
    const targets = grips(animator);
    for (let frame = 0; frame < fps * 2; frame++) animator.update({ dt: 1 / fps, carrying: true, carryGripTargets: targets, speed: 2 });
    return animator;
  });
  for (const animator of poses) {
    assert.ok(animator.diagnostics.carryReach.leftError < 1e-8);
    assert.ok(animator.diagnostics.carryReach.rightError < 1e-8);
    for (const { name } of LAB_PLAYER_JOINTS) assert.ok(animator.bones[name].quaternion.angleTo(poses[1].bones[name].quaternion) < .018);
  }
});

test('release recovers with the moving player instead of leaving hands reaching at an old world point', () => {
  const a = fixture(), b = fixture();
  advance(a.animator, 90, { carrying: true, carryGripTargets: grips(a.animator) });
  advance(b.animator, 90, { carrying: true, carryGripTargets: grips(b.animator) });
  for (let frame = 0; frame < 30; frame++) {
    a.root.position.x += .12; a.root.rotation.y += .04;
    a.animator.update({ carrying: false }); b.animator.update({ carrying: false });
    for (const name of ['ArmL','ForearmL','HandL','ArmR','ForearmR','HandR']) {
      assert.ok(a.animator.bones[name].quaternion.angleTo(b.animator.bones[name].quaternion) < 1e-6,
        `${name} was dragged towards its previous world contact`);
    }
  }
});

test('attention follows a nearby companion smoothly and yields to aiming without changing source transforms', () => {
  const { animator, root } = fixture();
  const rootPosition = root.position.clone(), rootQ = root.quaternion.clone();
  const look = animator.rig.mesh.localToWorld(new THREE.Vector3(.3, .5, -.35));
  advance(animator, 90, { lookTarget: look });
  assert.ok(animator.diagnostics.attention.blend > .98);
  assert.ok(animator.bones.Head.rotation.z < -.2, 'head did not notice the companion to its right');
  assert.ok(animator.bones.Head.rotation.x > .15, 'head did not look down towards the small companion');
  const q = animator.bones.Head.quaternion.clone();
  animator.update({ lookTarget: look, aiming: true });
  assert.ok(animator.bones.Head.quaternion.angleTo(q) < .05, 'head snapped away from the companion');
  advance(animator, 90, { lookTarget: look, aiming: true });
  assert.ok(animator.diagnostics.attention.blend < .003);
  assert.deepEqual(root.position.toArray(), rootPosition.toArray());
  assert.deepEqual(root.quaternion.toArray(), rootQ.toArray());
});
