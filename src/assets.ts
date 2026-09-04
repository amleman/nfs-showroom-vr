/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetType, defineAssets } from '@iwsdk/core';
import displayPlatform from './scene-assets/display-platform.scene-asset.js';
import ledStrip from './scene-assets/led-strip.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;
const DEFAULT_STOCK_ASSET_BASE =
  'https://cdn.jsdelivr.net/npm/@iwsdk/example-assets@0.4.2/assets';
const configuredStockAssetBase =
  import.meta.env.VITE_IWSDK_EXAMPLE_ASSET_BASE_URL?.trim();
const stockAssetBase = (
  configuredStockAssetBase || DEFAULT_STOCK_ASSET_BASE
).replace(/\/+$/u, '');

function stockAssetUrl(assetId: string, fileName: string): string {
  return `${stockAssetBase}/${assetId}/${fileName}`;
}

export default defineAssets({
  'environment-desk': {
    url: stockAssetUrl('environment-desk', 'environmentDesk.gltf'),
    type: AssetType.GLTF,
    name: 'Environment Desk',
    priority: 'lazy',
  },
  'plant-sansevieria': {
    url: stockAssetUrl('plant-sansevieria', 'plantSansevieria.gltf'),
    type: AssetType.GLTF,
    name: 'Plant Sansevieria',
    priority: 'lazy',
  },
  robot: {
    url: stockAssetUrl('robot', 'robot.gltf'),
    type: AssetType.GLTF,
    name: 'Robot',
    priority: 'lazy',
  },
  'welcome-panel': {
    url: publicAssetUrl('ui/welcome.uikitml'),
    type: AssetType.UIKitML,
    name: 'Welcome Panel',
  },
  'webxr-banner': {
    url: publicAssetUrl('gltf/webxr-banner/banner.gltf'),
    type: AssetType.GLTF,
    name: 'WebXR Banner',
    priority: 'lazy',
  },

  // --- NFS showroom ---------------------------------------------------------
  // Every model below resolves to `gltf/optimized/`, which is GENERATED from the
  // sources beside it by `npm run models` (wired into predev/prebuild). Those
  // sources are desktop assets: the catalog needs 4.5 GB of texture VRAM as
  // downloaded, against roughly 1 GB of headroom on a Quest 3. The generated
  // copies need 525 MB. Point these URLs back at the raw files and the app dies
  // on the fourth car. Edit the source, not `optimized/`.
  //
  // The garage is authored at ~1/10 scale (raw bounds 2.5 x 0.78 x 1.92 m) and
  // its floor sits at y = -0.24 in model space. The scene node carries the
  // scale-up and the matching lift, not this manifest.
  garage: {
    url: publicAssetUrl('gltf/optimized/garage.glb'),
    type: AssetType.GLTF,
    name: 'Garage',
    priority: 'critical',
  },
  'car-bmw-m3-gtr': {
    url: publicAssetUrl('gltf/optimized/cars/bmw_m3_gtr_e46_razor.glb'),
    type: AssetType.GLTF,
    name: 'BMW M3 GTR E46 (Razor)',
    priority: 'lazy',
  },
  // Processed copy: the original export carries an 11 m blended "floor" quad at
  // y = 0 that z-fights the garage floor. See the sibling *_azzurro_hyperion.glb
  // for the untouched download.
  'car-ferrari-550': {
    url: publicAssetUrl('gltf/optimized/cars/ferrari-550-barchetta.glb'),
    type: AssetType.GLTF,
    name: 'Ferrari 550 Barchetta',
    priority: 'lazy',
  },
  // The rest of the carousel. All 'lazy': CarSwapperSystem loads each on demand
  // and holds a bounded number resident, so preloading them would defeat the
  // memory bound the swapper exists to enforce.
  'car-bmw-m3-gtr-black': {
    url: publicAssetUrl('gltf/optimized/cars/bmw_m3_gtr_e46_black.glb'),
    type: AssetType.GLTF,
    name: 'BMW M3 GTR E46 (Black)',
    priority: 'lazy',
  },
  'car-camaro-ss-350': {
    url: publicAssetUrl('gltf/optimized/cars/1967_chevrolet_camaro_ss_350_coupe.glb'),
    type: AssetType.GLTF,
    name: 'Chevrolet Camaro SS 350 (1967)',
    priority: 'lazy',
  },
  'car-charger-daytona': {
    url: publicAssetUrl(
      'gltf/optimized/cars/doms_dodge_charger_daytona_1969_fastfurious_6.glb',
    ),
    type: AssetType.GLTF,
    name: 'Dodge Charger Daytona (1969)',
    priority: 'lazy',
  },
  'car-dodge-pickup': {
    url: publicAssetUrl('gltf/optimized/cars/dodge_b-series_pickup_1953_x_mas_car.glb'),
    type: AssetType.GLTF,
    name: 'Dodge B-Series Pickup (1953)',
    priority: 'lazy',
  },
  'car-bugatti-eb110': {
    url: publicAssetUrl('gltf/optimized/cars/bugatti_eb110_super_sport_1992.glb'),
    type: AssetType.GLTF,
    name: 'Bugatti EB110 Super Sport (1992)',
    priority: 'lazy',
  },
  'car-jiotto-caspita': {
    url: publicAssetUrl('gltf/optimized/cars/Jiotto_Caspita_Roadster.glb'),
    type: AssetType.GLTF,
    name: 'Jiotto Caspita Roadster',
    priority: 'lazy',
  },

  'sound-system': {
    url: publicAssetUrl('gltf/optimized/sound_system.glb'),
    type: AssetType.GLTF,
    name: 'Sound System',
    priority: 'critical',
  },
  'car-selector': {
    url: publicAssetUrl('ui/car-selector.uikitml'),
    type: AssetType.UIKitML,
    name: 'Car Selector Panel',
  },
  'music-player': {
    url: publicAssetUrl('ui/music_player.uikitml'),
    type: AssetType.UIKitML,
    name: 'Music Player Panel',
  },
  'display-platform': displayPlatform,
  'led-strip': ledStrip,
});
