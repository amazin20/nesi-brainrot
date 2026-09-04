import * as THREE from 'three';

const DT = 1 / 120;
const FPS = 60;
const FRAME_COUNT = 600;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const yieldFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const cloneJSON = value => JSON.parse(JSON.stringify(value));

/** Query-only production test driver. Fixtures are explicit; a route never replaces cargo. */
export function createEvidenceDriver(game) {
  const key = (code, down = true) => down ? game.input.keys.add(code) : game.input.keys.delete(code);
  const step = seconds => {
    const ticks = Math.round(seconds / DT);
    for (let tick = 0; tick < ticks; tick++) {
      game.updatePlaying(DT);
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
      const dx = x - game.playerPosition.x, dz = z - game.playerPosition.z;
      if (Math.hypot(dx, dz) < .15) { reached = true; break; }
      game.yaw = Math.atan2(-dx, -dz); key('KeyW'); step(1 / FPS);
    }
    key('KeyW', false); step(.4);
    assert(reached, `Route blocked toward ${x},${z}; player=${game.playerPosition.toArray()}; cargo=${game.cargo.position.toArray()}`);
  };
  const aimPanel = (index, stage, side = index, offset = new THREE.Vector3()) => {
    const panel = game.portalPanels.filter(p => p.userData.stage === stage)[side];
    assert(panel, `Missing panel ${stage}/${side}`);
    game.camera.position.copy(game.playerPosition).add(new THREE.Vector3(0, 1.65, 0));
    game.camera.lookAt(panel.userData.center.clone().add(offset)); game.camera.updateMatrixWorld(true);
    assert(game.placePortal(index), `Ray-aimed portal ${stage}/${index} was rejected`);
    return panel;
  };
  const reset = () => { game.resetRun(true); game.renderer.setAnimationLoop(null); step(.7); };
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

export function createReel(game, driver) {
  driver.reset(); driver.fixturePlayer(0, 0, 17);
  game.physics.resetCargo({ position: [0, .43, 15.9] }); driver.step(.8);
  const frameStep = createEvidenceFrameStepper(game);
  let previousTime = -1;
  const at = (time, event) => { if (previousTime < time && currentTime >= time) event(); };
  let currentTime = 0;
  return {
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
      at(4.45, () => game.placePortal(0));
      at(4.85, () => game.placePortal(1));
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
    const cargo = g.cargo, body = g.physics.cargoBody, resetCargo = g.physics.resetCargo;
    const identity = cargo.group.uuid;
    const routeLog = [];
    g.physics.resetCargo = () => { throw new Error('Cargo reset during continuous journey'); };
    const mark = name => {
      if (g.cargo !== cargo || g.physics.cargoBody !== body || g.cubes.length !== 1 || !cargo.group.visible) throw new Error('Cargo identity/visibility changed');
      routeLog.push({ name, player: g.playerPosition.toArray(), cargo: cargo.position.toArray(), held: Boolean(g.heldCube), stage: g.stage,
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
      return { identity, bodyId: body.id, cargoResets: 0, completed: true, state: g.state, milestones: routeLog };
    } finally { g.physics.resetCargo = resetCargo; }
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

async function runChecks(game, driver, progress) {
  const report = { pass: false, checks: {}, errors: [], created: new Date().toISOString() };
  const check = async (name, test) => {
    progress(`Проверка: ${name}`); await yieldFrame();
    try { report.checks[name] = { pass: true, detail: cloneJSON(await test()) }; }
    catch (error) { report.checks[name] = { pass: false, error: String(error.stack || error) }; report.errors.push(`${name}: ${error.message}`); }
  };
  await check('source-models', () => {
    const d = game.diagnostics();
    assert(d.modelsLoaded === 19 && d.missingModels.length === 0, 'All 19 source-backed models must load');
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
  await check('stationary-shot-camera', () => {
    driver.reset(); driver.fixturePlayer(-6.5, 0, 15, Math.PI * 1.5); game.pitch = 0; driver.step(2);
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
    driver.reset(); driver.fixturePlayer(0, 0, 17);
    game.physics.resetCargo({ position: [0, .43, 15.9] }); driver.step(.2); driver.pressE(); driver.step(1.8);
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
    driver.reset(); driver.fixturePlayer(-9.7, 0, 15);
    driver.aimPanel(0, 0); driver.aimPanel(1, 0); driver.step(1);
    driver.fixturePlayer(-10.05, 0, 15, -Math.PI / 2);
    game.physics.resetCargo({ position: [-10.72, .43, 15] }); driver.step(.1); driver.pressE(); driver.step(1.1);
    assert(game.heldCube === game.cargo, 'Portal fixture pickup failed');
    const cargo = game.cargo, body = game.physics.cargoBody, before = game.teleportCount;
    game.yaw = 0; driver.key('KeyA');
    for (let i = 0; i < 150 && game.teleportCount === before; i++) driver.step(1 / FPS);
    driver.key('KeyA', false); driver.step(.35);
    assert(game.teleportCount === before + 1 && game.heldCube === cargo && game.physics.cargoBody === body, 'Portal failed to carry the same physical companion');
    assert(game.playerPosition.distanceTo(cargo.position) < 2, 'Companion separated at portal exit');
    return { teleports: game.teleportCount - before, identity: cargo.group.uuid, bodyId: body.id, distance: game.playerPosition.distanceTo(cargo.position), carry: game.animator.diagnostics.carryReach };
  });
  await check('portal-images-every-frame', () => {
    driver.reset(); driver.fixturePlayer(-9.7, 0, 15); driver.aimPanel(0, 0); driver.aimPanel(1, 0); driver.step(.5);
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
    door.opened = true; driver.step(2.2);
    const afterBox = new THREE.Box3().setFromObject(door.art);
    assert(door.art.position.distanceTo(before) < 1e-6, 'Entire door frame still moves instead of opening');
    assert(door.progress > .95, 'Door opening did not complete');
    return { progress: door.progress, rootTravel: door.art.position.distanceTo(before), before: [beforeBox.min.toArray(), beforeBox.max.toArray()], after: [afterBox.min.toArray(), afterBox.max.toArray()] };
  });
  await check('barrier-frame-fixed', () => {
    driver.reset(); const barrier = game.mechanisms.barrier, before = barrier.art.position.clone();
    barrier.opened = true; driver.step(2.2);
    assert(barrier.art.position.distanceTo(before) < 1e-6 && barrier.progress > .95, 'Energy barrier posts must stay fixed while the field fades');
    assert(barrier.collider.enabled === false, 'An opened energy field must allow movement');
    return { rootTravel: barrier.art.position.distanceTo(before), progress: barrier.progress, collision: barrier.collider.enabled };
  });
  await check('continuous-three-room-journey', () => runContinuousJourney(game, driver));
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
  const stop = () => { cancelAnimationFrame(state.raf); state.playing = false; game.renderer.setAnimationLoop(null); game.input.keys.clear(); };
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
    stop(); prepareReview(); driver.reset(); driver.fixturePlayer(0, 0, 17);
    game.physics.resetCargo({ position: [0, .43, 15.9] }); driver.step(.4);
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
    stop(); prepareReview(); driver.reset(); driver.fixturePlayer(-9.7, 0, 15);
    driver.aimPanel(0, 0); driver.aimPanel(1, 0); driver.step(.8);
    const entry = game.portals.portals[0];
    game.camera.position.copy(entry.position).addScaledVector(entry.normal, 5); game.camera.lookAt(entry.position); game.camera.updateMatrixWorld(true); render();
    const preview = panel.querySelector('#evidence-preview'); preview.src = game.renderer.domElement.toDataURL('image/png'); preview.style.display = 'block';
    panel.dataset.pose = 'portals'; say('Вид через действующую пару порталов.');
  });
  const mechanismPose = (kind, opened) => {
    stop(); prepareReview(); driver.reset();
    const mechanism = kind === 'door' ? game.doors[0] : game.mechanisms.barrier;
    mechanism.opened = opened; driver.step(2.3);
    const z = kind === 'door' ? game.doors[0].z : game.mechanisms.barrier.mesh.position.z;
    game.camera.position.set(0, 2.5, z + 7.2); game.camera.lookAt(0, 2.5, z); game.camera.updateMatrixWorld(true); render();
    const preview = panel.querySelector('#evidence-preview'); preview.src = game.renderer.domElement.toDataURL('image/png'); preview.style.display = 'block';
    panel.dataset.pose = `${kind}-${opened ? 'open' : 'closed'}`; say(`${kind === 'door' ? 'Дверь' : 'Барьер'}: ${opened ? 'открыто' : 'закрыто'}`);
  };
  button('Дверь закрыта', 'evidence-door-closed', () => mechanismPose('door', false));
  button('Дверь открыта', 'evidence-door-open', () => mechanismPose('door', true));
  button('Барьер', 'evidence-barrier-closed', () => mechanismPose('barrier', false));
  button('Барьер открыт', 'evidence-barrier-open', () => mechanismPose('barrier', true));
  button('Проверки', 'evidence-check', async () => {
    stop(); prepareReview(); state.busy = true; panel.dataset.status = 'checking';
    const report = await runChecks(game, driver, say); state.report = report; reportEl.textContent = JSON.stringify(report, null, 2);
    state.busy = false; panel.dataset.status = report.pass ? 'pass' : 'fail';
    say(report.pass ? 'Все проверки пройдены.' : `${report.errors.length} проверок требуют исправления.`);
    download(new Blob([reportEl.textContent], { type: 'application/json' }), 'lab-evidence-v4.json'); render();
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
        animationUpdates: game.animationFrames - before.animation, physicsSteps: game.physics.steps - before.physics, states: [...states], encodingSeconds: (performance.now() - started) / 1000,
        realtimeBenchmark: false };
      assert(report.animationUpdates === FRAME_COUNT && report.physicsSteps === FRAME_COUNT * 2, 'Production step count mismatch');
      entries.push({ name: 'report.json', blob: new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }) });
      say('Собираю архив с кадрами…'); const zip = await makeStoredZip(entries);
      download(zip, 'nesi-animation-v4-60fps-frames.zip', 'Скачать 600 кадров · 60 FPS');
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
      download(new Blob(chunks, { type: mimeType }), 'nesi-animation-v4-realtime.webm', 'Скачать видео WebM');
      reportEl.textContent = JSON.stringify({ kind: 'realtime-production-showcase', frames, duration: elapsed, actualAverageFPS: frames / elapsed, simulatedDuration: simulation, requestedFrameDuplication: false }, null, 2);
      panel.dataset.status = 'video-ready'; say(`Видео готово. Фактическая частота записи: ${(frames / elapsed).toFixed(1)} кадров/с.`);
    } finally {
      if (recorder?.state === 'recording') recorder.stop();
      stream?.getTracks().forEach(track => track.stop()); restore(); state.busy = false;
    }
  });
  button('Скриншот', 'evidence-screenshot', async () => {
    render(); const blob = await new Promise(resolve => game.renderer.domElement.toBlob(resolve, 'image/png'));
    assert(blob, 'Screenshot encoder returned no data'); download(blob, `nesi-v4-${panel.dataset.pose || 'level'}.png`);
  });
  button('Играть', 'evidence-play', () => {
    stop(); prepareReview(); game.input.keys.clear(); game.lastFrame = performance.now(); game.state = 'playing'; game.renderer.setAnimationLoop(game.animate); say('Игровой режим.');
  });
  button('Остановить', 'evidence-stop', () => { stop(); render(); say('Кадр остановлен.'); });
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  panel.addEventListener('mousedown', event => event.stopPropagation());
  return { driver, panel, stop, dispose: () => { stop(); state.urls.forEach(url => URL.revokeObjectURL(url)); panel.remove(); } };
}
