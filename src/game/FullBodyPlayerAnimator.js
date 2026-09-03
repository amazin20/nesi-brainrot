import * as THREE from 'three';
import { PLAYER_RIG_SPEC, createPlayerRig } from './PlayerRig.js';

export const PLAYER_ANIMATION_LABELS = Object.freeze({
  idle: 'IDLE / ЖИВАЯ СТОЙКА',
  move_start: 'MOVE START / ТОЛЧОК',
  move_stop: 'MOVE STOP / ТОРМОЖЕНИЕ',
  walk: 'WALK / ПОЛНЫЙ ШАГ',
  run: 'RUN / ФИЗИЧЕСКИЙ БЕГ',
  jump_takeoff: 'JUMP / ТОЛЧОК',
  jump_air: 'JUMP / ГРУППИРОВКА',
  jump_fall: 'JUMP / ПОДГОТОВКА К ЗЕМЛЕ',
  landing: 'LANDING / АМОРТИЗАЦИЯ',
  grab: 'GRAB / ЗАХВАТ',
  pull: 'PULL / ТЯГА',
  push: 'PUSH / ТОЛЧОК',
  throw: 'THROW / БРОСОК',
  carry_idle: 'CARRY IDLE / УДЕРЖАНИЕ',
  carry_walk: 'CARRY WALK / ШАГ ПОД НАГРУЗКОЙ',
  stumble: 'STUMBLE / ПОТЕРЯ РАВНОВЕСИЯ',
});

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

class VectorSpring {
  constructor(frequency = 16, damping = 1, maxVelocity = 18) {
    this.frequency = frequency;
    this.damping = damping;
    this.maxVelocity = maxVelocity;
    this.value = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.delta = new THREE.Vector3();
  }

  reset(value = new THREE.Vector3()) {
    this.value.copy(value);
    this.target.copy(value);
    this.velocity.set(0, 0, 0);
  }

  step(dt) {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    const iterations = Math.max(1, Math.ceil(safeDt / (1 / 120)));
    const step = safeDt / iterations;
    const stiffness = this.frequency * this.frequency;
    const drag = 2 * this.damping * this.frequency;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      this.velocity.addScaledVector(this.delta.copy(this.target).sub(this.value), stiffness * step);
      this.velocity.addScaledVector(this.velocity, -drag * step);
      if (this.velocity.lengthSq() > this.maxVelocity * this.maxVelocity) this.velocity.setLength(this.maxVelocity);
      this.value.addScaledVector(this.velocity, step);
    }
    return this.value;
  }
}

class ScalarSpring {
  constructor(frequency = 16, damping = 1) {
    this.frequency = frequency;
    this.damping = damping;
    this.value = 0;
    this.velocity = 0;
    this.target = 0;
  }

  reset(value = 0) {
    this.value = value;
    this.velocity = 0;
    this.target = value;
  }

  step(dt) {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    const iterations = Math.max(1, Math.ceil(safeDt / (1 / 120)));
    const step = safeDt / iterations;
    const stiffness = this.frequency * this.frequency;
    const drag = 2 * this.damping * this.frequency;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      this.velocity += ((this.target - this.value) * stiffness - this.velocity * drag) * step;
      this.velocity = THREE.MathUtils.clamp(this.velocity, -24, 24);
      this.value += this.velocity * step;
    }
    return this.value;
  }
}

const SPRING_TUNING = Object.freeze({
  Pelvis: [17, 0.97], Spine: [16, 0.97], Chest: [15, 0.96], Neck: [13, 0.94], Head: [12, 0.93],
  EarL: [6.8, 0.84], EarR: [7, 0.85], Cape: [5.7, 0.86],
  UpperArmL: [17, 0.94], LowerArmL: [19, 0.95], HandL: [17, 0.93],
  UpperArmR: [17, 0.94], LowerArmR: [19, 0.95], HandR: [17, 0.93],
  UpperLegL: [21, 0.98], LowerLegL: [22, 0.99], FootL: [21, 0.98],
  UpperLegR: [21, 0.98], LowerLegR: [22, 0.99], FootR: [21, 0.98],
});

const TRANSITION_DURATION = Object.freeze({
  idle: 0.16, move_start: 0.08, move_stop: 0.07, walk: 0.13, run: 0.1,
  jump_takeoff: 0.08, jump_air: 0.12, jump_fall: 0.1, landing: 0.07,
  grab: 0.12, pull: 0.14, push: 0.12, throw: 0.1,
  carry_idle: 0.16, carry_walk: 0.13, stumble: 0.08,
});

const INTERACTION_DURATION = Object.freeze({ grab: 0.72, pull: 0.92, push: 0.82, throw: 0.9 });
const FOOT_IK_MAX_INFLUENCE = 0.34;

const POSE_LIMITS = Object.freeze({
  Pelvis: [[-0.55, 0.55], [-0.5, 0.5], [-0.55, 0.55]],
  Spine: [[-0.75, 0.6], [-0.65, 0.65], [-0.65, 0.65]],
  Chest: [[-0.9, 0.75], [-0.8, 0.8], [-0.8, 0.8]],
  Neck: [[-0.5, 0.5], [-0.65, 0.65], [-0.5, 0.5]],
  Head: [[-0.6, 0.6], [-0.8, 0.8], [-0.65, 0.65]],
  EarL: [[-0.9, 0.9], [-0.4, 0.4], [-0.6, 0.6]],
  EarR: [[-0.9, 0.9], [-0.4, 0.4], [-0.6, 0.6]],
  Cape: [[-1, 1], [-0.8, 0.8], [-0.8, 0.8]],
  UpperArmL: [[-1.55, 0.85], [-1, 1], [-1.1, 1.1]],
  LowerArmL: [[-1.65, 1.25], [-0.8, 0.8], [-0.9, 0.9]],
  HandL: [[-0.8, 0.8], [-0.8, 0.8], [-0.8, 0.8]],
  UpperArmR: [[-1.55, 0.85], [-1, 1], [-1.1, 1.1]],
  LowerArmR: [[-1.65, 1.25], [-0.8, 0.8], [-0.9, 0.9]],
  HandR: [[-0.8, 0.8], [-0.8, 0.8], [-0.8, 0.8]],
  UpperLegL: [[-0.8, 0.85], [-0.65, 0.65], [-0.55, 0.55]],
  LowerLegL: [[-0.05, 1.65], [-0.45, 0.45], [-0.45, 0.45]],
  FootL: [[-1.2, 0.85], [-0.45, 0.45], [-0.45, 0.45]],
  UpperLegR: [[-0.8, 0.85], [-0.65, 0.65], [-0.55, 0.55]],
  LowerLegR: [[-0.05, 1.65], [-0.45, 0.45], [-0.45, 0.45]],
  FootR: [[-1.2, 0.85], [-0.45, 0.45], [-0.45, 0.45]],
});

