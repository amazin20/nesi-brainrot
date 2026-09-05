// Export source/runtime geometry pairs for the deterministic CPU comparison.
// NESI_MODEL_TOOLS=/tmp/nesi-model-tools/node_modules node scripts/optimize-runtime-models-qa.mjs /tmp/nesi-model-qa /path/to/uploads
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(path.resolve(process.env.NESI_MODEL_TOOLS), '../package.json'));
const dep = async name => import(pathToFileURL(require.resolve(name)).href);
const [{ NodeIO }, { ALL_EXTENSIONS }, { default: draco }] = await Promise.all([dep('@gltf-transform/core'), dep('@gltf-transform/extensions'), dep('draco3dgltf')]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco.createDecoderModule() });
const [outDir, uploads] = process.argv.slice(2);
if (!outDir || !uploads) throw new Error('Provide QA output and original upload directories.');
await fs.mkdir(outDir, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(root, 'public/models/runtime/manifest.json'), 'utf8'));
const selected = process.env.NESI_QA_IDS?.split(',').map(Number) ?? [1, 2, 11, 17, 18, 21, 28, 29, 30];
const pairs = [];
for (const model of manifest.models.filter(item => selected.includes(item.id))) {
  const pair = { id: model.id, name: model.filename, variants: [] };
  for (const variant of ['source', 'runtime']) {
    const file = variant === 'runtime' ? path.join(root, 'public/models/runtime', model.filename)
      : model.id >= 28 ? path.join(uploads, model.sourceFilename) : path.join(root, 'public/models', model.sourceFilename);
    const document = await io.read(file);
    const node = document.getRoot().listNodes().find(n => n.getMesh());
    const primitives = node.getMesh().listPrimitives();
    if (primitives.length !== 1) throw new Error('CPU QA expects one primitive per supplied model.');
    const primitive = primitives[0], prefix = `${model.id}-${variant}`;
    const attributes = ['POSITION', 'NORMAL', 'TEXCOORD_0'];
    for (const name of attributes) {
      const a = primitive.getAttribute(name).getArray();
      await fs.writeFile(path.join(outDir, `${prefix}-${name}.bin`), Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    }
    const indices = Uint32Array.from(primitive.getIndices().getArray());
    await fs.writeFile(path.join(outDir, `${prefix}-indices.bin`), Buffer.from(indices.buffer));
    const texture = primitive.getMaterial().getBaseColorTexture();
    await fs.writeFile(path.join(outDir, `${prefix}-texture.webp`), texture.getImage());
    pair.variants.push({ prefix, matrix: node.getWorldMatrix(), triangles: indices.length / 3 });
  }
  pairs.push(pair);
  console.log(`QA exported model ${model.id}`);
}
await fs.writeFile(path.join(outDir, 'pairs.json'), JSON.stringify(pairs, null, 2));
