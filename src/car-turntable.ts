/**
 * Spins the display turntable through one full revolution on request.
 *
 * Rotation is applied to the `turntable` container node, so the dais and the
 * car on it turn together as one piece. Each car keeps its own authored
 * presentation yaw as a child, untouched by the spin.
 *
 * The spin always ends on the angle it started from, so the staging survives any
 * number of revolutions.
 */

import {
  createSystem,
  InputComponent,
  signal,
  type Object3D,
  type StatefulGamepad,
} from '@iwsdk/core';

/** Scene node holding the dais and the cars. */
const TURNTABLE_NODE_ID = 'turntable';
/**
 * Seconds per revolution. 0.3x the original 7 s speed, per the brief — slow and
 * deliberate rather than a showroom spin.
 */
const REVOLUTION_SECONDS = 7 / 0.3;
const TWO_PI = Math.PI * 2;

export class CarTurntableSystem extends createSystem({}) {
  /** True while a revolution is in progress. The UI subscribes to disable its button. */
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
    // Smoothstep, so the platform eases away from and back into rest rather than
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
   * X on the left controller spins the platform. The right hand owns the car
   * carousel (A/B) and both thumbsticks belong to locomotion, so the off hand
   * gets the turntable and Y stays free. `R` is the browser equivalent.
   */
  private readSpinRequest(): boolean {
    if (this.input.keyboard.getKeyDown('KeyR')) {
      return true;
    }
    const left: StatefulGamepad | undefined = this.input.xr.gamepads.left;
    return left?.getButtonDown(InputComponent.X_Button) === true;
  }
}
