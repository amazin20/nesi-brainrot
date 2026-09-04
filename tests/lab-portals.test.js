import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LabPortals, applyPortalObliqueClipping, makePortalFrame, pointInsidePortal,
  portalCrossing, portalTargetSize, portalViewportRect, transformPortalDirection, transformPortalPoint,
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
    getScissor: (result) => result.copy(scissor),
    setScissor: (...args) => { scissor = args.length === 1 ? args[0].clone() : new THREE.Vector4(...args); },
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

function renderFixture(options = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  camera.position.set(0, 1.5, 5); camera.lookAt(0, 1.5, 0);
  let target = null;
  let viewport = new THREE.Vector4(0, 0, 1920, 1080);
  let scissor = new THREE.Vector4(0, 0, 1920, 1080);
  let scissorTest = false;
  const calls = [];
  const buffer = new THREE.Vector2(1920, 1080);
  const renderer = {
    xr: { enabled: false }, shadowMap: { autoUpdate: true }, capabilities: { maxSamples: 4 },
    extensions: { has: (name) => name === 'EXT_color_buffer_float' },
    getRenderTarget: () => target, setRenderTarget: (value) => { target = value; },
    getDrawingBufferSize: (result) => result.copy(buffer),
    getViewport: (result) => result.copy(viewport),
    setViewport: (...args) => { viewport = args.length === 1 ? args[0].clone() : new THREE.Vector4(...args); },
    getScissor: (result) => result.copy(scissor),
    setScissor: (...args) => { scissor = args.length === 1 ? args[0].clone() : new THREE.Vector4(...args); },
    getScissorTest: () => scissorTest, setScissorTest: (value) => { scissorTest = value; },
    clear: () => {},
    render: (renderScene, renderCamera) => {
      for (const group of renderScene.children) {
        if (!group.visible) continue;
        for (const object of group.children) {
          if (object.visible && object.material?.uniforms?.view) {
            assert.notEqual(object.material.uniforms.view.value, target.texture, 'portal framebuffer feedback');
          }
        }
      }
      calls.push({ target, viewport: viewport.clone(), scissor: scissor.clone(), scissorTest, camera: renderCamera.clone() });
    },
  };
  const portals = new LabPortals({ scene, renderer, camera, ...options });
  portals.place(0, vec(0, 1.5, 0), vec(0, 0, 1));
  portals.place(1, vec(0, 1.5, 10), vec(0, 0, -1));
  return { portals, renderer, camera, calls, buffer };
}

test('target resolution follows drawing-buffer size and caps the long edge without upscaling', () => {
  assert.deepEqual(portalTargetSize(1920, 1080), { width: 1280, height: 720 });
  assert.deepEqual(portalTargetSize(1080, 1920), { width: 720, height: 1280 });
  assert.deepEqual(portalTargetSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(portalTargetSize(3840, 2160, 1024), { width: 1024, height: 576 });
});

test('portal views update on every render call including 144 Hz and a paused game clock', () => {
  const { portals, calls } = renderFixture({ recursion: false });
  portals.render(1);
  const perFrame = calls.length;
  assert.equal(perFrame, 1);
  portals.render(1 + 1 / 144);
  portals.render(1 + 1 / 144);
  assert.equal(calls.length, perFrame * 3);
  assert.equal(portals.diagnostics.cadence, 'every-render-frame');
  portals.dispose();
});

test('one nested view is current-frame, bounded and never samples its active target', () => {
  const { portals, calls } = renderFixture();
  const textures = portals.portals.map((frame) => frame.surface.material.uniforms.view.value);
  portals.render(0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].target, portals.bounceTarget);
  assert.equal(calls[1].target, portals.targets[0]);
  assert.equal(portals.diagnostics.nested, 1);
  assert.equal(portals.diagnostics.visible, 1);
  for (let index = 0; index < 2; index++) {
    assert.equal(portals.portals[index].surface.material.uniforms.view.value, textures[index]);
    assert.equal(portals.portals[index].group.visible, true);
  }
  portals.dispose();
});

