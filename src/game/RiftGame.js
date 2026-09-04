import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { InputController } from './InputController.js';
import { AudioController } from './AudioController.js';
import { PlayerAppearanceBaseline } from './PlayerAppearanceBaseline.js';
import {
  buildRiftRoute,
  calculateRiftExitVelocity,
  forwardFromYawPitch,
  makeRiftFrame,
  riftRouteTangent,
  sampleRiftRoute,
} from './riftMath.js';

const MODEL_FILES = [
  'model-01-player.glb',
  'model-02-cargo.glb',
  'model-03-swing-hammer.glb',
  'model-04-bounce-block.glb',
  'model-05-checkpoint.glb',
  'model-06-finish-flag.glb',
  'model-07-spin-hammer.glb',
  'model-08-roller.glb',
  'model-09-hurdles.glb',
  'model-10-platform.glb',
  'model-11-portal-gun.glb',
];

const COLORS = {
  cyan: 0x35f2ff,
  violet: 0xb45cff,
  amber: 0xffb347,
  green: 0x9cff66,
  white: 0xe9eef1,
  panel: 0xb9c3c8,
  ink: 0x10171c,
};

const noop = () => {};
const PLAYER_RADIUS = 0.48;
const PLAYER_EYE = 1.42;
const PLAYER_HEIGHT = 2.5;
const CUBE_RADIUS = 0.78;
const WALL_HALF_THICKNESS = 0.17;
const ROOM = Object.freeze({ minX: -11.72, maxX: 11.72, minZ: -19.72, maxZ: 21.72 });

export class RiftGame {
  constructor({ container, touch, onProgress, onReady, onHud, onToast, onPause, onWin }) {
    this.container = container;
    this.touch = touch;
    this.callbacks = {
      onProgress: onProgress ?? noop,
      onReady: onReady ?? noop,
      onHud: onHud ?? noop,
      onToast: onToast ?? noop,
      onPause: onPause ?? noop,
      onWin: onWin ?? noop,
    };
    this.assets = new Map();
    this.riftSurfaces = [];
    this.aimBlockers = [];
    this.cameraBlockers = [];
    this.motions = [];
    this.state = 'loading';
    this.elapsed = 0;
    this.lastFrame = performance.now();
    this.yaw = 0;
    this.pitch = -0.2;
    this.playerPosition = new THREE.Vector3(0, 0, 17);
    this.playerVelocity = new THREE.Vector3();
    this.playerGrounded = true;
    this.playerFacing = Math.PI;
    this.riftCooldown = 0;
    this.riftTravel = null;
    this.riftTrailLife = 0;
    this.riftUsed = false;
    this.thirdPerson = true;
    this.interactQueued = false;
    this.heldCube = false;
    this.buttonActivated = false;
    this.doorProgress = 0;
    this.gunKick = 0;
    this.aimTimer = 0;
    this.raycaster = new THREE.Raycaster();
    this.cameraRaycaster = new THREE.Raycaster();
    this.centerPointer = new THREE.Vector2(0, 0);
    this.cameraForward = new THREE.Vector3(0, 0, -1);
    this.tempVector = new THREE.Vector3();
    this.animate = this.animate.bind(this);
  }

