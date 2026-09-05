import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LabPortals, applyPortalObliqueClipping, makePortalFrame, pointInsidePortal,
  portalCrossing, portalTargetSize, portalViewportRect, transformPortalDirection, transformPortalPoint,
  resolvePortalPlacement, portalFramesOverlap, portalIntersectsBox, portalBacksCollider,
} from '../src/game/LabPortals.js';

const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const near = (actual, expected) => assert.ok(actual.distanceTo(expected) < 1e-7, `${actual.toArray()} != ${expected.toArray()}`);

function whitePanel(width = 12, height = 6) {
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, .2), new THREE.MeshBasicMaterial());
  panel.position.set(0, height / 2, 0);
  Object.assign(panel.userData, { portalable: true, center: vec(0, height / 2, .1), normal: vec(0, 0, 1) });
  panel.updateMatrixWorld(true);
  return panel;
}

test('placement follows the actual hit continuously instead of snapping to a panel centre', () => {
  const panel = whitePanel();
  for (const x of [-3.3, -.75, .123, 2.25]) {
    const point = vec(x, 3.5, .1);
    const result = resolvePortalPlacement(panel, point);
    assert.equal(result.ok, true);
    assert.equal(result.adjusted, false);
    near(result.position, point);
  }
});

test('edge adjustment keeps the complete rim on its panel and refuses off-panel hits', () => {
  const panel = whitePanel();
  const result = resolvePortalPlacement(panel, vec(5.99, 5.99, .1));
  assert.equal(result.ok, true);
  assert.equal(result.adjusted, true);
  assert.ok(result.position.x + result.frame.width * 1.1 <= 6 - .0199);
  assert.ok(result.position.y + result.frame.height * 1.1 <= 6 - .0199);
  assert.equal(resolvePortalPlacement(panel, vec(5.99, 5.99, .1), { clampToFit: false }).reason, 'edge');
  assert.equal(resolvePortalPlacement(panel, vec(9, 3, .1)).reason, 'outside');
  assert.equal(resolvePortalPlacement(panel, vec(0, 3, 4)).reason, 'outside');
});

test('two disjoint portals may share one large panel but an overlapping replacement is atomic', () => {
  const panel = whitePanel(); const portals = new LabPortals({ scene: new THREE.Scene() });
  const left = portals.placeOnPanel(0, panel, vec(-3, 3, .1));
  const right = portals.placeOnPanel(1, panel, vec(3, 3, .1));
  assert.equal(left.ok, true); assert.equal(right.ok, true);
  assert.equal(portals.ready, true);
  assert.equal(portalFramesOverlap(left.frame, right.frame), false);
  const before = portals.portals[1];
  assert.equal(portals.placeOnPanel(1, panel, vec(-2.5, 3, .1)).reason, 'overlap');
  assert.equal(portals.portals[1], before, 'a rejected shot erased the existing exit');
  assert.equal(portals.ready, true);
  portals.dispose();
});

test('forbidden and undersized surfaces cannot erase a previously valid portal', () => {
  const panel = whitePanel(); const portals = new LabPortals({ scene: new THREE.Scene() });
  portals.placeOnPanel(0, panel, vec(0, 3, .1)); const before = portals.portals[0];
  panel.userData.portalable = false;
  assert.equal(portals.placeOnPanel(0, panel, vec(0, 3, .1)).reason, 'forbidden');
  panel.userData.portalable = true; panel.userData.portalForbidden = true;
  assert.equal(portals.placeOnPanel(0, panel, vec(0, 3, .1)).reason, 'forbidden');
  assert.equal(portals.placeOnPanel(0, whitePanel(2, 3), vec(0, 1.5, .1)).reason, 'too-small');
  assert.equal(portals.portals[0], before);
  portals.dispose();
});

test('placement rejects a blocked opening but accepts its supporting wall and floor', () => {
  const panel = whitePanel();
  const support = { box: new THREE.Box3(vec(-8, 0, -.5), vec(8, 8, 0)), enabled: true };
  const floor = { box: new THREE.Box3(vec(-8, -.5, -10), vec(8, 0, 10)), enabled: true };
  const pillar = { box: new THREE.Box3(vec(-.25, 2, .3), vec(.25, 4, 1)), enabled: true };
  assert.equal(resolvePortalPlacement(panel, vec(0, 3, .1), { blockers: [panel, support, floor] }).ok, true);
  assert.equal(resolvePortalPlacement(panel, vec(0, 3, .1), { blockers: [support, pillar] }).reason, 'obstructed');
  assert.equal(resolvePortalPlacement(panel, vec(3, 3, .1), { blockers: [support, pillar] }).ok, true);
  pillar.enabled = false;
  assert.equal(resolvePortalPlacement(panel, vec(0, 3, .1), { blockers: [pillar] }).ok, true);
});

