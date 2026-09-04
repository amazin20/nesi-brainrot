import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LabPortals, applyPortalObliqueClipping, makePortalFrame, pointInsidePortal,
  portalCrossing, transformPortalDirection, transformPortalPoint,
} from '../src/game/LabPortals.js';

const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (actual, expected) => assert.ok(actual.distanceTo(expected) < 1e-7, `${actual.toArray()} != ${expected.toArray()}`);

test('linked aperture maps world position and conserves velocity with a half turn', () => {
  const a = makePortalFrame(vec(0, 1.5, 0), vec(0, 0, 1));
  const b = makePortalFrame(vec(8, 1.5, -12), vec(0, 0, 1));
  near(transformPortalPoint(vec(0.2, 2, 3), a, b), vec(7.8, 2, -15));
  const speed = vec(2, -4, -7);
  const rotated = transformPortalDirection(speed, a, b);
  near(rotated, vec(-2, -4, 7));
  assert.ok(Math.abs(rotated.length() - speed.length()) < 1e-8);
});

test('perpendicular exit rotates momentum and inverse mapping restores it', () => {
  const a = makePortalFrame(vec(1, 2, 3), vec(0, 0, 1));
  const b = makePortalFrame(vec(9, 2, -6), vec(1, 0, 0));
  const speed = vec(0, -3, -6);
  const transformed = transformPortalDirection(speed, a, b);
  near(transformed, vec(6, -3, 0));
  near(transformPortalDirection(transformed, b, a), speed);
  const point = vec(2, 2.3, 4);
  near(transformPortalPoint(transformPortalPoint(point, a, b), b, a), point);
});

test('swept crossing only traverses front to back and clears the exit wall', () => {
  const a = makePortalFrame(vec(0, 1.5, 0), vec(0, 0, 1));
  const b = makePortalFrame(vec(7, 1.5, -9), vec(0, 0, -1));
  const velocity = vec(0, 0, -6);
  const result = portalCrossing(a, b, vec(0, 1.5, -0.08), vec(0, 1.5, 0.13), velocity);
  assert.ok(result);
  near(result.velocity, velocity);
  assert.ok(result.position.clone().sub(b.position).dot(b.normal) >= 0.55 - 1e-8);
  assert.equal(portalCrossing(a, b, vec(0, 1.5, 0.13), vec(0, 1.5, -0.08), velocity), null);
  assert.equal(portalCrossing(a, b, vec(0, 1.5, 0.13), vec(0, 1.5, 0.2), velocity), null);
});

test('capsule radius blocks aperture edges, including diagonal corners', () => {
  const a = makePortalFrame(vec(0, 1.5, 0), vec(0, 0, 1));
  const b = makePortalFrame(vec(0, 1.5, -5), vec(0, 0, -1));
  assert.ok(pointInsidePortal(a, vec(0.5, 1.5, 0), 0.45));
  assert.equal(pointInsidePortal(a, vec(0.9, 1.5, 0), 0.45), false);
  assert.equal(pointInsidePortal(a, vec(0.6, 2.3, 0), 0.45), false);
  assert.equal(portalCrossing(a, b, vec(1.15, 1.5, -1), vec(1.15, 1.5, 1), vec(0, 0, -4)), null);
});

test('one aperture does not teleport; clear removes its GPU scene objects', () => {
  const scene = new THREE.Scene();
  const portals = new LabPortals({ scene });
  portals.place(0, vec(0, 1.5, 0), vec(0, 0, 1));
  assert.equal(portals.ready, false);
  assert.equal(portals.tryTeleport(vec(0, 1.5, -1), vec(0, 1.5, 1), vec(0, 0, -2)), null);
  portals.place(1, vec(0, 1.5, -8), vec(0, 0, -1));
  assert.equal(portals.ready, true);
  const result = portals.tryTeleport(vec(0, 1.5, -1), vec(0, 1.5, 1), vec(0, 0, -2));
  assert.equal(result.entryIndex, 0);
  assert.equal(result.exitIndex, 1);
  portals.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(portals.ready, false);
});

test('oblique destination plane clips supporting wall and keeps room beyond it', () => {
  const exit = makePortalFrame(vec(0, 1.5, 0), vec(0, 0, 1));
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 1.5, -4);
  camera.lookAt(0, 1.5, 5);
  applyPortalObliqueClipping(camera, exit);
  const wall = vec(0, 1.5, 0).project(camera);
  const room = vec(0, 1.5, 2).project(camera);
  assert.ok(wall.z < -1, `wall depth ${wall.z}`);
  assert.ok(room.z > -1 && room.z < 1, `room depth ${room.z}`);
  assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
});

test('offscreen rendering restores viewport and portal visibility even after a render error', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 1.5, 5);
  camera.lookAt(0, 1.5, 0);
  const originalTarget = { name: 'main target' };
  let target = originalTarget;
  let viewport = new THREE.Vector4(10, 20, 1280, 720);
  let scissor = new THREE.Vector4(3, 4, 100, 200);
  let scissorTest = true;
  const renderer = {
    xr: { enabled: true }, shadowMap: { autoUpdate: true },
    getRenderTarget: () => target, setRenderTarget: (value) => { target = value; },
    getViewport: (result) => result.copy(viewport),
    setViewport: (...args) => { viewport = args.length === 1 ? args[0].clone() : new THREE.Vector4(...args); },
    getScissor: (result) => result.copy(scissor), setScissor: (value) => { scissor = value.clone(); },
    getScissorTest: () => scissorTest, setScissorTest: (value) => { scissorTest = value; },
    clear: () => {},
    render: () => { throw new Error('WebGL interruption'); },
  };
  const portals = new LabPortals({ scene, renderer, camera });
  portals.place(0, vec(0, 1.5, 0), vec(0, 0, 1));
  portals.place(1, vec(5, 1.5, -9), vec(0, 0, 1));
  assert.throws(() => portals.render(1), /WebGL interruption/);
  assert.equal(target, originalTarget);
  assert.deepEqual(viewport.toArray(), [10, 20, 1280, 720]);
  assert.deepEqual(scissor.toArray(), [3, 4, 100, 200]);
  assert.equal(scissorTest, true);
  assert.equal(renderer.xr.enabled, true);
  assert.equal(renderer.shadowMap.autoUpdate, true);
  assert.ok(portals.portals.every((frame) => frame.group.visible));
  assert.equal(portals._rendering, false);
  portals.dispose();
});
