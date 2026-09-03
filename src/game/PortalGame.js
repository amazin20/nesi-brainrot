import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { InputController } from './InputController.js';
import { AudioController } from './AudioController.js';
import {
  crossingPortal,
  forwardFromYawPitch,
  makePortalFrame,
  portalContainsPoint,
  transferThroughPortal,
  yawPitchFromForward,
} from './portalMath.js';

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
  blue: 0x35d6ff,
  orange: 0xff9b42,
  green: 0x9cff66,
  white: 0xe9eef1,
  panel: 0xb9c3c8,
  ink: 0x10171c,
};

const noop = () => {};
const PLAYER_RADIUS = 0.42;
const EYE_HEIGHT = 1.68;
const ROOM = Object.freeze({ minX: -11.72, maxX: 11.72, minZ: -19.72, maxZ: 21.72 });

export class PortalGame {
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
    this.portalSurfaces = [];
    this.motions = [];
    this.state = 'loading';
    this.elapsed = 0;
    this.lastFrame = performance.now();
    this.yaw = 0;
    this.pitch = 0;
    this.playerPosition = new THREE.Vector3(0, EYE_HEIGHT, 17);
    this.playerVelocity = new THREE.Vector3();
    this.playerGrounded = true;
    this.portalCooldown = 0;
    this.cubePortalCooldown = 0;
    this.interactQueued = false;
    this.heldCube = false;
    this.teleportedOnce = false;
    this.buttonActivated = false;
    this.doorProgress = 0;
    this.gunKick = 0;
    this.raycaster = new THREE.Raycaster();
    this.centerPointer = new THREE.Vector2(0, 0);
    this.cameraForward = new THREE.Vector3();
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
    this.callbacks.onReady({ portalMode: true });
    this.emitHud();
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1418);
    this.scene.fog = new THREE.FogExp2(0x182329, 0.018);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.045, 160);
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
    for (const [x, z, color] of [[-8, 14, COLORS.blue], [8, 0, 0xffffff], [-4, -14, COLORS.orange]]) {
      const light = new THREE.PointLight(color, 8, 18, 2);
      light.position.set(x, 6.8, z);
      this.scene.add(light);
    }
    window.addEventListener('resize', () => this.resize());
  }

  setupControls() {
    const canvas = this.renderer.domElement;
    this.onMouseMove = (event) => {
      if (document.pointerLockElement !== canvas || this.state !== 'playing') return;
      this.yaw -= event.movementX * 0.00225;
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.002, -1.37, 1.37);
    };
    this.onMouseDown = (event) => {
      if (this.state !== 'playing') return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
        return;
      }
      if (event.button === 0) this.shootPortal(0);
      if (event.button === 2) this.shootPortal(1);
    };
    this.onKeyDown = (event) => {
      if (event.code === 'KeyE' && !event.repeat) this.interactQueued = true;
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
    draco.setDecoderPath(`${base}draco/`);
    draco.setDecoderConfig({ type: 'wasm' });
    draco.preload();
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    let completed = 0;
    this.callbacks.onProgress({ completed, total: MODEL_FILES.length, label: 'Загрузка лаборатории...' });
    await Promise.all(MODEL_FILES.map((file, index) => new Promise((resolve) => {
      loader.load(
        `${base}models/${file}`,
        (gltf) => {
          this.assets.set(index + 1, gltf.scene);
          resolve();
        },
        undefined,
        (error) => {
          console.warn(`Portal Lab model ${index + 1} failed to load.`, error);
          this.assets.set(index + 1, this.createFallback(index + 1));
          resolve();
        },
      );
    }).finally(() => {
      completed += 1;
      this.callbacks.onProgress({ completed, total: MODEL_FILES.length, label: `Модель ${completed} из ${MODEL_FILES.length}` });
    })));
    draco.dispose();
  }

  createFallback(id) {
    const root = new THREE.Group();
    const color = id === 11 ? COLORS.blue : id % 2 ? COLORS.orange : COLORS.green;
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
      if (child.material) {
        child.material = child.material.clone();
        for (const name of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          if (child.material[name]) child.material[name].anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
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
        color: 0xaeeeff, transparent: true, opacity: 0.2, roughness: 0.08,
        metalness: 0, transmission: 0.45, depthWrite: false, side: THREE.DoubleSide,
      }),
    };

    for (let x = -10; x <= 10; x += 4) {
      for (let z = -18; z <= 20; z += 4) {
        this.addBox([x, -0.12, z], [3.88, 0.22, 3.88], (x + z) % 8 ? this.materials.white : this.materials.pale);
      }
    }
    this.addBox([0, 8.12, 1], [24.2, 0.25, 42.2], this.materials.dark);
    this.addBox([-12.1, 4, 1], [0.3, 8, 42], this.materials.white, true);
    this.addBox([12.1, 4, 1], [0.3, 8, 42], this.materials.pale, true);
    this.addBox([0, 4, -20.1], [24, 8, 0.3], this.materials.white, true);
    this.addBox([0, 4, 22.1], [24, 8, 0.3], this.materials.pale, true);

    this.addBox([-8.1, 3.8, 8], [7.8, 7.6, 0.32], this.materials.white);
    this.addBox([8.1, 3.8, 8], [7.8, 7.6, 0.32], this.materials.pale);
    this.addBox([0, 0.52, 8], [8.4, 1.05, 0.32], this.materials.dark);
    this.addBox([0, 7.22, 8], [8.4, 1.55, 0.32], this.materials.dark);
    this.addBox([0, 3.75, 8], [7.6, 5.25, 0.08], this.materials.glass);
    for (const x of [-4.25, 4.25]) this.addBox([x, 3.75, 8], [0.18, 5.4, 0.5], this.materials.black);

    this.addBox([-7.55, 3.3, -14], [8.8, 6.6, 0.34], this.materials.white);
    this.addBox([7.55, 3.3, -14], [8.8, 6.6, 0.34], this.materials.pale);
    this.addBox([0, 6.8, -14], [6.3, 2.4, 0.34], this.materials.dark);
    this.door = this.addBox([0, 1.9, -14], [5.7, 3.8, 0.28], this.materials.dark);
    const doorGlow = new THREE.Mesh(
      new THREE.BoxGeometry(5.25, 3.35, 0.06),
      new THREE.MeshBasicMaterial({ color: COLORS.orange, transparent: true, opacity: 0.13 }),
    );
    doorGlow.position.z = 0.18;
    this.door.add(doorGlow);

    this.addDetails();
    this.createBrainrotCube();
    this.createButton();
    this.createPortals();
    this.createViewmodel();
    this.createOverlay();
    this.resetRun(false);
  }

  addBox(position, size, material, portalSurface = false) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.fromArray(position);
    mesh.castShadow = material !== this.materials?.glass;
    mesh.receiveShadow = true;
    mesh.userData.portalSurface = portalSurface;
    this.world.add(mesh);
    if (portalSurface) this.portalSurfaces.push(mesh);
    return mesh;
  }

  addDetails() {
    const platform = this.model(10, 7.2);
    platform.position.set(0, 0.03, 17.2);
    platform.rotation.y = Math.PI / 2;
    this.world.add(platform);

    const suit = this.model(1, 2.65, 'height');
    suit.position.set(8.7, 0.03, 17.8);
    suit.rotation.y = -Math.PI * 0.72;
    this.world.add(suit);
    const suitGlass = this.addBox([8.7, 1.55, 16.7], [3.1, 3.1, 0.08], this.materials.glass);
    suitGlass.renderOrder = 4;

    const exitArch = this.model(5, 6.2, 'height');
    exitArch.position.set(0, 0.02, -16.2);
    exitArch.rotation.y = Math.PI;
    this.world.add(exitArch);
    const flag = this.model(6, 3.9, 'height');
    flag.position.set(4.35, 0.02, -18.25);
    this.world.add(flag);

    const railLeft = this.model(9, 4.8);
    railLeft.position.set(-7.8, 0.02, -5.5);
    railLeft.rotation.y = Math.PI / 2;
    this.world.add(railLeft);
    const railRight = this.model(9, 4.8);
    railRight.position.set(7.8, 0.02, -5.5);
    railRight.rotation.y = -Math.PI / 2;
    this.world.add(railRight);

    const hammer = this.model(3, 4.1);
    hammer.position.set(-8.4, 4.5, 1.4);
    hammer.rotation.z = Math.PI;
    this.world.add(hammer);
    this.motions.push({ object: hammer, type: 'swing', base: hammer.rotation.z, speed: 0.85 });
    const spinner = this.model(7, 3.8);
    spinner.position.set(8.1, 4.7, 1.1);
    spinner.rotation.z = Math.PI;
    this.world.add(spinner);
    this.motions.push({ object: spinner, type: 'spin', speed: 0.7 });

    const roller = this.model(8, 5.4);
    roller.position.set(0, 0.65, 9.5);
    this.world.add(roller);
    this.motions.push({ object: roller, type: 'roll', speed: 0.9 });

    this.world.add(this.makeLabel('BRAINROT LAB · TEST 01', new THREE.Vector3(0, 6.4, 19.6), COLORS.blue));
    this.world.add(this.makeLabel('ПОМЕСТИ КУБ НА ПЛАТФОРМУ', new THREE.Vector3(0, 6.1, -4.5), COLORS.orange));
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
    context.shadowColor = `#${color.toString(16).padStart(6, '0')}`;
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
        color: 0xeefcff, transparent: true, opacity: 0.2, roughness: 0.08,
        metalness: 0.08, transmission: 0.32, depthWrite: false,
      }),
    );
    shell.castShadow = true;
    this.cube.add(shell);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(shell.geometry),
      new THREE.LineBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.94 }),
    );
    this.cube.add(edges);
    const brainrot = this.model(2, 1.18);
    brainrot.position.y = -0.59;
    brainrot.rotation.y = Math.PI * 0.72;
    brainrot.scale.multiplyScalar(0.92);
    this.cube.add(brainrot);
    const core = new THREE.PointLight(COLORS.blue, 2.8, 4, 2);
    this.cube.add(core);
    this.cubeVelocity = new THREE.Vector3();
    this.world.add(this.cube);
  }

  createButton() {
    this.buttonRoot = new THREE.Group();
    this.buttonRoot.position.set(5.1, 0.02, -8.2);
    this.world.add(this.buttonRoot);
    const pad = this.model(4, 2.3);
    pad.scale.y *= 0.35;
    this.buttonRoot.add(pad);
    this.buttonRingMaterial = new THREE.MeshBasicMaterial({ color: COLORS.orange, transparent: true, opacity: 0.86 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.075, 10, 56), this.buttonRingMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    this.buttonRoot.add(ring);
  }

  createPortals() {
    this.portals = [this.makePortal(COLORS.blue), this.makePortal(COLORS.orange)];
    this.setPortal(0, new THREE.Vector3(-11.92, 1.78, 14.4), new THREE.Vector3(1, 0, 0), false);
    this.setPortal(1, new THREE.Vector3(0, 1.78, 7.79), new THREE.Vector3(0, 0, -1), false);
  }

  makePortal(color) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.095, 14, 72),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 3.2, roughness: 0.25, metalness: 0.15 }),
    );
    const fillMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color(color) } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `
        varying vec2 vUv; uniform float time; uniform vec3 color;
        void main(){
          vec2 p=vUv-.5; float r=length(p); float a=atan(p.y,p.x);
          float swirl=.5+.5*sin(a*5.-r*24.+time*3.2);
          float center=smoothstep(.52,.04,r); float edge=smoothstep(.5,.28,r);
          vec3 c=mix(color*.18,color*(.7+swirl*.65),edge);
          gl_FragColor=vec4(c,.38+center*.42);
        }`,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.94, 72), fillMaterial);
    fill.position.z = 0.012;
    fill.renderOrder = 5;
    group.add(fill, ring);
    group.scale.set(0.78, 1.32, 1);
    this.world.add(group);
    return {
      group, fillMaterial, color,
      position: new THREE.Vector3(), normal: new THREE.Vector3(0, 0, 1), quaternion: new THREE.Quaternion(),
    };
  }

  setPortal(index, position, normal, announce = true) {
    const portal = this.portals[index];
    const frame = makePortalFrame(position, normal);
    portal.position.copy(frame.position).addScaledVector(frame.normal, 0.018);
    portal.normal.copy(frame.normal);
    portal.quaternion.copy(frame.quaternion);
    portal.group.position.copy(portal.position);
    portal.group.quaternion.copy(portal.quaternion);
    portal.group.visible = true;
    if (announce) {
      this.audio.tone(index === 0 ? 560 : 330, 0.13, 'sine', 0.035);
      this.callbacks.onToast(index === 0 ? 'ГОЛУБОЙ ПОРТАЛ УСТАНОВЛЕН' : 'ОРАНЖЕВЫЙ ПОРТАЛ УСТАНОВЛЕН');
    }
  }

  createViewmodel() {
    this.gunRig = new THREE.Group();
    this.camera.add(this.gunRig);
    this.portalGun = this.model(11, 0.82);
    this.portalGun.position.set(0.47, -0.52, -0.95);
    this.portalGun.rotation.set(0.08, -0.28, -0.08);
    this.gunRig.add(this.portalGun);
    const blueGlow = new THREE.PointLight(COLORS.blue, 1.6, 2.5, 2);
    blueGlow.position.set(0.22, -0.18, -0.75);
    this.gunRig.add(blueGlow);
  }

  createOverlay() {
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'portal-crosshair';
    this.crosshair.innerHTML = '<i></i><i></i>';
    document.body.appendChild(this.crosshair);
    this.portalHelp = document.createElement('div');
    this.portalHelp.className = 'portal-help';
    this.portalHelp.innerHTML = '<span><b class="portal-dot portal-dot--blue"></b>ЛКМ — голубой</span><span><b class="portal-dot portal-dot--orange"></b>ПКМ — оранжевый</span><span><kbd>E</kbd> взять / бросить куб</span>';
    document.body.appendChild(this.portalHelp);
    this.actionPrompt = document.createElement('div');
    this.actionPrompt.className = 'portal-action';
    document.body.appendChild(this.actionPrompt);
    this.createMobilePortalButtons();
  }

  createMobilePortalButtons() {
    const controls = document.createElement('div');
    controls.className = 'portal-mobile-actions';
    for (const [label, action, className] of [
      ['I', () => this.shootPortal(0), 'portal-fire portal-fire--blue'],
      ['II', () => this.shootPortal(1), 'portal-fire portal-fire--orange'],
      ['E', () => { this.interactQueued = true; }, 'portal-fire portal-fire--use'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.addEventListener('pointerdown', (event) => { event.preventDefault(); action(); });
      controls.appendChild(button);
    }
    document.body.appendChild(controls);
    this.mobilePortalControls = controls;
  }

  shootPortal(index) {
    if (this.state !== 'playing') return;
    this.raycaster.setFromCamera(this.centerPointer, this.camera);
    const [hit] = this.raycaster.intersectObjects(this.portalSurfaces, false);
    if (!hit?.face) {
      this.callbacks.onToast('ЗДЕСЬ НЕЛЬЗЯ ОТКРЫТЬ ПОРТАЛ');
      return;
    }
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    const position = hit.point.clone();
    position.y = THREE.MathUtils.clamp(position.y, 1.42, 6.45);
    if (Math.abs(normal.x) > 0.8) position.z = THREE.MathUtils.clamp(position.z, -18.35, 20.35);
    else position.x = THREE.MathUtils.clamp(position.x, -10.65, 10.65);
    this.setPortal(index, position, normal);
    this.gunKick = 1;
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
    this.pitch = 0;
    this.playerPosition.set(0, EYE_HEIGHT, 17);
    this.playerVelocity.set(0, 0, 0);
    this.playerGrounded = true;
    this.portalCooldown = 0;
    this.cubePortalCooldown = 0;
    this.heldCube = false;
    this.teleportedOnce = false;
    this.buttonActivated = false;
    this.doorProgress = 0;
    this.door.position.y = 1.9;
    this.cube.position.set(-5.2, 0.82, -3.8);
    this.cube.rotation.set(0, 0.35, 0);
    this.cubeVelocity.set(0, 0, 0);
    this.setPortal(0, new THREE.Vector3(-11.92, 1.78, 14.4), new THREE.Vector3(1, 0, 0), false);
    this.setPortal(1, new THREE.Vector3(0, 1.78, 7.79), new THREE.Vector3(0, 0, -1), false);
    this.updateCamera();
    this.emitHud();
    if (playing) this.callbacks.onToast('ВОЙДИ В ГОЛУБОЙ ПОРТАЛ И НАЙДИ БРЕЙНРОТ-КУБ');
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
    this.portalCooldown = Math.max(0, this.portalCooldown - dt);
    this.cubePortalCooldown = Math.max(0, this.cubePortalCooldown - dt);
    if (this.interactQueued) {
      this.interactQueued = false;
      this.toggleCube();
    }
    this.updatePlayer(dt);
    this.updateCube(dt);
    this.updatePuzzle(dt);
    this.updateCamera();
    this.emitHud();
  }

  updatePlayer(dt) {
    const previous = this.playerPosition.clone();
    const move = this.input.getMove();
    const desired = new THREE.Vector3(move.x, 0, move.y)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw)
      .multiplyScalar(this.heldCube ? 4.3 : 5.25);
    const control = this.playerGrounded ? 13 : 4.5;
    this.playerVelocity.x = THREE.MathUtils.damp(this.playerVelocity.x, desired.x, control, dt);
    this.playerVelocity.z = THREE.MathUtils.damp(this.playerVelocity.z, desired.z, control, dt);
    if (this.input.consumeJump() && this.playerGrounded) {
      this.playerVelocity.y = 7.6;
      this.playerGrounded = false;
      this.audio.jump();
    }
    this.playerVelocity.y -= 19.5 * dt;
    const next = this.playerPosition.clone().addScaledVector(this.playerVelocity, dt);
    const teleported = this.tryTeleport(previous, next, this.playerVelocity, true);
    if (!teleported) this.playerPosition.copy(next);
    this.resolvePlayerCollisions(previous);
  }

  tryTeleport(previous, next, velocity, isPlayer) {
    const cooldown = isPlayer ? this.portalCooldown : this.cubePortalCooldown;
    if (cooldown > 0) return false;
    for (let index = 0; index < 2; index += 1) {
      const source = this.portals[index];
      const target = this.portals[1 - index];
      if (!source.group.visible || !target.group.visible) continue;
      if (!crossingPortal(previous, next, source, { x: isPlayer ? 0.72 : 0.62, y: isPlayer ? 1.2 : 1.05 })) continue;
      const transfer = transferThroughPortal(next, velocity, source, target, isPlayer ? 0.68 : 0.52);
      if (isPlayer) {
        this.playerPosition.copy(transfer.position);
        this.playerVelocity.copy(transfer.velocity);
        const facing = forwardFromYawPitch(this.yaw, this.pitch).applyQuaternion(transfer.rotation);
        const angles = yawPitchFromForward(facing);
        this.yaw = angles.yaw;
        this.pitch = THREE.MathUtils.clamp(angles.pitch, -1.37, 1.37);
        this.portalCooldown = 0.34;
        if (!this.teleportedOnce) {
          this.teleportedOnce = true;
          this.callbacks.onToast('ПОРТАЛЬНЫЙ ПЕРЕХОД УСПЕШЕН — НАЙДИ КУБ');
        }
      } else {
        this.cube.position.copy(transfer.position);
        this.cubeVelocity.copy(transfer.velocity);
        this.cubePortalCooldown = 0.28;
      }
      this.audio.tone(190, 0.12, 'sine', 0.04);
      this.audio.tone(480, 0.16, 'triangle', 0.03, 0.05);
      return true;
    }
    return false;
  }

  resolvePlayerCollisions(previous) {
    this.playerGrounded = false;
    if (this.playerPosition.y <= EYE_HEIGHT) {
      this.playerPosition.y = EYE_HEIGHT;
      this.playerVelocity.y = Math.max(0, this.playerVelocity.y);
      this.playerGrounded = true;
    }
    const throughSidePortal = this.isInsideBoundaryPortal(this.playerPosition, 'x', { x: 0.72, y: 1.2 });
    const throughEndPortal = this.isInsideBoundaryPortal(this.playerPosition, 'z', { x: 0.72, y: 1.2 });
    if (!throughSidePortal) {
      this.playerPosition.x = THREE.MathUtils.clamp(this.playerPosition.x, ROOM.minX + PLAYER_RADIUS, ROOM.maxX - PLAYER_RADIUS);
    }
    if (!throughEndPortal) {
      this.playerPosition.z = THREE.MathUtils.clamp(this.playerPosition.z, ROOM.minZ + PLAYER_RADIUS, ROOM.maxZ - PLAYER_RADIUS);
    }
    this.blockPlane(previous, this.playerPosition, 8, PLAYER_RADIUS, true);
    if (!this.buttonActivated && Math.abs(this.playerPosition.x) < 3.05) {
      this.blockPlane(previous, this.playerPosition, -14, PLAYER_RADIUS, true);
    }
    if (!this.buttonActivated && this.playerPosition.z < -17.8) this.playerPosition.z = -17.8;
  }

  isInsideBoundaryPortal(position, axis, radii) {
    return this.portals.some((portal) => {
      if (!portal.group.visible || Math.abs(portal.normal[axis]) < 0.8) return false;
      const normalDistance = Math.abs(position.clone().sub(portal.position).dot(portal.normal));
      return normalDistance < 1.25 && portalContainsPoint(position, portal, radii);
    });
  }

  blockPlane(previous, current, z, radius, stopVelocity) {
    if (previous.z >= z + radius && current.z < z + radius) {
      current.z = z + radius;
      if (stopVelocity) this.playerVelocity.z = Math.max(0, this.playerVelocity.z);
    } else if (previous.z <= z - radius && current.z > z - radius) {
      current.z = z - radius;
      if (stopVelocity) this.playerVelocity.z = Math.min(0, this.playerVelocity.z);
    }
  }

  updateCube(dt) {
    if (this.heldCube) {
      const target = this.camera.position.clone().add(forwardFromYawPitch(this.yaw, this.pitch).multiplyScalar(2.25));
      target.y -= 0.12;
      this.cube.position.lerp(target, 1 - Math.exp(-dt * 15));
      this.cubeVelocity.copy(this.playerVelocity);
      return;
    }
    const previous = this.cube.position.clone();
    this.cubeVelocity.y -= 16.5 * dt;
    const next = this.cube.position.clone().addScaledVector(this.cubeVelocity, dt);
    const teleported = this.tryTeleport(previous, next, this.cubeVelocity, false);
    if (!teleported) this.cube.position.copy(next);
    if (this.cube.position.y < 0.79) {
      this.cube.position.y = 0.79;
      if (this.cubeVelocity.y < -1.5) this.cubeVelocity.y *= -0.18;
      else this.cubeVelocity.y = 0;
      this.cubeVelocity.x *= Math.exp(-dt * 4.5);
      this.cubeVelocity.z *= Math.exp(-dt * 4.5);
    }
    if (!this.isInsideBoundaryPortal(this.cube.position, 'x', { x: 0.62, y: 1.05 })) {
      this.cube.position.x = THREE.MathUtils.clamp(this.cube.position.x, ROOM.minX + 0.8, ROOM.maxX - 0.8);
    }
    if (!this.isInsideBoundaryPortal(this.cube.position, 'z', { x: 0.62, y: 1.05 })) {
      this.cube.position.z = THREE.MathUtils.clamp(this.cube.position.z, ROOM.minZ + 0.8, ROOM.maxZ - 0.8);
    }
    this.blockCubePlane(previous, 8);
    if (!this.buttonActivated && Math.abs(this.cube.position.x) < 3.4) this.blockCubePlane(previous, -14);
    this.cube.rotation.x += this.cubeVelocity.z * dt * 0.25;
    this.cube.rotation.z -= this.cubeVelocity.x * dt * 0.25;
  }

  blockCubePlane(previous, z) {
    const radius = 0.78;
    if (previous.z >= z + radius && this.cube.position.z < z + radius) {
      this.cube.position.z = z + radius;
      this.cubeVelocity.z = Math.max(0, this.cubeVelocity.z) * 0.18;
    } else if (previous.z <= z - radius && this.cube.position.z > z - radius) {
      this.cube.position.z = z - radius;
      this.cubeVelocity.z = Math.min(0, this.cubeVelocity.z) * 0.18;
    }
  }

  toggleCube() {
    if (this.heldCube) {
      this.heldCube = false;
      const forward = forwardFromYawPitch(this.yaw, this.pitch);
      this.cubeVelocity.copy(this.playerVelocity).addScaledVector(forward, 2.4);
      this.callbacks.onToast('БРЕЙНРОТ-КУБ ОТПУЩЕН');
      return;
    }
    if (this.camera.position.distanceTo(this.cube.position) <= 3.15) {
      this.heldCube = true;
      this.cubeVelocity.set(0, 0, 0);
      this.audio.pickup();
      this.callbacks.onToast('БРЕЙНРОТ-КУБ ВЗЯТ');
    } else this.callbacks.onToast('ПОДОЙДИ БЛИЖЕ К КУБУ');
  }

  updatePuzzle(dt) {
    if (!this.buttonActivated && !this.heldCube) {
      const dx = this.cube.position.x - this.buttonRoot.position.x;
      const dz = this.cube.position.z - this.buttonRoot.position.z;
      if (Math.hypot(dx, dz) < 1.35 && this.cube.position.y < 1.2) {
        this.buttonActivated = true;
        this.audio.checkpoint();
        this.callbacks.onToast('ПЛАТФОРМА АКТИВНА — ВЫХОД ОТКРЫТ');
      }
    }
    this.doorProgress = THREE.MathUtils.damp(this.doorProgress, this.buttonActivated ? 1 : 0, 4.6, dt);
    this.door.position.y = THREE.MathUtils.lerp(1.9, 7.1, this.doorProgress);
    this.buttonRingMaterial.color.setHex(this.buttonActivated ? COLORS.green : COLORS.orange);
    this.buttonRingMaterial.opacity = this.buttonActivated ? 1 : 0.72;
    if (this.buttonActivated && this.playerPosition.z < -18.05 && Math.abs(this.playerPosition.x) < 5.5) this.win();
  }

  updateCamera() {
    this.camera.position.copy(this.playerPosition);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  updateVisuals(dt, time) {
    for (const portal of this.portals ?? []) portal.fillMaterial.uniforms.time.value = time;
    for (const motion of this.motions) {
      if (motion.type === 'swing') motion.object.rotation.z = motion.base + Math.sin(time * motion.speed) * 0.34;
      if (motion.type === 'spin') motion.object.rotation.y += dt * motion.speed;
      if (motion.type === 'roll') motion.object.rotation.x += dt * motion.speed;
    }
    if (this.buttonRoot) this.buttonRoot.position.y = 0.02 - (this.buttonActivated ? 0.035 : 0) + Math.sin(time * 2.2) * 0.008;
    if (this.gunRig) {
      const planarSpeed = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
      const bob = this.playerGrounded ? Math.sin(time * 9.5) * Math.min(planarSpeed / 5.25, 1) : 0;
      this.gunKick = THREE.MathUtils.damp(this.gunKick, 0, 15, dt);
      this.gunRig.position.set(bob * 0.018, Math.abs(bob) * -0.016, this.gunKick * 0.08);
      this.gunRig.rotation.x = this.gunKick * 0.08;
    }
    if (this.actionPrompt && this.camera) {
      const distance = this.camera.position.distanceTo(this.cube?.position ?? this.camera.position);
      this.actionPrompt.textContent = this.heldCube ? '[E] БРОСИТЬ КУБ' : distance < 3.15 ? '[E] ВЗЯТЬ БРЕЙНРОТ-КУБ' : '';
    }
  }

  emitHud() {
    const progress = this.buttonActivated ? 0.76 : this.teleportedOnce ? 0.38 : 0.08;
    const objective = this.buttonActivated
      ? 'Иди к открытому выходу'
      : this.heldCube ? 'Поставь куб на оранжевую платформу'
        : this.teleportedOnce ? 'Найди и возьми брейнрот-куб [E]'
          : 'Войди в голубой портал слева';
    this.callbacks.onHud({
      elapsed: this.elapsed,
      best: Number.NaN,
      progress,
      objective,
      hasCargo: this.heldCube,
      checkpoint: this.buttonActivated ? 2 : this.teleportedOnce ? 1 : 0,
    });
  }

  win() {
    if (this.state !== 'playing') return;
    this.state = 'won';
    document.exitPointerLock?.();
    this.audio.win();
    this.callbacks.onWin({ elapsed: this.elapsed, best: this.elapsed, newRecord: false, portalMode: true });
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
