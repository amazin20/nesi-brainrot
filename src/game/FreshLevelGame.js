import * as THREE from 'three';
import { Game } from './Game.js';

const COLORS = {
  cyan: 0x40f2ff,
  violet: 0x7c54ff,
  pink: 0xff4fd8,
  lime: 0xbaff4a,
  orange: 0xffa43b,
};

export class FreshLevelGame extends Game {
  constructor(options) {
    super(options);
    this.checkpoints = [
      new THREE.Vector3(0, 0, 14),
      new THREE.Vector3(-10, 0, -55),
      new THREE.Vector3(8, 0, -116),
    ];
    this.freshCheckpointTriggers = [
      new THREE.Vector3(-10, 0, -51),
      new THREE.Vector3(8, 0, -112),
    ];
  }

  buildLevel() {
    this.level = new THREE.Group();
    this.level.name = 'FreshLevelFromScratchV1';
    this.scene.add(this.level);

    this.materials = {
      navy: new THREE.MeshStandardMaterial({ color: 0x17366f, roughness: 0.58, metalness: 0.12 }),
      violet: new THREE.MeshStandardMaterial({ color: 0x5b31a4, roughness: 0.55, metalness: 0.12 }),
      cyan: new THREE.MeshStandardMaterial({ color: 0x147c96, roughness: 0.55, metalness: 0.12 }),
      magenta: new THREE.MeshStandardMaterial({ color: 0x942663, roughness: 0.58, metalness: 0.1 }),
      amber: new THREE.MeshStandardMaterial({ color: 0xa45a22, roughness: 0.62, metalness: 0.08 }),
    };

    // Brand-new route: wide start plaza -> left hammer arena -> right bounce canyon
    // -> elevated center bridge -> left roller lane -> right hurdle switchback -> final plaza.
    const platforms = [
      [0, 14, 20, 18, 0, this.materials.navy],
      [-5, -2, 13, 12, 0, this.materials.violet],
      [-10, -18, 12, 20, 0, this.materials.violet],
      [-10, -40, 18, 16, 0, this.materials.cyan],
      [-10, -55, 18, 10, 0, this.materials.cyan],
      [-2, -68, 10, 16, 0, this.materials.amber],
      [8, -78, 12, 14, 0, this.materials.amber],
      [8, -94, 16, 14, 0, this.materials.magenta],
      [8, -112, 18, 12, 0, this.materials.cyan],
      [0, -124, 10, 12, 0, this.materials.navy],
      [-9, -136, 12, 16, 0, this.materials.violet],
      [-3, -151, 11, 12, 0, this.materials.magenta],
      [5, -162, 12, 12, 0, this.materials.amber],
      [0, -178, 20, 18, 0, this.materials.cyan],
    ];
    platforms.forEach((platform) => this.addPlatform(...platform));

    this.addFreshStart();
    this.addFreshHammerArena();
    this.addFreshBounceCanyon();
    this.addFreshRollerLane();
    this.addFreshHurdleSwitchback();
    this.addFreshCheckpoints();
    this.addFreshFinish();
    this.addFreshDecor();
    this.createPlayer();
    this.createConfetti();
  }

