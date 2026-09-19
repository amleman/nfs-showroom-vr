/**
 * Turns the machine through one full revolution on request, then stops.
 *
 * Rotation is applied to the `turntable` container node. The machine hangs under
 * it, so the inspection markers — which are children of the same mount — turn
 * with it and stay on the part they name.
 *
 * One revolution, not a toggle: a visitor presses the control, watches the
 * machine come round, and gets it back exactly where it started. A rotation that
 * keeps going until it is stopped again means every visitor after the first one
 * finds the exhibit at a random angle.
 *
 * The turn eases in and out with a smoothstep, because an object of this size
 * snapping into motion at arm's length in VR reads as a glitch, and it always
 * ends on the angle it started from, so the staging survives any number of
 * revolutions.
 */

import {
  createSystem,
  InputComponent,
  signal,
  type Object3D,
  type StatefulGamepad,
} from '@iwsdk/core';

/** Scene node holding the machine. */
const TURNTABLE_NODE_ID = 'turntable';
/**
 * Seconds for one revolution. Slow enough to read detail on a 15 m machine as it
 * goes past, short enough that a visitor waits it out.
 */
const REVOLUTION_SECONDS = 22;
const TWO_PI = Math.PI * 2;

export class MachineTurntableSystem extends createSystem({}) {
  /** True while a revolution is in progress. The UI subscribes to dim its control. */
  readonly spinning = signal(false);

  private turntable: Object3D | undefined;
  private baseYaw = 0;
  private elapsed = 0;

  /** Begin one revolution. Ignored while another is already running. */
  spin(): void {
    if (this.spinning.peek()) {
      return;
    }
    const turntable = this.resolveTurntable();
    if (turntable == null) {
      return;
    }
    this.baseYaw = turntable.rotation.y;
    this.elapsed = 0;
    this.spinning.value = true;
  }

  /** Alias kept for callers that treat the control as a toggle. */
  toggle(): void {
    this.spin();
  }

  update(delta: number): void {
    if (this.readSpinRequest()) {
      this.spin();
    }
    if (!this.spinning.peek()) {
      return;
    }
    const turntable = this.resolveTurntable();
    if (turntable == null) {
      this.spinning.value = false;
      return;
    }

    this.elapsed += delta;
    const t = this.elapsed / REVOLUTION_SECONDS;
    if (t >= 1) {
      turntable.rotation.y = this.baseYaw;
      this.elapsed = 0;
      this.spinning.value = false;
      return;
    }
    // Smoothstep, so the machine eases away from and back into rest rather than
    // snapping into full speed.
    turntable.rotation.y = this.baseYaw + t * t * (3 - 2 * t) * TWO_PI;
  }

  /**
   * The level loads after this system's init(), so the node is resolved lazily
   * and cached once found.
   */
  private resolveTurntable(): Object3D | undefined {
    this.turntable ??= this.world.getSceneObject(TURNTABLE_NODE_ID);
    return this.turntable;
  }

  /**
   * X on the left controller turns the machine. The right hand owns the
   * carousel (A/B) and both thumbsticks belong to locomotion, so the off hand
   * gets presentation. `R` is the browser equivalent.
   */
  private readSpinRequest(): boolean {
    if (this.input.keyboard.getKeyDown('KeyR')) {
      return true;
    }
    const left: StatefulGamepad | undefined = this.input.xr.gamepads.left;
    return left?.getButtonDown(InputComponent.X_Button) === true;
  }
}
