# NESI — current work

- Repository: `amazin20/nesi-brainrot`; Vite / Three.js / cannon-es; `src/main.js` → `LabGame`.
- V7 branch: `fix/portal-life-levels-v7`, based on main `f7a82c3`.
- Release specification and limits: [RELEASE_V7.md](docs/RELEASE_V7.md).
- Three independent playable courses; index `?level=1`, `?level=2`, `?level=3`.
- 214 unit tests; original and new continuous real-model route harnesses; browser smoke with actual level menu/next buttons.
- Source assets retained; runtime dependency list now 16 models.
- Live hosting remains GitHub Pages only: https://amazin20.github.io/nesi-brainrot/
- Deployment: `.github/workflows/deploy-pages.yml` after push to main. Never identify an unverified branch as the live published version.
- Commands: `npm run check`; `node scripts/lab-journey.mjs`; `node scripts/v7-journey.mjs`; CI Chromium `node scripts/v7-browser.mjs`.
