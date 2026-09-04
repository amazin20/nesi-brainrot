import * as THREE from 'three';

// Landmarks measured on model-01-player.glb. Source coordinates: -Z up,
// +Y forward. The rear equipment is a backpack attached to the torso.
export const LAB_PLAYER_JOINTS = Object.freeze([
  { name: 'Body', parent: null, point: [0, 0, -0.345] },
  { name: 'Head', parent: 'Body', point: [0, 0, -0.66] },
  { name: 'ArmL', parent: 'Body', point: [-0.164, 0, -0.592] },
  { name: 'ForearmL', parent: 'ArmL', point: [-0.211, 0.012, -0.462] },
  { name: 'HandL', parent: 'ForearmL', point: [-0.248, 0.027, -0.369] },
  { name: 'ArmR', parent: 'Body', point: [0.176, 0, -0.592] },
  { name: 'ForearmR', parent: 'ArmR', point: [0.223, 0.012, -0.462] },
  { name: 'HandR', parent: 'ForearmR', point: [0.26, 0.027, -0.369] },
  { name: 'ThighL', parent: 'Body', point: [-0.093, 0, -0.345] },
  { name: 'ShinL', parent: 'ThighL', point: [-0.103, 0, -0.228] },
  { name: 'FootL', parent: 'ShinL', point: [-0.117, 0.015, -0.168] },
  { name: 'ThighR', parent: 'Body', point: [0.101, 0, -0.345] },
  { name: 'ShinR', parent: 'ThighR', point: [0.111, 0, -0.228] },
  { name: 'FootR', parent: 'ShinR', point: [0.125, 0.015, -0.168] },
]);