/** Procedural full-body animation. The physics root remains authoritative. */
export class PlayerAnimator {
  constructor({ visual, carrier, onStateChange = () => {} }) {
    this.visual = visual;
    this.carrier = carrier;
    this.onStateChange = onStateChange;
    this.rig = createPlayerRig(visual);
    this.bones = this.rig.bones;
    this.state = 'idle';
    this.stateAge = 0;
    this.phase = 0;
    this.lastPlanarSpeed = 0;
    this.lastDesiredSpeed = 0;
    this.startPulse = 0;
    this.stopPulse = 0;
    this.lastPlanarVelocity = new THREE.Vector3();
    this.interaction = null;
    this.interactionElapsed = 0;
    this.landPulse = 0;
    this.hitPulse = 0;
    this.transitionElapsed = 0;
    this.transitionDuration = 0;
    this.pose = {};
    this.joints = {};
    this.transitionFrom = {};
    this.euler = new THREE.Euler(0, 0, 0, 'XYZ');
    this.poseQuaternion = new THREE.Quaternion();
    this.pelvisOffset = new VectorSpring(20, 0.92);
    this.carrierSpring = new VectorSpring(11, 0.78);
    this.footPlant = { L: new ScalarSpring(24, 0.95), R: new ScalarSpring(24, 0.95) };
    this.footContact = { L: 0, R: 0 };
    this.footLockActive = { L: false, R: false };
    this.footLockTarget = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.gripPoint = { L: new THREE.Vector3(-0.075, 0, 0), R: new THREE.Vector3(0.075, 0, 0) };
    this.tempA = new THREE.Vector3();
    this.tempB = new THREE.Vector3();
    this.tempC = new THREE.Vector3();
    this.acceleration = new THREE.Vector3();
    this.accelerationFilter = new VectorSpring(14, 1, 180);
    this.localAcceleration = new THREE.Vector3();
    this.parentQuaternion = new THREE.Quaternion();
    this.parentQuaternionInverse = new THREE.Quaternion();
    this.forwardAcceleration = 0;
    this.lateralAcceleration = 0;
    this.braking = 0;
    this.ikJointPosition = new THREE.Vector3();
    this.ikEndPosition = new THREE.Vector3();
    this.ikToEnd = new THREE.Vector3();
    this.ikToTarget = new THREE.Vector3();
    this.ikParentQuaternion = new THREE.Quaternion();
    this.ikParentInverse = new THREE.Quaternion();
    this.ikDelta = new THREE.Quaternion();
    this.ikLocalDelta = new THREE.Quaternion();
    this.ikIdentity = new THREE.Quaternion();
    this.ikTarget = new THREE.Vector3();
    this.ikTargetB = new THREE.Vector3();
    this.ikClampedTarget = new THREE.Vector3();
    this.ikChainRoot = new THREE.Vector3();
    this.ikChainJoint = new THREE.Vector3();
    this.ikChainEnd = new THREE.Vector3();
    this.ikAxis = new THREE.Vector3();
    this.ikCurrentPlane = new THREE.Vector3();
    this.ikPolePlane = new THREE.Vector3();
    this.ikPlaneCross = new THREE.Vector3();
    this.ikPoleTarget = new THREE.Vector3();
    this.ikRoot = new THREE.Vector3();

    for (const { name } of PLAYER_RIG_SPEC) {
      if (name === 'Root') continue;
      const [frequency, damping] = SPRING_TUNING[name] ?? [17, 0.9];
      this.joints[name] = new VectorSpring(frequency, damping);
      this.pose[name] = new THREE.Vector3();
      this.transitionFrom[name] = new THREE.Vector3();
    }
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.stateAge = 0;
    this.phase = 0;
    this.lastPlanarSpeed = 0;
    this.lastDesiredSpeed = 0;
    this.startPulse = 0;
    this.stopPulse = 0;
    this.lastPlanarVelocity.set(0, 0, 0);
    this.accelerationFilter.reset();
    this.interaction = null;
    this.interactionElapsed = 0;
    this.landPulse = 0;
    this.hitPulse = 0;
    this.transitionElapsed = 0;
    this.transitionDuration = 0;
    for (const { name } of PLAYER_RIG_SPEC) {
      const bone = this.bones[name];
      bone.position.copy(this.rig.rest[name].position);
      bone.quaternion.copy(this.rig.rest[name].quaternion);
      bone.scale.set(1, 1, 1);
      this.joints[name]?.reset();
      this.transitionFrom[name]?.set(0, 0, 0);
    }
    this.pelvisOffset.reset();
    this.carrierSpring.reset(this.carrier?.position ?? new THREE.Vector3());
    for (const side of ['L', 'R']) {
      this.footPlant[side].reset();
      this.footContact[side] = 0;
      this.footLockActive[side] = false;
    }
  }

  triggerLanding(impactSpeed = 5) {
    const impulse = THREE.MathUtils.clamp(impactSpeed / 10.5, 0.28, 1);
    this.landPulse = Math.max(this.landPulse, impulse);
    this.joints.EarL.velocity.x += impulse * 2.8;
    this.joints.EarR.velocity.x += impulse * 3.2;
    this.joints.Cape.velocity.x -= impulse * 2.1;
    this.pelvisOffset.velocity.z += impulse * 0.35;
  }

