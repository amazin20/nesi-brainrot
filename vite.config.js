import { defineConfig } from 'vite';

export default defineConfig({
  base: '/nesi-brainrot/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
