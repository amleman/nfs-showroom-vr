/**
 * A wall-mounted LED equaliser strip whose bars track the music, driven by
 * `AudioReactiveLedSystem`.
 *
 * The whole strip is ONE `InstancedMesh`: twelve bars, one draw call. Authored
 * as twelve separate meshes it was twelve draw calls per strip and twenty-four
 * for the pair, which is a lot of GPU state changes for what is decorative trim
 * on a stage where the car itself already costs sixty.
 *
 * Two consequences worth knowing:
 *
 * `MeshBasicMaterial`, not `MeshStandardMaterial`. An LED emits rather than
 * reflects, so shading it was always wrong — and unlit means these bars are the
 * one thing in the room that does not pay for the scene's punctual lights.
 * Per-bar brightness rides on `instanceColor`, which a basic material multiplies
 * straight into its output, so no shader patch is needed to make a bar glow.
 *
 * Per-instance state (`instanceMatrix`, `instanceColor`) is cloned per placement
 * — `BufferAttribute.copy` reallocates — so the left and right strips animate
 * independently even though they share this one prototype. The material and
 * geometry stay shared, which is what the asset contract requires.
 */

import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
} from '@iwsdk/core';

/** Bars per strip. One draw call regardless, so this is now a look decision. */
export const BAR_COUNT = 12;
/** Name the reactive system looks for when it walks a placed strip. */
export const BAR_MESH_NAME = 'led-bars';

const BAR_WIDTH = 0.09;
const BAR_DEPTH = 0.05;
/** Height at instance scale 1. Bars are scaled in Y to represent quiet bands. */
export const BAR_HEIGHT = 0.55;
const BAR_GAP = 0.035;

/**
 * Base hue per bar: warm amber through to red across the row, matching the
 * garage's key light rather than the usual green-to-red equaliser. The system
 * multiplies these by a brightness, so they are the colour at full tilt.
 */
export const BAR_COLORS = [
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
] as const;

// Origin at the base of the bar, so scaling Y grows it upward instead of
// shrinking it toward its own centre.
const barGeometry = new BoxGeometry(BAR_WIDTH, BAR_HEIGHT, BAR_DEPTH).translate(
  0,
  BAR_HEIGHT / 2,
  0,
);

const barMaterial = new MeshBasicMaterial({ color: '#ffffff' });

const strip = new Group();
strip.name = 'LED strip';

const bars = new InstancedMesh(barGeometry, barMaterial, BAR_COUNT);
bars.name = BAR_MESH_NAME;
// The bars only ever change scale in Y, never position, so the transforms are
// static apart from that one term. The system writes it into the buffer directly
// rather than recomposing a matrix per bar per frame.
bars.frustumCulled = false;

const totalWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
const matrix = new Matrix4();
const color = new Color();

for (let i = 0; i < BAR_COUNT; i += 1) {
  matrix.makeTranslation(
    -totalWidth / 2 + BAR_WIDTH / 2 + i * (BAR_WIDTH + BAR_GAP),
    0,
    0,
  );
  // Resting height, replaced on the first frame the music plays.
  matrix.elements[5] = 0.12;
  bars.setMatrixAt(i, matrix);
  bars.setColorAt(i, color.set(BAR_COLORS[i % BAR_COLORS.length]).multiplyScalar(0.15));
}

strip.add(bars);

export default strip;
