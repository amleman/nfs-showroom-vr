/**
 * Spins the car on the platform through one full revolution on request.
 *
 * Only the car turns, not the dais — the deck is radially symmetric, so rotating
 * it would look identical while moving the emissive rim for no reason.
 *
 * The spin always ends on the yaw it started from, so a car's authored
 * presentation angle survives any number of revolutions.
 */

import {
  createSystem,
  Entity,
  InputComponent,
  signal,
  type StatefulGamepad,
} from '@iwsdk/core';
import { CarShowcase } from './car-showcase-component.js';
import { CarSwapperSystem } from './car-swapper.js';

/** Seconds for one revolution. Slow enough to read the bodywork as it passes. */
const REVOLUTION_SECONDS = 14;
const TWO_PI = Math.PI * 2;

export class CarTurntableSystem extends createSystem({
  cars: { required: [CarShowcase] },
}) {
  /** True while a revolution is in progress. The UI subscribes to disable its button. */
  readonly spinning = signal(false);

  private swapper: CarSwapperSystem | undefined;
  private target: Entity | undefined;
  private baseYaw = 0;
  private elapsed = 0;

  init(): void {
    this.swapper = this.world.getSystem(CarSwapperSystem);
  }

  /** Begin one revolution of the active car. Ignored while another is running. */
  spin(): void {
    if (this.spinning.peek()) {
      return;
    }
    const entity = this.swapper?.activeEntity;
    if (entity?.object3D == null) {
      return;
    }
    this.target = entity;
    this.baseYaw = entity.object3D.rotation.y;
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
    const object3D = this.target?.object3D;
    // Swapping cars mid-spin retires the old target: snap it back to its authored
    // angle so it is not left parked at some arbitrary yaw when it next appears.
    if (object3D == null || this.target !== this.swapper?.activeEntity) {
      this.settle();
      return;
    }

    this.elapsed += delta;
    const t = this.elapsed / REVOLUTION_SECONDS;
    if (t >= 1) {
      this.settle();
      return;
    }
    // Smoothstep, so the car eases away from and back into its display angle
    // rather than snapping into full speed.
    object3D.rotation.y = this.baseYaw + t * t * (3 - 2 * t) * TWO_PI;
  }

  /**
   * Clicking a thumbstick spins. The stick *axes* belong to LocomotionSystem
   * (left slides, right turns) but its button is unbound, so this adds a VR
   * shortcut without stealing movement. `R` is the browser equivalent.
   */
  private readSpinRequest(): boolean {
    if (this.input.keyboard.getKeyDown('KeyR')) {
      return true;
    }
    const gamepads = this.input.xr.gamepads;
    return this.stickClicked(gamepads.left) || this.stickClicked(gamepads.right);
  }

  private stickClicked(pad: StatefulGamepad | undefined): boolean {
    return pad?.getButtonDown(InputComponent.Thumbstick) === true;
  }

  /** Return the target to its authored yaw and end the spin. */
  private settle(): void {
    const object3D = this.target?.object3D;
    if (object3D != null) {
      object3D.rotation.y = this.baseYaw;
    }
    this.target = undefined;
    this.elapsed = 0;
    this.spinning.value = false;
  }
}
