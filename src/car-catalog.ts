/**
 * The showroom carousel, in display order.
 *
 * Cars are listed here rather than authored as scene nodes because they load on
 * demand: nine models is ~165 MB of source and ~720k triangles, far too much to
 * hold resident on a Quest 3 just to show one at a time.
 *
 * Scale, ground planes and Z-up orientation are corrected at load time by
 * `fitCarToStage`, so a new entry usually needs nothing but an id and a label.
 * `yawDeg` is the only styling knob: the presentation angle on the dais.
 */

export interface CarEntry {
  /** Manifest asset id from `src/assets.ts`. */
  assetId: string;
  /** Shown on the selector panel. */
  label: string;
  /**
   * Presentation yaw on the dais, applied after the fit. Every model is
   * auto-centred but they do not agree on which way is forward, so this is set
   * per car by eye.
   */
  yawDeg: number;
}

export const CAR_CATALOG: readonly CarEntry[] = [
  { assetId: 'car-bmw-m3-gtr', label: 'BMW M3 GTR (Razor)', yawDeg: -60 },
  { assetId: 'car-bmw-m3-gtr-black', label: 'BMW M3 GTR (Black)', yawDeg: 30 },
  { assetId: 'car-ferrari-550', label: 'Ferrari 550 Barchetta', yawDeg: 30 },
  { assetId: 'car-bugatti-eb110', label: 'Bugatti EB110 Super Sport', yawDeg: 30 },
  { assetId: 'car-camaro-ss-350', label: 'Chevrolet Camaro SS 350', yawDeg: 30 },
  { assetId: 'car-charger-daytona', label: 'Dodge Charger Daytona', yawDeg: 30 },
  { assetId: 'car-dodge-pickup', label: 'Dodge B-Series Pickup', yawDeg: 30 },
  { assetId: 'car-jiotto-caspita', label: 'Jiotto Caspita Roadster', yawDeg: 30 },
];
