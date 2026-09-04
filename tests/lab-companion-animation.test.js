import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabCompanionAnimator } from '../src/game/LabCompanionAnimator.js';

function makeAnimator() {
  const root = new THREE.Group();
  root.position.set(3, 2, -5);
  root.rotation.set(0.1, 0.7, -0.2);
  root.scale.set(1.2, 1.3, 0.9);
  const visual = new THREE.Group();
  visual.position.set(0.2, -0.56, 0.1);
  visual.rotation.set(-0.08, 0.2, 0.07);
  visual.scale.set(1.1, 0.9, 1.2);
  const source = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.6), new THREE.MeshBasicMaterial());
  source.rotation.x = Math.PI / 2;
  source.position.y = 0.4;
  visual.add(source);
  root.add(visual);
  return { root, visual, source, animator: new LabCompanionAnimator({ visual }) };
}

function transform(object) {
  return [object.position.toArray(), object.quaternion.toArray(), object.scale.toArray()];
}

function advance(animator, duration, input = {}, hz = 60) {
  const frames = Math.round(duration * hz);
  for (let frame = 0; frame < frames; frame += 1) animator.update({ dt: duration / frames, ...input });
}

function assertFiniteBounded(animator) {
  assert.ok(animator.visual.position.toArray().every(Number.isFinite));
  assert.ok(animator.visual.quaternion.toArray().every(Number.isFinite));
  assert.ok(Math.abs(animator.visual.quaternion.lengthSq() - 1) < 1e-12);
  const { position, rotation } = animator.diagnostics.offset;
  assert.ok(Math.abs(position.x) <= 0.025 && position.y >= -0.04 && position.y <= 0.10 && Math.abs(position.z) <= 0.02);
  assert.ok(Math.abs(rotation.x) <= 0.18 && Math.abs(rotation.y) <= 0.20 && Math.abs(rotation.z) <= 0.20);
}

test('idle breathes and sways as one rigid visual, preserving physics, source geometry and scales', () => {
  const { root, visual, source, animator } = makeAnimator();
  const physics = transform(root), sourceTransform = transform(source), scale = visual.scale.toArray();
  const geometry = source.geometry, material = source.material;
  const attributes = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.array.slice()]));
  const index = geometry.index.array.slice();
  const ys = [], rolls = [];
  for (let frame = 0; frame < 240; frame += 1) {
    animator.update();
    ys.push(visual.position.y);
    rolls.push(animator.diagnostics.offset.rotation.z);
    assertFiniteBounded(animator);
  }
  assert.equal(animator.state, 'idle');
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.012, 'idle bob was absent');
  assert.ok(Math.max(...rolls) - Math.min(...rolls) > 0.02, 'idle sway was absent');
  assert.deepEqual(transform(root), physics);
  assert.deepEqual(transform(source), sourceTransform);
  assert.deepEqual(visual.scale.toArray(), scale);
  assert.equal(source.geometry, geometry);
  assert.equal(source.material, material);
  assert.equal(visual.children.length, 1);
  assert.equal(source.parent, visual);
  assert.equal(visual.parent, root);
  assert.deepEqual(geometry.index.array, index);
  for (const [name, data] of Object.entries(attributes)) assert.deepEqual(geometry.attributes[name].array, data);
});

test('curiosity is a smooth temporary look and lean, and sustained curiosity blends back out', () => {
  const { animator, visual } = makeAnimator();
  const neutral = makeAnimator().animator;
  assert.equal(animator.trigger('unknown'), false);
  assert.equal(animator.trigger(), true);
  let maxYaw = 0, previous = visual.quaternion.clone();
  for (let frame = 0; frame < 120; frame += 1) {
    animator.update();
    neutral.update();
    if (frame === 30) animator.trigger('curious');
    maxYaw = Math.max(maxYaw, Math.abs(animator.diagnostics.offset.rotation.y));
    assert.ok(previous.angleTo(visual.quaternion) < 0.02, 'curiosity snapped between frames');
    previous.copy(visual.quaternion);
  }
  assert.ok(maxYaw > 0.12, 'curiosity never looked aside');
  assert.equal(animator.diagnostics.clips.curious, null);
  assert.ok(visual.quaternion.angleTo(neutral.visual.quaternion) < 1e-7, 'look did not return to idle');
  advance(animator, 1, { curious: true });
  assert.equal(animator.state, 'curious');
  assert.ok(animator.diagnostics.curiousBlend > 0.99);
  advance(animator, 2);
  assert.equal(animator.state, 'idle');
  assert.ok(animator.diagnostics.curiousBlend < 0.00001);
});

