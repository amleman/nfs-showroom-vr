/**
 * Binds the technical data sheet to the machine on the floor, and carries the
 * environment switch.
 *
 * The three dimensions at the top are the measured bounds of the fitted model,
 * not figures quoted from the catalog. That is deliberate: the entire claim this
 * exhibit makes is that what a visitor is standing next to is the real size of
 * the machine, and the only way to keep the number honest is to read it off the
 * object after it has been scaled.
 *
 * Every row is authored in the panel and blanked rather than hidden when a
 * machine declares fewer than the maximum. Hiding one would move the control row
 * at the bottom, and a control that moves under the ray is a control that cannot
 * be clicked.
 */

import { createSystem, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { EnvironmentSwitcherSystem } from './environment-switcher.js';
import { MachineSwapperSystem } from './machine-swapper.js';

const PANEL_NODE_ID = 'machine-specs-panel';
/** Rows authored in the panel. Both must match `machine-specs.uikitml`. */
const SPEC_ROWS = 7;
const METRIC_ROWS = 4;
/** Width of the bar track, in the panel's own units. */
const BAR_TRACK_WIDTH = 452;

const BAR_COLOR = {
  ok: '#24a148',
  watch: '#f1a208',
  due: '#da1e28',
} as const;

export class SpecPanelSystem extends createSystem({}) {
  init(): void {
    const swapper = this.world.getSystem(MachineSwapperSystem);
    const environments = this.world.getSystem(EnvironmentSwitcherSystem);
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE_ID);
    if (swapper == null || panel == null) {
      return;
    }

    const reference = panel.getElementById<UIKit.Text>('spec-reference');
    const dimLength = panel.getElementById<UIKit.Text>('dim-length');
    const dimWidth = panel.getElementById<UIKit.Text>('dim-width');
    const dimHeight = panel.getElementById<UIKit.Text>('dim-height');
    if (reference == null || dimLength == null) {
      console.warn(`[SpecPanel] ${PANEL_NODE_ID} is missing elements`);
    }

    const specLabels: (UIKit.Text | null)[] = [];
    const specValues: (UIKit.Text | null)[] = [];
    for (let i = 0; i < SPEC_ROWS; i += 1) {
      specLabels.push(panel.getElementById<UIKit.Text>(`spec-${i}-label`));
      specValues.push(panel.getElementById<UIKit.Text>(`spec-${i}-value`));
    }
    const metricLabels: (UIKit.Text | null)[] = [];
    const metricValues: (UIKit.Text | null)[] = [];
    const metricBars: (UIKit.Text | null)[] = [];
    for (let i = 0; i < METRIC_ROWS; i += 1) {
      metricLabels.push(panel.getElementById<UIKit.Text>(`metric-${i}-label`));
      metricValues.push(panel.getElementById<UIKit.Text>(`metric-${i}-value`));
      metricBars.push(panel.getElementById<UIKit.Text>(`metric-${i}-bar`));
    }

    const render = (): void => {
      const entry = swapper.activeEntry;
      const fit = swapper.mountedFit;
      reference?.setProperties({ text: entry?.reference ?? '' });

      // Dashes rather than stale numbers while a model is still downloading:
      // the whole point of these three cells is that they are trustworthy.
      dimLength?.setProperties({ text: metres(fit?.length) });
      dimWidth?.setProperties({ text: metres(fit?.width) });
      dimHeight?.setProperties({ text: metres(fit?.height) });

      for (let i = 0; i < SPEC_ROWS; i += 1) {
        const row = entry?.specs[i];
        specLabels[i]?.setProperties({ text: row?.label ?? '' });
        specValues[i]?.setProperties({ text: row?.value ?? '' });
      }
      for (let i = 0; i < METRIC_ROWS; i += 1) {
        const metric = entry?.metrics[i];
        metricLabels[i]?.setProperties({ text: metric?.label ?? '' });
        metricValues[i]?.setProperties({ text: metric?.value ?? '' });
        metricBars[i]?.setProperties({
          width: Math.round(BAR_TRACK_WIDTH * (metric?.fill ?? 0)),
          backgroundColor: BAR_COLOR[metric?.state ?? 'ok'],
        });
      }
    };

    this.cleanupFuncs.push(
      // Fires immediately, so the sheet is correct on the first frame. The
      // revision rather than the label: it is bumped after the fit is measured,
      // and the dimensions are the reason this panel exists.
      swapper.mountedRevision.subscribe(render),
      swapper.activeLabel.subscribe(render),
    );

    if (environments == null) {
      return;
    }
    const envLabel = panel.getElementById<UIKit.Text>('env-label');
    const envButton = panel.getElementById('env-button');
    if (envButton != null) {
      const onSwitch = () => environments.next();
      envButton.addEventListener('click', onSwitch);
      this.cleanupFuncs.push(() =>
        envButton.removeEventListener('click', onSwitch),
      );
    }
    this.cleanupFuncs.push(
      environments.activeLabel.subscribe((label) => {
        envLabel?.setProperties({
          text: `${label} / ${environments.activeNote.peek()}`,
        });
      }),
    );
  }
}

/** One decimal is the right precision here: these are measured, not surveyed. */
function metres(value: number | undefined): string {
  return value == null ? '-' : `${value.toFixed(1)} m`;
}