export const LAB_PLAYER_BONE = Object.freeze(Object.fromEntries(
  LAB_PLAYER_JOINTS.map(({ name }, index) => [name, index]),
));

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (current, target, rate, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
const ORIGIN = new THREE.Vector3();

/** Continuous, position-welded weights; UV islands never get separate rules. */
export function resolveLabPlayerSkin(x, y, z, indices = new Uint16Array(4), weights = new Float32Array(4)) {
  // Quantized positional lookup welds duplicated UV/normal seam vertices.
  x = Math.round(x * 100000) / 100000;
  y = Math.round(y * 100000) / 100000;
  z = Math.round(z * 100000) / 100000;
  const h = -z;
  const side = x < 0.005 ? 'L' : 'R';
  const ax = Math.abs(x - 0.005);
  indices.fill(0);
  weights.fill(0);
  const values = [];
  const add = (bone, weight) => { if (weight > 0.000001) values.push([LAB_PLAYER_BONE[bone], weight]); };

  // Rear pack, rear hood straps and shoulder decorations remain one rigid
  // torso region. Crucially this mask precedes the outer-arm classification.
  const frontLimb = smooth(-0.105, -0.046, y);
  // The inner cuff is at X ~= 0.18, substantially inside the glove centre.
  // Give it full arm influence instead of pinning it to the jacket hem.
  const armInner = THREE.MathUtils.lerp(0.169, 0.117, smooth(0.33, 0.44, h));
  const arm = smooth(armInner, armInner + 0.045, ax) * frontLimb
    * smooth(0.215, 0.28, h) * (1 - smooth(0.608, 0.665, h));
  // The belt, crotch and hanging centre pouch belong to the pelvis. Avoid a
  // hard left/right split through those connected triangles during a stride.
  const legSeparation = THREE.MathUtils.lerp(1, smooth(0.012, 0.060, ax), smooth(0.20, 0.29, h));
  const leg = (1 - smooth(0.305, 0.395, h)) * (1 - arm) * legSeparation;
  const head = smooth(0.635, 0.70, h);
  const body = Math.max(0, 1 - arm - leg - head);
  add('Body', body);
  add('Head', head);
  if (arm > 0) {
    const upper = smooth(0.424, 0.505, h);
    const hand = 1 - smooth(0.351, 0.398, h);
    add(`Arm${side}`, arm * upper);
    add(`Forearm${side}`, arm * (1 - upper) * (1 - hand));
    add(`Hand${side}`, arm * (1 - upper) * hand);
  }
  if (leg > 0) {
    const thigh = smooth(0.206, 0.256, h);
    // Whole oversized boots are rigid. Bending belongs to the white sock
    // above the shoe opening, not the middle of a textured boot heel.
    const foot = 1 - smooth(0.165, 0.192, h);
    add(`Thigh${side}`, leg * thigh);
    add(`Shin${side}`, leg * (1 - thigh) * (1 - foot));
    add(`Foot${side}`, leg * (1 - thigh) * foot);
  }
  values.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const chosen = values.slice(0, 4);
  const total = chosen.reduce((sum, entry) => sum + entry[1], 0) || 1;
  chosen.forEach(([bone, weight], slot) => { indices[slot] = bone; weights[slot] = weight / total; });
  return { indices, weights };
}

export function createLabPlayerRig(visual) {
  let sourceMesh;
  visual.traverse((object) => { if (!sourceMesh && object.isMesh) sourceMesh = object; });
  if (!sourceMesh?.parent || sourceMesh.isSkinnedMesh) throw new Error('An unmodified source player mesh is required.');
  const geometry = sourceMesh.geometry.clone();
  const position = geometry.getAttribute('position');
  const skinIndices = new Uint16Array(position.count * 4);
  const skinWeights = new Float32Array(position.count * 4);
  const indices = new Uint16Array(4), weights = new Float32Array(4);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    resolveLabPlayerSkin(position.getX(vertex), position.getY(vertex), position.getZ(vertex), indices, weights);
    skinIndices.set(indices, vertex * 4);
    skinWeights.set(weights, vertex * 4);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, sourceMesh.material);
  mesh.name = `${sourceMesh.name || 'Player'}-LabRig`;
  mesh.position.copy(sourceMesh.position);
  mesh.quaternion.copy(sourceMesh.quaternion);
  mesh.scale.copy(sourceMesh.scale);
  mesh.castShadow = sourceMesh.castShadow;
  mesh.receiveShadow = sourceMesh.receiveShadow;
  mesh.visible = sourceMesh.visible;
  mesh.frustumCulled = false;
  mesh.userData = { ...sourceMesh.userData, runtimeRigged: true, skinProfile: 'lab-anatomical-welded-v1' };
  const parent = sourceMesh.parent, order = parent.children.indexOf(sourceMesh);
  parent.remove(sourceMesh);
  parent.add(mesh);
  parent.children.splice(parent.children.indexOf(mesh), 1);
  parent.children.splice(order, 0, mesh);
  const bones = {};
  const specs = Object.fromEntries(LAB_PLAYER_JOINTS.map((joint) => [joint.name, joint]));
  for (const { name, parent: parentName, point } of LAB_PLAYER_JOINTS) {
    const bone = new THREE.Bone();
    bone.name = `Lab${name}`;
    bone.position.fromArray(point);
    if (parentName) bone.position.sub(new THREE.Vector3().fromArray(specs[parentName].point));
    bones[name] = bone;
    if (parentName) bones[parentName].add(bone); else mesh.add(bone);
  }
  visual.updateWorldMatrix(true, true);
  const skeleton = new THREE.Skeleton(LAB_PLAYER_JOINTS.map(({ name }) => bones[name]));
  mesh.bind(skeleton);
  skeleton.update();
  const rest = Object.fromEntries(LAB_PLAYER_JOINTS.map(({ name }) => [name, bones[name].position.clone()]));
  return { mesh, sourceMesh, skeleton, bones, rest };
}

// Analytic sagittal two-link leg IK. The knee always flexes in its anatomical
// direction; ankle counterrotation keeps a planted shoe parallel to the floor.
export function solveLabLeg(forward, down, upperLength = 0.117, lowerLength = Math.hypot(0.060, 0.015)) {
  const distance = clamp(Math.hypot(forward, down), Math.abs(upperLength - lowerLength) + 0.001, upperLength + lowerLength - 0.00001);
  const knee = Math.acos(clamp((distance * distance - upperLength * upperLength - lowerLength * lowerLength)
    / (2 * upperLength * lowerLength), -1, 1));
  const hip = -Math.atan2(forward, down) - Math.atan2(lowerLength * Math.sin(knee), upperLength + lowerLength * Math.cos(knee));
  const ankleRest = Math.atan2(0.015, 0.060);
  return { hip, knee: knee + ankleRest, ankle: -hip - knee - ankleRest };
}

