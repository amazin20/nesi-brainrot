import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabPortalActors } from '../src/game/LabPortalActors.js';
import { makePortalFrame, portalTransformMatrix, transformPortalPoint } from '../src/game/LabPortals.js';

function actorFixture() {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  parent.position.set(.3, .15, -.2); parent.rotation.y = .18;
  scene.add(parent);
  const root = new THREE.Group(); root.name = 'Player'; parent.add(root);
  const visual = new THREE.Group(); visual.position.y = .1; visual.scale.setScalar(.8); root.add(visual);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -.25, 0, -.5, .25, 0, -.5, 0, .8, .35,
    -.2, 1, .3, .2, 1.2, .3, 0, 1.6, -.2,
  ], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    1, 0, 0, 0, .8, .2, 0, 0, .5, .5, 0, 0,
    .2, .8, 0, 0, .1, .9, 0, 0, 0, 1, 0, 0,
  ], 4));
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ color: 0x78c5dd, map: texture });
  const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = 'Skinned player'; visual.add(mesh);
  const hip = new THREE.Bone(); hip.name = 'Hip'; hip.position.y = .3;
  const hand = new THREE.Bone(); hand.name = 'Hand'; hand.position.set(.1, .5, 0);
  hip.add(hand); visual.add(hip);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([hip, hand]));
  const gun = new THREE.Mesh(new THREE.BoxGeometry(.15, .12, .4), material);
  gun.name = 'Gun'; gun.position.set(.2, 0, .15); hand.add(gun);
  const frames = [makePortalFrame(new THREE.Vector3(), new THREE.Vector3(0, 0, 1)),
    makePortalFrame(new THREE.Vector3(8, 1.5, -4), new THREE.Vector3(1, 0, 0))];
  const portals = { ready: true, portals: frames };
  const controller = new LabPortalActors({ scene, portals });
  const actor = controller.register(root, { radius: 1.3, centerOffset: [0, .7, 0] });
  return { scene, parent, root, visual, mesh, hip, hand, gun, texture, material, frames, portals, controller, actor };
}

function compareSkin({ mesh, actor, scene, frames }, tolerance = 2e-6) {
  scene.updateMatrixWorld(true);
  const duplicate = actor.pairs.find(pair => pair.source === mesh).destination;
  const transform = portalTransformMatrix(frames[actor.entryIndex], frames[1 - actor.entryIndex]);
  for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
    const sourcePoint = mesh.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(transform);
    const destinationPoint = duplicate.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(duplicate.matrixWorld);
    assert.ok(sourcePoint.distanceTo(destinationPoint) < tolerance,
      `weighted skinned vertex ${vertex} drifted ${sourcePoint.distanceTo(destinationPoint)} m`);
  }
  return duplicate;
}

test('loading prepares hidden clipping variants and crossing keeps the scene light count stable', () => {
  const { controller, actor, scene, gun, mesh, material } = actorFixture();
  gun.add(new THREE.PointLight(0x55ddff, 0, 1));
  controller.prepare();
  assert.ok(actor.clone);
  assert.equal(actor.clone.visible, false);
  assert.equal(mesh.material, material, 'preparing altered the live player material');
  let before = 0, after = 0;
  scene.traverseVisible(object => { if (object.isLight) before++; });
  controller.update();
  assert.equal(actor.active, true);
  scene.traverseVisible(object => { if (object.isLight) after++; });
  assert.equal(after, before, 'crossing changed shader light count');
  controller.dispose();
});

test('animated weighted skin at nested transforms is the exact portal transform, for walls and floors', () => {
  const fixture = actorFixture();
  const { root, hip, hand, scene, controller, actor, frames, mesh } = fixture;
  const sourcePositions = mesh.geometry.attributes.position.array.slice();
  const sourceInverses = mesh.skeleton.boneInverses.map(matrix => matrix.elements.slice());
  for (const normal of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)]) {
    frames[1] = makePortalFrame(new THREE.Vector3(8, 1.5, -4), normal, new THREE.Vector3(.4, 0, 1));
    for (let frame = 0; frame < 35; frame++) {
      root.rotation.y = Math.sin(frame * .08) * .4;
      root.position.z = .12 + Math.sin(frame * .1) * .18;
      hip.rotation.z = Math.sin(frame * .19) * .3;
      hand.rotation.set(Math.sin(frame * .13) * .65, Math.cos(frame * .17) * .3, .2);
      scene.updateMatrixWorld(true); controller.update();
      assert.equal(actor.active, true);
      const duplicate = compareSkin(fixture);
      assert.equal(duplicate.geometry, mesh.geometry);
      assert.notEqual(duplicate.skeleton, mesh.skeleton);
      duplicate.skeleton.bones.forEach((bone, i) => assert.notEqual(bone, mesh.skeleton.bones[i]));
      assert.ok(actor.clone.matrixWorld.elements.every(Number.isFinite));
    }
  }
  assert.deepEqual(mesh.geometry.attributes.position.array, sourcePositions);
  assert.deepEqual(mesh.skeleton.boneInverses.map(matrix => matrix.elements), sourceInverses);
  controller.dispose();
});

