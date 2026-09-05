import * as THREE from 'three';

/** An aperture, its render meshes and its collision bounds share one specification.
 * Side walls overlap the flush frame. No cut-outs inferred from decorative GLB bounds.
 * Door pivots are real hinges; the energy field occupies the identical clear opening. */
export function createArchitecturalGate(game, { z, width = 4.8, height = 3.65,
  roomWidth = 18, roomHeight = 6.2, kind = 'door', floorY = 0, constructWalls = true } = {}) {
  if (![z, width, height, roomWidth, roomHeight, floorY].every(Number.isFinite) || width <= 1.4 || width >= roomWidth)
    throw new RangeError('Invalid architectural gate dimensions');
  const art = new THREE.Group(); art.name = `Integrated ${kind} gateway`; game.scene.add(art);
  const half = width / 2, depth = .48, rim = .18;
  const neutral = game.materials.wall, trim = game.materials.dark;
  const lamp = new THREE.MeshBasicMaterial({ color: 0x82d6c1 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xb5c8c9, roughness: .72, metalness: .09 });
  const make = (x, y, zz, w, h, d, mat, parent = art) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, zz); mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  // Continuous wall from the outer shell to the actual clear aperture.
  const leftWidth = roomWidth / 2 - half;
  if (constructWalls) for (const sign of [-1, 1]) game.box(sign * (half + leftWidth / 2), floorY + roomHeight / 2, z,
    leftWidth + .02, roomHeight, depth, neutral, { solid: true });
  if (constructWalls) game.box(0, floorY + height + (roomHeight - height) / 2, z, width + .04,
    roomHeight - height + .02, depth, neutral, { solid: true });
  const frame = [
    make(-half - rim / 2, floorY + height / 2, z, rim + .04, height + .04, depth + .08, trim),
    make(half + rim / 2, floorY + height / 2, z, rim + .04, height + .04, depth + .08, trim),
    make(0, floorY + height + rim / 2, z, width + rim * 2, rim + .04, depth + .08, trim),
  ];
  for (const sign of [-1, 1]) make(sign * (half + .045), floorY + 1.3, z + depth / 2 + .045,
    .025, .38, .025, lamp);
  const opening = new THREE.Box3(new THREE.Vector3(-half, floorY, z - .10),
    new THREE.Vector3(half, floorY + height, z + .10));
  const leaves = [], hinges = [];
  let field = null, scan = null;
  if (kind === 'door') {
    for (const sign of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(sign * half, floorY, z); art.add(pivot);
      const leaf = make(-sign * half / 2, height / 2, 0, half + .014, height - .02, .13, panelMat, pivot);
      make(-sign * (half - .20), height * .5, .085, .06, .32, .04, trim, pivot);
      // Restrained inset, not a large neon frame.
      make(-sign * half / 2, height * .64, .071, half - .30, .014, .014, trim, pivot);
      hinges.push({ pivot, sign }); leaves.push(leaf);
    }
  } else {
    const material = new THREE.MeshBasicMaterial({ color: 0x4b96ae, transparent: true, opacity: .28,
      depthWrite: false, side: THREE.DoubleSide });
    field = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    field.position.set(0, floorY + height / 2, z); art.add(field);
    scan = make(0, floorY + .02, z + .005, width, .015, .008,
      new THREE.MeshBasicMaterial({ color: 0x7ed7d3, transparent: true, opacity: .52 }));
  }
  const mechanism = {
    opening, progress: 0,
    get solid() { return this.progress < .96; },
    update(progress, time = 0) {
      this.progress = THREE.MathUtils.clamp(progress, 0, 1);
      const eased = this.progress * this.progress * (3 - 2 * this.progress);
      for (const { pivot, sign } of hinges) pivot.rotation.y = -sign * 1.48 * eased;
      if (field) {
        field.visible = this.progress < .98; field.material.opacity = .28 * (1 - eased);
        scan.visible = field.visible; scan.material.opacity = .52 * (1 - eased);
        scan.position.y = floorY + .025 + (height - .05) * ((time * .22) % 1);
      }
      art.updateWorldMatrix(true, true);
    },
    getLeafBoxes() { art.updateWorldMatrix(true, true); return leaves.map(leaf => new THREE.Box3().setFromObject(leaf)); },
    getFrameBoxes() { art.updateWorldMatrix(true, true); return frame.map(mesh => new THREE.Box3().setFromObject(mesh)); },
  };
  mechanism.update(0);
  return { art, mechanism, opening, frame, leaves, field, specification: { z, width, height, depth, floorY } };
}
