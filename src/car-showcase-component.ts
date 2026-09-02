/**
 * Marks a vehicle that participates in the showroom carousel.
 *
 * System-free by contract: `src/components.ts` re-exports this through
 * `defineComponents()` so the editor can author it, and systems import the
 * declaration — never the reverse.
 */

import { createComponent, Types } from '@iwsdk/core';

export const CarShowcase = createComponent('CarShowcase', {
  /** Carousel order. The swapper cycles slots ascending; ties fall back to entity index. */
  slot: {
    type: Types.Int16,
    default: 0,
    label: 'Slot',
    min: 0,
    step: 1,
    help: 'Display order in the carousel. Lower shows first.',
  },
  /** Name shown on the spatial selector panel. */
  label: {
    type: Types.String,
    default: 'Unknown',
    label: 'Display name',
  },
});
