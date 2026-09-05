# V7: continuous campaign and portal regression repair

Base: main f7a82c332d5f20dd96ec05283997da3513e1ab69. Same game and uploaded models, not a new project.

## Implemented
- Swept portal crossings no longer lose a valid quick reverse crossing during an arbitrary cooldown. Remaining launcher impulse rotates into the exit frame as well as immediate velocity. Regression: baseline fails launch-vector and sub-70 ms return tests; patched code passes both plus 100 sprint reversals.
- Three selectable, separate courses: original Bridge for Two, new Quiet Atrium (two independent live-weight circuits and an L-shaped route), and new Upper Workshop (automatic loaded lift and upper-floor retrieval).
- Full level restart rather than implicit progress checkpoints. No replacement companion along any recorded route.
- Unified architectural aperture, visible frame and collision bounds. Hinged two-leaf doors, restrained translucent field, full-height connecting wall and overlapping construction joints. Obsolete decorative assets 17/20 remain in source but are not loaded in the playable game.
- Real frame-time ring buffer: FPS, mean milliseconds, p99 and 1% low; user-controlled render quality. Moving proxies retain their geometry instead of allocating/discarding it at physics frequency.
- Stronger continuous weight transfer, relaxed free-hand swing, bounded device-arm motion, sparse hand fidgets and shared idle reactions, with the existing source player silhouette and hand/foot-contact constraints retained.
- No wall labels or persistent top/center prose. Optional action-completed lessons appear at the bottom; pause controls permit disabling them.
- Shared GLB cache retained across level changes, generated resources disposed, scene/collider accumulation checks.

## Verification and honest limits
`npm run check`: 214 passing tests. `node scripts/lab-journey.mjs`: original course plus real-model physics/rig checks. `node scripts/v7-journey.mjs`: both new courses with real mesh geometry, production movement/interact controls and raycast portal placement; no route player-position fixtures, respawns or cargo resets.

`scripts/v7-browser.mjs` runs the same new-course journeys in production Chromium, checks visible UI and actual menu/next buttons, and records stills. Architecture-only stills explicitly change the camera; they are not claimed as route evidence. CI SwiftShader timing is NOT a measurement of a user's GPU/device FPS. Browser results are in the workflow artifact, not assumed from unit-test success.

Animation remains calibrated procedural skinning on the supplied model, not a newly authored motion-capture library. The loading package still has a large Three/Cannon JavaScript chunk; no claim of eliminating all performance bottlenecks.
