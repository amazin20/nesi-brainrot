import * as THREE from 'three';
import { LabFootContact } from './LabFootContact.js';

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

/** The swing meets the planted path with matching velocity AND acceleration.
 * A cubic ease stopped the foot at toe-off/strike in the previous cycle; this
 * quintic keeps the trailing foot travelling back while it lifts, then carries
 * it forward and eases into the next planted stride without a velocity corner.
 */
export function sampleLabFootCycle(cycle, stride, run = 0) {
  cycle = ((cycle % 1) + 1) % 1;
  const stance = THREE.MathUtils.lerp(.57, .44, clamp(run, 0, 1));
  if (cycle < stance) {
    const u=cycle/stance;
    // Heel reception -> flat support -> toe roll. Separate foot articulation
    // prevents the previous flat-shoe pendulum, without stretching the legs.
    const roll=-.14*(1-smooth(0,.24,u))+.25*smooth(.70,1,u);
    return {path:stride*(1-2*u),lift:0,planted:true,roll};
  }
  const t = (cycle - stance) / (1 - stance);
  const tangent = -2 * (1 - stance) / stance;
  const ease = t * t * t * (10 + t * (-15 + 6 * t));
  return { path: stride * (-1 + tangent * t + (2 - tangent) * ease),
    lift: Math.sin((t + .11*Math.sin(2*Math.PI*t)/(2*Math.PI)) * Math.PI) ** 4 * (0.043 + 0.037 * run),
    roll:THREE.MathUtils.lerp(.25,-.14,smooth(0,1,t)),planted:false };
}

/** Solve a fixed-length anatomical arm in its shoulder-parent coordinates.
 * The stable, outward/downward elbow pole avoids flipping at a straight arm.
 * This returns rotations only: no scaling, translating joints, or editing skin.
 */
