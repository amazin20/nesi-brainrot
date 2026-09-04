import * as THREE from 'three';

// Runtime articulation of the uploaded static meshes. Source BufferGeometries,
// materials, texture images and GLB bytes are never modified. Clipping creates
// matching boundary vertices rather than classifying whole triangles: a door
// cannot leave jagged triangles stuck on its frame when a leaf moves.
const smooth = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };

function splitPolygon(polygon, axis, coordinate, positive = true) {
  const inside = [], outside = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = (a[axis] - coordinate) * (positive ? 1 : -1);
    const db = (b[axis] - coordinate) * (positive ? 1 : -1);
    (da >= 0 ? inside : outside).push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      const vertex = a.map((value, k) => value + (b[k] - value) * t);
      inside.push(vertex); outside.push(vertex);
    }
  }
  return [inside, outside];
}

function emit(target, polygon) {
  for (let i = 1; i < polygon.length - 1; i++) {
    target.push(...polygon[0], ...polygon[i], ...polygon[i + 1]);
  }
}

/** Partition a normalized art instance into static frame and moving interior. */
export function partitionMechanismArt(art, { minX, maxX, minY = 0, maxY = 1, halves = false }) {
  art.updateWorldMatrix(true, true);
  const inverse = art.matrixWorld.clone().invert();
  const meshes = [];
  art.traverse(o => { if (o.isMesh && o.visible) meshes.push(o); });
  const prepared = meshes.map(mesh => {
    const geometry = mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
    geometry.computeBoundingBox(); return { mesh, geometry };
  });
  const bounds = new THREE.Box3(); prepared.forEach(({ geometry }) => bounds.union(geometry.boundingBox));
  const size = bounds.getSize(new THREE.Vector3());
  const opening = new THREE.Box3(
    new THREE.Vector3(bounds.min.x + size.x * minX, bounds.min.y + size.y * minY, bounds.min.z),
    new THREE.Vector3(bounds.min.x + size.x * maxX, bounds.min.y + size.y * maxY, bounds.max.z));
  const centerX = (opening.min.x + opening.max.x) * .5;
  const frame = new THREE.Group(), interior = new THREE.Group(), left = new THREE.Group(), right = new THREE.Group();
  frame.name = 'mechanism-fixed-frame'; interior.name = 'mechanism-field'; left.name = 'door-leaf-left'; right.name = 'door-leaf-right';
  const groups = halves ? [frame, left, right] : [frame, interior];
  for (const { mesh, geometry } of prepared) {
    const attributeNames = ['position', ...Object.keys(geometry.attributes).filter(name => name !== 'position')];
    const attributes = attributeNames.map(name => geometry.getAttribute(name));
    const stride = attributes.reduce((n, attribute) => n + attribute.itemSize, 0);
    const output = groups.map(() => []);
    const index = geometry.getIndex(); const count = index?.count ?? geometry.getAttribute('position').count;
    const read = i => { const vertex = []; for (const attribute of attributes) for (let k = 0; k < attribute.itemSize; k++) vertex.push(attribute.getComponent(i, k)); return vertex; };
    const planes = [[0, opening.min.x, true], [0, opening.max.x, false], [1, opening.min.y, true], [1, opening.max.y, false]];
    for (let i = 0; i < count; i += 3) {
      let polygon = [read(index ? index.getX(i) : i), read(index ? index.getX(i + 1) : i + 1), read(index ? index.getX(i + 2) : i + 2)];
      for (const plane of planes) {
        if (!polygon.length) break;
        const [inside, outside] = splitPolygon(polygon, ...plane);
        emit(output[0], outside); polygon = inside;
      }
      if (!polygon.length) continue;
      if (halves) { const [r, l] = splitPolygon(polygon, 0, centerX); emit(output[1], l); emit(output[2], r); }
      else emit(output[1], polygon);
    }
    output.forEach((vertices, groupIndex) => {
      if (!vertices.length) return;
      const result = new THREE.BufferGeometry(); let offset = 0;
      attributes.forEach((attribute, attributeIndex) => {
        const array = new Float32Array(vertices.length / stride * attribute.itemSize);
        for (let i = 0; i < vertices.length / stride; i++) for (let k = 0; k < attribute.itemSize; k++) array[i * attribute.itemSize + k] = vertices[i * stride + offset + k];
        result.setAttribute(attributeNames[attributeIndex], new THREE.BufferAttribute(array, attribute.itemSize)); offset += attribute.itemSize;
      });
      result.computeBoundingBox(); result.computeBoundingSphere();
      const child = new THREE.Mesh(result, mesh.material);
      child.castShadow = mesh.castShadow; child.receiveShadow = mesh.receiveShadow;
      child.name = `${mesh.name || 'source'}-${groups[groupIndex].name}`; groups[groupIndex].add(child);
    });
    geometry.dispose(); mesh.visible = false;
  }
  groups.forEach(group => art.add(group));
  return { art, bounds, opening, centerX, frame, left, right, interior, groups };
}

