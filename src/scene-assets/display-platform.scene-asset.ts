/**
 * Display dais for the showroom's hero car.
 *
 * Deterministic and side-effect free: this module is evaluated twice, once by the
 * app runtime and once by the editor, in separate JS realms. Origin sits at floor
 * contact (local y = 0); the deck surface the car stands on is DECK_HEIGHT.
 */

import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from '@iwsdk/core';

/** Radius of the dais deck, in meters. Sized to clear a 4.6 m car with margin. */
const DECK_RADIUS = 2.7;
/** Height of the deck surface above the floor, in meters. */
export const DECK_HEIGHT = 0.16;
/** Radial segments — a 3.2 m disc read close-up, but still a VR frame budget. */
const RADIAL_SEGMENTS = 64;

const deckMaterial = new MeshStandardMaterial({
  color: '#15171a',
  roughness: 0.34,
  metalness: 0.9,
});

const skirtMaterial = new MeshStandardMaterial({
  color: '#0a0b0d',
  roughness: 0.72,
  metalness: 0.6,
});

// Amber rim light — the Most Wanted garage signature. Emissive rather than a real
// light so it costs nothing per frame.
const rimMaterial = new MeshStandardMaterial({
  color: '#20150a',
  roughness: 0.4,
  metalness: 0.3,
  emissive: '#ff8a1e',
  emissiveIntensity: 2.4,
});

const platform = new Group();
platform.name = 'Display platform';

const skirt = new Mesh(
  new CylinderGeometry(
    DECK_RADIUS,
    DECK_RADIUS * 1.02,
    DECK_HEIGHT,
    RADIAL_SEGMENTS,
  ),
  skirtMaterial,
);
skirt.position.y = DECK_HEIGHT / 2;
platform.add(skirt);

const deck = new Mesh(
  new CylinderGeometry(DECK_RADIUS * 0.97, DECK_RADIUS * 0.97, 0.02, RADIAL_SEGMENTS),
  deckMaterial,
);
deck.position.y = DECK_HEIGHT;
platform.add(deck);

const rim = new Mesh(
  new TorusGeometry(DECK_RADIUS * 0.985, 0.022, 8, RADIAL_SEGMENTS),
  rimMaterial,
);
rim.rotation.x = Math.PI / 2;
rim.position.y = DECK_HEIGHT - 0.01;
platform.add(rim);

export default platform;