export function solveLabArm(shoulder, target, upperRest, lowerRest, side = 'L') {
  const upperLength = upperRest.length(), lowerLength = lowerRest.length();
  const offset = target.clone().sub(shoulder);
  const requestedDistance = offset.length();
  const direction = requestedDistance > 1e-8 ? offset.multiplyScalar(1 / requestedDistance)
    : new THREE.Vector3(0, 1, 0);
  const distance = clamp(requestedDistance, Math.abs(upperLength - lowerLength) + 0.003,
    upperLength + lowerLength - 0.0005);
  const pole = new THREE.Vector3(side === 'L' ? -0.62 : 0.62, -0.18, 0.78);
  pole.addScaledVector(direction, -pole.dot(direction));
  if (pole.lengthSq() < 1e-6) pole.set(0, 0, 1).addScaledVector(direction, -direction.z);
  if (pole.lengthSq() < 1e-6) pole.set(1, 0, 0);
  pole.normalize();
  const along = (upperLength ** 2 + distance ** 2 - lowerLength ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  const upper = direction.clone().multiplyScalar(along).addScaledVector(pole, height);
  const lower = direction.clone().multiplyScalar(distance).sub(upper);
  const arm = new THREE.Quaternion().setFromUnitVectors(upperRest.clone().normalize(), upper.clone().normalize());
  const forearm = new THREE.Quaternion().setFromUnitVectors(lowerRest.clone().normalize(),
    lower.applyQuaternion(arm.clone().invert()).normalize());
  return { arm, forearm, reachableTarget: shoulder.clone().addScaledVector(direction, distance),
    clamped: Math.abs(distance - requestedDistance) > 1e-6 };
}

/**
 * Local 14-bone animation; the physics root and authored mesh stay authoritative.
 * update(): speed in world units/s; velocity.y in world units/s; turnRate in
 * radians/s; moveForward/moveRight are character-local directions (+forward,
 * +right), normalized together here. Omitting direction preserves forward gait.
 * weapon defaults true. aiming raises the right-hand hold; aimPitch is radians
 * (+up, clamped to -0.5..0.65). carrying smoothly takes priority over the device.
 * triggerInteraction('pickup'|'place') reaches and recovers over 0.68/0.62s;
 * callers remain responsible for the actual item transfer. triggerShot() adds
 * a short local right-hand recoil. HandR remains the device attachment bone.
 * trigger('celebrate'|'success'|'curious'|'jump'|'anticipate_jump'|'catch'|'drop')
 * adds a short expression without moving the physics root. triggerJump() is an
 * anticipation alias. carryGripTargets={left,right} supplies WORLD wrist contact
 * points on the physical cargo. Two-bone IK follows them without moving cargo;
 * diagnostics.carryReach reports world-space contact errors and reach clamping.
 * Optional lookTarget is a WORLD point of interest; attention gently follows
 * nearby objects in front while idle/carrying and yields completely to aiming.
 * update is intended for every rendered frame; bounded
 * 1/240s animation substeps keep blends consistent across display refresh rates.
 */
export class LabPlayerAnimator {
  constructor({ visual, carrier, onStateChange = () => {} }) {
    this.visual = visual;
    this.carrier = carrier;
    this.onStateChange = onStateChange;
    this.rig = createLabPlayerRig(visual);
    this.groundContact = new LabFootContact(this.rig);
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
    this.carrierParentQuaternion = new THREE.Quaternion();
    this.leftHandPosition = new THREE.Vector3();
    this.rightHandPosition = new THREE.Vector3();
    this.basePose = Object.fromEntries(LAB_PLAYER_JOINTS.map(({ name }) => [name, new THREE.Quaternion()]));
    this.gripTargets = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    this.releaseGripLocal = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    this.carryReach = { blend: 0, leftError: null, rightError: null, leftClamped: false, rightClamped: false };
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
      groundContact: this.groundContact.diagnostics,
      locomotion: this.locomotionState,
      cadenceHz: this.cadenceHz ?? 0,
      movementDirection: { forward: this.directionForward, right: this.directionRight },
      bodyInertia: { forward: this.inertiaForward, right: this.inertiaRight },
      weaponBlend: this.weaponBlend,
      aimBlend: this.aimBlend,
      carryBlend: this.carryBlend,
      recoil: this.recoil,
      carryReach: { ...this.carryReach },
      airborne: { phase: this.airbornePhase, age: this.airAge, lift: this.ascentBlend, lead: this.takeoffLead },
      attention: { blend: this.attentionBlend, yaw: this.attentionYaw, pitch: this.attentionPitch },
      expression: this.expression ? { ...this.expression } : null,
      idle: { blend: this.idleBlend, footTap: this.idleFootTap },
      anticipation: this.anticipation,
      handoff: { progress: this.holsterProgress, stowing: this.carryingRequested, blend: this.handoffBlend },
      interaction: this.interaction ? { ...this.interaction, blend: this.interactionBlend } : null,
      movingJoints: Object.values(this.bones).filter((bone) => Math.abs(bone.quaternion.w) < 0.99999).length,
    };
  }

  reset() {
    this.groundContact?.reset();
    for (const { name } of LAB_PLAYER_JOINTS) {
      this.bones[name].position.copy(this.rig.rest[name]);
      this.bones[name].quaternion.identity();
      this.jointTargets[name].set(0, 0, 0);
      this.basePose?.[name]?.identity();
    }
    this.gait = this.speed = this.moveBlend = this.airBlend = this.carryBlend = 0;
    this.landing = this.landVelocity = this.turn = this.elapsed = 0;
    this.previousGrounded = true;
    this.lastVerticalSpeed = 0;
    this.state = this.locomotionState = 'idle';
    this.weaponRequested = true;
    this.weaponBlend = this.aimBlend = this.aimPitch = this.recoil = 0;
    this.directionForward = 1;
    this.directionRight = this.localForwardSpeed = this.localRightSpeed = 0;
    this.inertiaForward = this.inertiaRight = 0;
    this.commandMoving = false;
    this.locomotionTransition = null;
    this.transitionRemaining = 0;
    this.interaction = null;
    this.interactionBlend = 0;
    this.expression = null;
    this.anticipationAge = 1;
    this.anticipation = this.idleBlend = this.idleFootTap = 0;
    this.holsterProgress = this.handoffBlend = 0;
    this.carryingRequested = false;
    this.airAge = 0; this.ascentBlend = 0; this.takeoffLead = 1; this.airbornePhase = 'grounded';
    this.attentionPitch = this.attentionYaw = this.attentionBlend = 0;
    this.requestedAttention = { pitch: 0, yaw: 0, active: false };
    this.reachBlend = 0; this.hasGripTargets = false;
    this.carryReach = { blend: 0, leftError: null, rightError: null, leftClamped: false, rightClamped: false };
    this.footContact.L = this.footContact.R = 1;
    this.rig.mesh.updateWorldMatrix(true, true);
    this.rig.skeleton.update();
    this.snapCarrierToBody();
  }

  triggerLanding(impact = 4) {
    this.landVelocity = Math.min(this.landVelocity, -clamp(Math.abs(Number.isFinite(impact) ? impact : 4), 0.5, 14) * 0.075);
  }

  triggerHit() { this.triggerLanding(2); }

  trigger(kind) {
    if (kind === 'jump' || kind === 'anticipate_jump') { this.anticipationAge = 0; return true; }
    if (kind === 'catch' || kind === 'drop') return this.triggerInteraction(kind === 'catch' ? 'pickup' : 'place');
    if (kind === 'success') kind = 'celebrate';
    if (kind !== 'celebrate' && kind !== 'curious') return false;
    if (this.expression?.kind === kind) return true;
    this.expression = { kind, elapsed: 0, duration: kind === 'celebrate' ? 1.15 : 1.35 };
    return true;
  }

  triggerJump() { return this.trigger('jump'); }
  triggerInteraction(kind = 'pickup') {
    if (kind !== 'pickup' && kind !== 'place') return false;
    this.interaction = { kind, elapsed: 0, duration: kind === 'pickup' ? 0.68 : 0.62 };
    return true;
  }

  triggerShot(strength = 1) {
    if (!this.weaponRequested || this.carryBlend > 0.5) return false;
    this.recoil = Math.max(this.recoil, clamp(Number.isFinite(strength) ? strength : 1, 0, 1));
    return true;
  }

  update(input = {}) {
    const dt = clamp(Number.isFinite(input.dt ?? 1 / 60) ? (input.dt ?? 1 / 60) : 0, 0, 0.05);
    const iterations = Math.max(1, Math.ceil(dt * 240 - 1e-9));
    const step = dt / iterations;
    const startTime = Number.isFinite(input.elapsed) ? input.elapsed - dt : this.elapsed;
    // Keep the FK blend independent of the previous frame's IK overlay. Blending
    // the already corrected pose again would accumulate twist on pickup/drop.
    for (const { name } of LAB_PLAYER_JOINTS) this.bones[name].quaternion.copy(this.basePose[name]);
    const targets = input.carryGripTargets;
    this.hasGripTargets = ['left', 'right'].every(side => targets?.[side]
      && ['x', 'y', 'z'].every(axis => Number.isFinite(targets[side][axis])));
    this.rig.mesh.updateWorldMatrix(true, false);
    for (const side of ['left', 'right']) {
      if (this.hasGripTargets) {
        this.gripTargets[side].copy(targets[side]);
        this.releaseGripLocal[side].copy(targets[side]);
        this.rig.mesh.worldToLocal(this.releaseGripLocal[side]);
      } else {
        // On release the wrists recover with the player instead of reaching
        // back towards a stale world point while the player runs away.
        this.gripTargets[side].copy(this.releaseGripLocal[side]);
        this.rig.mesh.localToWorld(this.gripTargets[side]);
      }
    }
    this.requestedAttention.active = false;
    if (input.lookTarget && ['x', 'y', 'z'].every(axis => Number.isFinite(input.lookTarget[axis]))) {
      const localLook = this.rig.mesh.worldToLocal(new THREE.Vector3().copy(input.lookTarget))
        .sub(new THREE.Vector3(0, 0, -0.66));
      const yaw = -Math.atan2(localLook.x, localLook.y);
      this.requestedAttention.active = Math.abs(yaw) < 1.3 && localLook.lengthSq() > .0025;
      this.requestedAttention.yaw = clamp(yaw, -.28, .28);
      this.requestedAttention.pitch = clamp(Math.atan2(localLook.z, Math.hypot(localLook.x, localLook.y)), -.18, .22);
    }
    this.rig.mesh.getWorldScale(this.scaleVector);
    this.modelScale = Math.max(0.1, this.scaleVector.length() / Math.sqrt(3));
    for (let index = 0; index < iterations; index += 1) {
      this.stepPose({ ...input, dt: step, elapsed: startTime + step * (index + 1) });
    }
    for (const { name } of LAB_PLAYER_JOINTS) this.basePose[name].copy(this.bones[name].quaternion);
    this.groundContact.update({ dt, root: this.visual.parent, grounded: input.grounded !== false,
      contact: this.footContact, sampleGround: input.sampleGround, moving: this.moveBlend, speed: this.speed });
    this.applyCarryReach();
    // Updating the skeleton once per render keeps substeps inexpensive on the
    // original dense model and lets the attached device follow the newest pose.
    this.rig.mesh.updateWorldMatrix(true, true);
    this.rig.skeleton.update();
    this.snapCarrierToBody();
  }

  stepPose({ dt = 1 / 60, speed = 0, velocity = ORIGIN, grounded = true, turnRate = 0,
    carrying = false, phase = false, elapsed, weapon = true, aiming = false, aimPitch = 0,
    moveForward = 1, moveRight = 0 } = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    speed = clamp(Number.isFinite(speed) ? speed : 0, 0, 12);
    this.elapsed = Number.isFinite(elapsed) ? elapsed : this.elapsed + dt;
    const vy = Number.isFinite(velocity?.y) ? velocity.y : 0;
    if (grounded && !this.previousGrounded) this.triggerLanding(this.lastVerticalSpeed);
    if (!grounded && this.previousGrounded) { this.airAge = 0; this.takeoffLead = this.gait < 0.5 ? 1 : -1; }
    this.airAge = grounded ? 0 : this.airAge + dt;
    this.ascentBlend = damp(this.ascentBlend, smooth(-1.4, 2.6, vy), 10, dt);
    this.airbornePhase = grounded ? 'grounded' : vy > 2.5 ? 'push_off' : vy > -1.5 ? 'float' : 'prepare_land';
    this.previousGrounded = grounded;
    this.lastVerticalSpeed = vy;

    let forwardInput = Number.isFinite(moveForward) ? moveForward : 1;
    let rightInput = Number.isFinite(moveRight) ? moveRight : 0;
    const inputLength = Math.hypot(forwardInput, rightInput);
    if (inputLength > 0.0001) { forwardInput /= inputLength; rightInput /= inputLength; }
    else { forwardInput = 0; rightInput = 0; }
    this.directionForward = damp(this.directionForward, forwardInput, 12, dt);
    this.directionRight = damp(this.directionRight, rightInput, 12, dt);
    const previousForwardSpeed = this.localForwardSpeed, previousRightSpeed = this.localRightSpeed;
    this.localForwardSpeed = damp(this.localForwardSpeed, speed * forwardInput, 10, dt);
    this.localRightSpeed = damp(this.localRightSpeed, speed * rightInput, 10, dt);
    // Acceleration bends the torso into starts, braking, and changes of direction.
    // Source axes differ from world axes: +X torso pitch leans forward; -Y right.
    const accelerationScale = dt > 0 ? 1 / (dt * 18) : 0;
    this.inertiaForward = damp(this.inertiaForward,
      clamp((this.localForwardSpeed - previousForwardSpeed) * accelerationScale, -1, 1), 10, dt);
    this.inertiaRight = damp(this.inertiaRight,
      clamp((this.localRightSpeed - previousRightSpeed) * accelerationScale, -1, 1), 10, dt);
    const commandMoving = speed > 0.12;
    if (commandMoving !== this.commandMoving) {
      this.locomotionTransition = commandMoving ? 'start' : 'stop';
      this.transitionRemaining = commandMoving ? 0.22 : 0.28;
    }
    this.commandMoving = commandMoving;
    this.transitionRemaining = Math.max(0, this.transitionRemaining - dt);
    if (this.transitionRemaining === 0) this.locomotionTransition = null;
    this.speed = damp(this.speed, speed, 10, dt);
    this.moveBlend = damp(this.moveBlend, smooth(0.04, 1.5, this.speed), 10, dt);
    this.airBlend = damp(this.airBlend, grounded ? 0 : 1, 11, dt);
    this.carryBlend = damp(this.carryBlend, carrying ? 1 : 0, 9, dt);
    // Preserve the last contact targets during a short release blend. Contact
    // becomes exact once the handoff finishes; a sharp exponential cutoff never
    // leaves the hands visibly hovering a few millimetres behind the object.
    this.reachBlend = clamp(this.reachBlend + (carrying && this.hasGripTargets ? 1 : -1) * dt / 0.42, 0, 1);
    this.carryingRequested = !!carrying;
    this.holsterProgress = clamp(this.holsterProgress + (carrying ? 1 : -1) * dt / 0.32, 0, 1);
    this.handoffBlend = Math.sin(this.holsterProgress * Math.PI) ** 2;
    this.weaponRequested = !!weapon && !carrying;
    this.weaponBlend = damp(this.weaponBlend, weapon && !carrying ? 1 : 0, 12, dt);
    this.aimBlend = damp(this.aimBlend, aiming && weapon && !carrying ? 1 : 0, 12, dt);
    this.aimPitch = damp(this.aimPitch, clamp(Number.isFinite(aimPitch) ? aimPitch : 0, -0.5, 0.65), 12, dt);
    this.attentionBlend = damp(this.attentionBlend, this.requestedAttention.active && !aiming && grounded
      ? Math.max(1 - this.moveBlend, this.carryBlend * .55) : 0, 4, dt);
    this.attentionYaw = damp(this.attentionYaw, this.requestedAttention.yaw, 6, dt);
    this.attentionPitch = damp(this.attentionPitch, this.requestedAttention.pitch, 6, dt);
    this.recoil = damp(this.recoil, 0, 17, dt);
    this.turn = damp(this.turn, clamp(Number.isFinite(turnRate) ? turnRate : 0, -3, 3), 8, dt);
    let reach = 0;
    if (this.interaction) {
      this.interaction.elapsed = Math.min(this.interaction.duration, this.interaction.elapsed + dt);
      const progress = this.interaction.elapsed / this.interaction.duration;
      reach = smooth(0, 0.36, progress) * (1 - smooth(0.5, 1, progress));
      if (progress >= 1) this.interaction = null;
    }
    this.interactionBlend = damp(this.interactionBlend, reach, 18, dt);

    this.anticipationAge += dt;
    this.anticipation = smooth(0, 0.035, this.anticipationAge) * (1 - smooth(0.04, 0.18, this.anticipationAge));
    let celebrate = 0, curious = 0, expressionTime = 0;
    if (this.expression) {
      this.expression.elapsed = Math.min(this.expression.duration, this.expression.elapsed + dt);
      expressionTime = this.expression.elapsed;
      const envelope = smooth(0, 0.18, expressionTime)
        * (1 - smooth(this.expression.duration - 0.3, this.expression.duration, expressionTime));
      if (this.expression.kind === 'celebrate') celebrate = envelope;
      else curious = envelope;
      if (expressionTime >= this.expression.duration) this.expression = null;
    }
    const run = smooth(2.5, 5.7, this.speed);
    const stride = THREE.MathUtils.lerp(0.070, 0.110, run) * (1 - .10 * this.carryBlend);
    const turning = smooth(0.2, 1.8, Math.abs(this.turn)) * (1 - this.moveBlend);
    // Cadence is an authored rhythm, independent of the unusually short source
    // legs. Deriving it from their length produced nine frantic footfalls/s.
    // Starts lengthen into a relaxed stride; sprint never accelerates the clip
    // past 2.2 cycles/s. Ground contact is a separate bounded overlay.
    const frequency = Math.max(smooth(0, .8, this.speed) * clamp(.92 + this.speed * .24, 0, 2.2), turning * .9);
    this.cadenceHz = frequency;
    this.gait = (this.gait + dt * frequency) % 1;
    // Closed-form damped spring: a soft rebound, independent of frame size.
    const decay = Math.exp(-10.5 * dt), omega = Math.sqrt(260 - 10.5 ** 2);
    const sine = Math.sin(omega * dt), cosine = Math.cos(omega * dt);
    const landing = this.landing, landVelocity = this.landVelocity;
    this.landing = decay * (landing * cosine + (landVelocity + 10.5 * landing) / omega * sine);
    this.landVelocity = decay * (landVelocity * cosine - (10.5 * landVelocity + 260 * landing) / omega * sine);
    this.landing = clamp(this.landing, -0.065, 0.022);
    const ground = 1 - this.airBlend;
    const moving = this.moveBlend * ground;
    const turnStep = turning * ground;
    this.idleBlend = damp(this.idleBlend, ground * (1 - this.moveBlend) * (1 - turning)
      * (1 - this.aimBlend) * (1 - this.interactionBlend), 5, dt);
    const idleShift = Math.sin(this.elapsed * 1.45) * this.idleBlend;
    // A sparse, smooth self-contained gesture rather than a permanently swaying
    // mannequin. Keep boots planted; only free hands and attention participate.
    const idleCycle = this.elapsed % 11.3;
    const fidget = smooth(5.1, 5.55, idleCycle) * (1 - smooth(6.8, 7.35, idleCycle))
      * this.idleBlend * (1 - this.carryBlend);
    const counterSwing = Math.sin(this.gait * Math.PI * 2 + .25);

    this.idleFootTap = 0;
    const joy = celebrate * ground * (1 - this.aimBlend);
    const hop = Math.sin(clamp(expressionTime / 0.6, 0, 1) * Math.PI) ** 2 * joy;
    const cadence = this.gait * Math.PI * 2;
    // The pelvis rises over the support foot and settles at double support.
    // Reduce the old permanent squat, keeping bounce in legs and pelvis rather
    // than changing the visual/root scale or moving the camera.
    const strideBounce = (0.004 + run * 0.005) * (1 - Math.cos(cadence * 2)) * 0.5;
    const compression = (0.012 + run * 0.011 - strideBounce) * moving + 0.004 * turnStep - this.landing;
    this.bones.Body.position.copy(this.rig.rest.Body);
    this.bones.Body.position.z += compression + this.interactionBlend * 0.011 + this.anticipation * 0.014 - hop * 0.012;
    this.bones.Body.position.x += Math.sin(cadence - .18) * moving * (0.006 + run * 0.0025);
    const body = this.jointTargets.Body;
    body.set((0.050 + .070 * run) * moving * this.directionForward + 0.115 * this.inertiaForward * ground
      + 0.05 * this.carryBlend + this.interactionBlend * 0.095 - this.landing * 0.55,
      -0.043 * moving * this.directionRight - 0.060 * this.inertiaRight * ground,
      Math.sin(cadence + 0.15) * 0.071 * moving - this.turn * 0.026);
    body.x += this.airBlend * (0.015 + 0.095 * this.ascentBlend) + this.anticipation * 0.055;
    body.y += Math.sin(cadence - .28) * moving * 0.046;
    this.jointTargets.Head.set(-body.x * 0.6 - this.aimPitch * this.aimBlend * 0.2 + Math.sin(this.elapsed * 1.7) * 0.004,
      -body.y * 0.65 + curious * 0.065 + joy * Math.sin(expressionTime * 10) * 0.03,
      -body.z * 0.65 + Math.sin(this.elapsed * 0.85) * 0.075 * this.idleBlend
        - curious * 0.14 + joy * Math.sin(expressionTime * 9) * 0.055);
    this.jointTargets.Head.x += Math.sin(this.gait * Math.PI * 4) * moving * run * 0.013
      + curious * 0.025 + joy * Math.sin(expressionTime * 12) * 0.025;
    this.jointTargets.Head.x = THREE.MathUtils.lerp(this.jointTargets.Head.x,
      this.attentionPitch - body.x * .6, this.attentionBlend);
    this.jointTargets.Head.z = THREE.MathUtils.lerp(this.jointTargets.Head.z,
      this.attentionYaw - body.z * .65, this.attentionBlend);
    this.jointTargets.Head.y += curious * .045 + fidget * .020;
    this.jointTargets.Head.x += curious * Math.sin(expressionTime * 6.2) * .035;

    for (const [side, offset, sign] of [['L', 0, -1], ['R', 0.5, 1]]) {
      const cycle = (this.gait + offset) % 1;
      let { path, lift, planted, roll } = sampleLabFootCycle(cycle, stride, run);
      const turnPath = (path / stride) * sign * Math.sign(this.turn) * 0.021 * turnStep;
      const forward = path * moving * this.directionForward * (this.directionForward < 0 ? 0.82 : 1) + turnPath + 0.015;
      const lateral = path * moving * this.directionRight * 0.65;
      lift *= Math.max(moving, turnStep * 0.5);
      const down = 0.177 - compression - lift;
      const leg = solveLabLeg(forward, down);
      const legBlend = clamp(moving + turnStep + Math.abs(this.landing) * 8, 0, 1);
      const lateralRoll = clamp(Math.atan2(lateral, Math.max(0.09, down)), -0.21, 0.21);
      // A lead leg rises first; at the apex the trailing knee catches up, then
      // both feet extend for the landing. Vertical speed is blended across zero
      // so the jump cannot switch from one frozen pose to another at the apex.
      const leading = sign * this.takeoffLead;
      const pushOff = 1 - smooth(0.06, 0.28, this.airAge);
      const tuck = smooth(.045, .23, this.airAge);
      const landingReach = smooth(-.5, 9.5, -vy);
      const jumpFold = .07 + tuck * (.66 - .59 * landingReach)
        + leading * tuck * (1 - landingReach) * (.14 + .045 * run)
        - leading * pushOff * .05 + this.anticipation * .10;
      this.jointTargets[`Thigh${side}`].set(leg.hip * legBlend - jumpFold * this.airBlend,
        lateralRoll, sign * 0.012 * moving - this.turn * 0.018 * turnStep);
      this.jointTargets[`Shin${side}`].set(leg.knee * legBlend + jumpFold * 1.75 * this.airBlend, 0, 0);
      this.jointTargets[`Foot${side}`].set(leg.ankle * legBlend + roll * moving * (1 - .3*this.carryBlend) - jumpFold * 0.65 * this.airBlend,
        -lateralRoll, this.turn * 0.018 * turnStep);
      this.footContact[side] = grounded && (planted || moving + turnStep < 0.05) ? ground : 0;
      const swingPhase = (cycle + 0.05) * Math.PI * 2;
      const swing = clamp(Math.sin(swingPhase) * (0.40 + 0.12 * run)
        + Math.sin(swingPhase * 2 -.22) * (0.025 + run * 0.025), -0.55, 0.55) * moving
        * (this.directionForward + this.directionRight * 0.35);
      const idle = Math.sin(this.elapsed * 1.7 + offset) * 0.016 + Math.sin(this.elapsed * 0.67 + sign) * 0.006;
      const arm = this.jointTargets[`Arm${side}`];
      const forearm = this.jointTargets[`Forearm${side}`];
      const hand = this.jointTargets[`Hand${side}`];
      arm.set(swing + idle - this.airBlend * (0.17 + this.ascentBlend * 0.16)
        - this.anticipation * 0.11, sign * (0.04 + this.airBlend * 0.025 + moving * Math.sin(swingPhase - .3) * .024),
        sign * this.airBlend * (0.07 + (1 - this.ascentBlend) * 0.04));
      forearm.set(-0.09 - Math.max(0, -Math.sin(swingPhase-.32)) * moving * (0.19+.12*run) - this.airBlend * (0.10 + this.ascentBlend * 0.17), 0, 0);
      hand.set(0.02 + Math.sin(swingPhase - .35) * moving * .035, 0,
        side === 'L' ? Math.sin(swingPhase + 0.4) * (.03 + run * .025) * moving : 0);
      if (side === 'L') {
        arm.x -= fidget * .19; forearm.x -= fidget * .24;
        hand.z += fidget * Math.sin(idleCycle * 4.5) * .12;
        const wave = joy * (1 - this.carryBlend);
        arm.x = THREE.MathUtils.lerp(arm.x, -0.38 - Math.sin(expressionTime * 13) * 0.055, wave);
        arm.z = THREE.MathUtils.lerp(arm.z, 0.045 + Math.sin(expressionTime * 13) * 0.045, wave);
        forearm.x = THREE.MathUtils.lerp(forearm.x, -0.57 + Math.sin(expressionTime * 13 + 0.6) * 0.07, wave);
        hand.z += Math.sin(expressionTime * 14) * wave * 0.20;
      }
      if (side === 'R') {
        const pitch = this.aimPitch * this.aimBlend;
        const hold = this.weaponBlend;
        // Moderate shoulder/elbow bends preserve the joined jacket sleeve.
        // Most vertical aim belongs to the wrist; the device follows HandR.
        arm.x = THREE.MathUtils.lerp(arm.x, -0.21 - this.aimBlend * 0.19 - pitch * 0.12 + swing * (0.37 - .29 * this.aimBlend) + this.recoil * 0.025, hold);
        arm.y = THREE.MathUtils.lerp(arm.y, 0.045 + counterSwing * moving * .025 * (1 - this.aimBlend), hold);
        arm.z = THREE.MathUtils.lerp(arm.z, 0.025, hold);
        forearm.x = THREE.MathUtils.lerp(forearm.x, -0.44 + .10 * moving * (1 - this.aimBlend) - this.aimBlend * 0.10 - pitch * 0.14 - Math.sin(swingPhase - .4) * moving * .085 * (1 - this.aimBlend) - this.recoil * 0.055, hold);
        hand.set(THREE.MathUtils.lerp(hand.x, 0.08 + this.aimBlend * 0.19 - pitch * 0.74 - this.recoil * 0.045, hold),
          hold * 0.025, -hold * 0.025);
      }
      // Cargo brings both hands to the same supported posture; interaction adds
      // a short reach around the caller's immediate pickup/place item transfer.
      arm.x = THREE.MathUtils.lerp(arm.x, -0.48, this.carryBlend);
      arm.y = THREE.MathUtils.lerp(arm.y, -sign * 0.08, this.carryBlend);
      arm.z = THREE.MathUtils.lerp(arm.z, sign * 0.06, this.carryBlend);
      forearm.x = THREE.MathUtils.lerp(forearm.x, -0.68, this.carryBlend);
      // Bring the oversized gloves onto the cargo's rear sides. Small inward
      // rotations close the span without increasing the jacket's shoulder bend.
      forearm.y = -sign * 0.10 * this.carryBlend;
      hand.x = THREE.MathUtils.lerp(hand.x, 0.14, this.carryBlend);
      hand.y = THREE.MathUtils.lerp(hand.y, sign * 0.10, this.carryBlend);
      hand.z = THREE.MathUtils.lerp(hand.z, 0, this.carryBlend);
      arm.x = THREE.MathUtils.lerp(arm.x, -0.34, this.interactionBlend * 0.65);
      forearm.x = THREE.MathUtils.lerp(forearm.x, -0.51, this.interactionBlend * 0.65);
      if (side === 'R') {
        // Lower the device hand through a reversible handoff to the body mount.
        // Both animator and device use linear progress over exactly 0.32s.
        arm.x = THREE.MathUtils.lerp(arm.x, 0.24, this.handoffBlend * 0.85);
        forearm.x = THREE.MathUtils.lerp(forearm.x, -0.16, this.handoffBlend * 0.85);
        hand.x = THREE.MathUtils.lerp(hand.x, 0.02, this.handoffBlend * 0.85);
      }
    }

    for (const { name } of LAB_PLAYER_JOINTS) {
      this.tempQuaternion.setFromEuler(this.jointTargets[name]);
      const rate = /Thigh|Shin|Foot/.test(name) ? THREE.MathUtils.lerp(18, 12, this.airBlend) : name === 'Head' ? 8 : 12;
      this.bones[name].quaternion.slerp(this.tempQuaternion, 1 - Math.exp(-rate * dt));
    }
    const directionalGait = Math.abs(this.directionRight) > Math.abs(this.directionForward) * 0.85
      ? (this.directionRight > 0 ? 'strafe_right' : 'strafe_left')
      : this.directionForward < -0.25 ? (this.speed > 3.4 ? 'run_backward' : 'walk_backward')
        : this.speed > 3.4 ? 'run' : 'walk';
    this.locomotionState = this.locomotionTransition || (this.speed > 0.2 ? directionalGait
      : Math.abs(this.turn) > 0.25 ? (this.turn > 0 ? 'turn_right' : 'turn_left') : 'idle');
    const next = phase ? 'phase' : !grounded ? (vy > 0 ? 'jump' : 'fall')
      : Math.abs(this.landing) > 0.005 ? 'landing'
        : this.interaction ? this.interaction.kind
          : this.expression ? this.expression.kind
            : this.anticipation > 0.05 ? 'anticipate_jump'
              : carrying ? (this.speed > 0.2 ? 'carry_walk' : 'carry_idle')
            : aiming && weapon ? (this.speed > 0.2 ? 'aim_walk' : 'aim_idle') : this.locomotionState;
    if (next !== this.state) { this.state = next; this.onStateChange({ state: next, label: next }); }
  }

  applyCarryReach() {
    const blend = smooth(0.01, 0.985, this.reachBlend);
    this.carryReach.blend = blend;
    this.carryReach.leftError = this.carryReach.rightError = null;
    this.carryReach.leftClamped = this.carryReach.rightClamped = false;
    if (blend < 1e-6) return;
    this.rig.mesh.updateWorldMatrix(true, true);
    const body = this.bones.Body;
    for (const [side, key] of [['L', 'left'], ['R', 'right']]) {
      const arm = this.bones[`Arm${side}`], forearm = this.bones[`Forearm${side}`], hand = this.bones[`Hand${side}`];
      const localTarget = body.worldToLocal(this.gripTargets[key].clone());
      const solved = solveLabArm(arm.position, localTarget, this.rig.rest[`Forearm${side}`], this.rig.rest[`Hand${side}`], side);
      // Let the relaxed glove turn with its forearm as it embraces the object.
      // Locking its WORLD orientation counter-twisted the fused cuff by ~55°
      // when the elbows reached inward, although the wrist position was correct.
      // Hand position depends on its parents, so a neutral local wrist preserves
      // exact contact and the authored glove without that compensating twist.
      arm.quaternion.slerp(solved.arm, blend);
      forearm.quaternion.slerp(solved.forearm, blend);
      arm.updateWorldMatrix(true, true);
      hand.updateWorldMatrix(true, false);
      this.carryReach[`${key}Error`] = hand.getWorldPosition(new THREE.Vector3()).distanceTo(this.gripTargets[key]);
      this.carryReach[`${key}Clamped`] = solved.clamped;
    }
  }

  snapCarrierToBody() {
    if (!this.carrier?.parent) return;
    const a = this.bones.HandL.getWorldPosition(this.leftHandPosition);
    const b = this.bones.HandR.getWorldPosition(this.rightHandPosition);
    this.tempVector.copy(a).add(b).multiplyScalar(0.5);
    this.carrier.parent.worldToLocal(this.tempVector);
    this.carrier.position.copy(this.tempVector);
    this.visual.getWorldQuaternion(this.tempQuaternion);
    const parentQuaternion = this.carrier.parent.getWorldQuaternion(this.carrierParentQuaternion).invert();
    this.carrier.quaternion.copy(parentQuaternion).multiply(this.tempQuaternion);
    this.carrier.updateWorldMatrix(true, true);
  }
}
