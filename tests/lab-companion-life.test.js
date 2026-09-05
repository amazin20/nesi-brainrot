import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vec3 } from 'cannon-es';
import { LabPhysics } from '../src/game/LabPhysics.js';
import { LabCompanionBehavior } from '../src/game/LabCompanionBehavior.js';

function fixture(quaternion) {
  const physics = new LabPhysics();
  physics.addStaticBox('floor', { min: [-8, -.4, -8], max: [8, 0, 8] });
  physics.createCargo({ position: [0, .65, 0], quaternion });
  const behavior = new LabCompanionBehavior(physics);
  return { physics, behavior, step(options) { behavior.update(1 / 120, options); physics.step(1 / 120); } };
}

test('a fallen companion stands under physical torque and keeps the same body', () => {
  for (const angle of [Math.PI / 2, Math.PI]) {
    const q = new Quaternion().setFromAxisAngle(new Vec3(0, 0, 1), angle);
    const f = fixture(q), body = f.physics.cargoBody, states = new Set();
    for (let i = 0; i < 120 * 8; i++) { f.step({ onPad: true }); states.add(f.behavior.state); }
    assert.ok(states.has('getting_up'), 'must use a visible recovery phase');
    assert.ok(body.quaternion.vmult(new Vec3(0, 1, 0)).y > .94, 'must finish upright');
    assert.equal(f.physics.cargoBody, body); assert.equal(f.physics.portalTransports, 0);
    assert.ok(Math.abs(body.position.y - .39) < .03); f.physics.dispose();
  }
});

test('curiosity makes short local walks and a pressure pad keeps the companion in place', () => {
  const f = fixture(), positions = [], states = new Set();
  for (let i = 0; i < 120 * 24; i++) {
    f.step(); positions.push(f.physics.cargoBody.position.clone()); states.add(f.behavior.state);
  }
  assert.ok(states.has('wandering'));
  const maxDistance = Math.max(...positions.map(p => Math.hypot(p.x, p.z)));
  assert.ok(maxDistance > .15 && maxDistance < 1.1, `local movement radius ${maxDistance}`);
  const start = f.physics.cargoBody.position.clone();
  for (let i = 0; i < 120 * 8; i++) f.step({ onPad: true });
  assert.ok(f.physics.cargoBody.position.distanceTo(start) < .08);
  assert.equal(f.behavior.state, 'waiting_on_pad'); f.physics.dispose();
});

test('held and airborne companions receive no autonomous motor forces', () => {
  const f = fixture();
  f.physics.cargoBody.force.setZero(); f.physics.cargoBody.torque.setZero();
  for (let i = 0; i < 20; i++) f.behavior.update(1 / 60, { held: true });
  assert.equal(f.physics.cargoBody.force.length(), 0); assert.equal(f.physics.cargoBody.torque.length(), 0);
  f.physics.grounded = false; f.behavior.update(1 / 60);
  assert.equal(f.behavior.state, 'airborne'); assert.equal(f.physics.cargoBody.force.length(), 0); f.physics.dispose();
});
