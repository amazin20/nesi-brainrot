# V8 — first five physical portal lessons

Based on `main e7932259`, in `feature/tiled-physics-five-v8`. This is the same Three.js/cannon-es project with the original approved player, companion and device assets. All five playable layouts replace the V7 layouts; the old source modules remain for independent regression fixtures only.

## Implemented
- Tile shell with instanced dark structural modules and authored ivory portal-compatible tiles. Invisible continuous support closes seams. Only the visible ivory inset is registered for portal placement; arbitrary dark walls never accept a portal.
- 01 Two banks: safe paired passage, no switches, lifts, furniture or mandatory carrying.
- 02 Return path: a live-weight door, a floor portal prepared under the companion, a turn hiding the receiver until the player reaches it. The same companion is retrieved; the switch releases and the door closes.
- 03 Falling is acceleration: recoverable high balcony, floor-to-wall momentum transformation, separate landing island. No scripted fling velocity or booster is added.
- 04 Moving address: a visible terminal drives a lift; the same portal stays anchored to its rising tile. Stable endpoint poses eliminate a time-pressure requirement.
- 05 Angle matters: an actual articulated imported panel changes the exit direction; gravity, initial motion and panel angle determine the flight to a higher island.
- No checkpoints. Explicit restart resets the whole current level, not partial mechanisms. Goal requires a grounded player and the same nearby companion.
- Lift has one visible authored deck, one invisible proxy and one interpolation transform. The previous coincident visible proxy was removed.
- Tilted-panel front-plane rejection prevents a world AABB from falsely hitting a traveller in empty air. Edge/frame colliders remain; the moving panel is explicitly associated with its portal surface.
- Air movement is acceleration, not automatic horizontal velocity damping. Existing 100-repeat reverse-portal regressions remain.
- Walk: heel/sole/toe articulation, asymmetric swing lift, stronger contralateral pelvis/shoulder motion and delayed elbow follow-through. Gun support and exact two-hand cargo contact remain; source silhouette, skin seams and texture data are retained.
- Five-level selector in start and pause/settings. Saved low/balanced/high quality, volume, mute, tutorial choice, completed levels and unlocked hints.
- Original synthesised footsteps, landing, resonant portal passages, switches, quiet room tone and lift motor. No copied Portal/Valve audio. Sound and input stop under focus loss, pause and ad/SDK locks.
- Runtime package uses 9 models total. Initial course fetches only 4, later courses fetch missing dependencies and reuse the cache. Unused furniture, ornaments and unintroduced mechanisms are not shipped or placed.

## Monetisation
The normal GitHub build is explicitly an ad-free demo; its hints are free. `vite build --mode yandex --outDir dist-yandex` dynamically requests `/sdk.js` and uses the official Yandex Games SDK. No SDK binary is bundled.

Interstitial requests occur only at explicit next/selected-level menu transitions. Explicit restart requests are at least five minutes after the session start / last shown ad / last restart request. Automatic failure recovery never triggers an ad. Actual fullscreen availability/frequency remains the platform's decision. The game never waits for an unavailable interstitial to let the player restart.

Hint opening requires an explicit, labelled rewarded-video button. Only `onRewarded` grants one next tier; repeated callbacks cannot duplicate a grant, close/error without a reward cannot unlock it. Unlocked hints can be reread freely. Controls and new rules are taught free, puzzles are not deliberately made unfair to force advertising.

## Verification
Local: `npm test` 233 tests, `node scripts/v8-journey.mjs` all five full routes. Routes drive movement, normal pickup, aim/raycast placement and terminals. No route assigns actor positions, portal positions, velocity boosts, mechanism target values or victory flags. All five finish with zero respawns / cargo resets and preserve the companion body identity within each route.

The first Chromium pass verified all five routes, settings, sound and persistence; it exposed a duplicate-pause hint-menu issue, now covered by a regression test. The final revision must pass CI before release. `v8-browser.mjs` saves stills and a production walk frame sequence. `v8-yandex-browser.mjs` uses an explicitly labelled SDK contract stub, not a real ad network. Its final results must be checked in the CI artifact before claiming browser success.

Known limits: procedural animation, not a motion-capture library; no measurement of the user's actual GPU FPS; 100 levels is a roadmap, not implemented content; live Yandex ad fill, account monetisation and platform moderation require the platform environment and are not claimed from the stub. Architecture-only overview screenshots move the camera deliberately and are not route evidence.

Official sources checked 2026-09-05:
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-about
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-events
