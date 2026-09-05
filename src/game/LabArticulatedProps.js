import * as THREE from 'three';

// Measured landmarks use the GLB's imported Y-up coordinates, before the game's
// normalization. The original node rotation is already baked into these values.
const REFERENCES = {
  panel: [[-.462539, 0, -.231668], [.472003, .713314, .224576]],
  plate: [[-.466492, 0, -.466134], [.461471, .145972, .461707]],
  bridge: [[-.194729, 0, -.559084], [.194737, .400240, .529520]],
};
const clamp = value => THREE.MathUtils.clamp(value, 0, 1);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function clip(polygon, axis, coordinate, positive) {
  const inside = [], outside = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = (a[axis] - coordinate) * (positive ? 1 : -1);
    const db = (b[axis] - coordinate) * (positive ? 1 : -1);
    (da >= 0 ? inside : outside).push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db), cut = a.map((value, k) => value + (b[k] - value) * t);
      inside.push(cut); outside.push(cut);
    }
  }
  return [inside, outside];
}
function emit(target, polygon) {
  for (let i = 1; i + 1 < polygon.length; i++) target.push(...polygon[0], ...polygon[i], ...polygon[i + 1]);
}

// Clip actual source surfaces at mechanical seams, preserving every attribute.
// A triangle crossing a seam is split rather than assigned wholesale to a part.
// The cached source geometry and shared materials are never edited or disposed.
function articulate(art, reference, describeRegions) {
  art.updateWorldMatrix(true, true);
  const inverse = art.matrixWorld.clone().invert(), prepared = [], bounds = new THREE.Box3();
  art.traverse(mesh => {
    if (!mesh.isMesh || !mesh.visible) return;
    const geometry = mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
    geometry.computeBoundingBox(); bounds.union(geometry.boundingBox); prepared.push({ mesh, geometry });
  });
  if (bounds.isEmpty()) throw new Error('Articulated prop requires a visible source mesh');
  const ref = new THREE.Box3(V(...reference[0]), V(...reference[1]));
  const ratios = bounds.getSize(V()).divide(ref.getSize(V()));
  const point = (x, y, z) => V(x, y, z).sub(ref.min).multiply(ratios).add(bounds.min);
  const scalar = (axis, value) => bounds.min.getComponent(axis) +
    (value - ref.min.getComponent(axis)) * ratios.getComponent(axis);
  const regions = describeRegions({ point, scalar, ratios, bounds });
  const frame = new THREE.Group(); frame.name = 'prop-fixed-frame';
  const groups = [frame, ...regions.map(region => {
    const group = new THREE.Group(); group.name = region.name;
    group.position.copy(region.pivot || V()); region.group = group; return group;
  })];
  const sourceMeshes = [];
  for (const { mesh, geometry } of prepared) {
    const names = ['position', ...Object.keys(geometry.attributes).filter(name => name !== 'position')];
    const attributes = names.map(name => geometry.getAttribute(name));
    const stride = attributes.reduce((sum, attribute) => sum + attribute.itemSize, 0);
    const outputs = groups.map(() => []), index = geometry.index, count = index?.count ?? geometry.attributes.position.count;
    const read = i => attributes.flatMap(attribute => Array.from({ length: attribute.itemSize }, (_, k) => attribute.getComponent(i, k)));
    for (let i = 0; i < count; i += 3) {
      let remainder = [[read(index ? index.getX(i) : i), read(index ? index.getX(i + 1) : i + 1), read(index ? index.getX(i + 2) : i + 2)]];
      for (let r = 0; r < regions.length && remainder.length; r++) {
        const next = [];
        for (const candidate of remainder) {
          let polygon = candidate;
          for (const plane of regions[r].planes) {
            if (!polygon.length) break;
            const [inside, outside] = clip(polygon, ...plane);
            if (outside.length >= 3) next.push(outside);
            polygon = inside;
          }
          emit(outputs[r + 1], polygon);
        }
        remainder = next;
      }
      for (const polygon of remainder) emit(outputs[0], polygon);
    }
    outputs.forEach((vertices, groupIndex) => {
      if (!vertices.length) return;
      const geometry = new THREE.BufferGeometry(), pivot = groups[groupIndex].position;
      let offset = 0;
      attributes.forEach((attribute, attributeIndex) => {
        const values = new Float32Array(vertices.length / stride * attribute.itemSize);
        for (let i = 0; i < vertices.length / stride; i++) for (let k = 0; k < attribute.itemSize; k++) {
          values[i * attribute.itemSize + k] = vertices[i * stride + offset + k] -
            (attributeIndex === 0 ? pivot.getComponent(k) : 0);
        }
        geometry.setAttribute(names[attributeIndex], new THREE.BufferAttribute(values, attribute.itemSize));
        offset += attribute.itemSize;
      });
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const child = new THREE.Mesh(geometry, mesh.material);
      child.name = `${mesh.name || 'source'}-${groups[groupIndex].name}`;
      child.castShadow = mesh.castShadow; child.receiveShadow = mesh.receiveShadow;
      child.userData = { ...mesh.userData, articulatedPart: groups[groupIndex].name };
      groups[groupIndex].add(child);
    });
    geometry.dispose(); mesh.visible = false; sourceMeshes.push(mesh);
  }
  groups.forEach(group => art.add(group));
  return { art, bounds, point, ratios, frame, groups, regions, sourceMeshes };
}

