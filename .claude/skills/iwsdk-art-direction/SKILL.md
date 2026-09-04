---
name: iwsdk-art-direction
description: Art-direct a WebXR scene to a cinematic, showroom-grade look — lighting and HDRI environment, PBR material finishing, tone mapping, bloom and atmosphere, glTF cleanup, colour space, auto-framing and scale. Use when the user asks to make a scene look better, more realistic, more cinematic, more "AAA", or complains that a model looks flat, washed out, plasticky, unlit, wrongly scaled, or like it is floating. Also use before adding any visual effect layer, because it carries the cost model that decides which effects are affordable on a headset.
argument-hint: '[what should look better, or the scene/model to art-direct]'
---

# Art direction for WebXR

Act as a lead creative technologist: the goal is a scene that reads as
deliberate and cinematic, not merely one that renders without errors.

Two things make this different from art-directing a desktop three.js page, and
both are non-negotiable:

**Everything costs twice.** Stereo rendering means every fragment is shaded once
per eye, at a combined resolution higher than a 1080p monitor, inside an 11 ms
budget (90 Hz). A Quest 3 is roughly a 2020 Android phone. An effect that is
"basically free" on a desktop GPU can be the whole frame budget here.

**IWSDK owns the renderer.** You do not construct the `WebGLRenderer`, the
environment, or the lights — the scene document and the component system do.
Reaching for raw three.js where a component exists will be silently overwritten
on the next level load. The translations below are the whole point of this file.

User request is in `$ARGUMENTS`.

---

## 1. Lighting and environment

**Never flat.** A pure ambient/hemisphere bed makes every surface read as
plastic. The look comes from an HDRI doing the reflections plus a small number
of accent lights doing the shaping.

| Intent | IWSDK mechanism | Notes |
| --- | --- | --- |
| Image-based lighting | `com.iwsdk.components.IBLTexture` on the **level root** | `{ src, intensity, rotation }`. IWSDK runs PMREM for you — never call `PMREMGenerator` by hand. |
| Procedural IBL | `com.iwsdk.components.IBLGradient` | Cheaper, flatter. Use when no HDRI fits. |
| Visible background | `com.iwsdk.components.DomeGradient` | Separate from IBL. An interior scene usually wants a dark dome + a studio HDRI that only shows in reflections. |
| Accent lights | `SpotLight`, `PointLight`, `DirectionalLight` scene components | Punctual. Budget below. |
| Ambient fill | `HemisphereLight` | Free-ish. Use it to lift shadows, never to be the key. |

Environment components on a non-root entity are **silently ignored**, and a
changed property needs `_needsUpdate` set afterward or the change is dropped.

**Light budget.** Every punctual light is evaluated per fragment for every lit
material, per eye. Aim for **3–5 punctual lights total**. One shadow-casting key
is usually the whole shadow budget. Reach the look with placement and colour
contrast, not with light count: a warm key on the subject against cool
blue-tinted rims and fill is what reads as cinematic, and it costs the same as
three white lights.

**Shadows are off unless the scene document asks for them.** This is the trap
that hides the most work:

```jsonc
// public/scenes/*.iwsdk.scene.json — top level
"environment": { "shadows": true, "shadowMapType": "pcf" }
```

Without it, `castShadow: true` on a light plus tuned `shadowBias` and
`shadowMapSize` produce **nothing**, and there is no warning. Verify with
`scene_get_render_stats` → `environment.shadows`.

Then keep shadows cheap: one caster, `shadowMapSize` 512–1024, and rebuild the
map only on frames where something moved (`renderer.shadowMap.autoUpdate =
false` plus `needsUpdate` on change). A static stage redrawing its shadow map
every frame is a second full pass over the scene for an identical result.

## 2. Materials

Finish materials as a one-time pass at load, and only write **uniforms**:
`roughness`, `metalness`, `envMapIntensity`, `emissiveIntensity`, and
`clearcoat`/`clearcoatRoughness` *where the material already declares them*.

Turning on a feature the material lacks — setting `clearcoat` on a
`MeshStandardMaterial`, adding a map slot that was empty — changes the shader
**permutation** and costs a compile. Doing that across a model's 40–80 materials
is a visible hitch.

Practical car-paint recipe, and the general shape of any "make it look
expensive" pass:

- Skip anything already rough (> ~0.65): tyres, carpet, matte trim. Polishing
  everything makes a model look like a toy.
- Scale the rest toward a floor rather than to zero — a little roughness is what
  reads as paint instead of chrome.
- Lift `envMapIntensity` (1.5–2) so the HDRI actually shows on the bodywork.
- Strengthen `clearcoat` only where it is already non-zero.

Materials are shared across the meshes that use them, so track what you have
already touched (a `WeakSet`) and never apply a pass twice.

## 3. glTF hygiene

**Colour space.** `GLTFLoader` already tags base-colour and emissive as sRGB and
data maps as linear — do not "fix" them. Only textures you load yourself need
`texture.colorSpace = SRGBColorSpace`, and only when they are colour. Marking a
normal or roughness map sRGB is the usual cause of subtly wrong shading.

**Shadow flags do not come from the file.** `GLTFLoader` leaves every mesh at
`castShadow: false`. Scene-authored nodes get it from `content.castShadow`, but
a model loaded through `AssetManager` at runtime **bypasses that path entirely**
— traverse and set it yourself, or the object floats. Leave `receiveShadow` off
on hero objects unless self-shadowing is actually visible; it is a second lookup
for detail nobody reads.

