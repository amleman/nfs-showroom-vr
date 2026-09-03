/**
 * Spatial music player: the garage stereo.
 *
 * One `THREE.PositionalAudio` is attached to each speaker cabinet in the room and
 * they are driven together off a single decoded `AudioBuffer`, so the track
 * genuinely emanates from every box and falls off as the player walks away —
 * not a 2D stereo bed, and not one speaker doing all the work while the other is
 * silent scenery.
 *
 * This drives three.js audio directly instead of the `AudioSource` component
 * because it needs two things that component does not expose: an
 * `AudioAnalyser` tap for the LED bars, and per-track transport control
 * (shuffle, prev/next, pause). It deliberately reuses the `AudioListener` that
 * `AudioSystem` already put on the player's head — a second listener would
 * break spatialisation for everything.
 *
 * Only the current track's buffer is held, and every speaker shares that one
 * buffer rather than decoding its own. Decoded PCM dwarfs the mp3, so holding
 * 31 tracks — or one track per cabinet — would cost hundreds of MB.
 */

import {
  AudioAnalyser,
  AudioListener,
  AudioLoader,
  createSystem,
  PositionalAudio,
  signal,
  type Object3D,
} from '@iwsdk/core';

/** Every speaker cabinet in the room. Add a scene node id here to add a source. */
const SPEAKER_NODE_IDS = ['sound-system', 'sound-system-copy'];
/** 64 gives 32 frequency bins — plenty to drive a 12-bar equaliser. */
const FFT_SIZE = 64;
/**
 * Per-cabinet gain. Two speakers playing the same buffer sum acoustically, so
 * each is quieter than a single source would be.
 */
const DEFAULT_VOLUME = 0.38;
/** Distance (m) at which a cabinet is at full volume. */
const REF_DISTANCE = 3.5;
const ROLLOFF_FACTOR = 1.1;
const MAX_DISTANCE = 32;

interface PlaylistTrack {
  src: string;
  title: string;
}

export class MusicPlayerSystem extends createSystem({}) {
  /** Title of the track on the deck. */
  readonly currentTrackName = signal('');
  /** Transport intent — true between play() and pause(), across track changes. */
  readonly isPlaying = signal(false);
  /** False until a playlist with at least one track has loaded. */
  readonly hasTracks = signal(false);

  private tracks: PlaylistTrack[] = [];
  /** Indices into `tracks`, shuffled once at load: the random playlist. */
  private order: number[] = [];
  private cursor = 0;

  /** One source per cabinet. Index 0 is the analyser tap and the state oracle. */
  private sounds: PositionalAudio[] = [];
  private analyser: AudioAnalyser | undefined;
  private loader = new AudioLoader();
  /** Guards the window where a buffer is in flight and sources report stopped. */
  private loading = false;
  /** Bumped on every track change so a slow load cannot overwrite a newer one. */
  private loadToken = 0;

  init(): void {
    void this.loadPlaylist();
  }

  update(): void {
    if (this.sounds.length === 0) {
      // Speaker nodes and the AudioListener both appear once the level and
      // AudioSystem have initialised, which is after this system's init().
      this.tryAttach();
      return;
    }
    if (this.loading || this.tracks.length === 0) {
      return;
    }
    // Intent says playing but the sources have stopped: the track ran out.
    // pause() clears the intent, so this cannot fire for a manual pause.
    if (this.isPlaying.peek() && !this.sounds[0].isPlaying) {
      this.next();
    }
  }

  // --- transport ------------------------------------------------------------

  play(): void {
    if (this.tracks.length === 0) {
      return;
    }
    this.isPlaying.value = true;
    if (this.sounds.length === 0) {
      return;
    }
    if (this.sounds[0].buffer == null) {
      void this.loadCurrent();
      return;
    }
    for (const sound of this.sounds) {
      if (!sound.isPlaying) {
        sound.play();
      }
    }
  }

  pause(): void {
    this.isPlaying.value = false;
    for (const sound of this.sounds) {
      if (sound.isPlaying) {
        sound.pause();
      }
    }
  }

  toggle(): void {
    if (this.isPlaying.peek()) {
      this.pause();
    } else {
      this.play();
    }
  }

