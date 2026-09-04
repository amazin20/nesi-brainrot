import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const out = process.env.EVIDENCE_DIR || 'smoke-artifacts';
fs.mkdirSync(out, { recursive: true });
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
  await page.evaluate(() => window.__NESI_DEMO_GAME__.renderer.setAnimationLoop(null));
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

  report.shooting = await page.evaluate(() => {
    const g = window.__NESI_DEMO_GAME__;
    const panels = g.portalPanels.filter(p => p.userData.stage === 0);
    g.camera.position.set(0, 2, 15);
    const results = panels.map((panel, i) => {
      g.camera.lookAt(panel.userData.center); g.camera.updateMatrixWorld(true);
      return g.placePortal(i);
    });
    return { results, paired: g.portals.ready };
  });
  assert(report.shooting.results.every(Boolean) && report.shooting.paired, 'ray-aimed portal placement');

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
      const key = entry.normal.x > 0 ? 'KeyA' : 'KeyD';
      dispatchEvent(new KeyboardEvent('keydown', { code: key }));
      step(70);
      dispatchEvent(new KeyboardEvent('keyup', { code: key }));
      const traversed = g.teleportCount > before;
      const carriedThrough = stage === 0 || g.heldCube === g.cubes[stage] && g.cubes[stage].group.position.distanceTo(g.playerPosition) < 2.2;
      const playerZ = g.playerPosition.z;
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
      return { traversed, carriedThrough, playerZ, opened, doorProgress, nextStage: g.stage, state: g.state };
    }, stage);
    assert(result.traversed && result.carriedThrough, 'portal/cargo traversal in chamber ' + stage + ': ' + JSON.stringify(result));
    assert(result.opened && result.doorProgress > .95, 'pressure pad/door in chamber ' + stage);
    assert(stage === 2 ? result.state === 'won' : result.nextStage === stage + 1, 'chamber progression ' + stage);
    report.chambers.push(result);
  }

  const capture = async (name, setup) => {
    if (setup) await page.evaluate(setup);
    const png = await page.evaluate(() => {
      const g = window.__NESI_DEMO_GAME__;
      g.updateVisuals(1 / 60); g.render();
      return g.renderer.domElement.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(path.join(out, name), Buffer.from(png, 'base64'));
  };
  await capture('lab-third-person.png', () => {
    const g = window.__NESI_DEMO_GAME__;
    g.resetRun(true); g.showHint(); g.playerPosition.set(0, 0, 16);
    g.playerGroup.position.copy(g.playerPosition);
    g.cameraRig.reset(g.playerPosition, -.25, -.19); g.yaw = -.25; g.pitch = -.19;
  });

  // A deterministic in-engine animation reel. Frames come from the production
  // character/lighting; renderer timing never changes the animation cadence.
  if (process.env.RECORD_VIDEO === '1') {
    const frames = path.join(out, 'animation-frames'); fs.mkdirSync(frames, { recursive: true });
    await page.setViewport({ width: 640, height: 480, deviceScaleFactor: 1 });
    await page.evaluate(() => {
      const g = window.__NESI_DEMO_GAME__;
      g.resetRun(true); g.portals.clear();
      g.playerPosition.set(0, 0, 16); g.playerGroup.position.copy(g.playerPosition); g.playerGroup.rotation.y = -.55;
      g.cubes.forEach(c => { c.group.visible = false; });
      g.camera.position.set(3.4, 2, 20.3); g.camera.lookAt(0, 1.2, 16); g.camera.updateMatrixWorld(true);
      // Keep the character, level, material and shadows; only stop camera follow.
    });
    const frameCount = 180, fps = 30;
    for (let frame = 0; frame < frameCount; frame++) {
      const png = await page.evaluate(({ frame, fps }) => {
        const g = window.__NESI_DEMO_GAME__;
        const t = frame / fps;
        const speed = t < 1 ? 0 : t < 3 ? 3.8 : t < 4 ? 5.8 : 2.4;
        const airborne = t >= 3.2 && t < 4;
        const carrying = t >= 4;
        for (let j = 0; j < 2; j++) g.animator.update({ dt: 1 / 60, speed, velocity: { y: airborne ? 4 - (t - 3.2) * 10 : 0 }, grounded: !airborne, carrying, elapsed: t + j / 60 });
        g.playerGroup.position.y = airborne ? Math.max(0, Math.sin((t - 3.2) / .8 * Math.PI)) * .55 : 0;
        g.renderer.render(g.scene, g.camera);
        return g.renderer.domElement.toDataURL('image/png').split(',')[1];
      }, { frame, fps });
      fs.writeFileSync(path.join(frames, String(frame).padStart(4, '0') + '.png'), Buffer.from(png, 'base64'));
    }
    const encoded = spawnSync('ffmpeg', ['-y', '-framerate', String(fps), '-i', path.join(frames, '%04d.png'), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'player-animation.mp4')], { encoding: 'utf8' });
    assert(encoded.status === 0, 'ffmpeg encoding failed: ' + encoded.stderr);
    report.video = { frames: frameCount, fps, duration: frameCount / fps };
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