function planesFromBox(scalar, min, max) {
  const planes = [];
  for (let axis = 0; axis < 3; axis++) {
    if (Number.isFinite(min[axis])) planes.push([axis, scalar(axis, min[axis]), true]);
    if (Number.isFinite(max[axis])) planes.push([axis, scalar(axis, max[axis]), false]);
  }
  return planes;
}

// Invisible transform anchor, not a visual overlay. The original mesh is the
// only visible surface. Half extents/corners follow all parent transforms.
function surface(group, center, right, up, halfWidth, halfHeight) {
  const anchor = new THREE.Object3D(); anchor.name = 'prop-surface-anchor';
  anchor.position.copy(center).sub(group.position);
  const normal = right.clone().cross(up).normalize();
  anchor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
  group.add(anchor);
  return { anchor, halfWidth, halfHeight };
}
function worldSurface(spec) {
  const { anchor } = spec; anchor.updateWorldMatrix(true, false);
  const center = anchor.getWorldPosition(V());
  const horizontal = V(spec.halfWidth, 0, 0).applyMatrix4(anchor.matrixWorld).sub(center);
  const vertical = V(0, spec.halfHeight, 0).applyMatrix4(anchor.matrixWorld).sub(center);
  const right = horizontal.clone().normalize(), up = vertical.clone().normalize();
  const normal = right.clone().cross(up).normalize();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) =>
    center.clone().addScaledVector(horizontal, x).addScaledVector(vertical, y));
  return { anchor, center, position: center, normal, right, up, halfWidth: horizontal.length(),
    halfHeight: vertical.length(), corners, box: new THREE.Box3().setFromPoints(corners) };
}
function worldBox(group) {
  group.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(group);
}
function support(spec, enabled = true) {
  const result = worldSurface(spec);
  result.enabled = enabled && result.normal.y > .55;
  result.heightAt = (x, z) => {
    if (!result.enabled || Math.abs(result.normal.y) < 1e-6) return null;
    const y = result.center.y - (result.normal.x * (x - result.center.x) + result.normal.z * (z - result.center.z)) / result.normal.y;
    const offset = V(x, y, z).sub(result.center);
    if (Math.abs(offset.dot(result.right)) > result.halfWidth + 1e-5 ||
      Math.abs(offset.dot(result.up)) > result.halfHeight + 1e-5) return null;
    return y;
  };
  return result;
}

/** Actual inset of model 29. update(1) presses the existing surface downward. */
export class LabPressurePlatform {
  constructor(art) {
    Object.assign(this, articulate(art, REFERENCES.plate, ({ scalar }) => [{ name: 'pressure-platform-top',
      planes: planesFromBox(scalar, [-.36, .118, -.36], [.355, Infinity, .355]) }]));
    this.top = this.groups[1]; this.pressTravel = this.ratios.y * .007;
    this.surface = surface(this.top, this.point(-.0025, .14348, -.0022), V(1, 0, 0), V(0, 0, -1),
      this.ratios.x * .30, this.ratios.z * .30);
    this.update(0);
  }
  update(progress, dt = 0) {
    this.progress = clamp(progress); this.top.position.y = -this.pressTravel * this.progress;
    this.art.updateWorldMatrix(true, true);
  }
  getPortalFrame() { return worldSurface(this.surface); }
  getSupport() { return support(this.surface); }
  getFrameBox() { return worldBox(this.frame); }
  getTopBox() { return worldBox(this.top); }
}

