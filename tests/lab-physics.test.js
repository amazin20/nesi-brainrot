import test from 'node:test';
import assert from 'node:assert/strict';
import { Body, Quaternion, Vec3 } from 'cannon-es';
import { LabPhysics } from '../src/game/LabPhysics.js';

function run(physics, seconds, hz = 120) {
  for (let i = 0; i < Math.round(seconds * hz); i++) physics.step(1 / hz);
}

function fixture(options = {}) {
  const physics = new LabPhysics(options);
  physics.addStaticBox('floor', { min: [-20, -1, -20], max: [20, 0, 20] });
  return physics;
}

function close(actual, expected, tolerance = 1e-6, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} != ${expected}`);
}

test('cargo is a 0.78 m dynamic box which tumbles, collides, settles and sleeps', () => {
  const physics = fixture();
  const body = physics.createCargo({ position: [0, 3, 0], angularVelocity: [2, 0, 1], velocity: [1.5, 0, .5] });
  assert.equal(body.type, Body.DYNAMIC);
  assert.equal(body.mass, 3.2);
  close(body.shapes[0].halfExtents.x * 2, .78);
  run(physics, .35);
  assert.ok(Math.abs(body.quaternion.w) < .96, 'independent angular motion changes the pose');
  assert.ok(body.position.y > .39, 'the body falls under gravity rather than snapping to the floor');
  run(physics, 7.65);
  const result = physics.sample(1);
  close(result.position.y, .39, .003, 'a cube face comes to rest on the floor');
  assert.equal(result.sleeping, true);
  assert.equal(result.grounded, true);
  assert.equal(result.velocity.length(), 0);
  assert.equal(result.angularVelocity.length(), 0);
  assert.ok(result.position.x > .1, 'release momentum produced actual travel');
  physics.dispose();
});

test('120 Hz bounded travel stops a high-speed cargo at a thin wall', () => {
  for (const hz of [30, 60, 144]) {
    const physics = fixture();
    physics.addStaticBox('thin-wall', { min: [0, 0, -5], max: [.04, 5, 5] });
    const body = physics.createCargo({ position: [-2, 1, 0], velocity: [80, 0, 0], angularVelocity: [1, 3, 2] });
    let furthest = -Infinity;
    for (let i = 0; i < hz; i++) { physics.step(1 / hz); furthest = Math.max(furthest, body.position.x); }
    assert.ok(furthest < -.26, `cargo crossed a wall at ${hz} fps: ${furthest}`);
    assert.ok(body.position.y > .37, 'the floor was not tunneled through');
    physics.dispose();
  }
});

test('carry uses a collision-constrained spring and cannot pull cargo through a wall', () => {
  const physics = fixture();
  physics.addStaticBox('wall', { min: [0, 0, -5], max: [.2, 5, 5] });
  const body = physics.createCargo({ position: [-1.5, .41, 0] });
  const initial = body.position.clone();
  physics.setCarryTarget([1.5, 1.25, 0]);
  assert.ok(body.position.almostEquals(initial), 'pickup did not change world position');
  physics.step(1 / 120);
  assert.ok(body.position.distanceTo(initial) < .03, 'the first pickup frame is continuous');
  run(physics, 2);
  assert.ok(body.position.x < -.37, `blocked cargo leaked through the wall: ${body.position.x}`);
  assert.ok(body.position.y > .38, 'blocked pickup still respects the supporting floor');
  assert.equal(body.type, Body.DYNAMIC, 'carried object still participates in real contacts');
  assert.equal(physics.sample().carrying, true);
  physics.dispose();
});

test('carry tracks an upright hand target, then release preserves exact pose and momentum', () => {
  const physics = fixture();
  const tilted = new Quaternion().setFromEuler(.35, .6, -.25);
  const body = physics.createCargo({ position: [0, .45, 0], quaternion: tilted });
  for (let i = 0; i < 240; i++) {
    physics.setCarryTarget([i / 120, 1.25, 0], { velocity: [1, 0, 0] });
    physics.step(1 / 120);
  }
  close(body.position.y, 1.25, .015);
  assert.ok(Math.abs(body.quaternion.w) > .999, 'soft torque returns the box to an upright grip');
  const before = physics.sample(1);
  physics.release();
  const released = physics.sample(1);
  assert.deepEqual(released.position, before.position);
  assert.deepEqual(released.quaternion, before.quaternion);
  assert.deepEqual(released.velocity, before.velocity);
  assert.deepEqual(released.angularVelocity, before.angularVelocity);
  physics.step(1 / 120);
  assert.ok(body.position.x > before.position.x, 'the object keeps moving with its acquired momentum');
  assert.ok(body.position.y < before.position.y, 'gravity acts immediately after release');
  run(physics, 4);
  close(body.position.y, .39, .004);
  physics.dispose();
});

test('moving platforms lift a resting cargo continuously and retain horizontal friction', () => {
  const physics = new LabPhysics();
  const platform = (x, y) => ({ min: [x - 2, y - .3, -2], max: [x + 2, y, 2] });
  physics.addStaticBox('lift', platform(0, 0), { kinematic: true, friction: .9 });
  const body = physics.createCargo({ position: [0, .41, 0] });
  run(physics, 1.5);
  assert.equal(body.sleepState, Body.SLEEPING);
  let previousY = body.position.y;
  for (let i = 1; i <= 120; i++) {
    physics.updateStaticBox('lift', platform(i / 120, i / 120), 1 / 60);
    physics.step(1 / 60);
    assert.ok(Math.abs(body.position.y - previousY) < .055, 'platform support must move continuously');
    previousY = body.position.y;
  }
  close(body.position.y, 1.39, .025);
  assert.ok(body.position.x > .65, `platform friction did not carry the cargo: ${body.position.x}`);
  assert.equal(physics.sample(1).grounded, true);
  physics.dispose();
});

test('render interpolation and rigid motion are independent of 30/60/144 Hz frame delivery', () => {
  const results = [];
  for (const hz of [30, 60, 144]) {
    const physics = fixture();
    physics.createCargo({ position: [0, 2, 0], velocity: [2, 0, .4], angularVelocity: [1, .8, 2] });
    run(physics, 2, hz);
    results.push(physics.sample(1));
    assert.equal(physics.steps, 240);
    const a = physics.sample(0), b = physics.sample(1), mid = physics.sample(.5);
    close(mid.position.x, (a.position.x + b.position.x) / 2);
    close(mid.position.y, (a.position.y + b.position.y) / 2);
    close(Math.hypot(mid.quaternion.x, mid.quaternion.y, mid.quaternion.z, mid.quaternion.w), 1);
    physics.dispose();
  }
  for (const result of results.slice(1)) {
    assert.deepEqual(result.position, results[0].position);
    assert.deepEqual(result.quaternion, results[0].quaternion);
    assert.deepEqual(result.velocity, results[0].velocity);
  }
});

test('a foot-position player proxy pushes cargo without changing its identity or teleporting it', () => {
  const physics = fixture();
  const body = physics.createCargo({ position: [0, .41, 0] });
  const proxy = physics.setPlayerProxy({ position: [-1.5, 0, 0] });
  close(proxy.position.y, 1.2, 1e-9, 'proxy position is the middle of a 2.4 m player');
  for (let i = 0; i < 120; i++) {
    physics.setPlayerProxy({ position: [-1.5 + i / 120, 0, 0] }, 1 / 120);
    physics.step(1 / 120);
  }
  assert.ok(body.position.x > .15, 'player contact should push the box away');
  assert.ok(body.velocity.length() < 3, 'ordinary walking does not explosively launch the cargo');
  const before = body.position.clone();
  physics.setPlayerProxy({ position: [20, 0, -30] }, 1 / 120);
  physics.step(1 / 120);
  assert.ok(body.position.distanceTo(before) < .1, 'player portal crossing cannot drag cargo across rooms');
  assert.equal(physics.cargoBody, body);
  assert.throws(() => physics.createCargo(), /already exists/);
  assert.equal(physics.diagnostics.automaticTeleports, 0);
  physics.dispose();
});

test('only an explicit restart resets cargo and clears interpolation and carry momentum', () => {
  const physics = fixture();
  const body = physics.createCargo({ position: [0, 2, 0], velocity: [2, 3, 1] });
  physics.setCarryTarget([2, 1.25, 0]); run(physics, .2);
  const identity = body.id;
  physics.resetCargo({ position: [1, .41, 3] });
  assert.equal(physics.cargoBody.id, identity);
  assert.equal(physics.sample().carrying, false);
  for (const alpha of [0, .25, 1]) {
    assert.deepEqual(physics.sample(alpha).position, new Vec3(1, .41, 3));
    assert.equal(physics.sample(alpha).velocity.length(), 0);
    assert.equal(physics.sample(alpha).angularVelocity.length(), 0);
  }
  physics.removeStaticBox('floor');
  run(physics, 2);
  assert.ok(body.position.y < -5, 'a fall never silently moves the body back to a spawn point');
  assert.equal(physics.cargoBody.id, identity);
  physics.dispose();
});

test('a release overlapping the player falls naturally, then restores player contact after separation', () => {
  const physics = fixture();
  const body = physics.createCargo({ position: [0, 1.06, .6], quaternion: new Quaternion().setFromEuler(0, .6, 0) });
  physics.setPlayerProxy({ position: [0, 0, 0] });
  physics.setCarryTarget([0, 1.06, .6]);
  physics.release();
  assert.equal(physics.releasePlayerGrace, true);
  const initial = body.position.clone(); physics.step(1 / 120);
  assert.ok(body.position.distanceTo(initial) < .01, 'release never ejects a penetrating object');
  run(physics, 2);
  close(body.position.y, .39, .005, 'the object falls instead of sticking to the player');
  physics.setPlayerProxy({ position: [0, 0, -2] }, 0); physics.step(1 / 120);
  assert.equal(physics.releasePlayerGrace, false);
  assert.ok(body.collisionFilterMask & physics.playerProxy.body.collisionFilterGroup, 'normal pushing works after separation');
  physics.dispose();
});
