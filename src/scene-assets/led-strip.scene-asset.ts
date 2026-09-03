/**
 * A wall-mounted LED equaliser strip: a row of emissive bars whose height and
 * brightness track the music, driven by `AudioReactiveLedSystem`.
 *
 * Each bar carries its OWN material. That is deliberate and is the one place in
 * this project where sharing a material would be wrong: the whole point is that
 * bars light independently, and a shared material would make the row flash as a
 * single block.
 *
 * Emissive materials do not cast light in three.js — there is no global
 * illumination — so however hard these pulse they cannot spill onto the car's
 * paint, and the key spotlight keeps the stage to itself.
 */

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from '@iwsdk/core';

/** Bars per strip. Each is a draw call, so this is a frame-budget decision. */
export const BAR_COUNT = 12;
/** Name prefix the reactive system looks for when it walks a placed strip. */
export const BAR_NAME_PREFIX = 'led-bar-';

const BAR_WIDTH = 0.09;
const BAR_DEPTH = 0.05;
/** Height at full scale. Bars are scaled down in Y to represent quiet bands. */
export const BAR_HEIGHT = 0.55;
const BAR_GAP = 0.035;

// One shared geometry across every bar: geometry carries no per-bar state, only
// the material and the transform do. Its origin is moved to the base so that
// scaling Y grows the bar upward instead of shrinking it toward its centre.
const barGeometry = new BoxGeometry(BAR_WIDTH, BAR_HEIGHT, BAR_DEPTH).translate(
  0,
  BAR_HEIGHT / 2,
  0,
);

// Warm amber through to red across the row, matching the garage's key light
// rather than the usual green-to-red equaliser.
const BAR_COLORS = [
  '#ff7a18',
  '#ff8a1e',
  '#ff9a24',
  '#ffab2e',
  '#ffbb38',
  '#ffc846',
  '#ffbb38',
  '#ffab2e',
  '#ff9a24',
  '#ff8a1e',
  '#ff6f14',
  '#ff5a10',
];

const strip = new Group();
strip.name = 'LED strip';

const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;

for (let i = 0; i < BAR_COUNT; i += 1) {
  const material = new MeshStandardMaterial({
    color: '#1a1206',
    roughness: 0.45,
    metalness: 0.1,
    emissive: BAR_COLORS[i % BAR_COLORS.length],
    // Starts dark; the reactive system drives this every frame.
    emissiveIntensity: 0.12,
  });

  const bar: Object3D = new Mesh(barGeometry, material);
  bar.name = `${BAR_NAME_PREFIX}${i}`;
  bar.position.set(
    -totalWidth / 2 + BAR_WIDTH / 2 + i * (BAR_WIDTH + BAR_GAP),
    0,
    0,
  );
  bar.scale.y = 0.12;
  strip.add(bar);
}

export default strip;
