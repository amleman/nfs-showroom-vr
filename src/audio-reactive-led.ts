/**
 * Drives the garage's LED equaliser strips from the music analyser.
 *
 * Bars react on two channels at once: height (Y scale) and emissive intensity.
 * Both are cheap — a transform and a material uniform, no shader recompiles and
 * no lights added to the scene.
 *
 * These bars deliberately do not illuminate the car. Emissive materials in
 * three.js do not cast light, so however hard the strip pulses the paint is
 * untouched and the key spotlight stays the only thing shaping the stage.
 *
 * Strips are found by scene node id rather than by an ECS component: they are
 * fixed dressing, not something the rest of the app queries.
 */

import {
  createSystem,
  MathUtils,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from '@iwsdk/core';
import { MusicPlayerSystem } from './music-player.js';
import { BAR_NAME_PREFIX } from './scene-assets/led-strip.scene-asset.js';

/** Scene nodes holding a placed `led-strip`. */
const STRIP_NODE_IDS = ['led-strip-left', 'led-strip-right'];
/** Bar height floor, so a silent strip still reads as hardware, not a gap. */
const MIN_SCALE = 0.06;
const MAX_SCALE = 1;
const MIN_EMISSIVE = 0.15;
const MAX_EMISSIVE = 5.5;
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
  bars: Mesh[];
  /** Smoothed level per bar. Preallocated: update() must not allocate. */
  levels: Float32Array;
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
      const { bars, levels, bandOffset } = strip;
      for (let i = 0; i < bars.length; i += 1) {
        const target =
          spectrum == null
            ? 0
            : sampleBand(spectrum, i, bars.length, bandOffset);
        // Fast attack, slow release: the classic equaliser feel, and it hides
        // the coarse bin resolution of a 64-point FFT.
        const rate = target > levels[i] ? ATTACK : RELEASE;
        levels[i] = MathUtils.damp(levels[i], target, rate, delta);
        applyBar(bars[i], levels[i]);
      }
    }
  }

  /** The level loads after init(), so strips are resolved on the first frame. */
  private resolve(): void {
    for (let s = 0; s < STRIP_NODE_IDS.length; s += 1) {
      const root = this.world.getSceneObject(STRIP_NODE_IDS[s]);
      if (root == null) {
        continue;
      }
      const bars: Mesh[] = [];
      root.traverse((object: Object3D) => {
        if (object instanceof Mesh && object.name.startsWith(BAR_NAME_PREFIX)) {
          bars.push(object);
        }
      });
      if (bars.length === 0) {
        continue;
      }
      bars.sort((a, b) => barIndex(a.name) - barIndex(b.name));
      this.strips.push({
        bars,
        levels: new Float32Array(bars.length),
        // Offset the second strip so the two rows do not mirror each other.
        bandOffset: s === 0 ? 0 : 0.5,
      });
    }
    this.resolved = this.strips.length > 0;
  }
}

function applyBar(bar: Mesh, level: number): void {
  const clamped = Math.min(Math.max(level, 0), 1);
  bar.scale.y = MIN_SCALE + clamped * (MAX_SCALE - MIN_SCALE);
  const material = bar.material as MeshStandardMaterial;
  // emissiveIntensity is a plain uniform: writing it never recompiles.
  material.emissiveIntensity =
    MIN_EMISSIVE + clamped * clamped * (MAX_EMISSIVE - MIN_EMISSIVE);
}

function barIndex(name: string): number {
  return Number.parseInt(name.slice(BAR_NAME_PREFIX.length), 10) || 0;
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
