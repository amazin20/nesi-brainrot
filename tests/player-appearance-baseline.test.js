import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  PLAYER_SOURCE_SHA256,
  PlayerAppearanceBaseline,
  assertPlayerAppearanceUnchanged,
} from '../src/game/PlayerAppearanceBaseline.js';

const makeBaseline = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.2, 0, 0,
    0.2, 0, 0,
    0, 0.4, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
  geometry.setIndex([0, 1, 2]);
  const material = new THREE.MeshStandardMaterial({
    color: 0x2678ff,
    roughness: 0.74,
    metalness: 0.04,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const visual = new THREE.Group();
  visual.add(mesh);
  const playerRoot = new THREE.Group();
  playerRoot.add(visual);
  const carrier = new THREE.Group();
  const world = new THREE.Group();
  world.add(playerRoot, carrier);
  world.updateMatrixWorld(true);
  return { geometry, material, mesh, visual, playerRoot, carrier, world };
};

test('the immutable player GLB still has the approved source hash', () => {
  const bytes = readFileSync(new URL('../public/models/model-01-player.glb', import.meta.url));
  const digest = createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest, PLAYER_SOURCE_SHA256);
});

test('appearance baseline never converts or replaces the source mesh', () => {
  const fixture = makeBaseline();
  const positions = fixture.geometry.getAttribute('position').array.slice();
  const normals = fixture.geometry.getAttribute('normal').array.slice();
  const uvs = fixture.geometry.getAttribute('uv').array.slice();
  const indices = fixture.geometry.index.array.slice();
  const baseline = new PlayerAppearanceBaseline({
    visual: fixture.visual,
    carrier: fixture.carrier,
  });

  baseline.update(1 / 60, 1, { planarSpeed: 8, grounded: true });
  baseline.triggerLanding(9);
  baseline.triggerHit();
  baseline.triggerInteraction('grab');
  baseline.reset();

  assert.equal(baseline.state, 'source_locked');
  assert.equal(Boolean(fixture.mesh.isSkinnedMesh), false);
  assert.strictEqual(fixture.mesh.geometry, fixture.geometry);
  assert.strictEqual(fixture.mesh.material, fixture.material);
  assert.equal(fixture.geometry.getAttribute('skinIndex'), undefined);
  assert.equal(fixture.geometry.getAttribute('skinWeight'), undefined);
  assert.deepEqual([...fixture.geometry.getAttribute('position').array], [...positions]);
  assert.deepEqual([...fixture.geometry.getAttribute('normal').array], [...normals]);
  assert.deepEqual([...fixture.geometry.getAttribute('uv').array], [...uvs]);
  assert.deepEqual([...fixture.geometry.index.array], [...indices]);
  assert.equal(assertPlayerAppearanceUnchanged(baseline.snapshot), true);
});

test('outer player movement can update cargo without touching the source visual', () => {
  const fixture = makeBaseline();
  const baseline = new PlayerAppearanceBaseline({ visual: fixture.visual, carrier: fixture.carrier });
  fixture.playerRoot.position.set(4, 2, -7);
  fixture.playerRoot.rotation.y = 0.7;
  fixture.world.updateMatrixWorld(true);
  baseline.update();
  const expected = fixture.visual.localToWorld(new THREE.Vector3(0, 1.35, 0.25));
  const actual = fixture.carrier.getWorldPosition(new THREE.Vector3());
  assert.ok(actual.distanceTo(expected) < 1e-7);
  assert.equal(assertPlayerAppearanceUnchanged(baseline.snapshot), true);
});
