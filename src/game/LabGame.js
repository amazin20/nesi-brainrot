import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { InputController } from './InputController.js';
import { AudioController } from './AudioController.js';
import { LabCamera } from './LabCamera.js';
import { LabPlayerAnimator } from './LabPlayerAnimator.js';
import { LabHeldDevice } from './LabHeldDevice.js';
import { LabPortals } from './LabPortals.js';
import { LabPhysics } from './LabPhysics.js';
import { buildLabArchitecture } from './LabLevel.js';
import { LabCompanionAnimator } from './LabCompanionAnimator.js';
import { LAB_ASSETS } from './labAssets.js';

const UP = new THREE.Vector3(0, 1, 0);
const PLAYER_HEIGHT = 2.4;
const PLAYER_RADIUS = 0.43;
const CENTER_HEIGHT = PLAYER_HEIGHT / 2;
const CUBE_RADIUS = 0.39;
const FIXED_STEP = 1 / 120;
const CARGO_START = [4.6, 0.6, 15.2];
const CORE_ASSETS = [
  { id: 1, file: 'model-01-player.glb', label: 'Персонаж' },
  { id: 2, file: 'model-02-cargo.glb', label: 'Брейнрот' },
  { id: 11, file: 'model-11-portal-gun.glb', label: 'Устройство переходов' },
];
export const CHAMBERS = [
  { name: '01 / МОСТ ДЛЯ ДВОИХ', start: [0, 0, 18], end: -3, button: [4.6, 0, 0], cube: CARGO_START, panels: [[-11.65, 1.6, 15, 1], [-11.65, 1.6, 1, 1]], objective: 'Доберитесь до следующей комнаты вместе.' },
  { name: '02 / ВЫШЕ НОС', start: [0, 0, -6], end: -26, button: [-5, 2.2, -23], cube: CARGO_START, panels: [[11.65, 1.6, -9, -1], [11.65, 1.6, -21, -1]], objective: 'Проведите брейнрота через мастерскую подъёмника.' },
  { name: '03 / НИКОГО НЕ ЗАБЫТЬ', start: [0, 0, -29], end: -47, button: [0, 0, -44], cube: CARGO_START, panels: [[-11.65, 1.6, -30, 1], [11.65, 1.6, -43, -1]], objective: 'Выход рядом. Доберитесь до него вдвоём.' },
];

export class LabGame {
  constructor({ container, touch, onProgress = () => {}, onReady = () => {}, onHud = () => {}, onToast = () => {}, onPause = () => {}, onWin = () => {} }) {
    this.container = container; this.touch = touch;
    this.callbacks = { onProgress, onReady, onHud, onToast, onPause, onWin };
    this.assets = new Map(); this.failures = [];
    this.colliders = []; this.cameraBlockers = []; this.aimBlockers = []; this.portalPanels = [];
    this.floors = []; this.sectorProps = [[], [], []]; this.cubes = []; this.doors = [];
    this.state = 'loading'; this.elapsed = 0; this.stage = 0; this.thirdPerson = true;
    this.playerPosition = new THREE.Vector3(); this.playerVelocity = new THREE.Vector3();
    this.previousPlayerPosition = new THREE.Vector3(); this.previousFacing = Math.PI;
    this.renderFrames = 0; this.animationFrames = 0; this.jumpBuffer = 0; this.coyoteTime = 0;
    this.playerGrounded = true; this.yaw = 0; this.pitch = -0.15; this.facing = Math.PI;
    this.portalCooldown = 0; this.heldCube = null; this.interactQueued = false;
    this.accumulator = 0; this.lastFrame = 0; this.hudTimer = 0; this.visualTime = 0;
    this.raycaster = new THREE.Raycaster(); this.cameraForward = new THREE.Vector3(0, 0, -1);
    this.portalSurfaceIds = [null, null]; this.lastLanding = 0; this.teleportCount = 0;
    this.animate = this.animate.bind(this);
  }

  async init() {
    this.createScene();
    this.input = new InputController(this.touch); this.audio = new AudioController();
    this.setupControls();
    await this.loadAssets();
    this.buildLevel();
    this.state = 'ready'; this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(this.animate);
    this.callbacks.onReady(); this.emitHud();
  }

