/**
 * Rewrites the downloaded industrial models into GLBs this runtime can actually
 * open, and into a triangle and texture budget a Quest can actually draw.
 *
 * Three separate problems, all invisible until the headset is on:
 *
 * 1. **Meshopt is not wired up.** `@iwsdk/core` builds its `GLTFLoader` with a
 *    DRACO loader and a KTX2 loader and nothing else, so any model carrying
 *    `EXT_meshopt_compression` fails to load outright. Two of the seven do.
 * 2. **The DRACO decoder is fetched from unpkg at runtime.** IWSDK hardcodes the
 *    CDN path and never plumbs an override through `AssetManager.init`, so five
 *    of the seven models silently need internet on the headset to open. A trade
 *    stand is exactly where that is not available.
 * 3. **Triangles.** The medical arm ships 1.17 M of them, which is the entire
 *    frame budget of the device spent on one exhibit.
 *
 * So this decodes every compression extension and writes geometry back out
 * plain: bigger files over the LAN, zero decoder dependency, nothing to fetch.
 * Textures are already WebP from the user's own optimisation pass and are only
 * touched when they exceed the caps below. Meshes over the triangle budget are
 * simplified; everything else is passed through untouched.
 *
 * Output goes to `public/gltf/industrial/`, which is GENERATED and gitignored.
 * Re-runs are incremental: a model is skipped when its output is newer than its
 * input. `--force` rebuilds everything.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLTF_DIR = join(PROJECT_ROOT, 'public', 'gltf');
const OUT_DIR = join(GLTF_DIR, 'industrial');
const SOURCES = [
  { dir: join(GLTF_DIR, 'new_gbl_models'), environment: false },
  { dir: join(GLTF_DIR, 'showrooms'), environment: true },
];

/**
 * Triangles above which a model is simplified. A machine is read from several
 * metres away in VR; silhouette is what survives that distance, and meshopt's
 * simplifier preserves silhouette before it preserves interior density.
 */
const TRIANGLE_BUDGET = 260_000;
/** Never simplify below this ratio however far over budget a model is. */
const MIN_SIMPLIFY_RATIO = 0.25;
/** Longest edge for colour maps, then for the maps that only modulate shading. */
const COLOR_MAX = 1024;
const DATA_MAX = 512;

const force = process.argv.includes('--force');

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'meshopt.decoder': (await import('meshoptimizer')).MeshoptDecoder,
    'meshopt.encoder': (await import('meshoptimizer')).MeshoptEncoder,
  });

function collectInputs() {
  const inputs = [];
  for (const { dir, environment } of SOURCES) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (extname(name).toLowerCase() !== '.glb') continue;
      inputs.push({
        file: join(dir, name),
        out: join(OUT_DIR, `${stem(name)}.glb`),
        environment,
      });
    }
  }
  return inputs;
}

/**
 * Give every primitive in the document the same set of vertex attributes.
 *
 * A showroom carries `LocomotionEnvironment`, and IWSDK's locomotor builds its
 * collision mesh by calling `BufferGeometryUtils.mergeGeometries` over the whole
 * model. That throws the moment two primitives disagree about which attributes
 * exist — and both of these downloads disagree. The gallery has UVs on three of
 * its seven meshes and none on the other four; the studio has one primitive
 * carrying TANGENT and TEXCOORD_1 that nothing else has.
 *
 * The failure is quiet in the worst way: the model still renders perfectly, the
 * merge error lands in the console, and the visitor falls through the floor.
 *
 * Filling the gaps rather than stripping the extras is deliberate. Stripping
 * TEXCOORD_1 would silently unmap any material sampling from it, and stripping
 * COLOR_0 would flatten vertex-baked shading. A zeroed UV on a mesh that has no
 * texture costs eight bytes a vertex and changes nothing.
 */
function harmoniseAttributes(document) {
  const primitives = document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives());
  const semantics = new Set(primitives.flatMap((p) => p.listSemantics()));
  // Skinning attributes come in matched pairs and only exist on skinned meshes;
  // fabricating them on static geometry would bind it to a skeleton it has no
  // business in.
  for (const semantic of semantics) {
    if (semantic.startsWith('JOINTS') || semantic.startsWith('WEIGHTS')) {
      semantics.delete(semantic);
    }
  }

  const buffer = document.getRoot().listBuffers()[0];
  let added = 0;
  for (const primitive of primitives) {
    const count = primitive.getAttribute('POSITION')?.getCount();
    if (count == null) continue;
    for (const semantic of semantics) {
      if (primitive.getAttribute(semantic) != null) continue;
      const filled = fillAttribute(document, buffer, semantic, count);
      if (filled == null) continue;
      primitive.setAttribute(semantic, filled);
      added += 1;
    }
  }
  return added;
}

