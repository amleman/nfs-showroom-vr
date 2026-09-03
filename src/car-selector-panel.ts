/**
 * Binds the spatial selector panel to {@link CarSwapperSystem} and
 * {@link CarTurntableSystem}.
 *
 * The panel is scene-authored, so it is resolved by its stable scene node id —
 * never by entity index or manifest URL. Buttons drive the systems; their
 * signals drive the readout, so controller input and panel clicks stay in sync
 * without either side knowing about the other.
 */

import { createSystem, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { CarSwapperSystem } from './car-swapper.js';
import { CarTurntableSystem } from './car-turntable.js';

const PANEL_NODE_ID = 'car-selector-panel';
/** Loading pulse, in cycles per second. */
const PULSE_HZ = 1.6;
/** Throttle: the dot only needs to look alive, not update every frame. */
const PULSE_INTERVAL = 1 / 20;
const DOT_IDLE_COLOR = '#dcdcdc';

export class CarSelectorPanelSystem extends createSystem({}) {
  private swapper: CarSwapperSystem | undefined;
  private loadDot: UIKit.Text | null | undefined;
  private isLoading = false;
  private pulseClock = 0;
  private pulseAccumulator = 0;

  init(): void {
    const swapper = this.world.getSystem(CarSwapperSystem);
    const turntable = this.world.getSystem(CarTurntableSystem);
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE_ID);
    if (swapper == null || turntable == null || panel == null) {
      return;
    }
    this.swapper = swapper;

    const prevButton = panel.getElementById('prev-car');
    const nextButton = panel.getElementById('next-car');
    const spinButton = panel.getElementById('spin-car');
    const nameField = panel.getElementById<UIKit.Text>('car-name');
    const positionField = panel.getElementById<UIKit.Text>('car-position');
    this.loadDot = panel.getElementById<UIKit.Text>('load-dot');

    // A renamed or removed element id would otherwise fail silently: the panel
    // still renders, it just stops responding.
    if (
      prevButton == null ||
      nextButton == null ||
      spinButton == null ||
      nameField == null ||
      positionField == null ||
      this.loadDot == null
    ) {
      console.warn(`[CarSelectorPanel] ${PANEL_NODE_ID} is missing elements`, {
        'prev-car': prevButton != null,
        'next-car': nextButton != null,
        'spin-car': spinButton != null,
        'car-name': nameField != null,
        'car-position': positionField != null,
        'load-dot': this.loadDot != null,
      });
    }

    if (prevButton != null) {
      const onPrev = () => swapper.previous();
      prevButton.addEventListener('click', onPrev);
      this.cleanupFuncs.push(() =>
        prevButton.removeEventListener('click', onPrev),
      );
    }
    if (nextButton != null) {
      const onNext = () => swapper.next();
      nextButton.addEventListener('click', onNext);
      this.cleanupFuncs.push(() =>
        nextButton.removeEventListener('click', onNext),
      );
    }
    if (spinButton != null) {
      const onSpin = () => turntable.spin();
      spinButton.addEventListener('click', onSpin);
      this.cleanupFuncs.push(() =>
        spinButton.removeEventListener('click', onSpin),
      );
      // Dim the control for the duration of the revolution so a second press
      // during the spin reads as intentionally ignored rather than broken.
      this.cleanupFuncs.push(
        turntable.spinning.subscribe((spinning) => {
          spinButton.setProperties({ opacity: spinning ? 0.45 : 1 });
        }),
      );
    }

    // Signal subscriptions fire immediately with the current value, so the panel
    // shows the right car on the first frame without a manual priming call.
    this.cleanupFuncs.push(
      swapper.activeLabel.subscribe((label) => {
        nameField?.setProperties({ text: label === '' ? 'No vehicle' : label });
      }),
      swapper.activePosition.subscribe(() =>
        this.renderPosition(swapper, positionField),
      ),
      swapper.carCount.subscribe(() =>
        this.renderPosition(swapper, positionField),
      ),
      swapper.loading.subscribe((loading) => {
        this.isLoading = loading;
        this.pulseClock = 0;
        if (!loading) {
          this.loadDot?.setProperties({ backgroundColor: DOT_IDLE_COLOR });
        }
      }),
    );
  }

  /** Pulses the loading dot while a model is downloading. */
  update(delta: number): void {
    if (!this.isLoading || this.loadDot == null) {
      return;
    }
    this.pulseAccumulator += delta;
    if (this.pulseAccumulator < PULSE_INTERVAL) {
      return;
    }
    this.pulseAccumulator = 0;
    this.pulseClock += PULSE_INTERVAL;

    // Amber, breathing between dim and bright. Colour rather than opacity or
    // display: those either shift the layout or are not reliably supported.
    const wave = 0.5 + 0.5 * Math.sin(this.pulseClock * PULSE_HZ * Math.PI * 2);
    const channel = Math.round(90 + wave * 165);
    const blue = Math.round(20 + wave * 40);
    this.loadDot.setProperties({
      backgroundColor: `rgb(${channel}, ${Math.round(channel * 0.6)}, ${blue})`,
    });
  }

  private renderPosition(
    swapper: CarSwapperSystem,
    field: UIKit.Text | null | undefined,
  ): void {
    if (field == null) {
      return;
    }
    // peek(): this runs inside another signal's subscription, and reading .value
    // here would widen that subscription's dependency set.
    field.setProperties({
      text: `${swapper.activePosition.peek()} / ${swapper.carCount.peek()}`,
    });
  }
}
