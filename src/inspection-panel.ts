/**
 * Binds the inspection panel to {@link InspectionHotspotSystem}.
 *
 * The panel and the 3D markers are two routes to one selection: clicking a
 * button here selects the same point as pointing at the marker on the machine,
 * and both update the same detail block. The panel is the guaranteed route —
 * a ten-centimetre marker on the far side of a fifty-metre hall is not something
 * a visitor should have to hit.
 *
 * All five buttons are always laid out. A machine with three inspection points
 * relabels the other two and ignores their clicks rather than hiding them,
 * because a control row that changes width is a control row whose buttons move
 * under the ray.
 */

import { createSystem, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { InspectionHotspotSystem } from './inspection-hotspots.js';
import { MachineSwapperSystem } from './machine-swapper.js';
import type { Hotspot } from './machine-catalog.js';

const PANEL_NODE_ID = 'inspection-panel';
/** Buttons authored in the panel. Must match `inspection.uikitml`. */
const BUTTON_COUNT = 5;
/** Dimming applied to a button the current machine does not use. */
const UNUSED_OPACITY = 0.3;

const KIND_LABEL: Record<Hotspot['kind'], string> = {
  sso: 'SEGURIDAD Y SALUD OCUPACIONAL',
  tec: 'ESPECIFICACION TECNICA',
  mto: 'MANTENIMIENTO PREVENTIVO',
};

const KIND_TAG: Record<Hotspot['kind'], string> = {
  sso: 'SSO',
  tec: 'TEC',
  mto: 'MTO',
};

const KIND_COLOR: Record<Hotspot['kind'], string> = {
  sso: '#ff8c1a',
  tec: '#0090c8',
  mto: '#1f9d55',
};

const EMPTY_TITLE = 'Seleccione un punto';
const EMPTY_BODY =
  'Toque un marcador sobre la maquina o un boton de esta lista para ver el criterio tecnico y de seguridad del punto.';

export class InspectionPanelSystem extends createSystem({}) {
  init(): void {
    const hotspots = this.world.getSystem(InspectionHotspotSystem);
    const swapper = this.world.getSystem(MachineSwapperSystem);
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE_ID);
    if (hotspots == null || swapper == null || panel == null) {
      return;
    }

    const kindField = panel.getElementById<UIKit.Text>('hot-kind');
    const titleField = panel.getElementById<UIKit.Text>('hot-title');
    const bodyField = panel.getElementById<UIKit.Text>('hot-body');
    if (kindField == null || titleField == null || bodyField == null) {
      console.warn(`[InspectionPanel] ${PANEL_NODE_ID} is missing elements`);
    }

    const buttons: (UIKit.Text | null)[] = [];
    const buttonLabels: (UIKit.Text | null)[] = [];
    for (let i = 0; i < BUTTON_COUNT; i += 1) {
      const button = panel.getElementById<UIKit.Text>(`hot-${i}`);
      buttons.push(button);
      buttonLabels.push(panel.getElementById<UIKit.Text>(`hot-${i}-label`));
      if (button == null) {
        continue;
      }
      // Selecting a point the current machine does not declare is a no-op rather
      // than an error: the button is dimmed, but it is still there and still
      // clickable, so it has to decline politely.
      const onClick = () => {
        if (i < (swapper.activeEntry?.hotspots.length ?? 0)) {
          hotspots.select(i);
        }
      };
      button.addEventListener('click', onClick);
      this.cleanupFuncs.push(() => button.removeEventListener('click', onClick));
    }

    /** Relabel the row for the machine that just mounted. */
    const renderButtons = (): void => {
      const list = swapper.activeEntry?.hotspots ?? [];
      for (let i = 0; i < BUTTON_COUNT; i += 1) {
        const hotspot = list[i];
        buttonLabels[i]?.setProperties({
          text: hotspot == null ? '-' : `${KIND_TAG[hotspot.kind]} ${i + 1}`,
        });
        buttons[i]?.setProperties({
          opacity: hotspot == null ? UNUSED_OPACITY : 1,
        });
      }
    };

    /** Render the selected point, or the prompt when there is none. */
    const renderDetail = (): void => {
      const hotspot = hotspots.selected;
      if (hotspot == null) {
        kindField?.setProperties({ text: '', color: KIND_COLOR.sso });
        titleField?.setProperties({ text: EMPTY_TITLE });
        bodyField?.setProperties({ text: EMPTY_BODY });
        return;
      }
      kindField?.setProperties({
        text: KIND_LABEL[hotspot.kind],
        color: KIND_COLOR[hotspot.kind],
      });
      titleField?.setProperties({ text: hotspot.title });
      bodyField?.setProperties({ text: hotspot.body });
    };

    this.cleanupFuncs.push(
      swapper.mountedRevision.subscribe(() => {
        renderButtons();
        renderDetail();
      }),
      hotspots.selectedIndex.subscribe(renderDetail),
    );
  }
}
