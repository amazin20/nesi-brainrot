import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const out = process.env.EVIDENCE_DIR || 'smoke-artifacts';
fs.mkdirSync(out, { recursive: true });
if (process.env.RECORD_VIDEO === '1' && spawnSync('ffmpeg', ['-version']).status !== 0) {
  throw new Error('ffmpeg must be installed before recording');
}
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = { errors: [] };
let page;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
try {
  page = await browser.newPage();
  await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(String(error.stack || error)));
  await page.goto((process.env.DEMO_URL || 'http://127.0.0.1:4173/nesi-brainrot/') + '?smoke=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => ['playing', 'error'].includes(document.documentElement.dataset.runtimeState), { timeout: 180000, polling: 500 });
  report.start = await page.evaluate(() => ({ ...window.__NESI_DEMO_DIAGNOSTICS__, error: window.__NESI_DEMO_ERROR__ ?? null }));
  assert(!report.start.error, report.start.error);
  await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__;
    g.renderer.setAnimationLoop(null);
    // Browser viewport changes do not always reach the renderer in headless CI.
    g.renderer.setPixelRatio(1); g.renderer.setSize(800, 600);
    g.camera.aspect = 800 / 600; g.camera.updateProjectionMatrix();
  });
  report.game = await page.evaluate(() => window.__NESI_DEMO_GAME__.diagnostics());
  assert(report.game.modelsLoaded === 14 && report.game.missingModels.length === 0, '14 source-backed models must load');
  assert(report.game.thirdPerson && report.game.cameraDistance > 2.5, 'third-person framing');
  assert(report.game.animation?.boneCount >= 14 && report.game.animation?.backpackRigid, 'real articulated player rig missing');

  report.movement = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__;
    const start = g.playerPosition.clone();
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    for (let i = 0; i < 45; i++) g.updatePlaying(1 / 60);
    dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    const moved = start.distanceTo(g.playerPosition);
    const movingJoints = g.animator.diagnostics.movingJoints;
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    g.updatePlaying(1 / 60);
    dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    const jumped = g.playerPosition.y > .05;
    g.resetRun(true);
    return { moved, jumped, movingJoints };
  });
  assert(report.movement.moved > 2 && report.movement.jumped && report.movement.movingJoints >= 6, 'movement, jump and independent limb animation');

  report.handGrip = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__;
    g.resetRun(true);
    for (let i = 0; i < 40; i++) g.updatePlaying(1 / 60);
    const hand = g.animator.bones.HandR;
    const ancestors = object => { const names = []; for (let p = object.parent; p; p = p.parent) names.push(p.name); return names; };
    const sample = () => {
      g.playerGroup.updateWorldMatrix(true, true);
      const handWorld = hand.getWorldPosition(g.playerPosition.clone());
      const weaponWorld = g.weapon.getWorldPosition(g.playerPosition.clone());
      const localPosition = hand.worldToLocal(weaponWorld.clone());
      const localRotation = g.weapon.getWorldQuaternion(hand.quaternion.clone())
        .premultiply(hand.getWorldQuaternion(hand.quaternion.clone()).invert());
      return { handWorld, weaponWorld, localPosition, localRotation };
    };
    const before = sample();
    g.animator.bones.ArmR.rotation.x += .55;
    g.animator.bones.ForearmR.rotation.z += .25;
    const after = sample();
    const result = {
      ancestors: ancestors(g.weapon),
      handMoved: before.handWorld.distanceTo(after.handWorld),
      weaponMoved: before.weaponWorld.distanceTo(after.weaponWorld),
      localPositionDrift: before.localPosition.distanceTo(after.localPosition),
      localRotationDrift: before.localRotation.angleTo(after.localRotation),
      device: g.heldDevice.diagnostics,
    };
    g.resetRun(true);
    return result;
  });
  assert(report.handGrip.ancestors.includes('LabHandR') && report.handGrip.handMoved > .08
    && report.handGrip.weaponMoved > .08 && report.handGrip.localPositionDrift < 1e-6
    && report.handGrip.localRotationDrift < 1e-6 && report.handGrip.device.handDistance < 1e-6, 'device must follow the animated right hand: ' + JSON.stringify(report.handGrip));

  report.aimMovement = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__;
    g.resetRun(true);
    const step = count => { for (let i = 0; i < count; i++) g.updatePlaying(1 / 60); };
    const key = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    const angleError = () => Math.abs(Math.atan2(Math.sin(g.facing - g.yaw - Math.PI), Math.cos(g.facing - g.yaw - Math.PI)));
    key('KeyF', true); key('KeyD', true);
    const start = g.playerPosition.clone(); step(45);
    const strafe = { moved: g.playerPosition.x - start.x, facingError: angleError(), aiming: g.isAiming(), animation: g.animator.diagnostics };
    key('KeyD', false); key('KeyS', true);
    const beforeBack = g.playerPosition.clone(); step(45);
    const backward = { moved: g.playerPosition.z - beforeBack.z, facingError: angleError(), aiming: g.isAiming(), animation: g.animator.diagnostics };
    key('KeyS', false); key('KeyF', false); step(35);
    const released = !g.isAiming();
    g.resetRun(true);
    return { strafe, backward, released };
  });
  assert(report.aimMovement.strafe.aiming && report.aimMovement.strafe.moved > 1.5
    && report.aimMovement.strafe.facingError < .04
    && report.aimMovement.strafe.animation.state === 'aim_walk'
    && report.aimMovement.strafe.animation.locomotion.startsWith('strafe_'), 'F + D must strafe while keeping aim facing');
  assert(report.aimMovement.backward.aiming && report.aimMovement.backward.moved > 1.5
    && report.aimMovement.backward.facingError < .04 && report.aimMovement.released
    && report.aimMovement.backward.animation.locomotion.endsWith('_backward'), 'F + S must backstep; releasing F must leave aim');

  report.shooting = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__;
    const panels = g.portalPanels.filter(p => p.userData.stage === 0);
    g.camera.position.set(0, 2, 15);
    const results = panels.map((panel, i) => {
      g.camera.lookAt(panel.userData.center); g.camera.updateMatrixWorld(true);
      return g.placePortal(i);
    });
    return { results, paired: g.portals.ready, recoil: g.animator.diagnostics.recoil, device: g.heldDevice.diagnostics };
  });
  assert(report.shooting.results.every(Boolean) && report.shooting.paired
    && report.shooting.recoil > 0 && report.shooting.device.flashing, 'ray-aimed portal placement');

  report.chambers = [];
  for (let stage = 0; stage < 3; stage++) {
    const result = await page.evaluate(stage => {
      const g = window.__NESI_DEMO_GAME__;
      if (g.stage !== stage) throw new Error('wrong chamber before test: ' + g.stage);
      const step = count => { for (let i = 0; i < count; i++) g.updatePlaying(1 / 60); };
      if (stage > 0) {
        const cube = g.cubes[stage];
        g.playerPosition.copy(cube.group.position).setY(0);
        g.playerVelocity.set(0, 0, 0); g.playerGrounded = true;
        g.toggleCube();
        if (g.heldCube !== cube) throw new Error('pickup failed in stage ' + stage);
      }
      g.showHint();
      const entry = g.portals.portals[0];
      g.playerPosition.copy(entry.position).addScaledVector(entry.normal, 1.2).setY(0);
      g.playerVelocity.copy(entry.normal).multiplyScalar(-4.8);
      g.playerGrounded = true; g.portalCooldown = 0; g.yaw = 0;
      const before = g.teleportCount;
      let deviceStayedAttached = true, maximumDeviceDistance = 0, maximumSocketDrift = 0;
      const requiredBone = stage === 0 ? 'LabHandR' : 'LabBody';
      const key = entry.normal.x > 0 ? 'KeyA' : 'KeyD';
      dispatchEvent(new KeyboardEvent('keydown', { code: key }));
      for (let i = 0; i < 70; i++) {
        step(1);
        const parents = [];
        for (let p = g.weapon.parent; p; p = p.parent) parents.push(p.name);
        const distance = g.weapon.getWorldPosition(g.playerPosition.clone()).distanceTo(g.playerPosition);
        maximumDeviceDistance = Math.max(maximumDeviceDistance, distance);
        maximumSocketDrift = Math.max(maximumSocketDrift, g.heldDevice.diagnostics.socketDistance);
        deviceStayedAttached &&= parents.includes(requiredBone) && (stage === 0 || !parents.includes('LabHandR')) && distance < 3 && maximumSocketDrift < 1e-6;
      }
      dispatchEvent(new KeyboardEvent('keyup', { code: key }));
      const traversed = g.teleportCount > before;
      const carriedThrough = stage === 0 || g.heldCube === g.cubes[stage] && g.cubes[stage].group.position.distanceTo(g.playerPosition) < 2.2;
      const playerZ = g.playerPosition.z;
      const carryDevice = g.heldDevice.diagnostics;
      if (g.heldCube) g.toggleCube();
      const cube = g.cubes[stage];
      cube.group.position.copy(g.doors[stage].buttonRing.position).setY(.64);
      cube.velocity.set(0, 0, 0);
      step(120);
      const opened = g.doors[stage].opened;
      const doorProgress = g.doors[stage].progress;
      g.playerPosition.set(0, 0, g.doors[stage].z + .9);
      g.playerVelocity.set(0, 0, 0); g.playerGrounded = true; g.yaw = 0;
      dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      step(50);
      dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      return { traversed, carriedThrough, deviceStayedAttached, maximumDeviceDistance, maximumSocketDrift, carryDevice, playerZ, opened, doorProgress, nextStage: g.stage, state: g.state };
    }, stage);
    assert(result.traversed && result.carriedThrough, 'portal/cargo traversal in chamber ' + stage + ': ' + JSON.stringify(result));
    assert(result.deviceStayedAttached, 'device hand/holster attachment through portal in chamber ' + stage + ': ' + JSON.stringify(result));
    assert(result.carryDevice.state === (stage === 0 ? 'held' : 'holstered'), 'carry must holster the device in chamber ' + stage);
    assert(result.opened && result.doorProgress > .95, 'pressure pad/door in chamber ' + stage);
    assert(stage === 2 ? result.state === 'won' : result.nextStage === stage + 1, 'chamber progression ' + stage);
    report.chambers.push(result);
  }
  report.gameplayPassed = true;
  console.log('All three chambers passed:', JSON.stringify(report.chambers));

  const saveCanvas = async (name, setup) => {
    if (setup) await page.evaluate(setup);
    const png = await page.evaluate(() => {
      const g = window.__NESI_DEMO_GAME__;
      g.render();
      return g.renderer.domElement.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(path.join(out, name), Buffer.from(png, 'base64'));
  };
  await saveCanvas('lab-third-person.png', () => {
    const g = window.__NESI_DEMO_GAME__;
    g.resetRun(true); g.showHint(); g.playerPosition.set(0, 0, 16);
    for (let i = 0; i < 35; i++) g.updatePlaying(1 / 60);
    g.cameraRig.reset(g.playerPosition, -.25, -.19); g.yaw = -.25; g.pitch = -.19;
    g.updateVisuals(1 / 60);
  });

  await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__;
    window.__LAB_CLOSE_CAMERA__ = () => {
      // Front-right three-quarter view: ~300 px character height at 800x600.
      g.camera.position.set(-2.1, 1.85, 12);
      g.camera.lookAt(0, 1.28, 16); g.camera.updateMatrixWorld(true);
    };
    window.__LAB_REEL_RESET__ = () => {
      g.resetRun(true); g.portals.clear();
      g.playerPosition.set(0, 0, 16); g.playerGroup.position.copy(g.playerPosition);
      g.facing = Math.PI; g.playerGroup.rotation.y = g.facing;
      g.playerVelocity.set(0, 0, 0); g.playerGrounded = true;
      g.cubes.forEach(c => { c.group.visible = false; });
      g.updateVisuals(0);
      g.cubes.forEach(c => { c.group.visible = false; });
      g.renderer.setPixelRatio(1); g.renderer.setSize(800, 600);
      g.camera.aspect = 800 / 600; g.camera.updateProjectionMatrix();
      for (let i = 0; i < 40; i++) {
        g.animator.update({ dt: 1 / 60, weapon: true, elapsed: i / 60 });
        g.heldDevice.update({ dt: 1 / 60, carrying: false });
      }
      window.__LAB_CLOSE_CAMERA__();
    };
    window.__LAB_REEL_RESET__();
  });
  await saveCanvas('weapon-grip.png', () => {
    const g = window.__NESI_DEMO_GAME__;
    for (let i = 0; i < 50; i++) {
      g.animator.update({ dt: 1 / 60, weapon: true, aiming: true, aimPitch: -.08, elapsed: i / 60 });
      g.heldDevice.update({ dt: 1 / 60, carrying: false });
    }
    window.__LAB_CLOSE_CAMERA__();
  });
  await saveCanvas('carry-pose.png', () => {
    const g = window.__NESI_DEMO_GAME__;
    g.cubes[0].group.visible = true; g.cubes[0].group.position.set(0, .64, 14.65);
    g.toggleCube();
    for (let i = 0; i < 55; i++) {
      g.animator.update({ dt: 1 / 60, weapon: true, carrying: true, elapsed: i / 60 });
      g.heldDevice.update({ dt: 1 / 60, carrying: true }); g.updateCubes(1 / 60);
    }
    window.__LAB_CLOSE_CAMERA__();
  });
  report.stills = ['lab-third-person.png', 'weapon-grip.png', 'carry-pose.png'];
  console.log('Captured gameplay, close hand grip and carry pose.');

  // Deterministic production-rig reel. Only the camera and inputs are staged;
  // the source mesh, device, carry object, lighting and shadows render in WebGL.
  // The optional 2D composite adds labels over that untouched rendered frame.
  if (process.env.RECORD_VIDEO === '1') {
    const frames = path.join(out, 'animation-frames'); fs.mkdirSync(frames, { recursive: true });
    await page.evaluate(() => {
      window.__LAB_REEL_RESET__();
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      window.__LAB_REEL_CANVAS__ = canvas;
      window.__LAB_REEL_STATES__ = new Set();
    });
    const frameCount = 240, fps = 30;
    for (let frame = 0; frame < frameCount; frame++) {
      const png = await page.evaluate(({ frame, fps }) => {
        const g = window.__NESI_DEMO_GAME__;
        const t = frame / fps;
        const airborne = t >= 3.9 && t < 4.6;
        const aiming = t >= 2.65 && t < 3.9;
        const strafe = t >= 2.65 && t < 3.2;
        const backward = t >= 3.2 && t < 3.45;
        let speed = t >= .65 && t < 1.45 ? 2.8 : t >= 1.45 && t < 2.2 ? 6.6
          : strafe || backward ? 2.8 : t >= 5.55 && t < 6.65 ? 3.3 : 0;
        const label = t < .65 ? 'READY / RIGHT-HAND GRIP' : t < 1.45 ? 'START / WALK'
          : t < 2.2 ? 'RUN' : t < 2.65 ? 'STOP / SETTLE' : t < 3.2 ? 'AIM / STRAFE'
            : t < 3.45 ? 'AIM / BACKSTEP' : t < 3.9 ? 'PORTAL SHOT / RECOIL'
              : t < 4.6 ? 'JUMP / FALL' : t < 5.1 ? 'LAND / RECOVER'
                : t < 5.55 ? 'PICK UP / HOLSTER' : t < 6.65 ? 'CARRY / WALK'
                  : t < 7.1 ? 'CARRY / STOP' : t < 7.55 ? 'PLACE / REGRIP' : 'READY';
        if (frame === 104 || frame === 111) {
          g.animator.triggerShot(); g.heldDevice.fire(frame === 104 ? 0 : 1);
        }
        if (frame === 153) {
          g.cubes[0].group.visible = true; g.cubes[0].group.position.set(0, .64, 14.65);
          g.toggleCube();
        }
        if (frame === 213) g.toggleCube();
        g.playerPosition.y = airborne ? Math.sin((t - 3.9) / .7 * Math.PI) * .65 : 0;
        g.playerGroup.position.copy(g.playerPosition);
        g.playerVelocity.set(0, airborne ? Math.cos((t - 3.9) / .7 * Math.PI) * 6 : 0, 0);
        for (let j = 0; j < 2; j++) {
          g.animator.update({ dt: 1 / 60, speed, velocity: g.playerVelocity, grounded: !airborne,
            weapon: true, carrying: Boolean(g.heldCube), aiming, aimPitch: -.08,
            moveForward: backward ? -1 : strafe ? 0 : 1, moveRight: strafe ? (t < 2.95 ? 1 : -1) : 0,
            elapsed: t + j / 60 });
          g.heldDevice.update({ dt: 1 / 60, carrying: Boolean(g.heldCube) });
          g.updateCubes(1 / 60);
        }
        window.__LAB_REEL_STATES__.add(g.animator.diagnostics.state);
        window.__LAB_CLOSE_CAMERA__(); g.render();
        const canvas = window.__LAB_REEL_CANVAS__, ctx = canvas.getContext('2d');
        ctx.drawImage(g.renderer.domElement, 0, 0);
        ctx.fillStyle = 'rgba(10, 21, 30, .84)'; ctx.fillRect(20, 20, 760, 62);
        ctx.fillStyle = '#76e5ff'; ctx.font = 'bold 15px sans-serif'; ctx.fillText('NESI / PLAYER MOTION', 36, 44);
        ctx.fillStyle = '#f0f7fa'; ctx.font = '14px sans-serif'; ctx.fillText(label, 36, 65);
        ctx.fillStyle = '#b5c6ce'; ctx.textAlign = 'right'; ctx.fillText(t.toFixed(2) + ' / 8.00 s', 764, 54); ctx.textAlign = 'left';
        return canvas.toDataURL('image/png').split(',')[1];
      }, { frame, fps });
      fs.writeFileSync(path.join(frames, String(frame).padStart(4, '0') + '.png'), Buffer.from(png, 'base64'));
      if (frame % fps === 0) console.log('Recorded animation frame', frame, '/', frameCount);
    }
    const encoded = spawnSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', path.join(frames, '%04d.png'), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'player-animation.mp4')], { encoding: 'utf8' });
    if (encoded.status !== 0) fs.renameSync(frames, path.join(out, 'recording-fallback'));
    assert(encoded.status === 0, 'ffmpeg encoding failed: ' + (encoded.error?.message || encoded.stderr));
    report.video = { frames: frameCount, fps, duration: frameCount / fps, width: 800, height: 600,
      states: await page.evaluate(() => [...window.__LAB_REEL_STATES__]) };
  }
  assert(report.errors.length === 0, 'page errors: ' + report.errors.join('\n'));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error.stack || error);
  if (page) { try { report.failureState = await page.evaluate(() => window.__NESI_DEMO_GAME__?.diagnostics?.() ?? { error: window.__NESI_DEMO_ERROR__ }); } catch {} }
  throw error;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
