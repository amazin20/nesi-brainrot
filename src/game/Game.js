import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { InputController } from './InputController.js';
import { AudioController } from './AudioController.js';
import { courseProgress, isNewRecord } from './rules.js';

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
];

const COLORS = {
  cyan: 0x40f2ff,
  violet: 0x7c54ff,
  pink: 0xff4fd8,
  lime: 0xbaff4a,
  orange: 0xffa43b,
  ink: 0x071126,
};

const noop = () => {};

export class Game {
  constructor({ container, touch, onProgress, onReady, onHud, onToast, onPause, onWin }) {
    this.container = container;
    this.callbacks = {
      onProgress: onProgress ?? noop,
      onReady: onReady ?? noop,
      onHud: onHud ?? noop,
      onToast: onToast ?? noop,
      onPause: onPause ?? noop,
      onWin: onWin ?? noop,
    };
    this.touch = touch;
    this.assets = new Map();
    this.surfaces = [];
    this.hazards = [];
    this.bouncers = [];
    this.motions = [];
    this.state = 'loading';
    this.elapsed = 0;
    this.best = Number.parseFloat(localStorage.getItem('nesi-brainrot-best'));
    this.checkpointIndex = 0;
    this.checkpoints = [
      new THREE.Vector3(0, 0, 12),
      new THREE.Vector3(0, 0, -46),
      new THREE.Vector3(0, 0, -129),
    ];
    this.hudAccumulator = 0;
    this.hitCooldown = 0;
    this.bounceCooldown = 0;
    this.lastFrame = performance.now();
    this.animate = this.animate.bind(this);
  }

