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
import { MusicSystem } from './music.js';
import { PanelSystem } from './panel.js';
import { RobotSystem } from './robot.js';
import {
  TurnPivotCaptureSystem,
  TurnPivotCorrectSystem,
} from './turn-pivot.js';

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
  world.registerSystem(MusicSystem);
  world.registerSystem(PanelSystem);

  // Bracket the built-in TurnSystem (priority 0) so turning pivots on the head
  // instead of the play-space origin.
  world.registerSystem(TurnPivotCaptureSystem, { priority: -10 });
  world.registerSystem(TurnPivotCorrectSystem, { priority: 10 });
});