test('complementary clip halves isolate materials and retain textures, then restore all originals', () => {
  const { scene, controller, actor, mesh, gun, material, texture, root, frames } = actorFixture();
  const untouched = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(untouched);
  const originalPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 3)]; material.clippingPlanes = originalPlanes;
  scene.updateMatrixWorld(true); controller.update();
  const duplicate = actor.pairs.find(pair => pair.source === mesh).destination;
  assert.notEqual(mesh.material, material);
  assert.notEqual(mesh.material, duplicate.material);
  assert.notEqual(mesh.material, gun.material, 'each mesh has independent clipping state');
  assert.equal(mesh.material.map, texture); assert.equal(duplicate.material.map, texture);
  assert.equal(untouched.material, material);
  assert.equal(material.clippingPlanes, originalPlanes);
  assert.equal(material.clippingPlanes.length, 1);
  assert.equal(mesh.material.clipShadows, true);
  const front = new THREE.Vector3(.1, .5, .2), back = new THREE.Vector3(.1, .5, -.2);
  assert.ok(actor.sourcePlane.distanceToPoint(front) > 0);
  assert.ok(actor.sourcePlane.distanceToPoint(back) < 0);
  assert.ok(actor.destinationPlane.distanceToPoint(transformPortalPoint(front, frames[0], frames[1])) < 0);
  assert.ok(actor.destinationPlane.distanceToPoint(transformPortalPoint(back, frames[0], frames[1])) > 0);
  material.emissive.setHex(0x315779); material.opacity = .63; controller.update();
  assert.equal(duplicate.material.emissive.getHex(), 0x315779);
  assert.equal(duplicate.material.opacity, .63);
  root.position.z = 6; scene.updateMatrixWorld(true); controller.update();
  assert.equal(mesh.material, material); assert.equal(gun.material, material);
  assert.equal(actor.clone.visible, false); assert.equal(controller.diagnostics.active, 0);
  controller.dispose();
  assert.equal(mesh.material, material);
});

test('duplicate follows an actual weapon hand-to-body reparent and clones no stale old branch', () => {
  const fixture = actorFixture();
  const { scene, controller, actor, hip, hand, gun, mesh } = fixture;
  scene.updateMatrixWorld(true); controller.update();
  const oldClone = actor.clone;
  hip.attach(gun); gun.rotation.x = .8; hand.rotation.z = .42;
  scene.updateMatrixWorld(true); controller.update();
  assert.notEqual(actor.clone, oldClone);
  assert.equal(oldClone.parent, null);
  const cloneGun = actor.pairs.find(pair => pair.source === gun).destination;
  const cloneHip = actor.pairs.find(pair => pair.source === hip).destination;
  assert.equal(cloneGun.parent, cloneHip);
  assert.equal(cloneGun.geometry, gun.geometry);
  assert.equal(actor.pairs.filter(pair => pair.source === gun).length, 1);
  const transform = portalTransformMatrix(fixture.frames[0], fixture.frames[1]);
  const expected = gun.getWorldPosition(new THREE.Vector3()).applyMatrix4(transform);
  assert.ok(cloneGun.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-7);
  compareSkin(fixture);
  assert.equal(actor.pairs.filter(pair => pair.source === mesh).length, 1);
  controller.dispose();
});

