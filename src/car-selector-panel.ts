/**
 * Binds the spatial selector panel to {@link CarSwapperSystem}.
 *
 * The panel is scene-authored, so it is resolved by its stable scene node id —
 * never by entity index or manifest URL. Buttons drive the swapper; the swapper's
 * signals drive the readout, so controller input and panel clicks stay in sync
 * without either side knowing about the other.
 */

import { createSystem, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { CarSwapperSystem } from './car-swapper.js';
import { CarTurntableSystem } from './car-turntable.js';

const PANEL_NODE_ID = 'car-selector-panel';

export class CarSelectorPanelSystem extends createSystem({}) {
  init(): void {
    const swapper = this.world.getSystem(CarSwapperSystem);
    const turntable = this.world.getSystem(CarTurntableSystem);
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE_ID);
    if (swapper == null || turntable == null || panel == null) {
      return;
    }

    const prevButton = panel.getElementById('prev-car');
    const nextButton = panel.getElementById('next-car');
    const spinButton = panel.getElementById('spin-car');
    const nameField = panel.getElementById<UIKit.Text>('car-name');
    const positionField = panel.getElementById<UIKit.Text>('car-position');

    // A renamed or removed element id would otherwise fail silently: the panel
    // still renders, it just stops responding.
    if (
      prevButton == null ||
      nextButton == null ||
      spinButton == null ||
      nameField == null ||
      positionField == null
    ) {
      console.warn(
        `[CarSelectorPanel] ${PANEL_NODE_ID} is missing expected elements`,
        {
          'prev-car': prevButton != null,
          'next-car': nextButton != null,
          'spin-car': spinButton != null,
          'car-name': nameField != null,
          'car-position': positionField != null,
        },
      );
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
      swapper.activePosition.subscribe(() => this.renderPosition(swapper, positionField)),
      swapper.carCount.subscribe(() => this.renderPosition(swapper, positionField)),
    );
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
