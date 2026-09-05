import test from 'node:test';
import assert from 'node:assert/strict';
import { Body, ConvexPolyhedron, RaycastResult, Vec3 } from 'cannon-es';
import { LabPhysics, sampleRampSurface } from '../src/game/LabPhysics.js';

const SOLID = 1, CARGO = 2;
const profileRamp = () => ({
  minX: -1, maxX: 1, minZ: -4, maxZ: 4, lowY: 0, highY: 1,
  profile: [{ z: -4, y: -.4 }, { z: -2, y: .2 }, { z: 0, y: 1.8 },
    { z: 1, y: 1.8 }, { z: 4, y: 1.2 }],
});

function close(actual, expected, tolerance = 1e-7, label = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} versus ${expected}`);
}

function topRay(physics, x, z) {
  const hit = new RaycastResult();
  const found = physics.world.raycastClosest(new Vec3(x, 5, z), new Vec3(x, -3, z), {
    collisionFilterGroup: CARGO, collisionFilterMask: SOLID, skipBackfaces: true,
  }, hit);
  return { found, hit };
}

test('profile sampler interpolates the measured segments, including peaks outside nominal heights and endpoint clamping', () => {
  const ramp = profileRamp();
  const cases = [
    [-8, -.4, .3], [-3, -.1, .3], [-1, 1, .8], [.5, 1.8, 0], [2.5, 1.5, -.2], [9, 1.2, -.2],
  ];
  for (const [z, height, slope] of cases) {
    const actual = sampleRampSurface(ramp, z);
    close(actual.height, height, 1e-10, `height at z=${z}`);
    close(actual.slope, slope, 1e-10, `slope at z=${z}`);
    close(actual.normal.x, 0); close(actual.normal.y, 1 / Math.hypot(1, slope));
    close(actual.normal.z, -slope / Math.hypot(1, slope));
    assert.ok(actual.normal.y > 0, 'walkable normals face upward');
  }
  for (const knot of ramp.profile) close(sampleRampSurface(ramp, knot.z).height, knot.y, 1e-10, 'continuous knot height');
});

test('Cannon raycasts hit the same piecewise top and normal used by player support at every segment', () => {
  const physics = new LabPhysics();
  try {
    const ramp = profileRamp();
    const body = physics.addStaticRamp('measured-slope', ramp);
    assert.equal(body.type, Body.STATIC);
    assert.equal(body.shapes.length, ramp.profile.length - 1);
    assert.ok(body.shapes.every(shape => shape instanceof ConvexPolyhedron));
    body.updateAABB();
    close(body.aabb.upperBound.y, 1.8);
    assert.ok(body.aabb.lowerBound.y < -.4, 'base must be buried below the lowest measured point');
    for (const z of [-3.95, -3, -2.05, -1.95, -1, -.05, .05, .5, .95, 1.05, 2.5, 3.95]) {
      for (const x of [-.85, 0, .85]) {
        const { found, hit } = topRay(physics, x, z);
        assert.equal(found, true, `surface gap at x=${x}, z=${z}`);
        assert.equal(hit.body, body, 'all segments belong to one logical collider');
        const support = sampleRampSurface(ramp, z);
        close(hit.hitPointWorld.y, support.height, 1e-7, `physics top at ${x},${z}`);
        close(hit.hitNormalWorld.dot(new Vec3(support.normal.x, support.normal.y, support.normal.z)), 1, 1e-7, 'support normal');
      }
    }
  } finally { physics.dispose(); }
});

test('profile validation is atomic: malformed curves never leave a body or solid behind', () => {
  const physics = new LabPhysics();
  try {
    const existing = physics.addStaticBox('existing', { min: [10, -1, 10], max: [12, 0, 12] });
    const bodiesBefore = physics.world.bodies.slice(), solidsBefore = [...physics.solids.keys()];
    const invalid = [
      [], [{ z: -4, y: 0 }], {},
      [{ z: -4, y: 0 }, { z: -4, y: 1 }, { z: 4, y: 2 }],
      [{ z: -4, y: 0 }, { z: 2, y: 1 }, { z: 1, y: 2 }, { z: 4, y: 3 }],
      [{ z: -4, y: NaN }, { z: 4, y: 1 }],
      [{ z: -4, y: 0 }, { z: Infinity, y: 1 }, { z: 4, y: 2 }],
      [{ z: -3.99, y: 0 }, { z: 4, y: 1 }],
      [{ z: -4.01, y: 0 }, { z: 4, y: 1 }],
      [{ z: -4, y: 0 }, { z: 3.99, y: 1 }],
      [{ z: -4, y: 0 }, { z: 4.01, y: 1 }],
    ];
    for (const profile of invalid) {
      assert.throws(() => physics.addStaticRamp('invalid-profile', { ...profileRamp(), profile }));
      assert.deepEqual(physics.world.bodies, bodiesBefore);
      assert.deepEqual([...physics.solids.keys()], solidsBefore);
      assert.equal(physics.solids.get('existing').body, existing);
    }
    // Millimetre-scale endpoint gaps are forbidden; serialization noise below
    // a micrometre is accepted and still represents the authored end faces.
    const almostExact = [{ z: -4 + 5e-7, y: 0 }, { z: 4 - 5e-7, y: 1 }];
    const accepted = physics.addStaticRamp('near-exact', { ...profileRamp(), profile: almostExact });
    assert.equal(physics.solids.get('near-exact').body, accepted);
  } finally { physics.dispose(); }
});

test('one collider id enables, disables and removes every segment together', () => {
  const physics = new LabPhysics();
  try {
    const body = physics.addStaticRamp('whole-profile', profileRamp(), { enabled: false });
    const identity = body.id;
    assert.equal(physics.world.bodies.length, 1);
    assert.equal(physics.solids.size, 1);
    for (const z of [-3, -1, .5, 2.5]) assert.equal(topRay(physics, 0, z).found, false);
    assert.equal(physics.setStaticEnabled('whole-profile', true), true);
    for (const z of [-3, -1, .5, 2.5]) {
      const ray = topRay(physics, 0, z);
      assert.equal(ray.found, true); assert.equal(ray.hit.body.id, identity);
    }
    assert.equal(physics.setStaticEnabled('whole-profile', false), true);
    for (const z of [-3, -1, .5, 2.5]) assert.equal(topRay(physics, 0, z).found, false);
    physics.setStaticEnabled('whole-profile', true);
    assert.equal(physics.removeStaticBox('whole-profile'), true);
    assert.equal(physics.world.bodies.length, 0); assert.equal(physics.solids.size, 0);
    for (const z of [-3, -1, .5, 2.5]) assert.equal(topRay(physics, 0, z).found, false);
    assert.equal(physics.removeStaticBox('whole-profile'), false);
  } finally { physics.dispose(); }
});

test('a falling physical companion settles on the measured plateau without penetrating or changing body identity', () => {
  const physics = new LabPhysics();
  try {
    const ramp = {
      minX: -2, maxX: 2, minZ: -4, maxZ: 4, lowY: 0, highY: 1,
      profile: [{ z: -4, y: 0 }, { z: -2, y: .3 }, { z: -1, y: 1.4 },
        { z: 1, y: 1.4 }, { z: 2, y: .8 }, { z: 4, y: 0 }],
    };
    physics.addStaticRamp('curved-support', ramp);
    const cargo = physics.createCargo({ position: [.1, 3, .1], size: .6 });
    const identity = cargo.id;
    let contacted = false;
    for (let step = 0; step < 360; step++) {
      physics.step(1 / 120);
      const support = sampleRampSurface(ramp, cargo.position.z).height;
      // At the first 7 m/s impact, a discrete 120 Hz Box contact has the same
      // one-step overlap. It must be bounded and promptly corrected, not turn
      // into persistent sinking through the profiled surface.
      const allowedOverlap = step < 90 ? .04 : .005;
      assert.ok(cargo.position.y - .3 >= support - allowedOverlap, `cargo penetrated the plateau at step ${step}`);
      if (physics.sample(1).grounded) contacted = true;
      assert.equal(physics.cargoBody.id, identity);
    }
    assert.equal(contacted, true);
    close(cargo.position.y, 1.7, .005, 'companion rests on measured 1.4 m top, not nominal highY');
    assert.ok(Math.abs(cargo.position.z) < .8, 'body remains on the plateau');
    assert.ok(cargo.velocity.length() < .05, 'stable support dissipates impact velocity');
    assert.equal(physics.sample(1).grounded, true);
    // Removing the one ramp really removes support from under the same body.
    physics.setStaticEnabled('curved-support', false);
    for (let step = 0; step < 30; step++) physics.step(1 / 120);
    assert.ok(cargo.position.y < 1.35);
    assert.equal(physics.cargoBody.id, identity);
  } finally { physics.dispose(); }
});