export class LabDoorMechanism {
  constructor(art) {
    // Landmarks measured on source model 17: the rectangular leaves sit inside
    // the black inner tracks; the outside pillars, header and threshold stay put.
    Object.assign(this, partitionMechanismArt(art, { minX: .235, maxX: .765, minY: .05, maxY: .817, halves: true }));
    this.travel = (this.opening.max.x - this.opening.min.x) * .52;
    this.progress = 0; this.update(0);
  }
  update(progress) {
    this.progress = THREE.MathUtils.clamp(progress, 0, 1);
    const travel = this.travel * smooth(this.progress);
    this.left.position.x = -travel; this.right.position.x = travel;
    this.art.updateWorldMatrix(true, true);
  }
  // World-space boxes use the same easing as visible leaves. Keep stationary
  // jamb/header collision separate; no invisible full-width gate should remain.
  getLeafBoxes(progress = this.progress) {
    const travel = this.travel * smooth(progress), o = this.opening;
    const left = new THREE.Box3(new THREE.Vector3(o.min.x - travel, this.bounds.min.y, o.min.z), new THREE.Vector3(this.centerX - travel, o.max.y, o.max.z));
    const right = new THREE.Box3(new THREE.Vector3(this.centerX + travel, this.bounds.min.y, o.min.z), new THREE.Vector3(o.max.x + travel, o.max.y, o.max.z));
    this.art.updateWorldMatrix(true, false);
    return [left.applyMatrix4(this.art.matrixWorld), right.applyMatrix4(this.art.matrixWorld)];
  }
  getFrameBoxes() {
    const b = this.bounds, o = this.opening;
    this.art.updateWorldMatrix(true, false);
    return [
      new THREE.Box3(b.min.clone(), new THREE.Vector3(o.min.x, b.max.y, b.max.z)),
      new THREE.Box3(new THREE.Vector3(o.max.x, b.min.y, b.min.z), b.max.clone()),
      new THREE.Box3(new THREE.Vector3(o.min.x, o.max.y, b.min.z), new THREE.Vector3(o.max.x, b.max.y, b.max.z)),
    ].map(box => box.applyMatrix4(this.art.matrixWorld));
  }
}

export class LabBarrierMechanism {
  constructor(art) {
    // Only the energy sheet is animated. Both emitter posts and feet retain the
    // exact authored transform, including while the collision field deactivates.
    Object.assign(this, partitionMechanismArt(art, { minX: .23, maxX: .77 }));
    this.materials = []; this.uniforms = { time: { value: 0 }, strength: { value: 1 } };
    this.interior.traverse(mesh => {
      if (!mesh.isMesh) return;
      const copy = material => {
        const clone = material.clone(); clone.transparent = true; clone.depthWrite = false;
        clone.opacity = .87; clone.side = THREE.DoubleSide;
        clone.onBeforeCompile = shader => {
          shader.uniforms.labFieldTime = this.uniforms.time;
          shader.uniforms.labFieldStrength = this.uniforms.strength;
          shader.vertexShader = 'varying vec3 vLabFieldPosition;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLabFieldPosition = position;');
          shader.fragmentShader = 'uniform float labFieldTime;\nuniform float labFieldStrength;\nvarying vec3 vLabFieldPosition;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat labWave = .5 + .5 * sin(vLabFieldPosition.y * 8.0 - labFieldTime * 2.2);\ndiffuseColor.rgb *= .94 + .06 * labWave;\ndiffuseColor.a *= labFieldStrength;');
        };
        clone.customProgramCacheKey = () => 'lab-energy-field-v4';
        this.materials.push(clone); return clone;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
    });
    this.update(0, 0);
  }
  update(progress, time = 0) {
    this.progress = THREE.MathUtils.clamp(progress, 0, 1);
    this.uniforms.time.value = time;
    this.uniforms.strength.value = 1 - smooth(this.progress);
    this.interior.visible = this.progress < .9995;
  }
  get solid() { return this.progress < .92; }
}
