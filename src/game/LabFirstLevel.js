import { createArchitecturalGate } from './LabArchitecturalGate.js';
import * as THREE from 'three';
import { LabPressurePlatform, LabRotatingPanel, LabCounterweightBridge } from './LabArticulatedProps.js';
import { LabDoorMechanism, LabBarrierMechanism } from './LabMechanisms.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const CLOSED = 0xffbc69, OPEN = 0x6bdcc5;
const smooth = x => x * x * (3 - 2 * x);
const damp = (a, b, rate, dt) => dt > 0 ? THREE.MathUtils.damp(a, b, rate, dt) : a;

/** First level, all coordinates are metres. The old three-room route is not
 * appended to this scene. A six-metre trench makes the counterweight bridge
 * useful, and the receiving side of the portal machine is hidden until the
 * player has crossed it. All gates use live weight, never permanent latches. */
export const FIRST_LEVEL = Object.freeze({
  spawn: [0, 0, 15.5], cargoSpawn: [-2.0, .65, 12.8],
  minX: -9, maxX: 9, minZ: -25, maxZ: 18, ceiling: 6.2,
  trench: { minZ: -3, maxZ: 3, floor: -2.8 },
  bridgePad: [-4.65, .20, 7.1], receiver: [5, -1.8, -5.9],
  receiverControl: [4.45, 0, -8.9], exitPad: [-.4, .20, -13.1],
  doorZ: -17, barrierZ: -20, launch: [5.4, 0, 15.1],
});

function visibleMeshes(root) {
  const meshes = [];
  root.traverse(object => { if (object.isMesh && object.visible) meshes.push(object); });
  return meshes;
}

/** This builder uses only the existing public LabGame scene/physics helpers.
 * Build before physics is created; update/reset become valid immediately after
 * LabGame has registered these colliders and its persistent companion body. */
