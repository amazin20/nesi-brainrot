import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { resolvePlayerSkin, PLAYER_RIG_SPEC } from '../src/game/PlayerRig.js';

const require = createRequire(import.meta.url);
const project = path.resolve(import.meta.dirname, '..');
const inputPath = path.join(project, 'public/models/model-01-player.glb');
const decoderPath = path.join(project, 'public/draco/draco_decoder.js');

function parseGlb(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).replace(/\0+$/u, ''));
  const binaryHeader = 20 + jsonLength;
  const binaryLength = buffer.readUInt32LE(binaryHeader);
  return { json, binary: buffer.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength) };
}

async function loadDraco() {
  const decoderDirectory = path.dirname(decoderPath);
  const context = {
    console, require, module: { exports: {} }, exports: {},
    __filename: decoderPath, __dirname: decoderDirectory,
    process, Buffer, URL, WebAssembly, TextDecoder,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(decoderPath, 'utf8'), context, { filename: decoderPath });
  return context.module.exports({ locateFile: (name) => path.join(decoderDirectory, name) });
}

function readAttribute(draco, decoder, mesh, id) {
  const attribute = decoder.GetAttributeByUniqueId(mesh, id);
  const source = new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attribute, source);
  const result = new Float32Array(source.size());
  for (let index = 0; index < result.length; index += 1) result[index] = source.GetValue(index);
  draco.destroy(source);
  return result;
}

const glb = parseGlb(fs.readFileSync(inputPath));
const draco = await loadDraco();
const primitive = glb.json.meshes[0].primitives[0];
const extension = primitive.extensions.KHR_draco_mesh_compression;
const compressedView = glb.json.bufferViews[extension.bufferView];
const compressed = glb.binary.subarray(
  compressedView.byteOffset ?? 0,
  (compressedView.byteOffset ?? 0) + compressedView.byteLength,
);
const decoderBuffer = new draco.DecoderBuffer();
decoderBuffer.Init(new Int8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength), compressed.byteLength);
const decoder = new draco.Decoder();
const mesh = new draco.Mesh();
const status = decoder.DecodeBufferToMesh(decoderBuffer, mesh);
if (!status.ok()) throw new Error(status.error_msg());
const positions = readAttribute(draco, decoder, mesh, extension.attributes.POSITION);
const indices = new Uint32Array(mesh.num_faces() * 3);
const face = new draco.DracoInt32Array();
for (let triangle = 0; triangle < mesh.num_faces(); triangle += 1) {
  decoder.GetFaceFromMesh(mesh, triangle, face);
  indices[triangle * 3] = face.GetValue(0);
  indices[triangle * 3 + 1] = face.GetValue(1);
  indices[triangle * 3 + 2] = face.GetValue(2);
}

const vertexCount = positions.length / 3;
const parents = new Uint32Array(vertexCount);
const ranks = new Uint8Array(vertexCount);
for (let vertex = 0; vertex < vertexCount; vertex += 1) parents[vertex] = vertex;
const find = (start) => {
  let root = start;
  while (parents[root] !== root) root = parents[root];
  let vertex = start;
  while (parents[vertex] !== vertex) {
    const next = parents[vertex];
    parents[vertex] = root;
    vertex = next;
  }
  return root;
};
const union = (a, b) => {
  let rootA = find(a);
  let rootB = find(b);
  if (rootA === rootB) return;
  if (ranks[rootA] < ranks[rootB]) [rootA, rootB] = [rootB, rootA];
  parents[rootB] = rootA;
  if (ranks[rootA] === ranks[rootB]) ranks[rootA] += 1;
};
for (let offset = 0; offset < indices.length; offset += 3) {
  union(indices[offset], indices[offset + 1]);
  union(indices[offset], indices[offset + 2]);
}

const components = new Map();
const tempIndices = new Uint16Array(4);
const tempWeights = new Float32Array(4);
for (let vertex = 0; vertex < vertexCount; vertex += 1) {
  const root = find(vertex);
  let component = components.get(root);
  if (!component) {
    component = {
      count: 0,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      scores: new Float64Array(PLAYER_RIG_SPEC.length),
    };
    components.set(root, component);
  }
  component.count += 1;
  const offset = vertex * 3;
  for (let axis = 0; axis < 3; axis += 1) {
    component.min[axis] = Math.min(component.min[axis], positions[offset + axis]);
    component.max[axis] = Math.max(component.max[axis], positions[offset + axis]);
  }
  resolvePlayerSkin(
    positions[offset], positions[offset + 1], positions[offset + 2],
    tempIndices, tempWeights,
  );
  for (let slot = 0; slot < 4; slot += 1) component.scores[tempIndices[slot]] += tempWeights[slot];
}

const rows = [...components.values()].map((component) => {
  const extents = component.max.map((value, axis) => value - component.min[axis]);
  const sortedScores = [...component.scores].sort((a, b) => b - a);
  return {
    ...component,
    extents,
    maxExtent: Math.max(...extents),
    dominantShare: sortedScores[0] / component.count,
    secondShare: sortedScores[1] / component.count,
  };
}).sort((a, b) => b.count - a.count);

const quantile = (values, fraction) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))];
const counts = rows.map(({ count }) => count).sort((a, b) => a - b);
const extents = rows.map(({ maxExtent }) => maxExtent).sort((a, b) => a - b);
const thresholds = [8, 16, 32, 64, 128, 256, 1024];
console.log(JSON.stringify({
  vertexCount,
  triangleCount: indices.length / 3,
  componentCount: rows.length,
  componentVertexQuantiles: Object.fromEntries([0.5, 0.75, 0.9, 0.95, 0.99].map((q) => [q, quantile(counts, q)])),
  componentExtentQuantiles: Object.fromEntries([0.5, 0.75, 0.9, 0.95, 0.99].map((q) => [q, quantile(extents, q)])),
  verticesByMaximumComponentSize: Object.fromEntries(thresholds.map((limit) => [
    limit,
    rows.filter(({ count }) => count <= limit).reduce((sum, { count }) => sum + count, 0),
  ])),
  surfaceCoherentV3: {
    componentCount: rows.filter(({ count, maxExtent }) => count <= 256 && maxExtent <= 0.055).length,
    vertexCount: rows
      .filter(({ count, maxExtent }) => count <= 256 && maxExtent <= 0.055)
      .reduce((sum, { count }) => sum + count, 0),
  },
  largest: rows.slice(0, 20).map(({ count, min, max, extents: componentExtents, dominantShare, secondShare }) => ({
    count, min, max, extents: componentExtents, dominantShare, secondShare,
  })),
}, null, 2));

draco.destroy(face);
draco.destroy(mesh);
draco.destroy(decoder);
draco.destroy(decoderBuffer);
