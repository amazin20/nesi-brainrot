import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

// Rotation-only two-link solve. The knee pole is expressed in pelvis space;
// neither the source vertices nor the lengths of the short cartoon legs change.
export function solveFootChain(hip, ankle, upperRest, lowerRest) {
  const a = upperRest.length(), b = lowerRest.length();
  const ray = ankle.clone().sub(hip);
  const distance = clamp(ray.length(), Math.abs(a - b) + .0001, a + b - .0001);
  ray.normalize();
  const pole = new THREE.Vector3(0, 1, 0).addScaledVector(ray, -ray.y);
  if (pole.lengthSq() < 1e-8) pole.set(1, 0, 0).addScaledVector(ray, -ray.x);
  pole.normalize();
  const along = (a * a + distance * distance - b * b) / (2 * distance);
  const upper = ray.clone().multiplyScalar(along).addScaledVector(pole, Math.sqrt(Math.max(0, a * a - along * along)));
  const lower = ray.clone().multiplyScalar(distance).sub(upper);
  const hipQ = new THREE.Quaternion().setFromUnitVectors(upperRest.clone().normalize(), upper.normalize());
  const kneeQ = new THREE.Quaternion().setFromUnitVectors(lowerRest.clone().normalize(), lower.applyQuaternion(hipQ.clone().invert()).normalize());
  return { hipQ, kneeQ };
}

/** Planted feet hold the ground while the pelvis travels over them. The swing
 * remains authored by the animator. The same query handles floors, furniture,
 * ramps and lifts. Teleports clear locks instead of dragging knees across rooms. */
export class LabFootContact {
  constructor(rig) {
    this.rig = rig;
    this.feet = Object.fromEntries(['L', 'R'].map(side => [side, {
      anchor: new THREE.Vector3(), orientation: new THREE.Quaternion(),
      locked: false, blend: 0, error: 0, supportHeight: 0,
    }]));
    this.lastRoot = new THREE.Vector3(); this.hasRoot = false;
    rig.mesh.geometry.computeBoundingBox();
    this.soleSourceZ = rig.mesh.geometry.boundingBox.max.z;
  }

  reset() {
    this.hasRoot = false;
    for (const foot of Object.values(this.feet)) { foot.locked = false; foot.blend = 0; foot.error = 0; }
  }

  update({ dt, root, grounded, contact, sampleGround, moving = 0 }) {
    if (!sampleGround || !root) { this.reset(); return; }
    this.rig.mesh.updateWorldMatrix(true, true);
    const rootPosition = root.getWorldPosition(new THREE.Vector3());
    if (this.hasRoot && rootPosition.distanceToSquared(this.lastRoot) > 2.25) this.reset();
    this.lastRoot.copy(rootPosition); this.hasRoot = true;
    const meshQ = this.rig.mesh.getWorldQuaternion(new THREE.Quaternion());
    const scale = this.rig.mesh.getWorldScale(new THREE.Vector3()).length() / Math.sqrt(3);
    const body = this.rig.bones.Body;
    for (const side of ['L', 'R']) {
      const foot = this.feet[side], ankle = this.rig.bones[`Foot${side}`];
      const hip = this.rig.bones[`Thigh${side}`], knee = this.rig.bones[`Shin${side}`];
      const fk = ankle.getWorldPosition(new THREE.Vector3());
      // A planted ankle is one boot-height above the sole, in source space.
      const specZ = this.rig.rest.Body.z + this.rig.rest[`Thigh${side}`].z
        + this.rig.rest[`Shin${side}`].z + this.rig.rest[`Foot${side}`].z;
      const ankleHeight = (this.soleSourceZ - specZ) * scale;
      const wantsLock = grounded && contact[side] > .55;
      const point = foot.locked && wantsLock ? foot.anchor : fk;
      const support = sampleGround(point.x, point.z, rootPosition.y + .45);
      const height = typeof support === 'number' ? support : support?.height;
      const valid = Number.isFinite(height) && Math.abs(height - rootPosition.y) < .48;
      if (wantsLock && valid && !foot.locked) {
        foot.anchor.copy(fk); foot.anchor.y = height + ankleHeight;
        foot.orientation.copy(meshQ);
        foot.supportHeight = height; foot.locked = true;
      }
      if (!wantsLock || !valid) foot.locked = false;
      if (foot.locked) {
        foot.anchor.y += height - foot.supportHeight; foot.supportHeight = height;
        // A hard reversal releases an overextended lock; it never scales a leg.
        if (Math.hypot(foot.anchor.x - fk.x, foot.anchor.z - fk.z) > .32) foot.locked = false;
      }
      const goal = foot.locked ? 1 : 0;
      foot.blend = clamp(foot.blend + (goal ? 1 : -1) * dt / (goal ? .055 : .06), 0, 1);
      // Airborne legs must start the take-off immediately, without a stale lock.
      if (!grounded) foot.blend = Math.max(0, foot.blend - dt * 22);
      if (foot.blend <= 1e-5) { foot.error = 0; continue; }
      const weight = foot.blend * foot.blend * (3 - 2 * foot.blend);
      const target = fk.clone().lerp(foot.anchor, weight);
      const local = body.worldToLocal(target.clone());
      const solved = solveFootChain(hip.position, local, this.rig.rest[`Shin${side}`], this.rig.rest[`Foot${side}`]);
      hip.quaternion.copy(solved.hipQ); knee.quaternion.copy(solved.kneeQ);
      hip.updateWorldMatrix(true, true);
      const desiredQ = foot.orientation.clone();
      if (support?.normal) desiredQ.premultiply(new THREE.Quaternion().setFromUnitVectors(UP, support.normal));
      const localQ = knee.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desiredQ);
      ankle.quaternion.slerp(localQ, weight);
      ankle.updateWorldMatrix(true, false);
      foot.error = ankle.getWorldPosition(new THREE.Vector3()).distanceTo(target);
    }
  }

  get diagnostics() {
    return Object.fromEntries(Object.entries(this.feet).map(([side, f]) => [side,
      { locked: f.locked, blend: f.blend, error: f.error, point: f.anchor.toArray() }]));
  }
}
