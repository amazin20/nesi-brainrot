// CI-only browser harness. The interactive evidence tools live in the app, so
// reviewers can run the same production checks through visible buttons.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const out = path.resolve(process.env.EVIDENCE_DIR || 'smoke-artifacts');
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
  await page.setViewport({ width: 960, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(String(error.stack || error)));
  const target = new URL(process.env.DEMO_URL || 'http://127.0.0.1:4173/nesi-brainrot/');
  target.searchParams.set('smoke', '1'); target.searchParams.set('evidence', '1');
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#evidence-check', { timeout: 180000 });
  await page.waitForFunction(() => ['playing', 'error'].includes(document.documentElement.dataset.runtimeState), { timeout: 180000 });
  const runtimeError = await page.$eval('html', el => el.dataset.runtimeState === 'error');
  assert(!runtimeError, 'Game failed before evidence tools became ready');
  await page.click('#evidence-check');
  await page.waitForFunction(() => ['pass', 'fail', 'error'].includes(document.querySelector('#lab-evidence')?.dataset.status), { timeout: 300000 });
  report.checks = JSON.parse(await page.$eval('#evidence-report', el => el.textContent));
  assert(report.checks.pass, JSON.stringify(report.checks.errors));
  report.gameplayPassed = true;
  console.log('Native production checks passed: source models, jump, shot camera, hand contact, portal carry, fixed door frame and complete three-room journey.');

  report.stills = [];
  for (const [pose, name] of [['idle', 'lab-third-person.png'], ['run', 'run-pose.png'], ['jump', 'jump-pose.png'], ['table', 'table-jump.png'], ['carry', 'carry-pose.png'], ['happy', 'happy-pose.png']]) {
    await page.click('#evidence-' + pose);
    await page.waitForFunction(p => document.querySelector('#lab-evidence')?.dataset.pose === p, {}, pose);
    const data = await page.$eval('#evidence-preview', image => image.src.split(',')[1]);
    fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64')); report.stills.push(name);
  }

  if (recording) {
    const zip = path.join(out, 'nesi-animation-v4-60fps-frames.zip');
    const frames = path.join(out, 'animation-frames');
    fs.rmSync(zip, { force: true }); fs.rmSync(zip + '.crdownload', { force: true });
    fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
    await page.click('#evidence-frames');
    await page.waitForFunction(() => ['frames-ready', 'error'].includes(document.querySelector('#lab-evidence')?.dataset.status), { timeout: 2700000, polling: 2000 });
    assert(await page.$eval('#lab-evidence', el => el.dataset.status === 'frames-ready'), await page.$eval('#evidence-status', el => el.textContent));
    report.video = JSON.parse(await page.$eval('#evidence-report', el => el.textContent));
    await page.click('a[download="nesi-animation-v4-60fps-frames.zip"]');
    for (let i = 0; i < 240 && !fs.existsSync(zip); i++) await new Promise(resolve => setTimeout(resolve, 250));
    assert(fs.existsSync(zip), 'Browser frame download did not finish');
    const extracted = spawnSync('unzip', ['-q', zip, '-d', frames], { encoding: 'utf8' });
    assert(extracted.status === 0, 'Cannot extract browser-generated frames: ' + extracted.stderr);
    const encoded = spawnSync('ffmpeg', ['-y', '-framerate', '60', '-i', path.join(frames, '%04d.png'), '-frames:v', '600', '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(out, 'player-animation.mp4')], { encoding: 'utf8' });
    assert(encoded.status === 0, 'ffmpeg encoding failed: ' + (encoded.error?.message || encoded.stderr));
    assert(report.video.animationUpdates === 600 && report.video.physicsSteps === 1200, 'Every frame must advance production animation and 120 Hz physics');
    fs.rmSync(zip);
  }
  assert(report.errors.length === 0, 'Page errors: ' + report.errors.join('\n'));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error.stack || error);
  if (page) {
    try { report.failureState = await page.$eval('#evidence-report', el => el.textContent); } catch {}
    try { await page.screenshot({ path: path.join(out, 'failure.png') }); } catch {}
  }
  throw error;
} finally {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
