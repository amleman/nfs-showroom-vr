# NFS Showroom VR

A WebXR car showroom for the Meta Quest 3, built on Meta's Immersive Web SDK.
You stand in an industrial garage inspired by the *Need for Speed: Most Wanted*
(2005) safehouse, with one car lit on a turntable. You can swap through the
collection from spatial panels, open the doors, and climb into the driver's
seat.

> **Status: complete as an experiment.** This was built to find the edges of
> IWSDK — how far a WebXR app can be pushed before a standalone headset gives
> up, and how much of that work can be driven by a coding agent. Both questions
> got answered, so it stops here. It runs, and the interesting parts are written
> down rather than left implicit; several planned features were deliberately not
> built (see [What is not here](#what-is-not-here)).

## What it does

- **Car carousel** — eight vehicles on a lit display dais. Models load on demand
  and residency is bounded, so at most two cars are ever on the GPU.
- **Sit in the car** — press B and you are behind the wheel. Locomotion locks so
  you stay put and look around with your head; press B again to get out.
- **Auto-fit** — the models are third-party downloads that agree on nothing: one
  is 40 m long, one arrives lying on its back, several ship a "ground plane"
  that fights the garage floor, and several more hide the author's signature as
  a zero-height decal beside the car. Each is measured and corrected at load, so
  all eight end up 4.60 m long and centred.
- **Turntable** — the dais and the car turn together through one slow revolution.
- **Openable doors** — cars that ship an animation open and close on demand.
- **Spatial music** — a shuffled playlist played through `PositionalAudio` on
  both speaker cabinets from a single decoded buffer, so it comes from them and
  falls off as you walk away.
- **Audio-reactive LEDs** — equaliser strips driven by an `AudioAnalyser` tap on
  the music, one draw call per strip.
- **Spatial UI** — UIKitML panels for choosing a car and controlling playback.

## Making it run on a headset

This is the part worth reading. A Quest 3 is roughly a three-year-old Android
phone rendering twice per frame, and the app originally froze on the fourth car.

**Texture memory was the whole problem.** The catalog wanted **4,477 MB** of
texture VRAM against roughly 1 GB of headroom for the page. One model —
`bmw_m3_gtr_e46_black.glb` — ships forty 4096×4096 maps and accounts for
**3.4 GB** of that on its own. VRAM scales as the square of resolution, so
`npm run models` caps colour maps at 1024 and data maps at 512, dedupes by
content, and re-encodes to WebP:

| | Before | After |
| --- | --- | --- |
| Catalog texture VRAM | 4,477 MB | **525 MB** |
| Worst resident pair | — | ~186 MB |
| On disk | 165 MB | 57 MB |

Those outputs are generated into `public/gltf/optimized/` and ignored by git,
like `playlist.json` — the sources next to them are what is versioned. A further
~8× is available with KTX2/BasisU, which stays compressed in VRAM and which the
IWSDK loader already supports; it needs a native encoder binary, so it was left
alone.

**Everything else that mattered:**

- **Shaders are warmed before the reveal.** three.js compiles a material the
  first frame it draws, and a car brings 40–80 of them. Each new car is parented
  hidden, `compileAsync`-ed, then shown — moving the hitch into the load you are
  already waiting through.
- **Shadows were never on.** The scene declared `castShadow` with a tuned bias
  and map size, but no `environment.shadows`, so the renderer kept them off and
  none of it reached the screen. Cars also never had `castShadow` set, because a
  model mounted through `AssetManager` bypasses the path that applies it — so
  the hero car looked like it was hovering. Both fixed, and the shadow map now
  rebuilds only on frames after something actually moved.
- **Seven punctual lights became five**, and fixed foveation is on.
- **The LED strips went from 24 draw calls to 2** as `InstancedMesh`, and became
  unlit — an LED emits rather than reflects, so shading it was always wrong, and
  unlit means they are the one thing in the room that does not pay for the
  scene's lights.
- **`near`/`far` was 0.001–200**, a 200,000:1 ratio that throws away almost all
  of the depth buffer. Now 0.05–60.

Result: **87–112 draw calls**, memory flat across a full pass through the
carousel, and no stall on the fourth car.

## Stack

| | |
| --- | --- |
| Framework | [IWSDK](https://github.com/meta-quest/immersive-web-sdk) `@iwsdk/core` 0.5.3 |
| Rendering | three.js r181 (via `super-three`), WebGL |
| ECS | elics — systems in `src/`, components via `defineComponents()` |
| UI | UIKitML spatial panels (Horizon component kit) |
| Language | TypeScript |
| Build | Vite |
| Target | Meta Quest 3 browser (WebXR); also runs in a desktop browser |

Scene composition lives in `public/scenes/main.iwsdk.scene.json`; assets are
registered in `src/assets.ts`. `iwsdk.config.json` is the project authority for
the active scene, XR features and the emulator. `CLAUDE.md` and `.claude/rules/`
carry the conventions and the silent-failure traps this project hit.

## Running it

```sh
npm install
npm run dev
```

That starts the CLI-managed dev server and a browser hosting both the runtime
and the scene editor; use the Runtime / Editor toggle to switch between them.
The first run also builds the headset-sized models, which takes a minute or two;
after that it is incremental.

### Music

Tracks are deliberately **not** in this repository — they were commercial
releases and this repo is public. Add your own:

```sh
# drop .mp3 files into public/audio/music/
npm run music
```

That regenerates `playlist.json`, which the runtime reads to discover tracks: a
browser cannot list a directory, and files in `public/` are not Vite modules.
`predev` and `prebuild` run it for you, so in practice you drop the files in and
restart.

### Other scripts

| | |
| --- | --- |
| `npm run models` | Rebuild the headset-sized models (incremental; `models:force` to redo all) |
| `npm run inspect` | Dump a model's materials, nodes and bounds in stage coordinates |
| `npm run typecheck` | `tsc --noEmit` |

`npm run inspect` exists because per-car data cannot be guessed. Choosing the
body material by triangle count fails on five of seven cars — wheels and bolts
out-triangle the shell — so the catalog declares names explicitly and this is
how you find out what to declare.

## Controls

| Input | Action |
| --- | --- |
| Right **A** | Next car |
| Right **B** | Get in / out of the driver's seat |
| Left **X** | Spin the turntable |
| Left **Y** | Open / close the doors |
| Thumbsticks | Movement and turning (locomotion) |
| Panels | Car selection, spin, and music transport |

Previous car lives on the selector panel's **Prev** button — B is worth more as
the way into the car.

While seated the sticks are disabled, so you stay put and look around with your
head. Only cars whose cabin is actually modelled can be entered, and **only the
Razor M3's seat position is tuned**; the rest declare no seat.

In a desktop browser: **←/→** change car, **R** spins, **E** toggles the doors,
**B** takes the seat.

## Layout

```
iwsdk.config.json         project authority: scene, assets, components, world
src/index.ts              World.create() + explicit system registration
src/assets.ts             defineAssets() — shared runtime/editor catalog
src/car-catalog.ts        per-car data: display order, yaw, seat anchor
src/car-swapper.ts        on-demand loading, LRU residency, doors
src/car-fit.ts            normalising arbitrary downloads onto the dais
src/car-seat.ts           driver's seat, and the five rig constraints it needs
src/render-tuning.ts      foveation and on-demand shadow updates
src/gpu-memory.ts         disposal that actually frees VRAM
scripts/optimize-models.mjs   the texture budget pipeline
scripts/inspect-model.mjs     per-car data discovery
public/scenes/            *.iwsdk.scene.json — composition only
public/ui/                *.uikitml — runtime-loaded panels
```

## What is not here

Planned, designed, and deliberately not built:

- **Engine audio.** The source material is NFS `.abk`/`.gin` mod files.
  `vgmstream` decodes both, but `.gin` is *granular* audio — grains plus curves
  meant to be resynthesised against RPM — so it yields raw material, not a
  ready-made idle loop. It is also EA's copyrighted work.
- **Headlights**, which need per-car material names gathered model by model.
- **Immersive repainting** with a spray gun. There is an approved, unimplemented
  plan in [`notes/plan-cambio-de-color-de-pintura.md`](notes/plan-cambio-de-color-de-pintura.md),
  including the measured body-material name for six of the eight cars.
- **Grabbable props**, a cinematic intro, and an easter egg.

The other seven seat positions are also untuned — the system works, the data is
missing.

## Assets

The car and garage models are third-party downloads (largely Sketchfab) and
carry their own licences; see `license.txt` where the author supplied one.
They are included here for a personal, non-commercial experiment. The HDR
environment is from [Poly Haven](https://polyhaven.com) (CC0). Music is not
included. *Need for Speed* is a trademark of Electronic Arts; this project is an
unaffiliated homage.