  triggerHit() {
    this.hitPulse = 1;
    this.joints.UpperArmL.velocity.z += 4.2;
    this.joints.UpperArmR.velocity.z -= 3.7;
    this.joints.Head.velocity.z -= 2.2;
  }

  triggerInteraction(state) {
    if (!INTERACTION_DURATION[state]) return;
    this.interaction = state;
    this.interactionElapsed = 0;
  }

  clearPose() {
    for (const rotation of Object.values(this.pose)) rotation.set(0, 0, 0);
    this.pelvisOffset.target.set(0, 0, 0);
  }

  setRotation(name, x = 0, y = 0, z = 0) {
    this.pose[name].set(x, y, z);
  }

  addRotation(name, x = 0, y = 0, z = 0) {
    this.pose[name].x += x;
    this.pose[name].y += y;
    this.pose[name].z += z;
  }

  chooseState({ grounded, verticalVelocity, hasCargo, planarSpeed }) {
    if (this.hitPulse > 0.06) return 'stumble';
    if (this.interaction) return this.interaction;
    if (!grounded && verticalVelocity > 1.5) return 'jump_takeoff';
    if (!grounded && verticalVelocity < -1.3) return 'jump_fall';
    if (!grounded) return 'jump_air';
    if (this.landPulse > 0.07) return 'landing';
    if (!hasCargo && this.startPulse > 0.01) return 'move_start';
    if (!hasCargo && this.stopPulse > 0.01) return 'move_stop';
    if (hasCargo && planarSpeed > 0.55) return 'carry_walk';
    if (hasCargo) return 'carry_idle';
    if (planarSpeed > 6.1) return 'run';
    if (planarSpeed > 0.45) return 'walk';
    return 'idle';
  }

  updateMotionTelemetry(dt, velocity, planarSpeed) {
    const vx = Number.isFinite(velocity?.x) ? velocity.x : 0;
    const vz = Number.isFinite(velocity?.z) ? velocity.z : planarSpeed;
    this.acceleration.set(vx - this.lastPlanarVelocity.x, 0, vz - this.lastPlanarVelocity.z)
      .multiplyScalar(1 / Math.max(dt, 1 / 240));
    if (this.acceleration.lengthSq() > 32 * 32) this.acceleration.setLength(32);
    this.lastPlanarVelocity.set(vx, 0, vz);
    this.accelerationFilter.target.copy(this.acceleration);
    const filteredAcceleration = this.accelerationFilter.step(dt);
    if (this.visual.parent) {
      this.visual.parent.getWorldQuaternion(this.parentQuaternion);
      this.parentQuaternionInverse.copy(this.parentQuaternion).invert();
      this.localAcceleration.copy(filteredAcceleration).applyQuaternion(this.parentQuaternionInverse);
    } else this.localAcceleration.copy(filteredAcceleration);
    this.forwardAcceleration = THREE.MathUtils.clamp(this.localAcceleration.z, -32, 32);
    this.lateralAcceleration = THREE.MathUtils.clamp(this.localAcceleration.x, -32, 32);
    this.braking = Math.max(0, -this.forwardAcceleration);
  }

  applyBasePose(time, effort, turnRate) {
    const breath = Math.sin(time * 1.75);
    const micro = Math.sin(time * 0.83 + 0.6);
    const forwardLean = THREE.MathUtils.clamp(this.forwardAcceleration / 32, -0.14, 0.14);
    const sideLean = THREE.MathUtils.clamp(this.lateralAcceleration / 30, -0.18, 0.18);
    const brakeCrouch = THREE.MathUtils.clamp(this.braking / 25, 0, 0.28);
    this.addRotation('Spine', -0.012 + breath * 0.013 - effort * 0.035 - forwardLean * 0.5, -turnRate * 0.018, micro * 0.008 - sideLean * 0.62);
    this.addRotation('Chest', -0.01 - breath * 0.018 - effort * 0.035 - forwardLean, -turnRate * 0.02, -micro * 0.012 - sideLean);
    this.addRotation('Neck', breath * 0.008, turnRate * 0.018, micro * 0.006);
    this.addRotation('Head', -breath * 0.012 + forwardLean * 0.65, turnRate * 0.022, micro * 0.016 + sideLean * 0.52);
    this.addRotation('Pelvis', -effort * 0.045 - forwardLean * 0.25 + brakeCrouch * 0.18, turnRate * 0.01, -sideLean * 0.32);
    this.pelvisOffset.target.z -= breath * 0.0035;
    if (brakeCrouch > 0.001) {
      this.addRotation('Spine', brakeCrouch * 0.2);
      this.addRotation('Chest', brakeCrouch * 0.25);
      this.addRotation('UpperLegL', -brakeCrouch * 0.22);
      this.addRotation('UpperLegR', -brakeCrouch * 0.22);
      this.addRotation('LowerLegL', brakeCrouch * 0.3);
      this.addRotation('LowerLegR', brakeCrouch * 0.3);
    }
  }

