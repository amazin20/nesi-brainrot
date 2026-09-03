import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  crossingPortal,
  makePortalFrame,
  portalForward,
  portalTransferRotation,
  transferThroughPortal,
} from '../src/game/portalMath.js';

test('portal frame faces the requested surface normal', () => {
  for (const normal of [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ]) {
    const portal = makePortalFrame(new THREE.Vector3(), normal);
    assert.ok(portalForward(portal).distanceTo(normal) < 1e-7);
  }
});

test('crossing test accepts the ellipse and rejects its outside edge', () => {
  const portal = makePortalFrame(new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0, 0, 1));
  assert.ok(crossingPortal(
    new THREE.Vector3(0.2, 1.8, 1),
    new THREE.Vector3(0.2, 1.8, -0.2),
    portal,
  ));
  assert.equal(crossingPortal(
    new THREE.Vector3(1.4, 1.8, 1),
    new THREE.Vector3(1.4, 1.8, -0.2),
    portal,
  ), null);
});

test('linked portals preserve speed and eject away from the destination wall', () => {
  const source = makePortalFrame(new THREE.Vector3(-12, 1.8, 14), new THREE.Vector3(1, 0, 0));
  const target = makePortalFrame(new THREE.Vector3(0, 1.8, 8), new THREE.Vector3(0, 0, -1));
  const position = new THREE.Vector3(-12.1, 1.8, 14);
  const velocity = new THREE.Vector3(-7, 0, 0);
  const result = transferThroughPortal(position, velocity, source, target, 0.5);
  assert.ok(result.position.clone().sub(target.position).dot(target.normal) > 0.5);
  assert.ok(Math.abs(result.velocity.length() - velocity.length()) < 1e-7);
  assert.ok(result.velocity.dot(target.normal) > 6.9);
});

test('portal transfer rotation is finite and normalized', () => {
  const first = makePortalFrame(new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
  const second = makePortalFrame(new THREE.Vector3(), new THREE.Vector3(0, 0, 1));
  const rotation = portalTransferRotation(first, second);
  assert.ok(rotation.toArray().every(Number.isFinite));
  assert.ok(Math.abs(rotation.length() - 1) < 1e-7);
});