test('celebration makes happy hops and a recovering wiggle without stretching the model', () => {
  const { animator, visual } = makeAnimator();
  const scale = visual.scale.toArray();
  animator.trigger('celebrate');
  let maxHop = 0, minRoll = Infinity, maxRoll = -Infinity;
  for (let frame = 0; frame < 120; frame += 1) {
    animator.update();
    const { position, rotation } = animator.diagnostics.offset;
    maxHop = Math.max(maxHop, position.y);
    minRoll = Math.min(minRoll, rotation.z);
    maxRoll = Math.max(maxRoll, rotation.z);
    assertFiniteBounded(animator);
  }
  assert.ok(maxHop > 0.04, 'happy hop was absent');
  assert.ok(maxRoll - minRoll > 0.16, 'celebration wiggle was absent');
  assert.equal(animator.diagnostics.clips.celebrate, null);
  assert.equal(animator.state, 'idle');
  assert.deepEqual(visual.scale.toArray(), scale);
  advance(animator, 1, { celebrating: true });
  assert.equal(animator.state, 'celebrate');
  advance(animator, 2);
  assert.equal(animator.state, 'idle');
});

test('air motion follows velocity, then landing compresses and springs back with no physics write', () => {
  const { animator, root } = makeAnimator();
  const physics = transform(root);
  advance(animator, 0.5, { speed: 3, grounded: false, velocity: { y: 4 } });
  assert.equal(animator.state, 'jump');
  const risingPitch = animator.diagnostics.offset.rotation.x;
  advance(animator, 0.5, { speed: 3, grounded: false, velocity: { y: -7 } });
  assert.equal(animator.state, 'fall');
  assert.ok(animator.diagnostics.offset.rotation.x < risingPitch - 0.05);
  animator.update({ grounded: true });
  assert.equal(animator.state, 'landing');
  assert.ok(animator.diagnostics.landing < -0.005, 'landing did not compress');
  let rebound = 0;
  for (let frame = 0; frame < 90; frame += 1) {
    animator.update();
    rebound = Math.max(rebound, animator.diagnostics.landing);
    assertFiniteBounded(animator);
  }
  assert.ok(rebound > 0.002, 'landing had no springy rebound');
  assert.ok(Math.abs(animator.diagnostics.landing) < 0.000001);
  assert.equal(animator.state, 'idle');
  assert.deepEqual(transform(root), physics);
  assert.equal(animator.trigger('landing'), true);
  animator.update();
  assert.equal(animator.state, 'landing');
});

test('same timed changes and cue triggers produce equivalent poses at 30, 60 and 144 Hz', () => {
  function run(hz) {
    const { animator, visual } = makeAnimator();
    const samples = [];
    const sample = () => samples.push({ position: visual.position.clone(), quaternion: visual.quaternion.clone(), diagnostic: animator.diagnostics });
    advance(animator, 0.5, {}, hz); sample();
    animator.trigger('curious');
    advance(animator, 0.5, { speed: 3, curious: true }, hz); sample();
    animator.trigger('celebrate');
    advance(animator, 0.5, { speed: 5, celebrating: true }, hz); sample();
    advance(animator, 0.5, { grounded: false, velocity: { y: -6 } }, hz); sample();
    advance(animator, 0.5, { grounded: true }, hz); sample();
    advance(animator, 1, {}, hz); sample();
    return samples;
  }
  const reference = run(60);
  for (const hz of [30, 144]) {
    for (const [i, sample] of run(hz).entries()) {
      const expected = reference[i];
      assert.ok(sample.position.distanceTo(expected.position) < 1e-10, `${hz} Hz position differed at sample ${i}`);
      assert.ok(sample.quaternion.angleTo(expected.quaternion) < 1e-7, `${hz} Hz rotation differed at sample ${i}`);
      assert.equal(sample.diagnostic.state, expected.diagnostic.state);
      assert.ok(Math.abs(sample.diagnostic.landing - expected.diagnostic.landing) < 1e-12);
    }
  }
});

test('long frame uses the same elapsed motion and landing spring as many short frames', () => {
  const a = makeAnimator().animator, b = makeAnimator().animator;
  for (const animator of [a, b]) {
    animator.trigger('curious');
    animator.trigger('celebrate');
    animator.triggerLanding(10);
  }
  a.update({ dt: 1, speed: 5, curious: true });
  advance(b, 1, { speed: 5, curious: true }, 144);
  assert.ok(a.visual.position.distanceTo(b.visual.position) < 1e-10);
  assert.ok(a.visual.quaternion.angleTo(b.visual.quaternion) < 1e-7);
  assertFiniteBounded(a);
});

