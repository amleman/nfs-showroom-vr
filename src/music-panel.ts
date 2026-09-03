/**
 * Binds the spatial music panel to {@link MusicPlayerSystem}.
 *
 * Same contract as the car selector: the panel is scene-authored, so it is
 * resolved by its stable scene node id, and its buttons drive the player while
 * the player's signals drive the readout. Neither side knows about the other, so
 * a track change from any source keeps the panel in sync.
 */

import { createSystem, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { MusicPlayerSystem } from './music-player.js';

const PANEL_NODE_ID = 'music-player-panel';
/** Longer titles are truncated so they cannot reflow the panel. */
const MAX_TITLE_LENGTH = 34;

export class MusicPanelSystem extends createSystem({}) {
  init(): void {
    const music = this.world.getSystem(MusicPlayerSystem);
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE_ID);
    if (music == null || panel == null) {
      return;
    }

    const prevButton = panel.getElementById('prev-track');
    const nextButton = panel.getElementById('next-track');
    const playButton = panel.getElementById('play-pause');
    const playLabel = panel.getElementById<UIKit.Text>('play-label');
    const trackField = panel.getElementById<UIKit.Text>('track-name');

    // A renamed or removed element id would otherwise fail silently: the panel
    // still renders, it just stops responding.
    if (
      prevButton == null ||
      nextButton == null ||
      playButton == null ||
      playLabel == null ||
      trackField == null
    ) {
      console.warn(
        `[MusicPanel] ${PANEL_NODE_ID} is missing expected elements`,
        {
          'prev-track': prevButton != null,
          'next-track': nextButton != null,
          'play-pause': playButton != null,
          'track-name': trackField != null,
          'play-label': playLabel != null,
        },
      );
    }

    if (prevButton != null) {
      const onPrev = () => music.prevTrack();
      prevButton.addEventListener('click', onPrev);
      this.cleanupFuncs.push(() =>
        prevButton.removeEventListener('click', onPrev),
      );
    }
    if (nextButton != null) {
      const onNext = () => music.nextTrack();
      nextButton.addEventListener('click', onNext);
      this.cleanupFuncs.push(() =>
        nextButton.removeEventListener('click', onNext),
      );
    }
    if (playButton != null) {
      const onToggle = () => music.toggle();
      playButton.addEventListener('click', onToggle);
      this.cleanupFuncs.push(() =>
        playButton.removeEventListener('click', onToggle),
      );
    }

    // Signal subscriptions fire immediately with the current value, so the panel
    // is correct on its first frame without a manual priming call.
    this.cleanupFuncs.push(
      music.currentTrackName.subscribe((title) => {
        trackField?.setProperties({
          text: title === '' ? 'No tracks' : truncate(title),
        });
      }),
      music.isPlaying.subscribe((playing) => {
        playLabel?.setProperties({ text: playing ? 'Pause' : 'Play' });
      }),
    );
  }
}

function truncate(title: string): string {
  return title.length <= MAX_TITLE_LENGTH
    ? title
    : `${title.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`;
}
