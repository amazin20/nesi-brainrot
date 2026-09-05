# NESI current work — V8

- Source: `amazin20/nesi-brainrot`, base main `e7932259`. Working branch `feature/tiled-physics-five-v8`.
- Five new independent tiled portal-physics courses, progressively introduced mechanics, original model/rig cache retained.
- Entry: `src/main.js` → `LabGame` → `LabCampaignLevels`; old `LabFirstLevel`/V7 evidence are historical fixtures, not the active campaign.
- Scope and honest limits: `docs/RELEASE_V8.md`; 100-level roadmap: `docs/CAMPAIGN_DESIGN_V8.md`.
- Validation: `npm run check`; `node scripts/v8-journey.mjs`; `node scripts/v8-package-check.mjs`; Chromium `scripts/v8-browser.mjs` and `scripts/v8-yandex-browser.mjs` (SDK stub, not real ad fill).
- GitHub demo: normal build, free hints, no pretend adverts. Yandex build: `npm run build -- --mode yandex --outDir dist-yandex`.
- Hosting remains GitHub Pages. Production only after CI and inspection; do not replace missing proof with concept images.
- Full level selection and restart, no progress checkpoints. No automatic later work or hourly results promised.
