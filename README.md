# NFS Showroom VR

A WebXR car showroom for the Meta Quest 3, built on Meta's Immersive Web SDK.
You stand in an industrial garage inspired by the *Need for Speed: Most Wanted*
(2005) safehouse, with one car lit on a turntable, and swap through the
collection from spatial panels.

## What it does

- **Car carousel** — eight vehicles on a lit display dais. Models load on
  demand rather than all at once, so only one car is on the GPU at a time.
- **Auto-fit** — the models are third-party downloads that agree on nothing
  (one is 40 m long, one arrives lying on its back, several ship a ground
  plane that fights the garage floor). Each is measured and corrected at load.
- **Turntable** — the dais and the car rotate together, one slow revolution.
- **Openable doors** — cars that ship an animation open and close on demand.
- **Spatial music** — a shuffled playlist played through `PositionalAudio` on
  the speaker cabinets, so it comes from them and fades as you walk away.
- **Audio-reactive LEDs** — equaliser bars driven by an `AudioAnalyser` tap.
- **Spatial UI** — UIKitML panels for choosing a car and controlling playback.

## Stack

| | |
| --- | --- |
| Framework | [IWSDK](https://github.com/meta-quest/immersive-web-sdk) (`@iwsdk/core`) |
| Rendering | three.js (via `super-three`), WebGL |
| ECS | elics — systems in `src/`, components via `defineComponents()` |
| UI | UIKitML spatial panels (Horizon component kit) |
| Language | TypeScript |
| Build | Vite |
| Target | Meta Quest 3 browser (WebXR), also runs in a desktop browser |

Scene composition lives in `public/scenes/main.iwsdk.scene.json`; assets are
registered in `src/assets.ts`. `iwsdk.config.json` is the project authority for
the active scene, XR features and the emulator — see `CLAUDE.md` for the
conventions this project follows.

## Running it

```sh
npm install
npm run dev
```

That starts the CLI-managed dev server and a browser hosting both the runtime
and the scene editor; use the Runtime / Editor toggle to switch between them.

### Music

Audio tracks are deliberately **not** in this repository. Add your own:

```sh
# drop .mp3 files into public/audio/music/
npm run music
```

That regenerates `playlist.json`, which the runtime reads to discover tracks —
a browser cannot list a directory, and files in `public/` are not Vite modules.
`predev` and `prebuild` run it for you.

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

While you are sitting in a car the sticks are disabled, so you stay put and look
around with your head; B gets you out again. Not every vehicle can be sat in,
only the ones whose cabin is actually modelled.

In a desktop browser: **←/→** change car, **R** spins, **E** toggles the doors,
**B** takes the seat.
