# Five-level release candidate: V9

Continues the real five-course source from feature/tiled-physics-five-v8. The old public V7 build is not this release. Deployment is only confirmed after the Pages workflow verifies its public build-info.json.

## Gameplay and appearance
- All five progressive courses from LabCampaignLevels are active: Два берега, Обратный путь, Падение — это разгон, Подвижный адрес, Угол решает. Each uses actual portal traversal/physics rather than scripted success positioning.
- Modular graphite structure and contrasting pale framed portal surfaces, full tiled ceilings, lighting trays and neutral industrial finishes. Each chamber has its own palette and spatial route.
- New independent rib-cage bone on the supplied character; counter-rotation between pelvis and shoulders, stabilised head, soft torso balance and breathing. Existing step/contact, pickup, drop, jump and companion gaze are retained.
- Original mesh positions, normals, UVs, texture materials and bind silhouette are preserved. Rear pack follows the chest rigidly; lower device docking area stays on the pelvis. World-space arm contact is solved in the new shoulder-parent frame.
- Graphics presets, volume/mute, five-level selector and optional hints persist. Sound is original synthesis, not copied Portal recordings.

## Verification
The previous gameplay revision 6fbd52ecd88ed053739ac75b8f7bd8cb7d2a86e8 passed the complete GitHub run 33955939128, including five Chromium routes and the real hint-button flow against an advertising SDK stub. The stub verifies callback contracts, not real advertisement inventory or approval.

The new rib-cage and architecture changes pass local animation/source-geometry/contact regressions and five original-model routes. The new commit must also pass both browser scripts before publication. The production deployment workflow repeats tests and rejects publication if a stage fails.

## Newly uploaded models — not claimed as installed
Seven new source GLBs have been inspected locally: seesaw, cable spool, spring launcher, energy relay, glass partition, extendable bridge and fan. They are static meshes without animation clips. Their original binary files have NOT yet been transferred to the repository or added to the playable package in this revision. Do not claim otherwise or substitute procedural shapes for the supplied meshes. Their integration must be a separately verified change and must not delay publishing the existing playable five-level campaign indefinitely.

Five levels are implemented, not 100. Animation remains calibrated procedural skinning. Software-rendered CI frame rates do not measure a player's device; no universal 60 FPS claim is made. All levels are solvable without watching a hint advert; basic teaching is free.
