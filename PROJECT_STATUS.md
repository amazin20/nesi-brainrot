# NESI — active V8 work

- Repository: `amazin20/nesi-brainrot`; base main `e7932259b672e13d08c8b1c4b5be1fd2725dd82f`.
- Vite / Three.js / cannon-es; active game `src/main.js` → `LabGame` → `LabCampaignV8`.
- Five new layouts; none of the three V7 layouts is the active first course.
- Shared source GLBs preserved; 12 useful campaign assets packaged, only 6 loaded in tutorial; lazy new-mechanic loading.
- Implementation and limits: `docs/RELEASE_V8.md`; model requests / 100-course direction: `docs/NEXT_MODELS_V8.md`.
- `npm test`, `npm run build`, `node scripts/v8-journey.mjs`, `node scripts/v8-browser.mjs`.
- GitHub Pages is the only demo host: https://amazin20.github.io/nesi-brainrot/
- `npm run build:yandex` emits a separate `/sdk.js`-enabled upload build. Real advertisement availability must be checked in the Yandex draft. GitHub preview hints are explicitly free.
- No device FPS or professionally authored mocap quality claim. No concept image is a gameplay screenshot.
