/**
 * Ambient background music, driven by a generated playlist.
 *
 * Tracks live in `public/audio/music/` and are discovered by
 * `scripts/generate-playlist.mjs` (npm run music), which writes the
 * `playlist.json` this system fetches — the browser cannot list a directory and
 * `public/` files are not module resources, so the manifest is how the runtime
 * learns what is there.
 *
 * Exactly one track is resident at a time. `AudioSystem` decodes a buffer as
 * soon as an entity carries a `src`, so keeping one entity per track would
 * decode the whole album into memory at startup — minutes of PCM. Instead the
 * entity is built for the current track and disposed when it ends.
 */

import { AudioSource, AudioUtils, createSystem, Entity, signal } from '@iwsdk/core';

/** Ambient bed, not the main event — it sits under the room tone. */
const DEFAULT_VOLUME = 0.3;

interface PlaylistTrack {
  src: string;
  title: string;
}

export class MusicSystem extends createSystem({}) {
  /** Title of the current track, for a future now-playing readout. */
  readonly nowPlaying = signal('');
  /** False until a playlist with at least one track has loaded. */
  readonly hasTracks = signal(false);

  private tracks: PlaylistTrack[] = [];
  private index = 0;
  private entity: Entity | undefined;
  /** Guards the gap between requesting playback and the buffer actually starting. */
  private confirmedPlaying = false;

  init(): void {
    void this.loadPlaylist();
  }

  update(): void {
    if (this.tracks.length === 0) {
      return;
    }
    if (this.entity == null) {
      this.playCurrent();
      return;
    }
    if (AudioUtils.isPlaying(this.entity)) {
      this.confirmedPlaying = true;
      return;
    }
    // Only treat silence as "finished" once we have seen it playing. Before that
    // the buffer is still decoding, or the AudioContext is still suspended
    // waiting on a user gesture.
    if (this.confirmedPlaying) {
      this.advance();
    }
  }

  /** Skip to the next track immediately. Wraps at the end of the playlist. */
  next(): void {
    if (this.tracks.length === 0) {
      return;
    }
    this.advance();
  }

  private async loadPlaylist(): Promise<void> {
    const url = `${import.meta.env.BASE_URL}audio/music/playlist.json`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { tracks?: PlaylistTrack[] };
      this.tracks = (data.tracks ?? []).filter((track) => track?.src != null);
    } catch (error) {
      console.warn(
        '[Music] No playlist found. Drop .mp3 files in public/audio/music/ and run `npm run music`.',
        error,
      );
      return;
    }

    if (this.tracks.length === 0) {
      console.warn(
        '[Music] playlist.json is empty. Add tracks to public/audio/music/ and re-run `npm run music`.',
      );
      return;
    }
    this.hasTracks.value = true;
  }

  private playCurrent(): void {
    const track = this.tracks[this.index];
    if (track == null) {
      return;
    }
    const entity = this.world.createEntity();
    entity.addComponent(AudioSource, {
      src: `${import.meta.env.BASE_URL}${track.src.replace(/^\/+/u, '')}`,
      volume: DEFAULT_VOLUME,
      // Ambient rather than positional: music should not fall off as the player
      // walks around the garage.
      positional: false,
      loop: false,
      autoplay: true,
    });
    this.entity = entity;
    this.confirmedPlaying = false;
    this.nowPlaying.value = track.title;
  }

  private advance(): void {
    this.entity?.dispose();
    this.entity = undefined;
    this.confirmedPlaying = false;
    this.index = (this.index + 1) % this.tracks.length;
  }
}
