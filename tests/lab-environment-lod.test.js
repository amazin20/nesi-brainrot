import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../public/models/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('lod/manifest.json', root)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function glb(file) {
  const bytes = readFileSync(new URL(file, root));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const length = bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.toString('utf8', 20, 20 + length)), bin: bytes.subarray(28 + length) };
}
function imageHashes(g) {
  return g.json.images.map(image => {
    const view = g.json.bufferViews[image.bufferView];
    return sha(g.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
  }).sort();
}
for (const model of manifest.models) {
  test(`${model.source}: game LOD preserves source, textures and materials with bounded triangle budget`, () => {
    const source = glb(model.source), lod = glb(model.output);
    assert.equal(sha(source.bytes), model.sourceSHA256);
    assert.equal(sha(lod.bytes), model.outputSHA256);
    assert.deepEqual(lod.json.materials, source.json.materials);
    assert.deepEqual(lod.json.nodes, source.json.nodes);
    assert.deepEqual(imageHashes(lod), imageHashes(source));
    assert.equal(lod.json.meshes.length, source.json.meshes.length);
    for (const mesh of lod.json.meshes) for (const primitive of mesh.primitives) {
      const position = lod.json.accessors[primitive.attributes.POSITION];
      const indices = lod.json.accessors[primitive.indices];
      assert.ok(indices.count / 3 <= 45000);
      assert.ok(indices.count / 3 >= 10000);
      for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
        const accessor = lod.json.accessors[primitive.attributes[semantic]];
        assert.equal(accessor.count, position.count);
        assert.equal(accessor.componentType, 5126);
        const view = lod.json.bufferViews[accessor.bufferView];
        const size = { VEC2: 2, VEC3: 3 }[accessor.type];
        const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
        const stride = view.byteStride || size * 4;
        for (let i = 0; i < accessor.count; i++) for (let c = 0; c < size; c++) {
          assert.ok(Number.isFinite(lod.bin.readFloatLE(offset + i * stride + c * 4)));
        }
      }
      const view = lod.json.bufferViews[indices.bufferView];
      const offset = (view.byteOffset || 0) + (indices.byteOffset || 0);
      const size = indices.componentType === 5123 ? 2 : 4;
      for (let i = 0; i < indices.count; i++) {
        const index = size === 2 ? lod.bin.readUInt16LE(offset + i * 2) : lod.bin.readUInt32LE(offset + i * 4);
        assert.ok(index < position.count);
      }
    }
  });
}
