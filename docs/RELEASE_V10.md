# V10 repair release — five active courses

Base: 81697d727f827308892a67bb5ac464d7d8bca4ec (V9). Publication is confirmed only when Pages verifies the exact deployed commit and v10-repair version.

## Changes
- Fix portal placement on an already tilted plate. Exemption is limited to that plate's registered supporting collision proxy with a matching surface normal and plane. Real nearby blockers still reject placement.
- Move the fifth-level island and exit mechanism six metres sideways. The source-to-island clear gap is now 8.8 m. No hidden completion flags forbid legitimate physical solutions.
- Move the third-level exit section farther from its starting balcony to remove the corresponding short-jump risk.
- Seal the second-level door lintel to the tiled ceiling.
- Replace the inaccessible top-right question-mark button with the current level number. Hints remain in the Esc pause menu. Level counts in menu/test loops use the actual campaign array.
- Add subtle high-speed flight bracing to the existing player chest/arm motion, and fin/foot/tail bracing to the carried brainrot. Preserve the liked rig, gaze and original meshes.
- Prioritize putting down a carried friend and picking up the nearest friend over activating a nearby terminal. All pickup line-of-sight checks remain active.

## Executed verification
Successful dedicated CI: https://github.com/amazin20/nesi-brainrot/actions/runs/33982836488
Verified gameplay commit: f58430ac2891cdfcb5fc7da6e39f414d77a1692e.

- 240 unit tests pass.
- All five original-model physical journeys pass in Node and in production Chromium, with zero respawns and zero cargo resets. The fifth-level route explicitly shoots the exit again AFTER the panel has tilted.
- Unit tests check five panel angles and confirm an added real obstacle still blocks the shot.
- 180 adversarial jump trials across the five courses find zero bypasses. Baseline restores the exact original V9 level-five geometry and reproduces the reported bypass in all 36 trials.
- Browser checks confirm level-number text, removal of quick-hint, real menu/next buttons, graphics/audio/persistence and no page errors.
- Yandex callback-contract stub passes. This is not actual advertising inventory, revenue or approval.
- Rendered starting views and walking frames are preserved in the v10-repair-evidence artifact. They are real production renders, not concept art.

The shortcut audit uses production jump, sprint, collision and airborne steering with adversarial starting positions at reachable edges. Fixtures include carried/unladen speeds and a conservative extra 0.9 m stacking-height allowance. They are NOT used in the positive completion routes. This is a bounded regression audit, not a proof over every conceivable strategy. Software-rendered CI does not benchmark a player's device.

## New levels are NOT in this release
Two larger multistage courses were prototyped and passed local physical route checks, but the connector blocked transferring their new mechanism module. That operation was not rerouted. They are NOT present in this repository revision or its browser package; the active campaign still has FIVE courses. Their browser verification and publication remain unfinished. Do not label this revision as a seven-level release.
