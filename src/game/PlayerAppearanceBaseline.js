import * as THREE from 'three';

export const PLAYER_SOURCE_GLB = 'model-01-player.glb';
export const PLAYER_SOURCE_SHA256 = '58edd10fe36337b3901236ca93ed35cad9a537e64820e80d3c1060eb1babf516';

/**
 * Capture object identities that must survive the appearance-baseline pass.
 * This deliberately stores references instead of cloning or converting the
 * mesh: the source geometry and PBR material must reach WebGL untouched.
 */
export function capturePlayerAppearance(visual) {
  const meshes = [];
  visual.traverse((object) => {
    if (!object.isMesh) return;
    meshes.push({
      mesh: object,
      geometry: object.geometry,
      material: object.material,
      index: object.geometry.getIndex(),
      attributes: Object.fromEntries(
        Object.entries(object.geometry.attributes).map(([name, attribute]) => [name, attribute]),
      ),
    });
  });
  if (meshes.length === 0) throw new Error('The source player visual contains no mesh.');
  return Object.freeze(meshes.map((entry) => Object.freeze(entry)));
}

/** Fail fast if another system replaces or skins the locked source model. */
export function assertPlayerAppearanceUnchanged(snapshot) {
  for (const entry of snapshot) {
    if (entry.mesh.isSkinnedMesh) throw new Error('The source player was converted to a SkinnedMesh.');
    if (entry.mesh.geometry !== entry.geometry) throw new Error('The source player geometry was replaced.');
    if (entry.mesh.material !== entry.material) throw new Error('The source player material was replaced.');
    if (entry.mesh.geometry.getIndex() !== entry.index) throw new Error('The source player index was replaced.');
    for (const [name, attribute] of Object.entries(entry.attributes)) {
      if (entry.mesh.geometry.getAttribute(name) !== attribute) {
        throw new Error(`The source player ${name} attribute was replaced.`);
      }
    }
    if (entry.mesh.geometry.getAttribute('skinIndex') || entry.mesh.geometry.getAttribute('skinWeight')) {
      throw new Error('Skin attributes were added to the locked source player.');
    }
  }
  return true;
}

/**
 * Compatibility controller for the first rebuild gate.
 *
 * It intentionally performs no skeletal or vertex animation. The player can
 * still move through the level and carry cargo while the exact source mesh is
 * used as the visual. A new rig cannot be enabled until it passes the visual
 * comparison and deformation tests defined in the rebuild specification.
 */
export class PlayerAppearanceBaseline {
  constructor({ visual, carrier, onStateChange = () => {} }) {
    this.visual = visual;
    this.carrier = carrier;
    this.snapshot = capturePlayerAppearance(visual);
    this.state = 'source_locked';
    this.localCarryPoint = new THREE.Vector3(0, 1.35, 0.25);
    this.worldCarryPoint = new THREE.Vector3();
    this.visualWorldQuaternion = new THREE.Quaternion();
    this.carrierParentQuaternion = new THREE.Quaternion();
    this.onStateChange = onStateChange;
    this.visual.userData.playerAppearanceMode = 'source-locked';
    assertPlayerAppearanceUnchanged(this.snapshot);
    this.onStateChange({ state: this.state, label: 'SOURCE MODEL / ВНЕШНОСТЬ ЗАФИКСИРОВАНА' });
  }

  reset() {
    assertPlayerAppearanceUnchanged(this.snapshot);
    this.snapCarrierToBody();
  }

  update() {
    // Moving the outer physics group is safe; the GLB hierarchy, mesh,
    // geometry and material are never modified by this controller.
    this.snapCarrierToBody();
  }

  triggerLanding() {}

  triggerHit() {}

  triggerInteraction() {}

  snapCarrierToBody() {
    if (!this.carrier?.parent) return;
    this.visual.updateWorldMatrix(true, true);
    this.worldCarryPoint.copy(this.localCarryPoint);
    this.visual.localToWorld(this.worldCarryPoint);
    this.carrier.parent.worldToLocal(this.worldCarryPoint);
    this.carrier.position.copy(this.worldCarryPoint);

    this.visual.getWorldQuaternion(this.visualWorldQuaternion);
    this.carrier.parent.getWorldQuaternion(this.carrierParentQuaternion).invert();
    this.carrier.quaternion.copy(this.carrierParentQuaternion).multiply(this.visualWorldQuaternion);
    this.carrier.updateWorldMatrix(true, true);
  }
}
