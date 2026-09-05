# Active model manifest

## Scope

The active lab ships 19 models. Player 01, cargo 02, and portal gun 11 keep their original GLB bytes. Old environment models 03–10 and their old thumbnails are removed from the active tree; they remain recoverable through Git history. Environment models use stable IDs 12–27 in `src/game/labAssets.js`.

The user-uploaded originals are unchanged. The new runtime environment copies use normal- and UV-aware Meshoptimizer simplification, locked topological borders, a 0.004 appearance-error bound, and Draco encoding (position 16 bits, normal 12 bits, UV 14 bits). All embedded base-color, normal and material texture image bytes are preserved, verified by SHA-256 before/after processing. No texture baking, atlas replacement or hole-filling was applied.

The 11 source environment models contain 8,245,912 triangles. Runtime copies contain 567,168 triangles, a 93.1% reduction, with 5.21 MiB total GLB payload. The detailed launch pad deliberately stops above the target count to preserve its boundaries and appearance. Instance geometry should be shared when an asset repeats.

## Active assets

| ID | Object | Runtime file | Triangles | MiB |
|---:|---|---|---:|---:|
| 01 | Player (unchanged source) | `model-01-player.glb` | — | — |
| 02 | Brainrot cargo (unchanged source) | `model-02-cargo.glb` | — | — |
| 11 | Portal gun (unchanged source) | `model-11-portal-gun.glb` | — | — |
| 12 | Рояль со стулом | `model-12-grand-piano.glb` | 37496 | 0.33 |
| 13 | Офисное кресло | `model-13-office-chair.glb` | 37500 | 0.46 |
| 14 | Круглый стол | `model-14-round-table.glb` | 37500 | 0.27 |
| 15 | Кружка | `model-15-mug.glb` | 37500 | 0.24 |
| 16 | Портальная панель | `model-16-phase-wall.glb` | 46232 | 0.46 |
| 17 | Дверь лаборатории | `model-17-lab-door.glb` | 65336 | 0.59 |
| 18 | Нажимная кнопка | `model-18-pressure-pad.glb` | 62804 | 0.56 |
| 19 | Подъёмная платформа | `model-19-lift-platform.glb` | 52956 | 0.48 |
| 20 | Энергетический барьер | `model-20-energy-barrier.glb` | 37500 | 0.43 |
| 21 | Импульсная площадка | `model-21-launch-pad.glb` | 105014 | 0.92 |
| 22 | Терминал | `model-22-terminal.glb` | 47330 | 0.47 |

## Upload provenance

| ID | Original uploaded filename | SHA-256 of original |
|---:|---|---|
| 12 | `f8d1c74b83699208cca9d614fd0f2ffc-optimized.glb` | `c95d62bb0657991eab6abd00b16b8eb497800d19f0e5de901d85928e8f244693` |
| 13 | `44ece7c59fec856bdfcd9a2377513010-optimized.glb` | `f88a606c0bfd1016f088a017fca43d34b17fec0dda7e8baa9e17d5b51aadd7ee` |
| 14 | `32a98635a664a02bcf783ebe5b4eaaeb-optimized.glb` | `8546e8f6bb658a0a264dc4ef86455b95564b635ff88b37a4d836fa25d5a80f7c` |
| 15 | `b7f998f8cbe9e028777649587a3d2609-optimized.glb` | `a1b9beb378a49a079a9058e1d8df8a547c6f2451df3787550ea8baceb2275b2d` |
| 16 | `eb650579249862cad91466af428cf3ce-optimized(1).glb` | `1afe120c9bfacce211f61271ba5d13f90073b8c6ce02afc3af3eef278dd97ca1` |
| 17 | `c3cb46ea8988bf881708c8d28bca0f3f-optimized(1).glb` | `6f60b4b58b5fdbf7064f739836b3ec14fd771facaa258258019eb54698115098` |
| 18 | `72c58ff9d5e99e39f937e70d93a4c932-optimized(1).glb` | `e3a81d8906ae90dfe817435882f8a2bb2ec6ebfb8a8c5811ec47a76d6fe08245` |
| 19 | `55c4fe0c5a524681b805c2f788dcda83-optimized(1).glb` | `32c2fcda21080a881ec20565e33efd305e4bc85f5b4bc70cb79f3b692dadc4a1` |
| 20 | `8e5298df19d2b4296c9c6f2bdf46622e-optimized(1).glb` | `3a4f8bbd7f31613e9f9383f39cc6211efe78d58d95d0daddb585abe5288c4a22` |
| 21 | `fce4f07188eff73c2d94c23f9facf02e-optimized(1).glb` | `4242c2246e51bc8b122ad00292f7397a519f4f2b04b6d567c0f8aa784b31593c` |
| 22 | `0c2933409300b209c72eba89cd0f5524-optimized(2).glb` | `0e3ff4f62e6816b66c1ede5479daed74b7dce1ebbfd5ed495912559f052c2e5a` |

