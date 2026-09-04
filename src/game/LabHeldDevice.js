import * as THREE from 'three';

/** Landmarks measured on the original, Draco-decoded model-11-portal-gun.glb.
 * Its POSITION bounds are [-.492971,-.184248,-.725427] to
 * [.538183,.185797,0]. In mesh coordinates -X is the emitter and -Z is up;
 * the GLB node itself rotates +PI/2 around X. These are NOT normalized bounds
 * guesses: the grip is the narrow handle below the rear white housing.
 */
export const LAB_DEVICE_CALIBRATION = Object.freeze({
  asset: 'model-11-portal-gun.glb',
  grip: Object.freeze([0.418, 0, -0.215]),
  emitter: Object.freeze([-0.37, 0, -0.44]),
  forward: Object.freeze([-1, 0, 0]),
  // The visible glove centre is below/in front of the HandR wrist landmark.
  handOffset: Object.freeze([0.005, 0.025, 0.028]),
  holsterOffset: Object.freeze([0.27, -0.10, -0.065]),
  // Matches the animator's shoulder -.31, elbow -.44, wrist +.08 rest hold.
  wristPitch: 0.67,
});

const FLASH_DURATION = 0.19;
const ZERO = new THREE.Vector3();
const unitScale = (scale) => Math.max(0.00001, Math.cbrt(Math.abs(scale.x * scale.y * scale.z)));

/** A rigid, source-calibrated attachment for the existing electronic device.
 *
 * new LabHeldDevice({ model: game.model(11, .7), bones: animator.bones,
 *   playerRoot: game.playerGroup, size: .7 });
 * update({ dt, carrying }) AFTER animator.update(). fire(0 | 1) returns false
 * while holstered. reset() restores the right hand. dispose() releases only
 * controller-owned effects; it never disposes the GLB's geometry/materials.
 *
 * The actual imported grip is exactly on a HandR palm socket. No world-space
 * interpolation or separate recoil transform can pull it out of the fingers.
 * Carrying reparents directly to a Body hip socket, so every frame is attached
 * to a moving bone, including the transition frame and large teleports.
 */