  addFreshStart() {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(3.3, 3.8, 0.5, 40),
      new THREE.MeshStandardMaterial({ color: 0x213c79, emissive: 0x102d5e, emissiveIntensity: 1.25, roughness: 0.4 }),
    );
    base.position.set(0, 0.25, 14);
    this.level.add(base);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.05, 0.09, 10, 64),
      new THREE.MeshBasicMaterial({ color: COLORS.lime, transparent: true, opacity: 0.92 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.55, 14);
    this.level.add(ring);
    this.motions.push({ type: 'pulse', object: ring, phase: 0.2 });

    this.cargo = this.model(2, 1.6, 'height');
    this.cargo.position.set(0, 0.56, 14);
    this.level.add(this.cargo);
    this.cargoStart = this.cargo.position.clone();

    const archPlatform = this.model(10, 9.2);
    archPlatform.position.set(0, 0.03, 20);
    archPlatform.rotation.y = Math.PI / 2;
    this.level.add(archPlatform);

    this.level.add(this.makeLabel('ЗАБЕРИ БРЕЙНРОТА', new THREE.Vector3(0, 5.8, 9)));
  }

  addFreshHammerArena() {
    const layout = [
      [-8.5, -12, 3, 'swing', 0.0],
      [-11.5, -22, 7, 'spin', 1.2],
      [-7.0, -32, 3, 'swing', 2.4],
      [-12.0, -39, 7, 'spin', 3.1],
    ];
    layout.forEach(([x, z, asset, motionType, phase], index) => {
      const hammer = this.model(asset, asset === 7 ? 5.6 : 5.1);
      hammer.position.set(x, 0.02, z);
      hammer.rotation.y = index % 2 ? Math.PI / 2 : -Math.PI / 2;
      this.level.add(hammer);
      this.motions.push({ type: motionType, object: hammer, phase, speed: 1.35 + index * 0.2 });
      this.hazards.push({ object: hammer, radius: asset === 7 ? 3.0 : 2.5, strength: 9.5 + index * 0.6 });
    });
    this.level.add(this.makeLabel('АРЕНА МОЛОТОВ', new THREE.Vector3(-10, 6.3, -20)));
  }

  addFreshBounceCanyon() {
    const pads = [
      [-7.5, -61, 0.0],
      [-3.3, -67, 1.1],
      [1.0, -71.5, 2.0],
      [5.2, -76, 2.8],
      [8.0, -82, 3.7],
    ];
    pads.forEach(([x, z, phase]) => {
      const pad = this.model(4, 2.55);
      pad.position.set(x, 0.02, z);
      this.level.add(pad);
      this.motions.push({ type: 'bob', object: pad, phase, baseY: 0.02 });
      this.bouncers.push({ object: pad, radius: 1.45 });
      const glow = new THREE.PointLight(COLORS.cyan, 5.5, 9, 2);
      glow.position.set(x, 1.3, z);
      this.level.add(glow);
    });

    const bridgeA = this.model(10, 7.4);
    bridgeA.position.set(1.5, 0.04, -70);
    bridgeA.rotation.y = Math.PI / 2;
    this.level.add(bridgeA);
    const bridgeB = this.model(10, 7.4);
    bridgeB.position.set(7.2, 0.04, -80.5);
    this.level.add(bridgeB);

    this.level.add(this.makeLabel('ПРЫЖКОВЫЙ КАНЬОН', new THREE.Vector3(1, 6.6, -72)));
  }

  addFreshRollerLane() {
    const roller = this.model(8, 6.4);
    roller.position.set(8, 0.02, -96);
    roller.rotation.y = Math.PI / 2;
    this.level.add(roller);
    this.motions.push({ type: 'roll', object: roller, phase: 0, speed: 2.8 });
    this.hazards.push({ object: roller, radius: 3.2, strength: 11.8 });

    const spinner = this.model(7, 5.4);
    spinner.position.set(5.5, 0.02, -104.5);
    spinner.rotation.y = Math.PI / 2;
    this.level.add(spinner);
    this.motions.push({ type: 'spin', object: spinner, phase: 0.6, speed: 2.15 });
    this.hazards.push({ object: spinner, radius: 3.0, strength: 10.5 });

    this.level.add(this.makeLabel('РОЛЛЕР-ШЛЮЗ', new THREE.Vector3(8, 6.0, -97)));
  }

  addFreshHurdleSwitchback() {
    const hurdleData = [
      [2, -124, 0],
      [-8.5, -134, Math.PI],
      [-4, -149, Math.PI / 2],
    ];
    hurdleData.forEach(([x, z, rotation], index) => {
      const hurdles = this.model(9, 7.1);
      hurdles.position.set(x, 0.02, z);
      hurdles.rotation.y = rotation;
      this.level.add(hurdles);
      this.hazards.push({ object: hurdles, radius: 2.55, strength: 7.7 + index * 0.35, maxHitY: 1.5 });
    });

    const platform = this.model(10, 7.5);
    platform.position.set(4.6, 0.03, -161.5);
    platform.rotation.y = Math.PI / 2;
    this.level.add(platform);

    this.level.add(this.makeLabel('ЗИГЗАГ БАРЬЕРОВ', new THREE.Vector3(-4, 6.1, -137)));
  }

  addFreshCheckpoints() {
    const data = [
      [-10, -51, 0],
      [8, -112, Math.PI],
    ];
    data.forEach(([x, z, rotation], index) => {
      const checkpoint = this.model(5, 7.1);
      checkpoint.position.set(x, 0.02, z);
      checkpoint.rotation.y = rotation;
      this.level.add(checkpoint);

      const aura = new THREE.Mesh(
        new THREE.TorusGeometry(3.9, 0.08, 8, 56),
        new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.3 }),
      );
      aura.position.set(x, 3.5, z);
      aura.rotation.y = rotation;
      this.level.add(aura);
      this.motions.push({ type: 'pulse', object: aura, phase: index * 1.9 });
    });
  }

  addFreshFinish() {
    const flagLeft = this.model(6, 5.0, 'height');
    flagLeft.position.set(-4.5, 0.02, -178);
    this.level.add(flagLeft);
    const flagRight = this.model(6, 5.0, 'height');
    flagRight.position.set(4.5, 0.02, -178);
    flagRight.rotation.y = Math.PI;
    this.level.add(flagRight);

    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(4.8, 0.18, 12, 72, Math.PI),
      new THREE.MeshStandardMaterial({ color: COLORS.lime, emissive: COLORS.lime, emissiveIntensity: 2.6, roughness: 0.3 }),
    );
    gate.position.set(0, 0.18, -176.6);
    gate.rotation.z = Math.PI;
    this.level.add(gate);
    this.finishGate = gate;
    this.motions.push({ type: 'pulse', object: gate, phase: 0.7 });
    this.level.add(this.makeLabel('ФИНИШ', new THREE.Vector3(0, 6.2, -174)));
  }

  addFreshDecor() {
    const geometry = new THREE.OctahedronGeometry(0.5, 0);
    const palette = [COLORS.cyan, COLORS.pink, COLORS.lime, COLORS.orange, COLORS.violet];
    const route = [
      [10, 6], [-17, -14], [-18, -35], [-17, -57], [4, -64], [16, -80],
      [16, -103], [16, -119], [-17, -133], [-12, -154], [13, -165], [10, -181],
    ];
    route.forEach(([x, z], index) => {
      const crystal = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: palette[index % palette.length],
          emissive: palette[index % palette.length],
          emissiveIntensity: 1.55,
          roughness: 0.3,
        }),
      );
      crystal.position.set(x, 1.4 + (index % 3) * 0.35, z);
      crystal.rotation.z = Math.PI / 4;
      this.level.add(crystal);
      this.motions.push({ type: 'float', object: crystal, phase: index * 0.6, baseY: crystal.position.y });
    });
  }

  updateCheckpoints() {
    if (!this.player?.hasCargo) return;
    const next = this.checkpointIndex + 1;
    if (next > this.freshCheckpointTriggers.length) return;
    const trigger = this.freshCheckpointTriggers[next - 1];
    if (this.distanceXZ(this.player.position, trigger) < 5.1) {
      this.checkpointIndex = next;
      this.audio.checkpoint();
      this.callbacks.onToast(`ЧЕКПОИНТ ${next}/2 АКТИВИРОВАН`);
      this.emitHud();
    }
  }
}
