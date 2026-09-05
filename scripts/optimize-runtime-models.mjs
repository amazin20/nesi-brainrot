/**
 * Rebuild runtime copies; original uploaded GLBs are never modified.
 * Install the pinned tools in an isolated directory, then run:
 * npm install --prefix /tmp/nesi-model-tools --no-audit --no-fund @gltf-transform/core@4.5.0 @gltf-transform/extensions@4.5.0 @gltf-transform/functions@4.5.0 meshoptimizer@1.2.0 draco3dgltf@1.5.7
 * NESI_MODEL_TOOLS=/tmp/nesi-model-tools/node_modules node scripts/optimize-runtime-models.mjs --uploads=/path/to/uploads
 * Optional --ids=1,2,11 only regenerates those models, retaining other manifest entries.
 * Geometry reduction retains UV seams, material assignments and vertex attributes;
 * Draco adds fine 15-bit position / 10-bit normal / 13-bit UV quantization.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolRoot = process.env.NESI_MODEL_TOOLS;
const require = createRequire(toolRoot ? path.join(path.resolve(toolRoot), '../package.json') : import.meta.url);
const dep = async name => import(pathToFileURL(require.resolve(name)).href);
const [{ NodeIO }, { ALL_EXTENSIONS, KHRDracoMeshCompression }, { weld, prune }, { MeshoptSimplifier }, dracoImport] = await Promise.all([
  dep('@gltf-transform/core'), dep('@gltf-transform/extensions'), dep('@gltf-transform/functions'), dep('meshoptimizer'), dep('draco3dgltf'),
]);
const draco = dracoImport.default ?? dracoImport;
const [decoder, encoder] = await Promise.all([draco.createDecoderModule(), draco.createEncoderModule(), MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': decoder, 'draco3d.encoder': encoder });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.split('=').slice(1).join('=');
const ids = arg('ids') ? new Set(arg('ids').split(',').map(Number)) : null;
const uploads = arg('uploads');
const outDir = path.join(root, 'public/models/runtime');
await fs.mkdir(outDir, { recursive: true });

const settings = [
  [1, 'player', 80000, .0025], [2, 'cargo', 55000, .0025], [11, 'portal-gun', 22000, .006],
  [12, 'grand-piano', 16000, .004], [13, 'office-chair', 18000, .004], [14, 'round-table', 12000, .004],
  [15, 'mug', 8000, .004], [16, 'phase-wall', 15000, .004], [17, 'lab-door', 22000, .004],
  [18, 'pressure-pad', 18000, .004], [19, 'lift-platform', 18000, .004], [20, 'energy-barrier', 18000, .004],
  [21, 'launch-pad', 24000, .004], [22, 'terminal', 18000, .004],
  [23, 'floor-tile', 8000, .012], [24, 'wall-panel', 6400, .004], [25, 'ramp-lipped', 18000, .0016],
  [26, 'railing', 14000, .0016], [27, 'ramp-wide', 16000, .0016],
  [28, 'rotating-panel', 26000, .004, '45538bb83580c4d32c6b85d5ea2d53c3-optimized.glb'],
  [29, 'pressure-platform', 24000, .004, '380d117a10aba2c90bc260e496c0beb6-optimized.glb'],
  [30, 'counterweight-bridge', 30000, .004, 'e4ab7dd3dbe822701601286836dadcb7-optimized.glb'],
];

let previous = { models: [] };
try { previous = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8')); } catch {}
const records = new Map(previous.models.map(item => [item.id, item]));
for (const [id, name, targetTriangles, errorCap, upload] of settings) {
  if (ids && !ids.has(id)) continue;
  const filename = `model-${String(id).padStart(2, '0')}-${name}.glb`;
  if (upload && !uploads) throw new Error(`--uploads directory is required to reproduce model ${id}`);
  const sourceFile = upload ? path.join(uploads, upload) : path.join(root, 'public/models', filename);
  const source = await fs.readFile(sourceFile), started = performance.now();
  const document = await io.readBinary(source);
  const textureHashes = document.getRoot().listTextures().map(texture => hash(texture.getImage())).sort();
  const sourceNodes = document.getRoot().listNodes().map(node => [...node.getTranslation(), ...node.getRotation(), ...node.getScale()]);
  // Exact attribute welding only: distinct UV/normal seam vertices stay distinct.
  await document.transform(weld());
  const primitiveStats = [];
  for (const mesh of document.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    assert.equal(primitive.getMode(), 4, 'Runtime mesh must use triangles');
    const position = primitive.getAttribute('POSITION'), normals = primitive.getAttribute('NORMAL'), uv = primitive.getAttribute('TEXCOORD_0');
    const beforeVertices = position.getCount(), beforeIndices = Uint32Array.from(primitive.getIndices().getArray());
    const attrs = new Float32Array(beforeVertices * 5);
    for (let i = 0; i < beforeVertices; i++) {
      for (let k = 0; k < 3; k++) attrs[i * 5 + k] = normals?.getArray()[i * 3 + k] ?? 0;
      for (let k = 0; k < 2; k++) attrs[i * 5 + 3 + k] = uv?.getArray()[i * 2 + k] ?? 0;
    }
    const flags = id === 1 || id === 2 ? ['RegularizeLight'] : id === 24 ? ['Permissive'] : [];
    // The repeating flat wall permits UV-weighted seam collapse; its
    // source/runtime silhouette and UV appearance are compared in CPU QA.
    // Floor, characters and articulated props keep strict seam boundaries; no Prune.
    const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(beforeIndices,
      position.getArray(), 3, attrs, 5, id === 24 ? [.35, .35, .35, 1, 1] : [.35, .35, .35, .06, .06], null,
      Math.min(beforeIndices.length, targetTriangles * 3), errorCap, flags);
    const [remap, vertexCount] = MeshoptSimplifier.compactMesh(indices);
    for (const semantic of primitive.listSemantics()) {
      const accessor = primitive.getAttribute(semantic), data = accessor.getArray(), width = accessor.getElementSize();
      const compact = new data.constructor(vertexCount * width);
      for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) {
        for (let k = 0; k < width; k++) compact[remap[i] * width + k] = data[i * width + k];
      }
      primitive.setAttribute(semantic, accessor.clone().setArray(compact));
    }
    primitive.setIndices(primitive.getIndices().clone().setArray(indices));
    primitiveStats.push({ trianglesBefore: beforeIndices.length / 3, trianglesAfter: indices.length / 3,
      verticesBefore: beforeVertices, verticesAfter: vertexCount, relativeError: error,
      retainedAttributesUnchangedBeforeDraco: true });
  }
  await document.transform(prune({ keepAttributes: true, keepLeaves: true }));
  document.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
    method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER, encodeSpeed: 4, decodeSpeed: 5,
    quantizationBits: { POSITION: 15, NORMAL: 10, TEX_COORD: 13, COLOR: 10, GENERIC: 14 }, quantizationVolume: 'mesh',
  });
  const output = await io.writeBinary(document), outputPath = path.join(outDir, filename);
  const decoded = await io.readBinary(output);
  assert.deepEqual(decoded.getRoot().listTextures().map(texture => hash(texture.getImage())).sort(), textureHashes, 'Embedded textures changed');
  assert.deepEqual(decoded.getRoot().listNodes().map(node => [...node.getTranslation(), ...node.getRotation(), ...node.getScale()]), sourceNodes, 'Authored node transforms changed');
  await fs.writeFile(outputPath, output);
  const record = { id, filename, sourceFilename: upload ?? filename, sourceSHA256: hash(source), sourceBytes: source.length,
    outputBytes: output.length, outputSHA256: hash(output), targetTriangles, errorCap, primitives: primitiveStats,
    triangles: primitiveStats.reduce((sum, item) => sum + item.trianglesAfter, 0),
    vertices: decoded.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((n, p) => n + p.getAttribute('POSITION').getCount(), 0), 0),
    textureSHA256: textureHashes, originalTextureBytesUnchanged: true, authoredTransformsUnchanged: true,
    compression: 'KHR_draco_mesh_compression', simplifierFlags: id === 24 ? ['Permissive'] : id === 1 || id === 2 ? ['RegularizeLight'] : [], buildMilliseconds: Math.round(performance.now() - started) };
  records.set(id, record);
  console.log(`${String(id).padStart(2,'0')} ${name}: ${record.triangles} triangles, ${(output.length / 1e3).toFixed(1)} kB, ${(record.buildMilliseconds / 1000).toFixed(1)} s`);
  const models = [...records.values()].sort((a, b) => a.id - b.id);
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify({
    generator: 'glTF Transform 4.5.0; meshoptimizer 1.2.0; Draco 1.5.7',
    method: 'Attribute-aware simplification; exact attribute weld; retained source vertices; strict seams except UV-weighted wall24; no Prune; unchanged embedded WebP textures; 15/10/13-bit position/normal/UV Draco',
    ...(previous.validation ? { validation: previous.validation } : {}),
    totalBytes: models.reduce((sum, item) => sum + item.outputBytes, 0),
    totalTriangles: models.reduce((sum, item) => sum + item.triangles, 0), models,
  }, null, 2) + '\n');
}