  applyLocomotionPose(speedRatio, runBlend, hasCargo) {
    const step = Math.sin(this.phase);
    const across = Math.cos(this.phase);
    const stride = THREE.MathUtils.lerp(0.43, 0.82, runBlend) * (hasCargo ? 0.68 : 1);
    const lift = THREE.MathUtils.lerp(0.62, 1.08, runBlend) * (hasCargo ? 0.76 : 1);
    const leftSwing = clamp01(-step);
    const rightSwing = clamp01(step);
    this.addRotation('UpperLegL', step * stride, 0, -across * 0.018);
    this.addRotation('UpperLegR', -step * stride, 0, across * 0.018);
    this.addRotation('LowerLegL', leftSwing * lift + Math.max(0, across) * runBlend * 0.16);
    this.addRotation('LowerLegR', rightSwing * lift + Math.max(0, -across) * runBlend * 0.16);
    this.addRotation('FootL', -step * stride * 0.42 - leftSwing * lift * 0.68);
    this.addRotation('FootR', step * stride * 0.42 - rightSwing * lift * 0.68);
    const weightShift = step * THREE.MathUtils.lerp(0.045, 0.075, runBlend);
    this.addRotation('Pelvis', 0, 0, -weightShift);
    this.addRotation('Spine', 0, step * 0.035, weightShift * 0.65);
    this.addRotation('Chest', 0, -step * 0.065, -weightShift * 0.82);
    this.addRotation('Head', 0, step * 0.025, weightShift * 0.3);
    this.pelvisOffset.target.x += step * THREE.MathUtils.lerp(0.008, 0.014, runBlend);
    this.pelvisOffset.target.z += Math.abs(across) * THREE.MathUtils.lerp(0.008, 0.018, runBlend) * speedRatio;
    if (!hasCargo) {
      const armSwing = THREE.MathUtils.lerp(0.38, 0.68, runBlend);
      this.addRotation('UpperArmL', -step * armSwing - 0.08, 0, across * 0.035);
      this.addRotation('UpperArmR', step * armSwing - 0.08, 0, -across * 0.035);
      this.addRotation('LowerArmL', 0.2 + leftSwing * runBlend * 0.34);
      this.addRotation('LowerArmR', 0.2 + rightSwing * runBlend * 0.34);
      this.addRotation('HandL', step * 0.08, 0, -across * 0.04);
      this.addRotation('HandR', -step * 0.08, 0, across * 0.04);
    }
  }

  applyStartStopPose(state) {
    const duration = state === 'move_start' ? 0.32 : 0.34;
    const progress = clamp01(this.stateAge / duration);
    const pulse = Math.sin(progress * Math.PI);
    if (state === 'move_start') {
      const drive = smoothstep(0, 0.5, progress) * (1 - smoothstep(0.72, 1, progress));
      this.addRotation('Pelvis', -0.16 * drive, 0, -0.035 * pulse);
      this.addRotation('Spine', -0.19 * drive, 0, 0.045 * pulse);
      this.addRotation('Chest', -0.24 * drive, 0, -0.055 * pulse);
      this.addRotation('Head', 0.13 * drive);
      this.addRotation('UpperLegL', -0.28 * pulse, 0, -0.04);
      this.addRotation('UpperLegR', 0.22 * pulse, 0, 0.04);
      this.addRotation('LowerLegL', 0.48 * pulse);
      this.addRotation('FootL', -0.3 * pulse);
      this.addRotation('UpperArmL', 0.25 * pulse, 0, 0.08);
      this.addRotation('UpperArmR', -0.25 * pulse, 0, -0.08);
      this.pelvisOffset.target.z += drive * 0.025;
    } else {
      const brace = pulse;
      this.addRotation('Pelvis', 0.2 * brace, 0, 0.045 * brace);
      this.addRotation('Spine', 0.22 * brace, 0, -0.06 * brace);
      this.addRotation('Chest', 0.28 * brace, 0, 0.07 * brace);
      this.addRotation('Head', -0.16 * brace);
      this.addRotation('UpperLegL', -0.22 * brace);
      this.addRotation('UpperLegR', -0.18 * brace);
      this.addRotation('LowerLegL', 0.62 * brace);
      this.addRotation('LowerLegR', 0.54 * brace);
      this.addRotation('FootL', -0.4 * brace);
      this.addRotation('FootR', -0.35 * brace);
      this.addRotation('UpperArmL', -0.3 * brace, 0, 0.22 * brace);
      this.addRotation('UpperArmR', -0.3 * brace, 0, -0.22 * brace);
      this.pelvisOffset.target.z += brace * 0.052;
    }
  }

  applyCarryPose(moving) {
    const step = moving ? Math.sin(this.phase) : 0;
    const brace = moving ? Math.abs(Math.cos(this.phase)) : 0;
    this.setRotation('UpperArmL', -0.82 + step * 0.035, 0.27, 0.08);
    this.setRotation('LowerArmL', -1.08 - brace * 0.08, -0.04, -0.04);
    this.setRotation('HandL', -0.08, 0.12, -0.08);
    this.setRotation('UpperArmR', -0.82 - step * 0.035, -0.27, -0.08);
    this.setRotation('LowerArmR', -1.08 - brace * 0.08, 0.04, 0.04);
    this.setRotation('HandR', -0.08, -0.12, 0.08);
    this.addRotation('Spine', -0.07);
    this.addRotation('Chest', -0.08, 0, step * 0.018);
  }

  applyAirPose(state, verticalVelocity) {
    if (state === 'jump_takeoff') {
      const compression = clamp01(0.35 + (9 - verticalVelocity) * 0.04);
      this.setRotation('UpperLegL', -0.22, 0, -0.06);
      this.setRotation('UpperLegR', -0.22, 0, 0.06);
      this.setRotation('LowerLegL', 0.82 * compression);
      this.setRotation('LowerLegR', 0.82 * compression);
      this.setRotation('FootL', -0.54 * compression);
      this.setRotation('FootR', -0.54 * compression);
      this.pelvisOffset.target.z += 0.045 * compression;
      this.addRotation('Chest', 0.13);
      this.addRotation('UpperArmL', -0.62, 0, 0.16);
      this.addRotation('UpperArmR', -0.62, 0, -0.16);
    } else if (state === 'jump_air') {
      this.setRotation('UpperLegL', -0.42, -0.05, -0.08);
      this.setRotation('UpperLegR', -0.34, 0.05, 0.08);
      this.setRotation('LowerLegL', 1.03);
      this.setRotation('LowerLegR', 0.88);
      this.setRotation('FootL', -0.52);
      this.setRotation('FootR', -0.44);
      this.addRotation('Spine', -0.09);
      this.setRotation('UpperArmL', -1.02, 0.05, 0.22);
      this.setRotation('UpperArmR', -0.9, -0.04, -0.18);
      this.setRotation('LowerArmL', 0.5);
      this.setRotation('LowerArmR', 0.42);
    } else {
      this.setRotation('UpperLegL', 0.08, 0, -0.035);
      this.setRotation('UpperLegR', 0.04, 0, 0.035);
      this.setRotation('LowerLegL', 0.3);
      this.setRotation('LowerLegR', 0.24);
      this.setRotation('FootL', -0.18);
      this.setRotation('FootR', -0.15);
      this.addRotation('Chest', 0.12);
      this.setRotation('UpperArmL', -0.46, 0, 0.3);
      this.setRotation('UpperArmR', -0.46, 0, -0.3);
      this.setRotation('LowerArmL', 0.34);
      this.setRotation('LowerArmR', 0.34);
    }
  }

