import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceDriver, createEvidenceFrameStepper, makeStoredZip } from '../src/game/LabEvidence.js';

test('evidence advances one production animation and two physics steps for each 60 fps frame', () => {
  const physical = [], visual = [];
  const game = { input: { keys: new Set() }, updatePlaying: dt => physical.push(dt), updateVisuals: dt => visual.push(dt) };
  const driver = createEvidenceDriver(game);
  for (let frame = 0; frame < 600; frame++) driver.step(1 / 60);
  assert.equal(physical.length, 1200); assert.equal(visual.length, 600);
  assert.ok(physical.every(dt => dt === 1 / 120)); assert.ok(visual.every(dt => dt === 1 / 60));
});

test('frame ZIP is a standards-compatible STORE archive with correct CRC, offsets and bytes', async () => {
  const zip = await makeStoredZip([{ name: '0000.png', blob: new Blob(['hello']) }, { name: 'report.json', blob: new Blob(['{}']) }]);
  const bytes = new Uint8Array(await zip.arrayBuffer()), view = new DataView(bytes.buffer), decoder = new TextDecoder();
  assert.equal(zip.type, 'application/zip');
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(8, true), 0); // STORE, not an unannounced compressor.
  assert.equal(view.getUint32(14, true), 0x3610a686); // Published CRC-32 of "hello".
  assert.equal(decoder.decode(bytes.slice(30, 38)), '0000.png');
  assert.equal(decoder.decode(bytes.slice(38, 43)), 'hello');
  const tail = bytes.length - 22;
  assert.equal(view.getUint32(tail, true), 0x06054b50);
  assert.equal(view.getUint16(tail + 10, true), 2);
  const directory = view.getUint32(tail + 16, true);
  assert.equal(view.getUint32(directory, true), 0x02014b50);
  assert.equal(view.getUint32(directory + 42, true), 0);
  assert.equal(view.getUint32(directory + 54 + 42, true), 43);
  assert.equal(directory + view.getUint32(tail + 12, true), tail);
});


test('recording keeps one animator update per rendered frame without high-refresh physics speedup', () => {
  for (const fps of [30, 60, 144, 240]) {
    let physics = 0, visuals = 0, visualTime = 0;
    const stepFrame = createEvidenceFrameStepper({ updatePlaying: () => physics++, updateVisuals: dt => { visuals++; visualTime += dt; } });
    for (let frame = 0; frame < 10 * fps; frame++) stepFrame(1 / fps);
    assert.equal(physics, 1200, `${fps} Hz physics time`);
    assert.equal(visuals, 10 * fps, `${fps} Hz actual render count`);
    assert.ok(Math.abs(visualTime - 10) < 1e-10);
  }
});
