import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildRiftRoute,
  calculateRiftExitVelocity,
  computeRiftExit,
  makeRiftFrame,
  riftRouteTangent,
  sampleRiftRoute,
} from '../src/game/riftMath.js';

test('one rift anchor exits on the opposite side of its own surface', () => {
  const anchor = makeRiftFrame(new THREE.Vector3(0, 1.4, 8), new THREE.Vector3(0, 0, 1));
  const exit = computeRiftExit(anchor);
  assert.ok(exit.z < anchor.position.z);
  assert.ok(exit.y >= 0);
});

test('rift route is curved and preserves exact endpoints', () => {
  const start = new THREE.Vector3(0, 0, 17);
  const anchor = makeRiftFrame(new THREE.Vector3(1, 1.5, 8), new THREE.Vector3(0, 0, 1));
  const route = buildRiftRoute(start, anchor);
  assert.ok(sampleRiftRoute(route, 0).distanceTo(start) < 1e-8);
  assert.ok(sampleRiftRoute(route, 1).distanceTo(route.end) < 1e-8);
  assert.ok(sampleRiftRoute(route, 0.5).y > Math.min(route.start.y, route.end.y));
});

test('route tangent stays finite and normalized', () => {
  const anchor = makeRiftFrame(new THREE.Vector3(0, 2, -3.6), new THREE.Vector3(0, 0, 1));
  const route = buildRiftRoute(new THREE.Vector3(2, 0, 2), anchor);
  for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
    const tangent = riftRouteTangent(route, amount);
    assert.ok(tangent.toArray().every(Number.isFinite));
    assert.ok(Math.abs(tangent.length() - 1) < 1e-7);
  }
});

test('stored movement increases the exit impulse without requiring a second portal', () => {
  const anchor = makeRiftFrame(new THREE.Vector3(0, 1.4, 8), new THREE.Vector3(0, 0, 1));
  const route = buildRiftRoute(new THREE.Vector3(0, 0, 17), anchor);
  const still = calculateRiftExitVelocity(new THREE.Vector3(), route);
  const moving = calculateRiftExitVelocity(new THREE.Vector3(0, -4, -7), route);
  assert.ok(moving.length() > still.length());
  assert.ok(moving.dot(anchor.normal) < 0);
});