/** A neutral value for each attribute this has to invent. */
function fillAttribute(document, buffer, semantic, count) {
  const spec = semantic.startsWith('TEXCOORD')
    ? { type: 'VEC2', unit: [0, 0] }
    : semantic.startsWith('COLOR')
      ? { type: 'VEC4', unit: [1, 1, 1, 1] }
      : semantic === 'TANGENT'
        ? { type: 'VEC4', unit: [1, 0, 0, 1] }
        : semantic === 'NORMAL'
          ? { type: 'VEC3', unit: [0, 1, 0] }
          : null;
  if (spec == null) return null;

  const stride = spec.unit.length;
  const array = new Float32Array(count * stride);
  for (let i = 0; i < count; i += 1) {
    array.set(spec.unit, i * stride);
  }
  return document
    .createAccessor(`${semantic}_filled`)
    .setBuffer(buffer)
    .setType(spec.type)
    .setArray(array);
}

/**
 * Strip the optimiser suffixes the source files carry so the manifest can name a
 * machine rather than the tool that last touched it.
 */
function stem(name) {
  return basename(name, extname(name)).replace(/-(optimized|compressed)$/u, '');
}

function countTriangles(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const position = primitive.getAttribute('POSITION');
      const count = indices?.getCount() ?? position?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

async function processModel({ file, out, environment }) {
  const label = basename(out);
  if (!force && existsSync(out) && statSync(out).mtimeMs >= statSync(file).mtimeMs) {
    console.log(`  skip   ${label} (up to date)`);
    return;
  }

  const document = await io.read(file);
  const before = countTriangles(document);
  const extensionsIn = document.getRoot().listExtensionsUsed().map((e) => e.extensionName);

  // Order matters: dedup and prune first so the simplifier is not asked to work
  // on geometry that is about to be thrown away.
  await document.transform(dedup(), prune({ keepAttributes: false }));

  if (before > TRIANGLE_BUDGET) {
    const ratio = Math.max(MIN_SIMPLIFY_RATIO, TRIANGLE_BUDGET / before);
    await MeshoptSimplifier.ready;
    // Welding first is what lets the simplifier collapse across primitive seams;
    // an unwelded export collapses almost nothing and reports success anyway.
    await document.transform(
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004, lockBorder: false }),
    );
  }

  await document.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [COLOR_MAX, COLOR_MAX], slots: /baseColor|emissive/u, quality: 82 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [DATA_MAX, DATA_MAX], slots: /normal|metallicRoughness|occlusion/u, quality: 90 }),
  );

  // Only the showrooms: they are the models the locomotor merges. Doing it to a
  // machine would add attributes nothing reads.
  const filled = environment === true ? harmoniseAttributes(document) : 0;

  // Every compression extension is dropped on write: the runtime loader has a
  // DRACO decoder behind a CDN it may not reach and no meshopt decoder at all.
  //
  // Transmission and volume go with them. three.js implements transmissive
  // materials with a second render of the whole scene into an offscreen target,
  // which is a cost a standalone headset pays twice over in stereo for a pane of
  // glass nobody is inspecting. Dropping the extension leaves the material
  // opaque, which is the right trade at exhibit distance.
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (/draco|meshopt|quantization|transmission|volume/iu.test(extension.extensionName)) {
      extension.dispose();
    }
  }

  mkdirSync(dirname(out), { recursive: true });
  await io.write(out, document);

  const after = countTriangles(document);
  const bytes = statSync(out).size;
  console.log(
    `  write  ${label}  ${before.toLocaleString()} -> ${after.toLocaleString()} tris  ` +
      `${(statSync(file).size / 1e6).toFixed(1)} -> ${(bytes / 1e6).toFixed(1)} MB  ` +
      `[${extensionsIn.join(' ') || 'plain'}]${filled > 0 ? ` +${filled} filled attrs` : ''}`,
  );
}

const inputs = collectInputs();
if (inputs.length === 0) {
  console.log('[models] no sources found; nothing to do');
} else {
  console.log(`[models] preparing ${inputs.length} model(s) -> public/gltf/industrial/`);
  for (const input of inputs) {
    try {
      await processModel(input);
    } catch (error) {
      console.error(`  FAIL   ${basename(input.out)}: ${error?.message ?? error}`);
      process.exitCode = 1;
    }
  }
}