test('bad numbers remain finite, diagnostics are snapshots, and reset restores authored local pose', () => {
  const { root, visual, source, animator } = makeAnimator();
  const rest = transform(visual), physics = transform(root), sourceTransform = transform(source);
  animator.triggerLanding(NaN);
  animator.trigger('celebrate');
  animator.update({ dt: NaN, elapsed: Infinity, speed: Infinity, velocity: { y: NaN }, curious: true });
  assertFiniteBounded(animator);
  animator.update({ dt: 20, elapsed: 800, speed: 1000, grounded: false, velocity: { y: -1000 }, celebrating: true });
  assertFiniteBounded(animator);
  animator.trigger('curious');
  const snapshot = animator.diagnostics;
  snapshot.clips.curious.elapsed = 100;
  snapshot.offset.position.y = 99;
  assert.equal(animator.diagnostics.clips.curious.elapsed, 0);
  assert.notEqual(animator.diagnostics.offset.position.y, 99);
  animator.reset();
  assert.deepEqual(transform(visual), rest);
  assert.deepEqual(transform(root), physics);
  assert.deepEqual(transform(source), sourceTransform);
  assert.equal(animator.state, 'idle');
  assert.equal(animator.diagnostics.elapsed, 0);
  assert.equal(animator.diagnostics.landing, 0);
  assert.deepEqual(animator.diagnostics.clips, { curious: null, celebrate: null });
  assert.equal(animator.diagnostics.moveBlend + animator.diagnostics.airBlend + animator.diagnostics.curiousBlend + animator.diagnostics.celebrateBlend, 0);
  assert.throws(() => new LabCompanionAnimator(), /visual child/);
});


test('overlapping event and sustained cues stay smooth through trigger and clip expiry', () => {
  const { animator, visual } = makeAnimator();
  advance(animator, 1, { curious: true, celebrating: true });
  let previousPosition = visual.position.clone(), previousQuaternion = visual.quaternion.clone();
  for (let frame = 0; frame < 180; frame += 1) {
    if (frame === 0 || frame === 115) {
      animator.trigger('curious');
      animator.trigger('celebrate');
    }
    animator.update({ curious: true, celebrating: true });
    assert.ok(visual.position.distanceTo(previousPosition) < 0.012, 'overlapping cues snapped position');
    assert.ok(visual.quaternion.angleTo(previousQuaternion) < 0.04, 'overlapping cues snapped rotation');
    previousPosition.copy(visual.position);
    previousQuaternion.copy(visual.quaternion);
  }
});

test('carried celebrations stay supported by the hands and settle continuously after pickup', () => {
  const { animator, visual, root, source } = makeAnimator();
  const physics = transform(root), authored = transform(source);
  advance(animator, 1, { carrying: true, grounded: false, celebrating: true, curious: true });
  let maximumOffset = 0;
  for (let frame = 0; frame < 180; frame++) {
    animator.update({ carrying: true, grounded: false, celebrating: true, curious: true, velocity: { y: 4 } });
    maximumOffset = Math.max(maximumOffset, visual.position.distanceTo(animator.restPosition));
    assert.equal(animator.state, 'held'); assertFiniteBounded(animator);
  }
  assert.ok(maximumOffset < .003, `companion floated ${maximumOffset} metres off the supporting hands`);
  assert.deepEqual(transform(root), physics); assert.deepEqual(transform(source), authored);
  const heldPosition = visual.position.clone(), heldRotation = visual.quaternion.clone();
  animator.update({ carrying: false, grounded: false, velocity: { y: -1 } });
  assert.ok(visual.position.distanceTo(heldPosition) < .01, 'release pose snapped');
  assert.ok(visual.quaternion.angleTo(heldRotation) < .08, 'release rotation snapped');
});

test('real tumbling suppresses decorative motion without fighting the rigid body pose', () => {
  const { animator, visual, root } = makeAnimator(); const physics = transform(root);
  advance(animator, 1, { grounded: false, angularVelocity: { x: 5, y: 3, z: -2 }, celebrating: true, curious: true });
  assert.equal(animator.state, 'tumble');
  assert.ok(visual.position.distanceTo(animator.restPosition) < 0.0001);
  assert.ok(visual.quaternion.angleTo(animator.restQuaternion) < 0.0001);
  assert.deepEqual(transform(root), physics);
  advance(animator, 1, { grounded: true });
  assert.ok(animator.diagnostics.tumbleBlend < 0.0001);
});

test('portal surprise, pickup nod and autonomous attention have smooth non-random recovery', () => {
  for (const kind of ['pickup', 'release', 'portal', 'startle', 'nod']) {
    const { animator, visual } = makeAnimator();
    assert.equal(animator.trigger(kind), true);
    let previous = visual.quaternion.clone(), maximumChange = 0;
    for (let frame = 0; frame < 100; frame++) {
      animator.update();
      const change = visual.quaternion.angleTo(previous); maximumChange = Math.max(change, maximumChange);
      assert.ok(change < .025, `${kind} reaction snapped`); previous.copy(visual.quaternion);
    }
    assert.ok(maximumChange > .002, `${kind} reaction was absent`);
    assert.equal(animator.diagnostics.reaction, null);
  }
  const a = makeAnimator().animator, b = makeAnimator().animator;
  advance(a, 5.2, {}, 30); advance(b, 5.2, {}, 144);
  assert.ok(Math.abs(a.diagnostics.offset.rotation.y) > .06, 'quiet companion never looked around');
  assert.ok(a.visual.position.distanceTo(b.visual.position) < 1e-10);
  assert.ok(a.visual.quaternion.angleTo(b.visual.quaternion) < 1e-7);
});