/** The physics root stays authoritative. Only the character's local joints move. */
export class LabPlayerAnimator {
  constructor({ visual, carrier, onStateChange = () => {} }) {
    this.visual = visual;
    this.carrier = carrier;
    this.onStateChange = onStateChange;
    this.rig = createLabPlayerRig(visual);
    this.bones = this.rig.bones;
    this.state = 'idle';
    this.elapsed = 0;
    this.gait = 0;
    this.speed = 0;
    this.moveBlend = 0;
    this.airBlend = 0;
    this.carryBlend = 0;
    this.landing = 0;
    this.landVelocity = 0;
    this.turn = 0;
    this.previousGrounded = true;
    this.lastVerticalSpeed = 0;
    this.footContact = { L: 1, R: 1 };
    this.jointTargets = Object.fromEntries(LAB_PLAYER_JOINTS.map(({ name }) => [name, new THREE.Euler()]));
    this.tempQuaternion = new THREE.Quaternion();
    this.tempVector = new THREE.Vector3();
    this.scaleVector = new THREE.Vector3();
    this.visual.userData.playerAppearanceMode = 'source-preserved-articulated';
    this.reset();
  }

  get diagnostics() {
    return {
      state: this.state,
      profile: 'lab-anatomical-welded-v1',
      boneCount: LAB_PLAYER_JOINTS.length,
      sourceAttributesPreserved: true,
      backpackRigid: true,
      separateLimbMotion: true,
      footContact: { ...this.footContact },
      movingJoints: Object.values(this.bones).filter((bone) => Math.abs(bone.quaternion.w) < 0.99999).length,
    };
  }

  reset() {
    for (const { name } of LAB_PLAYER_JOINTS) {
      this.bones[name].position.copy(this.rig.rest[name]);
      this.bones[name].quaternion.identity();
      this.jointTargets[name].set(0, 0, 0);
    }
    this.gait = this.speed = this.moveBlend = this.airBlend = this.carryBlend = 0;
    this.landing = this.landVelocity = this.turn = this.elapsed = 0;
    this.previousGrounded = true;
    this.lastVerticalSpeed = 0;
    this.state = 'idle';
    this.rig.mesh.updateWorldMatrix(true, true);
    this.rig.skeleton.update();
    this.snapCarrierToBody();
  }

  triggerLanding(impact = 4) {
    this.landVelocity = Math.min(this.landVelocity, -clamp(Math.abs(impact), 0.5, 14) * 0.10);
  }

  triggerHit() { this.triggerLanding(2); }
  triggerInteraction() {}

  update({ dt = 1 / 60, speed = 0, velocity = ORIGIN, grounded = true, turnRate = 0, carrying = false, phase = false, elapsed } = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    speed = clamp(Number.isFinite(speed) ? speed : 0, 0, 12);
    this.elapsed = Number.isFinite(elapsed) ? elapsed : this.elapsed + dt;
    const vy = Number.isFinite(velocity?.y) ? velocity.y : 0;
    if (grounded && !this.previousGrounded) this.triggerLanding(this.lastVerticalSpeed);
    this.previousGrounded = grounded;
    this.lastVerticalSpeed = vy;
    this.speed = damp(this.speed, speed, 10, dt);
    this.moveBlend = damp(this.moveBlend, smooth(0.04, 1.5, this.speed), 10, dt);
    this.airBlend = damp(this.airBlend, grounded && !phase ? 0 : 1, 14, dt);
    this.carryBlend = damp(this.carryBlend, carrying ? 1 : 0, 9, dt);
    this.turn = damp(this.turn, clamp(Number.isFinite(turnRate) ? turnRate : 0, -3, 3), 8, dt);
    const run = smooth(2.5, 5.7, this.speed);
    this.rig.mesh.getWorldScale(this.scaleVector);
    const modelScale = Math.max(0.1, this.scaleVector.length() / Math.sqrt(3));
    const stride = THREE.MathUtils.lerp(0.050, 0.115, run);
    const frequency = clamp(this.speed / Math.max(0.5, stride * 4 * modelScale), 0, 3.2);
    this.gait += dt * frequency;
    this.gait %= 1;
    const iterations = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < iterations; i += 1) {
      const step = dt / iterations;
      this.landVelocity += (-this.landing * 240 - this.landVelocity * 23) * step;
      this.landing += this.landVelocity * step;
    }
    this.landing = clamp(this.landing, -0.065, 0.022);
    const ground = 1 - this.airBlend;
    const moving = this.moveBlend * ground;
    const compress = (0.024 + run * 0.042) * moving - this.landing;
    this.bones.Body.position.copy(this.rig.rest.Body);
    this.bones.Body.position.z += compress;
    const body = this.jointTargets.Body;
    body.set(-0.055 * moving - 0.055 * this.carryBlend + this.landing * 0.55,
      -this.turn * 0.025, Math.sin(this.gait * Math.PI * 2) * 0.021 * moving);
    this.jointTargets.Head.set(-body.x * 0.6 + Math.sin(this.elapsed * 1.7) * 0.004,
      this.turn * 0.017, -body.z * 0.55);