  async init() {
    this.createScene();
    this.input = new InputController(this.touch);
    this.audio = new AudioController();
    this.setupControls();
    this.renderer.setAnimationLoop(this.animate);
    await this.loadAssets();
    this.buildChamber();
    this.state = 'ready';
    this.callbacks.onReady({ portalMode: true, riftMode: true });
    this.emitHud();
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1418);
    this.scene.fog = new THREE.FogExp2(0x182329, 0.017);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.06, 160);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.55));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xe9f7ff, 0x26323a, 2.45));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(-8, 14, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 24;
    key.shadow.camera.bottom = -24;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 70;
    this.scene.add(key);

    for (const data of [[-8, 14, COLORS.cyan], [8, 0, 0xffffff], [-4, -14, COLORS.violet]]) {
      const light = new THREE.PointLight(data[2], 8, 18, 2);
      light.position.set(data[0], 6.8, data[1]);
      this.scene.add(light);
    }
    window.addEventListener('resize', () => this.resize());
  }

  setupControls() {
    const canvas = this.renderer.domElement;
    this.onMouseMove = (event) => {
      if (document.pointerLockElement !== canvas || this.state !== 'playing') return;
      this.yaw -= event.movementX * 0.00215;
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.00175, -0.68, 0.2);
    };
    this.onMouseDown = (event) => {
      if (this.state !== 'playing') return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
        return;
      }
      if (event.button === 0) this.placeRiftBeacon();
      if (event.button === 2) this.activateRiftRoute();
    };
    this.onKeyDown = (event) => {
      if (event.code === 'KeyE' && !event.repeat) this.interactQueued = true;
      if (event.code === 'KeyQ' && !event.repeat) this.activateRiftRoute();
    };
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('click', () => {
      if (this.state === 'playing' && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    });
  }

  async loadAssets() {
    const base = import.meta.env.BASE_URL;
    const draco = new DRACOLoader();
    draco.setDecoderPath(base + 'draco/');
    draco.setDecoderConfig({ type: 'wasm' });
    draco.preload();
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    let completed = 0;
    this.callbacks.onProgress({ completed, total: MODEL_FILES.length, label: 'Загрузка Rift Lab...' });
    await Promise.all(MODEL_FILES.map((file, index) => new Promise((resolve) => {
      loader.load(
        base + 'models/' + file,
        (gltf) => {
          this.assets.set(index + 1, gltf.scene);
          resolve();
        },
        undefined,
        (error) => {
          console.warn('Rift Lab model ' + (index + 1) + ' failed to load.', error);
          this.assets.set(index + 1, this.createFallback(index + 1));
          resolve();
        },
      );
    }).finally(() => {
      completed += 1;
      this.callbacks.onProgress({
        completed,
        total: MODEL_FILES.length,
        label: 'Модель ' + completed + ' из ' + MODEL_FILES.length,
      });
    })));
    draco.dispose();
  }

  createFallback(id) {
    const root = new THREE.Group();
    const color = id === 11 ? COLORS.cyan : id % 2 ? COLORS.violet : COLORS.green;
    root.add(new THREE.Mesh(
      id === 11 ? new THREE.CapsuleGeometry(0.15, 0.7, 6, 12) : new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 }),
    ));
    return root;
  }

  model(id, targetSize, mode = 'max') {
    const source = this.assets.get(id) ?? this.createFallback(id);
    const clone = source.clone(true);
    clone.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = true;
      if (!child.material) return;
      child.material = child.material.clone();
      for (const name of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
        if (child.material[name]) {
          child.material[name].anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        }
      }
    });
    let box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const reference = mode === 'height' ? size.y : Math.max(size.x, size.y, size.z);
    clone.scale.setScalar(reference > 0.0001 ? targetSize / reference : 1);
    box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box.min.y;
    const root = new THREE.Group();
    root.userData.assetId = id;
    root.add(clone);
    return root;
  }

  buildChamber() {
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.materials = {
      white: new THREE.MeshStandardMaterial({ color: COLORS.white, roughness: 0.72, metalness: 0.03 }),
      pale: new THREE.MeshStandardMaterial({ color: COLORS.panel, roughness: 0.78, metalness: 0.04 }),
      dark: new THREE.MeshStandardMaterial({ color: COLORS.ink, roughness: 0.54, metalness: 0.32 }),
      black: new THREE.MeshStandardMaterial({ color: 0x05090c, roughness: 0.5, metalness: 0.42 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0xbdeeff,
        transparent: true,
        opacity: 0.2,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    };

    for (let x = -10; x <= 10; x += 4) {
      for (let z = -18; z <= 20; z += 4) {
        this.addBox([x, -0.12, z], [3.88, 0.22, 3.88], (x + z) % 8 ? this.materials.white : this.materials.pale);
      }
    }
    this.addBox([0, 8.12, 1], [24.2, 0.25, 42.2], this.materials.dark);
    this.addBox([-12.1, 4, 1], [0.3, 8, 42], this.materials.white);
    this.addBox([12.1, 4, 1], [0.3, 8, 42], this.materials.pale);
    this.addBox([0, 4, -20.1], [24, 8, 0.3], this.materials.white);
    this.addBox([0, 4, 22.1], [24, 8, 0.3], this.materials.pale);

    this.addBulkhead(8, this.materials.white, this.materials.pale);
    this.addBulkhead(-3.6, this.materials.pale, this.materials.white);

    this.addBox([-7.55, 3.3, -14], [8.8, 6.6, 0.34], this.materials.white);
    this.addBox([7.55, 3.3, -14], [8.8, 6.6, 0.34], this.materials.pale);
    this.addBox([0, 6.8, -14], [6.3, 2.4, 0.34], this.materials.dark);
    this.door = this.addBox([0, 1.9, -14], [5.7, 3.8, 0.28], this.materials.dark);
    const doorGlow = new THREE.Mesh(
      new THREE.BoxGeometry(5.25, 3.35, 0.06),
      new THREE.MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.13 }),
    );
    doorGlow.position.z = 0.18;
    this.door.add(doorGlow);

    this.addDetails();
    this.createBrainrotCube();
    this.createButton();
    this.createRiftSystem();
    this.createPlayerCharacter();
    this.createOverlay();
    this.resetRun(false);
  }

  addBulkhead(z, leftMaterial, rightMaterial) {
    this.addBox([-7.25, 3.8, z], [9.5, 7.6, 0.34], leftMaterial, true);
    this.addBox([7.25, 3.8, z], [9.5, 7.6, 0.34], rightMaterial, true);
    this.addBox([0, 0.52, z], [5, 1.05, 0.34], this.materials.dark, true);
    this.addBox([0, 7.22, z], [5, 1.55, 0.34], this.materials.dark, true);
    const field = this.addBox([0, 3.75, z], [4.8, 5.25, 0.08], this.materials.glass, true);
    field.renderOrder = 4;
    for (const x of [-2.5, 2.5]) this.addBox([x, 3.75, z], [0.16, 5.4, 0.5], this.materials.black, true);
  }

  addBox(position, size, material, riftSurface = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.fromArray(position);
    mesh.castShadow = material !== this.materials?.glass;
    mesh.receiveShadow = true;
    mesh.userData.riftSurface = riftSurface;
    this.world.add(mesh);
    this.aimBlockers.push(mesh);
    if (material !== this.materials?.glass) this.cameraBlockers.push(mesh);
    if (riftSurface) this.riftSurfaces.push(mesh);
    return mesh;
  }

  addDetails() {
    const platform = this.model(10, 7.2);
    platform.position.set(0, 0.03, 17.2);
    platform.rotation.y = Math.PI / 2;
    this.world.add(platform);

    const exitArch = this.model(5, 6.2, 'height');
    exitArch.position.set(0, 0.02, -16.2);
    exitArch.rotation.y = Math.PI;
    this.world.add(exitArch);
    const flag = this.model(6, 3.9, 'height');
    flag.position.set(4.35, 0.02, -18.25);
    this.world.add(flag);

    const railLeft = this.model(9, 4.8);
    railLeft.position.set(-7.8, 0.02, -8.2);
    railLeft.rotation.y = Math.PI / 2;
    this.world.add(railLeft);
    const railRight = this.model(9, 4.8);
    railRight.position.set(7.8, 0.02, -8.2);
    railRight.rotation.y = -Math.PI / 2;
    this.world.add(railRight);

    const hammer = this.model(3, 4.1);
    hammer.position.set(-8.4, 4.5, 2.2);
    hammer.rotation.z = Math.PI;
    this.world.add(hammer);
    this.motions.push({ object: hammer, type: 'swing', base: hammer.rotation.z, speed: 0.85 });
    const spinner = this.model(7, 3.8);
    spinner.position.set(8.1, 4.7, -8.3);
    spinner.rotation.z = Math.PI;
    this.world.add(spinner);
    this.motions.push({ object: spinner, type: 'spin', speed: 0.7 });
    const roller = this.model(8, 4.8);
    roller.position.set(0, 0.62, 11.2);
    this.world.add(roller);
    this.motions.push({ object: roller, type: 'roll', speed: 0.9 });

    this.world.add(this.makeLabel('RIFT LAB · ROUTE 01', new THREE.Vector3(0, 6.4, 19.6), COLORS.cyan));
    this.world.add(this.makeLabel('РАЗЛОМ A · ПЕРЕХОД', new THREE.Vector3(0, 6.15, 8.25), COLORS.cyan));
    this.world.add(this.makeLabel('РАЗЛОМ B · ПЕРЕНОС КУБА', new THREE.Vector3(0, 6.15, -3.35), COLORS.violet));
    this.world.add(this.makeLabel('РЕЗОНАНСНАЯ ПЛАТФОРМА', new THREE.Vector3(0, 6.1, -10.7), COLORS.amber));
    this.world.add(this.makeLabel('ВЫХОД', new THREE.Vector3(0, 5.7, -18.9), COLORS.green));
  }

  makeLabel(text, position, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 192;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '800 54px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = '#' + color.toString(16).padStart(6, '0');
    context.shadowBlur = 26;
    context.fillStyle = '#f7fbff';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.position.copy(position);
    sprite.scale.set(10.5, 2, 1);
    return sprite;
  }

  createBrainrotCube() {
    this.cube = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 1.55, 1.55),
      new THREE.MeshPhysicalMaterial({
        color: 0xeefcff,
        transparent: true,
        opacity: 0.2,
        roughness: 0.08,
        metalness: 0.08,
        transmission: 0.32,
        depthWrite: false,
      }),
    );
    shell.castShadow = true;
    this.cube.add(shell);
    this.cube.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(shell.geometry),
      new THREE.LineBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.94 }),
    ));
    const brainrot = this.model(2, 1.18);
    brainrot.position.y = -0.59;
    brainrot.rotation.y = Math.PI * 0.72;
    brainrot.scale.multiplyScalar(0.92);
    this.cube.add(brainrot);
    this.cube.add(new THREE.PointLight(COLORS.cyan, 2.8, 4, 2));
    this.cubeVelocity = new THREE.Vector3();
    this.world.add(this.cube);
  }

  createButton() {
    this.buttonRoot = new THREE.Group();
    this.buttonRoot.position.set(5.1, 0.02, -9.2);
    this.world.add(this.buttonRoot);
    const pad = this.model(4, 2.3);
    pad.scale.y *= 0.35;
    this.buttonRoot.add(pad);
    this.buttonRingMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.amber,
      transparent: true,
      opacity: 0.86,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.075, 10, 56), this.buttonRingMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    this.buttonRoot.add(ring);
  }

  createRiftSystem() {
    this.riftBeacon = this.makeRiftBeacon();
    this.setRiftBeacon(new THREE.Vector3(0, 1.34, 8.21), new THREE.Vector3(0, 0, 1), false);
  }

  makeRiftBeacon() {
    const group = new THREE.Group();
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: COLORS.cyan,
      emissive: COLORS.cyan,
      emissiveIntensity: 3.2,
      roughness: 0.24,
      metalness: 0.22,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.9, 6), ringMaterial);
    const fillMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, colorA: { value: new THREE.Color(COLORS.cyan) }, colorB: { value: new THREE.Color(COLORS.violet) } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 vUv; uniform float time; uniform vec3 colorA; uniform vec3 colorB; void main(){vec2 p=vUv-.5;float r=length(p);float wave=.5+.5*sin(r*38.-time*7.+atan(p.y,p.x)*3.);float alpha=smoothstep(.52,.08,r)*(.38+wave*.35);vec3 color=mix(colorA,colorB,wave);gl_FragColor=vec4(color,alpha);}',
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.64, 48), fillMaterial);
    fill.position.z = 0.018;
    fill.renderOrder = 7;
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(0.48, 0.53, 6),
      new THREE.MeshBasicMaterial({ color: COLORS.violet, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    inner.position.z = 0.026;
    group.add(fill, ring, inner);
    group.scale.set(0.95, 1.18, 1);
    group.visible = false;
    this.world.add(group);
    return {
      group,
      ring,
      inner,
      fillMaterial,
      position: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 0, 1),
      quaternion: new THREE.Quaternion(),
      placed: false,
    };
  }

  setRiftBeacon(position, normal, announce = true) {
    const frame = makeRiftFrame(position, normal);
    this.riftBeacon.position.copy(frame.position).addScaledVector(frame.normal, 0.02);
    this.riftBeacon.normal.copy(frame.normal);
    this.riftBeacon.quaternion.copy(frame.quaternion);
    this.riftBeacon.group.position.copy(this.riftBeacon.position);
    this.riftBeacon.group.quaternion.copy(this.riftBeacon.quaternion);
    this.riftBeacon.group.visible = true;
    this.riftBeacon.placed = true;
    if (announce) {
      this.audio.tone(610, 0.14, 'sine', 0.04);
      this.callbacks.onToast('РАЗЛОМ-МАЯК УСТАНОВЛЕН — ПКМ ИЛИ Q ДЛЯ МАРШРУТА');
    }
  }

  createPlayerCharacter() {
    this.playerGroup = new THREE.Group();
    this.playerVisual = this.model(1, 2.5, 'height');
    this.playerGroup.add(this.playerVisual);
    this.world.add(this.playerGroup);

    this.playerCarrier = new THREE.Group();
    this.world.add(this.playerCarrier);
    this.playerAppearance = new PlayerAppearanceBaseline({
      visual: this.playerVisual,
      carrier: this.playerCarrier,
    });

    this.weaponRig = new THREE.Group();
    this.weaponRig.position.set(0.72, 1.05, 0.18);
    this.playerGroup.add(this.weaponRig);
    this.riftCaster = this.model(11, 0.82);
    this.riftCaster.rotation.set(0.08, -0.35, -0.08);
    this.weaponRig.add(this.riftCaster);
    const weaponGlow = new THREE.PointLight(COLORS.cyan, 1.7, 2.7, 2);
    weaponGlow.position.set(0, 0.2, -0.3);
    this.weaponRig.add(weaponGlow);

    this.phaseHalo = new THREE.Group();
    for (let index = 0; index < 3; index += 1) {
      const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.72 + index * 0.15, 0.025, 6, 42),
        new THREE.MeshBasicMaterial({
          color: index % 2 ? COLORS.violet : COLORS.cyan,
          transparent: true,
          opacity: 0.66,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      halo.rotation.set(Math.PI / 2, index * 0.7, index * 0.9);
      halo.position.y = 1.15;
      this.phaseHalo.add(halo);
    }
    this.phaseHalo.visible = false;
    this.playerGroup.add(this.phaseHalo);
  }

  createOverlay() {
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'portal-crosshair rift-crosshair';
    this.crosshair.innerHTML = '<i></i><i></i>';
    document.body.appendChild(this.crosshair);
    this.portalHelp = document.createElement('div');
    this.portalHelp.className = 'portal-help rift-help';
    this.portalHelp.innerHTML = '<span><b class="portal-dot portal-dot--blue"></b>ЛКМ — маяк</span><span><b class="portal-dot portal-dot--orange"></b>ПКМ / Q — фазовый маршрут</span><span><kbd>E</kbd> взять / бросить куб</span>';
    document.body.appendChild(this.portalHelp);
    this.actionPrompt = document.createElement('div');
    this.actionPrompt.className = 'portal-action';
    document.body.appendChild(this.actionPrompt);
    this.createMobileActions();
  }

  createMobileActions() {
    const controls = document.createElement('div');
    controls.className = 'portal-mobile-actions';
    const actions = [
      ['◆', () => this.placeRiftBeacon(), 'portal-fire portal-fire--blue'],
      ['↯', () => this.activateRiftRoute(), 'portal-fire portal-fire--orange'],
      ['E', () => { this.interactQueued = true; }, 'portal-fire portal-fire--use'],
    ];
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action[2];
      button.textContent = action[0];
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        action[1]();
      });
      controls.appendChild(button);
    }
    document.body.appendChild(controls);
    this.mobilePortalControls = controls;
  }

  placeRiftBeacon() {
    if (this.state !== 'playing' || this.riftTravel) return;
    this.raycaster.setFromCamera(this.centerPointer, this.camera);
    const [hit] = this.raycaster.intersectObjects(this.aimBlockers, false);
    if (!hit?.face || !hit.object.userData.riftSurface) {
      this.callbacks.onToast('МАЯК СТАВИТСЯ ТОЛЬКО НА ШЕСТИУГОЛЬНЫЕ ФАЗОВЫЕ СТЕНЫ');
      return;
    }
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    if (Math.abs(normal.z) < 0.82) {
      this.callbacks.onToast('ЭТА ГРАНЬ НЕ ПОДДЕРЖИВАЕТ ФАЗОВЫЙ МАРШРУТ');
      return;
    }
    const position = hit.point.clone();
    position.x = THREE.MathUtils.clamp(position.x, -10.35, 10.35);
    position.y = THREE.MathUtils.clamp(position.y, 1.25, 5.65);
    this.setRiftBeacon(position, normal);
    this.gunKick = 1;
    this.aimTimer = 0.55;
  }

  activateRiftRoute() {
    if (this.state !== 'playing' || this.riftTravel) return;
    if (!this.riftBeacon?.placed) {
      this.callbacks.onToast('СНАЧАЛА ПОСТАВЬ РАЗЛОМ-МАЯК [ЛКМ]');
      return;
    }
    if (this.riftCooldown > 0) {
      this.callbacks.onToast('РЕЗОНАТОР ПЕРЕЗАРЯЖАЕТСЯ');
      return;
    }
    const toPlayer = this.playerPosition.clone().sub(this.riftBeacon.position);
    const side = toPlayer.dot(this.riftBeacon.normal);
    const distance = toPlayer.length();
    if (side < 0.35) {
      this.callbacks.onToast('МАЯК НА ОБРАТНОЙ СТОРОНЕ — ПОСТАВЬ ЕГО ЗАНОВО');
      return;
    }
    if (distance > 18.5) {
      this.callbacks.onToast('МАЯК СЛИШКОМ ДАЛЕКО');
      return;
    }

    const route = buildRiftRoute(this.playerPosition, this.riftBeacon);
    const duration = THREE.MathUtils.clamp(0.46 + route.distance / 18, 0.55, 1.08);
    this.riftTravel = {
      route,
      elapsed: 0,
      duration,
      incomingVelocity: this.playerVelocity.clone(),
    };
    this.riftCooldown = duration + 0.72;
    this.riftUsed = true;
    this.riftTrailLife = 1;
    this.createRiftTrail(route);
    this.phaseHalo.visible = true;
    this.gunKick = 1;
    this.audio.tone(170, 0.2, 'sine', 0.045);
    this.audio.tone(530, 0.28, 'triangle', 0.035, 0.04);
    this.callbacks.onToast('ФАЗОВЫЙ МАРШРУТ СОБРАН — СКОРОСТЬ ЗАПИСАНА');
  }

  createRiftTrail(route) {
    if (this.riftTrail) {
      this.world.remove(this.riftTrail);
      this.riftTrail.geometry.dispose();
      this.riftTrail.material.dispose();
    }
    const curve = new THREE.QuadraticBezierCurve3(route.start, route.control, route.end);
    this.riftTrail = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 48, 0.075, 8, false),
      new THREE.MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.riftTrail.renderOrder = 8;
    this.world.add(this.riftTrail);
  }

  start() {
    this.audio.unlock();
    this.resetRun(true);
    this.renderer.domElement.requestPointerLock?.();
  }

  restart() {
    this.audio.unlock();
    this.resetRun(true);
    this.callbacks.onPause(false);
  }

  resetRun(playing = true) {
    this.state = playing ? 'playing' : 'ready';
    this.elapsed = 0;
    this.yaw = 0;
    this.pitch = -0.2;
    this.playerPosition.set(0, 0, 17);
    this.playerVelocity.set(0, 0, 0);
    this.playerGrounded = true;
    this.playerFacing = Math.PI;
    this.riftCooldown = 0;
    this.riftTravel = null;
    this.riftTrailLife = 0;
    this.riftUsed = false;
    this.heldCube = false;
    this.buttonActivated = false;
    this.doorProgress = 0;
    this.door.position.y = 1.9;
    this.cube.position.set(-4.8, 0.79, 1.8);
    this.cube.rotation.set(0, 0.35, 0);
    this.cubeVelocity.set(0, 0, 0);
    this.setRiftBeacon(new THREE.Vector3(0, 1.34, 8.21), new THREE.Vector3(0, 0, 1), false);
    if (this.riftTrail) this.riftTrail.visible = false;
    if (this.phaseHalo) this.phaseHalo.visible = false;
    this.playerGroup.position.copy(this.playerPosition);
    this.playerGroup.rotation.set(0, this.playerFacing, 0);
    this.playerVisual.position.set(0, 0, 0);
    this.playerVisual.rotation.set(0, 0, 0);
    this.playerAppearance.reset();
    this.playerGroup.updateWorldMatrix(true, true);
    this.playerAppearance.snapCarrierToBody();
    this.updateCamera(1, true);
    this.emitHud();
    if (playing) this.callbacks.onToast('ЛКМ — ПЕРЕСТАВИТЬ МАЯК · ПКМ ИЛИ Q — ПРОЙТИ СКВОЗЬ СТЕНУ');
  }

  togglePause(force) {
    if (!['playing', 'paused'].includes(this.state)) return;
    const shouldPause = typeof force === 'boolean' ? force : this.state === 'playing';
    this.state = shouldPause ? 'paused' : 'playing';
    if (shouldPause) document.exitPointerLock?.();
    else this.renderer.domElement.requestPointerLock?.();
    this.callbacks.onPause(shouldPause);
    this.lastFrame = performance.now();
  }

  animate(now) {
    const dt = Math.min(Math.max((now - this.lastFrame) / 1000, 0), 0.04);
    this.lastFrame = now;
    const time = now / 1000;
    this.updateVisuals(dt, time);
    if (this.state === 'paused' && this.input.consumePause()) this.togglePause(false);
    if (this.state === 'playing') {
      if (this.input.consumePause()) this.togglePause(true);
      else if (this.input.consumeRestart()) this.restart();
      else this.updatePlaying(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  updatePlaying(dt) {
    this.elapsed += dt * 1000;
    this.riftCooldown = Math.max(0, this.riftCooldown - dt);
    this.aimTimer = Math.max(0, this.aimTimer - dt);
    if (this.interactQueued) {
      this.interactQueued = false;
      this.toggleCube();
    }
    this.updatePlayer(dt);
    this.updateCube(dt);
    this.updatePuzzle(dt);
    this.updateCamera(dt);
    this.emitHud();
  }

  updatePlayer(dt) {
    if (this.riftTravel) {
      this.updateRiftTravel(dt);
      return;
    }
    const previous = this.playerPosition.clone();
    const move = this.input.getMove();
    const desired = new THREE.Vector3(move.x, 0, move.y)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
      .multiplyScalar(this.heldCube ? 4.5 : 5.7);
    const control = this.playerGrounded ? 13 : 4.5;
    this.playerVelocity.x = THREE.MathUtils.damp(this.playerVelocity.x, desired.x, control, dt);
    this.playerVelocity.z = THREE.MathUtils.damp(this.playerVelocity.z, desired.z, control, dt);
    if (this.input.consumeJump() && this.playerGrounded) {
      this.playerVelocity.y = 7.6;
      this.playerGrounded = false;
      this.audio.jump();
    }
    this.playerVelocity.y -= 19.5 * dt;
    this.playerPosition.addScaledVector(this.playerVelocity, dt);
    this.resolvePlayerCollisions(previous);

    const planarSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    if (planarSpeed > 0.2) {
      const targetFacing = Math.atan2(this.playerVelocity.x, this.playerVelocity.z);
      this.playerFacing = this.lerpAngle(this.playerFacing, targetFacing, 1 - Math.exp(-dt * 11));
    } else if (this.aimTimer > 0) {
      const aim = forwardFromYawPitch(this.yaw, 0);
      this.playerFacing = this.lerpAngle(this.playerFacing, Math.atan2(aim.x, aim.z), 1 - Math.exp(-dt * 13));
    }
    this.playerGroup.position.copy(this.playerPosition);
    this.playerGroup.rotation.y = this.playerFacing;
    this.playerAppearance.update();
  }

  updateRiftTravel(dt) {
    const travel = this.riftTravel;
    travel.elapsed += dt;
    const raw = THREE.MathUtils.clamp(travel.elapsed / travel.duration, 0, 1);
    const eased = raw * raw * (3 - 2 * raw);
    sampleRiftRoute(travel.route, eased, this.playerPosition);
    const tangent = riftRouteTangent(travel.route, eased, this.tempVector);
    this.playerVelocity.copy(tangent).multiplyScalar(travel.route.distance / travel.duration);
    this.playerGrounded = false;
    this.playerFacing = this.lerpAngle(
      this.playerFacing,
      Math.atan2(tangent.x, tangent.z),
      1 - Math.exp(-dt * 16),
    );
    this.playerGroup.position.copy(this.playerPosition);
    this.playerGroup.rotation.y = this.playerFacing;
    this.playerAppearance.update();

    if (raw < 1) return;
    this.playerPosition.copy(travel.route.end);
    this.playerVelocity.copy(calculateRiftExitVelocity(travel.incomingVelocity, travel.route));
    this.playerGrounded = this.playerPosition.y <= 0.05;
    if (this.playerGrounded) {
      this.playerPosition.y = 0;
      this.playerVelocity.y = Math.max(0, this.playerVelocity.y);
    }
    this.riftTravel = null;
    this.phaseHalo.visible = false;
    this.audio.tone(760, 0.16, 'triangle', 0.035);
    this.callbacks.onToast('МАРШРУТ ЗАВЕРШЕН — ИМПУЛЬС ВОЗВРАЩЕН');
  }

  resolvePlayerCollisions(previous) {
    this.playerGrounded = false;
    if (this.playerPosition.y <= 0) {
      this.playerPosition.y = 0;
      this.playerVelocity.y = Math.max(0, this.playerVelocity.y);
      this.playerGrounded = true;
    }
    this.playerPosition.x = THREE.MathUtils.clamp(
      this.playerPosition.x,
      ROOM.minX + PLAYER_RADIUS,
      ROOM.maxX - PLAYER_RADIUS,
    );
    this.playerPosition.z = THREE.MathUtils.clamp(
      this.playerPosition.z,
      ROOM.minZ + PLAYER_RADIUS,
      ROOM.maxZ - PLAYER_RADIUS,
    );
    this.blockPlayerPlane(previous, 8);
    this.blockPlayerPlane(previous, -3.6);
    if (!this.exitPassageClear(this.playerPosition, PLAYER_RADIUS, this.playerPosition.y, PLAYER_HEIGHT)) {
      this.blockPlayerPlane(previous, -14);
    }
    if (!this.buttonActivated && this.playerPosition.z < -17.8) this.playerPosition.z = -17.8;
  }

  blockPlayerPlane(previous, z) {
    const clearance = PLAYER_RADIUS + WALL_HALF_THICKNESS;
    if (previous.z >= z && this.playerPosition.z < z + clearance) {
      this.playerPosition.z = z + clearance;
      this.playerVelocity.z = Math.max(0, this.playerVelocity.z);
    } else if (previous.z <= z && this.playerPosition.z > z - clearance) {
      this.playerPosition.z = z - clearance;
      this.playerVelocity.z = Math.min(0, this.playerVelocity.z);
    }
  }

  exitPassageClear(position, radius, bottom = position.y - radius, height = radius * 2) {
    // The raised panel only opens the central doorway, never the side walls.
    const openingHeight = Math.min(5.6, this.doorProgress * 5.2);
    return this.buttonActivated && Math.abs(position.x) + radius <= 2.85
      && bottom + height <= openingHeight - 0.05;
  }

  constrainHeldCube(position) {
    position.x = THREE.MathUtils.clamp(position.x, ROOM.minX + CUBE_RADIUS, ROOM.maxX - CUBE_RADIUS);
    position.z = THREE.MathUtils.clamp(position.z, ROOM.minZ + CUBE_RADIUS, ROOM.maxZ - CUBE_RADIUS);
    const planes = [8, -3.6];
    if (!this.exitPassageClear(position, CUBE_RADIUS)) planes.push(-14);
    for (const z of planes) {
      // Use the player's chamber, not the lagging cube's previous side. This
      // also resolves the final travel frame after riftTravel becomes null.
      const clearance = CUBE_RADIUS + WALL_HALF_THICKNESS;
      position.z = this.playerPosition.z >= z
        ? Math.max(position.z, z + clearance)
        : Math.min(position.z, z - clearance);
    }
    return position;
  }

  updateCube(dt) {
    if (this.heldCube) {
      const forward = forwardFromYawPitch(this.yaw, 0);
      const target = this.playerPosition.clone().add(new THREE.Vector3(0, 1.03, 0)).addScaledVector(forward, 1.35);
      if (!this.riftTravel) this.constrainHeldCube(target);
      this.cube.position.lerp(target, 1 - Math.exp(-dt * (this.riftTravel ? 28 : 16)));
      if (!this.riftTravel) this.constrainHeldCube(this.cube.position);
      this.cubeVelocity.copy(this.playerVelocity);
      return;
    }
    const previous = this.cube.position.clone();
    this.cubeVelocity.y -= 16.5 * dt;
    this.cube.position.addScaledVector(this.cubeVelocity, dt);
    if (this.cube.position.y < 0.79) {
      this.cube.position.y = 0.79;
      if (this.cubeVelocity.y < -1.5) this.cubeVelocity.y *= -0.18;
      else this.cubeVelocity.y = 0;
      this.cubeVelocity.x *= Math.exp(-dt * 4.5);
      this.cubeVelocity.z *= Math.exp(-dt * 4.5);
    }
    this.cube.position.x = THREE.MathUtils.clamp(this.cube.position.x, ROOM.minX + 0.8, ROOM.maxX - 0.8);
    this.cube.position.z = THREE.MathUtils.clamp(this.cube.position.z, ROOM.minZ + 0.8, ROOM.maxZ - 0.8);
    this.blockCubePlane(previous, 8);
    this.blockCubePlane(previous, -3.6);
    if (!this.exitPassageClear(this.cube.position, CUBE_RADIUS)) this.blockCubePlane(previous, -14);
    this.cube.rotation.x += this.cubeVelocity.z * dt * 0.25;
    this.cube.rotation.z -= this.cubeVelocity.x * dt * 0.25;
  }

  blockCubePlane(previous, z) {
    const radius = CUBE_RADIUS + WALL_HALF_THICKNESS;
    if (previous.z >= z && this.cube.position.z < z + radius) {
      this.cube.position.z = z + radius;
      this.cubeVelocity.z = Math.max(0, this.cubeVelocity.z) * 0.18;
    } else if (previous.z <= z && this.cube.position.z > z - radius) {
      this.cube.position.z = z - radius;
      this.cubeVelocity.z = Math.min(0, this.cubeVelocity.z) * 0.18;
    }
  }

  toggleCube() {
    if (this.riftTravel) return;
    if (this.heldCube) {
      this.heldCube = false;
      const forward = forwardFromYawPitch(this.yaw, this.pitch);
      this.cubeVelocity.copy(this.playerVelocity).addScaledVector(forward, 2.6);
      this.callbacks.onToast('BRAINROT-КУБ ОТПУЩЕН');
      return;
    }
    const playerCenter = this.playerPosition.clone().add(new THREE.Vector3(0, 1, 0));
    if (playerCenter.distanceTo(this.cube.position) <= 3) {
      if (!this.cubeVisibleFrom(playerCenter)) {
        this.callbacks.onToast('КУБ ЗА СТЕНОЙ — СНАЧАЛА ПРОЙДИ К НЕМУ');
        return;
      }
      this.heldCube = true;
      this.cubeVelocity.set(0, 0, 0);
      this.audio.pickup();
      this.callbacks.onToast('КУБ СВЯЗАН С РЕЗОНАТОРОМ');
    } else {
      this.callbacks.onToast('ПОДОЙДИ БЛИЖЕ К КУБУ');
    }
  }

  cubeVisibleFrom(origin) {
    const direction = this.cube.position.clone().sub(origin);
    const distance = direction.length();
    if (distance < 0.001) return true;
    // A separate ray keeps aiming's distance unlimited after interactions.
    const ray = new THREE.Raycaster(origin, direction.normalize(), 0, distance - 0.001);
    for (const object of this.aimBlockers) object.updateWorldMatrix(true, false);
    return ray.intersectObjects(this.aimBlockers, false).length === 0;
  }

  updatePuzzle(dt) {
    if (!this.buttonActivated && !this.heldCube) {
      const dx = this.cube.position.x - this.buttonRoot.position.x;
      const dz = this.cube.position.z - this.buttonRoot.position.z;
      if (Math.hypot(dx, dz) < 1.35 && this.cube.position.y < 1.2) {
        this.buttonActivated = true;
        this.audio.checkpoint();
        this.callbacks.onToast('РЕЗОНАНС СОВПАЛ — ВЫХОД ОТКРЫТ');
      }
    }
    this.doorProgress = THREE.MathUtils.damp(this.doorProgress, this.buttonActivated ? 1 : 0, 4.6, dt);
    this.door.position.y = THREE.MathUtils.lerp(1.9, 7.1, this.doorProgress);
    this.buttonRingMaterial.color.setHex(this.buttonActivated ? COLORS.green : COLORS.amber);
    this.buttonRingMaterial.opacity = this.buttonActivated ? 1 : 0.72;
    if (this.buttonActivated && this.playerPosition.z < -18.05 && Math.abs(this.playerPosition.x) < 5.5) {
      this.win();
    }
  }

  updateCamera(dt, snap = false) {
    const look = this.playerPosition.clone().add(new THREE.Vector3(0, PLAYER_EYE, 0));
    const forward = forwardFromYawPitch(this.yaw, this.pitch);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const desired = look.clone().addScaledVector(forward, -6.2).addScaledVector(right, 0.72);
    for (const object of this.cameraBlockers) object.updateWorldMatrix(true, false);
    const keepVisible = (position) => {
      const offset = position.clone().sub(look);
      const distance = offset.length();
      if (distance <= 0.001) return false;
      this.cameraRaycaster.set(look, offset.normalize());
      this.cameraRaycaster.far = distance;
      const [hit] = this.cameraRaycaster.intersectObjects(this.cameraBlockers, false);
      if (!hit || hit.distance >= distance) return false;
      position.copy(look).addScaledVector(offset, Math.max(0, hit.distance - 0.28));
      return true;
    };
    const obstructed = keepVisible(desired);
    // Retract immediately; only the return to a longer boom is smoothed.
    if (snap || (obstructed && desired.distanceTo(look) < this.camera.position.distanceTo(look))) {
      this.camera.position.copy(desired);
    } else {
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * (this.riftTravel ? 8.5 : 6.2)));
    }
    // The interpolated position can follow a different ray around a corner.
    keepVisible(this.camera.position);
    const aimPoint = look.clone().addScaledVector(forward, 18);
    this.camera.lookAt(aimPoint);
    this.camera.getWorldDirection(this.cameraForward);
  }

  updateVisuals(dt, time) {
    if (this.riftBeacon) {
      this.riftBeacon.fillMaterial.uniforms.time.value = time;
      this.riftBeacon.ring.rotation.z = time * 0.42;
      this.riftBeacon.inner.rotation.z = -time * 0.74;
      const pulse = 1 + Math.sin(time * 4.2) * 0.035;
      this.riftBeacon.group.scale.set(0.95 * pulse, 1.18 * pulse, 1);
    }
    for (const motion of this.motions) {
      if (motion.type === 'swing') motion.object.rotation.z = motion.base + Math.sin(time * motion.speed) * 0.34;
      if (motion.type === 'spin') motion.object.rotation.y += dt * motion.speed;
      if (motion.type === 'roll') motion.object.rotation.x += dt * motion.speed;
    }
    if (this.riftTrail && !this.riftTravel) {
      this.riftTrailLife = Math.max(0, this.riftTrailLife - dt * 0.8);
      this.riftTrail.material.opacity = this.riftTrailLife * 0.72;
      this.riftTrail.visible = this.riftTrailLife > 0;
    } else if (this.riftTrail) {
      this.riftTrail.visible = true;
      this.riftTrail.material.opacity = 0.55 + Math.sin(time * 16) * 0.16;
    }
    if (this.phaseHalo?.visible) {
      this.phaseHalo.rotation.y += dt * 5.4;
      this.phaseHalo.rotation.z += dt * 2.1;
    }
    if (this.buttonRoot) {
      this.buttonRoot.position.y = 0.02 - (this.buttonActivated ? 0.035 : 0) + Math.sin(time * 2.2) * 0.008;
    }
    if (this.weaponRig) {
      const speed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
      const bob = this.playerGrounded ? Math.sin(time * 8.4) * Math.min(speed / 5.7, 1) : 0;
      this.gunKick = THREE.MathUtils.damp(this.gunKick, 0, 15, dt);
      this.weaponRig.position.set(0.72 + bob * 0.018, 1.05 + Math.abs(bob) * 0.025, 0.18 + this.gunKick * 0.08);
      this.weaponRig.rotation.x = this.gunKick * 0.09;
    }
    if (this.actionPrompt && this.cube) {
      const playerCenter = this.playerPosition.clone().add(new THREE.Vector3(0, 1, 0));
      const distance = playerCenter.distanceTo(this.cube.position);
      this.actionPrompt.textContent = this.heldCube
        ? '[E] БРОСИТЬ КУБ'
        : distance < 3 ? '[E] ВЗЯТЬ BRAINROT-КУБ' : '';
    }
  }

  emitHud() {
    const passedFirstWall = this.playerPosition.z < 7.5;
    const passedSecondWall = this.playerPosition.z < -4.1;
    let progress = 0.08;
    let objective = 'Поставь маяк [ЛКМ] и запусти фазовый маршрут [ПКМ / Q]';
    let checkpoint = 0;
    if (passedFirstWall || this.riftUsed) {
      progress = 0.32;
      checkpoint = 1;
      objective = this.heldCube ? 'Поставь маяк на второй стене и пронеси куб через маршрут' : 'Найди и возьми Brainrot-куб [E]';
    }
    if (passedSecondWall) {
      progress = this.heldCube ? 0.66 : 0.74;
      objective = this.heldCube ? 'Поставь куб на оранжевую резонансную платформу' : 'Проверь резонансную платформу';
    }
    if (this.buttonActivated) {
      progress = 0.9;
      checkpoint = 2;
      objective = 'Иди к открытому выходу';
    }
    this.callbacks.onHud({
      elapsed: this.elapsed,
      best: Number.NaN,
      progress,
      objective,
      hasCargo: this.heldCube,
      checkpoint,
    });
  }

  win() {
    if (this.state !== 'playing') return;
    this.state = 'won';
    document.exitPointerLock?.();
    this.audio.win();
    this.callbacks.onWin({ elapsed: this.elapsed, best: this.elapsed, newRecord: false, portalMode: true, riftMode: true });
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.55));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  lerpAngle(current, target, amount) {
    let delta = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * amount;
  }
}