test('a diagonal portal on the real exit pad is not obstructed by distant long room walls', () => {
  const center = vec(-.4, .2, -13.1);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.684, .2, 3.684), new THREE.MeshBasicMaterial());
  Object.assign(panel.userData, { portalable: true, center, normal: vec(0, 1, 0), portalUp: vec(0, 0, 1),
    portalBounds: { halfWidth: 1.842, halfHeight: 1.842 } });
  const preferredUp = vec(-.8564211136514691, 0, -.5162779058723872);
  const blockers = [
    { box: new THREE.Box3(vec(-9.19, -3, -20), vec(-8.97, 6.2, 3)) },
    { box: new THREE.Box3(vec(-9, 0, -10.18), vec(4.8, 6.2, -9.96)) },
  ];
  const placement = resolvePortalPlacement(panel, vec(-.4011014, .1996526, -13.1006135), { preferredUp, blockers });
  assert.equal(placement.ok, true, `valid floor shot rejected as ${placement.reason}`);
  for (const blocker of blockers) assert.equal(portalIntersectsBox(placement.frame, blocker.box, .08, .85), false);
  blockers.push({ box: new THREE.Box3(vec(-.6, .35, -13.3), vec(-.2, .8, -12.9)) });
  assert.equal(resolvePortalPlacement(panel, center, { preferredUp, blockers }).reason, 'obstructed',
    'a real object inside the opening must still block placement');
});

test('rotated and scaled panels derive bounds in their own plane, not a world AABB', () => {
  const panel = whitePanel(6, 6); panel.scale.x = 1.5; panel.rotation.y = .73;
  panel.updateMatrixWorld(true);
  panel.userData.center = vec(0, 0, .1).applyMatrix4(panel.matrixWorld);
  panel.userData.normal = vec(0, 0, 1).transformDirection(panel.matrixWorld);
  const point = vec(1.4, .2, .1).applyMatrix4(panel.matrixWorld);
  const result = resolvePortalPlacement(panel, point);
  assert.equal(result.ok, true); assert.equal(result.adjusted, false);
  near(result.position, point);
  near(vec(0, 0, 1).applyQuaternion(result.frame.quaternion), panel.userData.normal);
});

test('floor and ceiling panel placement and momentum transforms remain orthonormal', () => {
  const frames = [];
  for (const sign of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(12, .2, 8), new THREE.MeshBasicMaterial());
    Object.assign(panel.userData, { portalable: true, center: vec(0, sign * .1, 0), normal: vec(0, sign, 0), portalUp: vec(0, 0, 1) });
    const point = vec(2, sign * .1, .5);
    const result = resolvePortalPlacement(panel, point);
    assert.equal(result.ok, true); near(result.position, point);
    near(vec(0, 0, 1).applyQuaternion(result.frame.quaternion), panel.userData.normal);
    frames.push(result.frame);
  }
  const velocity = vec(2, -8, -1);
  const transformed = transformPortalDirection(velocity, frames[0], frames[1]);
  assert.ok(Math.abs(transformed.length() - velocity.length()) < 1e-9);
  near(transformPortalDirection(transformed, frames[1], frames[0]), velocity);
});

test('aperture collider tests respect the ellipse and signed plane depth', () => {
  const frame = makePortalFrame(vec(0, 2, 0), vec(0, 0, 1));
  assert.equal(portalIntersectsBox(frame, new THREE.Box3(vec(-2, 0, -.4), vec(2, 4, -.1))), true);
  assert.equal(portalIntersectsBox(frame, new THREE.Box3(vec(-2, 0, -3), vec(2, 4, -2))), false);
  assert.equal(portalIntersectsBox(frame, new THREE.Box3(vec(1.05, 3.4, -.1), vec(1.2, 3.55, .1))), false);
  assert.equal(portalIntersectsBox(frame, new THREE.Box3(vec(-.1, 1.9, .3), vec(.1, 2.1, .5)), .08, .85), true);
  assert.equal(portalBacksCollider(frame, new THREE.Box3(vec(-2, 0, -.4), vec(2, 4, -.1))), true);
  assert.equal(portalBacksCollider(frame, new THREE.Box3(vec(-12, -.2, -12), vec(12, .1, 12))), false, 'the floor must not open with a wall portal');
  assert.equal(portalBacksCollider(frame, new THREE.Box3(vec(-.1, 1.9, .3), vec(.1, 2.1, .5))), false, 'an object in front is not a backing wall');
});

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
  const clearance = result.position.clone().sub(b.position).dot(b.normal);
  assert.ok(clearance >= .45 && clearance <= .48, 'the whole radius clears the wall without an oversized exit push');
  near(result.position.clone().sub(result.exitOffset), result.unadjustedPosition);
  assert.equal(portalCrossing(a, b, vec(0, 1.5, 0.13), vec(0, 1.5, -0.08), velocity), null);
  assert.equal(portalCrossing(a, b, vec(0, 1.5, 0.13), vec(0, 1.5, 0.2), velocity), null);
});