  applyLandingPose(amount) {
    const crouch = clamp01(amount);
    this.setRotation('UpperLegL', -0.26 * crouch, 0, -0.05 * crouch);
    this.setRotation('UpperLegR', -0.26 * crouch, 0, 0.05 * crouch);
    this.setRotation('LowerLegL', 1.05 * crouch);
    this.setRotation('LowerLegR', 1.05 * crouch);
    this.setRotation('FootL', -0.72 * crouch);
    this.setRotation('FootR', -0.72 * crouch);
    this.pelvisOffset.target.z += 0.082 * crouch;
    this.addRotation('Pelvis', 0.1 * crouch);
    this.addRotation('Spine', 0.16 * crouch);
    this.addRotation('Chest', 0.19 * crouch);
    this.addRotation('Head', -0.12 * crouch);
    this.addRotation('UpperArmL', -0.38 * crouch, 0, 0.32 * crouch);
    this.addRotation('UpperArmR', -0.38 * crouch, 0, -0.32 * crouch);
  }

  applyStumblePose(amount) {
    const pulse = clamp01(amount);
    this.addRotation('Pelvis', 0.12 * pulse, -0.08 * pulse, 0.28 * pulse);
    this.addRotation('Spine', 0.22 * pulse, 0.12 * pulse, -0.38 * pulse);
    this.addRotation('Chest', 0.28 * pulse, 0.16 * pulse, -0.42 * pulse);
    this.addRotation('Head', -0.24 * pulse, -0.08 * pulse, 0.32 * pulse);
    this.setRotation('UpperArmL', -0.2, 0.12, 0.86 * pulse);
    this.setRotation('LowerArmL', 0.65 * pulse, 0, 0.18 * pulse);
    this.setRotation('UpperArmR', -0.42, -0.18, -0.72 * pulse);
    this.setRotation('LowerArmR', 0.82 * pulse, 0, -0.16 * pulse);
    this.setRotation('UpperLegL', -0.24 * pulse, 0, -0.12 * pulse);
    this.setRotation('UpperLegR', 0.32 * pulse, 0, 0.1 * pulse);
    this.setRotation('LowerLegL', 0.5 * pulse);
    this.setRotation('LowerLegR', 0.22 * pulse);
    this.pelvisOffset.target.x += 0.045 * pulse;
    this.pelvisOffset.target.z += 0.025 * pulse;
  }

  applyInteractionPose(state, progress) {
    const p = clamp01(progress);
    const reach = Math.sin(Math.min(1, p * 1.35) * Math.PI * 0.5);
    if (state === 'grab') {
      this.pelvisOffset.target.z += reach * 0.045;
      this.setRotation('UpperLegL', -0.12 * reach);
      this.setRotation('UpperLegR', -0.12 * reach);
      this.setRotation('LowerLegL', 0.52 * reach);
      this.setRotation('LowerLegR', 0.52 * reach);
      this.addRotation('Chest', -0.28 * reach);
      this.setRotation('UpperArmL', -0.94 * reach, 0.22, 0.08);
      this.setRotation('LowerArmL', -0.82 * reach, -0.04, 0);
      this.setRotation('UpperArmR', -0.94 * reach, -0.22, -0.08);
      this.setRotation('LowerArmR', -0.82 * reach, 0.04, 0);
    } else if (state === 'pull') {
      const tension = Math.sin(p * Math.PI);
      this.addRotation('Pelvis', 0.16 * tension);
      this.addRotation('Spine', 0.28 * tension);
      this.addRotation('Chest', 0.32 * tension);
      this.setRotation('UpperArmL', -0.78, 0.25, 0.05);
      this.setRotation('UpperArmR', -0.78, -0.25, -0.05);
      this.setRotation('LowerArmL', -1.35 + tension * 0.42);
      this.setRotation('LowerArmR', -1.35 + tension * 0.42);
    } else if (state === 'push') {
      const drive = Math.sin(p * Math.PI);
      this.addRotation('Pelvis', -0.14 * drive);
      this.addRotation('Spine', -0.24 * drive);
      this.addRotation('Chest', -0.3 * drive);
      this.setRotation('UpperArmL', -1.12, 0.18, 0.04);
      this.setRotation('UpperArmR', -1.12, -0.18, -0.04);
      this.setRotation('LowerArmL', -0.25 + drive * 0.18);
      this.setRotation('LowerArmR', -0.25 + drive * 0.18);
    } else if (state === 'throw') {
      const windup = smoothstep(0, 0.42, p) * (1 - smoothstep(0.42, 0.66, p));
      const release = smoothstep(0.42, 0.72, p);
      this.addRotation('Pelvis', 0, -0.38 * windup + 0.54 * release, 0);
      this.addRotation('Chest', 0, -0.55 * windup + 0.74 * release, -0.12 * windup);
      this.setRotation('UpperArmR', 0.35 * windup - 1.38 * release, -0.25, -0.14);
      this.setRotation('LowerArmR', 1.02 * windup - 0.22 * release);
      this.setRotation('UpperArmL', -0.32, 0.1, 0.35 * windup);
      this.addRotation('Head', 0, 0.22 * windup - 0.32 * release, 0);
    }
  }

