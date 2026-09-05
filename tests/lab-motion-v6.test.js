import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabPlayerAnimator } from '../src/game/LabPlayerAnimator.js';

function fixture() {
  const root = new THREE.Group(), visual = new THREE.Group();
  root.add(visual); visual.scale.setScalar(2.21);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, -.1, .1, -.17, .1, .1, -.17, 0, 0, -1.085,
  ], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.rotation.x = Math.PI / 2; visual.add(mesh);
  return { root, animator: new LabPlayerAnimator({ visual }),
    sampleGround: () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0) }) };
}

test('ten seconds of idle keep settled knees and boots steady, including the former foot-tap interval', () => {
  const { animator, sampleGround } = fixture();
  for (let f = 0; f < 120; f++) animator.update({ sampleGround });
  const names = ['ThighL', 'ThighR', 'ShinL', 'ShinR', 'FootL', 'FootR'];
  const pose = names.map(n => animator.bones[n].quaternion.clone());
  const points = names.slice(4).map(n => animator.bones[n].getWorldPosition(new THREE.Vector3()));
  let headMin = Infinity, headMax = -Infinity;
  for (let f = 0; f < 600; f++) {
    animator.update({ sampleGround });
    names.forEach((n, i) => assert.ok(animator.bones[n].quaternion.angleTo(pose[i]) < .001, `${n} twitched in idle`));
    names.slice(4).forEach((n, i) => assert.ok(animator.bones[n].getWorldPosition(new THREE.Vector3()).distanceTo(points[i]) < .0001));
    headMin = Math.min(headMin, animator.bones.Head.rotation.z); headMax = Math.max(headMax, animator.bones.Head.rotation.z);
  }
  assert.ok(headMax - headMin > .08, 'attention stopped with the legs');
});

test('sprint cadence remains measured and pelvis no longer stays in a deep squat', () => {
  const { animator, root, sampleGround } = fixture();
  let previous = 0, cycles = 0, maxCompression = 0;
  for (let f = 0; f < 360; f++) {
    root.position.z += 5 / 60;
    animator.update({ speed: 5, sampleGround });
    if (animator.gait < previous) cycles++;
    previous = animator.gait;
    maxCompression = Math.max(maxCompression, animator.bones.Body.position.z - animator.rig.rest.Body.z);
    assert.ok(animator.diagnostics.cadenceHz <= 2.2);
    for (const side of ['L', 'R']) for (const name of ['Thigh', 'Shin', 'Foot'])
      assert.deepEqual(animator.bones[name + side].scale.toArray(), [1, 1, 1]);
  }
  assert.ok(cycles >= 10 && cycles <= 14, `six-second sprint had ${cycles} complete leg cycles`);
  assert.ok(maxCompression < .026, `permanent squat: ${maxCompression}`);
});
