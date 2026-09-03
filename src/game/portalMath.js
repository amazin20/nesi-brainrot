import * as THREE from 'three';

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

export function portalQuaternionFromNormal(normal) {
  const zAxis = normal.clone().normalize();
  const upHint = Math.abs(zAxis.dot(UP)) > 0.96 ? new THREE.Vector3(0, 0, 1) : UP;
  const xAxis = upHint.clone().cross(zAxis).normalize();
  const yAxis = zAxis.clone().cross(xAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(basis).normalize();
}

export function portalContainsPoint(point, portal, radii = { x: 0.82, y: 1.28 }) {
  const local = point.clone().sub(portal.position).applyQuaternion(portal.quaternion.clone().invert());
  const ellipse = (local.x * local.x) / (radii.x * radii.x)
    + (local.y * local.y) / (radii.y * radii.y);
  return ellipse <= 1;
}

export function crossingPortal(previous, next, portal, radii) {
  const previousDistance = previous.clone().sub(portal.position).dot(portal.normal);
  const nextDistance = next.clone().sub(portal.position).dot(portal.normal);
  if (previousDistance <= 0 || nextDistance > 0) return null;
  const denominator = previousDistance - nextDistance;
  if (denominator <= 1e-8) return null;
  const amount = THREE.MathUtils.clamp(previousDistance / denominator, 0, 1);
  const crossingPoint = previous.clone().lerp(next, amount);
  return portalContainsPoint(crossingPoint, portal, radii) ? crossingPoint : null;
}

export function portalTransferRotation(source, target) {
  const flip = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
  return target.quaternion.clone()
    .multiply(flip)
    .multiply(source.quaternion.clone().invert())
    .normalize();
}

export function transferThroughPortal(position, velocity, source, target, clearance = 0.34) {
  const rotation = portalTransferRotation(source, target);
  const offset = position.clone().sub(source.position).applyQuaternion(rotation);
  const outputPosition = target.position.clone().add(offset).addScaledVector(target.normal, clearance);
  const outputVelocity = velocity.clone().applyQuaternion(rotation);
  return { position: outputPosition, velocity: outputVelocity, rotation };
}

export function forwardFromYawPitch(yaw, pitch, target = new THREE.Vector3()) {
  return target.set(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')).normalize();
}

export function yawPitchFromForward(forward) {
  const normalized = forward.clone().normalize();
  return {
    yaw: Math.atan2(-normalized.x, -normalized.z),
    pitch: Math.asin(THREE.MathUtils.clamp(normalized.y, -1, 1)),
  };
}

export function makePortalFrame(position, normal) {
  const normalized = normal.clone().normalize();
  return {
    position: position.clone(),
    normal: normalized,
    quaternion: portalQuaternionFromNormal(normalized),
  };
}

export function portalForward(portal, target = new THREE.Vector3()) {
  return target.copy(FORWARD).applyQuaternion(portal.quaternion).normalize();
}