  createScene() {
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0xaac9d4);
    this.scene.fog = new THREE.Fog(0xb3ced6, 64, 120);
    this.camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, 0.1, 130);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xe7f5ff, 0x9aa7ac, 2.5));
    this.keyLight = new THREE.DirectionalLight(0xfff0d9, 2.1);
    this.keyLight.position.set(-7, 30, 14); this.keyLight.target.position.set(0, 0, -14.5); this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this.keyLight.shadow.camera, { left: -20, right: 20, top: 48, bottom: -48, near: 1, far: 100 });
    this.keyLight.shadow.bias = -0.00015; this.keyLight.shadow.normalBias = 0.04;
    this.scene.add(this.keyLight, this.keyLight.target);
    this.materials = {
      wall: new THREE.MeshStandardMaterial({ color: 0xe3ebe5, roughness: .87 }),
      floor: new THREE.MeshStandardMaterial({ color: 0xd2dfdc, roughness: .9 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x456879, roughness: .78, metalness: .05 }),
      trim: new THREE.MeshStandardMaterial({ color: 0x475563, roughness: .48, metalness: .4 }),
      cyan: new THREE.MeshBasicMaterial({ color: 0x50dfff }),
      amber: new THREE.MeshBasicMaterial({ color: 0xffc168 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x60a9bf, transparent: true, opacity: .16, roughness: .35, depthWrite: false }),
    };
    addEventListener('resize', () => { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); });
  }

  async loadAssets() {
    const base = import.meta.env.BASE_URL;
    const draco = new DRACOLoader().setDecoderPath(base + 'draco/');
    draco.setWorkerLimit(2);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    const files = [...CORE_ASSETS, ...LAB_ASSETS];
    let done = 0;
    // Two decodes at a time prevent a burst of large temporary geometry buffers.
    const queue = files.slice();
    const worker = async () => {
      while (queue.length) {
        const asset = queue.shift();
        try {
          const gltf = await loader.loadAsync(base + 'models/' + asset.file);
          gltf.scene.traverse(object => {
            if (!object.isMesh) return;
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              for (const value of Object.values(material)) if (value?.isTexture) {
                value.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
                value.minFilter = THREE.LinearMipmapLinearFilter; value.magFilter = THREE.LinearFilter;
                value.generateMipmaps = true; value.needsUpdate = true;
              }
            }
          });
          this.assets.set(asset.id, gltf.scene);
        } catch (error) { this.failures.push(asset.file); console.error(asset.file, error); }
        done++;
        this.callbacks.onProgress({ completed: done, total: files.length, label: asset.label ?? asset.name ?? asset.file });
      }
    };
    await Promise.all([worker(), worker()]); draco.dispose();
    if (this.failures.length) throw new Error('Не загрузились модели: ' + this.failures.join(', '));
  }

  model(id, size, height = false) {
    const source = this.assets.get(id);
    if (!source) throw new Error('Отсутствует модель ' + id);
    const root = new THREE.Group(); root.userData.assetId = id;
    const mesh = source.clone(true);
    mesh.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = id === 1 || id === 2;
      child.receiveShadow = true;
    });
    let bounds = new THREE.Box3().setFromObject(mesh);
    const dimensions = bounds.getSize(new THREE.Vector3());
    mesh.scale.multiplyScalar(size / Math.max(height ? dimensions.y : Math.max(dimensions.x, dimensions.y, dimensions.z), .001));
    bounds = new THREE.Box3().setFromObject(mesh);
    const center = bounds.getCenter(new THREE.Vector3());
    mesh.position.x -= center.x; mesh.position.z -= center.z; mesh.position.y -= bounds.min.y;
    root.add(mesh); return root;
  }

  box(x, y, z, w, h, d, material, { solid = false, camera = true, aim = true, parent = this.scene } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.receiveShadow = true;
    parent.add(mesh); mesh.updateWorldMatrix(true, false);
    if (solid) this.colliders.push({ mesh, box: new THREE.Box3().setFromObject(mesh), enabled: true });
    if (camera) this.cameraBlockers.push(mesh);
    if (aim) this.aimBlockers.push(mesh);
    return mesh;
  }

  floor(minZ, maxZ) {
    this.floors.push({ minX: -12, maxX: 12, minZ, maxZ, y: 0 });
    this.box(0, -.25, (minZ + maxZ) / 2, 24, .5, maxZ - minZ, this.materials.floor, { aim: true });
    // Fine seams and edges are geometry, leaving imported modules at useful scale.
    for (let x = -12; x <= 12; x += 3) this.box(x, .008, (minZ + maxZ) / 2, .022, .014, maxZ - minZ, this.materials.trim, { camera: false, aim: false });
    for (let z = Math.ceil(minZ / 3) * 3; z <= maxZ; z += 3) this.box(0, .009, z, 24, .015, .022, this.materials.trim, { camera: false, aim: false });
  }

  label(text, x, y, z, size = 5, color = '#bdefff', rotateY = 0) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const context = canvas.getContext('2d');
    context.fillStyle = color; context.font = '600 92px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    const labelWidth = context.measureText(text).width;
    if (labelWidth > 960) context.font = `600 ${Math.floor(92 * 960 / labelWidth)}px sans-serif`;
    context.fillText(text, 512, 128);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size / 4), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z); mesh.rotation.y = rotateY; this.scene.add(mesh); return mesh;
  }

  addProp(id, size, position, stage = 0, rotation = 0, options = {}) {
    const model = this.model(id, size, Boolean(options.height));
    model.position.fromArray(position); model.rotation.y = rotation; this.scene.add(model);
    this.sectorProps[stage].push(model);
    if (options.solid) {
      model.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(model); const s = b.getSize(new THREE.Vector3()); const p = b.getCenter(new THREE.Vector3());
      const proxy = this.box(p.x, p.y, p.z, s.x, s.y, s.z, this.materials.dark, { solid: true });
      proxy.visible = false;
    }
    return model;
  }

  buildLevel() {
    this.mechanisms = buildLabArchitecture(this);
    this.launchPad = this.mechanisms.launchPad;
    CHAMBERS.forEach((chamber, index) => {
      const z = chamber.end;
      this.box(-7.6, 4.5, z, 9, 9, .4, this.materials.wall, { solid: true });
      this.box(7.6, 4.5, z, 9, 9, .4, this.materials.wall, { solid: true });
      this.box(0, 7.15, z, 6.18, 3.7, .4, this.materials.dark, { solid: true });
      const doorMesh = this.box(0, 2.5, z, 6.2, 5, .38, this.materials.dark, { solid: true });
      const collider = this.colliders.at(-1); collider.kinematic = true;
      const art = this.addProp(17, 5.2, [0, 0, z + .22], index, 0, { height: true });
      const door = { mesh: doorMesh, collider, art, z, opened: false, progress: 0, previousProgress: 0, contact: 0 };
      this.doors.push(door);
      this.label(chamber.name.split(' / ')[1], 0, 6.25, z + .28, 5.8, '#e6fbff');
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.86, .06, 12, 48), new THREE.MeshBasicMaterial({ color: 0xffbd69 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(chamber.button[0], chamber.button[1] + .16, chamber.button[2]); this.scene.add(ring);
      door.buttonRing = ring;
      const pad = this.addProp(18, 1.85, chamber.button, index);
      const padHeight = new THREE.Box3().setFromObject(pad).getSize(new THREE.Vector3()).y;
      pad.scale.y *= .12 / Math.max(.01, padHeight);
      for (const [x, y, pz, sign] of chamber.panels) {
        const panel = this.box(x, y + .1, pz, .12, 3.6, 4.1, this.materials.wall, { solid: true });
        panel.userData.portalable = true; panel.userData.stage = index;
        panel.userData.normal = new THREE.Vector3(sign, 0, 0);
        panel.userData.center = new THREE.Vector3(x + sign * .09, y, pz);
        this.portalPanels.push(panel);
        const frameProp = this.addProp(16, 4, [x - sign * .12, 0, pz], index, sign * Math.PI / 2);
        frameProp.scale.z *= .14;
        this.label('ПРОХОД ДЛЯ ИГРОКА', x + sign * .2, 4.25, pz, 3.8, '#54c5d5', sign * Math.PI / 2);
      }
    });
    this.playerGroup = new THREE.Group();
    this.playerVisual = this.model(1, PLAYER_HEIGHT, true);
    this.playerGroup.add(this.playerVisual); this.scene.add(this.playerGroup);
    this.carrier = new THREE.Group(); this.scene.add(this.carrier);
    this.animator = new LabPlayerAnimator({ visual: this.playerVisual, carrier: this.carrier });
    this.weapon = this.model(11, .7);
    this.heldDevice = new LabHeldDevice({ model: this.weapon, bones: this.animator.bones, playerRoot: this.playerGroup });
    this.cameraRig = new LabCamera({ camera: this.camera, blockers: this.cameraBlockers });
    this.portals = new LabPortals({ scene: this.scene, renderer: this.renderer, camera: this.camera });
    const group = new THREE.Group(); group.name = 'Persistent brainrot companion';
    const visual = new THREE.Group(); const brainrot = this.model(2, .82);
    brainrot.position.y = -CUBE_RADIUS; visual.add(brainrot); group.add(visual); this.scene.add(group);
    this.cargo = { group, visual, position: new THREE.Vector3(...CARGO_START), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(), stage: 0 };
    this.cubes = [this.cargo];
    this.companionAnimator = new LabCompanionAnimator({ visual });
    this.physics = new LabPhysics({ fixedStep: FIXED_STEP });
    for (const moving of [...this.mechanisms.bridges, this.mechanisms.lift, this.mechanisms.barrier]) moving.collider.kinematic = true;
    for (const collider of this.colliders) this.physics.addStaticBox(collider.mesh.uuid, collider.box, { kinematic: Boolean(collider.kinematic) });
    this.physics.createCargo({ position: this.cargo.position, size: CUBE_RADIUS * 2, mass: 3.2 });
    this.createOverlay(); this.resetRun(false);
  }

  createOverlay() {
    this.reticle = document.createElement('div'); this.reticle.className = 'lab-reticle';
    this.reticle.innerHTML = '<i></i><i></i>'; document.body.appendChild(this.reticle);
    this.help = document.createElement('div'); this.help.className = 'lab-controls';
    this.help.innerHTML = '<span><b class="blue">ЛКМ</b> вход</span><span><b class="amber">ПКМ</b> выход</span><span><b>F</b> прицел</span><span><b>E</b> куб</span>';
    document.body.appendChild(this.help);
    this.prompt = document.createElement('div'); this.prompt.className = 'lab-prompt'; document.body.appendChild(this.prompt);
    const mobile = document.createElement('div'); mobile.className = 'lab-mobile';
    for (const [label, action] of [['①', () => this.placePortal(0)], ['②', () => this.placePortal(1)], ['◎', () => { this.aimHeld = !this.aimHeld; }], ['E', () => this.interact()]]) {
      const button = document.createElement('button'); button.textContent = label;
      button.addEventListener('pointerdown', e => { e.preventDefault(); action(); }); mobile.appendChild(button);
    }
    document.body.appendChild(mobile);
  }

  setupControls() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      if (this.state !== 'playing' || e.pointerType === 'touch') return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.()?.catch?.(() => {}); return; }
      if (e.button === 0 || e.button === 2) this.placePortal(e.button === 0 ? 0 : 1);
    });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas || this.state !== 'playing') return;
      this.yaw -= e.movementX * .002; this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * .0018, -.75, .4);
    });
    let lastTouch = null;
    canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') lastTouch = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
    canvas.addEventListener('pointermove', e => {
      if (!lastTouch || lastTouch.id !== e.pointerId || this.state !== 'playing') return;
      this.yaw -= (e.clientX - lastTouch.x) * .005;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - lastTouch.y) * .004, -.75, .4);
      lastTouch = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    canvas.addEventListener('pointerup', () => { lastTouch = null; });
    addEventListener('keydown', e => {
      if (e.repeat || this.state !== 'playing') return;
      if (e.code === 'KeyE') this.interactQueued = true;
      if (e.code === 'KeyV') { this.animator?.trigger?.('celebrate'); this.companionAnimator?.trigger?.('celebrate'); }
    });
    addEventListener('blur', () => { this.input.keys.clear(); if (this.state === 'playing') this.togglePause(true); });
  }

  placePortal(index) {
    if (this.state !== 'playing') return false;
    if (this.heldCube) { this.callbacks.onToast('Отпусти куб [E], чтобы взять пушку'); return false; }
    this.aimingTime = 1.1;
    this.animator?.triggerShot?.(); this.heldDevice?.fire(index);
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(new THREE.Vector2(), this.camera);
    const hit = this.raycaster.intersectObjects(this.aimBlockers, false).find(h => h.object.visible);
    if (!hit?.object.userData.portalable) {
      this.callbacks.onToast('Наведи прицел на белую фазовую панель'); return false;
    }
    if (!this.placeOnPanel(index, hit.object)) return false;
    this.audio.tone(index ? 450 : 680, .13, 'sine', .04);
    return true;
  }

  isAiming() {
    return !this.heldCube && Boolean(this.aimHeld || this.input?.keys.has('KeyF') || this.aimingTime > 0);
  }

  placeOnPanel(index, panel) {
    if (this.portalSurfaceIds[1 - index] === panel.uuid) {
      this.callbacks.onToast('Второй проход должен быть на другой панели'); return false;
    }
    this.portals.place(index, panel.userData.center, panel.userData.normal);
    this.portalSurfaceIds[index] = panel.uuid;
    this.callbacks.onToast(this.portals.ready ? 'Пара связана. Войди в любой проход' : 'Первый проход готов. Установи второй');
    return true;
  }

  start() { this.audio.unlock(); this.resetRun(true); this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); }
  restart() { this.resetRun(true); this.callbacks.onPause(false); }
  resetRun(playing = true) {
    this.state = playing ? 'playing' : 'ready'; this.stage = 0; this.elapsed = 0; this.teleportCount = 0;
    this.heldCube = null; this.portalCooldown = 0; this.portals.clear(); this.portalSurfaceIds = [null, null];
    this.launchTime = 0; this.aimHeld = false; this.aimingTime = 0; this.completedStages = 0;
    this.jumpBuffer = this.coyoteTime = 0; this.interactQueued = false;
    this.physics.resetCargo({ position: new THREE.Vector3(...CARGO_START) });
    this.cargo.position.fromArray(CARGO_START); this.cargo.group.position.copy(this.cargo.position);
    this.cargo.group.quaternion.identity(); this.cargo.velocity.set(0, 0, 0);
    this.companionAnimator.reset();
    this.mechanisms.bridges.forEach(b => { b.active = false; b.progress = b.previousProgress = 0; b.y = b.previousY = b.minY; });
    this.mechanisms.terminals.forEach(t => { t.activated = false; t.indicator.material.color.setHex(0xffbb63); });
    const lift = this.mechanisms.lift; lift.active = false; lift.dwell = 0; lift.y = lift.previousY = lift.minY;
    this.mechanisms.barrier.opened = false; this.mechanisms.barrier.progress = 0; this.mechanisms.barrier.contact = 0;
    this.doors.forEach(d => { d.opened = false; d.progress = d.previousProgress = d.contact = 0; });
    this.updateMechanisms(0); this.updateDoors(0);
    this.respawn(false); this.emitHud();
  }

  respawn(announce = true) {
    // Only the player returns after an out-of-bounds failure. The same companion
    // stays in its physical location; the level has catch basins and retrieval stairs.
    if (this.heldCube) { this.physics.release(); this.heldCube = null; }
    this.playerPosition.fromArray(CHAMBERS[this.stage].start); this.playerVelocity.set(0, 0, 0);
    this.previousPlayerPosition.copy(this.playerPosition);
    this.playerGrounded = true; this.yaw = 0; this.pitch = -.15; this.facing = this.previousFacing = Math.PI; this.launchTime = 0;
    this.playerGroup.position.copy(this.playerPosition); this.playerGroup.rotation.y = this.facing;
    this.aimingTime = 0; this.aimHeld = false; this.motion = null;
    this.animator.reset(); this.heldDevice.reset(); this.cameraRig.reset(this.playerPosition, this.yaw, this.pitch);
    this.input?.keys.clear(); this.accumulator = 0;
    if (announce) this.callbacks.onToast('Игрок вернулся. Брейнрот ждёт там, где остался.');
  }

  togglePause(force) {
    if (!['playing', 'paused'].includes(this.state)) return;
    const paused = force ?? this.state === 'playing'; this.state = paused ? 'paused' : 'playing';
    this.input.keys.clear(); this.lastFrame = performance.now(); this.accumulator = 0;
    if (paused) document.exitPointerLock?.(); else this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
    this.callbacks.onPause(paused);
  }

  animate(now) {
    const dt = Math.min(.1, Math.max(0, (now - this.lastFrame) / 1000)); this.lastFrame = now;
    if (this.input.consumePause()) this.togglePause();
    if (this.state === 'playing' && this.input.consumeRestart()) this.restart();
    if (this.state === 'playing') {
      this.accumulator += dt;
      while (this.accumulator + 1e-10 >= FIXED_STEP) {
        this.updatePlaying(FIXED_STEP); this.accumulator = Math.max(0, this.accumulator - FIXED_STEP);
      }
    }
    this.updateVisuals(this.state === 'paused' ? 0 : dt, this.accumulator / FIXED_STEP);
    this.render(); this.renderFrames++;
  }

  updatePlaying(dt) {
    this.previousPlayerPosition.copy(this.playerPosition); this.previousFacing = this.facing;
    this.elapsed += dt * 1000; this.portalCooldown = Math.max(0, this.portalCooldown - dt);
    this.aimingTime = Math.max(0, (this.aimingTime ?? 0) - dt);
    if (this.stage === 2 && this.playerGrounded && !this.heldCube && this.launchTime <= 0 && Math.hypot(this.playerPosition.x, this.playerPosition.z + 31.5) < 1.05) {
      this.playerVelocity.y = 10; this.playerVelocity.z = -10; this.launchTime = 1.15;
      this.playerGrounded = false; this.animator.trigger?.('jump'); this.audio.jump();
    }
    this.launchTime = Math.max(0, this.launchTime - dt);
    if (this.interactQueued) { this.interactQueued = false; this.interact(); }
    this.updateMechanisms(dt); this.updatePlayer(dt); this.updateCubes(dt); this.updateDoors(dt);
    const nextStage = this.playerPosition.z < -27 ? 2 : this.playerPosition.z < -4 ? 1 : 0;
    if (nextStage !== this.stage) {
      this.stage = nextStage; this.emitHud();
      // Crossing a doorway never mutates, reassigns or hides the companion.
    }
    if (this.doors[2].opened && this.playerPosition.z < -48 && this.cargo.position.z < -47.1 && this.playerPosition.distanceTo(this.cargo.position) < 4) this.win();
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.emitHud(); this.hudTimer = .12; }
  }

  updatePlayer(dt) {
    const previous = this.playerPosition.clone();
    const wasGrounded = this.playerGrounded;
    const move = this.input.getMove();
    const aiming = this.isAiming();
    const sprint = this.input.keys.has('ShiftLeft') && !this.heldCube && !aiming;
    const speed = this.heldCube ? 3.4 : aiming ? 2.8 : sprint ? 6.6 : 4.3;
    const desired = new THREE.Vector3(move.x, 0, move.y).applyAxisAngle(UP, this.yaw).multiplyScalar(speed);
    const acceleration = this.playerGrounded ? (move.lengthSq() ? 10.5 : 15) : 3;
    this.playerVelocity.x = THREE.MathUtils.damp(this.playerVelocity.x, desired.x, acceleration, dt);
    this.playerVelocity.z = THREE.MathUtils.damp(this.playerVelocity.z, desired.z, acceleration, dt);
    if (this.launchTime > 0) this.playerVelocity.z = -10;
    this.coyoteTime = this.playerGrounded ? .1 : Math.max(0, this.coyoteTime - dt);
    this.jumpBuffer = this.input.consumeJump() ? .12 : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyoteTime > 0) {
      this.playerVelocity.y = 6.8; this.playerGrounded = false; this.coyoteTime = this.jumpBuffer = 0;
      this.animator.triggerJump?.(); this.audio.jump();
    }
    this.playerVelocity.y -= 19.5 * dt;
    this.playerPosition.addScaledVector(this.playerVelocity, dt);
    const center = this.playerPosition.clone().addScaledVector(UP, CENTER_HEIGHT);
    const previousCenter = previous.clone().addScaledVector(UP, CENTER_HEIGHT);
    const teleport = !this.heldCube && this.portalCooldown <= 0 ? this.portals.tryTeleport(center, previousCenter, this.playerVelocity, PLAYER_RADIUS) : null;
    this.groundedByCollider = false;
    const downwardImpact = Math.max(0, -this.playerVelocity.y);
    if (teleport) {
      this.playerPosition.copy(teleport.position).addScaledVector(UP, -CENTER_HEIGHT);
      this.playerVelocity.copy(teleport.velocity);
      const view = new THREE.Vector3(0, 0, -1).applyAxisAngle(UP, this.yaw).applyQuaternion(teleport.rotation);
      this.yaw = Math.atan2(-view.x, -view.z);
      const facing = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)).applyQuaternion(teleport.rotation);
      this.facing = Math.atan2(facing.x, facing.z);
      this.portalCooldown = .38; this.teleportCount++;
      this.previousPlayerPosition.copy(this.playerPosition); this.previousFacing = this.facing;
      this.cameraRig.reset(this.playerPosition, this.yaw, this.pitch);
      this.audio.tone(620, .12, 'triangle', .035);
    } else this.resolveBody(this.playerPosition, previous, this.playerVelocity, PLAYER_RADIUS, PLAYER_HEIGHT, !this.heldCube);
    this.playerGrounded = Boolean(this.groundedByCollider);
    if (this.playerGrounded && !wasGrounded && downwardImpact > 1) {
      this.animator.triggerLanding(downwardImpact); this.lastLanding = downwardImpact;
    }
    const floor = this.floorHeight(this.playerPosition.x, this.playerPosition.z, Math.max(previous.y, this.playerPosition.y) + .38);
    if (floor !== null && previous.y >= floor - .38 && this.playerPosition.y <= floor + .008 && this.playerVelocity.y <= 0) {
      const impact = -this.playerVelocity.y;
      this.playerPosition.y = floor; this.playerVelocity.y = 0; this.playerGrounded = true;
      if (!wasGrounded && impact > 1) { this.animator.triggerLanding(impact); this.lastLanding = impact; }
    }
    if (this.playerPosition.y < -12) { this.respawn(); return; }
    const planar = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    const priorFacing = this.facing;
    if (aiming || planar > .12) {
      const target = aiming ? this.yaw + Math.PI : Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
      this.facing += Math.atan2(Math.sin(target - this.facing), Math.cos(target - this.facing)) * (1 - Math.exp(-12 * dt));
    }
    const directionScale = planar > .01 ? 1 / planar : 0;
    this.motion = {
      speed: planar, turnRate: Math.atan2(Math.sin(this.facing - priorFacing), Math.cos(this.facing - priorFacing)) / Math.max(dt, .001),
      moveForward: (this.playerVelocity.x * Math.sin(this.facing) + this.playerVelocity.z * Math.cos(this.facing)) * directionScale,
      moveRight: (this.playerVelocity.x * Math.cos(this.facing) - this.playerVelocity.z * Math.sin(this.facing)) * directionScale,
    };
  }

  floorHeight(x, z, maxY = Infinity) {
    let height = null;
    for (const f of this.floors) {
      const y = f.y ?? 0;
      if (f.enabled !== false && y <= maxY + .001 && x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) height = height === null ? y : Math.max(height, y);
    }
    return height;
  }

  portalOpensCollider(collider, center, radius) {
    if (!this.portals.ready) return false;
    return this.portals.portals.some((portal, index) => {
      if (!portal || !this.portals.isInsideAperture(index, center, radius)) return false;
      const planeDistance = Math.abs(center.clone().sub(portal.position).dot(portal.normal));
      if (planeDistance > radius + .7) return false;
      // The aperture opens both its thin white panel and the structural wall behind it.
      return collider.mesh.uuid === this.portalSurfaceIds[index] || (Math.abs(portal.normal.x) > .9 && Math.abs(collider.box.getCenter(new THREE.Vector3()).x) > 11.8);
    });
  }

  resolveBody(position, previous, velocity, radius, height, allowPortals = false) {
    for (let iteration = 0; iteration < 3; iteration++) for (const collider of this.colliders) {
      if (!collider.enabled) continue;
      const b = collider.box;
      if (position.y + height <= b.min.y + .001 || position.y >= b.max.y - .001) continue;
      const nearestX = THREE.MathUtils.clamp(position.x, b.min.x, b.max.x);
      const nearestZ = THREE.MathUtils.clamp(position.z, b.min.z, b.max.z);
      const dx = position.x - nearestX, dz = position.z - nearestZ;
      if (dx * dx + dz * dz >= radius * radius) continue;
      const center = position.clone().addScaledVector(UP, height / 2);
      if (allowPortals && this.portalOpensCollider(collider, center, radius)) continue;
      if (velocity.y <= 0 && previous.y >= b.max.y - .035) {
        position.y = b.max.y; velocity.y = 0; this.groundedByCollider = true; continue;
      }
      if (this.playerGrounded && velocity.y <= 0 && b.max.y - previous.y <= .37 && b.max.y - previous.y > 0) {
        position.y = b.max.y; velocity.y = 0; this.groundedByCollider = true; continue;
      }
      if (velocity.y > 0 && previous.y + height <= b.min.y + .02) {
        position.y = b.min.y - height; velocity.y = 0; continue;
      }
      const length = Math.hypot(dx, dz);
      if (length > .00001) {
        const nx = dx / length, nz = dz / length;
        position.x += nx * (radius - length + .0001); position.z += nz * (radius - length + .0001);
        const inward = velocity.x * nx + velocity.z * nz;
        if (inward < 0) { velocity.x -= nx * inward; velocity.z -= nz * inward; }
      } else {
        const options = [[Math.abs(position.x - b.min.x + radius), 'x', b.min.x - radius], [Math.abs(b.max.x + radius - position.x), 'x', b.max.x + radius],
          [Math.abs(position.z - b.min.z + radius), 'z', b.min.z - radius], [Math.abs(b.max.z + radius - position.z), 'z', b.max.z + radius]].sort((a, b) => a[0] - b[0]);
        position[options[0][1]] = options[0][2]; velocity[options[0][1]] = 0;
      }
    }
  }

  nearbyTerminal() {
    return this.mechanisms.terminals.find(t => !t.activated && Math.hypot(t.position.x - this.playerPosition.x, t.position.z - this.playerPosition.z) < 2.4);
  }

  interact() {
    const terminal = this.nearbyTerminal();
    if (terminal) {
      terminal.activated = true; this.mechanisms.bridges[terminal.bridgeIndex].active = true;
      terminal.indicator.material.color.setHex(0x81ebba);
      this.animator.trigger?.('curious'); this.audio.checkpoint(); this.callbacks.onToast('Мост включён'); return true;
    }
    return this.toggleCube();
  }

  toggleCube() {
    if (this.state !== 'playing') return false;
    if (this.heldCube) {
      this.physics.release(); this.heldCube = null;
      this.animator.triggerInteraction('place'); this.companionAnimator.trigger('curious');
      return true;
    }
    const origin = this.playerPosition.clone().addScaledVector(UP, 1.1);
    const delta = this.cargo.position.clone().sub(origin); const distance = delta.length();
    if (distance > 2.25) return false;
    this.scene.updateMatrixWorld(true);
    this.raycaster.set(origin, delta.clone().normalize()); this.raycaster.far = Math.max(0, distance - .1);
    const blocked = this.raycaster.intersectObjects(this.cameraBlockers, false).some(hit => hit.distance < distance - .1);
    this.raycaster.far = Infinity;
    if (blocked) { this.callbacks.onToast('Между вами препятствие'); return false; }
    this.heldCube = this.cargo; this.aimingTime = 0; this.aimHeld = false;
    this.animator.triggerInteraction('pickup'); this.companionAnimator.trigger('curious'); this.audio.pickup();
    return true;
  }

  updateCubes(dt) {
    if (this.heldCube) {
      const forward = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
      const origin = this.playerPosition.clone().addScaledVector(UP, 1.06);
      const target = origin.clone().addScaledVector(forward, .95);
      this.raycaster.set(origin, forward); this.raycaster.far = 1.3;
      const hit = this.raycaster.intersectObjects(this.cameraBlockers, false)[0]; this.raycaster.far = Infinity;
      if (hit) target.copy(origin).addScaledVector(forward, Math.max(.06, hit.distance - CUBE_RADIUS - .07));
      const quaternion = new THREE.Quaternion().setFromAxisAngle(UP, this.facing);
      this.physics.setCarryTarget(target, { velocity: this.playerVelocity, quaternion });
      // Blocked objects are released where they actually are, never snapped to the player.
      if (this.cargo.position.distanceTo(origin) > 3.2) { this.physics.release(); this.heldCube = null; this.animator.triggerInteraction('place'); }
    }
    this.physics.setPlayerProxy({ position: this.playerPosition, radius: PLAYER_RADIUS, height: PLAYER_HEIGHT, velocity: this.playerVelocity }, dt);
    this.physics.step(dt);
    const sample = this.physics.sample(1);
    this.cargo.position.copy(sample.position); this.cargo.velocity.copy(sample.velocity); this.cargo.quaternion.copy(sample.quaternion);
  }

  cargoOnPad(position, radius = .86) {
    const p = Array.isArray(position) ? new THREE.Vector3(...position) : position;
    return !this.heldCube && Math.hypot(this.cargo.position.x - p.x, this.cargo.position.z - p.z) < radius
      && this.cargo.position.y > p.y + .18 && this.cargo.position.y < p.y + .75 && this.cargo.velocity.length() < 1.0;
  }

  moveMechanism(m, y, dt) {
    m.previousY = m.y ?? y; m.y = y; m.group.position.y = y; m.floor.y = y;
    m.group.updateWorldMatrix(true, true); m.collider.box.setFromObject(m.mesh);
    this.physics?.updateStaticBox(m.mesh.uuid, m.collider.box, dt);
    const f = m.floor, p = this.playerPosition;
    if (dt > 0 && this.playerGrounded && p.x > f.minX - .1 && p.x < f.maxX + .1 && p.z > f.minZ - .1 && p.z < f.maxZ + .1 && Math.abs(p.y - m.previousY) < .12) {
      p.y += y - m.previousY; this.previousPlayerPosition.y += y - m.previousY;
    }
  }

  updateMechanisms(dt) {
    for (const bridge of this.mechanisms.bridges) {
      const y = THREE.MathUtils.damp(bridge.y ?? bridge.minY, bridge.active ? bridge.maxY : bridge.minY, 1.7, dt);
      this.moveMechanism(bridge, Math.abs(y - (bridge.active ? bridge.maxY : bridge.minY)) < .003 ? (bridge.active ? bridge.maxY : bridge.minY) : y, dt);
      bridge.links.forEach(l => l.material.color.setHex(bridge.active ? 0x73dabb : 0xffbb63));
    }
    const barrier = this.mechanisms.barrier;
    barrier.contact = this.cargoOnPad(this.mechanisms.chargePad.position) ? (barrier.contact ?? 0) + dt : 0;
    if (!barrier.opened && barrier.contact > .45) {
      barrier.opened = true; this.animator.trigger?.('celebrate'); this.companionAnimator.trigger('celebrate'); this.audio.checkpoint();
    }
    barrier.previousProgress = barrier.progress;
    barrier.progress = THREE.MathUtils.damp(barrier.progress, barrier.opened ? 1 : 0, 3.2, dt);
    barrier.mesh.position.y = barrier.baseY + barrier.progress * 5.8; barrier.art.position.y = barrier.artBaseY + barrier.progress * 5.8;
    barrier.mesh.updateWorldMatrix(true, false); barrier.collider.box.setFromObject(barrier.mesh);
    this.physics?.updateStaticBox(barrier.mesh.uuid, barrier.collider.box, dt);
    const color = barrier.opened ? 0x73dabb : 0xffbb63;
    barrier.indicator.material.color.setHex(color); this.mechanisms.chargePad.ring.material.color.setHex(color);
    barrier.links.forEach(l => l.material.color.setHex(color));
    const lift = this.mechanisms.lift, f = lift.floor;
    const on = (p, tolerance) => p.x > f.minX + .12 && p.x < f.maxX - .12 && p.z > f.minZ + .12 && p.z < f.maxZ - .12 && Math.abs(p.y - lift.y) < tolerance;
    const loaded = on(this.playerPosition, .2) || on(this.cargo.position, .85);
    lift.dwell = loaded ? Math.min(.6, (lift.dwell ?? 0) + dt) : Math.max(0, (lift.dwell ?? 0) - dt * .4);
    if (lift.dwell >= .5) lift.active = true;
    if (!loaded && lift.dwell === 0 && this.playerPosition.distanceTo(lift.position) > 4) lift.active = false;
    const liftGoal = lift.active ? lift.maxY : lift.minY;
    const liftY = THREE.MathUtils.damp(lift.y ?? 0, liftGoal, 1.4, dt);
    this.moveMechanism(lift, Math.abs(liftY - liftGoal) < .003 ? liftGoal : liftY, dt);
  }

  updateDoors(dt) {
    this.doors.forEach((door, index) => {
      door.contact = this.cargoOnPad(CHAMBERS[index].button) ? door.contact + dt : 0;
      if (!door.opened && door.contact > .45) {
        door.opened = true; this.audio.checkpoint(); this.animator.trigger?.('celebrate'); this.companionAnimator.trigger('celebrate');
        this.callbacks.onToast('Замок включён. Забирай брейнрота с собой!');
      }
      door.previousProgress = door.progress;
      door.progress = THREE.MathUtils.damp(door.progress, door.opened ? 1 : 0, 3.4, dt);
      door.mesh.position.y = 2.5 + 5.5 * door.progress; door.art.position.y = 5.5 * door.progress;
      door.mesh.updateWorldMatrix(true, false); door.collider.box.setFromObject(door.mesh);
      this.physics?.updateStaticBox(door.mesh.uuid, door.collider.box, dt);
      const color = door.opened ? 0x73dabb : 0xffbb63;
      door.buttonRing.material.color.setHex(color); this.mechanisms.doorLinks[index].material.color.setHex(color);
    });
  }

  updateVisuals(dt, alpha = 1) {
    const active = this.state === 'playing' || this.state === 'won' || this.state === 'ready';
    const visualDt = active ? dt : 0;
    this.visualTime += visualDt;
    const blend = THREE.MathUtils.clamp(alpha, 0, 1);
    this.playerGroup.position.lerpVectors(this.previousPlayerPosition, this.playerPosition, blend);
    this.playerGroup.rotation.y = this.previousFacing + Math.atan2(Math.sin(this.facing - this.previousFacing), Math.cos(this.facing - this.previousFacing)) * blend;
    this.animator.update({ dt: visualDt, ...(this.motion ?? {}), velocity: this.playerVelocity, grounded: this.playerGrounded,
      carrying: Boolean(this.heldCube), phase: this.portalCooldown > .2, elapsed: this.visualTime, weapon: true, aiming: this.isAiming(), aimPitch: this.pitch });
    this.heldDevice.update({ dt: visualDt, carrying: Boolean(this.heldCube) }); this.animationFrames++;
    const cargo = this.physics.sample(blend);
    this.cargo.group.position.copy(cargo.position); this.cargo.group.quaternion.copy(cargo.quaternion);
    this.companionAnimator.update({ dt: visualDt, elapsed: this.visualTime, speed: cargo.velocity.length(), velocity: cargo.velocity, grounded: cargo.grounded, curious: Boolean(this.heldCube) });
    for (const moving of [...this.mechanisms.bridges, this.mechanisms.lift]) moving.group.position.y = THREE.MathUtils.lerp(moving.previousY, moving.y, blend);
    this.doors.forEach(door => {
      const progress = THREE.MathUtils.lerp(door.previousProgress, door.progress, blend);
      door.mesh.position.y = 2.5 + 5.5 * progress; door.art.position.y = 5.5 * progress;
    });
    const barrier = this.mechanisms.barrier;
    const barrierProgress = THREE.MathUtils.lerp(barrier.previousProgress ?? barrier.progress, barrier.progress, blend);
    barrier.mesh.position.y = barrier.baseY + barrierProgress * 5.8; barrier.art.position.y = barrier.artBaseY + barrierProgress * 5.8;
    this.cameraRig.update({ dt: visualDt, target: this.playerGroup.position, yaw: this.yaw, pitch: this.pitch, velocity: this.playerVelocity, aiming: this.isAiming() });
    this.camera.getWorldDirection(this.cameraForward);
    // The light and shadow frustum stay fixed across the complete level.
    this.portals.update(this.visualTime);
    this.prompt.textContent = this.nearbyTerminal() ? 'E — включить мост' : this.heldCube ? 'E — отпустить брейнрота' : this.playerPosition.distanceTo(this.cargo.position) < 2.25 ? 'E — взять брейнрота' : '';
  }

  render() { this.portals.render(this.visualTime); this.renderer.render(this.scene, this.camera); }

  emitHud() {
    this.callbacks.onHud({ chamber: CHAMBERS[this.stage].name, objective: CHAMBERS[this.stage].objective,
      hasCargo: Boolean(this.heldCube), portalsReady: Boolean(this.portals?.ready), stage: this.stage });
  }

  diagnostics() {
    return { state: this.state, modelsLoaded: this.assets.size, missingModels: this.failures, thirdPerson: true, stage: this.stage,
      portalsReady: this.portals.ready, teleportCount: this.teleportCount, cameraDistance: this.camera.position.distanceTo(this.playerPosition),
      animation: this.animator.diagnostics, device: this.heldDevice.diagnostics, aiming: this.isAiming(),
      cargo: { identity: this.cargo.group.uuid, count: this.cubes.length, position: this.cargo.position.toArray(), held: Boolean(this.heldCube), visible: this.cargo.group.visible, physics: this.physics.sample(1), animation: this.companionAnimator.diagnostics },
      portalRendering: this.portals.diagnostics, renderFrames: this.renderFrames, animationFrames: this.animationFrames, physicsHz: 120,
      mechanisms: { bridges: this.mechanisms.bridges.map(b => ({ active: b.active, height: b.y })), barrierOpen: this.mechanisms.barrier.opened,
        liftHeight: this.mechanisms.lift.y, doors: this.doors.map(d => d.opened) },
    };
  }

  win() {
    if (this.state === 'won') return;
    this.state = 'won'; this.playerVelocity.set(0, 0, 0); this.motion = { speed: 0, turnRate: 0 };
    this.audio.win(); document.exitPointerLock?.();
    this.animator.trigger?.('celebrate'); this.companionAnimator.trigger('celebrate'); this.callbacks.onWin({});
  }
}
