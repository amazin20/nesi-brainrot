# NESI — current work

- Repository: amazin20/nesi-brainrot. Vite, Three.js, cannon-es. Entry: src/main.js → LabGame → LabCampaignLevels.
- V10 repair source continues V9. Exact scope and evidence: docs/RELEASE_V10.md.
- Five active levels. Fixed level-five direct-jump bypass and tilted-panel placement; corresponding level-three spacing repaired. No hidden mechanism-use win flags.
- Current level number replaces the top-right question mark; hints live in Esc pause menu.
- Player/brainrot high-speed flight reactions retain the existing models and contact safeguards.
- Dedicated CI 33982836488 passed 240 tests, all five Node and Chromium routes, 180 jump trials and SDK contract checks. Exact original baseline reproduces the reported bypass in 36 of 36 trials.
- Pending: two advanced local prototypes were not transferred because the new mechanism-module write was blocked. They are NOT published. Seven previously supplied extra GLBs also remain unintegrated.
- Verification: npm run check; node scripts/v8-journey.mjs; node scripts/v10-shortcuts.mjs; CI browser scripts v8-browser.mjs and v8-yandex-browser.mjs.
- Live demo: https://amazin20.github.io/nesi-brainrot/ . Never call a revision live until deploy-pages.yml confirms its public build-info.json.
