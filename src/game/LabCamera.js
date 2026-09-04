import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const SAMPLE_OFFSETS = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2],
];

// Exact solution of a critically damped spring for a stationary goal. Unlike
// Euler integration it cannot explode or oscillate at a low render rate.
function spring(value, velocity, goal, frequency, dt) {
  const displacement = value - goal;
  const impulse = velocity + frequency * displacement;
  const decay = Math.exp(-frequency * dt);
  return [
    goal + (displacement + impulse * dt) * decay,
    (velocity - frequency * impulse * dt) * decay,
  ];
}

/**
 * Third-person camera. `target` is the player's world-space foot position.
 * Keep the blockers array itself alive: moving doors / added walls may share it.
 * Call reset after spawning, or pass teleported when position is discontinuous.
 * This module never changes player meshes, materials, or the renderer.
 */
export class LabCamera {
  constructor({ camera, blockers = [] }) {
    this.camera = camera;
    this.blockers = blockers;
    this.focus = new THREE.Vector3();
    this.focusVelocity = new THREE.Vector3();
    this.lastTarget = new THREE.Vector3();
    this.goal = new THREE.Vector3();
    this.playerPivot = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.boomDirection = new THREE.Vector3();
    this.lookPoint = new THREE.Vector3();
    this.castDirection = new THREE.Vector3();
    this.castRight = new THREE.Vector3();
    this.castUp = new THREE.Vector3();
    this.castOrigin = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.yaw = 0;
    this.pitch = -0.2;
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.distance = 6.5;
    this.distanceVelocity = 0;
    this.fovVelocity = 0;
    this.aimBlend = 0;
    this.aimBlendVelocity = 0;
    this.initialized = false;
    this.obstructed = false;
  }

