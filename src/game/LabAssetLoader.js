import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { FIRST_LEVEL_ASSETS, runtimeAssetPath } from './labAssets.js';

/** Fetch slots and geometry decode slots are independent: a slow image decode
 * never leaves the network idle. The queue is also usable by deterministic tests. */
export function createTaskPool(limit) {
  let active = 0;
  const pending = [];
  const pump = () => {
    while (active < limit && pending.length) {
      const { work, resolve, reject } = pending.shift(); active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; pump(); });
    }
  };
  return work => new Promise((resolve, reject) => { pending.push({ work, resolve, reject }); pump(); });
}

export async function fetchModelBytes(url, { signal, onBytes = () => {}, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, { signal, cache: 'default' });
  if (!response.ok) throw new Error(`Не удалось загрузить модель (${response.status}): ${url.split('/').pop()}`);
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer(); onBytes(buffer.byteLength); return buffer;
  }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.byteLength; onBytes(value.byteLength);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined.buffer;
}

/** Loads just the chosen level. Progress 0..90 covers measured model bytes and
 * completed parses. LabGame owns the subsequent rig/scene/first-frame phases. */
export async function loadLabModels({ renderer, onProgress = () => {}, models = FIRST_LEVEL_ASSETS,
  base = import.meta.env.BASE_URL, fetchImpl = fetch } = {}) {
  const started = performance.now(), controller = new AbortController();
  const draco = new DRACOLoader().setDecoderPath(base + 'draco/').setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const download = createTaskPool(4), decode = createTaskPool(2), assets = new Map();
  const records = new Map(); let downloadedBytes = 0, totalBytes = 0, complete = 0;
  let lastPercent = 0, lastProgress = -Infinity;
  onProgress({ percent: 0, phase: 'manifest', label: 'Подготовка загрузки', completed: 0, total: models.length });
  const report = (label, force = false) => {
    const now = performance.now();
    if (!force && now - lastProgress < 50) return;
    lastProgress = now;
    const ratio = totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : 0;
    const percent = Math.min(90, Math.floor(ratio * 75 + complete / models.length * 15));
    lastPercent = Math.max(lastPercent, percent);
    onProgress({ percent: lastPercent, phase: ratio < 1 ? 'download' : 'decode', label,
      loadedBytes: downloadedBytes, totalBytes, completed: complete, total: models.length });
  };
  try {
    // Decoder preload overlaps the manifest and model requests. GLTFLoader then
    // reuses the one decoder rather than fetching a decoder for every model.
    draco.preload();
    const response = await fetchImpl(base + 'models/runtime/manifest.json', { signal: controller.signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`Не удалось загрузить список моделей (${response.status})`);
    const manifest = await response.json();
    const sizes = new Map(manifest.models.map(model => [model.id, model.outputBytes]));
    const versions = new Map(manifest.models.map(model => [model.id, model.outputSHA256.slice(0, 12)]));
    for (const model of models) {
      if (!sizes.has(model.id)) throw new Error(`Модель ${model.id} отсутствует в сборке`);
      totalBytes += sizes.get(model.id);
    }
    report('Загрузка моделей', true);
    const jobs = models.map(model => download(async () => {
      const fetchStarted = performance.now();
      const buffer = await fetchModelBytes(base + runtimeAssetPath(model) + '?v=' + versions.get(model.id), {
        signal: controller.signal, fetchImpl,
        onBytes: bytes => { downloadedBytes += bytes; report(model.label); },
      });
      records.set(model.id, { id: model.id, bytes: buffer.byteLength,
        fetchMilliseconds: Math.round(performance.now() - fetchStarted) });
      return buffer;
    }).then(buffer => decode(async () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      const decodeStarted = performance.now();
      const gltf = await loader.parseAsync(buffer, base + 'models/runtime/');
      gltf.scene.traverse(object => {
        if (!object.isMesh) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value?.isTexture) {
            value.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            value.minFilter = THREE.LinearMipmapLinearFilter; value.magFilter = THREE.LinearFilter;
            value.generateMipmaps = true;
          }
        }
      });
      assets.set(model.id, gltf.scene); complete++;
      records.get(model.id).decodeMilliseconds = Math.round(performance.now() - decodeStarted);
      report(`Подготовлено моделей: ${complete} / ${models.length}`, true);
    })).catch(error => { controller.abort(error); throw error; }));
    const results = await Promise.allSettled(jobs);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    return { assets, profile: { modelBytes: downloadedBytes, expectedModelBytes: totalBytes,
      modelCount: models.length, assetsMilliseconds: Math.round(performance.now() - started),
      networkConcurrency: 4, decodeConcurrency: 2, models: [...records.values()] } };
  } finally { draco.dispose(); }
}