  async init() {
    this.createScene();
    this.input = new InputController(this.touch);
    this.audio = new AudioController();
    this.renderer.setAnimationLoop(this.animate);
    await this.loadAssets();
    this.buildLevel();
    this.state = 'ready';
    this.callbacks.onReady();
    this.emitHud();
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1b42);
    this.scene.fog = new THREE.FogExp2(0x142858, 0.008);

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 600);
    this.camera.position.set(0, 7, 22);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    const hemisphere = new THREE.HemisphereLight(0xb6dcff, 0x17213c, 2.15);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff1da, 3.4);
    sun.position.set(-18, 35, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    this.scene.add(sun);

    const fill = new THREE.PointLight(COLORS.violet, 18, 90, 2);
    fill.position.set(12, 12, -55);
    this.scene.add(fill);
    const finishGlow = new THREE.PointLight(COLORS.lime, 20, 55, 2);
    finishGlow.position.set(0, 8, -177);
    this.scene.add(finishGlow);

    this.createSky();
    window.addEventListener('resize', () => this.resize());
  }

  createSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(280, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          topColor: { value: new THREE.Color(0x14275d) },
          bottomColor: { value: new THREE.Color(0x692b87) },
        },
        vertexShader: 'varying vec3 vWorld; void main(){ vWorld = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vWorld; void main(){ float h=clamp((normalize(vWorld).y+0.2)*0.72,0.0,1.0); gl_FragColor=vec4(mix(bottomColor,topColor,h),1.0); }',
      }),
    );
    this.scene.add(sky);

    const positions = [];
    for (let i = 0; i < 460; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 35 + Math.random() * 190;
      positions.push(Math.cos(angle) * radius, 12 + Math.random() * 85, -85 + Math.sin(angle) * radius);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.stars = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xe8f8ff,
      size: 0.55,
      transparent: true,
      opacity: 0.72,
      sizeAttenuation: true,
    }));
    this.scene.add(this.stars);

    const sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(8, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffc98f }),
    );
    sunDisc.position.set(-70, 54, -185);
    this.scene.add(sunDisc);
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
    this.callbacks.onProgress({ completed, total: MODEL_FILES.length, label: 'Подготовка моделей...' });

    await Promise.all(MODEL_FILES.map((file, index) => new Promise((resolve) => {
      loader.load(
        `${base}models/${file}`,
        (gltf) => {
          this.assets.set(index + 1, gltf.scene);
          resolve();
        },
        undefined,
        (error) => {
          console.warn(`Model ${index + 1} failed to load; using fallback.`, error);
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
    const group = new THREE.Group();
    const color = [COLORS.cyan, COLORS.lime, COLORS.orange, COLORS.pink][id % 4];
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.12 });
    const geometry = id === 1 || id === 2
      ? new THREE.CapsuleGeometry(0.55, 1.2, 6, 10)
      : new THREE.BoxGeometry(1.4, 1.4, 1.4);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = id === 1 || id === 2 ? 1 : 0.7;
    group.add(mesh);
    return group;
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
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
          if (child.material[key]) child.material[key].anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        }
      }
    });

    let box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const reference = mode === 'height' ? size.y : Math.max(size.x, size.y, size.z);
    const scale = Number.isFinite(reference) && reference > 0.0001 ? targetSize / reference : 1;
    clone.scale.setScalar(scale);
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

  buildLevel() {
    this.level = new THREE.Group();
    this.scene.add(this.level);
    this.materials = {
      blue: new THREE.MeshStandardMaterial({ color: 0x2359a9, roughness: 0.63, metalness: 0.08 }),
      purple: new THREE.MeshStandardMaterial({ color: 0x6735a8, roughness: 0.58, metalness: 0.1 }),
      teal: new THREE.MeshStandardMaterial({ color: 0x16889e, roughness: 0.6, metalness: 0.08 }),
      pink: new THREE.MeshStandardMaterial({ color: 0xb52f82, roughness: 0.58, metalness: 0.08 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xb86a28, roughness: 0.65, metalness: 0.06 }),
    };

    this.addPlatform(0, 10, 18, 20, 0, this.materials.blue);
    this.addPlatform(0, -21, 16, 42, 0, this.materials.purple);
    this.addPlatform(0, -45, 18, 8, 0, this.materials.teal);
    this.addPlatform(0, -62, 15, 26, 0, this.materials.blue);
    this.addPlatform(0, -87, 14, 24, 0, this.materials.orange);
    this.addPlatform(0, -112, 14, 26, 0, this.materials.pink);
    this.addPlatform(0, -127.5, 17, 7, 0, this.materials.teal);
    this.addPlatform(-1.5, -140, 12, 14, 0, this.materials.purple);
    this.addPlatform(1.7, -153.5, 10, 9, 0, this.materials.blue);
    this.addPlatform(-1.2, -166, 12, 12, 0, this.materials.pink);
    this.addPlatform(0, -179, 18, 14, 0, this.materials.teal);

    this.addCourseDecor();
    this.addStartArea();
    this.addObstacles();
    this.addCheckpoints();
    this.addFinish();
    this.createPlayer();
    this.createConfetti();
  }

  addPlatform(x, z, width, depth, top, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 1.15, depth), material);
    mesh.position.set(x, top - 0.575, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.level.add(mesh);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 25),
      new THREE.LineBasicMaterial({ color: 0x8ff8ff, transparent: true, opacity: 0.38 }),
    );
    edge.position.copy(mesh.position);
    this.level.add(edge);
    this.surfaces.push({
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
      top,
    });
  }

  addStartArea() {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.5, 0.55, 32),
      new THREE.MeshStandardMaterial({ color: 0x243d76, emissive: 0x102d5e, emissiveIntensity: 1.1, roughness: 0.42 }),
    );
    disc.position.set(0, 0.275, 6.5);
    disc.castShadow = true;
    this.level.add(disc);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.15, 0.08, 10, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.lime, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.58, 6.5);
    this.level.add(ring);
    this.motions.push({ type: 'pulse', object: ring, phase: 0 });

    this.cargo = this.model(2, 1.55, 'height');
    this.cargo.position.set(0, 0.58, 6.5);
    this.level.add(this.cargo);
    this.cargoStart = this.cargo.position.clone();

    const platformModel = this.model(10, 8.5);
    platformModel.position.set(0, 0.03, 13.5);
    platformModel.rotation.y = Math.PI * 0.5;
    this.level.add(platformModel);
  }

  addObstacles() {
    const swings = [
      { x: -3.2, z: -15, phase: 0 },
      { x: 3.1, z: -24, phase: 1.7 },
      { x: -1.3, z: -33, phase: 3.2 },
    ];
    swings.forEach(({ x, z, phase }, index) => {
      const hammer = this.model(index === 2 ? 7 : 3, index === 2 ? 5.5 : 5.2);
      hammer.position.set(x, 0.02, z);
      hammer.rotation.y = index % 2 ? Math.PI : 0;
      this.level.add(hammer);
      this.motions.push({ type: index === 2 ? 'spin' : 'swing', object: hammer, phase, speed: 1.55 + index * 0.22 });
      this.hazards.push({ object: hammer, radius: index === 2 ? 3.1 : 2.45, strength: 9 + index });
    });

    const bouncePositions = [
      [-3.4, -55, 0], [0, -61, 1.2], [3.4, -67, 2.3], [-2, -71.5, 3.1],
    ];
    bouncePositions.forEach(([x, z, phase]) => {
      const block = this.model(4, 2.65);
      block.position.set(x, 0.02, z);
      this.level.add(block);
      this.motions.push({ type: 'bob', object: block, phase, baseY: 0.02 });
      this.bouncers.push({ object: block, radius: 1.45 });
      const glow = new THREE.PointLight(COLORS.cyan, 5, 9, 2);
      glow.position.set(x, 1.4, z);
      this.level.add(glow);
    });

    const roller = this.model(8, 6.2);
    roller.position.set(0, 0.02, -87.5);
    roller.rotation.y = Math.PI / 2;
    this.level.add(roller);
    this.motions.push({ type: 'roll', object: roller, phase: 0, speed: 2.5 });
    this.hazards.push({ object: roller, radius: 3.1, strength: 11.5 });

    [-106.5, -116.5].forEach((z, index) => {
      const hurdles = this.model(9, 7.8);
      hurdles.position.set(index ? 1.4 : -1.3, 0.02, z);
      hurdles.rotation.y = index ? Math.PI : 0;
      this.level.add(hurdles);
      this.hazards.push({ object: hurdles, radius: 2.65, strength: 7.5, maxHitY: 1.5 });
    });

    [
      [-1.5, -140, 0], [1.7, -153.5, Math.PI / 2], [-1.2, -166, Math.PI],
    ].forEach(([x, z, rotation]) => {
      const platform = this.model(10, 7.7);
      platform.position.set(x, 0.03, z);
      platform.rotation.y = rotation;
      this.level.add(platform);
    });
  }

  addCheckpoints() {
    [-45, -127.5].forEach((z, index) => {
      const checkpoint = this.model(5, 7.1);
      checkpoint.position.set(0, 0.02, z);
      if (index === 1) checkpoint.rotation.y = Math.PI;
      this.level.add(checkpoint);
      const aura = new THREE.Mesh(
        new THREE.TorusGeometry(3.9, 0.07, 8, 56),
        new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.28 }),
      );
      aura.position.set(0, 3.5, z);
      this.level.add(aura);
      this.motions.push({ type: 'pulse', object: aura, phase: index * 1.7 });
    });
  }

  addFinish() {
    const flag = this.model(6, 5.2, 'height');
    flag.position.set(4.2, 0.02, -179);
    this.level.add(flag);
    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(4.4, 0.16, 12, 64, Math.PI),
      new THREE.MeshStandardMaterial({ color: COLORS.lime, emissive: COLORS.lime, emissiveIntensity: 2.3, roughness: 0.35 }),
    );
    gate.position.set(0, 0.15, -176.5);
    gate.rotation.z = Math.PI;
    this.level.add(gate);
    this.finishGate = gate;
    this.motions.push({ type: 'pulse', object: gate, phase: 0.5 });
  }

  addCourseDecor() {
    const crystalGeometry = new THREE.OctahedronGeometry(0.45, 0);
    const materials = [
      new THREE.MeshStandardMaterial({ color: COLORS.cyan, emissive: COLORS.cyan, emissiveIntensity: 1.7 }),
      new THREE.MeshStandardMaterial({ color: COLORS.pink, emissive: COLORS.pink, emissiveIntensity: 1.5 }),
      new THREE.MeshStandardMaterial({ color: COLORS.lime, emissive: COLORS.lime, emissiveIntensity: 1.4 }),
    ];
    for (let z = 10, i = 0; z > -186; z -= 8, i += 1) {
      const side = i % 2 ? -1 : 1;
      const crystal = new THREE.Mesh(crystalGeometry, materials[i % materials.length]);
      crystal.position.set(side * (9 + (i % 3)), 1.2 + (i % 4) * 0.38, z);
      crystal.rotation.z = Math.PI / 4;
      this.level.add(crystal);
      this.motions.push({ type: 'float', object: crystal, phase: i * 0.55, baseY: crystal.position.y });
    }

    [
      ['МАЯТНИКИ', -7], ['ПРЫЖКОВЫЙ СЕКТОР', -49], ['РОЛЛЕР', -78],
      ['БАРЬЕРЫ', -100], ['НЕБЕСНЫЕ ОСТРОВА', -133], ['ФИНИШ', -171],
    ].forEach(([text, z]) => this.level.add(this.makeLabel(text, new THREE.Vector3(0, 5.4, z))));
  }

  makeLabel(text, position) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '700 52px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = '#40f2ff';
    context.shadowBlur = 24;
    context.fillStyle = '#e9fcff';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.86 }));
    sprite.position.copy(position);
    sprite.scale.set(11.5, 2.4, 1);
    return sprite;
  }

  createPlayer() {
    const group = new THREE.Group();
    const visual = this.model(1, 2.45, 'height');
    group.add(visual);
    const carrier = new THREE.Group();
    carrier.position.set(0, 1.35, 0.25);
    group.add(carrier);
    group.position.copy(this.checkpoints[0]);
    this.scene.add(group);
    this.player = {
      group,
      visual,
      carrier,
      position: group.position,
      velocity: new THREE.Vector3(),
      grounded: true,
      hasCargo: false,
      radius: 0.58,
    };
  }

  createConfetti() {
    const palette = [COLORS.cyan, COLORS.pink, COLORS.lime, COLORS.orange, COLORS.violet];
    this.confetti = [];
    for (let i = 0; i < 64; i += 1) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.28, 0.05),
        new THREE.MeshBasicMaterial({ color: palette[i % palette.length] }),
      );
      mesh.visible = false;
      mesh.userData.velocity = new THREE.Vector3();
      this.scene.add(mesh);
      this.confetti.push(mesh);
    }
  }

  start() {
    this.audio.unlock();
    this.resetRun();
  }

  restart() {
    this.audio.unlock();
    this.resetRun();
    this.callbacks.onPause(false);
  }

  resetRun() {
    this.state = 'playing';
    this.elapsed = 0;
    this.checkpointIndex = 0;
    this.hitCooldown = 0;
    this.bounceCooldown = 0;
    this.player.hasCargo = false;
    this.player.velocity.set(0, 0, 0);
    this.player.position.copy(this.checkpoints[0]);
    this.player.group.rotation.set(0, Math.PI, 0);
    this.player.visual.position.set(0, 0, 0);
    if (this.cargo.parent) this.cargo.parent.remove(this.cargo);
    this.level.add(this.cargo);
    this.cargo.position.copy(this.cargoStart);
    this.cargo.rotation.set(0, 0, 0);
    this.cargo.scale.setScalar(1);
    this.confetti.forEach((piece) => { piece.visible = false; });
    this.snapCamera();
    this.emitHud();
  }

  togglePause(force) {
    if (!['playing', 'paused'].includes(this.state)) return;
    const shouldPause = typeof force === 'boolean' ? force : this.state === 'playing';
    this.state = shouldPause ? 'paused' : 'playing';
    this.callbacks.onPause(shouldPause);
    this.lastFrame = performance.now();
  }

  animate(now) {
    const dt = Math.min((now - this.lastFrame) / 1000, 0.034);
    this.lastFrame = now;
    const time = now / 1000;

    if (this.state !== 'paused') this.updateWorld(dt, time);
    if (this.state === 'paused' && this.input.consumePause()) this.togglePause(false);
    if (this.state === 'playing') {
      this.elapsed += dt * 1000;
      this.updatePlayer(dt, time);
      this.hudAccumulator += dt;
      if (this.hudAccumulator > 0.08) {
        this.hudAccumulator = 0;
        this.emitHud();
      }
    }
    if (this.state === 'won') this.updateConfetti(dt);
    this.updateCamera(dt, time);
    this.renderer.render(this.scene, this.camera);
  }

  updateWorld(dt, time) {
    if (this.stars) this.stars.rotation.y += dt * 0.006;
    for (const motion of this.motions) {
      const t = time * (motion.speed ?? 1) + (motion.phase ?? 0);
      if (motion.type === 'swing') motion.object.rotation.z = Math.sin(t) * 0.72;
      if (motion.type === 'spin') motion.object.rotation.y += dt * (motion.speed ?? 1.5);
      if (motion.type === 'roll') motion.object.rotation.x += dt * (motion.speed ?? 2.5);
      if (motion.type === 'bob') motion.object.position.y = motion.baseY + Math.sin(t * 2) * 0.34 + 0.34;
      if (motion.type === 'float') {
        motion.object.position.y = motion.baseY + Math.sin(t * 1.25) * 0.42;
        motion.object.rotation.y += dt * 0.7;
      }
      if (motion.type === 'pulse') {
        const scale = 1 + Math.sin(t * 2) * 0.035;
        motion.object.scale.setScalar(scale);
        if (motion.object.material) motion.object.material.opacity = 0.32 + Math.sin(t * 2) * 0.12;
      }
    }
  }

  updatePlayer(dt, time) {
    if (this.input.consumePause()) {
      this.togglePause();
      return;
    }
    if (this.input.consumeRestart()) {
      this.restart();
      return;
    }

    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.bounceCooldown = Math.max(0, this.bounceCooldown - dt);
    const move = this.input.getMove();
    const speed = this.player.hasCargo ? 7.7 : 8.7;
    const control = this.player.grounded ? 14 : 4.4;
    this.player.velocity.x = THREE.MathUtils.damp(this.player.velocity.x, move.x * speed, control, dt);
    this.player.velocity.z = THREE.MathUtils.damp(this.player.velocity.z, move.y * speed, control, dt);

    if (this.input.consumeJump() && this.player.grounded) {
      this.player.velocity.y = 9.4;
      this.player.grounded = false;
      this.audio.jump();
    }

    const previousY = this.player.position.y;
    this.player.velocity.y -= 22 * dt;
    this.player.position.addScaledVector(this.player.velocity, dt);
    const ground = this.groundHeight(this.player.position.x, this.player.position.z, previousY);
    this.player.grounded = false;
    if (ground !== null && this.player.position.y <= ground && previousY >= ground - 0.55 && this.player.velocity.y <= 0) {
      this.player.position.y = ground;
      this.player.velocity.y = 0;
      this.player.grounded = true;
    }

    const planarSpeed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    if (planarSpeed > 0.22) {
      const targetYaw = Math.atan2(this.player.velocity.x, this.player.velocity.z);
      this.player.group.rotation.y = this.lerpAngle(this.player.group.rotation.y, targetYaw, 1 - Math.exp(-dt * 11));
    }
    const bob = this.player.grounded && planarSpeed > 0.6 ? Math.sin(time * 12) * 0.055 : 0;
    this.player.visual.position.y = THREE.MathUtils.damp(this.player.visual.position.y, bob, 14, dt);
    this.player.visual.rotation.z = THREE.MathUtils.damp(this.player.visual.rotation.z, -this.player.velocity.x * 0.025, 8, dt);
    this.player.visual.rotation.x = THREE.MathUtils.damp(this.player.visual.rotation.x, this.player.velocity.z * 0.018, 8, dt);

    if (!this.player.hasCargo && this.distanceXZ(this.player.position, this.cargo.getWorldPosition(new THREE.Vector3())) < 2.25) {
      this.pickupCargo();
    }
    this.updateBouncers();
    this.updateHazards();
    this.updateCheckpoints();

    if (this.player.position.y < -10 || Math.abs(this.player.position.x) > 28) this.respawn('Ты упал — возвращаем на чекпоинт');
    if (this.player.position.z < -174.5 && Math.abs(this.player.position.x) < 8) {
      if (this.player.hasCargo) this.win();
      else this.callbacks.onToast('Без брейнрота финиш не считается!');
    }
  }

  updateBouncers() {
    if (this.bounceCooldown > 0) return;
    for (const bouncer of this.bouncers) {
      const position = bouncer.object.getWorldPosition(new THREE.Vector3());
      if (this.distanceXZ(this.player.position, position) < bouncer.radius && this.player.position.y < 1.35) {
        this.player.velocity.y = 12.2;
        this.player.grounded = false;
        this.bounceCooldown = 0.65;
        this.audio.jump();
        this.callbacks.onToast('СУПЕРПРЫЖОК!');
        return;
      }
    }
  }

  updateHazards() {
    if (this.hitCooldown > 0) return;
    for (const hazard of this.hazards) {
      if (hazard.maxHitY && this.player.position.y > hazard.maxHitY) continue;
      const center = hazard.object.getWorldPosition(new THREE.Vector3());
      const distance = this.distanceXZ(this.player.position, center);
      if (distance >= hazard.radius + this.player.radius) continue;
      const dx = this.player.position.x - center.x;
      const dz = this.player.position.z - center.z;
      const length = Math.hypot(dx, dz) || 1;
      this.player.velocity.x = dx / length * hazard.strength;
      this.player.velocity.z = dz / length * hazard.strength;
      this.player.velocity.y = Math.max(this.player.velocity.y, 6.4);
      this.player.grounded = false;
      this.hitCooldown = 0.78;
      this.audio.hit();
      this.callbacks.onToast('ОСТОРОЖНО, УДАР!');
      return;
    }
  }

  updateCheckpoints() {
    if (!this.player.hasCargo) return;
    const next = this.checkpointIndex + 1;
    const thresholds = [-42.5, -124.5];
    if (next <= 2 && this.player.position.z < thresholds[next - 1]) {
      this.checkpointIndex = next;
      this.audio.checkpoint();
      this.callbacks.onToast(`ЧЕКПОИНТ ${next}/2 АКТИВИРОВАН`);
      this.emitHud();
    }
  }

  pickupCargo() {
    this.player.hasCargo = true;
    this.player.carrier.attach(this.cargo);
    this.cargo.position.set(0, 0.05, 0.18);
    this.cargo.rotation.set(0, Math.PI, 0);
    this.cargo.scale.setScalar(0.72);
    this.audio.pickup();
    this.callbacks.onToast('БРЕЙНРОТ ПОДОБРАН — НЕСИ НА ФИНИШ!');
    this.emitHud();
  }

  respawn(message) {
    const point = this.checkpoints[this.checkpointIndex];
    this.player.position.copy(point);
    this.player.velocity.set(0, 0, 0);
    this.player.group.rotation.y = Math.PI;
    this.hitCooldown = 1;
    this.callbacks.onToast(message);
    this.snapCamera();
  }

  win() {
    if (this.state !== 'playing') return;
    this.state = 'won';
    const newRecord = isNewRecord(this.elapsed, this.best);
    if (newRecord) {
      this.best = this.elapsed;
      localStorage.setItem('nesi-brainrot-best', String(this.best));
    }
    this.audio.win();
    this.launchConfetti();
    this.emitHud();
    this.callbacks.onWin({ elapsed: this.elapsed, best: this.best, newRecord });
  }

  launchConfetti() {
    this.confetti.forEach((piece, index) => {
      piece.visible = true;
      piece.position.set((Math.random() - 0.5) * 7, 3 + Math.random() * 4, -176 + (Math.random() - 0.5) * 4);
      piece.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      piece.userData.velocity.set((Math.random() - 0.5) * 7, 4 + Math.random() * 7, (Math.random() - 0.5) * 5);
      piece.userData.spin = (index % 2 ? 1 : -1) * (2 + Math.random() * 6);
    });
  }

  updateConfetti(dt) {
    this.confetti.forEach((piece) => {
      if (!piece.visible) return;
      piece.userData.velocity.y -= 9 * dt;
      piece.position.addScaledVector(piece.userData.velocity, dt);
      piece.rotation.x += piece.userData.spin * dt;
      piece.rotation.z += piece.userData.spin * 0.7 * dt;
      if (piece.position.y < -2) piece.visible = false;
    });
  }

  groundHeight(x, z, previousY) {
    let result = null;
    for (const surface of this.surfaces) {
      if (x < surface.minX + 0.16 || x > surface.maxX - 0.16 || z < surface.minZ + 0.16 || z > surface.maxZ - 0.16) continue;
      if (surface.top > previousY + 0.65) continue;
      if (result === null || surface.top > result) result = surface.top;
    }
    return result;
  }

  updateCamera(dt, time) {
    if (!this.player) {
      this.camera.lookAt(0, 2, 0);
      return;
    }
    if (this.state === 'ready') {
      const angle = time * 0.12;
      const desired = new THREE.Vector3(Math.sin(angle) * 12, 7, 13 + Math.cos(angle) * 7);
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * 1.5));
      this.camera.lookAt(0, 1.5, 1);
      return;
    }
    const forward = new THREE.Vector3(0, 0, -1);
    const desired = this.player.position.clone().add(new THREE.Vector3(0, 5.4, 10.2));
    const look = this.player.position.clone().add(new THREE.Vector3(0, 1.25, -4.2));
    const speedLift = Math.min(Math.abs(this.player.velocity.z) * 0.04, 0.45);
    desired.y += speedLift;
    desired.addScaledVector(forward, -Math.min(this.player.velocity.z * 0.035, 0.25));
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 5.2));
    this.camera.lookAt(look);
  }

  snapCamera() {
    if (!this.player) return;
    this.camera.position.copy(this.player.position).add(new THREE.Vector3(0, 5.4, 10.2));
    this.camera.lookAt(this.player.position.clone().add(new THREE.Vector3(0, 1.2, -4)));
  }

  emitHud() {
    if (!this.player) return;
    let objective = 'Забери брейнрота';
    if (!this.player.hasCargo && this.player.position.z < 0) objective = 'Вернись за брейнротом';
    if (this.player.hasCargo) objective = this.player.position.z < -132 ? 'Доберись до финишного флага' : 'Донеси брейнрота до финиша';
    this.callbacks.onHud({
      elapsed: this.elapsed,
      best: this.best,
      progress: courseProgress(this.player.position.z),
      objective,
      hasCargo: this.player.hasCargo,
      checkpoint: this.checkpointIndex,
    });
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  distanceXZ(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  lerpAngle(current, target, amount) {
    let delta = (target - current + Math.PI) % (Math.PI * 2) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return current + delta * amount;
  }
}