  reset(target, yaw = 0, pitch = -0.2) {
    this.focus.copy(target).y += 1.32;
    this.lastTarget.copy(target);
    this.focusVelocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, -0.72, 0.3);
    this.yawVelocity = 0;
    this.pitchVelocity = 0;
    this.distance = 6.5;
    this.distanceVelocity = 0;
    this.fovVelocity = 0;
    this.aimBlend = 0;
    this.aimBlendVelocity = 0;
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.initialized = true;
    return this.update({ dt: 0, target, yaw, pitch });
  }

  update({ dt, target, yaw, pitch, velocity, aiming = false, teleported = false }) {
    if (!this.initialized || teleported || this.lastTarget.distanceToSquared(target) > 64) {
      return this.reset(target, yaw, pitch);
    }
    const step = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);
    this.lastTarget.copy(target);
    this.playerPivot.copy(target).y += 1.32;
    this.goal.copy(this.playerPivot);
    const speed = velocity ? Math.hypot(velocity.x, velocity.z) : 0;
    // Less than half a metre of anticipation. The camera has no head bob, roll,
    // shake, or vertical velocity look-ahead, keeping jumps readable and calm.
    if (speed > 0.001) {
      const anticipation = Math.min(speed * 0.065, 0.42) / speed;
      this.goal.x += velocity.x * anticipation;
      this.goal.z += velocity.z * anticipation;
    }
    for (const axis of ['x', 'y', 'z']) {
      [this.focus[axis], this.focusVelocity[axis]] = spring(
        this.focus[axis], this.focusVelocity[axis], this.goal[axis], axis === 'y' ? 16 : 22, step,
      );
    }
    const yawGoal = this.yaw + Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
    [this.yaw, this.yawVelocity] = spring(this.yaw, this.yawVelocity, yawGoal, 38, step);
    [this.pitch, this.pitchVelocity] = spring(
      this.pitch, this.pitchVelocity, THREE.MathUtils.clamp(pitch, -0.72, 0.3), 38, step,
    );
    // A shot must never move the whole frame. Even an explicit aim change moves
    // the shoulder and boom continuously instead of switching their direction
    // in one frame (which used to look like recoil despite a smooth FOV).
    [this.aimBlend, this.aimBlendVelocity] = spring(
      this.aimBlend, this.aimBlendVelocity, aiming ? 1 : 0, 12, step,
    );
    const fovGoal = aiming ? 59.5 : 62 + THREE.MathUtils.clamp((speed - 4) * 0.4, 0, 2.2);
    const oldFov = this.camera.fov;
    [this.camera.fov, this.fovVelocity] = spring(oldFov, this.fovVelocity, fovGoal, 7, step);
    if (Math.abs(oldFov - this.camera.fov) > 0.00001) this.camera.updateProjectionMatrix();

    this.forward.set(0, 0, -1).applyEuler(this.euler.set(this.pitch, this.yaw, 0, 'YXZ'));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const length = THREE.MathUtils.lerp(6.5, 5.7, this.aimBlend);
    this.desired.copy(this.focus).addScaledVector(this.forward, -length)
      .addScaledVector(this.right, THREE.MathUtils.lerp(0.62, 0.78, this.aimBlend));
    for (const object of this.blockers) object.updateWorldMatrix(true, true);

    // Resolve both the smoothed pivot and the actual player. The latter matters
    // when crossing a doorway: a lagging focus must never see through its wall.
    const desiredLength = this.desired.distanceTo(this.focus);
    this.obstructed = this.constrain(this.focus, this.desired);
    this.obstructed = this.constrain(this.playerPivot, this.desired) || this.obstructed;
    const safeLength = this.desired.distanceTo(this.focus);
    if (safeLength < this.distance) {
      this.distance = safeLength;
      this.distanceVelocity = 0;
    } else {
      [this.distance, this.distanceVelocity] = spring(
        this.distance, this.distanceVelocity, Math.min(desiredLength, safeLength), 9, step,
      );
      this.distance = Math.min(this.distance, safeLength);
    }
    this.boomDirection.copy(this.desired).sub(this.focus).normalize();
    this.camera.position.copy(this.focus).addScaledVector(this.boomDirection, this.distance);
    // The shortened/smoothed position follows a different ray at a corner;
    // validate that final position too, never just the desired endpoint.
    const pulledIn = this.constrain(this.playerPivot, this.camera.position);
    this.obstructed = this.obstructed || pulledIn;
    if (pulledIn) {
      this.distance = this.camera.position.distanceTo(this.focus);
      this.distanceVelocity = 0;
    }
    this.lookPoint.copy(this.focus).addScaledVector(this.forward, 16);
    this.camera.up.copy(UP);
    this.camera.lookAt(this.lookPoint);
    this.camera.updateMatrixWorld();
    return this;
  }

  constrain(origin, position) {
    this.castDirection.copy(position).sub(origin);
    const distance = this.castDirection.length();
    if (distance < 0.0001 || this.blockers.length === 0) return false;
    this.castDirection.multiplyScalar(1 / distance);
    this.castRight.crossVectors(UP, this.castDirection).normalize();
    if (this.castRight.lengthSq() < 0.01) this.castRight.set(1, 0, 0);
    this.castUp.crossVectors(this.castDirection, this.castRight).normalize();
    // Cover the near-plane corners as well as the lens centre. At normal
    // display sizes the 24 cm minimum gives walls a comfortable safety margin.
    const halfNearHeight = this.camera.near * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5));
    const radius = Math.max(0.24, halfNearHeight * Math.hypot(this.camera.aspect, 1) + 0.08);
    let safeDistance = distance;
    this.raycaster.near = 0;
    this.raycaster.far = distance + radius;
    for (const [x, y] of SAMPLE_OFFSETS) {
      this.castOrigin.copy(origin).addScaledVector(this.castRight, x * radius)
        .addScaledVector(this.castUp, y * radius);
      this.raycaster.set(this.castOrigin, this.castDirection);
      const hits = this.raycaster.intersectObjects(this.blockers, true);
      if (hits.length > 0) safeDistance = Math.min(safeDistance, Math.max(0, hits[0].distance - radius - 0.035));
    }
    if (safeDistance >= distance) return false;
    position.copy(origin).addScaledVector(this.castDirection, safeDistance);
    return true;
  }
}
