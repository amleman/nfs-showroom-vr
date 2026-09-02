/**
 * Cycles the showroom's hero vehicle without tearing down the scene.
 *
 * Every candidate car is authored into the scene as a sibling on the display
 * platform and stays loaded; swapping only flips `Visibility`. That keeps the
 * change instant (no GLTF parse mid-session, no GPU upload hitch) at the cost of
 * holding every car in memory — the right trade for a handful of vehicles. For a
 * catalog of dozens, switch to `AssetManager` streaming keyed off `slot`.
 */

import {
  createSystem,
  Entity,
  InputComponent,
  signal,
  Visibility,
  type StatefulGamepad,
} from '@iwsdk/core';
import { CarShowcase } from './car-showcase-component.js';

export class CarSwapperSystem extends createSystem({
  cars: { required: [CarShowcase] },
}) {
  /** Carousel order, ascending by `CarShowcase.slot`. Rebuilt on query change only. */
  private readonly ordered: Entity[] = [];
  private activeIndex = 0;

  /** Name of the car on the platform. UI subscribes; read with `.peek()` in update loops. */
  readonly activeLabel = signal('');
  /** Position in the carousel, for "2 / 5"-style readouts. */
  readonly activePosition = signal(0);
  /** How many cars are in the carousel. */
  readonly carCount = signal(0);

  init(): void {
    this.queries.cars.subscribe('qualify', () => this.rebuild());
    this.queries.cars.subscribe('disqualify', () => this.rebuild());
    this.rebuild();
  }

  update(): void {
    const step = this.readInput();
    if (step !== 0) {
      this.cycle(step);
    }
  }

  /** Advance the carousel by `step` slots, wrapping in both directions. */
  cycle(step: number): void {
    if (this.ordered.length === 0) {
      return;
    }
    const count = this.ordered.length;
    this.select((((this.activeIndex + step) % count) + count) % count);
  }

  /** The car currently on the platform, or undefined when the carousel is empty. */
  get activeEntity(): Entity | undefined {
    return this.ordered[this.activeIndex];
  }

  next(): void {
    this.cycle(1);
  }

  previous(): void {
    this.cycle(-1);
  }

  /** Show the car at `index` in the carousel and hide the rest. */
  select(index: number): void {
    if (index < 0 || index >= this.ordered.length) {
      return;
    }
    this.activeIndex = index;
    this.applyVisibility();
  }

  /**
   * Rebuild the ordered carousel, keeping the same car on the platform when it
   * survives the change. Runs on scene load and on any car entering/leaving the
   * query — never per frame.
   */
  private rebuild(): void {
    const previouslyActive = this.ordered[this.activeIndex];
    this.ordered.length = 0;
    for (const entity of this.queries.cars.entities) {
      this.ordered.push(entity);
    }
    this.ordered.sort((a, b) => {
      const slotDelta =
        (a.getValue(CarShowcase, 'slot') ?? 0) -
        (b.getValue(CarShowcase, 'slot') ?? 0);
      return slotDelta !== 0 ? slotDelta : a.index - b.index;
    });

    const survivingIndex =
      previouslyActive == null ? -1 : this.ordered.indexOf(previouslyActive);
    this.activeIndex = survivingIndex >= 0 ? survivingIndex : 0;
    this.carCount.value = this.ordered.length;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    for (let i = 0; i < this.ordered.length; i += 1) {
      const entity = this.ordered[i];
      const visible = i === this.activeIndex;
      // Visibility proxies object3D.visible when present; fall back to the
      // object directly so a car authored without the component still hides.
      if (entity.hasComponent(Visibility)) {
        entity.setValue(Visibility, 'isVisible', visible);
      } else if (entity.object3D != null) {
        entity.object3D.visible = visible;
      }
    }

    const active = this.ordered[this.activeIndex];
    this.activeLabel.value =
      active == null ? '' : (active.getValue(CarShowcase, 'label') ?? '');
    this.activePosition.value = this.ordered.length === 0 ? 0 : this.activeIndex + 1;
  }

  /** Net carousel steps requested this frame across every input surface. */
  private readInput(): number {
    let step = 0;

    // Browser: arrow keys, so the showroom is testable without a headset.
    const keyboard = this.input.keyboard;
    if (keyboard.getKeyDown('ArrowRight')) {
      step += 1;
    }
    if (keyboard.getKeyDown('ArrowLeft')) {
      step -= 1;
    }

    const gamepads = this.input.xr.gamepads;
    step += this.readGamepad(gamepads.left);
    step += this.readGamepad(gamepads.right);
    return step;
  }

  /**
   * Edge-triggered controller input. `getButtonDown` is true only on the frame the
   * button goes down, so no cooldown bookkeeping is needed.
   */
  private readGamepad(pad: StatefulGamepad | undefined): number {
    if (pad == null) {
      return 0;
    }
    let step = 0;
    // Face buttons only. The thumbsticks are deliberately untouched: LocomotionSystem
    // slides on the left stick and turns on the right, so reading them here swapped
    // the car every time the player moved.
    // A (right hand) / X (left hand) advance; B / Y go back. Lookups for buttons
    // this controller lacks return false rather than throwing.
    if (
      pad.getButtonDown(InputComponent.A_Button) ||
      pad.getButtonDown(InputComponent.X_Button)
    ) {
      step += 1;
    }
    if (
      pad.getButtonDown(InputComponent.B_Button) ||
      pad.getButtonDown(InputComponent.Y_Button)
    ) {
      step -= 1;
    }
    return step;
  }
}
