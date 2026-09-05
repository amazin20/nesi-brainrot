import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { portalTransformMatrix } from './LabPortals.js';

const MATERIAL_STATE = ['opacity', 'transparent', 'alphaTest', 'alphaHash', 'alphaToCoverage',
  'depthWrite', 'depthTest', 'colorWrite', 'side', 'visible', 'wireframe', 'roughness', 'metalness',
  'emissiveIntensity', 'intensity', 'transmission', 'thickness', 'envMapIntensity'];
const MATERIAL_COLORS = ['color', 'emissive', 'specular', 'attenuationColor'];

function visibleInHierarchy(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function defaultBounds(root) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  root.traverse(object => {
    if (!object.geometry || !visibleInHierarchy(object)) return;
    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (geometry.boundingBox) box.union(geometry.boundingBox.clone()
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld)));
  });
  if (box.isEmpty()) return { center: new THREE.Vector3(), radius: .5 };
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // Rest bounds need a small allowance for elbows and animated feet.
  return { center: sphere.center, radius: sphere.radius * 1.08 };
}

function makeClippedMaterial(source, plane) {
  const material = source.clone();
  // ShaderMaterial's copy intentionally clones uniforms. Our duplicate must
  // follow the SAME pulse/colour animation without allocating uniforms per frame.
  if (source.isShaderMaterial) {
    material.uniforms = source.uniforms;
    material.clipping = true;
    if (!material.vertexShader.includes('clipping_planes_pars_vertex')) {
      material.vertexShader = '#include <clipping_planes_pars_vertex>\n' + material.vertexShader;
      material.vertexShader = material.vertexShader.replace(/void\s+main\s*\(\s*\)\s*\{/, match =>
        `${match}\n#if NUM_CLIPPING_PLANES > 0\n vClipPosition = -(modelViewMatrix * vec4(position, 1.0)).xyz;\n#endif\n`);
    }
    if (!material.fragmentShader.includes('clipping_planes_pars_fragment')) {
      material.fragmentShader = '#include <clipping_planes_pars_fragment>\n' + material.fragmentShader;
      material.fragmentShader = material.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/, match =>
        `${match}\n#include <clipping_planes_fragment>\n`);
    }
  }
  material.onBeforeCompile = source.onBeforeCompile;
  material.customProgramCacheKey = source.customProgramCacheKey;
  material.clippingPlanes = [...(source.clippingPlanes || []), plane];
  material.clipIntersection = false;
  material.clipShadows = true;
  return material;
}

function syncMaterial(source, target) {
  for (const key of MATERIAL_STATE) if (source[key] !== undefined) target[key] = source[key];
  for (const key of MATERIAL_COLORS) if (source[key]?.isColor && target[key]?.isColor) target[key].copy(source[key]);
}

/** Two render portions of one actor, sharing the current skeletal pose.
 *
 * Register the ancestor that contains BOTH the skinned mesh and all its bones.
 * update() runs after animation and moving-portal frame updates, before either
 * portal render pass. The renderer must have localClippingEnabled = true.
 * radius is a WORLD-space conservative visual radius; centerOffset is local to
 * root. Omit both to derive the rest-pose bounds without scanning skin vertices.
 * Registration does not duplicate geometry, textures, physics or behaviour.
 */
export class LabPortalActors {
  constructor({ scene, portals } = {}) {
    if (!scene?.isObject3D || !portals) throw new Error('LabPortalActors needs a scene and portal pair.');
    this.scene = scene;
    this.portals = portals;
    this.actors = new Set();
    this.diagnostics = { registered: 0, active: 0, clones: 0 };
    this._worldCenter = new THREE.Vector3();
    this._localCenter = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._inverse = new THREE.Matrix4();
    this._transform = new THREE.Matrix4();
  }

  register(root, { radius, centerOffset } = {}) {
    if (!root?.isObject3D) throw new Error('A portal actor must be an Object3D.');
    if ([...this.actors].some(actor => actor.root === root)) throw new Error('Actor is already registered.');
    const bounds = radius == null || centerOffset == null ? defaultBounds(root) : null;
    const center = centerOffset?.isVector3 ? centerOffset.clone()
      : Array.isArray(centerOffset) ? new THREE.Vector3().fromArray(centerOffset) : bounds.center;
    if (!center.toArray().every(Number.isFinite) || (radius != null && !(radius > 0 && Number.isFinite(radius)))) {
      throw new Error('Portal actor bounds must be finite and radius positive.');
    }
    const actor = { root, radius: radius ?? bounds.radius, radiusInWorld: radius != null, center,
      clone: null, pairs: [], materials: [], active: false, entryIndex: -1,
      sourcePlane: new THREE.Plane(), destinationPlane: new THREE.Plane() };
    this.actors.add(actor);
    this.diagnostics.registered = this.actors.size;
    // The handle is useful for diagnostics and deterministic geometry checks.
    actor.unregister = () => this.unregister(actor);
    return actor;
  }