  applySecondaryPhysics(time, speedRatio, verticalVelocity, turnRate) {
    const forwardLag = THREE.MathUtils.clamp(this.forwardAcceleration / 30, -0.22, 0.22);
    const sideLag = THREE.MathUtils.clamp(this.lateralAcceleration / 32, -0.18, 0.18);
    const airLag = THREE.MathUtils.clamp(verticalVelocity / 13, -0.18, 0.18);
    const flutter = Math.sin(time * 4.4 + this.phase * 0.14) * (0.018 + speedRatio * 0.024);
    this.setRotation('EarL', 0.05 + forwardLag + airLag + flutter, sideLag * 0.18, 0.045 + turnRate * 0.025);
    this.setRotation('EarR', 0.035 + forwardLag * 0.92 + airLag - flutter, sideLag * 0.18, -0.045 + turnRate * 0.025);
    this.setRotation('Cape', speedRatio * 0.34 - forwardLag * 0.65 - airLag * 0.42,
      -turnRate * 0.04 + sideLag * 0.18, Math.sin(time * 3.2) * speedRatio * 0.038);
  }

  clampAndBlendPose() {
    const transition = this.transitionDuration > 0.001
      ? smoothstep(0, 1, this.transitionElapsed / this.transitionDuration)
      : 1;
    for (const { name } of PLAYER_RIG_SPEC) {
      const target = this.pose[name];
      if (!target) continue;
      const limits = POSE_LIMITS[name];
      if (limits) {
        target.x = THREE.MathUtils.clamp(target.x, limits[0][0], limits[0][1]);
        target.y = THREE.MathUtils.clamp(target.y, limits[1][0], limits[1][1]);
        target.z = THREE.MathUtils.clamp(target.z, limits[2][0], limits[2][1]);
      }
      if (transition < 1) target.lerp(this.transitionFrom[name], 1 - transition);
    }
  }

  applyRig(dt) {
    for (const { name } of PLAYER_RIG_SPEC) {
      const joint = this.joints[name];
      if (!joint) continue;
      joint.target.copy(this.pose[name]);
      const rotation = joint.step(dt);
      this.euler.set(rotation.x, rotation.y, rotation.z);
      this.poseQuaternion.setFromEuler(this.euler);
      this.bones[name].quaternion.copy(this.rig.rest[name].quaternion).multiply(this.poseQuaternion);
    }
    this.bones.Pelvis.position.copy(this.rig.rest.Pelvis.position).add(this.pelvisOffset.step(dt));
    this.visual.updateWorldMatrix(true, true);
    this.rig.skeleton.update();
  }

  solveTwoBoneIK(upperName, lowerName, endName, targetWorld, influence = 1, poleWorld = null) {
    const upper = this.bones[upperName];
    const lower = this.bones[lowerName];
    const end = this.bones[endName];
    const amount = clamp01(influence);
    if (!upper || !lower || !end || amount <= 0.001) return;
    upper.getWorldPosition(this.ikChainRoot);
    lower.getWorldPosition(this.ikChainJoint);
    end.getWorldPosition(this.ikChainEnd);
    const upperLength = this.ikChainRoot.distanceTo(this.ikChainJoint);
    const lowerLength = this.ikChainJoint.distanceTo(this.ikChainEnd);
    this.ikClampedTarget.copy(targetWorld).sub(this.ikChainRoot);
    const targetLength = this.ikClampedTarget.length();
    if (targetLength > 1e-6) {
      const minReach = Math.max(0.001, Math.abs(upperLength - lowerLength) + 0.002);
      const maxReach = Math.max(minReach, upperLength + lowerLength - 0.002);
      this.ikClampedTarget.setLength(THREE.MathUtils.clamp(targetLength, minReach, maxReach)).add(this.ikChainRoot);
    } else this.ikClampedTarget.copy(this.ikChainRoot);

    for (let pass = 0; pass < 4; pass += 1) {
      for (const joint of [lower, upper]) {
        joint.getWorldPosition(this.ikJointPosition);
        end.getWorldPosition(this.ikEndPosition);
        this.ikToEnd.copy(this.ikEndPosition).sub(this.ikJointPosition);
        this.ikToTarget.copy(this.ikClampedTarget).sub(this.ikJointPosition);
        if (this.ikToEnd.lengthSq() < 1e-7 || this.ikToTarget.lengthSq() < 1e-7) continue;
        this.ikDelta.setFromUnitVectors(this.ikToEnd.normalize(), this.ikToTarget.normalize());
        this.ikDelta.slerp(this.ikIdentity, 1 - amount);
        joint.parent.getWorldQuaternion(this.ikParentQuaternion);
        this.ikParentInverse.copy(this.ikParentQuaternion).invert();
        this.ikLocalDelta.copy(this.ikParentInverse).multiply(this.ikDelta).multiply(this.ikParentQuaternion);
        joint.quaternion.premultiply(this.ikLocalDelta).normalize();
        this.visual.updateWorldMatrix(true, true);
      }
    }

    if (poleWorld) {
      upper.getWorldPosition(this.ikChainRoot);
      lower.getWorldPosition(this.ikChainJoint);
      end.getWorldPosition(this.ikChainEnd);
      this.ikAxis.copy(this.ikChainEnd).sub(this.ikChainRoot);
      if (this.ikAxis.lengthSq() > 1e-7) {
        this.ikAxis.normalize();
        this.ikCurrentPlane.copy(this.ikChainJoint).sub(this.ikChainRoot);
        this.ikCurrentPlane.addScaledVector(this.ikAxis, -this.ikCurrentPlane.dot(this.ikAxis));
        this.ikPolePlane.copy(poleWorld).sub(this.ikChainRoot);
        this.ikPolePlane.addScaledVector(this.ikAxis, -this.ikPolePlane.dot(this.ikAxis));
        if (this.ikCurrentPlane.lengthSq() > 1e-7 && this.ikPolePlane.lengthSq() > 1e-7) {
          this.ikCurrentPlane.normalize();
          this.ikPolePlane.normalize();
          this.ikPlaneCross.copy(this.ikCurrentPlane).cross(this.ikPolePlane);
          const signedAngle = Math.atan2(
            this.ikAxis.dot(this.ikPlaneCross),
            THREE.MathUtils.clamp(this.ikCurrentPlane.dot(this.ikPolePlane), -1, 1),
          );
          this.ikDelta.setFromAxisAngle(this.ikAxis, signedAngle * amount * 0.82);
          upper.parent.getWorldQuaternion(this.ikParentQuaternion);
          this.ikParentInverse.copy(this.ikParentQuaternion).invert();
          this.ikLocalDelta.copy(this.ikParentInverse).multiply(this.ikDelta).multiply(this.ikParentQuaternion);
          upper.quaternion.premultiply(this.ikLocalDelta).normalize();
          this.visual.updateWorldMatrix(true, true);
        }
      }
    }
  }