  nextTrack(): void {
    this.step(1);
  }

  prevTrack(): void {
    this.step(-1);
  }

  /** Alias kept so existing callers reading a `next()` API keep working. */
  next(): void {
    this.step(1);
  }

  /** Frequency bins for the current frame, or undefined when nothing is playing. */
  getFrequencyData(): Uint8Array | undefined {
    if (this.analyser == null || this.sounds[0]?.isPlaying !== true) {
      return undefined;
    }
    return this.analyser.getFrequencyData();
  }

  // --- internals ------------------------------------------------------------

  private step(direction: number): void {
    if (this.order.length === 0) {
      return;
    }
    const count = this.order.length;
    this.cursor = (((this.cursor + direction) % count) + count) % count;
    void this.loadCurrent();
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

    this.order = this.tracks.map((_, index) => index);
    shuffle(this.order);
    this.cursor = 0;
    this.hasTracks.value = true;
    this.currentTrackName.value = this.tracks[this.order[0]]?.title ?? '';
    // Start the moment the deck is wired up. Browsers hold the AudioContext
    // suspended until a user gesture, so this may only become audible once the
    // player enters XR or clicks something — nothing is skipped in the meantime.
    this.isPlaying.value = true;
  }

  /** Attach a source to every speaker once the scene and listener both exist. */
  private tryAttach(): void {
    if (this.tracks.length === 0) {
      return;
    }
    const listener = findAudioListener(this.player.head);
    if (listener == null) {
      return;
    }

    const sounds: PositionalAudio[] = [];
    for (const nodeId of SPEAKER_NODE_IDS) {
      const speaker = this.world.getSceneObject(nodeId);
      if (speaker == null) {
        continue;
      }
      const sound = new PositionalAudio(listener);
      sound.setRefDistance(REF_DISTANCE);
      sound.setRolloffFactor(ROLLOFF_FACTOR);
      sound.setDistanceModel('inverse');
      sound.setMaxDistance(MAX_DISTANCE);
      sound.setVolume(DEFAULT_VOLUME);
      speaker.add(sound);
      sounds.push(sound);
    }
    if (sounds.length === 0) {
      return;
    }

    this.sounds = sounds;
    this.analyser = new AudioAnalyser(sounds[0], FFT_SIZE);
    this.cleanupFuncs.push(() => {
      for (const sound of sounds) {
        if (sound.isPlaying) {
          sound.stop();
        }
        sound.removeFromParent();
      }
      this.sounds = [];
    });

    void this.loadCurrent();
  }

  private async loadCurrent(): Promise<void> {
    const track = this.tracks[this.order[this.cursor]];
    if (this.sounds.length === 0 || track == null) {
      return;
    }

    const token = (this.loadToken += 1);
    this.loading = true;
    this.currentTrackName.value = track.title;
    for (const sound of this.sounds) {
      if (sound.isPlaying) {
        sound.stop();
      }
    }

    const url = `${import.meta.env.BASE_URL}${track.src.replace(/^\/+/u, '')}`;
    try {
      const buffer = await this.loader.loadAsync(url);
      // A newer track was selected while this one was downloading.
      if (token !== this.loadToken) {
        return;
      }
      // Every cabinet shares this one decoded buffer, and they are started in the
      // same tick so the room stays phase-coherent rather than smearing.
      for (const sound of this.sounds) {
        sound.setBuffer(buffer);
      }
      if (this.isPlaying.peek()) {
        for (const sound of this.sounds) {
          sound.play();
        }
      }
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      console.warn(`[Music] Could not load "${track.title}"`, error);
      // Skip past a bad file rather than stalling the whole playlist.
      this.loading = false;
      this.step(1);
      return;
    } finally {
      if (token === this.loadToken) {
        this.loading = false;
      }
    }
  }
}

/** Fisher-Yates, in place. */
function shuffle(values: number[]): void {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

/** The listener AudioSystem parents to the player head; there must only be one. */
function findAudioListener(head: Object3D): AudioListener | undefined {
  for (const child of head.children) {
    if (child instanceof AudioListener) {
      return child;
    }
  }
  return undefined;
}
