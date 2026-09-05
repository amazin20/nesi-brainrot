// CI-only browser harness. The interactive evidence tools live in the app, so
// reviewers can run the same production checks through visible buttons.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const out = path.resolve(process.env.EVIDENCE_DIR || 'smoke-artifacts');
fs.mkdirSync(out, { recursive: true });
const recording = process.env.RECORD_VIDEO === '1';
const recordOnly = process.env.EVIDENCE_PHASE === 'record';
const reportPath = path.join(out, recordOnly ? 'recording-report.json' : 'report.json');
const frameDirectory = path.join(out, 'animation-frames');
let savedFrames = 0;
const hashes = new Set();
if (recording && spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('ffmpeg is required for recording');
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH, headless: true, protocolTimeout: 360000,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const report = { phase: recordOnly ? 'record' : recording ? 'verify-and-record' : 'verify', errors: [] };
const encodeFrames = (count, filename) => spawnSync('ffmpeg', ['-y', '-framerate', '60', '-i', path.join(frameDirectory, '%04d.png'), '-frames:v', String(count), '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, filename)], { encoding: 'utf8' });
let page;
const assert = (ok, message) => { if (!ok) throw new Error(message); };
try {
  page = await browser.newPage();
  await page.setViewport({ width: 960, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(String(error.stack || error)));
  const target = new URL(process.env.DEMO_URL || 'http://127.0.0.1:4173/');
  target.searchParams.set('smoke', '1'); target.searchParams.set('evidence', '1');
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#evidence-check', { timeout: 180000 });
  await page.waitForFunction(() => ['playing', 'error'].includes(document.documentElement.dataset.runtimeState), { timeout: 180000 });
  const runtimeError = await page.$eval('html', el => el.dataset.runtimeState === 'error');
  assert(!runtimeError, 'Game failed before evidence tools became ready');
  if (!recordOnly) {
    await page.click('#evidence-check');
    await page.waitForFunction(() => ['pass', 'fail', 'error'].includes(document.querySelector('#lab-evidence')?.dataset.status), { timeout: 300000 });
    report.checks = JSON.parse(await page.$eval('#evidence-report', el => el.textContent));
    assert(report.checks.pass, JSON.stringify(report.checks.errors));
    report.gameplayPassed = true;
    console.log('Native production checks passed: source models, jump, shot camera, hand contact, portal carry, fixed door frame and complete first-level journey with bridge and live weight circuits.');

    report.stills = [];
    for (const [pose, name] of [['idle', 'lab-third-person.png'], ['run', 'run-pose.png'], ['jump', 'jump-pose.png'], ['table', 'table-jump.png'], ['carry', 'carry-pose.png'], ['happy', 'happy-pose.png'], ['portals', 'portal-view.png'], ['door-closed', 'door-closed.png'], ['door-open', 'door-open.png'], ['barrier-closed', 'barrier-closed.png'], ['barrier-open', 'barrier-open.png'], ['bridge-loaded', 'first-level-bridge-loaded.png'], ['receiver-panel', 'first-level-receiver-panel.png'], ['pad-surface', 'first-level-pad-portal.png'], ['launch-pad', 'first-level-launch-pad.png']]) {
      await page.click('#evidence-' + pose);
      await page.waitForFunction(p => document.querySelector('#lab-evidence')?.dataset.pose === p, {}, pose);
      const data = await page.$eval('#evidence-preview', image => image.src.split(',')[1]);
      fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64')); report.stills.push(name);
    }

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }

  if (recording) {
    fs.rmSync(frameDirectory, { recursive: true, force: true }); fs.mkdirSync(frameDirectory, { recursive: true });
    const setup = await page.evaluate(() => window.__LAB_EVIDENCE_CAPTURE__.begin());
    assert(setup.frames === 600 && setup.fps === 60 && setup.width === 960 && setup.height === 720, 'Expected exact 600-frame production export');
    const started = Date.now();
    for (let frame = 0; frame < setup.frames; frame++) {
      // Each protocol request renders one frame, then returns. Keep all completed
      // PNGs on disk instead of losing the whole reel if a later frame fails.
      const result = await page.evaluate(() => window.__LAB_EVIDENCE_CAPTURE__.next());
      assert(result.index === frame && result.animationUpdates === frame + 1 && result.physicsSteps === (frame + 1) * 2, 'Frame sequence or production step count changed');
      const bytes = Buffer.from(result.png, 'base64'), filename = path.join(frameDirectory, String(frame).padStart(4, '0') + '.png');
      fs.writeFileSync(filename + '.tmp', bytes); fs.renameSync(filename + '.tmp', filename);
      hashes.add(createHash('sha256').update(bytes).digest('hex')); savedFrames++;
      if (frame % 10 === 0 || savedFrames === setup.frames) {
        report.partialVideo = { savedFrames, fps: 60, duration: savedFrames / 60, uniqueFrameHashes: hashes.size,
          elapsedSeconds: (Date.now() - started) / 1000, frameMilliseconds: result.frameMilliseconds,
          drawCalls: result.drawCalls, triangles: result.triangles, shotsFired: result.shotsFired };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log('Saved animation frame', savedFrames, '/', setup.frames, JSON.stringify(report.partialVideo));
      }
    }
    report.video = { ...await page.evaluate(() => window.__LAB_EVIDENCE_CAPTURE__.finish()), uniqueFrameHashes: hashes.size };
    const encoded = encodeFrames(savedFrames, 'player-animation.mp4');
    assert(encoded.status === 0, 'ffmpeg encoding failed: ' + (encoded.error?.message || encoded.stderr));
    assert(report.video.animationUpdates === 600 && report.video.physicsSteps === 1200, 'Every frame must advance production animation and 120 Hz physics');
  }
  assert(report.errors.length === 0, 'Page errors: ' + report.errors.join('\n'));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error.stack || error);
  if (recording && savedFrames > 0) {
    const encoded = encodeFrames(savedFrames, 'player-animation-partial.mp4');
    report.partialVideo = { ...report.partialVideo, savedFrames, duration: savedFrames / 60, uniqueFrameHashes: hashes.size,
      playableFile: encoded.status === 0 ? 'player-animation-partial.mp4' : null };
    if (encoded.status !== 0) report.partialEncodingError = encoded.error?.message || encoded.stderr;
  }
  if (page) {
    try { report.failureState = await page.$eval('#evidence-report', el => el.textContent); } catch {}
    try { await page.screenshot({ path: path.join(out, 'failure.png') }); } catch {}
  }
  throw error;
} finally {
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await browser.close();
}