test('HDR views use linear half floats and canvas tone mapping, with supported MSAA', () => {
  const { portals } = renderFixture();
  for (const target of portals.targets) {
    assert.equal(target.texture.type, THREE.HalfFloatType);
    assert.equal(target.texture.colorSpace, THREE.LinearSRGBColorSpace);
    assert.equal(target.samples, 4);
  }
  assert.equal(portals.bounceTarget.samples, 0, 'the small nested aperture does not need extra MSAA storage');
  assert.ok(portals.portals.every((frame) => frame.surface.material.toneMapped));
  portals.dispose();
});

test('offscreen and back-facing apertures do not spend render passes', () => {
  const { portals, camera, calls } = renderFixture();
  camera.lookAt(100, 1.5, 5);
  portals.render(0);
  assert.equal(calls.length, 0);
  assert.equal(portals.diagnostics.visible, 0);
  const back = makePortalFrame(vec(0, 1.5, 0), vec(0, 0, -1));
  assert.equal(portalViewportRect(back, camera, 1280, 720), null);
  portals.dispose();
});

test('scissor contains the projected aperture while preserving screen-space sampling', () => {
  const { portals, camera, calls } = renderFixture({ recursion: false });
  portals.render(0);
  const call = calls[0];
  assert.deepEqual(call.viewport.toArray(), [0, 0, 1280, 720]);
  assert.equal(call.scissorTest, true);
  assert.ok(call.scissor.z < 1280 && call.scissor.w < 720);
  const frame = portals.portals[0];
  for (let index = 0; index < 32; index++) {
    const angle = index / 32 * Math.PI * 2;
    const point = vec(Math.cos(angle) * frame.width, Math.sin(angle) * frame.height, 0)
      .applyQuaternion(frame.quaternion).add(frame.position).project(camera);
    const x = (point.x * 0.5 + 0.5) * 1280; const y = (point.y * 0.5 + 0.5) * 720;
    assert.ok(x >= call.scissor.x && x <= call.scissor.x + call.scissor.z);
    assert.ok(y >= call.scissor.y && y <= call.scissor.y + call.scissor.w);
  }
  portals.dispose();
});

test('target resizing tracks portrait viewports and remains stable between equal frames', () => {
  const { portals, buffer } = renderFixture({ recursion: false });
  portals.render(0);
  let disposals = 0;
  portals.targets[0].addEventListener('dispose', () => disposals++);
  portals.render(1 / 60);
  assert.equal(disposals, 0);
  buffer.set(720, 1280);
  portals.render(2 / 60);
  assert.equal(disposals, 1);
  assert.equal(portals.targets[0].width, 720);
  assert.equal(portals.targets[0].height, 1280);
  portals.dispose();
});

test('close and oblique exit planes retain finite projections and clip the supporting wall', () => {
  for (const distance of [0.003, 0.02, 0.1, 4]) {
    const exit = makePortalFrame(vec(2, 1.5, -3), vec(1, 0, 0));
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
    camera.position.copy(exit.position).addScaledVector(exit.normal, -distance);
    camera.lookAt(exit.position.clone().add(vec(5, 0.3, 0.5)));
    assert.equal(applyPortalObliqueClipping(camera, exit), true);
    assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
    assert.ok(camera.projectionMatrixInverse.elements.every(Number.isFinite));
    assert.ok(exit.position.clone().project(camera).z < -1);
    const beyond = exit.position.clone().addScaledVector(exit.normal, 2).project(camera);
    assert.ok(beyond.z > -1 && beyond.z < 1);
  }
});

test('stable portal borders do not pulse or distort the linked scene over time', () => {
  const { portals } = renderFixture();
  const opacity = portals.portals.map((frame) => frame.halo.material.opacity);
  portals.update(0); portals.update(12.8);
  assert.deepEqual(portals.portals.map((frame) => frame.halo.material.opacity), opacity);
  assert.ok(portals.portals.every((frame) => frame.surface.material.uniforms.linked.value === 1));
  portals.dispose();
});