test('floor orientation follows heading and checks the rotated rim against the actual surface bounds', () => {
  const panel = new THREE.Mesh(new THREE.BoxGeometry(5, .2, 3), new THREE.MeshBasicMaterial());
  Object.assign(panel.userData, { portalable: true, center: vec(0, .1, 0), normal: vec(0, 1, 0),
    portalUp: vec(0, 0, 1), portalBounds: { halfWidth: 2.5, halfHeight: 1.5 } });
  assert.equal(resolvePortalPlacement(panel, vec(0, .1, 0)).reason, 'too-small');
  const alongWidth = resolvePortalPlacement(panel, vec(0, .1, 0), { preferredUp: vec(1, 0, 0) });
  assert.equal(alongWidth.ok, true);
  near(vec(0, 1, 0).applyQuaternion(alongWidth.frame.quaternion), vec(1, 0, 0));
  const diagonal = resolvePortalPlacement(panel, vec(0, .1, 0), { preferredUp: vec(1, 0, 1) });
  assert.equal(diagonal.reason, 'too-small', 'changing heading silently rotated the narrow surface bounds');
  panel.userData.portalBounds.halfHeight = 2;
  const moved = resolvePortalPlacement(panel, vec(2.3, .1, .9), { preferredUp: vec(1, 0, 1) });
  assert.equal(moved.ok, true); assert.equal(moved.adjusted, true);
  for (let i = 0; i < 128; i++) {
    const angle = i / 128 * Math.PI * 2;
    const rim = vec(Math.cos(angle) * moved.frame.width * 1.1, Math.sin(angle) * moved.frame.height * 1.1, 0)
      .applyQuaternion(moved.frame.quaternion).add(moved.position);
    assert.ok(Math.abs(rim.x) <= 2.5 - .0199 && Math.abs(rim.z) <= 2 - .0199);
  }
});

test('portal attaches to the animated real surface and preserves its position within a rotating panel', () => {
  const scene = new THREE.Scene(); const portals = new LabPortals({ scene });
  const hinge = new THREE.Group(); scene.add(hinge);
  const panel = whitePanel(6, 6); hinge.add(panel);
  const anchor = new THREE.Object3D(); anchor.position.set(0, 0, .1); panel.add(anchor);
  panel.userData.portalFrame = () => {
    anchor.updateWorldMatrix(true, false);
    return { center: anchor.getWorldPosition(new THREE.Vector3()), normal: vec(0, 0, 1).transformDirection(anchor.matrixWorld),
      up: vec(0, 1, 0).transformDirection(anchor.matrixWorld), halfWidth: 3, halfHeight: 3, anchor };
  };
  const placed = portals.placeOnPanel(0, panel, vec(.35, 3.2, .1));
  assert.equal(placed.ok, true);
  const local = anchor.worldToLocal(placed.position.clone());
  hinge.rotation.x = -.83; hinge.position.y = .16;
  portals.syncMovingSurfaces();
  near(placed.frame.position, anchor.localToWorld(local.clone()));
  near(placed.frame.normal, vec(0, 0, 1).transformDirection(anchor.matrixWorld));
  near(placed.frame.group.position, placed.frame.position.clone().addScaledVector(placed.frame.normal, .036));
  const fresh = resolvePortalPlacement(panel, anchor.localToWorld(vec(0, 0, 0)), { preferredUp: vec(1, 0, 0) });
  assert.equal(fresh.ok, true, 'shooting the moved model used stale static metadata');
  portals.dispose();
});

test('caller can request a continuous open-aperture crossing and gets swept timing without losing momentum', () => {
  const entry = makePortalFrame(vec(0, 1.5, 0), vec(0, 0, 1));
  const exit = makePortalFrame(vec(0, 1.5, -10), vec(0, 0, -1));
  const before = vec(.1, 1.5, .06); const position = vec(.1, 1.5, -.02); const velocity = vec(0, 0, -6);
  const crossing = portalCrossing(entry, exit, position, before, velocity, .45, { exitClearance: 0 });
  near(crossing.position, transformPortalPoint(position, entry, exit));
  assert.ok(Math.abs(crossing.crossingFraction - .75) < 1e-9);
  assert.equal(crossing.exitOffset.lengthSq(), 0);
  near(crossing.velocity, velocity);
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
