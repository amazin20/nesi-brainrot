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
  holsterOffset: Object.freeze([0.27, -0.04, -0.065]),
  // Matches the animator's shoulder -.31, elbow -.44, wrist +.08 rest hold.
  wristPitch: 0.67,
});

const FLASH_DURATION = 0.19;
export const LAB_DEVICE_TRANSITION_SECONDS = 0.32;
const ZERO = new THREE.Vector3();
const unitScale = (scale) => Math.max(0.00001, Math.cbrt(Math.abs(scale.x * scale.y * scale.z)));
const ease = (t) => t * t * (3 - 2 * t);

/** A rigid, source-calibrated attachment for the existing electronic device.
 *
 * new LabHeldDevice({ model: game.model(11, .7), bones: animator.bones,
 *   playerRoot: game.playerGroup, size: .7 });
 * update({ dt, carrying }) AFTER animator.update(). fire(0 | 1) returns false
 * until fully held. reset() restores the right hand. dispose() releases only
 * controller-owned effects; it never disposes the GLB's geometry/materials.
 *
 * The actual imported grip is exactly on a HandR palm socket. No world-space
 * interpolation or separate recoil transform can pull it out of the fingers.
 * Carrying advances holsterProgress from 0 to 1 over .32 seconds; releasing
 * reverses the same progress without restarting the path. During stowing /
 * drawing the socket blends between the CURRENT palm and hip in Body space.
 * Root motion and teleports therefore transform the entire path immediately.
 * The animator uses the same reversible progress for a right-hand hip reach.
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
    this.holsterProgress = 0;
    this.carrying = false;
    this.flashTime = 0;
    this.lastPortalIndex = 0;
    this.scaleVector = new THREE.Vector3();
    this.handInBody = new THREE.Matrix4();
    this.handPosition = new THREE.Vector3();
    this.handRotation = new THREE.Quaternion();
    this.pathRotation = new THREE.Quaternion();
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
    // The original hip pose turns the shell toward the back, roughly a half
    // turn from the held pose. A fixed intermediate orientation disambiguates
    // that turn: a tiny wrist yaw must not flip slerp's chosen side of 180deg.
    this.handoffMidQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -calibration.wristPitch)
      .multiply(this.handQuaternion).slerp(this.holsterQuaternion, 0.5);

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
    // Instant changes are reserved for initial setup / reset. Normal gameplay
    // always goes through update(), including a reversal halfway through stow.
    this.carrying = Boolean(carrying);
    this.holsterProgress = carrying ? 1 : 0;
    this.state = carrying ? 'holstered' : 'held';
    this.applySocketPose();
    if (carrying) this.clearFlash();
  }

  applySocketPose() {
    const progress = this.holsterProgress;
    const bone = progress === 0 ? this.bones.HandR : this.bones.Body;
    if (progress > 0 && progress < 1) {
      // A fresh relative transform, never a saved world position. An animated
      // hand can keep moving during the handoff without leaving the tool at
      // yesterday's wrist location after a turn or teleport.
      this.handInBody.identity();
      for (let joint = this.bones.HandR; joint && joint !== this.bones.Body; joint = joint.parent) {
        if (joint.matrixAutoUpdate) joint.updateMatrix();
        this.handInBody.premultiply(joint.matrix);
      }
      this.handInBody.decompose(this.handPosition, this.handRotation, this.scaleVector);
      this.handPosition.copy(this.handOffset).applyMatrix4(this.handInBody);
      this.handRotation.multiply(this.handQuaternion);
      const blend = ease(progress);
      this.attachment.position.copy(this.handPosition).lerp(this.holsterOffset, blend);
      this.pathRotation.copy(this.handoffMidQuaternion).slerp(this.holsterQuaternion, blend);
      this.attachment.quaternion.copy(this.handRotation).slerp(this.handoffMidQuaternion, blend)
        .slerp(this.pathRotation, blend);
    } else {
      this.attachment.position.copy(progress === 0 ? this.handOffset : this.holsterOffset);
      this.attachment.quaternion.copy(progress === 0 ? this.handQuaternion : this.holsterQuaternion);
    }
    // At either end the Body-space interpolation equals its live socket, so
    // changing parent cannot introduce a visible position/orientation jump.
    if (this.attachment.parent !== bone) bone.add(this.attachment);
    this.compensateScale();
    this.attachment.updateWorldMatrix(true, true);
  }

  compensateScale() {
    this.attachment.parent.getWorldScale(this.scaleVector);
    // The rig uses tiny source units under a ~2.21x visual scale; the device
    // has already been normalized to .7 metres. Cancel inherited scale once.
    this.attachment.scale.setScalar(this.modelScale / unitScale(this.scaleVector));
  }

  update({ dt = 1 / 60, carrying = false } = {}) {
    const step = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.carrying = Boolean(carrying);
    this.holsterProgress = THREE.MathUtils.clamp(this.holsterProgress
      + (this.carrying ? 1 : -1) * step / LAB_DEVICE_TRANSITION_SECONDS, 0, 1);
    // Avoid an extra frame at the endpoint due to floating point accumulation.
    if (this.holsterProgress < 1e-10) this.holsterProgress = 0;
    if (this.holsterProgress > 1 - 1e-10) this.holsterProgress = 1;
    this.state = this.carrying ? (this.holsterProgress === 1 ? 'holstered' : 'stowing')
      : this.holsterProgress === 0 ? 'held' : 'drawing';
    this.applySocketPose();
    if (this.state !== 'held') this.clearFlash();
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
      holsterProgress: this.holsterProgress,
      transitionBlend: ease(this.holsterProgress),
      transitioning: this.state === 'stowing' || this.state === 'drawing',
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
