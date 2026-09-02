/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetType, defineAssets } from '@iwsdk/core';
import displayPlatform from './scene-assets/display-platform.scene-asset.js';

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
  // The garage is authored at ~1/10 scale (raw bounds 2.5 x 0.78 x 1.92 m) and
  // its floor sits at y = -0.24 in model space. The scene node carries the
  // scale-up and the matching lift, not this manifest.
  garage: {
    url: publicAssetUrl('gltf/garage/FVRBOW5K28TUGPPV2673XRH9I.gltf'),
    type: AssetType.GLTF,
    name: 'Garage',
    priority: 'critical',
  },
  'car-bmw-m3-gtr': {
    url: publicAssetUrl('gltf/cars/bmw_m3_gtr_e46_razor/scene.gltf'),
    type: AssetType.GLTF,
    name: 'BMW M3 GTR E46 (Razor)',
    priority: 'background',
  },
  // Processed copy: the original export carries an 11 m blended "floor" quad at
  // y = 0 that z-fights the garage floor. See the sibling *_azzurro_hyperion.glb
  // for the untouched download.
  'car-ferrari-550': {
    url: publicAssetUrl('gltf/cars/ferrari-550-barchetta.glb'),
    type: AssetType.GLTF,
    name: 'Ferrari 550 Barchetta',
    priority: 'background',
  },
  'car-selector': {
    url: publicAssetUrl('ui/car-selector.uikitml'),
    type: AssetType.UIKitML,
    name: 'Car Selector Panel',
  },
  'display-platform': displayPlatform,
});
