import { FIRST_LEVEL_ASSETS } from './labAssets.js';
import * as THREE from 'three';

const DT = 1 / 120;
const FPS = 60;
const FRAME_COUNT = 600;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const yieldFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const cloneJSON = value => JSON.parse(JSON.stringify(value));

/** Rotate only the same yaw/pitch controls a player has. The production
 * shoulder camera, pitch limits and obstruction tests determine the actual ray. */
export function aimEvidencePoint(game, point) {
  for (let i=0; i<100; i++) {
    const desired = point.clone().sub(game.camera.position).normalize();
    const forward = game.camera.getWorldDirection(new THREE.Vector3());
    const yawError = Math.atan2(-desired.x,-desired.z) - Math.atan2(-forward.x,-forward.z);
    game.yaw += Math.atan2(Math.sin(yawError), Math.cos(yawError)) * .7;
    game.pitch = THREE.MathUtils.clamp(game.pitch + (Math.asin(desired.y)-Math.asin(forward.y)) * .7, -1.15, 1.15);
    game.cameraRig.update({ dt:.1, target:game.playerPosition, yaw:game.yaw, pitch:game.pitch, velocity:new THREE.Vector3(), aiming:false });
  }
  const error = game.camera.getWorldDirection(new THREE.Vector3()).angleTo(point.clone().sub(game.camera.position));
  assert(error < .004, `Point cannot be aimed with production camera: ${point.toArray()}, error=${error}`);
}

/** Query-only production test driver. Fixtures are explicit; a route never replaces cargo. */
export function createEvidenceDriver(game) {
  const key = (code, down = true) => down ? game.input.keys.add(code) : game.input.keys.delete(code);
  const step = seconds => {
    const ticks = Math.round(seconds / DT);
    for (let tick = 0; tick < ticks; tick++) {
      if (game.state === 'playing' || game.state === undefined) game.updatePlaying(DT);
      if (tick % 2) game.updateVisuals(1 / FPS, 1);
    }
    if (ticks % 2) game.updateVisuals(DT, 1);
  };
  const fixturePlayer = (x, y, z, facing = Math.PI) => {
    game.playerPosition.set(x, y, z); game.previousPlayerPosition.copy(game.playerPosition);
    game.playerVelocity.set(0, 0, 0); game.playerGrounded = true;
    game.facing = game.previousFacing = facing; game.yaw = facing - Math.PI;
    game.playerGroup.position.copy(game.playerPosition); game.playerGroup.rotation.y = facing;
    game.input.keys.clear(); game.input.jumpQueued = false;
    game.cameraRig.reset(game.playerPosition, game.yaw, game.pitch);
    game.updateVisuals(0, 1);
  };
  const pressE = () => { game.interactQueued = true; step(1 / FPS); };
  const goto = (x, z, limit = 16) => {
    let reached = false;
    for (let i = 0; i < limit * FPS; i++) {
      if (game.state === 'won') { reached = true; break; }
      const dx = x - game.playerPosition.x, dz = z - game.playerPosition.z;
      if (Math.hypot(dx, dz) < .15) { reached = true; break; }
      game.yaw = Math.atan2(-dx, -dz); key('KeyW'); step(1 / FPS);
    }
    key('KeyW', false); step(.4);
    assert(reached, `Route blocked toward ${x},${z}; player=${game.playerPosition.toArray()}; cargo=${game.cargo.position.toArray()}`);
  };
  const aimPanel = (index, stage, side = index, offset = new THREE.Vector3()) => {
    if (game.firstLevel) {
      const normal = side === 0 ? 1 : -1;
      const panel = game.portalPanels.find(p => p.userData.stage === stage && Math.sign(p.userData.normal?.x || 0) === normal);
      assert(panel, `Missing first-level wall ${stage}/${side}`);
      const point = new THREE.Vector3(panel.userData.center.x, 1.8, stage === 0 ? 16.25 : -22.5).add(offset);
      aimEvidencePoint(game, point);
      assert(game.placePortal(index), `First-level wall shot rejected: ${index}`);
      return panel;
    }
    const targets = [[[1, 15], [1, 1.2]], [[-1, -9], [-1, -21]], [[1, -30], [-1, -43]]];
    const [normal, z] = targets[stage][side];
    const panel = game.portalPanels.filter(p => p.userData.stage === stage && Math.sign(p.userData.normal.x) === normal)
      .sort((a,b) => Math.abs(a.userData.center.z-z)-Math.abs(b.userData.center.z-z))[0];
    assert(panel, `Missing panel ${stage}/${side}`);
    aimEvidencePoint(game, new THREE.Vector3(panel.userData.center.x, 1.9, z).add(offset));
    assert(game.placePortal(index), `Ray-aimed portal ${stage}/${index} was rejected`);
    return panel;
  };
  const reset = () => { game.resetRun(true); game.renderer?.setAnimationLoop(null); step(.7); };
  return { key, step, fixturePlayer, pressE, goto, aimPanel, reset };
}

/** ZIP STORE writer, keeping the browser's actual encoded frame bytes untouched. */
export async function makeStoredZip(entries) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const encoder = new TextEncoder(), chunks = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), bytes = new Uint8Array(await entry.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + name.length), view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
    view.setUint16(26, name.length, true); header.set(name, 30);
    chunks.push(header, entry.blob);
    const directory = new Uint8Array(46 + name.length), record = new DataView(directory.buffer);
    record.setUint32(0, 0x02014b50, true); record.setUint16(4, 20, true); record.setUint16(6, 20, true);
    record.setUint16(8, 0x0800, true); record.setUint32(16, crc, true); record.setUint32(20, bytes.length, true);
    record.setUint32(24, bytes.length, true); record.setUint16(28, name.length, true); record.setUint32(42, offset, true);
    directory.set(name, 46); central.push(directory); offset += header.length + bytes.length;
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  const tail = new Uint8Array(22), end = new DataView(tail.buffer);
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true); end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, tail], { type: 'application/zip' });
}

/** Production-style render cadence: retain substep time at high refresh rates. */
export function createEvidenceFrameStepper(game) {
  let accumulator = 0;
  return dt => {
    accumulator += dt;
    while (accumulator + 1e-10 >= DT) {
      game.updatePlaying(DT); accumulator = Math.max(0, accumulator - DT);
    }
    game.updateVisuals(dt, accumulator / DT);
  };
}

