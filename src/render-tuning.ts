/**
 * Headset-side render budget: foveation, and shadows that only redraw when the
 * stage actually changes.
 *
 * Both of these are things a standalone headset needs and a desktop GPU does
 * not, which is why neither is on by default.
 *
 * **Foveation.** The Quest compositor can render the periphery of each eye at
 * reduced resolution. The player is looking at a car on a dais in the middle of
 * their view, so the edges of the frame are the cheapest pixels in the scene to
 * give up, and this is the largest fill-rate saving available for one line.
 *
 * **On-demand shadows.** `key-spot` casts, which means three.js re-renders the
 * casters from the light's point of view every single frame — a second pass over
 * the car's ~60 draw calls to produce a depth map that is usually identical to
 * the last one. Nothing on this stage moves unless the player asks it to, so the
 * map is rebuilt on the frames that follow a request and left alone otherwise.
 *
 * The invalidation is deliberately generous rather than exact: a stale shadow is
 * a visible artifact, an extra shadow pass is a few tenths of a millisecond.
 * When in doubt this redraws.
 */

import { createSystem } from '@iwsdk/core';
import { CarSwapperSystem } from './car-swapper.js';
import { CarTurntableSystem } from './car-turntable.js';

/**
 * 0 is off, 1 is maximum. High enough to matter, low enough that the periphery
 * does not visibly smear when the player turns their head.
 */
const FOVEATION = 0.75;
/**
 * Seconds to keep redrawing shadows after a discrete change. Comfortably longer
 * than the door clip, which is the slowest thing this has to cover.
 */
const DOOR_HOLD_SECONDS = 3;
/** Shorter hold for a swap: the new car is mounted within a frame or two. */
const SWAP_HOLD_SECONDS = 0.5;

export class RenderTuningSystem extends createSystem({}) {
  /** Seconds of shadow redraw still owed. */
  private hold = 0;
  private turntable: CarTurntableSystem | undefined;

  init(): void {
    // Applies to the current session and every later one; safe before entry.
    this.renderer.xr.setFoveation(FOVEATION);

    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    const swapper = this.world.getSystem(CarSwapperSystem);
    const turntable = this.world.getSystem(CarTurntableSystem);

    if (swapper != null) {
      this.cleanupFuncs.push(
        // A mounted car changes the silhouette; a finished load changes it again.
        swapper.activeLabel.subscribe(() => this.invalidate(SWAP_HOLD_SECONDS)),
        swapper.loading.subscribe(() => this.invalidate(SWAP_HOLD_SECONDS)),
        swapper.doorsOpen.subscribe(() => this.invalidate(DOOR_HOLD_SECONDS)),
      );
    }
    if (turntable != null) {
      this.cleanupFuncs.push(
        turntable.spinning.subscribe((spinning) => {
          // Held open for the whole revolution by update(), not by this window.
          if (spinning) {
            this.invalidate(SWAP_HOLD_SECONDS);
          }
        }),
      );
    }
    this.turntable = turntable;
  }

  update(delta: number): void {
    // A revolution moves the caster continuously, so it redraws throughout.
    if (this.turntable?.spinning.peek() === true) {
      this.renderer.shadowMap.needsUpdate = true;
      return;
    }
    if (this.hold <= 0) {
      return;
    }
    this.hold -= delta;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Redraw shadows for the next `seconds`. Extends an existing hold. */
  invalidate(seconds: number): void {
    this.hold = Math.max(this.hold, seconds);
    this.renderer.shadowMap.needsUpdate = true;
  }
}
