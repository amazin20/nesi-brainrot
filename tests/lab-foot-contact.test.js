import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabPlayerAnimator } from '../src/game/LabPlayerAnimator.js';

function fixture() {
  const root = new THREE.Group(), visual = new THREE.Group(); root.add(visual); visual.scale.setScalar(2.21);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -.1, .1, -.17, .1, .1, -.17, 0, 0, -1.085], 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()); mesh.rotation.x = Math.PI / 2; visual.add(mesh);
  return { root, animator: new LabPlayerAnimator({ visual }) };
}

test('a planted boot holds its world contact and releases promptly for a jump', () => {
  const { root, animator } = fixture();
  const sampleGround = () => ({ height: 0, normal: new THREE.Vector3(0, 1, 0) });
  let lockedSamples = 0, maxError = 0;
  for (let frame = 0; frame < 180; frame++) {
    root.position.z += 2.6 / 60;
    animator.update({ dt: 1 / 60, speed: 2.6, grounded: true, sampleGround });
    for (const f of Object.values(animator.groundContact.feet)) if (f.locked && f.blend > .99) {
      lockedSamples++; maxError = Math.max(maxError, f.error);
    }
  }
  assert.ok(lockedSamples > 50); assert.ok(maxError < .055, `ankle reach error ${maxError}`);
  for (let i = 0; i < 5; i++) animator.update({ dt: 1 / 60, grounded: false, velocity: { y: 6 }, sampleGround });
  for (const f of Object.values(animator.groundContact.feet)) assert.equal(f.blend, 0);
});

test('moving support carries foot locks vertically and teleport discards old contacts', () => {
  const { root, animator } = fixture(); let height = 0;
  const sampleGround = () => ({ height, normal: new THREE.Vector3(0, 1, 0) });
  for (let i = 0; i < 60; i++) animator.update({ sampleGround, grounded: true });
  const start = animator.groundContact.feet.L.anchor.y;
  for (let i = 0; i < 60; i++) { height += .01; root.position.y = height; animator.update({ sampleGround, grounded: true }); }
  assert.ok(Math.abs(animator.groundContact.feet.L.anchor.y - start - .6) < .001);
  root.position.x += 30; animator.update({ sampleGround, grounded: true });
  assert.ok(animator.groundContact.feet.L.anchor.x > 29, 'old world contact cannot survive a portal');
});