export function fireReelPortal(game, driver, index, stage = 0) {
  const position = game.camera.position.clone(), quaternion = game.camera.quaternion.clone();
  try {
    // Aim a real gameplay shot, then restore the review camera before this
    // frame is rendered. A cinematic viewpoint is not an aiming direction.
    const panel = driver.aimPanel(index, stage);
    return { index, placed: true, panel: panel.uuid, position: game.portals.portals[index].position.toArray() };
  } finally {
    game.camera.position.copy(position); game.camera.quaternion.copy(quaternion); game.camera.updateMatrixWorld(true);
  }
}

export function createReel(game, driver) {
  driver.reset(); driver.fixturePlayer(0, 0, 15.5);
  game.physics.resetCargo({ position: [0, .43, 14.4] }); driver.step(.8);
  const frameStep = createEvidenceFrameStepper(game);
  const shots = [];
  let previousTime = -1;
  const at = (time, event) => { if (previousTime < time && currentTime >= time) event(); };
  let currentTime = 0;
  return {
    get diagnostics() { return { shots: shots.map(shot => ({ ...shot, position: [...shot.position] })) }; },
    advance(dt, time) {
      currentTime = time;
      game.input.keys.clear();
      at(0, () => { game.animator.trigger('curious'); game.companionAnimator.trigger('curious'); });
      at(.7, () => game.interact());
      if (time >= 1.7 && time < 2.7) game.input.keys.add('KeyW');
      at(2.7, () => game.interact());
      if (time >= 3.05 && time < 4.05) {
        game.yaw = -Math.PI / 2; game.input.keys.add('KeyW'); game.input.keys.add('ShiftLeft');
      }
      at(4.45, () => shots.push({ time, ...fireReelPortal(game, driver, 0) }));
      at(4.85, () => shots.push({ time, ...fireReelPortal(game, driver, 1) }));
      // The linked pair has its own WebGL view checks and half a second in
      // this shot segment. Later close-ups review the jump and body animation.
      at(5.35, () => game.clearPortals());
      at(5.4, () => { game.input.jumpQueued = true; });
      at(7.2, () => { game.animator.trigger('celebrate'); game.companionAnimator.trigger('celebrate'); });
      at(8.9, () => game.animator.trigger('curious'));
      frameStep(dt);
      const p = game.playerGroup.position;
      game.camera.position.copy(p).add(new THREE.Vector3(-3.35, 1.8, -4.1));
      game.camera.lookAt(p.x, p.y + 1.2, p.z); game.camera.updateMatrixWorld(true);
      game.render(); game.renderFrames++;
      previousTime = time;
      return time < .7 ? 'CURIOUS / READY' : time < 1.7 ? 'PICK UP / HAND CONTACT'
        : time < 2.7 ? 'CARRY / WALK' : time < 3.05 ? 'RELEASE / PHYSICS'
          : time < 4.05 ? 'TURN / RUN' : time < 5.4 ? 'SHOT / HAND RECOIL'
            : time < 6.7 ? 'JUMP / LANDING' : time < 7.2 ? 'SETTLE' : 'HAPPY / REACTION';
    },
  };
}

export function runContinuousJourney(g, s) {
  g.resetRun(true); s.step(.7);
  const level = g.firstLevel;
  assert(level, 'Continuous journey requires the rebuilt first level');
  const cargo = g.cargo, body = g.physics.cargoBody, resetCargo = g.physics.resetCargo, restart = g.restart, respawn = g.respawn;
  const fixturePlayer = s.fixturePlayer;
  const identity = cargo.group.uuid, routeLog = [];
  g.physics.resetCargo = () => { throw new Error('Cargo reset during continuous journey'); };
  g.restart = () => { throw new Error('Player respawn during continuous journey'); };
  g.respawn = () => { throw new Error('Player respawn during continuous journey'); };
  s.fixturePlayer = () => { throw new Error('Player fixture during continuous journey'); };
  const mark = name => {
    assert(g.cargo === cargo && g.physics.cargoBody === body && g.cubes.length === 1 && cargo.group.visible, 'Companion identity changed');
    if (typeof window === 'undefined') console.log('Journey:', name);
    routeLog.push({ name, player: g.playerPosition.toArray(), cargo: cargo.position.toArray(), held: Boolean(g.heldCube),
      mechanisms: level.diagnostics() });
  };
  const shoot = (index, surface, point) => {
    assert(!g.heldCube, 'Cannot shoot while holding a companion');
    aimEvidencePoint(g, point);
    assert(g.placePortal(index), `Real shot rejected: ${index} at ${point.toArray()}`);
    assert(g.portalSurfaceIds[index] === surface.uuid, `A different surface intercepted the shot toward ${point.toArray()}`);
  };
  const pickup = () => {
    s.pressE(); s.step(.8);
    assert(g.heldCube === cargo, `Cannot pick up at ${g.playerPosition.toArray()}, companion ${cargo.position.toArray()}`);
  };
  const releaseOnPad = pad => {
    s.goto(pad.position.x, pad.position.z + 2.4);
    s.goto(pad.position.x, pad.position.z + .85); s.step(.6);
    s.pressE(); s.step(1.3);
    assert(pad.pressed, `Pressure plate did not activate: ${pad.position.toArray()}, cargo ${cargo.position.toArray()}`);
  };
  try {
    g.clearPortals();
    shoot(0, level.bridgePad.top, level.bridgePad.mechanism.getPortalFrame().center);
    assert(!g.portals.ready && !level.bridge.active, 'A single empty-pad portal must not activate the bridge');
    s.goto(cargo.position.x, cargo.position.z + 1.1); pickup();
    releaseOnPad(level.bridgePad); s.step(3.2);
    assert(level.bridge.active && level.bridge.floor.enabled, 'Weight did not lower a walkable bridge');
    mark('companion lowers counterweight bridge');
    s.goto(0, 8.8); s.goto(0, 3.6); s.goto(0, -2.5);
    assert(g.playerPosition.y > -.1 && level.bridge.progress > .999, 'Player did not walk across the real bridge');
    mark('player crosses the loaded bridge');
    s.goto(-2.5, -2.5); s.goto(-2.5, -8.8); s.goto(2.7, -8.8); s.pressE(); s.step(2.3);
    assert(level.receiverPanel.deployed, 'Far-bank terminal did not rotate the receiving panel');
    s.goto(2.7, -9.0);
    const cargoTransports = g.physics.portalTransports;
    shoot(1, level.receiverPanel.top, level.receiverPanel.mechanism.getPortalFrame().center);
    s.step(1.2);
    assert(g.physics.portalTransports > cargoTransports && cargo.position.z < -3, 'Companion did not return through actual pad/panel surfaces');
    assert(!level.bridgePad.pressed && !level.bridge.active, 'Removing the weight left bridge circuit latched');
    mark('portal retrieves companion and releases bridge');
    s.goto(cargo.position.x - 1.2, cargo.position.z); pickup();
    s.goto(6, -8.6); s.goto(6, -10.7); s.goto(3.4, -10.8);
    g.clearPortals(); s.pressE(); s.step(.8);
    shoot(0, level.exitPad.top, level.exitPad.mechanism.getPortalFrame().center);
    pickup(); releaseOnPad(level.exitPad); s.step(1.5);
    assert(level.exitDoor.progress > .95 && level.barrier.progress > .95, 'Exit weight did not open door and barrier');
    mark('companion opens both exit gates');
    s.goto(0, -16); s.goto(0, -18.5); s.goto(0, -22.2);
    const exitWall = g.portalPanels.find(panel => panel.userData.stage === 2 && panel.userData.normal?.x < -.5);
    assert(exitWall, 'Exit wall portal surface missing');
    const beforeExit = g.physics.portalTransports;
    shoot(1, exitWall, new THREE.Vector3(exitWall.userData.center.x, 1.8, -22.5));
    s.step(1.2);
    assert(g.physics.portalTransports > beforeExit && cargo.position.z < -20.9, 'Companion failed to exit through the weight plate');
    assert(!level.exitPad.pressed && !level.exitDoor.opened && !level.barrier.opened, 'Exit circuit did not close when unloaded');
    s.step(1.8);
    assert(level.exitDoor.progress < .05 && level.barrier.progress < .05, 'Exit mechanisms did not visually close again');
    mark('both exit mechanisms close after retrieval');
    s.goto(cargo.position.x - 1.2, cargo.position.z);
    if (g.state !== 'won') pickup();
    s.step(.4); mark('both arrive at the exit');
    assert(g.state === 'won', 'Exit did not accept player and the same companion');
    return { identity, bodyId: body.id, cargoResets: 0, playerRespawns: 0, completed: true,
      level: 'first-level-weight-and-return', state: g.state, milestones: routeLog };
  } finally { g.physics.resetCargo = resetCargo; g.restart = restart; g.respawn = respawn; s.fixturePlayer = fixturePlayer; }
}