export function buildLabFirstLevel(game) {
  const scene = game.scene, material = game.materials;
  const config = FIRST_LEVEL, floors = [], panels = [], pads = [], moving = [];
  const tiles = [], structure = new THREE.Group(); structure.name = 'Level 01 — weight and return'; scene.add(structure);
  const palette = { light: 0xe5e8e4, dark: 0x5c7b88, inset: 0x46606d, trim: 0x84bdc5 };
  const matte = color => new THREE.MeshStandardMaterial({ color, roughness: .83, metalness: .03 });
  const backing = matte(palette.dark), dark = matte(palette.inset), lamp = new THREE.MeshBasicMaterial({ color: 0xfff2d5 });
  material.wall.color.set(0xe1e6e2); material.dark.color.set(palette.inset); material.trim.color.set(0x587883);

  const dimensions = art => { art.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(art); };
  const prop = (id, size, position, stage = 0, yaw = 0, options = {}) => game.addProp(id, size, position, stage, yaw, options);
  const solid = (bounds, options = {}) => game.collisionProxy(bounds, options);
  const box = (minX, minY, minZ, maxX, maxY, maxZ, mat = backing, options = {}) => game.box(
    (minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2,
    maxX - minX, maxY - minY, maxZ - minZ, mat, options);
  const sync = (collider, bounds, dt, enabled = true) => {
    const unchanged = collider.enabled === enabled && collider.box.min.distanceToSquared(bounds.min) < 1e-12 &&
      collider.box.max.distanceToSquared(bounds.max) < 1e-12;
    collider.enabled = enabled;
    if (dt > 0 && unchanged) return;
    game.syncCollision(collider, bounds, dt);
  };
  const tint = (root, color) => {
    const clones = new Map();
    for (const mesh of visibleMeshes(root)) {
      const clone = original => {
        if (!clones.has(original)) { const copy = original.clone(); copy.color?.multiply(new THREE.Color(color)); clones.set(original, copy); }
        return clones.get(original);
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
    }
  };

  // Use the authored floor as the repeating architecture. A single collision
  // slab and shared instanced geometry replace dozens of separate physics boxes.
  // The 1.6% square-grid correction follows the source tile's almost-square rim;
  // its height, bevels, textures and normals retain their authored proportions.
  const tileSource = game.model(23, 3), tileBounds = dimensions(tileSource);
  const tileSize = tileBounds.getSize(V()); tileSource.scale.x *= 3 / tileSize.x;
  tileSource.updateWorldMatrix(true, true);
  function floor(minX, maxX, minZ, maxZ, y = 0, portalable = false, color = 0xffffff, showTiles = true) {
    const mesh = box(minX, y - .28, minZ, maxX, y, maxZ, color === 0xffffff ? material.floor : backing, { solid: true });
    mesh.visible = !showTiles; mesh.userData.collisionProxy = showTiles;
    const descriptor = { minX, maxX, minZ, maxZ, y, mesh, enabled: true };
    game.floors.push(descriptor); floors.push(descriptor);
    if (portalable) {
      game.markPortalSurface(mesh, V((minX + maxX) / 2, y + .002, (minZ + maxZ) / 2), UP,
        (maxX - minX) / 2, (maxZ - minZ) / 2);
      mesh.userData.stage = minZ < -20 ? 2 : 0; panels.push(mesh);
    }
    if (!showTiles) return descriptor;
    // Broad module grids terminate at construction joints. Narrow structural
    // strips use the matching plain trim instead of squeezing patterned tiles.
    const columns = Math.ceil((maxX - minX) / 3), rows = Math.ceil((maxZ - minZ) / 3);
    const cellX = (maxX - minX) / columns, cellZ = (maxZ - minZ) / rows;
    const sourceMeshes = visibleMeshes(tileSource);
    for (const source of sourceMeshes) {
      const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material];
      const instanceMaterials = sourceMaterials.map(m => {
        const copy = m.clone(); copy.color?.multiply(new THREE.Color(color)); return copy;
      });
      const instances = new THREE.InstancedMesh(source.geometry,
        Array.isArray(source.material) ? instanceMaterials : instanceMaterials[0], columns * rows);
      instances.name = 'Authored floor modules 23'; instances.receiveShadow = true;
      let index = 0;
      for (let ix = 0; ix < columns; ix++) for (let iz = 0; iz < rows; iz++) {
        const transform = new THREE.Matrix4().compose(V(minX + cellX * (ix + .5), y - tileSize.y, minZ + cellZ * (iz + .5)),
          new THREE.Quaternion(), V(cellX / 3, 1, cellZ / 3)).multiply(source.matrixWorld);
        instances.setMatrixAt(index++, transform);
      }
      instances.instanceMatrix.needsUpdate = true; instances.computeBoundingBox(); instances.computeBoundingSphere();
      structure.add(instances); tiles.push(instances);
    }
    return descriptor;
  }

  // Arrival bank has one real socket for the recovery lift. The trench floor
  // continues underneath it, so a dropped companion is always recoverable.
  floor(-9, 5.2, 3, 18, 0, true);
  floor(8.2, 9, 3, 18, 0, true, 0xffffff, false);
  floor(5.2, 8.2, 7, 18, 0, true);
  floor(5.2, 8.2, 3, 4, 0, false, 0x8399a1, false);
  floor(-9, 9, -10, -3, 0, false, 0x8399a1);
  floor(-9, 9, -17, -10, 0, false, 0x8399a1);
  floor(-9, 9, -20, -17, 0, false, 0x8399a1);
  floor(-9, 9, -25, -20, 0, true);
  floor(-9, 9, -3, 7, -2.8, false, 0x647e89);
  // Receive the bridge before its far-side bearing towers. The side apron
  // gives both actors an honest exit around the counterweight, while the
  // remaining 5.40 m gap exceeds even a late coyote-time sprint jump.
  floor(-3.5, 3.5, -3.5, -2.40, 0, false, 0x8399a1, false);
  // Retaining faces are behind the banks, never coplanar with their tile fascias.
  box(-9, -2.8, -3.28, 9, -.28, -3.04, dark, { solid: true });
  box(-9, -2.8, 3.04, 5.12, -.28, 3.28, dark, { solid: true });

  // Wall model 24 is now the room wall, repeated at its proper aspect ratio.
  // White arrival/exit modules accept portals; painted service-bay modules do not.
  function wallBand(x, minZ, maxZ, normal, portalable, color) {
    const model = game.model(24, 3);
    const base = dimensions(model), size = base.getSize(V());
    const rows = Math.max(1, Math.round(config.ceiling / size.y)), count = Math.ceil((maxZ - minZ) / size.x);
    const width = (maxZ - minZ) / count, height = config.ceiling / rows;
    model.scale.set(width / size.x, height / size.y, 1); model.rotation.y = normal * Math.PI / 2;
    if (color) tint(model, color);
    model.updateWorldMatrix(true, true);
    for (const source of visibleMeshes(model)) {
      const instances = new THREE.InstancedMesh(source.geometry, source.material, count * rows);
      instances.name = portalable ? 'Portal wall modules 24' : 'Painted service wall modules 24'; instances.receiveShadow = true;
      let i = 0;
      for (let row = 0; row < rows; row++) for (let column = 0; column < count; column++) {
        const matrix = new THREE.Matrix4().makeTranslation(x, row * height, minZ + width * (column + .5)).multiply(source.matrixWorld);
        instances.setMatrixAt(i++, matrix);
      }
      instances.instanceMatrix.needsUpdate = true; instances.computeBoundingBox(); instances.computeBoundingSphere(); structure.add(instances);
    }
    const innerX = x + normal * .10;
    const collision = box(x - .11, -3, minZ, x + .11, config.ceiling, maxZ, backing, { solid: true });
    collision.visible = false; collision.userData.collisionProxy = true;
    if (portalable) {
      game.markPortalSurface(collision, V(innerX + normal * .002, config.ceiling / 2, (minZ + maxZ) / 2), V(normal, 0, 0),
        (maxZ - minZ) / 2, config.ceiling / 2);
      collision.userData.stage = maxZ > 0 ? 0 : 2; panels.push(collision);
    }
  }
  for (const [x, normal] of [[-9.08, 1], [9.08, -1]]) {
    wallBand(x, 3, 18, normal, true);
    wallBand(x, -20, 3, normal, false, 0x78919c);
    wallBand(x, -25, -20, normal, true);
  }
  box(-9.2, -3, 18, 9.2, config.ceiling, 18.25, backing, { solid: true });
  box(-9.2, -3, -25.25, 9.2, config.ceiling, -25, backing, { solid: true });
  const ceiling = box(-9.2, config.ceiling, -25.25, 9.2, config.ceiling + .25, 18.25, matte(0xcbd6d5), { solid: true });
  // The trench's service ceiling is intentionally painted. The arrival ceiling
  // is portalable for experimenting with differently oriented floor portals.
  const ceilingZone = box(-8.95, config.ceiling - .015, 6, 8.95, config.ceiling, 17.95, material.wall, { camera: false });
  ceilingZone.visible = false; ceilingZone.userData.collisionProxy = true;
  game.markPortalSurface(ceilingZone, V(0, config.ceiling - .016, 11.975), V(0, -1, 0), 8.95, 5.975);
  ceilingZone.userData.stage = 0; panels.push(ceilingZone);
  for (const z of [14, 7, -6, -13, -22]) {
    box(-5.2, 6.03, z - .25, 5.2, 6.10, z + .25, lamp, { camera: false, aim: false });
    const fill = new THREE.PointLight(0xffeed8, 18, 15, 2); fill.position.set(0, 5.5, z); scene.add(fill);
  }

  const indicator = (position, color = CLOSED) => {
    const object = new THREE.Mesh(new THREE.SphereGeometry(.085, 12, 8), new THREE.MeshBasicMaterial({ color }));
    object.position.copy(position); scene.add(object); return object;
  };
  const cable = points => {
    const group = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: CLOSED }); scene.add(group);
    for (let i = 1; i < points.length; i++) {
      const a = V(...points[i - 1]), b = V(...points[i]), direction = b.clone().sub(a);
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, direction.length(), 6), mat);
      segment.position.copy(a).add(b).multiplyScalar(.5); segment.quaternion.setFromUnitVectors(UP, direction.normalize()); group.add(segment);
    }
    return { group, material: mat };
  };

  function tagSurface(group, getFrame, label) {
    const meshes = visibleMeshes(group);
    for (const mesh of meshes) {
      Object.assign(mesh.userData, { portalable: true, portalFrame: getFrame, surfaceLabel: label });
      game.aimBlockers.push(mesh); game.portalPanels.push(mesh); panels.push(mesh);
    }
    return meshes;
  }
  function pressurePad(position, stage, name) {
    const p = V(...position), art = prop(29, 5.7, [p.x, 0, p.z], stage);
    const mechanism = new LabPressurePlatform(art);
    art.position.y += p.y - mechanism.getPortalFrame().center.y;
    mechanism.update(0);
    // Keep the fixed rim hollow. A single full-height frame AABB would support
    // cargo above the depressed real inset and make it visibly hover by 6 cm.
    const fixed = mechanism.getFrameBox(), topBounds = mechanism.getTopBox();
    const baseBox = new THREE.Box3(fixed.min.clone(), V(fixed.max.x,
      topBounds.min.y - mechanism.pressTravel - .008, fixed.max.z));
    const frameCollider = solid(baseBox, { aim: false });
    const frameColliders = [frameCollider,
      solid(new THREE.Box3(fixed.min.clone(), V(topBounds.min.x, fixed.max.y, fixed.max.z)), { aim: false }),
      solid(new THREE.Box3(V(topBounds.max.x, fixed.min.y, fixed.min.z), fixed.max.clone()), { aim: false }),
      solid(new THREE.Box3(V(topBounds.min.x, fixed.min.y, fixed.min.z), V(topBounds.max.x, fixed.max.y, topBounds.min.z)), { aim: false }),
      solid(new THREE.Box3(V(topBounds.min.x, fixed.min.y, topBounds.max.z), V(topBounds.max.x, fixed.max.y, fixed.max.z)), { aim: false }),
    ];
    const topCollider = solid(topBounds, { kinematic: true, aim: false });
    const portalMeshes = tagSurface(mechanism.top, () => mechanism.getPortalFrame(), name);
    for (const mesh of visibleMeshes(mechanism.frame)) game.aimBlockers.push(mesh);
    const f = mechanism.getSupport(), surfaceFloor = { minX: f.box.min.x, maxX: f.box.max.x, minZ: f.box.min.z, maxZ: f.box.max.z,
      y: f.center.y, mesh: topCollider.mesh, enabled: true };
    game.floors.push(surfaceFloor);
    const lamp = indicator(V(p.x + 2.17, .32, p.z + 1.85));
    const result = { name, position: p, art, mechanism, frameCollider, frameColliders, collider: topCollider, top: portalMeshes[0], portalMeshes,
      floor: surfaceFloor, indicator: lamp, ring: lamp, contact: 0, progress: 0, previousProgress: 0, pressed: false };
    pads.push(result); return result;
  }
  const bridgePad = pressurePad(config.bridgePad, 0, 'Плита моста');
  const exitPad = pressurePad(config.exitPad, 1, 'Плита выходного шлюза');
  const bridgeCable = cable([[-4.65, .035, 4.08], [-4.65, .035, 3.5], [0, .035, 3.5], [0, .035, 3.1]]);
  const exitCable = cable([[-.4, .035, -16], [-3.35, .035, -16], [-3.35, .035, -17], [-3.35, .035, -20]]);

  // Model 30's ACTUAL authored walkable deck is 6.14 × 2.22 m at size 11.
  // Align the support plane to the two banks, leaving the fixed towers and
  // counterweight in their measured sockets instead of stretching the mesh.
  const bridgeArt = prop(30, 11, [0, 0, 0], 0, 0);
  const bridgeMechanism = new LabCounterweightBridge(bridgeArt, { raisedAngle: .75 });
  bridgeMechanism.update(1);
  bridgeArt.position.sub(bridgeMechanism.getSupport().center);
  bridgeMechanism.update(1);
  const flatBridge = bridgeMechanism.getSupport();
  const bridgeFloor = { minX: flatBridge.box.min.x, maxX: flatBridge.box.max.x, minZ: flatBridge.box.min.z,
    maxZ: flatBridge.box.max.z, y: 0, enabled: false };
  const deckCollider = solid(bridgeMechanism.getDeckBox(), { kinematic: true });
  bridgeFloor.mesh = deckCollider.mesh; game.floors.push(bridgeFloor);
  const weightCollider = solid(bridgeMechanism.getCounterweightBox(), { kinematic: true });
  const towerColliders = bridgeMechanism.getFrameBoxes().map(bounds => solid(bounds));
  for (const tower of towerColliders) {
    const b = tower.box;
    if (b.min.y > -2.8) box(b.min.x - .025, -2.8, b.min.z - .025, b.max.x + .025, b.min.y + .015, b.max.z + .025, dark, { solid: true });
  }
  const bridge = { art: bridgeArt, group: bridgeArt, mechanism: bridgeMechanism, collider: deckCollider,
    deckCollider, weightCollider, towerColliders, floor: bridgeFloor, progress: 0, previousProgress: 0,
    active: false, everCrossed: false, links: [bridgeCable] };
  moving.push(bridge);

  // Model 28 is recessed into its mechanical bed. The bearing assembly remains
  // visible above the floor, while its oversized service feet sit below it.
  // Initially the usable face points DOWN into its solid mechanical bed.
  // The far control tilts only the moving plate down towards the receiving bay.
  const panelArt = prop(28, 7.5, config.receiver, 1);
  const panelMechanism = new LabRotatingPanel(panelArt, { angle: -Math.PI / 2 });
  panelMechanism.update(1);
  box(2.05, -.28, -7.82, 7.95, .20, -4.08, dark, { solid: true });
  const panelFrameBounds = panelMechanism.getFrameBox(), panelFrame = panelMechanism.getPortalFrame();
  const sideWidth = .315 * (7.5 / .934542);
  const fixedPanelColliders = [
    new THREE.Box3(panelFrameBounds.min.clone(), V(panelArt.position.x - sideWidth - .07, panelFrameBounds.max.y, panelFrameBounds.max.z)),
    new THREE.Box3(V(panelArt.position.x + sideWidth + .07, panelFrameBounds.min.y, panelFrameBounds.min.z), panelFrameBounds.max.clone()),
  ].map(bounds => solid(bounds, { aim: false }));
  const panelCollider = solid(panelMechanism.getPanelBox(), { kinematic: true, aim: false });
  const panelPortalMeshes = tagSurface(panelMechanism.panel, () => panelMechanism.getPortalFrame(), 'Поворотная панель');
  for (const mesh of visibleMeshes(panelMechanism.frame)) game.aimBlockers.push(mesh);
  const panelControlArt = prop(22, 1.55, config.receiverControl, 1, Math.PI / 3, { solid: true });
  const panelLamp = indicator(V(4.45, 1.75, -8.9));
  const receiverPanel = { art: panelArt, mechanism: panelMechanism, collider: panelCollider, frameColliders: fixedPanelColliders,
    portalMeshes: panelPortalMeshes, top: panelPortalMeshes[0], position: V(...config.receiver),
    control: { art: panelControlArt, position: V(...config.receiverControl), indicator: panelLamp },
    deployed: false, progress: 1, previousProgress: 1 };

  // Opaque elbow hides the final portalable weight plate from every arrival-bank
  // shot. Its right passage is 4.2 m wide, not an invisible gameplay restriction.
  box(-9, 0, -10.18, 4.8, config.ceiling, -9.96, backing, { solid: true });
  game.label('ШЛЮЗ →', 5.9, 3.4, -9.9, 2.7, '#eef5e9');

  const doorBuild = createArchitecturalGate(game, { z: config.doorZ });
  const doorArt = doorBuild.art, doorMechanism = doorBuild.mechanism;
  const doorLeafColliders = doorMechanism.getLeafBoxes().map(bounds => solid(bounds, { kinematic: true }));
  const doorFrameColliders = doorMechanism.getFrameBoxes().map(bounds => solid(bounds));
  const exitDoor = { art: doorArt, mechanism: doorMechanism, leafColliders: doorLeafColliders, frameColliders: doorFrameColliders,
    collider: doorLeafColliders[0], mesh: doorLeafColliders[0].mesh, pad: exitPad, buttonRing: exitPad.indicator,
    z: config.doorZ, progress: 0, previousProgress: 0, opened: false, contact: 0 };
  game.doors.push(exitDoor);

  const barrierBuild = createArchitecturalGate(game, { z: config.barrierZ, kind: 'barrier' });
  const barrierArt = barrierBuild.art, barrierMechanism = barrierBuild.mechanism;
  const fieldBounds = barrierBuild.opening.clone();
  const barrierCollider = solid(fieldBounds, { kinematic: true }); barrierCollider.mesh.userData.field = true;
  barrierMechanism.getFrameBoxes().forEach(bounds => solid(bounds));
  const barrier = { art: barrierArt, mechanism: barrierMechanism, collider: barrierCollider, mesh: barrierCollider.mesh,
    position: V(0, 0, config.barrierZ), progress: 0, previousProgress: 0, opened: false, contact: 0 };

  // A recovery lift returns BOTH actors from the trench. It has no ability to
  // reach the far bank, and is useful only as a forgiving return route.
  const liftGroup = new THREE.Group(); liftGroup.position.set(6.7, -2.8, 5.5); scene.add(liftGroup);
  const liftArt = game.model(19, 2.88), liftArtBounds = dimensions(liftArt);
  liftArt.position.y -= liftArtBounds.max.y; liftGroup.add(liftArt);
  const liftMesh = game.box(0, -.10, 0, 2.88, .20, 2.88, dark, { solid: true, parent: liftGroup });
  liftMesh.visible = false; liftMesh.userData.collisionProxy = true;
  const liftCollider = game.colliders.at(-1); liftCollider.kinematic = true;
  const liftFloor = { minX: 5.26, maxX: 8.14, minZ: 4.06, maxZ: 6.94, y: -2.8, mesh: liftMesh, enabled: true };
  game.floors.push(liftFloor);
  const lift = { group: liftGroup, art: liftArt, mesh: liftMesh, collider: liftCollider, floor: liftFloor,
    minY: -2.8, maxY: 0, y: -2.8, previousY: -2.8, hold: 0, links: [] };
  game.label('↑', 6.7, .35, 7.22, 1.1, '#6dcbbc');

  // Small, optional movement corners use real furniture, both authored ramps,
  // and a launch pad which jumps towards the arrival bank rather than skipping
  // the bridge. Nothing in this corner blocks the required puzzle route.
  const table = prop(14, 1.05, [-5.8, 0, 14.5], 0, 0, { height: true });
  const tableBounds = dimensions(table), tableCenter = tableBounds.getCenter(V());
  const tableCollider = solid(new THREE.Box3(V(tableBounds.min.x, tableBounds.max.y - .11, tableBounds.min.z), tableBounds.max.clone()));
  solid(new THREE.Box3(V(tableCenter.x - .18, 0, tableCenter.z - .18), V(tableCenter.x + .18, tableBounds.max.y - .11, tableCenter.z + .18)));
  const chair = prop(13, 1.46, [-7.1, 0, 12.7], 0, Math.PI / 2, { height: true });
  const chairBounds = dimensions(chair), chairCenter = chairBounds.getCenter(V()), seatY = .7867;
  solid(new THREE.Box3(V(chairCenter.x - .43, seatY - .1, chairCenter.z - .43), V(chairCenter.x + .43, seatY, chairCenter.z + .43)));
  solid(new THREE.Box3(V(chairCenter.x + .28, seatY, chairCenter.z - .43), V(chairCenter.x + .43, chairBounds.max.y, chairCenter.z + .43)));
  const launchArt = prop(21, 2.65, config.launch, 0), launchBounds = dimensions(launchArt);
  // The source's highest vertices are its blue fins, not the working deck.
  // Keep its base on the floor and measure the real centre surface instead of
  // burying the entire circular machine up to the tips of those fins.
  const launchRay = new THREE.Raycaster(V(config.launch[0], launchBounds.max.y + .2, config.launch[2]), V(0, -1, 0));
  const launchDeckY = launchRay.intersectObject(launchArt, true)[0]?.point.y ?? .354;
  const launchX = config.launch[0], launchZ = config.launch[2];
  const launchBaseColliders = [
    solid(new THREE.Box3(V(launchX - .93, 0, launchZ - .93), V(launchX + .93, .28, launchZ + .93))),
    solid(new THREE.Box3(V(launchX - 1.23, 0, launchZ - .48), V(launchX + 1.23, .28, launchZ + .48))),
    solid(new THREE.Box3(V(launchX - .48, 0, launchZ - 1.23), V(launchX + .48, .28, launchZ + 1.23))),
  ];
  const launchCollider = solid(new THREE.Box3(V(launchX - .56, .27, launchZ - .56), V(launchX + .56, launchDeckY, launchZ + .56)));
  const finColliders = [];
  for (const sign of [-1, 1]) {
    finColliders.push(solid(new THREE.Box3(V(launchX + sign * .98 - .16, .27, launchZ - .115),
      V(launchX + sign * .98 + .16, launchBounds.max.y, launchZ + .115))));
    finColliders.push(solid(new THREE.Box3(V(launchX - .115, .27, launchZ + sign * .98 - .16),
      V(launchX + .115, launchBounds.max.y, launchZ + sign * .98 + .16))));
  }
  const launchFloor = { minX: launchX - .56, maxX: launchX + .56, minZ: launchZ - .56, maxZ: launchZ + .56,
    y: launchDeckY, enabled: true, mesh: launchCollider.mesh };
  game.floors.push(launchFloor);
  const launchPad = { art: launchArt, position: V(...config.launch), collider: launchCollider,
    baseColliders: launchBaseColliders, finColliders, floor: launchFloor, deckY: launchDeckY, radius: 1.05 };

  function ramp(id, position, depth, highAt, stage) {
    const art = prop(id, depth, position, stage, highAt === 'maxZ' ? Math.PI : 0);
    const bounds = dimensions(art), size = bounds.getSize(V()), centreX = (bounds.min.x + bounds.max.x) / 2;
    // Generated ramps have a gently curved driving surface. Measure it once
    // from the actual model; a bounding-box slope put feet 3–8 cm inside it.
    // The centre ray and two near-centre fallbacks avoid the side lips.
    const ray = new THREE.Raycaster(), profile = [], sampleCount = 17;
    const probe = z => {
      const queryZ = THREE.MathUtils.clamp(z, bounds.min.z + .012, bounds.max.z - .012);
      const hits = [];
      for (const offset of [0, -.035, .035]) {
        ray.set(V(centreX + size.x * offset, bounds.max.y + .5, queryZ), V(0, -1, 0));
        ray.far = size.y + 1;
        const hit = ray.intersectObject(art, true)[0];
        if (hit) { if (offset === 0) return hit.point.y; hits.push(hit.point.y); }
      }
      hits.sort((a, b) => a - b);
      return hits.length ? hits[Math.floor(hits.length / 2)] : null;
    };
    for (let i = 0; i < sampleCount; i++) {
      const z = THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, i / (sampleCount - 1));
      profile.push({ z, y: probe(z) });
    }
    // The outer source bounds include feet beyond the sloped deck. An exact
    // edge ray can miss; extend the two nearest measured samples instead of
    // fabricating a zero-height spike at the ramp's high end.
    const measured = profile.filter(sample => sample.y !== null);
    for (const sample of profile) if (sample.y === null) {
      const nearest = [...measured].sort((a, b) => Math.abs(a.z - sample.z) - Math.abs(b.z - sample.z));
      sample.y = nearest.length > 1 ? THREE.MathUtils.clamp(nearest[0].y +
        (nearest[1].y - nearest[0].y) * (sample.z - nearest[0].z) / (nearest[1].z - nearest[0].z), bounds.min.y, bounds.max.y)
        : nearest[0]?.y ?? position[1];
    }
    // Refine only where a real lip/curve departs from its chord. This retains
    // the short authored high-end curb rather than smearing it into a long
    // invisible slope, while the broad deck needs very few support segments.
    const refine = (a, b, depth = 0) => {
      const z = (a.z + b.z) / 2, y = probe(z);
      if (y === null || depth >= 5 || Math.abs(y - (a.y + b.y) / 2) < .006) return [];
      const middle = { z, y };
      return [...refine(a, middle, depth + 1), middle, ...refine(middle, b, depth + 1)];
    };
    const refined = [profile[0]];
    for (let i = 1; i < profile.length; i++) refined.push(...refine(profile[i - 1], profile[i]), profile[i]);
    profile.splice(0, profile.length, ...refined);
    const highY = Math.max(...profile.map(sample => sample.y));
    const lowY = Math.min(...profile.map(sample => sample.y));
    const result = { id: art.uuid, model: art, minX: bounds.min.x, maxX: bounds.max.x, minZ: bounds.min.z,
      maxZ: bounds.max.z, lowY, highY, highAt, profile };
    // A tiny closed wedge mesh represents the measured profile for camera and
    // aim rays. The detailed imported art is not traversed every frame.
    const vertices = [], push = (a, b, c) => vertices.push(...a, ...c, ...b);
    for (let i = 1; i < profile.length; i++) {
      const a = profile[i - 1], b = profile[i];
      const p = [[bounds.min.x, a.y, a.z], [bounds.max.x, a.y, a.z],
        [bounds.max.x, b.y, b.z], [bounds.min.x, b.y, b.z],
        [bounds.min.x, bounds.min.y, a.z], [bounds.max.x, bounds.min.y, a.z],
        [bounds.max.x, bounds.min.y, b.z], [bounds.min.x, bounds.min.y, b.z]];
      for (const [x, y, z] of [[0, 1, 2], [0, 2, 3], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2],
        [0, 4, 5], [0, 5, 1], [3, 2, 6], [3, 6, 7]]) push(p[x], p[y], p[z]);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const proxy = new THREE.Mesh(geometry, material.dark); proxy.name = 'Measured ramp ray proxy';
    proxy.visible = false; proxy.userData.collisionProxy = true; scene.add(proxy);
    result.rayProxy = proxy;
    game.ramps.push(result); game.cameraBlockers.push(proxy); game.aimBlockers.push(proxy);
    return result;
  }

  const arrivalRamp = ramp(25, [6.65, 0, 10.4], 3.4, 'minZ', 0);
  floor(arrivalRamp.minX, arrivalRamp.maxX, 7.5, arrivalRamp.minZ, arrivalRamp.highY + .02, false, 0xa8b8bd, false);
  const workshopRamp = ramp(27, [6.6, 0, -12.55], 4.0, 'minZ', 1);
  floor(workshopRamp.minX, workshopRamp.maxX, -16.1, workshopRamp.minZ, workshopRamp.highY, false, 0xa8b8bd, false);
  for (const [x, y, z, yaw] of [[8.28, workshopRamp.highY, -15.3, Math.PI / 2], [7.66, arrivalRamp.highY, 8.1, Math.PI / 2]]) {
    const rail = prop(26, 1.05, [x, y, z], z < 0 ? 1 : 0, yaw, { height: true }); solid(dimensions(rail));
  }
  game.exploration = { table: { model: table, collider: tableCollider, position: table.position.clone(), top: tableBounds.max.y },
    chair: { model: chair, seatY, position: chair.position.clone() }, ramps: [arrivalRamp, workshopRamp], tiles };
  game.label('ВМЕСТЕ ЧЕРЕЗ МОСТ', 0, 4.4, 17.97, 8.4, '#3d697b', Math.PI);
  game.label('ВЕС → МОСТ', -4.65, .035, 10.2, 3.8, '#567e88').rotation.x = -Math.PI / 2;
  game.label('ПОВЕРНИ ПАНЕЛЬ · ЗАБЕРИ ДРУГА', 0, 4.85, -9.91, 7.0, '#e4f0ee');
  game.label('ВЕС → ШЛЮЗ', -.4, .035, -9.6, 3.8, '#c9e7df').rotation.x = -Math.PI / 2;
  game.label('НИКОГО НЕ ЗАБЫЛИ', 0, 3.8, -24.97, 7.4, '#e6f3e7');

  let time = 0, bridgeWasCrossed = false, exitWasReached = false, lastCircuit = false;
  const positionOn = (point, f, margin = 0) => point && point.x > f.minX - margin && point.x < f.maxX + margin &&
    point.z > f.minZ - margin && point.z < f.maxZ + margin;
  const cargoOnPad = pad => {
    if (!game.cargo || game.heldCube) return false;
    const f = pad.mechanism.getPortalFrame(), p = game.cargo.position;
    return Math.hypot(p.x - f.center.x, p.z - f.center.z) < 1.28 && p.y > f.center.y + .14 &&
      p.y < f.center.y + .75 && game.cargo.velocity.length() < 1;
  };
  const occupiedGate = (z, width = 2.1) => {
    const p = game.playerPosition, c = game.cargo?.position;
    return Math.abs(p.z - z) < 1.55 && Math.abs(p.x) < width || c && Math.abs(c.z - z) < .90 && Math.abs(c.x) < width;
  };
  function updatePad(pad, dt) {
    pad.previousProgress = pad.progress;
    pad.contact = cargoOnPad(pad) ? pad.contact + dt : 0;
    if (dt > 0) pad.pressed = pad.contact > .12;
    pad.progress = damp(pad.progress, pad.pressed ? 1 : 0, 10, dt);
    pad.mechanism.update(pad.progress, dt);
    const f = pad.mechanism.getSupport(); pad.floor.y = f.center.y;
    sync(pad.collider, pad.mechanism.getTopBox(), dt);
    pad.indicator.material.color.setHex(pad.pressed ? OPEN : CLOSED);
  }
  function update(dt) {
    time += dt;
    for (const pad of pads) updatePad(pad, dt);
    bridge.previousProgress = bridge.progress;
    bridge.active = bridgePad.pressed;
    const bridgeOccupied = bridge.progress > .94 && (positionOn(game.playerPosition, bridge.floor, .25) && game.playerPosition.y < 2.7 ||
      positionOn(game.cargo?.position, bridge.floor, .18) && game.cargo.position.y < 1.1);
    const goal = bridge.active || bridgeOccupied ? 1 : 0;
    bridge.progress = damp(bridge.progress, goal, 2.5, dt);
    if (Math.abs(bridge.progress - goal) < .0005) bridge.progress = goal;
    bridge.mechanism.update(smooth(bridge.progress), dt);
    const support = bridge.mechanism.getSupport();
    bridge.floor.enabled = bridge.progress > .97 && support.enabled;
    bridge.floor.y = support.center.y;
    // Once level, a thin deck support follows the visible walking surface; the
    // railing envelope must never become an invisible waist-high box.
    const deckBox = bridge.floor.enabled ? new THREE.Box3(
      V(bridge.floor.minX, support.center.y - .14, bridge.floor.minZ), V(bridge.floor.maxX, support.center.y, bridge.floor.maxZ)) : bridge.mechanism.getDeckBox();
    sync(bridge.deckCollider, deckBox, dt); sync(bridge.weightCollider, bridge.mechanism.getCounterweightBox(), dt);
    bridgeCable.material.color.setHex(bridge.active ? OPEN : CLOSED);
    if (game.playerPosition.z < -3.25 && game.playerPosition.y > -.25) bridgeWasCrossed = bridge.everCrossed = true;
    if (game.playerPosition.z < -20.65 && game.playerPosition.y > -.25) exitWasReached = true;

    receiverPanel.previousProgress = receiverPanel.progress;
    receiverPanel.progress = damp(receiverPanel.progress, receiverPanel.deployed ? 0 : 1, 3.8, dt);
    if (receiverPanel.progress < .0005) receiverPanel.progress = 0;
    receiverPanel.mechanism.update(receiverPanel.progress, dt);
    sync(receiverPanel.collider, receiverPanel.mechanism.getPanelBox(), dt);
    receiverPanel.control.indicator.material.color.setHex(receiverPanel.deployed ? OPEN : CLOSED);

    exitDoor.previousProgress = exitDoor.progress; barrier.previousProgress = barrier.progress;
    exitDoor.opened = barrier.opened = exitPad.pressed; exitDoor.contact = barrier.contact = exitPad.contact;
    if (exitPad.pressed && !lastCircuit) { game.audio?.checkpoint?.(); game.companionAnimator?.trigger?.('nod'); }
    lastCircuit = exitPad.pressed;
    const doorGoal = exitDoor.opened || exitDoor.progress > .72 && occupiedGate(exitDoor.z) ? 1 : 0;
    exitDoor.progress = damp(exitDoor.progress, doorGoal, 4.0, dt); exitDoor.mechanism.update(exitDoor.progress);
    exitDoor.mechanism.getLeafBoxes().forEach((bounds, i) => sync(exitDoor.leafColliders[i], bounds, dt));
    const fieldGoal = barrier.opened || barrier.progress > .8 && occupiedGate(config.barrierZ, 1.7) ? 1 : 0;
    barrier.progress = damp(barrier.progress, fieldGoal, 4.2, dt); barrier.mechanism.update(barrier.progress, time);
    sync(barrier.collider, fieldBounds, dt, barrier.mechanism.solid);
    exitCable.material.color.setHex(exitPad.pressed ? OPEN : CLOSED);

    const liftOccupied = positionOn(game.playerPosition, lift.floor, .10) && Math.abs(game.playerPosition.y - lift.y) < .20 ||
      positionOn(game.cargo?.position, lift.floor, .05) && Math.abs(game.cargo.position.y - lift.y - .39) < .27;
    lift.hold = liftOccupied ? 1.5 : Math.max(0, lift.hold - dt);
    const liftGoal = lift.hold > 0 ? lift.maxY : lift.minY;
    const nextY = damp(lift.y, liftGoal, 1.2, dt);
    if (game.physics) game.moveMechanism(lift, Math.abs(nextY - liftGoal) < .004 ? liftGoal : nextY, dt);
    else { lift.previousY = lift.y; lift.y = nextY; lift.floor.y = nextY; lift.group.position.y = nextY; }
  }
  function reset() {
    time = 0; bridgeWasCrossed = false; exitWasReached = false; lastCircuit = false;
    for (const pad of pads) { pad.contact = pad.progress = pad.previousProgress = 0; pad.pressed = false; }
    bridge.progress = bridge.previousProgress = 0; bridge.active = bridge.everCrossed = false;
    receiverPanel.deployed = false; receiverPanel.progress = receiverPanel.previousProgress = 1;
    exitDoor.opened = barrier.opened = false; exitDoor.progress = exitDoor.previousProgress = barrier.progress = barrier.previousProgress = 0;
    lift.y = lift.previousY = -2.8; lift.hold = 0; lift.floor.y = -2.8; lift.group.position.y = -2.8;
    update(0);
  }
  function nearbyInteraction() {
    if (game.playerPosition.z > -3.1 || !bridgeWasCrossed) return null;
    if (game.playerPosition.distanceTo(receiverPanel.control.position) < 2.4 && !receiverPanel.deployed) {
      return 'E — повернуть панель';
    }
    return null;
  }
  function interact() {
    if (!nearbyInteraction()) return false;
    receiverPanel.deployed = true; game.animator?.triggerInteraction?.('interact'); game.audio?.checkpoint?.();
    game.callbacks.onToast('Панель готова. Открой второй портал и забери друга.'); return true;
  }
  function getObjective() {
    if (game.playerPosition.z < -20.5) return 'Открой портал здесь и забери друга с плиты.';
    if (bridgeWasCrossed && game.cargo?.position.z < -3) return 'Поставь друга на плиту шлюза. Пройди и забери его через портал.';
    if (bridgeWasCrossed) return receiverPanel.deployed ? 'Второй портал — в повёрнутую панель. Друг вернётся к тебе.' : 'Поверни дальнюю панель у терминала.';
    return bridgePad.pressed ? 'Мост опущен. Перейди и поверни панель на дальнем берегу.' : 'Оставь один портал в плите и поставь на неё друга.';
  }
  function getLaunch(point) {
    if (!point || Math.hypot(point.x - launchPad.position.x, point.z - launchPad.position.z) > launchPad.radius || point.y < -.15 || point.y > .9) return null;
    return { velocity: V(0, 9.0, 1.6), duration: .90 };
  }
  function renderUpdate(alpha, visualTime) {
    const blend = THREE.MathUtils.clamp(alpha, 0, 1);
    bridge.mechanism.update(smooth(THREE.MathUtils.lerp(bridge.previousProgress, bridge.progress, blend)));
    receiverPanel.mechanism.update(THREE.MathUtils.lerp(receiverPanel.previousProgress, receiverPanel.progress, blend));
    exitDoor.mechanism.update(THREE.MathUtils.lerp(exitDoor.previousProgress, exitDoor.progress, blend));
    barrier.mechanism.update(THREE.MathUtils.lerp(barrier.previousProgress, barrier.progress, blend), visualTime);
    for (const pad of pads) pad.mechanism.update(THREE.MathUtils.lerp(pad.previousProgress, pad.progress, blend));
    lift.group.position.y = THREE.MathUtils.lerp(lift.previousY, lift.y, blend);
  }
  reset();
  return {
    config, title: '01 / ВМЕСТЕ ЧЕРЕЗ МОСТ', spawn: [...config.spawn], cargoSpawn: [...config.cargoSpawn], bounds: { minX: -9, maxX: 9, minZ: -25, maxZ: 18 },
    structure, floors, panels, pads, bridge, bridges: [bridge], bridgePad, receiverPanel, exitDoor, exitPad,
    barrier, chargePad: exitPad, lift, launchPad, launchRing: null, terminals: [receiverPanel.control], recoveryFloors: floors.filter(f => f.y < 0),
    update, reset, interact, nearbyInteraction, renderUpdate, getLaunch, getObjective,
    cargoOnAnyPad: () => pads.some(cargoOnPad),
    isWon: () => game.playerPosition.z < -21.3 && game.cargo?.position.z < -20.9 && game.playerPosition.distanceTo(game.cargo.position) < 4,
    diagnostics: () => ({ name: '01 / ВМЕСТЕ ЧЕРЕЗ МОСТ', bridgeCrossed: bridgeWasCrossed, bridgeLoaded: bridgePad.pressed,
      bridgeProgress: bridge.progress, receiverDeployed: receiverPanel.deployed, exitLoaded: exitPad.pressed,
      doorOpen: exitDoor.opened, barrierOpen: barrier.opened, nativeModels: [13, 14, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] }),
  };
}