export class LabHeldDevice {
  constructor({ model, bones, playerRoot, size = 0.7, calibration = LAB_DEVICE_CALIBRATION } = {}) {
    if (!model?.isObject3D || !bones?.HandR || !bones?.Body) {
      throw new Error('LabHeldDevice needs the original model and HandR / Body bones.');
    }
    this.model = model;
    this.bones = bones;
    this.playerRoot = playerRoot;
    this.calibration = calibration;
    this.size = Number.isFinite(size) && size > 0 ? size : 0.7;
    this.state = 'held';
    this.flashTime = 0;
    this.lastPortalIndex = 0;
    this.scaleVector = new THREE.Vector3();
    this.attachment = new THREE.Group();
    this.attachment.name = 'LabDeviceAttachment';
    this.gripShift = new THREE.Group();
    this.gripShift.name = 'LabDeviceSourceGrip';
    this.attachment.add(this.gripShift);
    this.gripShift.add(model);
    model.traverse((object) => { if (!this.sourceMesh && object.isMesh) this.sourceMesh = object; });
    if (!this.sourceMesh) throw new Error('The source device must contain its original mesh.');
    this.sourceGeometry = this.sourceMesh.geometry;
    this.sourceMaterial = this.sourceMesh.material;

    // Measure relative to a fresh identity wrapper, retaining every imported
    // node transform, accessor, texture and material object without mutation.
    this.attachment.updateWorldMatrix(true, true);
    const sourceMatrix = this.sourceMesh.matrixWorld.clone();
    const sourceRotation = new THREE.Quaternion();
    sourceMatrix.decompose(new THREE.Vector3(), sourceRotation, this.scaleVector);
    const sourceUnit = unitScale(this.scaleVector);
    const bounds = new THREE.Box3().setFromObject(model);
    const dimensions = bounds.getSize(new THREE.Vector3());
    this.modelScale = this.size / Math.max(dimensions.x, dimensions.y, dimensions.z, 0.00001);
    this.gripPoint = new THREE.Vector3().fromArray(calibration.grip);
    this.gripInModel = this.gripPoint.clone().applyMatrix4(sourceMatrix);
    this.gripShift.position.copy(this.gripInModel).negate();
    this.handOffset = new THREE.Vector3().fromArray(calibration.handOffset);
    this.holsterOffset = new THREE.Vector3().fromArray(calibration.holsterOffset);

    const sourceToHand = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), calibration.wristPitch)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2));
    this.handQuaternion = sourceToHand.multiply(sourceRotation.clone().invert());
    // Holster at the outer right hip: emitter down, upper shell toward back.
    const holsterBasis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
    );
    this.holsterQuaternion = new THREE.Quaternion().setFromRotationMatrix(holsterBasis)
      .multiply(sourceRotation.clone().invert());

    this.emitter = new THREE.Group();
    this.emitter.name = 'LabDeviceEmitter';
    this.emitter.position.fromArray(calibration.emitter).applyMatrix4(sourceMatrix);
    this.emitter.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1),
      new THREE.Vector3().fromArray(calibration.forward).transformDirection(sourceMatrix));
    this.gripShift.add(this.emitter);
    this.flashMaterial = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0x55ddff) }, strength: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float strength; varying vec2 vUv; void main() { float edge = 1.0 - abs(length(vUv - 0.5) * 2.0 - 0.82) * 5.0; gl_FragColor = vec4(color * 1.5, max(0.0, edge) * strength); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.flash = new THREE.Mesh(new THREE.RingGeometry(0.065 * sourceUnit, 0.10 * sourceUnit, 32), this.flashMaterial);
    this.flash.name = 'LabDeviceEnergyPulse';
    this.flash.visible = false;
    this.flash.frustumCulled = false;
    this.light = new THREE.PointLight(0x55ddff, 0, 1.2, 2);
    this.emitter.add(this.flash, this.light);
    this.setSocket(false);
  }

  setSocket(carrying) {
    const bone = carrying ? this.bones.Body : this.bones.HandR;
    // add(), unlike attach(), intentionally applies the calibrated local pose
    // immediately. It cannot preserve a stale world pose during a teleport.
    if (this.attachment.parent !== bone) bone.add(this.attachment);
    this.state = carrying ? 'holstered' : 'held';
    this.attachment.position.copy(carrying ? this.holsterOffset : this.handOffset);
    this.attachment.quaternion.copy(carrying ? this.holsterQuaternion : this.handQuaternion);
    this.compensateScale();
    if (carrying) this.clearFlash();
    this.attachment.updateWorldMatrix(true, true);
  }

  compensateScale() {
    this.attachment.parent.getWorldScale(this.scaleVector);
    // The rig uses tiny source units under a ~2.21x visual scale; the device
    // has already been normalized to .7 metres. Cancel inherited scale once.
    this.attachment.scale.setScalar(this.modelScale / unitScale(this.scaleVector));
  }

  update({ dt = 1 / 60, carrying = false } = {}) {
    if (Boolean(carrying) !== (this.state === 'holstered')) this.setSocket(Boolean(carrying));
    this.compensateScale();
    const step = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.flashTime = Math.max(0, this.flashTime - step);
    const strength = this.flashTime / FLASH_DURATION;
    this.flashMaterial.uniforms.strength.value = strength;
    this.flash.visible = strength > 0 && this.state === 'held';
    this.flash.scale.setScalar(1 + (1 - strength) * 0.45);
    this.light.intensity = this.flash.visible ? strength * strength * 0.75 : 0;
  }

  fire(index = 0) {
    if (this.state !== 'held') return false;
    this.lastPortalIndex = index === 1 ? 1 : 0;
    const color = this.lastPortalIndex ? 0xffbc68 : 0x55ddff;
    this.flashTime = FLASH_DURATION;
    this.flashMaterial.uniforms.color.value.setHex(color);
    this.flashMaterial.uniforms.strength.value = 1;
    this.light.color.setHex(color);
    this.light.intensity = 0.75;
    this.flash.scale.setScalar(1);
    this.flash.visible = true;
    return true;
  }

  clearFlash() {
    this.flashTime = 0;
    this.flash.visible = false;
    this.flashMaterial.uniforms.strength.value = 0;
    this.light.intensity = 0;
  }

  reset() { this.clearFlash(); this.setSocket(false); }

  get diagnostics() {
    this.attachment.updateWorldMatrix(true, true);
    const gripWorld = this.sourceMesh.localToWorld(this.gripPoint.clone());
    const palmWorld = this.bones.HandR.localToWorld(this.handOffset.clone());
    const socketWorld = this.attachment.localToWorld(ZERO.clone());
    const wristWorld = this.bones.HandR.getWorldPosition(new THREE.Vector3());
    const forwardWorld = new THREE.Vector3().fromArray(this.calibration.forward).transformDirection(this.sourceMesh.matrixWorld);
    return {
      state: this.state,
      asset: this.calibration.asset,
      parentBone: this.attachment.parent.name,
      handAttached: this.attachment.parent === this.bones.HandR,
      // Actual transformed source grip against the visible palm socket,
      // not a cached flag or distance between two fabricated markers.
      handDistance: gripWorld.distanceTo(palmWorld),
      socketDistance: gripWorld.distanceTo(socketWorld),
      wristDistance: gripWorld.distanceTo(wristWorld),
      gripWorld: gripWorld.toArray(), palmWorld: palmWorld.toArray(),
      forwardWorld: forwardWorld.toArray(),
      sourceGeometryPreserved: this.sourceMesh.geometry === this.sourceGeometry,
      sourceMaterialPreserved: this.sourceMesh.material === this.sourceMaterial,
      worldSize: this.size,
      flashing: this.flash.visible,
      portalIndex: this.lastPortalIndex,
    };
  }

  dispose() {
    this.attachment.removeFromParent();
    this.flash.geometry.dispose();
    this.flashMaterial.dispose();
  }
}