**Framing and scale.** Downloaded models agree on nothing: one is 40 m long,
another is Z-up and arrives on its back, several ship a big flat "ground" quad
that z-fights the real floor. Measure at load with `Box3` over the *visible*
meshes and correct in this order — hide the junk, stand it up, scale to a target
length, then seat it. Each step invalidates the bounds the next one needs, so
re-measure between them. Hand-tuned per-model transforms do not survive the next
download.

**Disposal.** Use `entity.dispose()`, never `entity.destroy()`. When freeing a
hierarchy you own, walk geometries → materials → textures with de-duplicating
sets, and **exclude `envMap`** from the texture sweep: it points at the shared
IBL, and disposing it blacks out every other material in the scene. Only ever do
this to a hierarchy whose resources are not shared with the rest of the world;
procedural prototypes from the asset manifest are shared by every placement and
are owned by world teardown.

## 4. Atmosphere — and what it actually costs

The user's instinct here is right; the WebXR reality needs stating.

**Tone mapping — do this.** Set it in the scene document, not on the renderer
(a level load overwrites `renderer.toneMapping`):

```jsonc
"environment": { "toneMapping": "aces", "exposure": 1.0 }
```

Valid values: `none`, `linear`, `reinhard`, `cineon`, `aces`. ACES is the single
cheapest step from "WebGL demo" to "cinematic" — one extra ALU op per pixel.
**Warn before switching an existing scene**: light intensities tuned by eye
under `none` will all read darker and less saturated afterward, so it is a
re-lighting job, not a toggle.

**Bloom — usually not affordable, and often broken.** `EffectComposer` renders
to its own targets, which fights the XR framebuffer: in an immersive session it
either breaks stereo or forces a full-resolution resolve per eye per pass. Treat
post-processing as a **browser-only** enhancement unless it has been measured on
device.

Get the glow without the pass:
- Unlit (`MeshBasicMaterial`) emissive geometry with colour values above 1,
  under ACES, blooms perceptually on its own.
- Add cheap additive billboard/cone geometry for the halo — a light shaft or
  glow card costs one transparent draw call, not a full-screen pass.

**Dust and light shafts — cheap and high impact.** A `Points` cloud of a few
thousand particles drifting in the key light, plus additive cones aligned to the
spotlights, give an interior real depth for a handful of draw calls. This is the
best atmosphere-per-millisecond available in XR, and it needs no assets.

**Fog** is in the same scene `environment` block (`linear` or `exponential`) and
is genuinely free.

## 5. Performance rules that shape the art

Art direction and budget are the same conversation here, so decide with numbers:

- **Texture VRAM is the thing that kills headset apps**, and it scales as the
  square of resolution. Budget `width × height × 4 × 1.33` bytes per texture
  (RGBA8 + mips): one 4096² map is 85 MB. Cap colour maps at 1024 and data maps
  (normal, ORM, AO) at 512 unless there is a measured reason not to; that is a
  16× saving on a 4K map for detail invisible at showroom distance. Offline
  resizing beats every runtime trick. KTX2/BasisU beats resizing again (~8×) and
  IWSDK's loader already supports it.
- **Draw calls**: a few hundred is workable on a Quest 3, but every one is state
  the driver re-validates. Merge repeated small geometry into `InstancedMesh` —
  a row of LED bars is one draw call, not twelve. Per-instance state
  (`instanceMatrix`, `instanceColor`) is cloned per placement, so instances still
  animate independently.
- **Emissive trim should be unlit.** Anything self-luminous has no business
  paying for the scene's punctual lights; `MeshBasicMaterial` removes it from the
  lighting loop entirely and looks *more* correct.
- **Warm shaders before the reveal.** three compiles a material the first frame
  it draws. Parent a newly loaded model hidden, `await renderer.compileAsync(obj,
  camera, scene)`, then show it — `compile` walks materials with `traverse`, so
  hidden meshes still compile, while lights come from the visible target scene.
- **Fixed foveation** (`renderer.xr.setFoveation(0.7–1)`) is the largest
  fill-rate saving available for one line of code.
- **Never allocate in `update()`.** Preallocate vectors, matrices and typed
  arrays in `init()` as class properties. Write directly into
  `instanceMatrix.array` rather than composing a `Matrix4` per object per frame.
- **Depth precision**: keep `near`/`far` tight in `iwsdk.config.json`. A
  0.001–200 range throws away almost all of the depth buffer and shows up as
  z-fighting on decals and floors. Something like 0.05–60 fits a room.

## 6. Verifying a look

The editor render **does not run application systems**, so `scene_screenshot`
can never prove how the app actually looks. Use `browser_screenshot` against the
runtime.

Check `scene_get_render_stats` for `calls`, `triangles`, `programs`,
`textures`, and `environment.shadows` / `toneMapping` — and check
`renderStats.visibleNodeIds` against what you expected, because a node that
silently failed to render still reports `valid: true`.

Before calling a look done:

- [ ] HDRI reflections visible on the hero surfaces, not just ambient lift
- [ ] `environment.shadows` true, and the hero object actually casts
- [ ] Warm/cool contrast present rather than one flat colour temperature
- [ ] 3–5 punctual lights, one shadow caster
- [ ] No texture above its cap; peak resident VRAM inside budget
- [ ] Draw calls counted, `InstancedMesh` used for anything repeated
- [ ] Confirmed in a **runtime** screenshot, and in stereo if the change touches
      scale, depth or parallax
