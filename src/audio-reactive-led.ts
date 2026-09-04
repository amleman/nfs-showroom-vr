/**
 * Drives the garage's LED equaliser strips from the music analyser.
 *
 * Bars react on two channels at once: height and brightness. Each strip is a
 * single `InstancedMesh`, so a frame's work is writing two small typed arrays
 * and flagging them — no per-bar objects, no matrix composition, no draw call
 * per bar.
 *
 * The writes go straight into `instanceMatrix` and `instanceColor` rather than
 * through `setMatrixAt`/`setColorAt`. Those helpers compose and decompose a full
 * 4x4, and the only term that ever changes here is the Y scale at element 5:
 * the bars never move, they only grow. Same for colour, which is three floats.
 *
 * These bars deliberately do not illuminate the car. They are unlit
 * `MeshBasicMaterial`, so however hard the strip pulses it emits nothing into
 * the scene and the key spotlight keeps the stage to itself.
 *
 * Strips are found by scene node id rather than by an ECS component: they are
 * fixed dressing, not something the rest of the app queries.
 */

import {
  Color,
  createSystem,
  InstancedMesh,
  MathUtils,
  type Object3D,
} from '@iwsdk/core';
import { MusicPlayerSystem } from './music-player.js';
import { BAR_COLORS, BAR_MESH_NAME } from './scene-assets/led-strip.scene-asset.js';

/** Scene nodes holding a placed `led-strip`. */
const STRIP_NODE_IDS = ['led-strip-left', 'led-strip-right'];
/** Bar height floor, so a silent strip still reads as hardware, not a gap. */
const MIN_SCALE = 0.06;
const MAX_SCALE = 1;
/** Colour multiplier. Above 1 the bar blows past its base hue and reads as hot. */
const MIN_BRIGHTNESS = 0.12;
const MAX_BRIGHTNESS = 2.6;
/** Per-second rates. Bars snap up on a transient and fall back smoothly. */
const ATTACK = 26;
const RELEASE = 7;
/**
 * Music energy is concentrated well below the top of the spectrum, so reading
 * the full bin range leaves the upper bars permanently dead. Use the lower
 * portion and spread it across the strip.
 */
const USABLE_SPECTRUM = 0.55;

interface Strip {
  mesh: InstancedMesh;
  /** Smoothed level per bar. Preallocated: update() must not allocate. */
  levels: Float32Array;
  /** Base RGB per bar, flattened. Multiplied by brightness into instanceColor. */
  baseColors: Float32Array;
  /** Where in the spectrum this strip starts reading, 0 = bass. */
  bandOffset: number;
}

export class AudioReactiveLedSystem extends createSystem({}) {
  private music: MusicPlayerSystem | undefined;
  private strips: Strip[] = [];
  private resolved = false;

  init(): void {
    this.music = this.world.getSystem(MusicPlayerSystem);
  }

  update(delta: number): void {
    if (!this.resolved) {
      this.resolve();
      return;
    }

    const spectrum = this.music?.getFrequencyData();
    for (const strip of this.strips) {
      const { mesh, levels, baseColors, bandOffset } = strip;
      const matrices = mesh.instanceMatrix.array as Float32Array;
      const colors = mesh.instanceColor?.array as Float32Array | undefined;
      const count = levels.length;

      for (let i = 0; i < count; i += 1) {
        const target =
          spectrum == null ? 0 : sampleBand(spectrum, i, count, bandOffset);
        // Fast attack, slow release: the classic equaliser feel, and it hides
        // the coarse bin resolution of a 64-point FFT.
        const rate = target > levels[i] ? ATTACK : RELEASE;
        const level = MathUtils.damp(levels[i], target, rate, delta);
        levels[i] = level;

        const clamped = level < 0 ? 0 : level > 1 ? 1 : level;
        // Element 5 of a column-major 4x4 is the Y scale. Everything else in
        // this instance's matrix was set once, at authoring time.
        matrices[i * 16 + 5] = MIN_SCALE + clamped * (MAX_SCALE - MIN_SCALE);

        if (colors != null) {
          // Squared so quiet passages stay dark and peaks bloom, rather than the
          // whole row sitting at a flat mid-glow.
          const brightness =
            MIN_BRIGHTNESS + clamped * clamped * (MAX_BRIGHTNESS - MIN_BRIGHTNESS);
          colors[i * 3] = baseColors[i * 3] * brightness;
          colors[i * 3 + 1] = baseColors[i * 3 + 1] * brightness;
          colors[i * 3 + 2] = baseColors[i * 3 + 2] * brightness;
        }
      }

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor != null) {
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** The level loads after init(), so strips are resolved on the first frame. */
  private resolve(): void {
    const color = new Color();
    for (let s = 0; s < STRIP_NODE_IDS.length; s += 1) {
      const root = this.world.getSceneObject(STRIP_NODE_IDS[s]);
      if (root == null) {
        continue;
      }
      let mesh: InstancedMesh | undefined;
      root.traverse((object: Object3D) => {
        if (object instanceof InstancedMesh && object.name === BAR_MESH_NAME) {
          mesh = object;
        }
      });
      if (mesh == null) {
        continue;
      }

      const count = mesh.count;
      const baseColors = new Float32Array(count * 3);
      for (let i = 0; i < count; i += 1) {
        color.set(BAR_COLORS[i % BAR_COLORS.length]);
        baseColors[i * 3] = color.r;
        baseColors[i * 3 + 1] = color.g;
        baseColors[i * 3 + 2] = color.b;
      }

      this.strips.push({
        mesh,
        levels: new Float32Array(count),
        baseColors,
        // Offset the second strip so the two rows do not mirror each other.
        bandOffset: s === 0 ? 0 : 0.5,
      });
    }
    this.resolved = this.strips.length > 0;
  }
}

/**
 * Average the bins belonging to one bar, normalised to 0..1, so each bar covers
 * a contiguous slice rather than sampling a single noisy bin.
 */
function sampleBand(
  spectrum: Uint8Array,
  barIdx: number,
  barCount: number,
  bandOffset: number,
): number {
  const span = spectrum.length * USABLE_SPECTRUM;
  const start = spectrum.length * bandOffset * (1 - USABLE_SPECTRUM);
  const from = Math.floor(start + (barIdx / barCount) * span);
  const to = Math.max(
    from + 1,
    Math.floor(start + ((barIdx + 1) / barCount) * span),
  );

  let total = 0;
  let count = 0;
  for (let i = from; i < to && i < spectrum.length; i += 1) {
    total += spectrum[i];
    count += 1;
  }
  return count === 0 ? 0 : total / count / 255;
}
