// Uses the real uploaded mesh geometry and production game simulation in Node.
// This is a physics/route check, not a WebGL screenshot or a rendering claim.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LabGame } from '../src/game/LabGame.js';
import { resolvePortalPlacement } from '../src/game/LabPortals.js';
import { ALL_LAB_ASSETS } from '../src/game/labAssets.js';
import { createEvidenceDriver, runContinuousJourney, jumpOntoTable } from '../src/game/LabEvidence.js';

const scope = { console, TextDecoder, module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(new URL('../node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', import.meta.url), 'utf8'), scope);
const draco = await scope.DracoDecoderModule();
async function load(file) {
  const bytes = fs.readFileSync(file), length = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + length)), bin = bytes.subarray(28 + length);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const types = { 5120: [Int8Array, 1, 'getInt8'], 5121: [Uint8Array, 1, 'getUint8'],
    5122: [Int16Array, 2, 'getInt16'], 5123: [Uint16Array, 2, 'getUint16'],
    5125: [Uint32Array, 4, 'getUint32'], 5126: [Float32Array, 4, 'getFloat32'] };
  function accessor(id) {
    const acc = doc.accessors[id], view = doc.bufferViews[acc.bufferView];
    const [Type, size, getter] = types[acc.componentType], width = components[acc.type];
    const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), array = new Type(acc.count * width);
    const start = (view.byteOffset || 0) + (acc.byteOffset || 0), stride = view.byteStride || size * width;
    for (let i = 0; i < acc.count; i++) for (let j = 0; j < width; j++) array[i * width + j] = data[getter](start + i * stride + j * size, true);
    return new THREE.BufferAttribute(array, width, !!acc.normalized);
  }
  function mesh(primitive) {
    const geometry = new THREE.BufferGeometry(), ext = primitive.extensions?.KHR_draco_mesh_compression;
    const semantics = [['POSITION','position',3],['NORMAL','normal',3],['TEXCOORD_0','uv',2]];
    if (ext) {
      const view = doc.bufferViews[ext.bufferView], buffer = new draco.DecoderBuffer();
      buffer.Init(new Int8Array(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)), view.byteLength);
      const decoder = new draco.Decoder(), decoded = new draco.Mesh();
      assert.ok(decoder.DecodeBufferToMesh(buffer, decoded).ok(), `Decode failed: ${file}`);
      for (const [semantic, name, size] of semantics) {
        if (!(semantic in ext.attributes)) continue;
        const attribute = decoder.GetAttributeByUniqueId(decoded, ext.attributes[semantic]);
        const data = new draco.DracoFloat32Array(); decoder.GetAttributeFloatForAllPoints(decoded, attribute, data);
        const array = new Float32Array(decoded.num_points() * size);
        for (let i = 0; i < array.length; i++) array[i] = data.GetValue(i);
        geometry.setAttribute(name, new THREE.BufferAttribute(array, size)); draco.destroy(data);
      }
      const face = new draco.DracoInt32Array(), indices = new Uint32Array(decoded.num_faces() * 3);
      for (let i = 0; i < decoded.num_faces(); i++) { decoder.GetFaceFromMesh(decoded, i, face); for (let k = 0; k < 3; k++) indices[i * 3 + k] = face.GetValue(k); }
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      draco.destroy(face); draco.destroy(decoded); draco.destroy(decoder); draco.destroy(buffer);
    } else {
      for (const [semantic, name] of semantics) if (semantic in primitive.attributes) geometry.setAttribute(name, accessor(primitive.attributes[semantic]));
      if (primitive.indices !== undefined) geometry.setIndex(accessor(primitive.indices));
    }
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
  }
  const nodes = doc.nodes.map(node => {
    const object = new THREE.Group();
    if (node.mesh !== undefined) for (const primitive of doc.meshes[node.mesh].primitives) object.add(mesh(primitive));
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.translation) object.position.fromArray(node.translation);
    if (node.scale) object.scale.fromArray(node.scale);
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    return object;
  });
  doc.nodes.forEach((node, i) => { for (const child of node.children || []) nodes[i].add(nodes[child]); });
  const group = new THREE.Group(); for (const id of doc.scenes[doc.scene || 0].nodes) group.add(nodes[id]); return group;
}

const game = new LabGame({ container: null, touch: false });
game.scene = new THREE.Scene(); game.camera = new THREE.PerspectiveCamera(57, 16/9, .1, 130);
game.materials = Object.fromEntries(['wall','floor','dark','trim','cyan','amber','glass'].map(name => [name,
  new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })]));
