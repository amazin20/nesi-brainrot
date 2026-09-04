import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { InputController } from './InputController.js';
import { AudioController } from './AudioController.js';
import { LabCamera } from './LabCamera.js';
import { LabPlayerAnimator } from './LabPlayerAnimator.js';
import { LabHeldDevice } from './LabHeldDevice.js';
import { LabPortals } from './LabPortals.js';
import { LAB_ASSETS } from './labAssets.js';

const UP = new THREE.Vector3(0, 1, 0);
const PLAYER_HEIGHT = 2.4;
const PLAYER_RADIUS = 0.43;
const CENTER_HEIGHT = PLAYER_HEIGHT / 2;
const CUBE_RADIUS = 0.62;
const CORE_ASSETS = [
  { id: 1, file: 'model-01-player.glb', label: 'Персонаж' },
  { id: 2, file: 'model-02-cargo.glb', label: 'Брейнрот' },
  { id: 11, file: 'model-11-portal-gun.glb', label: 'Устройство переходов' },
];
export const CHAMBERS = [
  { name: '01 / ПРОСТРАНСТВО', start: [0, 0, 18], end: -3, button: [4.6, 0, 0], cube: [6.3, 0.65, 2], panels: [[-11.65, 1.6, 15, 1], [-11.65, 1.6, 1, 1]], hint: 'Соедини белые панели по обе стороны провала. Найди куб и поставь на площадку.' },
  { name: '02 / ПЕРЕНОС', start: [0, 0, -6], end: -26, button: [4.6, 0, -22], cube: [-4.7, 0.65, -9], panels: [[11.65, 1.6, -9, -1], [11.65, 1.6, -21, -1]], hint: 'Подними куб [E]. Перенеси его через пару проходов за энергетический барьер.' },
  { name: '03 / СВЯЗЬ', start: [0, 0, -29], end: -47, button: [0, 0, -44], cube: [-5, 0.65, -31], panels: [[-11.65, 1.6, -30, 1], [11.65, 1.6, -43, -1]], hint: 'Последний разрыв. Доставь куб к выходной площадке и закончи испытание.' },
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
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x121c24);
    this.scene.fog = new THREE.Fog(0x16212b, 34, 75);
    this.camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, 0.08, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xddecff, 0x37434c, 2.25));
    this.keyLight = new THREE.DirectionalLight(0xfff3df, 2.4);
    this.keyLight.position.set(5, 12, 17); this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.keyLight.shadow.camera, { left: -15, right: 15, top: 16, bottom: -16, near: 1, far: 45 });
    this.keyLight.shadow.bias = -0.0003; this.keyLight.shadow.normalBias = 0.025;
    this.scene.add(this.keyLight, this.keyLight.target);
    this.materials = {
      wall: new THREE.MeshStandardMaterial({ color: 0xd2dadd, roughness: .8 }),
      floor: new THREE.MeshStandardMaterial({ color: 0xc0cccf, roughness: .78 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x17232d, roughness: .7, metalness: .25 }),
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
    this.floor(11, 22); this.floor(-3, 5); this.floor(-26, -3); this.floor(-34, -26); this.floor(-51, -40);
    this.box(0, -4.3, -14.5, 24, .5, 73, this.materials.dark, { camera: false, aim: false });
    for (const x of [-12.2, 12.2]) {
      this.box(x, 4.5, -14.5, .4, 9, 73, this.materials.wall, { solid: true });
      this.box(x > 0 ? 11.94 : -11.94, 1.05, -14.5, .09, .045, 73, this.materials.cyan, { camera: false, aim: false });
    }
    this.box(0, 4.5, 22.2, 24.8, 9, .4, this.materials.dark, { solid: true });
    this.box(0, 4.5, -51.2, 24.8, 9, .4, this.materials.dark, { solid: true });
    this.box(0, 9.15, -14.5, 24.8, .3, 73, this.materials.dark, { aim: false });
    for (let z = 19; z > -51; z -= 6) {
      this.box(0, 8.85, z, 18, .12, .38, this.materials.cyan, { camera: false, aim: false });
      for (const x of [-11.97, 11.97]) {
        this.box(x, 4.5, z, .09, 8.5, .055, this.materials.trim, { camera: false, aim: false });
      }
    }
    for (const [a, b] of [[5, 11], [-40, -34]]) {
      for (const z of [a, b]) this.box(0, .018, z, 24, .025, .13, this.materials.amber, { camera: false, aim: false });
      this.label('ПРОВАЛ / ИСПОЛЬЗУЙ ПЕРЕХОД', 0, -1.4, (a + b) / 2, 8, '#ffcb77');
    }
    CHAMBERS.forEach((chamber, index) => {
      const z = chamber.end;
      this.box(-7.6, 4.5, z, 9, 9, .4, this.materials.wall, { solid: true });
      this.box(7.6, 4.5, z, 9, 9, .4, this.materials.wall, { solid: true });
      this.box(0, 7.15, z, 6.3, 3.7, .4, this.materials.dark, { solid: true });
      const doorMesh = this.box(0, 2.5, z, 6.2, 5, .38, this.materials.dark, { solid: true });
      const collider = this.colliders.at(-1);
      const art = this.addProp(17, 5.2, [0, 0, z + .22], index, 0, { height: true });
      const door = { mesh: doorMesh, collider, art, z, opened: false, progress: 0 };
      this.doors.push(door);
      this.label(chamber.name, 0, 6.25, z + .26, 8);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, .075, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffbd69 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(chamber.button[0], .1, chamber.button[2]); this.scene.add(ring);
      door.buttonRing = ring;
      this.box(chamber.button[0], .065, chamber.button[2], 1.6, .13, 1.6, this.materials.trim, { camera: false, aim: false });
      const pad = this.addProp(18, 2.05, [chamber.button[0], 0, chamber.button[2]], index);
      const padHeight = new THREE.Box3().setFromObject(pad).getSize(new THREE.Vector3()).y;
      pad.scale.y *= .14 / Math.max(.01, padHeight);
      const cube = { group: new THREE.Group(), velocity: new THREE.Vector3(), stage: index, cooldown: 0 };
      const brainrot = this.model(2, 1.15); brainrot.position.y = -.56; cube.group.add(brainrot);
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.24, 1.24, 1.24)), new THREE.LineBasicMaterial({ color: 0x63dbff }));
      cube.group.add(frame); cube.group.position.fromArray(chamber.cube); this.scene.add(cube.group); this.cubes.push(cube);
      for (const [x, y, pz, sign] of chamber.panels) {
        const panel = this.box(x, y + .1, pz, .12, 3.6, 4.1, this.materials.wall, { solid: true });
        panel.userData.portalable = true; panel.userData.stage = index;
        panel.userData.normal = new THREE.Vector3(sign, 0, 0);
        panel.userData.center = new THREE.Vector3(x + sign * .09, y, pz);
        this.portalPanels.push(panel);
        const frameProp = this.addProp(16, 4, [x - sign * .04, 0, pz], index, sign * Math.PI / 2);
        // Recess the source panel behind the aperture. Its original texture remains visible at the rim.
        frameProp.scale.z *= .18;
        this.label('ФАЗОВАЯ ПАНЕЛЬ', x + sign * .2, 4.25, pz, 3.8, '#76dfff', sign * Math.PI / 2);
      }
    });
    // A physical glass partition in chamber 02: it blocks bodies, but keeps the
    // remote portal target visible. Portal beams pass through this field.
    const barrier = this.box(0, 3, -14, 24, 6, .22, this.materials.glass, { solid: true, aim: false });
    barrier.userData.field = true;
    this.addProp(20, 5.7, [0, .02, -14], 1);
    this.buildDetails();
    this.playerGroup = new THREE.Group();
    this.playerVisual = this.model(1, PLAYER_HEIGHT, true);
    this.playerGroup.add(this.playerVisual); this.scene.add(this.playerGroup);
    this.carrier = new THREE.Group(); this.scene.add(this.carrier);
    this.animator = new LabPlayerAnimator({ visual: this.playerVisual, carrier: this.carrier });
    this.weapon = this.model(11, .7);
    this.heldDevice = new LabHeldDevice({ model: this.weapon, bones: this.animator.bones, playerRoot: this.playerGroup });
    this.cameraRig = new LabCamera({ camera: this.camera, blockers: this.cameraBlockers });
    this.portals = new LabPortals({ scene: this.scene, renderer: this.renderer, camera: this.camera });
    this.createOverlay(); this.resetRun(false);
  }

  buildDetails() {
    this.label('N E S I  /  TRANSFER LAB', 0, 6.4, 21.94, 11, '#edfaff', Math.PI);
    this.label('01', -9, 5.8, -2.75, 3, '#50dfff');
    this.label('02', -9, 5.8, -25.75, 3, '#50dfff');
    this.label('03', -9, 5.8, -46.75, 3, '#50dfff');
    this.addProp(12, 3.7, [7.8, .02, 17.6], 0, -Math.PI / 2, { solid: true });
    this.addProp(13, 1.5, [7.4, .02, 13.5], 0, Math.PI, { solid: true });
    const table = this.addProp(14, 1.5, [9.3, .02, 13.1], 0, 0, { solid: true });
    const tabletop = new THREE.Box3().setFromObject(table).max.y;
    this.addProp(15, .24, [9.3, tabletop, 13.1], 0);
    this.addProp(19, 3.2, [-7.8, .02, -43.7], 2, 0, { solid: true });
    this.launchPad = this.addProp(21, 2.75, [0, 0, -31.5], 2);
    const launchHeight = new THREE.Box3().setFromObject(this.launchPad).getSize(new THREE.Vector3()).y;
    this.launchPad.scale.y *= .12 / Math.max(.01, launchHeight);
    CHAMBERS.forEach((chamber, index) => {
      this.addProp(22, 1.8, [-8.3, .02, chamber.start[2] - .2], index, Math.PI / 4, { solid: true });
    });
    this.label('ИМПУЛЬС →', 0, .025, -30, 4, '#ffcb77', 0).rotation.x = -Math.PI / 2;
  }

  createOverlay() {
    this.reticle = document.createElement('div'); this.reticle.className = 'lab-reticle';
    this.reticle.innerHTML = '<i></i><i></i>'; document.body.appendChild(this.reticle);
    this.help = document.createElement('div'); this.help.className = 'lab-controls';
    this.help.innerHTML = '<span><b class="blue">ЛКМ</b> вход</span><span><b class="amber">ПКМ</b> выход</span><span><b>F</b> прицел</span><span><b>E</b> куб</span><span><b>Q</b> подсказка</span>';
    document.body.appendChild(this.help);
    this.prompt = document.createElement('div'); this.prompt.className = 'lab-prompt'; document.body.appendChild(this.prompt);
    const mobile = document.createElement('div'); mobile.className = 'lab-mobile';
    for (const [label, action] of [['①', () => this.placePortal(0)], ['②', () => this.placePortal(1)], ['◎', () => { this.aimHeld = !this.aimHeld; }], ['E', () => this.toggleCube()], ['?', () => this.showHint()]]) {
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
      if (e.code === 'KeyQ') this.showHint();
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
    if (!hit?.object.userData.portalable || hit.object.userData.stage !== this.stage) {
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

  showHint() {
    if (this.state !== 'playing') return;
    const panels = this.portalPanels.filter(p => p.userData.stage === this.stage);
    this.portals.clear(); this.portalSurfaceIds = [null, null];
    this.placeOnPanel(0, panels[0]); this.placeOnPanel(1, panels[1]);
    this.callbacks.onToast('Пример пары настроен. ' + CHAMBERS[this.stage].hint);
  }

  start() { this.audio.unlock(); this.resetRun(true); this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); }
  restart() { this.resetRun(true); this.callbacks.onPause(false); }
  resetRun(playing = true) {
    this.state = playing ? 'playing' : 'ready'; this.stage = 0; this.elapsed = 0; this.teleportCount = 0;
    this.heldCube = null; this.portalCooldown = 0; this.portals.clear(); this.portalSurfaceIds = [null, null];
    this.launchTime = 0; this.aimHeld = false; this.aimingTime = 0;
    for (let i = 0; i < this.cubes.length; i++) {
      this.cubes[i].group.position.fromArray(CHAMBERS[i].cube); this.cubes[i].group.rotation.set(0, .25, 0);
      this.cubes[i].velocity.set(0, 0, 0); this.cubes[i].cooldown = 0;
      this.doors[i].opened = false; this.doors[i].progress = 0;
    }
    this.respawn(false); this.updateDoors(0); this.emitHud();
  }

  respawn(announce = true) {
    if (this.heldCube) {
      this.heldCube.group.position.fromArray(CHAMBERS[this.stage].cube); this.heldCube.velocity.set(0, 0, 0); this.heldCube = null;
    }
    this.playerPosition.fromArray(CHAMBERS[this.stage].start); this.playerVelocity.set(0, 0, 0);
    this.playerGrounded = true; this.yaw = 0; this.pitch = -.15; this.facing = Math.PI; this.launchTime = 0;
    this.playerGroup.position.copy(this.playerPosition); this.playerGroup.rotation.y = this.facing;
    this.aimingTime = 0; this.aimHeld = false;
    this.animator.reset(); this.heldDevice?.reset?.(); this.heldDevice?.update({ dt: 0, carrying: false });
    this.cameraRig.reset(this.playerPosition, this.yaw, this.pitch);
    this.input?.keys.clear(); this.accumulator = 0;
    if (announce) this.callbacks.onToast('Возврат к началу камеры. Куб сохранён');
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
      while (this.accumulator >= 1 / 60) { this.updatePlaying(1 / 60); this.accumulator -= 1 / 60; }
    }
    this.updateVisuals(dt);
    this.render();
  }

  updatePlaying(dt) {
    this.elapsed += dt * 1000; this.portalCooldown = Math.max(0, this.portalCooldown - dt);
    this.aimingTime = Math.max(0, (this.aimingTime ?? 0) - dt);
    if (this.stage === 2 && this.playerGrounded && this.launchTime <= 0 && Math.hypot(this.playerPosition.x, this.playerPosition.z + 31.5) < 1.1) {
      this.playerVelocity.y = 9.5; this.playerVelocity.z = -10; this.launchTime = 1.05;
      this.playerGrounded = false; this.callbacks.onToast('Импульсная площадка: держи направление');
    }
    this.launchTime = Math.max(0, this.launchTime - dt);
    if (this.interactQueued) { this.interactQueued = false; this.toggleCube(); }
    this.updatePlayer(dt); this.updateCubes(dt); this.updateDoors(dt);
    const current = CHAMBERS[this.stage];
    if (this.doors[this.stage].opened && this.playerPosition.z < current.end - 1) {
      if (this.stage === 2) this.win();
      else {
        if (this.heldCube) {
          this.heldCube.group.position.fromArray(current.button).setY(.76);
          this.heldCube.velocity.set(0, 0, 0);
          this.heldCube = null;
        }
        this.stage++; this.portals.clear(); this.portalSurfaceIds = [null, null];
        this.callbacks.onToast(CHAMBERS[this.stage].name + ' — ' + CHAMBERS[this.stage].hint);
      }
    }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.emitHud(); this.hudTimer = .1; }
  }

  updatePlayer(dt) {
    const previous = this.playerPosition.clone();
    const wasGrounded = this.playerGrounded;
    const move = this.input.getMove();
    const aiming = this.isAiming();
    const sprint = this.input.keys.has('ShiftLeft') && !this.heldCube && !aiming;
    const speed = this.heldCube ? 3.7 : aiming ? 3.2 : sprint ? 6.6 : 4.8;
    const desired = new THREE.Vector3(move.x, 0, move.y).applyAxisAngle(UP, this.yaw).multiplyScalar(speed);
    const acceleration = this.playerGrounded ? 10.5 : 3;
    this.playerVelocity.x = THREE.MathUtils.damp(this.playerVelocity.x, desired.x, acceleration, dt);
    this.playerVelocity.z = THREE.MathUtils.damp(this.playerVelocity.z, desired.z, acceleration, dt);
    if (this.launchTime > 0) this.playerVelocity.z = -10;
    if (this.input.consumeJump() && this.playerGrounded) { this.playerVelocity.y = 6.8; this.playerGrounded = false; this.audio.jump(); }
    this.playerVelocity.y -= 19.5 * dt;
    this.playerPosition.addScaledVector(this.playerVelocity, dt);
    const center = this.playerPosition.clone().addScaledVector(UP, CENTER_HEIGHT);
    const previousCenter = previous.clone().addScaledVector(UP, CENTER_HEIGHT);
    const teleport = this.portalCooldown <= 0 ? this.portals.tryTeleport(center, previousCenter, this.playerVelocity, PLAYER_RADIUS) : null;
    if (teleport) {
      this.playerPosition.copy(teleport.position).addScaledVector(UP, -CENTER_HEIGHT);
      this.playerVelocity.copy(teleport.velocity);
      const view = new THREE.Vector3(0, 0, -1).applyAxisAngle(UP, this.yaw).applyQuaternion(teleport.rotation);
      this.yaw = Math.atan2(-view.x, -view.z);
      const facing = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)).applyQuaternion(teleport.rotation);
      this.facing = Math.atan2(facing.x, facing.z);
      this.portalCooldown = .38; this.teleportCount++;
      if (this.heldCube) {
        this.heldCube.group.position.copy(this.playerPosition).add(new THREE.Vector3(0, 1.25, 0));
        this.heldCube.cooldown = .4;
      }
      this.cameraRig.reset(this.playerPosition, this.yaw, this.pitch);
      this.audio.tone(620, .12, 'triangle', .035);
    } else this.resolveBody(this.playerPosition, previous, this.playerVelocity, PLAYER_RADIUS, PLAYER_HEIGHT, true);
    this.playerGrounded = false;
    const floor = this.floorHeight(this.playerPosition.x, this.playerPosition.z);
    if (floor !== null && previous.y >= floor - .22 && this.playerPosition.y <= floor) {
      const impact = -this.playerVelocity.y;
      this.playerPosition.y = floor; this.playerVelocity.y = 0; this.playerGrounded = true;
      if (!wasGrounded && impact > 1) { this.animator.triggerLanding(impact); this.lastLanding = impact; }
    }
    if (this.playerPosition.y < -5) { this.respawn(); return; }
    const planar = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    const priorFacing = this.facing;
    if (aiming || planar > .12) {
      const target = aiming ? this.yaw + Math.PI : Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
      this.facing += Math.atan2(Math.sin(target - this.facing), Math.cos(target - this.facing)) * (1 - Math.exp(-12 * dt));
    }
    this.playerGroup.position.copy(this.playerPosition); this.playerGroup.rotation.y = this.facing;
    const directionScale = planar > .01 ? 1 / planar : 0;
    const moveForward = (this.playerVelocity.x * Math.sin(this.facing) + this.playerVelocity.z * Math.cos(this.facing)) * directionScale;
    const moveRight = (this.playerVelocity.x * Math.cos(this.facing) - this.playerVelocity.z * Math.sin(this.facing)) * directionScale;
    this.animator.update({ dt, speed: planar, velocity: this.playerVelocity, grounded: this.playerGrounded, turnRate: Math.atan2(Math.sin(this.facing - priorFacing), Math.cos(this.facing - priorFacing)) / Math.max(dt, .001), carrying: Boolean(this.heldCube), phase: this.portalCooldown > .2, elapsed: this.elapsed / 1000, weapon: true, aiming, aimPitch: this.pitch, moveForward, moveRight });
    this.heldDevice?.update({ dt, carrying: Boolean(this.heldCube) });
  }

  floorHeight(x, z) {
    if (CHAMBERS.some(c => Math.abs(x - c.button[0]) < .8 && Math.abs(z - c.button[2]) < .8)) return .14;
    return this.floors.some(f => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) ? 0 : null;
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
    const center = position.clone().addScaledVector(UP, height / 2);
    for (const collider of this.colliders) {
      if (!collider.enabled) continue;
      const b = collider.box;
      if (position.y + height <= b.min.y || position.y >= b.max.y) continue;
      if (position.x + radius <= b.min.x || position.x - radius >= b.max.x || position.z + radius <= b.min.z || position.z - radius >= b.max.z) continue;
      if (allowPortals && this.portalOpensCollider(collider, center, radius)) continue;
      const left = b.min.x - radius, right = b.max.x + radius, front = b.min.z - radius, back = b.max.z + radius;
      if (previous.x <= left) { position.x = left; velocity.x = Math.min(0, velocity.x); }
      else if (previous.x >= right) { position.x = right; velocity.x = Math.max(0, velocity.x); }
      else if (previous.z <= front) { position.z = front; velocity.z = Math.min(0, velocity.z); }
      else if (previous.z >= back) { position.z = back; velocity.z = Math.max(0, velocity.z); }
      else {
        const options = [[Math.abs(position.x - left), 'x', left], [Math.abs(right - position.x), 'x', right], [Math.abs(position.z - front), 'z', front], [Math.abs(back - position.z), 'z', back]].sort((a, b) => a[0] - b[0]);
        position[options[0][1]] = options[0][2]; velocity[options[0][1]] = 0;
      }
    }
  }

  toggleCube() {
    if (this.state !== 'playing') return;
    if (this.heldCube) {
      this.heldCube.velocity.copy(this.playerVelocity).multiplyScalar(.3);
      this.heldCube = null; this.animator?.triggerInteraction?.('place');
      this.callbacks.onToast('Куб отпущен'); return;
    }
    const cube = this.cubes[this.stage];
    const origin = this.playerPosition.clone().addScaledVector(UP, 1.25);
    const delta = cube.group.position.clone().sub(origin); const distance = delta.length();
    if (distance > 2.7) { this.callbacks.onToast('Подойди ближе к кубу'); return; }
    this.scene.updateMatrixWorld(true);
    this.raycaster.set(origin, delta.normalize()); this.raycaster.far = distance - .05;
    const blocked = this.raycaster.intersectObjects(this.cameraBlockers, false).some(hit => hit.distance < distance - .05);
    this.raycaster.far = Infinity;
    if (blocked) { this.callbacks.onToast('Куб за преградой'); return; }
    this.heldCube = cube; cube.velocity.set(0, 0, 0); this.aimingTime = 0; this.aimHeld = false;
    this.animator?.triggerInteraction?.('pickup'); this.audio.pickup();
  }

  updateCubes(dt) {
    for (const cube of this.cubes) {
      if (cube.stage !== this.stage) continue;
      cube.cooldown = Math.max(0, cube.cooldown - dt);
      if (cube === this.heldCube) {
        // The carry point follows body facing; camera orbit never drags the cube through walls.
        const forward = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
        const target = this.playerPosition.clone().addScaledVector(UP, 1.25).addScaledVector(forward, 1.05);
        const origin = this.playerPosition.clone().addScaledVector(UP, 1.25);
        const delta = target.clone().sub(origin); this.raycaster.set(origin, delta.clone().normalize()); this.raycaster.far = delta.length() + CUBE_RADIUS;
        const hit = this.raycaster.intersectObjects(this.cameraBlockers, false)[0]; this.raycaster.far = Infinity;
        if (hit) target.copy(origin).addScaledVector(delta.normalize(), hit.distance - CUBE_RADIUS - .06);
        const previousFoot = cube.group.position.clone().addScaledVector(UP, -CUBE_RADIUS);
        cube.group.position.lerp(target, 1 - Math.exp(-18 * dt));
        const foot = cube.group.position.clone().addScaledVector(UP, -CUBE_RADIUS);
        this.resolveBody(foot, previousFoot, cube.velocity, CUBE_RADIUS, 2 * CUBE_RADIUS, false);
        cube.group.position.copy(foot).addScaledVector(UP, CUBE_RADIUS);
        cube.velocity.copy(this.playerVelocity); continue;
      }
      const previous = cube.group.position.clone(); cube.velocity.y -= 18 * dt;
      cube.group.position.addScaledVector(cube.velocity, dt);
      const tele = cube.cooldown <= 0 ? this.portals.tryTeleport(cube.group.position, previous, cube.velocity, CUBE_RADIUS) : null;
      if (tele) { cube.group.position.copy(tele.position); cube.velocity.copy(tele.velocity); cube.cooldown = .4; }
      else {
        const foot = cube.group.position.clone().addScaledVector(UP, -CUBE_RADIUS);
        this.resolveBody(foot, previous.clone().addScaledVector(UP, -CUBE_RADIUS), cube.velocity, CUBE_RADIUS, 2 * CUBE_RADIUS, true);
        cube.group.position.copy(foot).addScaledVector(UP, CUBE_RADIUS);
      }
      const floor = this.floorHeight(cube.group.position.x, cube.group.position.z);
      if (floor !== null && cube.group.position.y < floor + CUBE_RADIUS) {
        cube.group.position.y = floor + CUBE_RADIUS; cube.velocity.y = cube.velocity.y < -2 ? -cube.velocity.y * .12 : 0;
        cube.velocity.x *= Math.exp(-5 * dt); cube.velocity.z *= Math.exp(-5 * dt);
      }
      if (cube.group.position.y < -5) { cube.group.position.fromArray(CHAMBERS[cube.stage].cube); cube.velocity.set(0, 0, 0); }
    }
  }

  updateDoors(dt) {
    this.doors.forEach((door, index) => {
      const cube = this.cubes[index]; const button = CHAMBERS[index].button;
      const pressed = cube !== this.heldCube && Math.hypot(cube.group.position.x - button[0], cube.group.position.z - button[2]) < .95 && cube.group.position.y < .85;
      if (pressed && !door.opened) { door.opened = true; this.audio.checkpoint(); this.callbacks.onToast('Контакт подтверждён. Проход открыт'); }
      door.progress = THREE.MathUtils.damp(door.progress, door.opened ? 1 : 0, 4, dt);
      door.mesh.position.y = 2.5 + 5.5 * door.progress; door.art.position.y = 5.5 * door.progress;
      door.mesh.updateWorldMatrix(true, false); door.collider.box.setFromObject(door.mesh);
      door.buttonRing.material.color.setHex(door.opened ? 0x83ffc2 : 0xffbd69);
    });
  }

  updateVisuals(dt) {
    this.visualTime += this.state === 'playing' ? dt : 0;
    this.cameraRig.update({ dt, target: this.playerPosition, yaw: this.yaw, pitch: this.pitch, velocity: this.playerVelocity, aiming: this.isAiming() });
    this.camera.getWorldDirection(this.cameraForward);
    const z = this.playerPosition.z;
    this.keyLight.position.set(this.playerPosition.x + 5, 12, z + 7); this.keyLight.target.position.set(this.playerPosition.x, 0, z - 3);
    this.sectorProps.forEach((props, index) => props.forEach(prop => { prop.visible = Math.abs(index - this.stage) === 0; }));
    this.cubes.forEach(cube => { cube.group.visible = cube.stage === this.stage; });
    this.portals.update(this.visualTime);
    this.prompt.textContent = this.heldCube ? 'E — поставить куб' : this.playerPosition.distanceTo(this.cubes[this.stage].group.position) < 2.7 ? 'E — взять брейнрота' : '';
  }

  render() { this.portals.render(this.visualTime); this.renderer.render(this.scene, this.camera); }

  emitHud() {
    this.callbacks.onHud({ elapsed: this.elapsed, chamber: CHAMBERS[this.stage].name, objective: CHAMBERS[this.stage].hint, hasCargo: Boolean(this.heldCube), progress: (this.stage + Number(this.doors[this.stage]?.opened)) / 3, portalsReady: Boolean(this.portals?.ready), stage: this.stage });
  }

  diagnostics() {
    return { state: this.state, modelsLoaded: this.assets.size, missingModels: this.failures, thirdPerson: true, stage: this.stage, portalsReady: this.portals.ready, teleportCount: this.teleportCount, cameraDistance: this.camera.position.distanceTo(this.playerPosition), animation: this.animator.diagnostics ?? null, device: this.heldDevice?.diagnostics ?? null, aiming: this.isAiming() };
  }

  win() {
    if (this.state === 'won') return;
    this.state = 'won'; this.audio.win(); document.exitPointerLock?.();
    this.callbacks.onWin({ elapsed: this.elapsed });
  }
}
