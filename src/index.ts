/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { startLanding } from './landing.js';
import { AmbienceSystem } from './ambience.js';
import { DesktopNavigationSystem } from './desktop-navigation.js';
import { EnvironmentSwitcherSystem } from './environment-switcher.js';
import { HotspotCardSystem } from './hotspot-card.js';
import { InspectionHotspotSystem } from './inspection-hotspots.js';
import { InspectionPanelSystem } from './inspection-panel.js';
import { MachineSelectorPanelSystem } from './machine-selector-panel.js';
import { MachineSwapperSystem } from './machine-swapper.js';
import { MachineTitleSystem } from './machine-title.js';
import { MachineTurntableSystem } from './machine-turntable.js';
import { RenderTuningSystem } from './render-tuning.js';
import { SpecPanelSystem } from './spec-panel.js';
import {
  TurnPivotCaptureSystem,
  TurnPivotCorrectSystem,
} from './turn-pivot.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // Order matters: each of these resolves the previous one during its own init().
  world.registerSystem(MachineSwapperSystem);
  world.registerSystem(MachineTurntableSystem);
  world.registerSystem(EnvironmentSwitcherSystem);

  // After the swapper: the markers are rebuilt from its measured fit.
  world.registerSystem(InspectionHotspotSystem);
  // After the hotspots and the turntable: it follows the selected marker and
  // hides itself when that marker is about to be turned away.
  world.registerSystem(HotspotCardSystem);
  // The headline over the exhibit. Reads the swapper's measured fit for height.
  world.registerSystem(MachineTitleSystem);

  // Panels last among the feature systems; every one of them resolves a system
  // above and subscribes to its signals.
  world.registerSystem(MachineSelectorPanelSystem);
  world.registerSystem(SpecPanelSystem);
  world.registerSystem(InspectionPanelSystem);

  // Mouse look for the browser. Dormant until the landing page hands over.
  world.registerSystem(DesktopNavigationSystem);
  // Room tone. Also dormant: a browser will not start an AudioContext outside a
  // user gesture, so the landing page's own button is what wakes it.
  world.registerSystem(AmbienceSystem);

  // After the swapper and turntable: it subscribes to both to decide when the
  // shadow map is worth rebuilding.
  world.registerSystem(RenderTuningSystem);

  // Bracket the built-in TurnSystem (priority 0) so turning pivots on the head
  // instead of the play-space origin.
  world.registerSystem(TurnPivotCaptureSystem, { priority: -10 });
  world.registerSystem(TurnPivotCorrectSystem, { priority: 10 });

  // Last: the landing page hands the camera to DesktopNavigationSystem when the
  // visitor asks to go in, so that system has to exist by the time it runs.
  startLanding(world);
});
