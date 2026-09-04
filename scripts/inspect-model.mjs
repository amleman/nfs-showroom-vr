/**
 * Dumps what is actually inside a car model, so `src/car-catalog.ts` can be
 * filled in without opening Blender.
 *
 * Everything the showroom wants to do per car — sit in it, light its headlamps,
 * repaint its bodywork, put the engine sound in the right place — needs a name
 * or a coordinate that only exists inside the `.glb`. The paint plan already
 * established that guessing does not work: picking the body material by triangle
 * count fails on five of seven cars, because wheels and bolts out-triangle the
 * shell. So the catalog declares these explicitly, and this is how you find out
 * what to declare.
 *
 * Coordinates are reported in **pivot space** — the model as `fitCarToStage`
 * will actually place it: ground planes hidden, stood upright, scaled to
 * DISPLAY_LENGTH, centred, and seated on the dais. Raw glTF units are useless
 * here because every one of these downloads is authored at a different scale,
 * and one of them is forty metres long.
 *
 * Pivot space is deliberately the frame the presentation yaw is applied *above*,
 * so anything authored against these numbers — a seat, an ignition key, an
 * engine position — turns with the car and stays valid if its display angle
 * changes.
 *
 * Usage:
 *   node scripts/inspect-model.mjs                  # every car
 *   node scripts/inspect-model.mjs <file.glb> ...   # specific models
 *   node scripts/inspect-model.mjs --materials      # material table only
 *   node scripts/inspect-model.mjs --nodes          # node table only
 */

import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readModel, traverseScene, transformPoint } from './glb.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARS_DIR = join(PROJECT_ROOT, 'public', 'gltf', 'optimized', 'cars');

// Must track src/car-fit.ts. If those constants move, these follow.
const DISPLAY_LENGTH = 4.6;
const DECK_Y = 0.17;
const OVERSIZE_FACTOR = 1.5;
const FLATNESS_RATIO = 0.05;
const SHEET_HEIGHT_RATIO = 0.005;
const FLOOR_PROXIMITY_RATIO = 0.02;

// --- geometry ----------------------------------------------------------------

const emptyBox = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const isEmpty = (b) => b.min[0] > b.max[0];
const size = (b) => (isEmpty(b) ? [0, 0, 0] : [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]);

function expand(box, point) {
  for (let i = 0; i < 3; i += 1) {
    box.min[i] = Math.min(box.min[i], point[i]);
    box.max[i] = Math.max(box.max[i], point[i]);
  }
}

function union(into, other) {
  if (!isEmpty(other)) {
    expand(into, other.min);
    expand(into, other.max);
  }
}

/**
 * World-space bounds of one primitive, from the POSITION accessor's declared
 * min/max. glTF requires those on POSITION, so this never has to read vertices —
 * but all eight corners must be transformed, not just min and max, or a rotated
 * node reports a box that does not contain its own geometry.
 */