export function jumpOntoTable(game, driver) {
  driver.reset();
  const table = game.exploration?.table;
  assert(table?.collider, 'Exploration table is missing');
  const bounds = table.collider.box, center = bounds.getCenter(new THREE.Vector3());
  driver.fixturePlayer(center.x, 0, bounds.max.z + .65);
  driver.step(.4); const start = game.playerPosition.clone();
  game.input.jumpQueued = true; driver.key('KeyW');
  let peak = start.y, landed = false;
  for (let frame = 0; frame < 100; frame++) {
    driver.step(1 / FPS); peak = Math.max(peak, game.playerPosition.y);
    if (frame > 10 && game.playerGrounded && Math.abs(game.playerPosition.y - table.top) < .025) { landed = true; break; }
  }
  driver.key('KeyW', false); driver.step(.3);
  assert(landed && game.playerGrounded && Math.abs(game.playerPosition.y - table.top) < .025, `Could not jump and remain on table: player=${game.playerPosition.toArray()}, top=${table.top}`);
  return { start: start.toArray(), finish: game.playerPosition.toArray(), peak, top: table.top, grounded: game.playerGrounded };
}

export async function runChecks(game, driver, progress = () => {}, { includeRender = true, includeJourney = true } = {}) {
  const report = { pass: false, checks: {}, errors: [], created: new Date().toISOString() };
  const check = async (name, test) => {
    progress(`Проверка: ${name}`); if (typeof requestAnimationFrame !== 'undefined') await yieldFrame();
    try { report.checks[name] = { pass: true, detail: cloneJSON(await test()) }; }
    catch (error) { report.checks[name] = { pass: false, error: String(error.stack || error) }; report.errors.push(`${name}: ${error.message}`); }
  };
  await check('source-models', () => {
    const d = game.diagnostics();
    assert(d.modelsLoaded === FIRST_LEVEL_ASSETS.length && d.missingModels.length === 0, 'All declared campaign models must load');
    assert(d.animation.sourceAttributesPreserved && d.animation.boneCount >= 14, 'Player source appearance and skeleton');
    assert(d.cargo.count === 1 && d.physicsHz === 120, 'One companion and 120 Hz physics');
    return d;
  });
  await check('locomotion-jump', () => {
    driver.reset(); const start = game.playerPosition.clone();
    driver.key('KeyW'); driver.step(.65); driver.key('KeyW', false);
    const moved = start.distanceTo(game.playerPosition);
    game.input.jumpQueued = true;
    const states = new Set(); let peak = 0;
    for (let i = 0; i < 100; i++) { driver.step(1 / FPS); peak = Math.max(peak, game.playerPosition.y); states.add(game.animator.diagnostics.state); }
    assert(moved > 1.8 && peak > .7 && game.playerGrounded, 'Real movement and complete ballistic jump');
    return { moved, peak, states: [...states], animation: game.animator.diagnostics };
  });
  await check('jump-onto-table', () => jumpOntoTable(game, driver));
  await check('idle-feet-settle', () => {
    driver.reset(); driver.key('KeyW'); driver.step(.5); driver.key('KeyW', false); driver.step(2.5);
    const left = game.animator.bones.FootL.getWorldPosition(new THREE.Vector3());
    const right = game.animator.bones.FootR.getWorldPosition(new THREE.Vector3());
    let maximumDrift = 0;
    for (let i = 0; i < 90; i++) {
      driver.step(1 / FPS);
      maximumDrift = Math.max(maximumDrift,
        left.distanceTo(game.animator.bones.FootL.getWorldPosition(new THREE.Vector3())),
        right.distanceTo(game.animator.bones.FootR.getWorldPosition(new THREE.Vector3())));
    }
    assert(maximumDrift < .006, `Idle feet keep moving after stopping: ${maximumDrift} m`);
    return { maximumDrift, secondsObserved: 1.5 };
  });

  await check('stationary-shot-camera', () => {
    driver.reset(); driver.fixturePlayer(0, 0, 15.5); driver.aimPanel(0, 0); driver.step(2);
    const before = { p: game.camera.position.clone(), q: game.camera.quaternion.clone(), fov: game.camera.fov };
    let maxPosition = 0, maxAngle = 0, maxFov = 0;
    const placed = game.placePortal(0);
    assert(placed, 'Camera check must fire a successful portal shot onto a white panel');
    for (let i = 0; i < 45; i++) {
      driver.step(1 / FPS);
      maxPosition = Math.max(maxPosition, before.p.distanceTo(game.camera.position));
      maxAngle = Math.max(maxAngle, before.q.angleTo(game.camera.quaternion));
      maxFov = Math.max(maxFov, Math.abs(before.fov - game.camera.fov));
    }
    assert(maxPosition < .001 && maxAngle < .001 && maxFov < .001, 'Shooting moved the stationary third-person camera');
    return { placed, maxPosition, maxAngle, maxFov };
  });
  await check('companion-contact-and-drop', () => {
    driver.reset(); driver.fixturePlayer(0, 0, 15.5);
    game.physics.resetCargo({ position: [0, .43, 14.4] }); driver.step(.2); driver.pressE(); driver.step(1.8);
    const carry = cloneJSON(game.animator.diagnostics.carryReach);
    assert(game.heldCube === game.cargo, 'Companion pickup failed');
    assert(carry && carry.leftError < .13 && carry.rightError < .13, 'Hands are not in contact with the carried companion');
    assert(game.heldDevice.diagnostics.state === 'holstered', 'Device should be smoothly stowed during carry');
    const transparentShells = [];
    game.cargo.group.traverse(mesh => {
      if (!mesh.isMesh || !mesh.visible) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mesh.geometry?.type === 'BoxGeometry' && materials.some(m => m.transparent && m.opacity > 0)) transparentShells.push(mesh.name || mesh.uuid);
    });
    assert(transparentShells.length === 0, 'Visible transparent cargo box remains');
    const before = game.cargo.position.clone(); game.interact(); const releaseSnap = before.distanceTo(game.cargo.position);
    driver.step(.4); const drop = before.y - game.cargo.position.y;
    assert(releaseSnap < 1e-8 && drop > .25, 'Companion must drop physically without a release teleport');
    driver.step(2); return { carry, releaseSnap, drop, transparentShells, physics: game.physics.diagnostics, companion: game.companionAnimator.diagnostics };
  });
  await check('portal-carry-together', () => {
    driver.reset(); driver.fixturePlayer(0, 0, 15.5);
    driver.aimPanel(0, 0); driver.aimPanel(1, 0); driver.step(1);
    driver.fixturePlayer(-7.55, 0, 16.25, -Math.PI / 2);
    game.physics.resetCargo({ position: [-8.25, .43, 16.25] }); driver.step(.1); driver.pressE(); driver.step(1.1);
    assert(game.heldCube === game.cargo, 'Portal fixture pickup failed');
    const cargo = game.cargo, body = game.physics.cargoBody, before = game.teleportCount;
    game.yaw = 0; driver.key('KeyA');
    for (let i = 0; i < 150 && game.teleportCount === before; i++) driver.step(1 / FPS);
    driver.key('KeyA', false); driver.step(.35);
    assert(game.teleportCount === before + 1 && game.heldCube === cargo && game.physics.cargoBody === body, 'Portal failed to carry the same physical companion');
    assert(game.playerPosition.distanceTo(cargo.position) < 2, 'Companion separated at portal exit');
    return { teleports: game.teleportCount - before, identity: cargo.group.uuid, bodyId: body.id, distance: game.playerPosition.distanceTo(cargo.position), carry: game.animator.diagnostics.carryReach };
  });
  if (includeRender) await check('portal-images-every-frame', () => {
    driver.reset(); driver.fixturePlayer(0, 0, 15.5); driver.aimPanel(0, 0); driver.aimPanel(1, 0); driver.step(.5);
    const entry = game.portals.portals[0];
    game.camera.position.copy(entry.position).addScaledVector(entry.normal, 5); game.camera.lookAt(entry.position); game.camera.updateMatrixWorld(true);
    game.render(); const first = cloneJSON(game.portals.diagnostics);
    game.visualTime += 1 / FPS; game.render(); const second = cloneJSON(game.portals.diagnostics);
    assert([first, second].every(d => d.passes > 0 && d.cadence === 'every-render-frame' && d.width > 0 && d.height > 0), 'Portal images must render on consecutive display frames');
    return { first, second };
  });
  await check('door-frame-fixed', () => {
    driver.reset();
    const door = game.doors[0], before = door.art.position.clone();
    const beforeBox = new THREE.Box3().setFromObject(door.art);
    game.physics.resetCargo({ position: door.pad.position.clone().add(new THREE.Vector3(0, .6, 0)) }); driver.step(2.2);
    const afterBox = new THREE.Box3().setFromObject(door.art);
    assert(door.art.position.distanceTo(before) < 1e-6, 'Entire door frame still moves instead of opening');
    assert(door.progress > .95, 'Door opening did not complete');
    return { progress: door.progress, rootTravel: door.art.position.distanceTo(before), before: [beforeBox.min.toArray(), beforeBox.max.toArray()], after: [afterBox.min.toArray(), afterBox.max.toArray()] };
  });
  await check('barrier-frame-fixed', () => {
    driver.reset(); const barrier = game.mechanisms.barrier, before = barrier.art.position.clone();
    game.physics.resetCargo({ position: game.mechanisms.chargePad.position.clone().add(new THREE.Vector3(0, .6, 0)) }); driver.step(2.2);
    assert(barrier.art.position.distanceTo(before) < 1e-6 && barrier.progress > .95, 'Energy barrier posts must stay fixed while the field fades');
    assert(barrier.collider.enabled === false, 'An opened energy field must allow movement');
    return { rootTravel: barrier.art.position.distanceTo(before), progress: barrier.progress, collision: barrier.collider.enabled };
  });
  if (includeJourney) await check('continuous-first-level-journey', () => runContinuousJourney(game, driver));
  report.pass = report.errors.length === 0;
  return report;
}

