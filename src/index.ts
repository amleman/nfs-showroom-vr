/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CarFinishSystem } from './car-finish.js';
import { CarSelectorPanelSystem } from './car-selector-panel.js';
import { CarSwapperSystem } from './car-swapper.js';
import { CarTurntableSystem } from './car-turntable.js';
import { PanelSystem } from './panel.js';
import { RobotSystem } from './robot.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(RobotSystem);
  // Order matters: each of these resolves the previous one during its own init().
  // Swapper -> turntable (needs activeEntity) -> panel (needs both).
  world.registerSystem(CarSwapperSystem);
  world.registerSystem(CarTurntableSystem);
  world.registerSystem(CarSelectorPanelSystem);
  world.registerSystem(CarFinishSystem);
  world.registerSystem(PanelSystem);
});
