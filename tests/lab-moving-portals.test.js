import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabPortals, makePortalFrame, pointInsidePortal, portalCrossing } from '../src/game/LabPortals.js';

const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (actual, expected, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
const exitFrame = () => makePortalFrame(vector(12, 2, -8), vector(0, 0, 1));

test('render interpolation cannot replace the last committed physical portal plane', () => {
  const scene = new THREE.Scene(), pad = new THREE.Group(); scene.add(pad);
  const portals = new LabPortals({ scene });
  try {
    const previousPadY = .188664621, nextPadY = .189570948;
    const previous = vector(0, .188873442, 0), current = vector(0, .156484149, 0);
    pad.position.y = previousPadY;
    portals.place(0, vector(0, previousPadY, 0), vector(0, 1, 0));
    portals.attachToSurface(0, pad);
    portals.place(1, vector(12, 2, -8), vector(0, 0, 1));
    portals.endPhysicsStep();
    // The rendered interpolation is deliberately on the opposite side of the
    // old cargo centre. Only the committed physical pose gives the right sign.
    pad.position.y = .1905; portals.update(.5);
    portals.beginPhysicsStep();
    pad.position.y = nextPadY; portals.syncMovingSurfaces();
    const crossing = portals.tryTeleport(current, previous, vector(0, -3.8, 0), .39);
    assert.ok(crossing);
    close(crossing.crossingFraction, (previous.y - previousPadY) / ((previous.y - previousPadY) - (current.y - nextPadY)));
    portals.endPhysicsStep();
    pad.position.y = .18; portals.update(.8);
    portals.beginPhysicsStep();
    pad.position.y = nextPadY; portals.syncMovingSurfaces();
    assert.equal(portals.tryTeleport(previous, previous, vector(0, 0, 0), .39), null,
      'render interpolation invented a new entry for a stationary body already behind the physical plane');
  } finally { portals.dispose(); }
});

test('a rising pressure pad preserves its prior plane through render syncs and multiple actor crossing queries', () => {
  const scene = new THREE.Scene();
  const pad = new THREE.Group(); scene.add(pad);
  const portals = new LabPortals({ scene });
  try {
    const previousPadY = .188664621, nextPadY = .189570948;
    const previousCargoY = .188873442, currentCargoY = .156484149;
    pad.position.y = previousPadY; pad.updateWorldMatrix(true, true);
    portals.place(0, vector(0, previousPadY, 0), vector(0, 1, 0));
    portals.attachToSurface(0, pad);
    portals.place(1, vector(12, 2, -8), vector(0, 0, 1));
    portals.beginPhysicsStep();
    pad.position.y = nextPadY;
    // All these production callers read/update the current portal frame. None
    // may consume the physics tick's history before cargo gets its own query.
    portals.syncMovingSurfaces(); portals.update(.1); portals.render(.1);
    assert.equal(portals.tryTeleport(vector(4, .15, 0), vector(4, .20, 0), vector(0, -4, 0), .45), null);
    portals.syncMovingSurfaces(); portals.update(.101);
    const previous = vector(0, previousCargoY, 0), current = vector(0, currentCargoY, 0);
    const fixedPlanePreviousDistance = previous.clone().sub(portals.portals[0].position).dot(portals.portals[0].normal);
    assert.ok(fixedPlanePreviousDistance < 0, 'repro must fail a current-plane-only crossing test');
    const travel = portals.tryTeleport(current, previous, vector(0, -3.8, 0), .39, { exitClearance: 0 });
    assert.ok(travel, 'pad moving upward must not erase a real cargo entry');
    assert.equal(travel.entryIndex, 0); assert.equal(travel.exitIndex, 1);
    const priorDistance = previousCargoY - previousPadY;
    const currentDistance = currentCargoY - nextPadY;
    close(travel.crossingFraction, priorDistance / (priorDistance - currentDistance));
    assert.ok(travel.position.toArray().every(Number.isFinite));
    close(travel.velocity.length(), 3.8);
    portals.syncMovingSurfaces(); portals.render(.102);
    const repeated = portals.tryTeleport(current, previous, vector(0, -3.8, 0), .39, { exitClearance: 0 });
    assert.ok(repeated, 'one actor query cannot advance another actor’s frame history');
    close(repeated.crossingFraction, travel.crossingFraction);

    portals.beginPhysicsStep();
    assert.equal(portals.tryTeleport(current, current, vector(0, 0, 0), .39), null,
      'stationary body behind the plane cannot retrigger in a new tick');
    assert.equal(portals.tryTeleport(vector(0, .24, 0), current, vector(0, 3, 0), .39), null,
      'back-to-front movement must not count as entry');
  } finally { portals.dispose(); }
});

test('pure crossing handles a rotating plane sweeping over a stationary point at the interpolated frame', () => {
  const previousEntry = makePortalFrame(vector(0, 0, 0), vector(0, 0, 1));
  const entry = makePortalFrame(vector(0, 0, 0), vector(1, 0, 0));
  // The point crosses at 30 degrees during a 90-degree sweep. Interpolating
  // endpoint signed distances gives the wrong time for this asymmetric case.
  const point = vector(-.6, 0, .6 / Math.sqrt(3));
  const travel = portalCrossing(entry, exitFrame(), point, point, vector(0, 0, 0), .1,
    { previousEntry, exitClearance: 0 });
  assert.ok(travel, 'rotation alone can sweep the aperture plane across a body');
  close(travel.crossingFraction, 1 / 3);
  assert.ok(travel.crossingPoint.distanceTo(point) < 1e-8);
  const crossingOrientation = previousEntry.quaternion.clone().slerp(entry.quaternion, travel.crossingFraction);
  const crossingNormal = vector(0, 0, 1).applyQuaternion(crossingOrientation);
  close(travel.crossingPoint.dot(crossingNormal), 0);
  assert.equal(portalCrossing(previousEntry, exitFrame(), point, point, vector(0, 0, 0), .1,
    { previousEntry: entry, exitClearance: 0 }), null, 'reverse sweep is an exit, not a second entry');
});

test('crossing aperture uses its interpolated centre when current aperture has already moved away', () => {
  const previousEntry = makePortalFrame(vector(0, 0, 0), vector(0, 0, 1));
  const entry = makePortalFrame(vector(2, 0, 0), vector(0, 0, 1));
  const previous = vector(1, 0, .2), current = vector(1, 0, -.2);
  assert.equal(pointInsidePortal(entry, vector(1, 0, 0), .39), false,
    'current frame intentionally misses the body that crossed halfway through motion');
  const travel = portalCrossing(entry, exitFrame(), current, previous, vector(0, 0, -2), .39,
    { previousEntry, exitClearance: 0 });
  assert.ok(travel, 'opening was directly beneath the body at the crossing instant');
  close(travel.crossingFraction, .5);
  assert.ok(travel.crossingPoint.distanceTo(vector(1, 0, 0)) < 1e-8);
});

test('a current-frame fit cannot admit a body that crossed the plane outside the moving aperture', () => {
  const previousEntry = makePortalFrame(vector(-2, 0, 0), vector(0, 0, 1));
  const entry = makePortalFrame(vector(0, 0, 0), vector(0, 0, 1));
  const previous = vector(0, 0, .1), current = vector(0, 0, -.3);
  assert.equal(pointInsidePortal(entry, vector(0, 0, 0), .39), true);
  const crossingFrame = makePortalFrame(vector(-1.5, 0, 0), vector(0, 0, 1));
  assert.equal(pointInsidePortal(crossingFrame, vector(0, 0, 0), .39), false);
  assert.equal(portalCrossing(entry, exitFrame(), current, previous, vector(0, 0, -2), .39,
    { previousEntry, exitClearance: 0 }), null,
  'contact with the solid part of the moving panel cannot become a late portal entry');
});

test('anchor rotation history survives repeated synchronisation as well as translation history', () => {
  const scene = new THREE.Scene(), panel = new THREE.Group(); scene.add(panel);
  const portals = new LabPortals({ scene });
  try {
    portals.place(0, vector(0, 0, 0), vector(0, 0, 1)); portals.attachToSurface(0, panel);
    portals.place(1, vector(12, 2, -8), vector(0, 0, 1));
    portals.beginPhysicsStep();
    panel.rotation.y = Math.PI / 2;
    portals.syncMovingSurfaces(); portals.update(1); portals.syncMovingSurfaces();
    const point = vector(-.3, 0, .3);
    const crossing = portals.tryTeleport(point, point, vector(0, 0, 0), .1, { exitClearance: 0 });
    assert.ok(crossing); close(crossing.crossingFraction, .5);
    portals.beginPhysicsStep(); portals.update(2);
    assert.equal(portals.tryTeleport(point, point, vector(0, 0, 0), .1), null);
  } finally { portals.dispose(); }
});
