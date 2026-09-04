import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const out = process.env.EVIDENCE_DIR || 'smoke-artifacts';
fs.mkdirSync(out, { recursive: true });
const recording = process.env.RECORD_VIDEO === '1';
if (recording && spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('ffmpeg is required for recording');
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH, headless: true, protocolTimeout: 240000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = { errors: [] };
let page;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
try {
  page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(String(error.stack || error)));
  await page.goto((process.env.DEMO_URL || 'http://127.0.0.1:4173/nesi-brainrot/') + '?smoke=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => ['playing', 'error'].includes(document.documentElement.dataset.runtimeState), { timeout: 180000, polling: 500 });
  report.start = await page.evaluate(() => ({ ...window.__NESI_DEMO_DIAGNOSTICS__, error: window.__NESI_DEMO_ERROR__ ?? null }));
  assert(!report.start.error, report.start.error);
  await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__;
    g.renderer.setAnimationLoop(null);
    g.renderer.setPixelRatio(1); g.renderer.setSize(800, 600);
    g.camera.aspect = 800 / 600; g.camera.updateProjectionMatrix();
    const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    const step = seconds => {
      const ticks = Math.round(seconds * 120);
      for (let i = 0; i < ticks; i++) {
        g.updatePlaying(1 / 120);
        if (i % 2 === 1) g.updateVisuals(1 / 60, 1);
      }
      if (ticks % 2) g.updateVisuals(1 / 120, 1);
    };
    const fixturePlayer = (x, y, z, facing = Math.PI) => {
      g.playerPosition.set(x, y, z); g.previousPlayerPosition.copy(g.playerPosition);
      g.playerVelocity.set(0, 0, 0); g.playerGrounded = true;
      g.facing = g.previousFacing = facing; g.yaw = facing - Math.PI;
      g.playerGroup.position.copy(g.playerPosition); g.playerGroup.rotation.y = facing;
      g.input.keys.clear(); g.updateVisuals(0, 1);
    };
    const pressE = () => { key('KeyE', true); step(1 / 60); key('KeyE', false); };
    const goto = (x, z, limit = 14) => {
      const start = g.playerPosition.clone();
      let reached = false;
      for (let i = 0; i < limit * 60; i++) {
        const dx = x - g.playerPosition.x, dz = z - g.playerPosition.z;
        if (Math.hypot(dx, dz) < .15) { reached = true; break; }
        g.yaw = Math.atan2(-dx, -dz); key('KeyW', true); step(1 / 60);
      }
      key('KeyW', false); step(.4);
      if (!reached) throw new Error('Route blocked towards ' + JSON.stringify([x, z]) + ' from ' + start.toArray() + '; player=' + g.playerPosition.toArray() + '; cargo=' + g.cargo.position.toArray());
    };
    const aimPanel = (index, stage, side = index) => {
      const panel = g.portalPanels.filter(p => p.userData.stage === stage)[side];
      g.camera.position.copy(g.playerPosition).add(g.playerPosition.clone().set(0, 1.65, 0));
      g.camera.lookAt(panel.userData.center); g.camera.updateMatrixWorld(true);
      if (!g.placePortal(index)) throw new Error('Ray-aimed portal placement failed: ' + [stage, index]);
    };
    window.__LAB_SMOKE__ = { key, step, fixturePlayer, pressE, goto, aimPanel };
  });
  report.game = await page.evaluate(() => window.__NESI_DEMO_GAME__.diagnostics());
  assert(report.game.modelsLoaded === 14 && report.game.missingModels.length === 0, '14 source-backed models must load');
  assert(report.game.thirdPerson && report.game.animation.boneCount >= 14, 'articulated third-person player');
  assert(report.game.cargo.count === 1 && report.game.physicsHz === 120, 'one cargo with 120 Hz simulation');

  report.ui = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__, s = window.__LAB_SMOKE__;
    const hud = document.querySelector('#hud');
    const visibleLegacy = [...document.querySelectorAll('#timer, #elapsed, #progress, #game-progress, #hud [role="progressbar"]')].filter(el => el.getClientRects().length > 0).map(el => el.id);
    s.key('KeyQ', true); s.step(1 / 60); s.key('KeyQ', false);
    return { visibleLegacy, text: hud.textContent, controls: g.help.textContent, qCreatedPortals: g.portals.ready,
      allPropsVisible: g.sectorProps.flat().every(prop => prop.visible), cargoVisible: g.cargo.group.visible };
  });
  assert(report.ui.visibleLegacy.length === 0 && !/\bQ\b|\d+:\d{2}|\d+\s*%/.test(report.ui.text + report.ui.controls)
    && !report.ui.qCreatedPortals && report.ui.allPropsVisible && report.ui.cargoVisible, 'clean HUD, no Q solution, persistent scenery');

  report.movement = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__, s = window.__LAB_SMOKE__;
    g.resetRun(true); const start = g.playerPosition.clone();
    s.key('KeyW', true); s.step(.75); s.key('KeyW', false);
    const moved = start.distanceTo(g.playerPosition), movingJoints = g.animator.diagnostics.movingJoints;
    s.key('Space', true); s.step(1 / 60); s.key('Space', false);
    const jumped = g.playerPosition.y > .05; g.resetRun(true);
    s.key('KeyF', true); s.key('KeyD', true); s.step(.75); s.key('KeyD', false);
    const strafe = g.animator.diagnostics;
    s.key('KeyS', true); s.step(.75); s.key('KeyS', false);
    const backward = g.animator.diagnostics;
    const facingError = Math.abs(Math.atan2(Math.sin(g.facing - g.yaw - Math.PI), Math.cos(g.facing - g.yaw - Math.PI)));
    s.key('KeyF', false); s.step(.4);
    const released = !g.isAiming();
    return { moved, movingJoints, jumped, strafe, backward, facingError, released };
  });
  assert(report.movement.moved > 2 && report.movement.jumped && report.movement.movingJoints >= 6, 'movement, jump and limb motion');
  assert(report.movement.strafe.locomotion.startsWith('strafe_') && report.movement.backward.locomotion.endsWith('_backward')
    && report.movement.facingError < .04 && report.movement.released, 'F + movement gives aim strafing and backsteps');

  report.handGrip = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__, s = window.__LAB_SMOKE__;
    g.resetRun(true); s.step(.7);
    const hand = g.animator.bones.HandR;
    const sample = () => {
      g.playerGroup.updateWorldMatrix(true, true);
      const handWorld = hand.getWorldPosition(g.playerPosition.clone());
      const weaponWorld = g.weapon.getWorldPosition(g.playerPosition.clone());
      return { handWorld, weaponWorld, local: hand.worldToLocal(weaponWorld.clone()) };
    };
    const before = sample(); g.animator.bones.ArmR.rotation.x += .55; g.animator.bones.ForearmR.rotation.z += .25;
    const after = sample();
    return { handMoved: before.handWorld.distanceTo(after.handWorld), weaponMoved: before.weaponWorld.distanceTo(after.weaponWorld),
      localDrift: before.local.distanceTo(after.local), device: g.heldDevice.diagnostics };
  });
  assert(report.handGrip.handMoved > .08 && report.handGrip.weaponMoved > .08 && report.handGrip.localDrift < 1e-6
    && report.handGrip.device.handAttached && report.handGrip.device.handDistance < 1e-6, 'source grip must follow animated right palm');

  report.cargoPhysics = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__, s = window.__LAB_SMOKE__;
    g.resetRun(true); s.fixturePlayer(-3, 0, 18);
    // Isolated physics fixture: the continuous journey below never resets cargo.
    g.physics.resetCargo({ position: [3, 2.8, 17], velocity: [1.8, .1, -.7], angularVelocity: [2, 3, 1] });
    s.step(1 / 120); const first = g.cargo.position.clone(), q0 = g.cargo.quaternion.clone();
    s.step(.4); const falling = g.cargo.position.clone(), angularChange = q0.angleTo(g.cargo.quaternion);
    s.step(3); const resting = g.cargo.position.clone(), speed = g.cargo.velocity.length();
    s.fixturePlayer(resting.x, 0, resting.z + 1.15); s.step(.1);
    const beforePickup = g.cargo.position.clone(); s.pressE(); const pickupStep = beforePickup.distanceTo(g.cargo.position);
    s.step(1.4); const held = g.heldCube === g.cargo, holster = g.heldDevice.diagnostics;
    const beforeRelease = g.cargo.position.clone(); g.interact();
    const releaseSnap = beforeRelease.distanceTo(g.cargo.position);
    s.step(.3); const drop = beforeRelease.y - g.cargo.position.y;
    return { first: first.toArray(), falling: falling.toArray(), angularChange, resting: resting.toArray(), speed, pickupStep, held, holster, releaseSnap, drop,
      physics: g.physics.diagnostics };
  });
  assert(report.cargoPhysics.falling[1] < report.cargoPhysics.first[1] - .5 && report.cargoPhysics.angularChange > .2
    && report.cargoPhysics.resting[1] > .32 && report.cargoPhysics.resting[1] < .65 && report.cargoPhysics.speed < .3, 'cargo falls, tumbles and settles against real floor');
  assert(report.cargoPhysics.held && report.cargoPhysics.pickupStep < .08 && report.cargoPhysics.holster.state === 'holstered'
    && report.cargoPhysics.releaseSnap < 1e-8 && report.cargoPhysics.drop > .3, 'spring pickup and momentum-preserving drop without snapping');

  console.log('Movement, hand grip and physical cargo checks passed.');

  report.portalRules = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__, s = window.__LAB_SMOKE__;
    g.resetRun(true); s.fixturePlayer(-9.7, 0, 15); s.aimPanel(0, 0); s.aimPanel(1, 0);
    s.step(1.2);
    const cargoBefore = g.cargo.position.clone(), body = g.physics.cargoBody;
    s.key('KeyA', true);
    for (let i = 0; i < 90 && g.teleportCount === 0; i++) s.step(1 / 60);
    s.key('KeyA', false); s.step(.3);
    const playerTraversed = g.teleportCount === 1, cargoStayed = cargoBefore.distanceTo(g.cargo.position) < .1 && body === g.physics.cargoBody;
    const attached = g.heldDevice.diagnostics;
    // A held-cargo fixture deliberately tries the same portal from its front.
    s.fixturePlayer(-10.1, 0, 15, -Math.PI / 2);
    g.physics.resetCargo({ position: [-10.8, .65, 15] }); s.step(1 / 60); g.interact(); s.step(.8);
    const heldBefore = g.heldCube === g.cargo, before = g.teleportCount, portalBlocked = !g.placePortal(0);
    g.yaw = 0; s.key('KeyA', true); s.step(.8); s.key('KeyA', false);
    const carryDidNotTeleport = g.teleportCount === before && g.playerPosition.z > 13 && g.cargo.position.z > 13 && g.playerPosition.x < -10.7;
    g.interact();
    s.fixturePlayer(-8, 0, 17);
    g.physics.resetCargo({ position: [-10.55, .7, 15], velocity: [-5, 0, 0], angularVelocity: [0, 0, 3] });
    s.step(.8);
    const freeCargoBlocked = g.cargo.position.x > -11.3 && Math.abs(g.cargo.position.z - 15) < .2;
    // Render the visible aperture twice at adjacent 60 Hz times: each must redraw.
    const entry = g.portals.portals[0];
    g.camera.position.copy(entry.position).addScaledVector(entry.normal, 4); g.camera.lookAt(entry.position); g.camera.updateMatrixWorld(true);
    g.render(); const firstRender = { ...g.portals.diagnostics };
    g.visualTime += 1 / 60; g.render(); const secondRender = { ...g.portals.diagnostics };
    return { playerTraversed, cargoStayed, attached, heldBefore, portalBlocked, carryDidNotTeleport, freeCargoBlocked, firstRender, secondRender };
  });
  assert(report.portalRules.playerTraversed && report.portalRules.cargoStayed && report.portalRules.attached.handAttached, 'player portal leaves persistent cargo behind and keeps device attached');
  assert(report.portalRules.heldBefore && report.portalRules.portalBlocked && report.portalRules.carryDidNotTeleport && report.portalRules.freeCargoBlocked, 'carrying cannot fire or traverse portals');
  assert([report.portalRules.firstRender, report.portalRules.secondRender].every(r => r.width === 800 && r.height === 600 && r.passes > 0 && r.cadence === 'every-render-frame'), 'sharp portal view rendered on each adjacent frame');

  console.log('Player-only portal traversal and consecutive-frame portal rendering passed.');

  // Complete the route with one object, one physics body and ordinary keyboard
  // movement. Only fixtures above use resetCargo; this journey forbids it.
  report.journey = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__, s = window.__LAB_SMOKE__;
    g.resetRun(true); s.step(.7);
    const cargo = g.cargo, body = g.physics.cargoBody, resetCargo = g.physics.resetCargo;
    const identity = cargo.group.uuid;
    window.__LAB_ROUTE_LOG__ = [];
    g.physics.resetCargo = () => { throw new Error('Cargo reset during continuous journey'); };
    const mark = name => {
      if (g.cargo !== cargo || g.physics.cargoBody !== body || g.cubes.length !== 1 || !cargo.group.visible) throw new Error('Cargo identity/visibility changed');
      window.__LAB_ROUTE_LOG__.push({ name, player: g.playerPosition.toArray(), cargo: cargo.position.toArray(), held: Boolean(g.heldCube), stage: g.stage,
        doors: g.doors.map(d => d.opened), bridges: g.mechanisms.bridges.map(b => b.active), barrier: g.mechanisms.barrier.opened, lift: g.mechanisms.lift.y });
    };
    const pickup = () => { s.pressE(); s.step(1); if (g.heldCube !== cargo) throw new Error('Journey pickup failed at ' + g.playerPosition.toArray() + ' cargo ' + cargo.position.toArray()); };
    const releaseOnPad = (x, y, z, activated) => {
      s.goto(x, z + 2); s.goto(x, z + .85); s.step(.9);
      s.pressE(); s.step(2.6);
      if (!activated()) throw new Error('Pad did not activate at ' + [x, y, z] + '; cargo=' + cargo.position.toArray() + '; speed=' + cargo.velocity.length());
      pickup();
    };
    try {
      s.goto(-9.8, 15); s.aimPanel(0, 0); s.aimPanel(1, 0); s.step(1.2); g.yaw = 0;
      s.key('KeyA', true);
      for (let i = 0; i < 100 && g.teleportCount === 0; i++) s.step(1 / 60);
      s.key('KeyA', false); s.step(.3);
      if (g.teleportCount !== 1) throw new Error('Opening portal crossing failed');
      s.goto(-5, 2.7); s.pressE(); s.step(4);
      if (!g.mechanisms.bridges[0].active) throw new Error('First bridge terminal failed');
      mark('first bridge activated by player');
      s.goto(0, 3); s.goto(0, 13); s.goto(4.6, 16.3); pickup();
      s.goto(0, 13); s.goto(0, 3);
      releaseOnPad(4.6, 0, 0, () => g.doors[0].opened); mark('first latch opened, cargo retrieved');
      s.goto(0, .7); s.goto(0, -6); mark('first doorway crossed together');
      releaseOnPad(-4, 0, -10, () => g.mechanisms.barrier.opened); mark('workshop field latched');
      s.goto(0, -12); s.goto(0, -16.3); s.goto(-6, -16.3); s.goto(-6, -18.45);
      s.step(4.8);
      if (g.playerPosition.y < 2.05 || g.mechanisms.lift.y < 2.1 || g.heldCube !== cargo) throw new Error('Loaded lift did not carry both');
      mark('lift raised both to ledge');
      s.goto(-6, -21); releaseOnPad(-5, 2.2, -23, () => g.doors[1].opened);
      s.goto(-2.2, -23.5); s.step(.8); s.goto(0, -24); s.goto(0, -28.5); mark('second doorway crossed together');
      s.goto(3, -30); s.step(.8); s.pressE(); s.step(1.4);
      s.goto(0, -30.15); g.yaw = 0;
      s.key('KeyW', true);
      for (let i = 0; i < 220 && g.playerPosition.z > -41; i++) s.step(1 / 60);
      s.key('KeyW', false); s.step(.6);
      if (g.playerPosition.z > -40 || g.playerPosition.y < -.2) throw new Error('Player launch did not reach far bank');
      s.goto(4, -41.3); s.pressE(); s.step(4);
      if (!g.mechanisms.bridges[1].active) throw new Error('Last bridge terminal failed');
      mark('last bridge activated; cargo waited');
      s.goto(0, -41.4); s.goto(0, -33); s.goto(3, -33); s.goto(cargo.position.x, cargo.position.z - 1.15); pickup();
      s.goto(3, -33); s.goto(0, -33); s.goto(0, -42);
      releaseOnPad(0, 0, -44, () => g.doors[2].opened); mark('final latch opened, cargo retrieved');
      s.goto(0, -49); s.step(.5); mark('together at exit');
      if (g.state !== 'won') throw new Error('Exit did not require and accept both companions');
      return { identity, bodyId: body.id, cargoResets: 0, completed: true, state: g.state, milestones: window.__LAB_ROUTE_LOG__ };
    } finally { g.physics.resetCargo = resetCargo; }
  });
  assert(report.journey.completed && report.journey.cargoResets === 0, 'continuous three-room journey');
  report.gameplayPassed = true;
  console.log('All three rooms completed with the same physical companion.');

  await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__, s = window.__LAB_SMOKE__;
    window.__LAB_CLOSE_CAMERA__ = () => {
      g.camera.position.set(-2.1, 1.85, 12); g.camera.lookAt(0, 1.28, 16); g.camera.updateMatrixWorld(true);
    };
    window.__LAB_REEL_RESET__ = () => {
      g.resetRun(true); s.fixturePlayer(0, 0, 16);
      g.physics.resetCargo({ position: [.95, .43, 15.05] });
      s.step(.8); window.__LAB_CLOSE_CAMERA__();
    };
    window.__LAB_REEL_RESET__();
  });
  const capture = async (name, setup) => {
    if (setup) await page.evaluate(setup);
    const png = await page.evaluate(() => {
      const g = window.__NESI_DEMO_GAME__; g.render();
      return g.renderer.domElement.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(path.join(out, name), Buffer.from(png, 'base64'));
  };
  await capture('lab-third-person.png', () => {
    const g = window.__NESI_DEMO_GAME__; g.cameraRig.reset(g.playerPosition, -.25, -.19); g.yaw = -.25; g.pitch = -.19; g.updateVisuals(1 / 60, 1);
  });
  await capture('weapon-grip.png', () => {
    const g = window.__NESI_DEMO_GAME__, s = window.__LAB_SMOKE__;
    s.key('KeyF', true); s.step(.8); s.key('KeyF', false); window.__LAB_CLOSE_CAMERA__();
  });
  await capture('carry-pose.png', () => {
    const s = window.__LAB_SMOKE__; s.pressE(); s.step(1.5); window.__LAB_CLOSE_CAMERA__();
  });
  report.stills = ['lab-third-person.png', 'weapon-grip.png', 'carry-pose.png'];
  console.log('Captured production hand grip and physical carry pose.');

  if (recording) {
    const frames = path.join(out, 'animation-frames'); fs.mkdirSync(frames, { recursive: true });
    await page.evaluate(() => {
      window.__LAB_REEL_RESET__();
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      window.__LAB_REEL_CANVAS__ = canvas; window.__LAB_REEL_STATES__ = new Set();
      const g = window.__NESI_DEMO_GAME__;
      window.__LAB_REEL_COUNTERS__ = { animation: g.animationFrames, physics: g.physics.steps };
    });
    const frameCount = 600, fps = 60;
    for (let frame = 0; frame < frameCount; frame++) {
      const png = await page.evaluate(({ frame, fps }) => {
        const g = window.__NESI_DEMO_GAME__, t = frame / fps;
        const airborne = t >= 3.9 && t < 4.6, aiming = t >= 2.65 && t < 3.9;
        const strafe = t >= 2.65 && t < 3.2, backward = t >= 3.2 && t < 3.45;
        const speed = t >= .65 && t < 1.45 ? 2.8 : t >= 1.45 && t < 2.2 ? 6.6
          : strafe || backward ? 2.8 : t >= 5.55 && t < 6.65 ? 3.3 : 0;
        if (frame === 0) { g.animator.trigger('curious'); g.companionAnimator.trigger('curious'); }
        if (frame === 480) { g.animator.trigger('celebrate'); g.companionAnimator.trigger('celebrate'); }
        if (frame === 208 || frame === 222) { g.animator.triggerShot(); g.heldDevice.fire(frame === 208 ? 0 : 1); }
        if (frame === 306 || frame === 426) g.interact();
        const previousY = g.playerPosition.y;
        g.previousPlayerPosition.copy(g.playerPosition);
        g.playerPosition.y = airborne ? Math.sin((t - 3.9) / .7 * Math.PI) * .65 : 0;
        g.playerVelocity.set(0, (g.playerPosition.y - previousY) * fps, 0); g.playerGrounded = !airborne;
        g.motion = { speed, turnRate: 0, moveForward: backward ? -1 : strafe ? 0 : 1, moveRight: strafe ? (t < 2.95 ? 1 : -1) : 0 };
        g.aimHeld = aiming; g.pitch = -.08;
        // Two real physics steps and one new production animation update per
        // 60 Hz frame: no duplicated frames, frame interpolation or upscaling.
        g.updateCubes(1 / 120); g.updateCubes(1 / 120); g.updateVisuals(1 / fps, 1);
        window.__LAB_REEL_STATES__.add(g.animator.diagnostics.state);
        window.__LAB_CLOSE_CAMERA__(); g.render();
        const canvas = window.__LAB_REEL_CANVAS__, ctx = canvas.getContext('2d');
        ctx.drawImage(g.renderer.domElement, 0, 0);
        const label = t >= 8 ? 'HAPPY / WAVE' : t < .65 ? 'RIGHT-HAND GRIP' : t < 1.45 ? 'START / WALK' : t < 2.2 ? 'RUN' : t < 2.65 ? 'STOP'
          : t < 3.2 ? 'AIM / STRAFE' : t < 3.45 ? 'AIM / BACKSTEP' : t < 3.9 ? 'PORTAL PULSE'
            : t < 4.6 ? 'JUMP / FALL' : t < 5.1 ? 'LAND' : t < 5.55 ? 'PICK UP'
              : t < 6.65 ? 'CARRY / WALK' : t < 7.1 ? 'CARRY / STOP' : t < 7.75 ? 'RELEASE / SETTLE' : 'READY';
        ctx.font = 'bold 15px sans-serif'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.fillStyle = '#234957';
        ctx.strokeText(label, 24, 32); ctx.fillText(label, 24, 32);
        return canvas.toDataURL('image/png').split(',')[1];
      }, { frame, fps });
      fs.writeFileSync(path.join(frames, String(frame).padStart(4, '0') + '.png'), Buffer.from(png, 'base64'));
      if (frame % fps === 0) console.log('Recorded animation frame', frame, '/', frameCount);
    }
    const encoded = spawnSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', path.join(frames, '%04d.png'), '-frames:v', String(frameCount), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'player-animation.mp4')], { encoding: 'utf8' });
    if (encoded.status !== 0) fs.renameSync(frames, path.join(out, 'recording-fallback'));
    assert(encoded.status === 0, 'ffmpeg encoding failed: ' + (encoded.error?.message || encoded.stderr));
    report.video = { frames: frameCount, fps, duration: frameCount / fps, width: 800, height: 600,
      ...await page.evaluate(() => {
        const g = window.__NESI_DEMO_GAME__, before = window.__LAB_REEL_COUNTERS__;
        return { states: [...window.__LAB_REEL_STATES__], animationUpdates: g.animationFrames - before.animation, physicsSteps: g.physics.steps - before.physics };
      }) };
    assert(report.video.animationUpdates === frameCount && report.video.physicsSteps === frameCount * 2, 'every 60 fps frame must advance production animation and 120 Hz physics');
  }
  assert(report.errors.length === 0, 'page errors: ' + report.errors.join('\n'));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error.stack || error);
  if (page) {
    try { report.failureState = await page.evaluate(() => ({ game: window.__NESI_DEMO_GAME__?.diagnostics?.(), route: window.__LAB_ROUTE_LOG__, error: window.__NESI_DEMO_ERROR__ })); } catch {}
  }
  throw error;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