/** Visible, opt-in developer tools. Never loaded on a normal game visit. */
export function mountLabEvidence(game) {
  if (document.getElementById('lab-evidence')) return;
  const driver = createEvidenceDriver(game);
  const panel = document.createElement('section'); panel.id = 'lab-evidence';
  panel.setAttribute('aria-label', 'Animation review tools');
  panel.style.cssText = 'position:fixed;right:12px;top:12px;width:325px;max-height:92vh;overflow:auto;z-index:10000;padding:12px;border:1px solid #648c99;border-radius:12px;background:#f1f9fcf2;color:#183845;font:12px/1.5 system-ui;box-shadow:0 4px 28px #17384333';
  panel.innerHTML = '<strong>Animation review · production renderer</strong><div id="evidence-actions" style="display:flex;flex-wrap:wrap;gap:5px;margin:9px 0"></div><p id="evidence-status" role="status">Готово. Проверки и запись используют игровую физику и анимации.</p><div id="evidence-downloads"></div><img id="evidence-preview" alt="Selected production pose" style="display:none;width:100%;height:auto;border-radius:8px"/><details><summary>Отчёт</summary><pre id="evidence-report" style="white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto"></pre></details>';
  document.body.append(panel);
  const status = panel.querySelector('#evidence-status'), actions = panel.querySelector('#evidence-actions'), downloads = panel.querySelector('#evidence-downloads'), reportEl = panel.querySelector('#evidence-report');
  const state = { busy: false, playing: false, raf: 0, urls: [], elapsed: 0, report: null };
  const say = text => { status.textContent = text; };
  const stop = () => { cancelAnimationFrame(state.raf); state.playing = false; game.renderer?.setAnimationLoop(null); game.input.keys.clear(); };
  const render = () => { game.render(); };
  const prepareReview = () => {
    for (const screen of document.querySelectorAll('.screen')) {
      screen.classList.remove('screen--active'); screen.setAttribute('aria-hidden', 'true'); screen.inert = true;
    }
    document.body.dataset.playState = 'playing'; document.documentElement.dataset.runtimeState = 'playing';
    const hud = document.getElementById('hud');
    hud?.classList.add('hud--active'); if (hud) { hud.inert = false; hud.setAttribute('aria-hidden', 'false'); }
  };
  const download = (blob, name, title = name) => {
    const url = URL.createObjectURL(blob); state.urls.push(url);
    const a = document.createElement('a'); a.href = url; a.download = name; a.textContent = title;
    a.style.cssText = 'display:block;margin:8px 0;color:#096881;font-weight:700'; downloads.append(a);
    return a;
  };
  const button = (name, id, action) => {
    const b = document.createElement('button'); b.type = 'button'; b.id = id; b.textContent = name;
    b.style.cssText = 'padding:7px 9px;border:1px solid #8ab1ba;border-radius:7px;background:white;color:#183845;cursor:pointer';
    b.addEventListener('click', async event => {
      event.stopPropagation(); if (state.busy) return;
      try { await action(); } catch (error) { state.busy = false; panel.dataset.status = 'error'; say(error.message); console.error(error); }
    }); actions.append(b); return b;
  };
  const closeCamera = () => {
    const p = game.playerGroup.position;
    game.camera.position.copy(p).add(new THREE.Vector3(-2.8, 1.75, -3.9));
    game.camera.lookAt(p.x, p.y + 1.25, p.z); game.camera.updateMatrixWorld(true);
  };
  const pose = (name, apply) => {
    stop(); prepareReview(); driver.reset(); driver.fixturePlayer(0, 0, 15.5);
    game.physics.resetCargo({ position: [0, .43, 14.4] }); driver.step(.4);
    apply(); closeCamera(); render();
    const preview = panel.querySelector('#evidence-preview'); preview.src = game.renderer.domElement.toDataURL('image/png'); preview.style.display = 'block';
    say(`Поза: ${name}`); panel.dataset.pose = name;
  };
  button('Покой', 'evidence-idle', () => pose('idle', () => { game.animator.trigger('curious'); driver.step(.65); }));
  button('Бег', 'evidence-run', () => pose('run', () => { driver.key('KeyW'); driver.key('ShiftLeft'); driver.step(.45); game.input.keys.clear(); }));
  button('Прыжок', 'evidence-jump', () => pose('jump', () => { game.input.jumpQueued = true; driver.step(.32); }));
  button('На руках', 'evidence-carry', () => pose('carry', () => { driver.pressE(); driver.step(1.8); }));
  button('На стол', 'evidence-table', () => {
    stop(); prepareReview(); const result = jumpOntoTable(game, driver); closeCamera(); render();
    const preview = panel.querySelector('#evidence-preview'); preview.src = game.renderer.domElement.toDataURL('image/png'); preview.style.display = 'block';
    panel.dataset.pose = 'table'; say(`Прыжок на стол: ${result.top.toFixed(2)} м. Персонаж стоит на поверхности.`);
  });
  button('Радость', 'evidence-happy', () => pose('happy', () => { game.animator.trigger('celebrate'); game.companionAnimator.trigger('celebrate'); driver.step(.7); }));
  button('Порталы', 'evidence-portals', () => {
    stop(); prepareReview(); driver.reset(); driver.fixturePlayer(0, 0, 15.5);
    driver.aimPanel(0, 0); driver.aimPanel(1, 0); driver.step(.8);
    const entry = game.portals.portals[0];
    game.camera.position.copy(entry.position).addScaledVector(entry.normal, 5); game.camera.lookAt(entry.position); game.camera.updateMatrixWorld(true); render();
    const preview = panel.querySelector('#evidence-preview'); preview.src = game.renderer.domElement.toDataURL('image/png'); preview.style.display = 'block';
    panel.dataset.pose = 'portals'; say('Вид через действующую пару порталов.');
  });
  const mechanismPose = (kind, opened) => {
    stop(); prepareReview(); driver.reset();
    const mechanism = kind === 'door' ? game.doors[0] : game.mechanisms.barrier;
    if (opened) { const pad = kind === 'door' ? mechanism.pad : game.mechanisms.chargePad; game.physics.resetCargo({ position: pad.position.clone().add(new THREE.Vector3(0, .6, 0)) }); }
    driver.step(2.3);
    const z = kind === 'door' ? game.doors[0].z : game.mechanisms.barrier.position?.z ?? game.mechanisms.barrier.mesh.position.z;
    // Each gate is photographed from its own room so the other closed gate
    // and the puzzle's elbow wall cannot conceal the mechanism under review.
    const cameraZ = game.firstLevel ? z + (kind === 'door' ? 4.6 : -4.4) : z + 7.2;
    const cameraY = kind === 'door' ? 2.6 : 1.9;
    game.camera.position.set(0, cameraY, cameraZ); game.camera.lookAt(0, cameraY, z); game.camera.updateMatrixWorld(true); render();
    const preview = panel.querySelector('#evidence-preview'); preview.src = game.renderer.domElement.toDataURL('image/png'); preview.style.display = 'block';
    panel.dataset.pose = `${kind}-${opened ? 'open' : 'closed'}`; say(`${kind === 'door' ? 'Дверь' : 'Барьер'}: ${opened ? 'открыто' : 'закрыто'}`);
  };
  button('Дверь закрыта', 'evidence-door-closed', () => mechanismPose('door', false));
  button('Дверь открыта', 'evidence-door-open', () => mechanismPose('door', true));
  button('Барьер', 'evidence-barrier-closed', () => mechanismPose('barrier', false));
  button('Барьер открыт', 'evidence-barrier-open', () => mechanismPose('barrier', true));
  const firstLevelPose = (name, setup, message) => {
    stop(); prepareReview(); driver.reset();
    assert(game.firstLevel, 'First-level artwork is unavailable');
    setup(game.firstLevel); game.camera.updateMatrixWorld(true); render();
    const preview = panel.querySelector('#evidence-preview');
    preview.src = game.renderer.domElement.toDataURL('image/png'); preview.style.display = 'block';
    panel.dataset.pose = name; say(message);
  };
  button('Мост под нагрузкой', 'evidence-bridge-loaded', () => firstLevelPose('bridge-loaded', level => {
    game.physics.resetCargo({ position: level.bridgePad.position.clone().add(new THREE.Vector3(0, .6, 0)) });
    driver.step(3.4);
    assert(level.bridgePad.pressed && level.bridge.active && level.bridge.floor.enabled,
      'The companion must lower the actual walkable bridge');
    game.camera.position.set(6.7, 4.9, 8.8); game.camera.lookAt(-.7, -.1, .7);
  }, 'Брейнрот удерживает плиту. Настоящий настил моста опущен через ров.'));
  button('Поворотная панель', 'evidence-receiver-panel', () => firstLevelPose('receiver-panel', level => {
    const receiver = level.receiverPanel, control = receiver.control.position;
    driver.fixturePlayer(control.x - 1.2, 0, control.z, Math.PI / 2); driver.step(.1);
    driver.pressE(); driver.step(2.4);
    assert(receiver.deployed && receiver.progress < .01, 'The real terminal must deploy the receiving panel');
    game.camera.position.set(receiver.position.x - 5, 4.8, receiver.position.z - 3.3);
    game.camera.lookAt(receiver.position.x, 1.4, receiver.position.z);
  }, 'Терминал поворачивает рабочую часть модели 28; опоры остаются на месте.'));
  button('Портал в самой плите', 'evidence-pad-surface', () => firstLevelPose('pad-surface', level => {
    const pad = level.bridgePad;
    driver.fixturePlayer(pad.position.x, 0, pad.position.z + 4.8);
    driver.step(.2); aimEvidencePoint(game, pad.mechanism.getPortalFrame().center);
    assert(game.placePortal(0) && game.portalSurfaceIds[0] === pad.top.uuid,
      'The shot must hit the authored pressure-pad surface');
    driver.step(.2);
    game.camera.position.copy(pad.position).add(new THREE.Vector3(2.7, 4.1, 4.3));
    game.camera.lookAt(pad.position);
  }, 'Портал открыт прямо в поверхности модели 29. Отдельной белой накладки нет.'));
  button('Батут на полу', 'evidence-launch-pad', () => firstLevelPose('launch-pad', level => {
    driver.step(.2);
    const pad = level.launchPad;
    const bounds = new THREE.Box3().setFromObject(pad.art);
    assert(bounds.min.y >= -.005, 'The launch-pad body must remain above the floor');
    game.camera.position.copy(pad.position).add(new THREE.Vector3(-3.5, 3.1, 1.8));
    game.camera.lookAt(pad.position.clone().add(new THREE.Vector3(0, .35, 0)));
  }, 'Корпус батута стоит на полу; опора совпадает с рабочей поверхностью.'));
  button('Проверки', 'evidence-check', async () => {
    stop(); prepareReview(); state.busy = true; panel.dataset.status = 'checking';
    const report = await runChecks(game, driver, say); state.report = report; reportEl.textContent = JSON.stringify(report, null, 2);
    state.busy = false; panel.dataset.status = report.pass ? 'pass' : 'fail';
    say(report.pass ? 'Все проверки пройдены.' : `${report.errors.length} проверок требуют исправления.`);
    download(new Blob([reportEl.textContent], { type: 'application/json' }), 'lab-evidence-v6.json'); render();
  });
  const makeFrameCanvas = () => { const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 720; return canvas; };
  const drawFrame = (canvas, label) => {
    const ctx = canvas.getContext('2d'); ctx.drawImage(game.renderer.domElement, 0, 0, canvas.width, canvas.height);
    ctx.font = '700 18px system-ui'; ctx.lineWidth = 4; ctx.strokeStyle = '#f6fcffdd'; ctx.fillStyle = '#204855';
    ctx.strokeText(label, 24, 35); ctx.fillText(label, 24, 35);
  };
  const videoSize = () => {
    const size = game.renderer.getSize(new THREE.Vector2()), ratio = game.renderer.getPixelRatio();
    game.renderer.setPixelRatio(1); game.renderer.setSize(960, 720, false); game.camera.aspect = 4 / 3; game.camera.updateProjectionMatrix();
    return () => { game.renderer.setPixelRatio(ratio); game.renderer.setSize(size.x, size.y, false); game.camera.aspect = size.x / size.y; game.camera.updateProjectionMatrix(); };
  };
  // CI consumes one completed frame per call. A stalled renderer cannot hold
  // a single protocol request for the complete ten-second production reel.
  let frameCapture = null;
  const beginFrameCapture = () => {
    assert(!frameCapture, 'A frame export is already running');
    stop(); prepareReview(); state.busy = true; panel.dataset.status = 'recording-frames';
    const restore = videoSize();
    try {
      const reel = createReel(game, driver);
      frameCapture = { restore, reel, canvas: makeFrameCanvas(), frame: 0, states: new Set(), started: performance.now(),
        before: { animation: game.animationFrames, physics: game.physics.steps }, timings: { render: 0, readback: 0, encode: 0 } };
    } catch (error) { restore(); state.busy = false; throw error; }
    return { frames: FRAME_COUNT, fps: FPS, width: 960, height: 720 };
  };
  const nextFrameCapture = ({ png = true } = {}) => {
    const capture = frameCapture;
    assert(capture && capture.frame < FRAME_COUNT, 'No unfinished frame export');
    const index = capture.frame, start = performance.now();
    const label = capture.reel.advance(1 / FPS, index / FPS), rendered = performance.now();
    drawFrame(capture.canvas, label); const copied = performance.now();
    const image = png ? capture.canvas.toDataURL('image/png').split(',')[1] : undefined;
    const encoded = performance.now();
    capture.timings.render += rendered - start; capture.timings.readback += copied - rendered; capture.timings.encode += encoded - copied;
    capture.states.add(game.animator.diagnostics.state); capture.frame++;
    panel.dataset.frames = String(capture.frame); say(`Запись настоящих кадров: ${capture.frame} / ${FRAME_COUNT}`);
    return { index, png: image, animationUpdates: game.animationFrames - capture.before.animation,
      physicsSteps: game.physics.steps - capture.before.physics,
      frameMilliseconds: { render: rendered - start, readback: copied - rendered, encode: encoded - copied },
      drawCalls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles, shotsFired: capture.reel.diagnostics.shots.length };
  };
  const finishFrameCapture = ({ partial = false } = {}) => {
    const capture = frameCapture; assert(capture, 'No frame export to finish');
    const report = { kind: 'deterministic-production-showcase', fps: FPS, frames: capture.frame, duration: capture.frame / FPS,
      width: 960, height: 720, animationUpdates: game.animationFrames - capture.before.animation, physicsSteps: game.physics.steps - capture.before.physics,
      states: [...capture.states], shots: capture.reel.diagnostics.shots, encodingSeconds: (performance.now() - capture.started) / 1000,
      timingsMilliseconds: capture.timings, realtimeBenchmark: false, complete: capture.frame === FRAME_COUNT };
    try {
      assert(partial || report.complete, 'The recording is incomplete');
      assert(!report.complete || report.shots.length === 2 && report.shots.every(shot => shot.placed), 'The reel must contain two successful gameplay shots');
      assert(report.animationUpdates === report.frames && report.physicsSteps === report.frames * 2, 'Production step count mismatch');
      reportEl.textContent = JSON.stringify(report, null, 2); panel.dataset.status = report.complete ? 'frames-ready' : 'frames-partial';
      return report;
    } finally { capture.restore(); frameCapture = null; state.busy = false; }
  };
  // This opt-in API is also used by the shipped CI script, never loaded for a
  // normal game visit. The user-facing ZIP button continues to work separately.
  window.__LAB_EVIDENCE_CAPTURE__ = { begin: beginFrameCapture, next: nextFrameCapture, finish: finishFrameCapture };
  button('Кадры 60 FPS', 'evidence-frames', async () => {
    stop(); prepareReview(); state.busy = true; panel.dataset.status = 'recording-frames';
    const restore = videoSize(), reel = createReel(game, driver), canvas = makeFrameCanvas(), entries = [];
    const before = { animation: game.animationFrames, physics: game.physics.steps }, started = performance.now();
    const states = new Set();
    try {
      for (let frame = 0; frame < FRAME_COUNT; frame++) {
        const label = reel.advance(1 / FPS, frame / FPS); drawFrame(canvas, label); states.add(game.animator.diagnostics.state);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        assert(blob, 'Frame encoder returned an empty image');
        entries.push({ name: `${String(frame).padStart(4, '0')}.png`, blob });
        if (frame % 10 === 0) { say(`Запись настоящих кадров: ${frame + 1} / ${FRAME_COUNT}`); panel.dataset.frames = String(frame + 1); await yieldFrame(); }
      }
      const report = { kind: 'deterministic-production-showcase', fps: FPS, frames: FRAME_COUNT, duration: FRAME_COUNT / FPS, width: 960, height: 720,
        animationUpdates: game.animationFrames - before.animation, physicsSteps: game.physics.steps - before.physics, states: [...states], shots: reel.diagnostics.shots, encodingSeconds: (performance.now() - started) / 1000,
        realtimeBenchmark: false };
      assert(report.animationUpdates === FRAME_COUNT && report.physicsSteps === FRAME_COUNT * 2, 'Production step count mismatch');
      assert(report.shots.length === 2 && report.shots.every(shot => shot.placed), 'The reel must contain two successful gameplay shots');
      entries.push({ name: 'report.json', blob: new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }) });
      say('Собираю архив с кадрами…'); const zip = await makeStoredZip(entries);
      download(zip, 'nesi-animation-v6-60fps-frames.zip', 'Скачать 600 кадров · 60 FPS');
      reportEl.textContent = JSON.stringify(report, null, 2); panel.dataset.status = 'frames-ready'; panel.dataset.frames = String(FRAME_COUNT);
      say('Готово: 600 разных шагов анимации, 1200 шагов физики. 10 секунд при 60 FPS.');
    } finally { restore(); state.busy = false; }
  });
  button('Видео WebM', 'evidence-record', async () => {
    stop(); prepareReview(); assert(typeof MediaRecorder !== 'undefined', 'MediaRecorder is unavailable');
    state.busy = true; panel.dataset.status = 'recording-video';
    const restore = videoSize(); let stream, recorder;
    try {
      const canvas = makeFrameCanvas(), reel = createReel(game, driver), chunks = [];
      stream = canvas.captureStream(0); const track = stream.getVideoTracks()[0];
      assert(typeof track.requestFrame === 'function', 'Manual canvas capture is unavailable');
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      assert(mimeType, 'WebM encoder is unavailable');
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const ended = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(event.error || new Error('Video encoder failed')); });
      recorder.start();
      let previous = await yieldFrame(), elapsed = 0, frames = 0, simulation = 0;
      while (simulation < 10) {
        const now = await yieldFrame(), wallStep = Math.max(0, (now - previous) / 1000), dt = Math.min(.1, wallStep, 10 - simulation);
        previous = now; elapsed += wallStep; simulation += dt;
        drawFrame(canvas, reel.advance(dt, simulation)); track.requestFrame(); frames++;
        say(`Видео: ${simulation.toFixed(1)} / 10 с анимации · ${Math.round(frames / Math.max(elapsed, .001))} кадров/с`);
      }
      recorder.stop(); await ended;
      download(new Blob(chunks, { type: mimeType }), 'nesi-animation-v6-realtime.webm', 'Скачать видео WebM');
      reportEl.textContent = JSON.stringify({ kind: 'realtime-production-showcase', frames, duration: elapsed, actualAverageFPS: frames / elapsed, simulatedDuration: simulation, requestedFrameDuplication: false, shots: reel.diagnostics.shots }, null, 2);
      panel.dataset.status = 'video-ready'; say(`Видео готово. Фактическая частота записи: ${(frames / elapsed).toFixed(1)} кадров/с.`);
    } finally {
      if (recorder?.state === 'recording') recorder.stop();
      stream?.getTracks().forEach(track => track.stop()); restore(); state.busy = false;
    }
  });
  button('Скриншот', 'evidence-screenshot', async () => {
    render(); const blob = await new Promise(resolve => game.renderer.domElement.toBlob(resolve, 'image/png'));
    assert(blob, 'Screenshot encoder returned no data'); download(blob, `nesi-v6-${panel.dataset.pose || 'level'}.png`);
  });
  button('Играть', 'evidence-play', () => {
    stop(); prepareReview(); game.input.keys.clear(); game.lastFrame = performance.now(); game.state = 'playing'; game.renderer.setAnimationLoop(game.animate); say('Игровой режим.');
  });
  button('Остановить', 'evidence-stop', () => { stop(); render(); say('Кадр остановлен.'); });
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  panel.addEventListener('mousedown', event => event.stopPropagation());
  return { driver, panel, stop, dispose: () => { stop(); frameCapture?.restore(); delete window.__LAB_EVIDENCE_CAPTURE__; state.urls.forEach(url => URL.revokeObjectURL(url)); panel.remove(); } };
}