/** Model 28: both side bearings and feet stay fixed while the authored plate tilts. */
export class LabRotatingPanel {
  constructor(art, { angle = Math.PI / 2 } = {}) {
    Object.assign(this, articulate(art, REFERENCES.panel, ({ point, scalar }) => [{ name: 'rotating-portal-panel',
      pivot: point(0, .443, .015), planes: planesFromBox(scalar, [-.370, .187, -Infinity], [.370, Infinity, Infinity]) }]));
    this.panel = this.groups[1]; this.angle = angle;
    this.frontSurface = surface(this.panel, this.point(0, .453, -.08358), V(-1, 0, 0), V(0, 1, 0),
      this.ratios.x * .315, this.ratios.y * .220);
    this.backSurface = surface(this.panel, this.point(0, .453, .061), V(1, 0, 0), V(0, 1, 0),
      this.ratios.x * .315, this.ratios.y * .220);
    this.update(0);
  }
  update(progress, dt = 0) {
    this.progress = clamp(progress); this.panel.rotation.x = this.angle * this.progress;
    this.art.updateWorldMatrix(true, true);
  }
  getPortalFrame(side = 1) { return worldSurface(side >= 0 ? this.frontSurface : this.backSurface); }
  getPanelBox() { return worldBox(this.panel); }
  getFrameBox() { return worldBox(this.frame); }
}

/** Model 30: a real hinged deck and opposing counterweight, with stationary towers.
 * progress 0 = raised; 1 = level, walkable deck. The rear weight needs a recess
 * below the hinge when raised; getCounterweightBox() supplies its actual bounds.
 */
export class LabCounterweightBridge {
  constructor(art, { raisedAngle = 1.25 } = {}) {
    Object.assign(this, articulate(art, REFERENCES.bridge, ({ point, scalar }) => [
      { name: 'bridge-deck', pivot: point(0, .250, -.200),
        planes: planesFromBox(scalar, [-.177, .091, -.153], [.177, Infinity, .493]) },
      { name: 'bridge-counterweight', pivot: point(0, .250, -.200),
        planes: planesFromBox(scalar, [-Infinity, .182, -Infinity], [Infinity, Infinity, -.280]) },
    ]));
    this.deck = this.groups[1]; this.counterweight = this.groups[2];
    // The scan's deck slopes downward towards +Z. Compensate for that authored
    // slope so progress 1 is an actual horizontal path rather than a fake box.
    this.deckSlope = -.119 * this.ratios.y / this.ratios.z;
    this.openAngle = Math.atan(this.deckSlope); this.raisedAngle = raisedAngle;
    const upAlongDeck = V(0, -this.deckSlope, -1).normalize();
    const centerZ = .164;
    this.surface = surface(this.deck, this.point(0, .1588 - .119 * centerZ, centerZ), V(1, 0, 0), upAlongDeck,
      this.ratios.x * .110, this.ratios.z * .304 * Math.sqrt(1 + this.deckSlope ** 2));
    // The supplied scan has a gap between its lever tip and hinge. A short dark
    // mechanical shaft closes that gap; it moves with the counterweight lever.
    const material = new THREE.MeshStandardMaterial({ color: 0x24394b, roughness: .56, metalness: .55 });
    const start = this.point(0, .250, -.200), end = this.point(0, .250, -.310);
    const delta = end.clone().sub(start);
    const link = new THREE.Mesh(new THREE.CylinderGeometry(this.ratios.x * .009, this.ratios.x * .009, delta.length(), 10), material);
    link.name = 'counterweight-hinge-link'; link.position.copy(start).add(end).multiplyScalar(.5).sub(this.counterweight.position);
    link.quaternion.setFromUnitVectors(V(0, 1, 0), delta.normalize());
    this.counterweight.add(link); this.link = link;
    this.update(1);
  }
  update(progress, dt = 0) {
    this.progress = clamp(progress);
    const angle = this.openAngle - this.raisedAngle * (1 - this.progress);
    this.deck.rotation.x = angle; this.counterweight.rotation.x = angle;
    this.art.updateWorldMatrix(true, true);
  }
  getSupport() { return support(this.surface, this.progress > .94); }
  getDeckBox() { return worldBox(this.deck); }
  getCounterweightBox() { return worldBox(this.counterweight); }
  getFrameBoxes() {
    // Individual tower/foot boxes avoid filling the gap under the full bridge.
    const p = this.point, b = [
      [[-.194, 0, -.330], [-.105, .295, -.110]],
      [[.105, 0, -.330], [.194, .295, -.110]],
      [[-.194, 0, .430], [-.110, .100, .530]],
      [[.110, 0, .430], [.194, .100, .530]],
    ];
    this.art.updateWorldMatrix(true, false);
    return b.map(([a, z]) => new THREE.Box3(p(...a), p(...z)).applyMatrix4(this.art.matrixWorld));
  }
}