  syncCarrierPivot(dt, hasCargo) {
    if (!hasCargo || !this.carrier?.parent) return;
    this.bones.Chest.localToWorld(this.tempC.set(0, 0.205, 0.135));
    this.carrier.parent.worldToLocal(this.tempC);
    // Feed forward the physical velocity so constant running does not stretch
    // the arms, while acceleration and turns still create readable load lag.
    this.carrier.parent.getWorldQuaternion(this.parentQuaternion);
    this.parentQuaternionInverse.copy(this.parentQuaternion).invert();
    this.tempA.copy(this.lastPlanarVelocity).applyQuaternion(this.parentQuaternionInverse);
    this.carrierSpring.target.copy(this.tempC).addScaledVector(this.tempA, 0.13);
    this.carrier.position.copy(this.carrierSpring.step(dt));
    this.carrier.rotation.set(
      -this.joints.Chest.value.x * 0.35,
      -this.joints.Chest.value.y * 0.25,
      -this.joints.Pelvis.value.z * 0.4,
    );
  }

  snapCarrierToBody() {
    if (!this.carrier?.parent) return;
    this.visual.updateWorldMatrix(true, true);
    this.bones.Chest.localToWorld(this.tempC.set(0, 0.205, 0.135));
    this.carrier.parent.worldToLocal(this.tempC);
    this.carrier.position.copy(this.tempC);
    this.carrierSpring.reset(this.tempC);
    this.carrier.rotation.set(0, 0, 0);
    this.carrier.updateWorldMatrix(true, true);
  }

  getCarryGripTarget(side, output = new THREE.Vector3()) {
    if (this.carrier?.parent) {
      output.copy(this.gripPoint[side]);
      this.carrier.localToWorld(output);
      return output;
    }
    output.set(side === 'L' ? -0.075 : 0.075, 0.205, 0.135);
    this.bones.Chest.localToWorld(output);
    return output;
  }

  getArmPoleTarget(side, output = this.ikPoleTarget) {
    output.set(side === 'L' ? -0.35 : 0.35, 0.06, 0.035);
    this.bones.Chest.localToWorld(output);
    return output;
  }

  getLegPoleTarget(side, output = this.ikPoleTarget) {
    output.set(side === 'L' ? -0.09 : 0.09, 0.26, 0.08);
    this.bones.Pelvis.localToWorld(output);
    return output;
  }

  applyArmIK(state, hasCargo) {
    if (!hasCargo && !['grab', 'pull', 'push'].includes(state)) return;
    this.visual.updateWorldMatrix(true, true);
    if (state === 'throw') {
      if (!hasCargo) return;
      const progress = clamp01(this.interactionElapsed / INTERACTION_DURATION.throw);
      const gripInfluence = 1 - smoothstep(0.34, 0.58, progress);
      if (gripInfluence <= 0.001) return;
      this.getCarryGripTarget('L', this.ikTarget);
      this.getCarryGripTarget('R', this.ikTargetB);
      this.getArmPoleTarget('L');
      this.solveTwoBoneIK('UpperArmL', 'LowerArmL', 'HandL', this.ikTarget, gripInfluence, this.ikPoleTarget);
      this.getArmPoleTarget('R');
      this.solveTwoBoneIK('UpperArmR', 'LowerArmR', 'HandR', this.ikTargetB, gripInfluence, this.ikPoleTarget);
      return;
    }
    if (hasCargo || state === 'grab') {
      this.getCarryGripTarget('L', this.ikTarget);
      this.getCarryGripTarget('R', this.ikTargetB);
      const influence = state === 'grab' ? 0.78 : 1;
      this.getArmPoleTarget('L');
      this.solveTwoBoneIK('UpperArmL', 'LowerArmL', 'HandL', this.ikTarget, influence, this.ikPoleTarget);
      this.getArmPoleTarget('R');
      this.solveTwoBoneIK('UpperArmR', 'LowerArmR', 'HandR', this.ikTargetB, influence, this.ikPoleTarget);
    } else {
      const push = state === 'push';
      this.ikTarget.set(-0.14, push ? 0.245 : 0.16, push ? 0.085 : 0.11);
      this.bones.Chest.localToWorld(this.ikTarget);
      this.ikTargetB.set(0.14, push ? 0.245 : 0.16, push ? 0.085 : 0.11);
      this.bones.Chest.localToWorld(this.ikTargetB);
      this.getArmPoleTarget('L');
      this.solveTwoBoneIK('UpperArmL', 'LowerArmL', 'HandL', this.ikTarget, push ? 0.72 : 0.62, this.ikPoleTarget);
      this.getArmPoleTarget('R');
      this.solveTwoBoneIK('UpperArmR', 'LowerArmR', 'HandR', this.ikTargetB, push ? 0.72 : 0.62, this.ikPoleTarget);
    }
  }

