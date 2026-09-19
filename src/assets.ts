/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  // --- Showrooms ------------------------------------------------------------
  // Both environments stay resident. Together they are 0.7 MB and 9 500
  // triangles, which is nothing next to a single machine, and keeping them
  // loaded is what makes the switch between them instant.
  'showroom-gallery': {
    url: publicAssetUrl('gltf/industrial/vr_exhibition_gallery_baked.glb'),
    type: AssetType.GLTF,
    name: 'Galeria de exhibicion',
    priority: 'critical',
  },
  'showroom-studio': {
    url: publicAssetUrl('gltf/industrial/studio_v1_for_car.glb'),
    type: AssetType.GLTF,
    name: 'Nave industrial',
    priority: 'critical',
  },

  // --- Machines -------------------------------------------------------------
  // Every model below resolves to `gltf/industrial/`, which is GENERATED from
  // the downloads beside it by `npm run models` (wired into predev/prebuild).
  // Point these URLs at the sources and five of the seven need a DRACO decoder
  // fetched from a CDN at runtime, and two carry `EXT_meshopt_compression`,
  // which this runtime has no decoder for at all and simply fails to open. Edit
  // the source, not `industrial/`.
  //
  // All 'lazy': MachineSwapperSystem loads each on demand and holds a bounded
  // number resident, so preloading them would defeat the memory bound the
  // swapper exists to enforce.
  'machine-dump-truck': {
    url: publicAssetUrl('gltf/industrial/dump_truck.glb'),
    type: AssetType.GLTF,
    name: 'Camion minero de acarreo',
    priority: 'lazy',
  },
  'machine-excavator': {
    url: publicAssetUrl('gltf/industrial/excavator_cat.glb'),
    type: AssetType.GLTF,
    name: 'Excavadora hidraulica de orugas',
    priority: 'lazy',
  },
  'machine-backhoe': {
    url: publicAssetUrl('gltf/industrial/jcb_backhoe_loader.glb'),
    type: AssetType.GLTF,
    name: 'Retroexcavadora cargadora',
    priority: 'lazy',
  },
  'machine-robot-arm': {
    url: publicAssetUrl('gltf/industrial/black_honey_robotic_arm.glb'),
    type: AssetType.GLTF,
    name: 'Brazo robotico industrial',
    priority: 'lazy',
  },
  'machine-precision-arm': {
    url: publicAssetUrl('gltf/industrial/medical_robotic_arm.glb'),
    type: AssetType.GLTF,
    name: 'Brazo robotico de precision',
    priority: 'lazy',
  },
  'machine-service-truck': {
    url: publicAssetUrl('gltf/industrial/gmc_sierra_hd2500.glb'),
    type: AssetType.GLTF,
    name: 'Camioneta de servicio pesado',
    priority: 'lazy',
  },
  'machine-tracked-vehicle': {
    url: publicAssetUrl('gltf/industrial/simple_tank.glb'),
    type: AssetType.GLTF,
    name: 'Vehiculo blindado de oruga',
    priority: 'lazy',
  },

  // --- Panels ---------------------------------------------------------------
  'welcome-panel': {
    url: publicAssetUrl('ui/welcome.uikitml'),
    type: AssetType.UIKitML,
    name: 'Panel de bienvenida',
  },
  'machine-selector': {
    url: publicAssetUrl('ui/machine-selector.uikitml'),
    type: AssetType.UIKitML,
    name: 'Selector de equipo',
  },
  'machine-specs': {
    url: publicAssetUrl('ui/machine-specs.uikitml'),
    type: AssetType.UIKitML,
    name: 'Ficha tecnica',
  },
  'inspection-panel': {
    url: publicAssetUrl('ui/inspection.uikitml'),
    type: AssetType.UIKitML,
    name: 'Puntos de inspeccion',
  },
});
