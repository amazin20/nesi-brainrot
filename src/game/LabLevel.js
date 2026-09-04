import * as THREE from 'three';

// The model gallery is deliberately separate from the puzzle architecture.
// Every imported object placed here is an operable part of the route.
const ROOM_COLORS = [0xffb09c, 0x83d9ce, 0xffd585];
const AMBER = 0xffbb63;

/** One continuous surface, with distance-filtered seams instead of coplanar strips. */
export function makeLabFloorMaterial(color = 0xe4e7df) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .84, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vLabWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
      'vLabWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>');
    shader.fragmentShader = 'varying vec3 vLabWorld;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      vec2 labCell = vLabWorld.xz / 3.0;
      vec2 labEdge = abs(fract(labCell + .5) - .5);
      vec2 labAA = max(fwidth(labCell), vec2(.0001));
      vec2 labSeam = 1.0 - smoothstep(vec2(.006) - labAA, vec2(.006) + labAA, labEdge);
      float labFade = 1.0 - smoothstep(.016, .085, max(labAA.x, labAA.y));
      diffuseColor.rgb *= 1.0 - .12 * max(labSeam.x, labSeam.y) * labFade;
    `);
  };
  material.customProgramCacheKey = () => 'lab-aa-floor-v1';
  return material;
}

/** Returns mechanism handles; simulation/interaction belongs to LabGame. */
export function buildLabArchitecture(game) {
  const { scene, materials: m } = game;
  m.wall.color.set(0x91aab2); m.dark.color.set(0x294451); m.trim.color.set(0x607e84);
  m.wall.roughness = .88; m.dark.roughness = .82; m.trim.metalness = .08;
  m.floor = makeLabFloorMaterial();
  const matte = color => new THREE.MeshStandardMaterial({ color, roughness: .83, metalness: 0 });
  const pastel = ROOM_COLORS.map(matte);
  const teal = matte(0x6abebd), inset = matte(0xe0e3df), stairMaterial = matte(0xa9b8dd);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff5d8 });
  const makeIndicator = (position, color = AMBER, radius = .18) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshBasicMaterial({ color }));
    mesh.position.fromArray(position); scene.add(mesh); return mesh;
  };
  const floor = (minX, maxX, minZ, maxZ, y = 0, material = m.floor, thickness = .45) => {
    const descriptor = { minX, maxX, minZ, maxZ, y };
    game.floors.push(descriptor);
    const mesh = game.box((minX + maxX) / 2, y - thickness / 2, (minZ + maxZ) / 2,
      maxX - minX, thickness, maxZ - minZ, material, { solid: true });
    descriptor.mesh = mesh;
    return descriptor;
  };
  const signal = points => {
    const material = new THREE.MeshBasicMaterial({ color: AMBER });
    const group = new THREE.Group(); scene.add(group);
    for (let i = 1; i < points.length; i++) {
      const start = new THREE.Vector3(...points[i - 1]);
      const end = new THREE.Vector3(...points[i]);
      const segment = end.clone().sub(start);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, segment.length(), 6), material);
      mesh.position.copy(start).add(end).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), segment.normalize());
      group.add(mesh);
    }
    return { group, material };
  };

  // Solid floor regions share a continuous shell, including the lowered retrieval bays.
  floor(-12, 12, 11, 22); floor(-12, 12, -3, 5);
  // Leave a real socket for the lift instead of overlapping two floor surfaces.
  floor(-12, 12, -17, -3); floor(-12, 12, -26, -20);
  floor(-12, -7.5, -20, -17); floor(-4.5, 12, -20, -17);
  floor(-7.5, -4.5, -20, -17, -.4, m.dark, .35);
  floor(-12, 12, -34, -26); floor(-12, 12, -51, -40);
  const recoveryFloors = [];
  for (const [minZ, maxZ] of [[5, 11], [-40, -34]]) {
    recoveryFloors.push(floor(-12, 12, minZ, maxZ, -2.8, stairMaterial));
    // A staircase leads back to the entrance bank, never across the puzzle gap.
    for (let step = 0; step < 8; step++) {
      const top = -2.8 + (step + 1) * .35;
      const z0 = minZ + .4 + step * .7;
      floor(7.2, 10.4, z0, Math.min(maxZ, z0 + .7), top, stairMaterial, top + 3.15);
    }
    // Recess the retaining faces behind the slab fascia. Matching the slab's
    // face or top plane creates crawling interference along the whole bank.
    const retainingTop = -.43, retainingBottom = -2.8;
    const retainingY = (retainingTop + retainingBottom) / 2;
    const retainingHeight = retainingTop - retainingBottom;
    game.box(0, retainingY, minZ - .155, 24, retainingHeight, .26, m.dark, { solid: true });
    game.box(-2.4, retainingY, maxZ + .155, 19.2, retainingHeight, .26, m.dark, { solid: true });
    game.box(11.2, retainingY, maxZ + .155, 1.6, retainingHeight, .26, m.dark, { solid: true });
    for (const edge of [minZ, maxZ]) {
      game.box(0, .04, edge + (edge === minZ ? -.09 : .09), 13.8, .08, .18, pastel[2], { camera: false, aim: false });
    }
    // Broad painted risers stay readable at a distance without fine overlapping lines.
    game.label('↗', 8.8, 1.2, maxZ + .3, 1.5, '#688ca8');
  }

  for (const x of [-12.2, 12.2]) {
    game.box(x, 3.2, -14.5, .4, 12.2, 73.4, m.wall, { solid: true });
    game.box(Math.sign(x) * 11.9, .34, -14.5, .15, .68, 73, teal, { camera: false, aim: false });
    game.box(Math.sign(x) * 11.88, 7.55, -14.5, .18, .9, 73, inset, { camera: false, aim: false });
  }
  game.box(0, 3.2, 22.2, 24.8, 12.2, .4, m.wall, { solid: true });
  game.box(0, 3.2, -51.2, 24.8, 12.2, .4, m.wall, { solid: true });
  game.box(0, 9.15, -14.5, 24.8, .3, 73.4, inset, { solid: true });

  const rooms = [{ center: 9.5, length: 25 }, { center: -14.5, length: 23 }, { center: -38.5, length: 25 }];
  rooms.forEach((room, index) => {
    for (const sign of [-1, 1]) {
      for (const offset of [-7.4, 0, 7.4]) {
        // Solid, comfortably wide relief panels; no dense line mesh or floating furniture.
      game.box(sign * 11.92, 6.05, room.center + offset, .13, 1.95, 6.8, pastel[index], { camera: false, aim: false });
      }
      game.box(sign * 8.8, 8.91, room.center, 1.1, .14, room.length - 2, pastel[index], { camera: false, aim: false });
    }
    for (const offset of [-7, 0, 7]) {
      game.box(0, 8.88, room.center + offset, 14.8, .18, .7, lamp, { camera: false, aim: false });
      game.box(0, 8.98, room.center + offset, 15.4, .18, 1.15, m.trim, { camera: false, aim: false });
    }
    // Non-shadowed fill is static: camera/player movement cannot make it crawl.
    const fill = new THREE.PointLight(0xfff2dc, 36, 24, 2);
    fill.position.set(0, 6.8, room.center); scene.add(fill);
  });
  game.label('N E S I  /  TRANSFER LAB', 0, 6.1, 21.91, 10.2, '#456778', Math.PI);
  game.label('ВМЕСТЕ ДО ВЫХОДА', 0, 3.8, -50.91, 8, '#5f8c8b');

  const bridges = [], terminals = [];
  for (const [index, data] of [
    { minZ: 5, maxZ: 11, terminal: [-5, 0, 1], stage: 0 },
    { minZ: -40, maxZ: -34, terminal: [4, 0, -43], stage: 2 },
  ].entries()) {
    const group = new THREE.Group(); group.position.set(0, -3, (data.minZ + data.maxZ) / 2); scene.add(group);
    const deckLength = data.maxZ - data.minZ - .04;
    const mesh = game.box(0, -.18, 0, 4, .36, deckLength, teal, { solid: true, parent: group });
    const collider = game.colliders.at(-1);
    for (const x of [-1.87, 1.87]) game.box(x, .034, 0, .16, .068, deckLength,
      pastel[data.stage], { camera: false, aim: false, parent: group });
    const support = { minX: -2, maxX: 2, minZ: data.minZ + .02, maxZ: data.maxZ - .02, y: -3, mesh };
    game.floors.push(support);
    const terminal = game.addProp(22, 1.65, data.terminal, data.stage, index ? -Math.PI / 4 : Math.PI / 4, { solid: true });
    const indicator = makeIndicator([data.terminal[0], 1.78, data.terminal[2]], AMBER, .16);
    const cable = signal([[data.terminal[0], .09, data.terminal[2]], [0, .09, data.terminal[2]],
      [0, .09, data.minZ - .24]]);
    const descriptor = { group, mesh, collider, floor: support, minY: -3, maxY: 0, stage: data.stage,
      active: false, progress: 0, terminalIndex: index, links: [cable] };
    bridges.push(descriptor);
    terminals.push({ model: terminal, position: new THREE.Vector3(...data.terminal), indicator,
      stage: data.stage, bridgeIndex: index, activated: false, links: [cable] });
    game.label('МОСТ', data.terminal[0], 2.5, data.terminal[2] - .18, 2.8, '#56787b');
  }

  // Chamber 02: a visible, latched gate, a weight switch, then a real lift.
  for (const x of [-7, 7]) {
    game.box(x, 3, -15, 10, 6, .2, m.glass, { solid: true, aim: true });
    game.box(x, 6.09, -15, 10.1, .18, .3, teal, { solid: true, aim: false });
    game.box(x, .1, -15, 10.1, .2, .3, teal, { solid: true, aim: false });
  }
  for (const x of [-2.12, 2.12]) game.box(x, 2.8, -15, .22, 5.6, .38, teal, { solid: true });
  game.box(0, 5.73, -15, 4.4, .26, .4, teal, { solid: true });
  const barrierMesh = game.box(0, 2.65, -15, 4, 5.3, .18, m.glass.clone(), { solid: true, aim: true });
  barrierMesh.material.opacity = .28; barrierMesh.userData.field = true;
  barrierMesh.visible = false; barrierMesh.userData.collisionProxy = true;
  const barrierCollider = game.colliders.at(-1);
  const barrierArt = game.addProp(20, 4.04, [0, .02, -15.04], 1);
  const barrierIndicator = makeIndicator([0, 5.95, -14.95], AMBER, .19);
  const chargePosition = new THREE.Vector3(-4, 0, -10);
  const chargeArt = game.addProp(18, 2.05, chargePosition.toArray(), 1);
  const chargeHeight = new THREE.Box3().setFromObject(chargeArt).getSize(new THREE.Vector3()).y;
  chargeArt.scale.y *= .14 / Math.max(chargeHeight, .01);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, .07, 10, 48), new THREE.MeshBasicMaterial({ color: AMBER }));
  ring.rotation.x = -Math.PI / 2; ring.position.copy(chargePosition).y = .17; scene.add(ring);
  const barrierCable = signal([[-4, .085, -10], [-4, .085, -13], [-2.4, .085, -13], [-2.4, .085, -15]]);
  const barrier = { mesh: barrierMesh, collider: barrierCollider, art: barrierArt, indicator: barrierIndicator,
    position: new THREE.Vector3(0, 0, -15), baseY: 2.65, artBaseY: .02, progress: 0, opened: false, links: [barrierCable] };
  const chargePad = { position: chargePosition, ring, art: chargeArt, links: [barrierCable] };

  const ledgeFloor = floor(-8, -3, -25, -20, 2.2, inset, 2.2);
  game.box(-8.06, 2.6, -22.5, .12, .8, 5, teal, { solid: true });
  game.box(-5.5, 2.6, -25.06, 5, .8, .12, teal, { solid: true });
  const liftGroup = new THREE.Group(); liftGroup.position.set(-6, 0, -18.5); scene.add(liftGroup);
  const liftMesh = game.box(0, -.18, 0, 3, .36, 3, m.trim, { solid: true, parent: liftGroup });
  const liftCollider = game.colliders.at(-1);
  // Keep the original platform visible; the box is only its physical proxy.
  // The source top and the support plane both end at group-local y = 0.
  liftMesh.visible = false;
  const liftArt = game.addProp(19, 2.85, [-6, -.16, -18.5], 1);
  const liftArtHeight = new THREE.Box3().setFromObject(liftArt).getSize(new THREE.Vector3()).y;
  liftArt.scale.y *= .16 / Math.max(.01, liftArtHeight);
  liftGroup.attach(liftArt);
  const liftFloor = { minX: -7.5, maxX: -4.5, minZ: -20, maxZ: -17, y: 0, mesh: liftMesh };
  game.floors.push(liftFloor);
  for (const x of [-7.7, -4.3]) {
    game.box(x, 1.08, -19.86, .14, 2.4, .18, teal, { solid: true });
    game.box(x, 2.32, -19.86, .22, .15, .28, pastel[1], { camera: false, aim: false });
  }
  const liftIndicator = makeIndicator([-6, .24, -17.04], 0x8bf0d2, .11); liftGroup.attach(liftIndicator);
  const lift = { group: liftGroup, mesh: liftMesh, collider: liftCollider, floor: liftFloor, art: liftArt,
    minY: 0, maxY: 2.2, position: new THREE.Vector3(-6, 0, -18.5), progress: 0, indicator: liftIndicator, ledgeFloor };
  game.label('↑', -6, 3.5, -20.14, 1.5, '#669fa4');

  const launchPad = game.addProp(21, 2.75, [0, 0, -31.5], 2);
  const launchHeight = new THREE.Box3().setFromObject(launchPad).getSize(new THREE.Vector3()).y;
  launchPad.scale.y *= .12 / Math.max(.01, launchHeight);
  const launchRing = new THREE.Mesh(new THREE.TorusGeometry(1.43, .07, 10, 48), new THREE.MeshBasicMaterial({ color: AMBER }));
  launchRing.rotation.x = -Math.PI / 2; launchRing.position.set(0, .17, -31.5); scene.add(launchRing);
  game.label('↑', 0, .035, -29.4, 2.2, '#bf8341').rotation.x = -Math.PI / 2;
  const doorLinks = [
    signal([[4.6, .09, 0], [4.6, .09, -2.65], [2.95, .09, -2.65]]),
    signal([[-5, 2.29, -23], [-3.13, 2.29, -23], [-3.13, 2.29, -25.23], [-3.13, .09, -25.23], [-2.95, .09, -25.7]]),
    signal([[0, .09, -44], [0, .09, -46.55], [2.95, .09, -46.55]]),
  ];
  // A small optional climbing nook gives the third-person character room to
  // play, without putting furniture in the critical bridge approach.
  const tiles = [];
  for (const x of [6.8, 9.0]) for (const z of [16.4, 18.6]) {
    const tile = game.addProp(23, 2.18, [x, .018, z], 0);
    const bounds = new THREE.Box3().setFromObject(tile);
    const collider = game.collisionProxy(bounds);
    tiles.push({ model: tile, collider });
  }
  const tileTop = Math.max(...tiles.map(tile => tile.collider.box.max.y));
  const table = game.addProp(14, 1.1, [7.8, tileTop, 15.5], 0, 0, { height: true });
  const tableBounds = new THREE.Box3().setFromObject(table), tableHeight = tableBounds.max.y - tableBounds.min.y;
  const tableTop = tableBounds.max.y;
  const topBox = new THREE.Box3(new THREE.Vector3(tableBounds.min.x, tableTop - .12, tableBounds.min.z), tableBounds.max.clone());
  const tableCollider = game.collisionProxy(topBox);
  const tableCenter = tableBounds.getCenter(new THREE.Vector3());
  game.collisionProxy(new THREE.Box3(new THREE.Vector3(tableCenter.x - .22, tileTop, tableCenter.z - .22),
    new THREE.Vector3(tableCenter.x + .22, tableTop - .12, tableCenter.z + .22)));
  const chair = game.addProp(13, 1.48, [5.55, 0, 17.1], 0, Math.PI / 2, { height: true });
  const chairBounds = new THREE.Box3().setFromObject(chair), chairCenter = chairBounds.getCenter(new THREE.Vector3());
  const seatY = .69;
  game.collisionProxy(new THREE.Box3(new THREE.Vector3(chairCenter.x - .43, seatY - .12, chairCenter.z - .43),
    new THREE.Vector3(chairCenter.x + .43, seatY, chairCenter.z + .43)));
  game.collisionProxy(new THREE.Box3(new THREE.Vector3(chairCenter.x + .29, seatY, chairCenter.z - .43),
    new THREE.Vector3(chairCenter.x + .43, chairBounds.max.y, chairCenter.z + .43)));
  game.collisionProxy(new THREE.Box3(new THREE.Vector3(chairCenter.x - .15, 0, chairCenter.z - .15),
    new THREE.Vector3(chairCenter.x + .15, seatY, chairCenter.z + .15)));

  const placeRamp = (id, x, z, width, depth, highY, stage) => {
    const model = game.addProp(id, depth, [x, 0, z], stage);
    model.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    const totalHeight = id === 25 ? highY * 1.27 : highY;
    model.scale.set(width / size.x, totalHeight / size.y, depth / size.z);
    const ramp = { id: model.uuid, model, minX: x - width / 2, maxX: x + width / 2,
      minZ: z - depth / 2, maxZ: z + depth / 2, lowY: 0, highY, highAt: 'minZ' };
    game.ramps.push(ramp);
    // Only the raised rear lip needs a box. The ramp itself is a true slope.
    if (id === 25) game.collisionProxy(new THREE.Box3(new THREE.Vector3(ramp.minX, highY, ramp.minZ),
      new THREE.Vector3(ramp.maxX, totalHeight, ramp.minZ + .11)));
    game.cameraBlockers.push(model); game.aimBlockers.push(model);
    return ramp;
  };
  const nookRamp = placeRamp(25, 9.35, 14.1, 1.75, 3.4, 1.20, 0);
  // Its upper lip joins a lookout; climbing is optional and never traps cargo.
  floor(8.47, 10.23, 11.4, 12.43, 1.53, inset, 1.53);
  const slope = placeRamp(27, -9.7, -22.4, 3.35, 5.2, 2.2, 1);
  floor(-11.4, -8, -25.5, -25, 2.2, inset, 2.2);
  floor(-8.05, -7.8, -25, -24.6, 2.2, inset, 2.2);
  for (const [x, y, z, yaw, stage] of [[10.2, 1.53, 11.7, Math.PI / 2, 0], [-10.9, 2.2, -25.4, 0, 1], [-8.03, 2.2, -22.5, Math.PI / 2, 1]]) {
    const rail = game.addProp(26, 1.08, [x, y, z], stage, yaw, { height: true });
    game.collisionProxy(new THREE.Box3().setFromObject(rail));
  }
  game.exploration = { table: { model: table, collider: tableCollider, position: table.position.clone(), top: tableTop },
    chair: { model: chair, seatY, position: chair.position.clone() }, ramps: [nookRamp, slope], tiles };
  game.label('ПОПРОБУЙ ЗАПРЫГНУТЬ', 7.7, 2.6, 14.8, 4.8, '#426b7d');
  game.label('ЦВЕТНАЯ СТЕНА • БЕЗ ПРОХОДОВ', 0, 4.35, 21.91, 9.2, '#486579', Math.PI);
  return { bridges, terminals, lift, barrier, chargePad, launchPad, launchRing, recoveryFloors, doorLinks };
}
