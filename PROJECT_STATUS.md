# NESI — current work

- Source repository: `amazin20/nesi-brainrot` (renamed from `pronesi-eto-physics-lab`).
- Release: character life v5, based on `animation-v4` plus preserved uncommitted fixes; published from `main`.
- Current implementation and validation: [Character life v5](docs/CHARACTER_FEEL_V5.md).
- Real-model simulation report: [continuous-journey.json](qa/continuous-journey.json).
- Main game: Vite / Three.js / cannon-es, entry `src/main.js` → `LabGame`.
- Gallery: `public/gallery.html`; separate model concepts: `public/concepts.html`.
- Hosting: GitHub Pages only, per user request. Live demo: https://amazin20.github.io/nesi-brainrot/
- Deployment: `.github/workflows/deploy-pages.yml`, on push to `main`; `dist/` is built on GitHub. Do not switch hosting providers.
- `npm test`; `node scripts/lab-journey.mjs`; `npm run build`.
- No local browser rendering / video / device FPS verification is claimed for v5.