game.audio = { tone() {}, jump() {}, pickup() {}, checkpoint() {}, win() {}, step() {} };
game.input = { keys: new Set(), jumpQueued: false, getMove() {
  return new THREE.Vector2((this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0),
    (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0)).normalize();
}, consumeJump() { const value = this.jumpQueued; this.jumpQueued = false; return value; } };
game.label = () => new THREE.Object3D();
game.createOverlay = () => { game.prompt = { textContent: '' }; };
globalThis.document = { exitPointerLock() {} };
for (const asset of ALL_LAB_ASSETS) game.assets.set(asset.id, await load(new URL(`../public/models/${asset.id >= 23 ? 'lod/' : ''}${asset.file}`, import.meta.url)));
console.log(`Decoded ${game.assets.size} real GLB assets`);
game.buildLevel();
console.log(`Built ${game.colliders.length} colliders and ${game.portalPanels.length} portal surfaces`);
// Exercise actual rig/IK update with the actual imported meshes before taking
// the longer physics route. Source attributes must not be mutated by animation.
const positions = game.companionRig.mesh.geometry.attributes.position.array.slice();
for (let i = 0; i < 120; i++) game.updateVisuals(1/60, 1);
assert.deepEqual(game.companionRig.mesh.geometry.attributes.position.array, positions);
assert.ok(game.animator.diagnostics.boneCount === 14);
const updateVisuals = game.updateVisuals.bind(game);
const driver = createEvidenceDriver(game);
const geometryChecks = {};
driver.reset(); driver.fixturePlayer(0, 0, 17);
game.physics.resetCargo({ position: [0, .43, 15.9] }); driver.step(.2); driver.pressE(); driver.step(1.8);
assert.equal(game.heldCube, game.cargo);
const carry = game.animator.diagnostics.carryReach;
assert.ok(carry.leftError < .13 && carry.rightError < .13, `Actual GLB hand contact: ${JSON.stringify(carry)}`);
geometryChecks.carry = { ...carry, holstered: game.heldDevice.diagnostics.state === 'holstered' };
assert.ok(geometryChecks.carry.holstered);
driver.reset(); driver.fixturePlayer(-6.5, 0, 15, Math.PI * 1.5); game.pitch = 0; driver.step(2);
const cameraBefore = { p: game.camera.position.clone(), q: game.camera.quaternion.clone(), fov: game.camera.fov };
assert.ok(game.placePortal(0), 'A real stationary shot must hit a white wall');
const cameraMotion = { position:0, angle:0, fov:0 };
for (let i=0; i<45; i++) {
  driver.step(1/60);
  cameraMotion.position = Math.max(cameraMotion.position, cameraBefore.p.distanceTo(game.camera.position));
  cameraMotion.angle = Math.max(cameraMotion.angle, cameraBefore.q.angleTo(game.camera.quaternion));
  cameraMotion.fov = Math.max(cameraMotion.fov, Math.abs(cameraBefore.fov-game.camera.fov));
}
assert.ok(Object.values(cameraMotion).every(n => n < .001), `Shot camera moved: ${JSON.stringify(cameraMotion)}`);
geometryChecks.shotCamera = cameraMotion;
geometryChecks.table = jumpOntoTable(game, driver);
// A carried companion must not remove furniture traversal. These fixtures
// only choose the start of each jump; every ascent and landing is simulated.
for (const kind of ['table', 'chair']) {
  driver.reset();
  const item = game.exploration[kind], box = new THREE.Box3().setFromObject(item.model), center = box.getCenter(new THREE.Vector3());
  const top = kind === 'table' ? item.top : item.seatY;
  const start = kind === 'table' ? new THREE.Vector3(center.x,0,box.max.z+.65) : new THREE.Vector3(center.x-1.1,0,center.z);
  const facing = kind === 'table' ? Math.PI : Math.PI/2;
  driver.fixturePlayer(...start.toArray(), facing);
  const forward = new THREE.Vector3(Math.sin(facing),0,Math.cos(facing));
  game.physics.resetCargo({ position:start.clone().addScaledVector(forward,-.65).add(new THREE.Vector3(0,.5,0)) });
  driver.step(.3); driver.pressE(); driver.step(.9); assert.equal(game.heldCube,game.cargo);
  game.input.jumpQueued = true; driver.key('KeyW');
  let landed=false, peak=game.playerPosition.y;
  for (let i=0; i<125; i++) {
    driver.step(1/60); peak=Math.max(peak,game.playerPosition.y);
    if (kind === 'chair' && game.playerPosition.x > center.x-.68) driver.key('KeyW',false);
    if (i>10 && game.playerGrounded && Math.abs(game.playerPosition.y-top)<.025) { landed=true; break; }
  }
  driver.key('KeyW',false); driver.step(.25);
  assert.ok(landed && game.heldCube === game.cargo && Math.abs(game.playerPosition.y-top)<.025,
    `Loaded ${kind} jump failed: ${game.playerPosition.toArray()}, target height=${top}, held=${!!game.heldCube}, landed=${landed}`);
  geometryChecks[`${kind}WithCompanion`] = { grounded:game.playerGrounded, peak, top, finish:game.playerPosition.toArray(), sameCompanion:true };
}
console.log('Actual model checks:', JSON.stringify(geometryChecks));
// Preserve production transforms during the long physics route. Skinning and
// camera updates were exercised above; neither writes gameplay coordinates.
game.updateVisuals = dt => {
  game.visualTime += dt;
  game.playerGroup.position.copy(game.playerPosition); game.playerGroup.rotation.y = game.facing;
  game.cargo.group.position.copy(game.cargo.position); game.cargo.group.quaternion.copy(game.cargo.quaternion);
  game.scene.updateMatrixWorld(true);
};
const started = performance.now();
try {
  const report = { ...runContinuousJourney(game, driver), geometryChecks };
  console.log(JSON.stringify({ ...report, seconds: (performance.now() - started) / 1000 }, null, 2));
  fs.mkdirSync('qa', { recursive: true }); fs.writeFileSync('qa/continuous-journey.json', JSON.stringify(report, null, 2) + '\n');
} catch (error) {
  const hits = game.raycaster.intersectObjects(game.aimBlockers, true).filter(h => (h.object.visible || h.object.userData.collisionProxy) && game.isActiveBlocker(h.object));
  console.log('Route failure context', JSON.stringify({ player: game.playerPosition.toArray(), cargo: game.cargo.position.toArray(),
    door: game.doors.map(d => ({ opened:d.opened, progress:d.progress })),
    hits: hits.slice(0,4).map(h => ({ point:h.point.toArray(), portalable:h.object.userData.portalable,
      proxy:h.object.userData.collisionProxy, name:h.object.name, center:h.object.userData.center,
      placement: resolvePortalPlacement(h.object, h.point, { blockers:game.colliders }) })) }, null, 2));
  throw error;
} finally {
  game.updateVisuals = updateVisuals;
  game.physics.dispose(); game.portals.dispose();
}
