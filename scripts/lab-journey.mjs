// Real production GLB geometry and gameplay physics. No WebGL claim.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolvePortalPlacement } from '../src/game/LabPortals.js';
import { createEvidenceDriver, runContinuousJourney, runChecks } from '../src/game/LabEvidence.js';
import { createHeadlessGame } from './lab-headless.mjs';
const game = await createHeadlessGame();
console.log(`Decoded ${game.assets.size} runtime GLBs`);
console.log(`Built ${game.colliders.length} colliders and ${game.portalPanels.length} portal surfaces`);
// Exercise actual rig/IK update with the actual imported meshes before taking
// the longer physics route. Source attributes must not be mutated by animation.
const positions = game.companionRig.mesh.geometry.attributes.position.array.slice();
for (let i = 0; i < 120; i++) game.updateVisuals(1/60, 1);
assert.deepEqual(game.companionRig.mesh.geometry.attributes.position.array, positions);
assert.ok(game.animator.diagnostics.boneCount === 14);
const updateVisuals = game.updateVisuals.bind(game);
const driver = createEvidenceDriver(game);
const productionChecks = await runChecks(game, driver, () => {}, { includeRender: false, includeJourney: false });
assert.ok(productionChecks.pass, productionChecks.errors.join('\n'));
const geometryChecks = {
  carry: productionChecks.checks['companion-contact-and-drop'].detail.carry,
  shotCamera: productionChecks.checks['stationary-shot-camera'].detail,
  table: productionChecks.checks['jump-onto-table'].detail,
  idleFeet: productionChecks.checks['idle-feet-settle'].detail,
};
// A carried companion must not remove furniture traversal. These fixtures
// only choose the start of each jump; every ascent and landing is simulated.
for (const kind of ['table', 'chair']) {
  driver.reset();
  const item = game.exploration[kind], box = new THREE.Box3().setFromObject(item.model), center = box.getCenter(new THREE.Vector3());
  const top = kind === 'table' ? item.top : item.seatY;
  const start = kind === 'table' ? new THREE.Vector3(center.x,0,box.max.z+.65) : new THREE.Vector3(center.x-1.1,0,center.z);
  const facing = kind === 'table' ? Math.PI : Math.PI/2;
  driver.fixturePlayer(...start.toArray(), facing);
  const forward = new THREE.Vector3(Math.sin(facing),0,Math.cos(facing));
  game.physics.resetCargo({ position:start.clone().addScaledVector(forward,-.65).add(new THREE.Vector3(0,.5,0)) });
  driver.step(.3); driver.pressE(); driver.step(.9); assert.equal(game.heldCube,game.cargo);
  game.input.jumpQueued = true; driver.key('KeyW');
  let landed=false, peak=game.playerPosition.y;
  for (let i=0; i<125; i++) {
    driver.step(1/60); peak=Math.max(peak,game.playerPosition.y);
    if (kind === 'chair' && game.playerPosition.x > center.x-.68) driver.key('KeyW',false);
    if (i>10 && game.playerGrounded && Math.abs(game.playerPosition.y-top)<.025) { landed=true; break; }
  }
  driver.key('KeyW',false); driver.step(.25);
  assert.ok(landed && game.heldCube === game.cargo && Math.abs(game.playerPosition.y-top)<.025,
    `Loaded ${kind} jump failed: ${game.playerPosition.toArray()}, target height=${top}, held=${!!game.heldCube}, landed=${landed}`);
  geometryChecks[`${kind}WithCompanion`] = { grounded:game.playerGrounded, peak, top, finish:game.playerPosition.toArray(), sameCompanion:true };
}
// Both actors use the real first-level launcher and recovery lift.
driver.reset(); driver.fixturePlayer(5.4, 0, 17.3);
game.physics.resetCargo({ position: [5.4, .45, 16.55] }); driver.step(.3); driver.pressE(); driver.step(.8);
assert.equal(game.heldCube, game.cargo);
assert.equal(game.placePortal(0), false, 'A loaded player must not shoot');
driver.key('KeyW'); let launchPeak = 0, launched = false;
for (let i = 0; i < 100; i++) {
  driver.step(1/60); launchPeak = Math.max(launchPeak, game.playerPosition.y);
  if (game.launchTime > 0) { launched = true; driver.key('KeyW', false); }
}
assert.ok(launched && launchPeak > 1.6 && game.heldCube === game.cargo, 'Loaded first-level launcher failed');
geometryChecks.launchWithCompanion = { peak: launchPeak, sameCompanion: true };
driver.reset(); driver.fixturePlayer(4.35, -2.8, 5.5, Math.PI / 2);
game.physics.resetCargo({ position: [4.35, -2.35, 4.8] }); driver.step(.25); driver.pressE(); driver.step(.7);
assert.equal(game.heldCube, game.cargo); driver.goto(6.7, 5.5); driver.step(5.8);
assert.ok(game.playerPosition.y > -.05 && game.heldCube === game.cargo, 'Recovery lift failed to return both actors');
geometryChecks.recoveryLiftWithCompanion = { height: game.playerPosition.y, sameCompanion: true };
console.log('Actual model checks:', JSON.stringify(geometryChecks));
// Preserve production transforms during the long physics route. Skinning and
// camera updates were exercised above; neither writes gameplay coordinates.
game.updateVisuals = dt => {
  game.visualTime += dt;
  game.playerGroup.position.copy(game.playerPosition); game.playerGroup.rotation.y = game.facing;
  game.cargo.group.position.copy(game.cargo.position); game.cargo.group.quaternion.copy(game.cargo.quaternion);
  game.scene.updateMatrixWorld(true);
};
const started = performance.now();
try {
  const report = { ...runContinuousJourney(game, driver), geometryChecks, productionChecks };
  console.log(JSON.stringify({ ...report, seconds: (performance.now() - started) / 1000 }, null, 2));
  fs.mkdirSync('qa', { recursive: true }); fs.writeFileSync('qa/continuous-journey.json', JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  const hits = game.raycaster.intersectObjects(game.aimBlockers, true).filter(h => (h.object.visible || h.object.userData.collisionProxy) && game.isActiveBlocker(h.object));
  console.log('Route failure context', JSON.stringify({ player: game.playerPosition.toArray(), cargo: game.cargo.position.toArray(),
    door: game.doors.map(d => ({ opened:d.opened, progress:d.progress })),
    hits: hits.slice(0,4).map(h => ({ point:h.point.toArray(), portalable:h.object.userData.portalable,
      proxy:h.object.userData.collisionProxy, name:h.object.name, center:h.object.userData.center,
      placement: resolvePortalPlacement(h.object, h.point, { blockers:game.colliders }) })) }, null, 2));
  throw error;
} finally {
  game.updateVisuals = updateVisuals;
  game.physics.dispose(); game.portals.dispose();
}
