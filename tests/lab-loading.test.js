import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPool, fetchModelBytes } from '../src/game/LabAssetLoader.js';

test('streamed model download reports bytes before completion and preserves binary data', async () => {
  const chunks = [new Uint8Array([0, 255, 3]), new Uint8Array([89]), new Uint8Array([0, 32, 200, 4])];
  const progress = []; let reads = 0, released = false;
  const buffer = await fetchModelBytes('models/test.glb', {
    onBytes(bytes) { progress.push({ bytes, reads }); },
    fetchImpl: async () => ({ ok: true, body: { getReader: () => ({
      async read() { const value = chunks[reads++]; return { value, done: !value }; },
      releaseLock() { released = true; },
    }) } }),
  });
  assert.deepEqual([...new Uint8Array(buffer)], [0, 255, 3, 89, 0, 32, 200, 4]);
  assert.deepEqual(progress, [{ bytes: 3, reads: 1 }, { bytes: 1, reads: 2 }, { bytes: 4, reads: 3 }]);
  assert.equal(released, true);
});

test('a failed model request reports failure instead of silently creating an empty asset', async () => {
  await assert.rejects(fetchModelBytes('models/missing.glb', {
    fetchImpl: async () => ({ ok: false, status: 404 }),
  }), /404.*missing\.glb/);
});

test('task pools enforce their concurrency limit and continue queued work after a failure', async () => {
  const pool = createTaskPool(2), releases = []; let active = 0, peak = 0;
  const jobs = Array.from({ length: 5 }, (_, index) => pool(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.push(resolve)); active--;
    if (index === 1) throw new Error('decode failure');
    return index;
  }));
  const complete = Promise.allSettled(jobs);
  for (let i = 0; i < 5; i++) {
    while (!releases.length) await new Promise(resolve => setImmediate(resolve));
    releases.shift()();
  }
  const results = await complete;
  assert.equal(peak, 2); assert.equal(active, 0);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
  assert.equal(results[4].value, 4);
});