/** Continuous campaign proof, using production controls and raycast shots only.
 * No player-position fixture and no cargo replacement/reset. Rendering can be
 * suspended by the caller; the exact production physics still runs at 120 Hz. */
export function runCampaignJourney(game, index = game.levelIndex) {
  assert(index===game.levelIndex && [1,2].includes(index), 'Select the requested new level first');
  const fullVisual=game.updateVisuals.bind(game);
  game.updateVisuals=dt=>{
    game.visualTime+=dt;game.playerGroup.position.copy(game.playerPosition);game.playerGroup.rotation.y=game.facing;
    game.cargo.group.position.copy(game.cargo.position);game.cargo.group.quaternion.copy(game.cargo.quaternion);
    game.scene.updateMatrixWorld(true);
  };
  const d=createEvidenceDriver(game);d.step(.7);
  const level=game.firstLevel,cargo=game.cargo,body=game.physics.cargoBody;
  const reset=game.physics.resetCargo.bind(game.physics),respawn=game.respawn.bind(game);
  game.physics.resetCargo=()=>{throw new Error('Cargo reset during continuous campaign route');};
  game.respawn=()=>{throw new Error('Player respawn during continuous campaign route');};
  const steps=[];
  const mark=name=>{assert(game.cargo===cargo,'Companion was replaced');assert(game.physics.cargoBody===body,'Body was replaced');
    steps.push({name,player:game.playerPosition.toArray(),cargo:cargo.position.toArray(),mechanisms:level.diagnostics()});};
  const shoot=(slot,panel,point)=>{aimEvidencePoint(game,point);assert(game.placePortal(slot),`Shot rejected ${slot}: ${point.toArray()}`);assert(game.portalSurfaceIds[slot]===panel.uuid,'Wrong portal surface');};
  const pickup=()=>{d.pressE();d.step(.7);assert(game.heldCube===cargo,`pickup ${game.playerPosition.toArray()} cargo ${cargo.position.toArray()}`);};
  const weight=pad=>{d.goto(pad.position.x,pad.position.z+2.7);d.goto(pad.position.x,pad.position.z+.85);d.step(.5);d.pressE();d.step(2);assert(pad.pressed,`pad not loaded ${cargo.position.toArray()}`);};
  try {
    if(index===1)shoot(0,level.pads[0].top,level.pads[0].mechanism.getPortalFrame().center);
    d.goto(cargo.position.x,cargo.position.z+1.1);pickup();
    if(index===2){
      d.goto(0,5);d.goto(0,0);d.step(6);assert(game.playerPosition.y>3.15&&game.heldCube===cargo,'loaded lift did not reach balcony');
      mark('ride real lift with same companion');d.goto(0,-4.8);d.goto(-3.6,-5.8);d.pressE();d.step(.8);
      shoot(0,level.pads[0].top,level.pads[0].mechanism.getPortalFrame().center);pickup();
    }
    weight(level.pads[0]);mark('load first circuit');
    if(index===1){d.goto(0,4);d.goto(0,-3);}
    else{d.goto(0,-12.5);d.goto(0,-20.3);}
    const receiver=level.panels[0], point=receiver.userData.center.clone();point.y-=.20;
    shoot(1,receiver,point);d.step(1.3);assert(cargo.position.z<0,'companion not transported');mark('retrieve through plate and wall');
    d.goto(cargo.position.x+(index===1?-1: -1),cargo.position.z+.25);if(game.state!=='won')pickup();
    if(index===1){
      d.goto(6,-4.2);d.goto(6,-8.0);game.clearPortals();d.pressE();d.step(.8);
      shoot(0,level.pads[1].top,level.pads[1].mechanism.getPortalFrame().center);pickup();
      weight(level.pads[1]);mark('load independent second circuit');d.goto(0,-15);d.goto(0,-22.8);
      const r=level.panels[1],p=r.userData.center.clone();p.y-=.20;shoot(1,r,p);d.step(1.3);mark('retrieve beyond energy barrier');
      d.goto(cargo.position.x+1,cargo.position.z+.1);
    }
    if(game.state!=='won')d.goto(game.cargo.position.x, -25.3);
    d.step(.3);assert(game.state==='won','both actors must reach goal');mark('win without resets or fixtures');
    game.updateVisuals=fullVisual;for(let i=0;i<90;i++)fullVisual(1/60,1);
    assert(game.animator.diagnostics.boneCount===14,'Unexpected player rig');
    return {level:index+1,completed:true,playerRespawns:0,cargoResets:0,steps};
  } finally { game.physics.resetCargo=reset; game.respawn=respawn; game.updateVisuals=fullVisual; }
}