## Runtime checksums

| ID | SHA-256 of runtime GLB |
|---:|---|
| 12 | `e27cfec41b7744c9b88f70af0d7e7bfb35fdbaa62d28b0567358856c7e820962` |
| 13 | `3631ae9f232eff3967de5f4d883a3a13bd07f0f53b89d3ee5fc3d4601e08cb71` |
| 14 | `58dc2e9215795945fd951d46e0da81d6fd8eeacb7371df428d6ed3a75097c5b6` |
| 15 | `be6d7ac76d7c7a120e9e303e2a710a324861846fe6f555165cb536d7bc98600f` |
| 16 | `aedc5a0becc3c3dc3fff3441675ab0d47da57c754a0f921cad30ae46a57aa330` |
| 17 | `0fd22a882de66937d1160f6d3eb9446542f941028a33b9520bd1fcd99267ecef` |
| 18 | `b9e51569c3ace74015393947e680f344ff9e8676cacde59bc5d4bd6be58b8dd1` |
| 19 | `c5f0160e8099dbdb90f1e37701edfd2f7014fee8cb431b70ee1d17ec637e99f4` |
| 20 | `0895ceae40807461bc86269d0363a5c67811f9b55cb0ec76663a178d4691df25` |
| 21 | `93000d90f8acfb9c04386902c583e358e9e30725e19a9cc0dd76754dd69b57c4` |
| 22 | `1f9228858cc962724de69472d17711cfbf260b0f3932ea10d74f419a50627777` |

## Visual review

Each source and runtime version was rendered at 768×768 from the same elevated three-quarter camera with its complete mesh and per-pixel base-color texture sampling. Source and runtime silhouettes were inspected side by side. The first position-only simplification trial produced shading creases in broad white panels; it was rejected and replaced by normal/UV-aware simplification.

The images in `public/model-screens/model-12.png` through `model-22.png` show the final runtime models. They are 3D renders, not generated concept art. `public/gallery.html` provides individual full-size image links; `public/model-screens/model-catalog.png` contains all 14 current assets. Asset 20 has a central dark opening in the uploaded mesh itself; it is present in both source and runtime renders.

## New structural modules — IDs 23–27

These five models are byte-identical copies of the latest user uploads. Their source GLBs, UVs, texture image bytes and topology are preserved. Each source is a single static mesh with no skin or authored animations. The source node applies an X-axis quarter turn: after loading they are already Y-up. Ramps rise toward local −Z. The 25 ramp has a lip at its high end; the 27 ramp is the continuous walking/cargo surface.

| ID | Object | Runtime file | Source triangles | MiB | Source = runtime SHA-256 |
|---:|---|---|---:|---:|---|
| 23 | Напольная плита | `model-23-floor-tile.glb` | 750,000 | 1.72 | `50bd0401d3b78c6f255e0675f03162326307d720b3d0de9f902b323930e86db1` |
| 24 | Стенная панель | `model-24-wall-panel.glb` | 749,984 | 1.74 | `d2749e11a94f444e4334dafc1606b0bf2e1be06d93ccb2a3505a5a562e23b419` |
| 25 | Пандус с бортиком | `model-25-ramp-lipped.glb` | 750,050 | 1.97 | `aee3afcc88b9e3425e04c4cc115cf2133f51afcf186abd0c2e4fe312d8cddcba` |
| 26 | Секция перил | `model-26-railing.glb` | 750,000 | 1.66 | `343b8eb3caf96cfd126a0dedccea3e91f1dcf65cb75f4f1b82e562e248235bb6` |
| 27 | Широкий пандус | `model-27-ramp-wide.glb` | 750,000 | 1.93 | `aa14cb98882852cab7fa39a2787c5b8e32c4ee0a0f2bf8461750fddb0d8e9743` |

Rendered separately from the actual GLB in Three.js at 768×768: `public/model-screens/model-23.png` through `model-27.png`. The source railing includes a small red fragment below the rail, which is preserved. These scans contain unusually high face counts for flat structural pieces; repeated instancing should share geometry and use a reviewed runtime LOD before mass placement.
