/**
 * Binds the spatial selector panel to {@link MachineSwapperSystem} and
 * {@link MachineTurntableSystem}.
 *
 * The panel is scene-authored, so it is resolved by its stable scene node id —
 * never by entity index or manifest URL. Buttons drive the systems; the systems'
 * signals drive the readout, so controller input and panel clicks stay in sync
 * without either side knowing about the other.
 */

import { createSystem, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { MachineSwapperSystem } from './machine-swapper.js';
import { MachineTurntableSystem } from './machine-turntable.js';

const PANEL_NODE_ID = 'machine-selector-panel';
/** Loading pulse, in cycles per second. */
const PULSE_HZ = 1.6;
/** Throttle: the dot only needs to look alive, not update every frame. */
const PULSE_INTERVAL = 1 / 20;
const DOT_IDLE_COLOR = '#d4d7dd';
/** Dimming applied to a control that is currently a no-op. */
const DISABLED_OPACITY = 0.4;

export class MachineSelectorPanelSystem extends createSystem({}) {
  private loadDot: UIKit.Text | null | undefined;
  private isLoading = false;
  private pulseClock = 0;
  private pulseAccumulator = 0;

  init(): void {
    const swapper = this.world.getSystem(MachineSwapperSystem);
    const turntable = this.world.getSystem(MachineTurntableSystem);
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE_ID);
    if (swapper == null || turntable == null || panel == null) {
      return;
    }

    const prevButton = panel.getElementById('prev-machine');
    const nextButton = panel.getElementById('next-machine');
    const turnButton = panel.getElementById('turn-machine');
    const cycleButton = panel.getElementById('cycle-machine');
    const cycleLabel = panel.getElementById<UIKit.Text>('cycle-machine-label');
    const categoryField = panel.getElementById<UIKit.Text>('machine-category');
    const nameField = panel.getElementById<UIKit.Text>('machine-name');
    const positionField = panel.getElementById<UIKit.Text>('machine-position');
    this.loadDot = panel.getElementById<UIKit.Text>('load-dot');

    // A renamed or removed element id would otherwise fail silently: the panel
    // still renders, it just stops responding.
    if (
      prevButton == null ||
      nextButton == null ||
      turnButton == null ||
      cycleButton == null ||
      categoryField == null ||
      nameField == null ||
      positionField == null ||
      this.loadDot == null
    ) {
      console.warn(`[MachineSelectorPanel] ${PANEL_NODE_ID} is missing elements`, {
        'prev-machine': prevButton != null,
        'next-machine': nextButton != null,
        'turn-machine': turnButton != null,
        'cycle-machine': cycleButton != null,
        'machine-category': categoryField != null,
        'machine-name': nameField != null,
        'machine-position': positionField != null,
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
    if (turnButton != null) {
      const onTurn = () => turntable.spin();
      turnButton.addEventListener('click', onTurn);
      this.cleanupFuncs.push(
        () => turnButton.removeEventListener('click', onTurn),
        // Dimmed for the duration of the revolution, so a second press during
        // the turn reads as deliberately ignored rather than broken.
        turntable.spinning.subscribe((spinning) => {
          turnButton.setProperties({ opacity: spinning ? 0.45 : 1 });
        }),
      );
    }
    if (cycleButton != null) {
      const onCycle = () => swapper.toggleCycle();
      cycleButton.addEventListener('click', onCycle);
      this.cleanupFuncs.push(
        () => cycleButton.removeEventListener('click', onCycle),
        // Most of these machines ship no animation at all. Dimming the control
        // on those makes "nothing happened" read as intentional.
        swapper.hasCycle.subscribe((hasCycle) => {
          cycleButton.setProperties({
            opacity: hasCycle ? 1 : DISABLED_OPACITY,
          });
          cycleLabel?.setProperties({ text: hasCycle ? 'Animar' : 'Sin ciclo' });
        }),
        // The label names the action the button will perform, not the state it
        // is in: on a two-state control those read the same way round to nobody.
        swapper.cycleRunning.subscribe((running) => {
          if (swapper.hasCycle.peek()) {
            cycleLabel?.setProperties({ text: running ? 'Pausar' : 'Animar' });
          }
        }),
      );
    }

    // Signal subscriptions fire immediately with the current value, so the panel
    // shows the right machine on the first frame without a manual priming call.
    this.cleanupFuncs.push(
      swapper.activeLabel.subscribe((label) => {
        nameField?.setProperties({ text: label === '' ? 'Sin equipo' : label });
        categoryField?.setProperties({
          text: swapper.activeEntry?.category ?? '',
        });
      }),
      swapper.activePosition.subscribe(() =>
        this.renderPosition(swapper, positionField),
      ),
      swapper.machineCount.subscribe(() =>
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

    // Instrument blue, breathing between dim and bright. Colour rather than
    // opacity or display: those either shift the layout or are not reliably
    // supported.
    const wave = 0.5 + 0.5 * Math.sin(this.pulseClock * PULSE_HZ * Math.PI * 2);
    const blue = Math.round(120 + wave * 135);
    const green = Math.round(70 + wave * 110);
    this.loadDot.setProperties({
      backgroundColor: `rgb(${Math.round(green * 0.3)}, ${green}, ${blue})`,
    });
  }

  private renderPosition(
    swapper: MachineSwapperSystem,
    field: UIKit.Text | null | undefined,
  ): void {
    if (field == null) {
      return;
    }
    // peek(): this runs inside another signal's subscription, and reading .value
    // here would widen that subscription's dependency set.
    field.setProperties({
      text: `EQUIPO ${swapper.activePosition.peek()} DE ${swapper.machineCount.peek()}`,
    });
  }
}
