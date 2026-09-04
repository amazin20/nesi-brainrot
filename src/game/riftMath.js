import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export function riftQuaternionFromNormal(normal) {
  const zAxis = normal.clone().normalize();
  const upHint = Math.abs(zAxis.dot(UP)) > 0.96 ? new THREE.Vector3(0, 0, 1) : UP;
  const xAxis = upHint.clone().cross(zAxis).normalize();
  const yAxis = zAxis.clone().cross(xAxis).normalize();
  return new THREE.Quaternion()
    .setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis))
    .normalize();
}

export function makeRiftFrame(position, normal) {
  const normalized = normal.clone().normalize();
  return {
    position: position.clone(),
    normal: normalized,
    quaternion: riftQuaternionFromNormal(normalized),
  };
}

export function computeRiftExit(anchor, options = {}) {
  const result = anchor.position.clone().addScaledVector(anchor.normal, -(options.clearance ?? 1.22));
  result.y = THREE.MathUtils.clamp(
    anchor.position.y - (options.verticalOffset ?? 1.18),
    options.minY ?? 0.04,
    options.maxY ?? 5.7,
  );
  return result;
}

export function buildRiftRoute(startPosition, anchor, options = {}) {
  const start = startPosition.clone();
  const end = computeRiftExit(anchor, options);
  const distanceToAnchor = start.distanceTo(anchor.position);
  const approach = anchor.position.clone().addScaledVector(
    anchor.normal,
    THREE.MathUtils.clamp(distanceToAnchor * 0.28, 1.35, 3.1),
  );
  const control = start.clone().lerp(approach, 0.72);
  control.y += options.arcHeight ?? THREE.MathUtils.clamp(0.7 + distanceToAnchor * 0.055, 0.9, 1.75);
  return {
    start,
    control,
    end,
    anchorNormal: anchor.normal.clone(),
    distance: start.distanceTo(end),
  };
}

export function sampleRiftRoute(route, amount, target = new THREE.Vector3()) {
  const t = THREE.MathUtils.clamp(amount, 0, 1);
  const inverse = 1 - t;
  return target.copy(route.start).multiplyScalar(inverse * inverse)
    .addScaledVector(route.control, 2 * inverse * t)
    .addScaledVector(route.end, t * t);
}

export function riftRouteTangent(route, amount, target = new THREE.Vector3()) {
  const t = THREE.MathUtils.clamp(amount, 0, 1);
  const tail = route.end.clone().sub(route.control);
  return target.copy(route.control).sub(route.start).multiplyScalar(2 * (1 - t))
    .addScaledVector(tail, 2 * t)
    .normalize();
}

export function calculateRiftExitVelocity(incomingVelocity, route, options = {}) {
  const baseImpulse = options.baseImpulse ?? 5.8;
  const maxBonus = options.maxBonus ?? 4.4;
  const planarSpeed = Math.hypot(incomingVelocity.x, incomingVelocity.z);
  const fallingCharge = Math.max(0, -incomingVelocity.y) * 0.32;
  const bonus = THREE.MathUtils.clamp(planarSpeed * 0.42 + fallingCharge, 0, maxBonus);
  const direction = route.anchorNormal.clone().negate();
  direction.y += THREE.MathUtils.clamp((route.end.y - route.start.y) * 0.08, -0.18, 0.28);
  return direction.normalize().multiplyScalar(baseImpulse + bonus);
}

export function forwardFromYawPitch(yaw, pitch, target = new THREE.Vector3()) {
  return target.set(0, 0, -1)
    .applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'))
    .normalize();
}
