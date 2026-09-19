/**
 * Tag for the inspection markers `InspectionHotspotSystem` puts on a machine.
 *
 * Declared in its own system-free module, and listed in `src/components.ts`, the
 * way every component in an IWSDK project has to be. The system needs a query it
 * can join against `Pressed` and `Hovered` that does not also match the spatial
 * panels — every one of which is a `RayInteractable` too.
 */

import { createComponent, Types } from '@iwsdk/core';

export const InspectionPoint = createComponent('InspectionPoint', {
  /** Index into the active machine's `hotspots` array. */
  index: { type: Types.Int16, default: 0 },
});
