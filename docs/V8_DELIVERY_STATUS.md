# V8 delivery status

The source in this branch contains five rebuilt tiled courses, not a patch installer. Temporary encoded transport files and their workflow have been removed.

## Verified
- Current local revision: 233 unit tests pass; all five complete input-driven physical journeys pass, zero respawns and cargo resets.
- Earlier revision, GitHub Actions run 33950953326: 231 tests and all five full Chromium/WebGL journeys passed; lazy loading, graphics, sound, persistence and menu checks passed.
- The same run exposed a rewarded-hint UI failure in the SDK contract stub. It did not pass the complete job. Subsequent code fixes add idempotent forced pause and independent ad request locks, with two new passing unit tests.

## Not verified / not published
- Final browser re-run of those follow-up changes has NOT completed.
- The SDK contract test is a stub, never a real advertisement or revenue check.
- Updating the verification/deployment workflows was blocked by the connector. Do not bypass that restriction. Legacy V7 workflows still reference the old campaign and must not be treated as V8 validation.
- Main and GitHub Pages have NOT been updated by this delivery. Do not merge this branch or describe the public V7 URL as a V8 demo without final verification and an authorised deployment workflow.

The downloadable local browser package and Yandex-mode package are release candidates. Actual pre-follow-up rendered frames are clearly labelled as such. No screenshots from concept generation are used as test evidence.
