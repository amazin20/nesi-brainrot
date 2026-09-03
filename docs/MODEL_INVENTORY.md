# Model inventory — Неси Брейнрот

The playable demo currently ships 10 GLB assets from `public/models/`. They are loaded by `src/game/Game.js` through `GLTFLoader` + `DRACOLoader`.

| # | File | Runtime role | Size |
|---|---|---|---:|
| 1 | `model-01-player.glb` | Player character | 2.56 MiB |
| 2 | `model-02-cargo.glb` | Carried brainrot / cargo | 2.56 MiB |
| 3 | `model-03-swing-hammer.glb` | Swinging hammer obstacle | 2.26 MiB |
| 4 | `model-04-bounce-block.glb` | Bounce / jump block | 2.25 MiB |
| 5 | `model-05-checkpoint.glb` | Checkpoint gate | 2.16 MiB |
| 6 | `model-06-finish-flag.glb` | Finish flag | 2.07 MiB |
| 7 | `model-07-spin-hammer.glb` | Spinning hammer obstacle | 2.24 MiB |
| 8 | `model-08-roller.glb` | Roller obstacle | 2.20 MiB |
| 9 | `model-09-hurdles.glb` | Hurdle obstacle set | 2.14 MiB |
| 10 | `model-10-platform.glb` | Decorative / course platform | 2.55 MiB |

Total GLB payload in the repository is about **22.99 MiB** before transport compression.

## Demo runtime coverage

The demo level uses all ten asset slots. The browser smoke workflow verifies that every GLB is served by the production preview and that the runtime creates the level, player, cargo, finish, checkpoints, hazards and bounce objects before marking the demo as healthy.