test('at physics crossing original and duplicate swap portal sides without changing the represented pose', () => {
  const fixture = actorFixture();
  const { scene, root, parent, controller, actor, frames, mesh } = fixture;
  scene.updateMatrixWorld(true); controller.update();
  const oldDuplicate = actor.pairs.find(pair => pair.source === mesh).destination;
  const represented = [...Array(mesh.geometry.attributes.position.count)].map((_, i) =>
    oldDuplicate.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(oldDuplicate.matrixWorld));
  const nextWorld = portalTransformMatrix(frames[0], frames[1]).multiply(root.matrixWorld);
  new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(nextWorld).decompose(root.position, root.quaternion, root.scale);
  scene.updateMatrixWorld(true); controller.update();
  assert.equal(actor.entryIndex, 1);
  for (let i = 0; i < represented.length; i++) {
    const actual = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    assert.ok(actual.distanceTo(represented[i]) < 2e-6);
  }
  compareSkin(fixture);
  controller.dispose();
});

test('unlinked, hidden, distant, or nonfinite actors produce no active duplicate and clean disposal shares no resources', () => {
  const { scene, controller, actor, root, mesh, material, texture, portals } = actorFixture();
  let geometryDisposals = 0; let textureDisposals = 0; let materialDisposals = 0;
  mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  portals.ready = false; controller.update(); assert.equal(actor.clone, null);
  portals.ready = true; scene.updateMatrixWorld(true); controller.update(); assert.equal(actor.active, true);
  for (const change of [
    () => { root.visible = false; },
    () => { root.visible = true; root.position.x = 10; },
    () => { root.position.x = NaN; },
    () => { root.position.x = 0; portals.portals[1] = null; },
  ]) {
    change(); scene.updateMatrixWorld(true); controller.update();
    assert.equal(actor.active, false); assert.equal(actor.clone.visible, false);
    assert.equal(mesh.material, material); assert.equal(controller.diagnostics.clones, 0);
  }
  const duplicateRoot = actor.clone;
  controller.dispose();
  assert.equal(duplicateRoot.parent, null); assert.equal(mesh.material, material);
  assert.equal(controller.actors.size, 0);
  assert.equal(geometryDisposals, 0); assert.equal(textureDisposals, 0); assert.equal(materialDisposals, 0);
});

test('shader pulse uses the same live uniforms and owned clipping code', () => {
  const { scene, controller, actor, gun } = actorFixture();
  const original = new THREE.ShaderMaterial({ uniforms: { strength: { value: 0 } },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float strength; void main() { gl_FragColor = vec4(strength); }' });
  gun.material = original;
  scene.updateMatrixWorld(true); controller.update();
  const duplicate = actor.pairs.find(pair => pair.source === gun).destination;
  assert.equal(duplicate.material.uniforms, original.uniforms);
  assert.equal(gun.material.uniforms, original.uniforms);
  assert.ok(duplicate.material.vertexShader.includes('clipping_planes_pars_vertex'));
  assert.ok(duplicate.material.fragmentShader.includes('clipping_planes_fragment'));
  assert.equal(original.clippingPlanes, null);
  assert.ok(!original.vertexShader.includes('clipping_planes'));
  original.uniforms.strength.value = .79;
  assert.equal(duplicate.material.uniforms.strength.value, .79);
  controller.dispose(); assert.equal(gun.material, original);
});

test('sphere edge overlapping a portal never clips an actor standing beside the aperture', () => {
  const { root, parent, scene, controller, actor, mesh, material } = actorFixture();
  parent.position.set(0, 0, 0); parent.rotation.set(0, 0, 0);
  root.position.set(1.5, 0, .15);
  scene.updateMatrixWorld(true); controller.update();
  assert.equal(actor.active, false);
  assert.equal(actor.clone, null);
  assert.equal(mesh.material, material);
  root.position.x = .1; scene.updateMatrixWorld(true); controller.update();
  assert.equal(actor.active, true);
  controller.dispose();
});

test('default visual bounds account for actor scale and need no skinned-vertex bounds pass', () => {
  const { scene, controller, actor, root, mesh } = actorFixture();
  controller.unregister(actor);
  root.scale.setScalar(.7);
  const inferred = controller.register(root);
  assert.ok(inferred.radius > 0 && inferred.radius < 2);
  assert.equal(inferred.radiusInWorld, false);
  assert.equal(mesh.boundingBox, null);
  scene.updateMatrixWorld(true); controller.update();
  assert.equal(inferred.active, true);
  assert.equal(mesh.boundingBox, null);
  controller.dispose();
});