  unregister(actorOrRoot) {
    const actor = this.actors.has(actorOrRoot) ? actorOrRoot : [...this.actors].find(value => value.root === actorOrRoot);
    if (!actor) return false;
    this._destroyClone(actor);
    this.actors.delete(actor);
    this._updateDiagnostics();
    return true;
  }

  _restore(actor) {
    for (const record of actor.materials) {
      // Another controller may replace a material while the actor is crossing.
      // Do not undo that legitimate replacement on deactivation.
      if (record.source.material === record.sourceClipped) record.source.material = record.original;
    }
    actor.active = false;
    actor.entryIndex = -1;
    if (actor.clone) actor.clone.visible = false;
  }

  _destroyClone(actor) {
    this._restore(actor);
    actor.clone?.removeFromParent();
    const skeletons = new Set();
    actor.clone?.traverse(node => { if (node.isSkinnedMesh) skeletons.add(node.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    for (const record of actor.materials) {
      for (const material of [...record.sourceMaterials, ...record.destinationMaterials]) material.dispose();
    }
    actor.clone = null; actor.pairs = []; actor.materials = [];
  }

  _topologyMatches(actor) {
    if (!actor.clone) return false;
    for (const pair of actor.pairs) {
      if (pair.source.children.length !== pair.children.length) return false;
      for (let i = 0; i < pair.children.length; i++) if (pair.source.children[i] !== pair.children[i]) return false;
    }
    for (const record of actor.materials) {
      if (record.source.material !== record.original && record.source.material !== record.sourceClipped) return false;
    }
    return true;
  }

  _buildClone(actor) {
    // Reparenting the gun changes the hierarchy, not the player's materials.
    // Retain already compiled clipping materials across a hand/body handoff.
    const reusable = new Map(actor.materials.map(record => [record.source, record]));
    this._restore(actor);
    actor.clone?.removeFromParent();
    const skeletons = new Set();
    actor.clone?.traverse(node => { if (node.isSkinnedMesh) skeletons.add(node.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    actor.pairs = []; actor.materials = [];
    actor.clone = cloneSkeleton(actor.root);
    actor.clone.name = `${actor.root.name || 'Actor'} / portal portion`;
    actor.clone.userData.portalActorDuplicate = true;
    // Frustum bounds of an animated mesh otherwise describe an old pose. There
    // are at most two nearby duplicates; avoid a costly CPU skin bounds pass.
    const pairNodes = (source, destination) => {
      actor.pairs.push({ source, destination, children: source.children.slice() });
      destination.frustumCulled = false;
      if (source.material) {
        const original = source.material;
        let record = reusable.get(source);
        if (record?.original === original) reusable.delete(source);
        else {
          const sourceList = Array.isArray(original) ? original : [original];
          const sourceMaterials = sourceList.map(material => makeClippedMaterial(material, actor.sourcePlane));
          const destinationMaterials = sourceList.map(material => makeClippedMaterial(material, actor.destinationPlane));
          const sourceClipped = Array.isArray(original) ? sourceMaterials : sourceMaterials[0];
          record = { source, original, sourceList, sourceClipped, sourceMaterials, destinationMaterials };
        }
        destination.material = Array.isArray(original) ? record.destinationMaterials : record.destinationMaterials[0];
        actor.materials.push(record);
      }
      source.children.forEach((child, index) => pairNodes(child, destination.children[index]));
    };
    pairNodes(actor.root, actor.clone);
    for (const record of reusable.values())
      for (const material of [...record.sourceMaterials, ...record.destinationMaterials]) material.dispose();
    actor.clone.matrixAutoUpdate = false;
    actor.clone.visible = false;
    this.scene.add(actor.clone);
  }

  prepare() {
    // Build the hidden portions during loading. renderer.compileAsync traverses
    // their materials too, so the first crossing does not compile every skin
    // and clipping variant on the frame where the player enters the aperture.
    for (const actor of this.actors) if (!this._topologyMatches(actor)) this._buildClone(actor);
  }

  _entryFor(actor, frames) {
    const root = actor.root;
    root.updateWorldMatrix(true, true);
    this._worldCenter.copy(actor.center).applyMatrix4(root.matrixWorld);
    if (!this._worldCenter.toArray().every(Number.isFinite)) return -1;
    root.getWorldScale(this._scale);
    const radius = actor.radiusInWorld ? actor.radius
      : actor.radius * Math.max(Math.abs(this._scale.x), Math.abs(this._scale.y), Math.abs(this._scale.z));
    let nearest = Infinity; let chosen = -1;
    for (let index = 0; index < 2; index++) {
      const frame = frames[index];
      this._localCenter.copy(this._worldCenter).sub(frame.position)
        .applyQuaternion(frame.quaternion.clone().invert());
      const distance = Math.abs(this._localCenter.z);
      if (distance >= radius) continue;
      // Standing beside an aperture must never cut a shoulder through its
      // solid backing wall. Only an actor whose centre enters the aperture can
      // split; the physics capsule separately enforces full body clearance.
      if ((this._localCenter.x / Math.max(.01, frame.width - .03)) ** 2
        + (this._localCenter.y / Math.max(.01, frame.height - .03)) ** 2 >= 1) continue;
      // During the exact crossing the centre can be a few mm behind the plane.
      // Prefer a portal's room-facing side when two planes happen to be nearby.
      const score = distance + (this._localCenter.z < -.025 ? radius * 2 : 0);
      if (score >= nearest) continue;
      nearest = score; chosen = index;
    }
    return chosen;
  }

  update() {
    const frames = this.portals.portals;
    const linked = this.portals.ready !== false && frames?.length === 2 && frames.every(Boolean);
    this.scene.updateWorldMatrix(true, false);
    this._inverse.copy(this.scene.matrixWorld).invert();
    for (const actor of this.actors) {
      const index = linked && visibleInHierarchy(actor.root) ? this._entryFor(actor, frames) : -1;
      if (index < 0) { this._restore(actor); continue; }
      if (!this._topologyMatches(actor)) this._buildClone(actor);
      const entry = frames[index]; const exit = frames[1 - index];
      actor.sourcePlane.setFromNormalAndCoplanarPoint(entry.normal, entry.position);
      actor.destinationPlane.setFromNormalAndCoplanarPoint(exit.normal, exit.position);
      for (const { source, destination } of actor.pairs) {
        destination.position.copy(source.position);
        destination.quaternion.copy(source.quaternion);
        destination.scale.copy(source.scale);
        destination.matrix.copy(source.matrix);
        destination.matrixAutoUpdate = source.matrixAutoUpdate;
        // Duplicating a muzzle light changes NUM_POINT_LIGHTS and recompiles the
        // whole room at the portal. Only duplicate its visible pulse geometry.
        destination.visible = source.visible && !source.isLight;
        destination.layers.mask = source.layers.mask;
        destination.renderOrder = source.renderOrder;
        destination.castShadow = source.castShadow;
        destination.receiveShadow = source.receiveShadow;
        if (source.morphTargetInfluences) destination.morphTargetInfluences = source.morphTargetInfluences.slice();
        if (source.isLight) { destination.intensity = source.intensity; destination.color.copy(source.color); }
      }
      for (const record of actor.materials) {
        record.source.material = record.sourceClipped;
        record.sourceList.forEach((material, i) => {
          syncMaterial(material, record.sourceMaterials[i]);
          syncMaterial(material, record.destinationMaterials[i]);
        });
      }
      portalTransformMatrix(entry, exit, this._transform);
      actor.clone.matrixAutoUpdate = false;
      actor.clone.matrix.copy(this._inverse).multiply(this._transform).multiply(actor.root.matrixWorld);
      actor.clone.matrix.decompose(actor.clone.position, actor.clone.quaternion, actor.clone.scale);
      actor.clone.visible = true;
      actor.clone.updateMatrixWorld(true);
      for (const { destination } of actor.pairs) if (destination.isSkinnedMesh) destination.skeleton.update();
      actor.active = true;
      actor.entryIndex = index;
    }
    this._updateDiagnostics();
  }

  _updateDiagnostics() {
    this.diagnostics.registered = this.actors.size;
    this.diagnostics.active = [...this.actors].filter(actor => actor.active).length;
    this.diagnostics.clones = [...this.actors].filter(actor => actor.clone?.visible).length;
  }

  dispose() {
    for (const actor of [...this.actors]) this.unregister(actor);
  }
}

export default LabPortalActors;