function primitiveBounds(json, primitive, matrix) {
  const accessor = json.accessors?.[primitive.attributes?.POSITION];
  const box = emptyBox();
  if (accessor?.min == null || accessor?.max == null) {
    return box;
  }
  const [x0, y0, z0] = accessor.min;
  const [x1, y1, z1] = accessor.max;
  for (const corner of [
    [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
  ]) {
    expand(box, transformPoint(matrix, corner));
  }
  return box;
}

function triangleCount(json, primitive) {
  if ((primitive.mode ?? 4) !== 4) {
    // Strips and fans: vertex count is not 3x the triangle count, and two of
    // these models are authored that way. Report unknown rather than a lie.
    return null;
  }
  const accessor =
    primitive.indices != null
      ? json.accessors[primitive.indices]
      : json.accessors[primitive.attributes.POSITION];
  return Math.round(accessor.count / 3);
}

/** Rotate a box -90 degrees about X, matching fitCarToStage's stand-up step. */
function standUp(box) {
  const out = emptyBox();
  for (const [x, y, z] of [box.min, box.max]) {
    expand(out, [x, -z, y]);
  }
  return out;
}

// --- the fit -----------------------------------------------------------------

/**
 * Replicate `fitCarToStage` so every coordinate below is the one the runtime
 * will produce. Returns the per-primitive boxes in stage space plus the
 * transform that got them there.
 */
function fitToStage(json) {
  const parts = [];
  traverseScene(json, (node, matrix, path) => {
    const mesh = json.meshes?.[node.mesh];
    if (mesh == null) {
      return;
    }
    for (const primitive of mesh.primitives ?? []) {
      parts.push({
        name: node.name ?? mesh.name ?? path[path.length - 1],
        path: path.join(' / '),
        material: primitive.material,
        triangles: triangleCount(json, primitive),
        box: primitiveBounds(json, primitive, matrix),
      });
    }
  });

  // 1. Hide the oversized flat quads. Same relative test as car-fit.ts, so the
  //    same meshes disappear here as at runtime.
  const spans = parts.map((p) => Math.max(size(p.box)[0], size(p.box)[2]));
  const median = [...spans].sort((a, b) => a - b)[Math.floor(spans.length / 2)] ?? 0;

  const raw = emptyBox();
  for (const part of parts) {
    union(raw, part.box);
  }
  const totalHeight = size(raw)[1];
  const floorY = raw.min[1];

  parts.forEach((part, i) => {
    const span = spans[i];
    const height = size(part.box)[1];
    const oversizedAndFlat =
      span > median * OVERSIZE_FACTOR && span > 0 && height < span * FLATNESS_RATIO;
    // Author-signature decals: zero-thickness sheets lying on the floor.
    const sheetOnTheFloor =
      span > 0 &&
      height <= totalHeight * SHEET_HEIGHT_RATIO &&
      part.box.min[1] <= floorY + totalHeight * FLOOR_PROXIMITY_RATIO;
    part.hidden = oversizedAndFlat || sheetOnTheFloor;
  });

  const visible = parts.filter((p) => !p.hidden);
  let bounds = emptyBox();
  for (const part of visible) {
    union(bounds, part.box);
  }
  if (isEmpty(bounds)) {
    return { parts, bounds, scale: 1, stoodUp: false };
  }

  // 2. Z-up exports arrive lying on their back: the tallest axis is the length.
  let stoodUp = false;
  if (size(bounds)[1] > Math.max(size(bounds)[0], size(bounds)[2])) {
    stoodUp = true;
    for (const part of parts) {
      part.box = standUp(part.box);
    }
    bounds = emptyBox();
    for (const part of visible) {
      union(bounds, part.box);
    }
  }

  // 3. Scale to the display length, then seat it centred on the deck.
  const [sx, , sz] = size(bounds);
  const scale = Math.max(sx, sz) > 0 ? DISPLAY_LENGTH / Math.max(sx, sz) : 1;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const lift = DECK_Y - bounds.min[1] * scale;

  const place = (box) => ({
    min: [(box.min[0] - cx) * scale, box.min[1] * scale + lift, (box.min[2] - cz) * scale],
    max: [(box.max[0] - cx) * scale, box.max[1] * scale + lift, (box.max[2] - cz) * scale],
  });
  for (const part of parts) {
    part.box = isEmpty(part.box) ? part.box : place(part.box);
  }
  bounds = emptyBox();
  for (const part of parts.filter((p) => !p.hidden)) {
    union(bounds, part.box);
  }

  return { parts, bounds, scale, stoodUp };
}

// --- materials ---------------------------------------------------------------

/** glTF factors are linear; hex is what `Color.set()` wants. */
function toHex(linear) {
  const channel = (v) => {
    const srgb = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.min(Math.max(srgb, 0), 1) * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(linear[0])}${channel(linear[1])}${channel(linear[2])}`;
}

function describeMaterials(json, parts) {
  const usage = new Map();
  for (const part of parts) {
    if (part.material == null) continue;
    const stat = usage.get(part.material) ?? { meshes: 0, triangles: 0, hidden: 0 };
    stat.meshes += 1;
    stat.triangles += part.triangles ?? 0;
    if (part.hidden) stat.hidden += 1;
    usage.set(part.material, stat);
  }

  return (json.materials ?? []).map((material, index) => {
    const pbr = material.pbrMetallicRoughness ?? {};
    const emissive = material.emissiveFactor ?? [0, 0, 0];
    const stat = usage.get(index) ?? { meshes: 0, triangles: 0, hidden: 0 };
    const maps = [];
    if (pbr.baseColorTexture) maps.push('base');
    if (pbr.metallicRoughnessTexture) maps.push('mr');
    if (material.normalTexture) maps.push('normal');
    if (material.emissiveTexture) maps.push('emissive');
    if (material.occlusionTexture) maps.push('ao');

    const alpha = pbr.baseColorFactor?.[3] ?? 1;
    const tags = [];
    if (emissive.some((v) => v > 0)) tags.push('EMISSIVE');
    if (alpha < 1 || material.alphaMode === 'BLEND') tags.push('translucent');
    if (maps.length === 0) tags.push('flat');
    if (stat.hidden > 0) tags.push('ground-plane');

    return {
      index,
      name: material.name ?? '',
      color: toHex(pbr.baseColorFactor ?? [1, 1, 1]),
      metallic: pbr.metallicFactor ?? 1,
      roughness: pbr.roughnessFactor ?? 1,
      emissive: emissive.some((v) => v > 0) ? toHex(emissive) : '',
      maps,
      tags,
      ...stat,
    };
  });
}

// --- report ------------------------------------------------------------------

const f = (n, w = 6) => n.toFixed(2).padStart(w);
const box = (b) => `${f(b.min[0])} ${f(b.min[1])} ${f(b.min[2])}  ..  ${f(b.max[0])} ${f(b.max[1])} ${f(b.max[2])}`;

function report(file, options) {
  const { json } = readModel(file);
  const { parts, bounds, scale, stoodUp } = fitToStage(json);
  const materials = describeMaterials(json, parts);
  const [spanX, height, spanZ] = size(bounds);
  // Which horizontal axis carries the car's length depends on its yaw, so name
  // the axes by what they measure rather than assuming X is forward.
  const length = Math.max(spanX, spanZ);
  const width = Math.min(spanX, spanZ);
  const lengthAxis = spanX >= spanZ ? 'X' : 'Z';

  console.log(`\n${'='.repeat(78)}`);
  console.log(file.split(/[\\/]/).pop());
  console.log('='.repeat(78));
  console.log(
    `on stage: ${length.toFixed(2)} long (along ${lengthAxis}) x ${width.toFixed(2)} wide x ` +
      `${height.toFixed(2)} tall   (fit scale ${scale.toExponential(2)}` +
      `${stoodUp ? ', STOOD UP from Z-up' : ''})`,
  );
  console.log(`bounds:   ${box(bounds)}`);
  if ((json.animations ?? []).length > 0) {
    console.log(`animations: ${json.animations.map((a, i) => a.name || `#${i}`).join(', ')}`);
  }
  const hidden = parts.filter((p) => p.hidden);
  if (hidden.length > 0) {
    console.log(`hidden as ground plane: ${hidden.map((p) => p.name).join(', ')}`);
  }

  // Driver's side is across the width, a little behind the middle, low in the
  // cabin. Only a starting point — the real value is eyeballed from a runtime
  // screenshot, because these cabins are not modelled to a common standard.
  const across = width * 0.22;
  const along = length * 0.05;
  console.log(
    `\nseat starting guess (pivot space): ` +
      `[${(lengthAxis === 'X' ? along : across).toFixed(2)}, ` +
      `${(DECK_Y + height * 0.45).toFixed(2)}, ` +
      `${(lengthAxis === 'X' ? across : along).toFixed(2)}]`,
  );

  if (options.materials !== false) {
    console.log(`\nMATERIALS (${materials.length})`);
    console.log('  idx  name                                      color    m/r        tris  maps            tags');
    for (const m of materials) {
      if (m.meshes === 0) continue;
      console.log(
        `  ${String(m.index).padStart(3)}  ${(m.name || '(unnamed)').slice(0, 40).padEnd(40)}  ` +
          `${m.color}  ${m.metallic.toFixed(1)}/${m.roughness.toFixed(1)}  ` +
          `${String(m.triangles || '?').padStart(6)}  ${m.maps.join(',').padEnd(14)}  ${m.tags.join(' ')}`,
      );
    }
  }

  if (options.nodes) {
    console.log(`\nNODES (${parts.length})`);
    for (const part of [...parts].sort((a, b) => (b.triangles ?? 0) - (a.triangles ?? 0))) {
      console.log(
        `  ${(part.name || '(unnamed)').slice(0, 34).padEnd(34)} ` +
          `${String(part.triangles ?? '?').padStart(6)}t  mat ${String(part.material ?? '-').padStart(3)}  ` +
          `${box(part.box)}${part.hidden ? '  [hidden]' : ''}`,
      );
    }
  }
}

// --- entry point -------------------------------------------------------------

const args = process.argv.slice(2);
const options = {
  nodes: args.includes('--nodes'),
  materials: args.includes('--nodes') ? args.includes('--materials') : true,
};
const files = args.filter((a) => !a.startsWith('--'));

const targets =
  files.length > 0
    ? files
    : readdirSync(CARS_DIR)
        .filter((n) => extname(n).toLowerCase() === '.glb')
        .map((n) => join(CARS_DIR, n));

for (const file of targets) {
  try {
    statSync(file);
    report(file, options);
  } catch (error) {
    console.error(`\n${file}: ${error.message}`);
    process.exitCode = 1;
  }
}
