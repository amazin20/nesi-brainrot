import { defineConfig } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_LEVEL_ASSETS } from './src/game/labAssets.js';

const root = path.dirname(fileURLToPath(import.meta.url));

// The repository keeps source models and its separate reference galleries.
// A playable production build ships only the first level's declared assets.
function levelAssetBundle() {
  let outDir;
  return {
    name: 'nesi-level-assets', apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    async writeBundle() {
      const runtimeDir = path.join(root, 'public/models/runtime');
      const manifest = JSON.parse(await fs.readFile(path.join(runtimeDir, 'manifest.json'), 'utf8'));
      const selected = new Set(FIRST_LEVEL_ASSETS.map(asset => asset.id));
      const models = manifest.models.filter(model => selected.has(model.id));
      if (models.length !== selected.size) throw new Error('Runtime asset manifest is incomplete for level 1.');
      await fs.mkdir(path.join(outDir, 'models/runtime'), { recursive: true });
      await fs.mkdir(path.join(outDir, 'draco'), { recursive: true });
      await Promise.all(models.map(model => fs.copyFile(path.join(runtimeDir, model.filename), path.join(outDir, 'models/runtime', model.filename))));
      const compactManifest = {
        version: 6, totalBytes: models.reduce((sum, model) => sum + model.outputBytes, 0),
        totalTriangles: models.reduce((sum, model) => sum + model.triangles, 0),
        models: models.map(({ id, filename, outputBytes, outputSHA256, triangles }) => ({ id, filename, outputBytes, outputSHA256, triangles })),
      };
      await fs.writeFile(path.join(outDir, 'models/runtime/manifest.json'), JSON.stringify(compactManifest));
      await Promise.all(['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js'].map(file =>
        fs.copyFile(path.join(root, 'public/draco', file), path.join(outDir, 'draco', file))));
      async function filesIn(directory) {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        return (await Promise.all(entries.map(entry => entry.isDirectory() ? filesIn(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
      }
      const files = await filesIn(outDir);
      const stat = await Promise.all(files.map(async file => ({ file: path.relative(outDir, file), bytes: (await fs.stat(file)).size })));
      const packageBytes = stat.reduce((sum, file) => sum + file.bytes, 0);
      const normalStartup = stat.filter(file => !file.file.endsWith('draco_decoder.js') && !file.file.includes('LabEvidence-'));
      const normalStartupBytes = normalStartup.reduce((sum, file) => sum + file.bytes, 0);
      console.log(`Level 1: ${models.length} models, ${(compactManifest.totalBytes / 1e6).toFixed(2)} MB models; ${(normalStartupBytes / 1e6).toFixed(2)} MB startup before HTTP compression; ${(packageBytes / 1e6).toFixed(2)} MB complete package.`);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [levelAssetBundle()],
  build: {
    target: 'es2022',
    sourcemap: false,
    copyPublicDir: false,
  },
});