    for (const [side, offset, sign] of [['L', 0, -1], ['R', 0.5, 1]]) {
      const cycle = (this.gait + offset) % 1;
      const planted = cycle < 0.57;
      let forward, lift;
      if (planted) {
        const t = cycle / 0.57;
        forward = THREE.MathUtils.lerp(stride, -stride, t);
        lift = 0;
      } else {
        const t = (cycle - 0.57) / 0.43;
        const ease = t * t * (3 - 2 * t);
        forward = THREE.MathUtils.lerp(-stride, stride, ease);
        lift = Math.sin(t * Math.PI) ** 1.4 * (0.027 + 0.018 * run);
      }
      forward = (forward * moving) + 0.015;
      lift *= moving;
      const leg = solveLabLeg(forward, 0.177 - compress - lift);
      const legBlend = clamp(moving + Math.abs(this.landing) * 8, 0, 1);
      const jumpFold = phase ? 0.50 : vy > 0 ? 0.42 : 0.20;
      this.jointTargets[`Thigh${side}`].set(leg.hip * legBlend - jumpFold * this.airBlend, 0, sign * 0.012 * moving);
      this.jointTargets[`Shin${side}`].set(leg.knee * legBlend + (jumpFold * 1.75) * this.airBlend, 0, 0);
      this.jointTargets[`Foot${side}`].set(leg.ankle * legBlend - jumpFold * 0.65 * this.airBlend, 0, 0);
      this.footContact[side] = grounded && (planted || this.moveBlend < 0.05) ? ground : 0;
      const swing = Math.sin((cycle + 0.05) * Math.PI * 2) * (0.20 + 0.20 * run) * moving;
      const idle = Math.sin(this.elapsed * 1.7 + offset) * 0.011;
      // Carry bends at shoulders AND elbows, hands clear the jacket. The
      // backpack uses Body only and never inherits these arm rotations.
      this.jointTargets[`Arm${side}`].set(
        THREE.MathUtils.lerp(swing + idle - this.airBlend * 0.24, -0.48, this.carryBlend),
        sign * (0.04 + this.carryBlend * 0.06),
        sign * (this.airBlend * 0.10 - this.carryBlend * 0.07),
      );
      this.jointTargets[`Forearm${side}`].set(
        THREE.MathUtils.lerp(-0.09 - Math.max(0, -swing) * 0.35 - this.airBlend * 0.18, -0.68, this.carryBlend), 0, 0,
      );
      this.jointTargets[`Hand${side}`].set(0.02 + this.carryBlend * 0.12, sign * this.carryBlend * 0.10, 0);
    }

    for (const { name } of LAB_PLAYER_JOINTS) {
      this.tempQuaternion.setFromEuler(this.jointTargets[name]);
      // Frame-rate independent interpolation prevents state snaps. Fast limb
      // response preserves support timing while upper body keeps inertial lag.
      const rate = /Thigh|Shin|Foot/.test(name) ? 38 : name === 'Head' ? 9 : 16;
      this.bones[name].quaternion.slerp(this.tempQuaternion, 1 - Math.exp(-rate * dt));
    }
    const next = phase ? 'phase' : !grounded ? (vy > 0 ? 'jump' : 'fall')
      : Math.abs(this.landing) > 0.005 ? 'landing'
        : carrying ? (this.speed > 0.2 ? 'carry_walk' : 'carry_idle')
          : this.speed > 3.4 ? 'run' : this.speed > 0.2 ? 'walk' : 'idle';
    if (next !== this.state) { this.state = next; this.onStateChange({ state: next, label: next }); }
    this.rig.mesh.updateWorldMatrix(true, true);
    this.rig.skeleton.update();
    this.snapCarrierToBody();
  }

  snapCarrierToBody() {
    if (!this.carrier?.parent) return;
    const a = this.bones.HandL.getWorldPosition(new THREE.Vector3());
    const b = this.bones.HandR.getWorldPosition(new THREE.Vector3());
    this.tempVector.copy(a).add(b).multiplyScalar(0.5);
    this.carrier.parent.worldToLocal(this.tempVector);
    this.carrier.position.copy(this.tempVector);
    this.visual.getWorldQuaternion(this.tempQuaternion);
    const parentQuaternion = this.carrier.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.carrier.quaternion.copy(parentQuaternion).multiply(this.tempQuaternion);
    this.carrier.updateWorldMatrix(true, true);
  }
}
