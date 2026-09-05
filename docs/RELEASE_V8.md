# V8 — five introductory physics / portal courses

Base: `e7932259b672e13d08c8b1c4b5be1fd2725dd82f`. Same game, renderer, physics, supplied character and original models. All three V7 layouts are replaced in the active campaign, not added to a cluttered first room.

## Actual progression
1. **Первая связь** — six dependencies only: player, companion, device, walkable floor slabs, portal wall tile and safety rail. A gap needs two linked portals. No lift, pressure switches, furniture, terminals or counterweight puzzle.
2. **Падение — это скорость** — the existing ramp is a means of gaining drop height. Falling through the floor portal becomes horizontal flight; no launch-pad impulse or prescribed success teleport.
3. **Лифт гравитации** — a vertical well, a loaded lift, an upper drop and a higher arrival balcony. The lift has one visible original deck, a hidden kinematic support and a shallow recoverable socket. Physics and render interpolation are separate.
4. **Обратный вес** — a bridge and an actual resting 3.2 kg companion load on the pressure surface. Dampened counterweight response, safe occupied-deck hold, and portal retrieval from the other bank. The counterweight remains a physical obstacle; the landing has space to walk around its mechanism. Rail gaps admit portal rays using actual mesh geometry, while bodies use a thin continuous safety collider.
5. **Поворот импульса** — a transverse control room and L-shaped workshop, lift/drop reuse and a new tilting exit panel. The terminal rotates the real plate and the attached portal; launch direction changes, not speed magnitude. The unsolved horizontal exit does not supply the required upward component.

Levels are individual definitions rather than 100 empty entries. Future levels can extend the array without adding unrelated objects to early rooms. Different material palettes, dimensions, routes and sightlines; no flat all-white room shells. Source floor slabs are instanced. Smooth pale ceramic with a bronze rim is portalable; ribbed dark construction, rails, ramps and lift are not. The collision/placement flags use the same distinction.

## Character and sound
The supplied mesh now has a separate chest joint: shoulder counter-rotation, pelvis weight transfer, relaxed asymmetrical arm swing, elbow follow-through and existing foot / two-hand contact. Upper rear pack and lower jacket docking zones retain coherent weights. This remains calibrated procedural skinning, not a new mocap library. Existing gaze / companion reactions are retained.

Original Web Audio synthesis supplies footsteps, landing/contact noise, two portal-placement sweeps, transport, pickup, switch, lift/bridge motors and completion tones. No Valve/Portal recordings or melodies are copied. Master volume, mute and graphics presets persist locally. Menu, focus and advertisement pause reasons compose instead of unmuting one another.

## Advertising implementation and policy
Official sources checked 2026-09-05:
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-adv
- https://yandex.ru/dev/games/doc/ru/concepts/requirements (page update: 2026-08-18)
- https://yandex.ru/dev/games/doc/ru/sdk/sdk-about

Basic rules and tutorial are free. All five routes are completable without a paid/rewarded hint. Each level has three progressively explicit solution hints. An explicit button describes both advertisement and reward. A hint unlock is granted ONLY in `onRewarded`, once; unlocked text persists and can be reread without another ad. An error/no fill/early close grants nothing and never blocks continuing play.

Yandex controls fullscreen frequency; its documentation does not give a universal forced interval. Our additional comfort policy is a 120-second initial / level-transition separation, 300 seconds between a shown fullscreen and a restart fullscreen, and 90 seconds after any shown ad. Ad requests happen only after an explicit Next level / Change level / Restart action, never during play via a timer. Platform throttling may skip the request. Concurrent requests and duplicate callbacks are guarded. Gameplay/input/audio pause during an actual ad.

GitHub Pages is an advertisement-free development preview: hints are explicitly free here, not simulated advertisement views. `YANDEX_BUILD=1 npm run build` initializes `/sdk.js` for a Yandex-hosted archive, calls LoadingAPI / GameplayAPI, and uses the official ad API. Live ad inventory and review approval require testing in the user's Yandex draft; callback mocks do NOT prove real ad delivery. This development demo is not claimed to be a finished, approved 100-level release.

## Verification
`npm test`; `node scripts/v8-journey.mjs`; `npm run build`; `node scripts/v8-browser.mjs` in Chromium.
The five route scripts use normal movement, real raycast shots and pickup on actual decoded model geometry, not actor-position fixtures or scripted win state. They check same companion/body, no resets and preserved portal speed. Runtime WebGL checks also exercise actual level/settings controls, lazy initial assets, persisted sound/quality and preview hint unlocks. CI software rendering is not a user GPU FPS measurement. Rendered screenshots and route reports are workflow artifacts; don't replace them with concept art.
