import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/nesi-brainrot/',
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        freshLevel: resolve(process.cwd(), 'fresh-level.html'),
      },
    },
  },
});
