/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CarSeatSystem } from './car-seat.js';
import { CarSelectorPanelSystem } from './car-selector-panel.js';
import { CarSwapperSystem } from './car-swapper.js';
import { AudioReactiveLedSystem } from './audio-reactive-led.js';
import { CarTurntableSystem } from './car-turntable.js';
import { MusicPanelSystem } from './music-panel.js';
import { MusicPlayerSystem } from './music-player.js';
import { PanelSystem } from './panel.js';
import { RenderTuningSystem } from './render-tuning.js';
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
  world.registerSystem(CarSwapperSystem);
  world.registerSystem(CarTurntableSystem);
  world.registerSystem(CarSelectorPanelSystem);

  // After the swapper and turntable, whose input it suspends while seated.
  world.registerSystem(CarSeatSystem);

  // Player before the panel and the LEDs; both read its signals/analyser.
  world.registerSystem(MusicPlayerSystem);
  world.registerSystem(MusicPanelSystem);
  world.registerSystem(AudioReactiveLedSystem);

  world.registerSystem(PanelSystem);

  // After the swapper and turntable: it subscribes to both to decide when the
  // shadow map is worth rebuilding.
  world.registerSystem(RenderTuningSystem);

  // Bracket the built-in TurnSystem (priority 0) so turning pivots on the head
  // instead of the play-space origin.
  world.registerSystem(TurnPivotCaptureSystem, { priority: -10 });
  world.registerSystem(TurnPivotCorrectSystem, { priority: 10 });
});