  applyFootIK(state, grounded, dt) {
    const canPlant = grounded && ['move_start', 'move_stop', 'walk', 'run', 'carry_walk', 'landing', 'idle', 'carry_idle'].includes(state);
    if (!canPlant) {
      for (const side of ['L', 'R']) {
        this.footPlant[side].target = 0;
        this.footContact[side] = this.footPlant[side].step(dt);
        this.footLockActive[side] = false;
      }
      return;
    }
    this.visual.updateWorldMatrix(true, true);
    this.bones.Root.getWorldPosition(this.ikRoot);
    const idle = state === 'idle' || state === 'carry_idle' || state === 'landing';
    const targets = {
      L: idle ? 1 : 1 - smoothstep(0.2, 0.72, Math.abs(Math.sin(this.phase))),
      R: idle ? 1 : 1 - smoothstep(0.2, 0.72, Math.abs(Math.sin(this.phase + Math.PI))),
    };
    for (const side of ['L', 'R']) {
      this.footPlant[side].target = targets[side];
      const contact = this.footPlant[side].step(dt);
      const wasPlanted = this.footContact[side] > 0.3;
      this.footContact[side] = contact;
      const foot = this.bones[`Foot${side}`];
      if (!this.footLockActive[side] && !wasPlanted && contact > 0.3) {
        foot.getWorldPosition(this.footLockTarget[side]);
        this.footLockTarget[side].y = this.ikRoot.y + 0.048;
        this.footLockActive[side] = true;
      }
      if (this.footLockActive[side] && contact < 0.12) this.footLockActive[side] = false;
      if (!this.footLockActive[side] || contact <= 0.02) continue;
      this.ikTarget.copy(this.footLockTarget[side]);
      this.ikTarget.y = this.ikRoot.y + 0.048;
      this.getLegPoleTarget(side);
      this.solveTwoBoneIK(
        `UpperLeg${side}`,
        `LowerLeg${side}`,
        `Foot${side}`,
        this.ikTarget,
        contact * FOOT_IK_MAX_INFLUENCE,
        this.ikPoleTarget,
      );
    }
  }

  update(dt, time, {
    planarSpeed = 0,
    planarVelocity = null,
    desiredSpeed = null,
    maxSpeed = 8.7,
    grounded = true,
    verticalVelocity = 0,
    hasCargo = false,
    turnRate = 0,
  } = {}) {
    const safeDt = Math.min(Math.max(dt, 1 / 240), 0.05);
    const speedRatio = clamp01(planarSpeed / Math.max(maxSpeed, 0.01));
    const runBlend = smoothstep(0.52, 0.82, speedRatio);
    const requestedSpeed = Number.isFinite(desiredSpeed) ? Math.max(0, desiredSpeed) : planarSpeed;
    const wantedMovement = requestedSpeed > 0.15;
    const wantedMovementLastFrame = this.lastDesiredSpeed > 0.15;
    if (grounded && !hasCargo && !wantedMovementLastFrame && wantedMovement) {
      this.startPulse = 0.32;
      this.stopPulse = 0;
    } else if (grounded && !hasCargo && wantedMovementLastFrame && !wantedMovement && planarSpeed > 0.35) {
      this.stopPulse = 0.34;
      this.startPulse = 0;
    }
    this.lastDesiredSpeed = requestedSpeed;
    this.updateMotionTelemetry(safeDt, planarVelocity, planarSpeed);
    this.lastPlanarSpeed = planarSpeed;
    this.stateAge += safeDt;
    if (this.interaction) {
      this.interactionElapsed += safeDt;
      if (this.interactionElapsed >= INTERACTION_DURATION[this.interaction]) {
        this.interaction = null;
        this.interactionElapsed = 0;
      }
    }

    const nextState = this.chooseState({ grounded, verticalVelocity, hasCargo, planarSpeed });
    if (nextState !== this.state) {
      for (const { name } of PLAYER_RIG_SPEC) {
        if (this.joints[name]) this.transitionFrom[name].copy(this.joints[name].value);
      }
      this.state = nextState;
      this.stateAge = 0;
      this.transitionElapsed = 0;
      this.transitionDuration = TRANSITION_DURATION[nextState] ?? 0.12;
      this.onStateChange({ state: nextState, label: PLAYER_ANIMATION_LABELS[nextState] ?? nextState });
    }
    this.transitionElapsed = Math.min(this.transitionElapsed + safeDt, this.transitionDuration);

    const locomoting = ['move_start', 'walk', 'run', 'carry_walk'].includes(nextState);
    if (locomoting && planarSpeed > 0.05) {
      const cycleDistance = THREE.MathUtils.lerp(2.55, 3.85, runBlend) * (hasCargo ? 0.88 : 1);
      this.phase += (planarSpeed / cycleDistance) * Math.PI * 2 * safeDt;
    } else this.phase += safeDt * 0.7;

    this.clearPose();
    this.applyBasePose(time, speedRatio, turnRate);
    if (locomoting) this.applyLocomotionPose(speedRatio, runBlend, hasCargo);
    if (nextState === 'move_start' || nextState === 'move_stop') this.applyStartStopPose(nextState);
    if (['jump_takeoff', 'jump_air', 'jump_fall'].includes(nextState)) this.applyAirPose(nextState, verticalVelocity);
    if (nextState === 'landing') this.applyLandingPose(this.landPulse);
    if (hasCargo || nextState.startsWith('carry')) this.applyCarryPose(nextState === 'carry_walk');
    if (INTERACTION_DURATION[nextState]) {
      this.applyInteractionPose(nextState, clamp01(this.interactionElapsed / INTERACTION_DURATION[nextState]));
    }
    if (nextState === 'stumble') this.applyStumblePose(this.hitPulse);
    this.applySecondaryPhysics(time, speedRatio, verticalVelocity, turnRate);
    this.clampAndBlendPose();
    this.applyRig(safeDt);
    this.syncCarrierPivot(safeDt, hasCargo);
    this.applyArmIK(nextState, hasCargo);
    this.applyFootIK(nextState, grounded, safeDt);
    this.rig.skeleton.update();
    this.landPulse = Math.max(0, this.landPulse - safeDt * 3.1);
    this.hitPulse = Math.max(0, this.hitPulse - safeDt * 1.75);
    this.startPulse = Math.max(0, this.startPulse - safeDt);
    this.stopPulse = Math.max(0, this.stopPulse - safeDt);
  }
}
