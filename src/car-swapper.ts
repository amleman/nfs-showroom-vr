/**
 * Cycles the showroom's hero vehicle, loading each model on demand and holding
 * only a bounded number in memory.
 *
 * The catalog is ~680k triangles and ~145 MB of source. Keeping it all resident
 * is not an option on a standalone headset, but neither is discarding every car
 * the instant you leave it — Prev/Next ping-pong would re-download each time.
 *
 * So residency is an LRU of {@link RESIDENT_LIMIT} cars. A JS `Map` iterates in
 * insertion order, which is exactly an LRU queue: re-inserting on access moves an
 * entry to the back, and the oldest is always `keys().next()`. Evicting frees the
 * GPU resources *and* drops the AssetManager cache entry, otherwise the cache
 * would keep handing back geometry that has already been disposed.
 */

import {
  AnimationMixer,
  AssetManager,
  CacheManager,
  createSystem,
  InputComponent,
  MathUtils,
  signal,
  type AnimationClip,
  type Object3D,
  type StatefulGamepad,
} from '@iwsdk/core';
import { CAR_CATALOG } from './car-catalog.js';
import { polishCarMaterials } from './car-finish.js';
import { fitCarToStage } from './car-fit.js';
import { disposeHierarchy } from './gpu-memory.js';

/** Scene node the loaded car is parented to. */
const MOUNT_NODE_ID = 'car-mount';
/** Deck surface height of the dais, in metres above the mount origin. */
const DECK_Y = 0.17;
/**
 * Cars kept in memory. Two means stepping back and forth between neighbours is
 * instant while at most two texture sets are resident; raise it only if you have
 * headroom measured on the device, not on desktop.
 */
const RESIDENT_LIMIT = 2;

interface ResidentCar {
  scene: Object3D;
  clips: AnimationClip[];
}

export class CarSwapperSystem extends createSystem({}) {
  /** Name of the car on the platform. */
  readonly activeLabel = signal(CAR_CATALOG[0]?.label ?? '');
  /** Position in the carousel, for "2 / 8"-style readouts. */
  readonly activePosition = signal(1);
  /** How many cars are in the carousel. */
  readonly carCount = signal(CAR_CATALOG.length);
  /** True while a model is being fetched, so the UI can show a spinner. */
  readonly loading = signal(false);

  private activeIndex = 0;
  private mount: Object3D | undefined;
  private mounted: Object3D | undefined;
  private mixer: AnimationMixer | undefined;
  /** LRU: insertion order is access order, oldest first. */
  private readonly residents = new Map<string, ResidentCar>();
  /** Bumped on every swap so a slow load cannot mount a stale car. */
  private loadToken = 0;

  update(delta: number): void {
    if (this.mount == null) {
      // The level loads after this system's init(), so resolve lazily and kick
      // off the first car the moment the mount exists.
      this.mount = this.world.getSceneObject(MOUNT_NODE_ID);
      if (this.mount != null) {
        void this.mountCurrent();
      }
      return;
    }
    this.mixer?.update(delta);
    const step = this.readInput();
    if (step !== 0) {
      this.cycle(step);
    }
  }

  /** Advance the carousel by `step`, wrapping in both directions. */
  cycle(step: number): void {
    const count = CAR_CATALOG.length;
    if (count === 0) {
      return;
    }
    this.select((((this.activeIndex + step) % count) + count) % count);
  }

  next(): void {
    this.cycle(1);
  }

  previous(): void {
    this.cycle(-1);
  }

  select(index: number): void {
    if (index < 0 || index >= CAR_CATALOG.length || index === this.activeIndex) {
      return;
    }
    this.activeIndex = index;
    void this.mountCurrent();
  }

  private async mountCurrent(): Promise<void> {
    const mount = this.mount;
    const entry = CAR_CATALOG[this.activeIndex];
    if (mount == null || entry == null) {
      return;
    }

    const token = (this.loadToken += 1);
    this.activeLabel.value = entry.label;
    this.activePosition.value = this.activeIndex + 1;

    // Take the old car off the stage first, so two cars never overlap mid-swap.
    // It stays resident; the LRU decides when it is actually freed.
    this.unmount();

    let resident = this.residents.get(entry.assetId);
    if (resident == null) {
      this.loading.value = true;
      try {
        const gltf = await AssetManager.loadGLTFById(entry.assetId);
        resident = { scene: gltf.scene, clips: gltf.animations ?? [] };
      } catch (error) {
        if (token === this.loadToken) {
          console.warn(`[CarSwapper] Could not load "${entry.label}"`, error);
          this.loading.value = false;
        }
        return;
      }
      // A newer swap started while this model was downloading.
      if (token !== this.loadToken) {
        return;
      }

      resident.scene.rotation.y = MathUtils.degToRad(entry.yawDeg);
      if (!fitCarToStage(resident.scene, DECK_Y)) {
        console.warn(`[CarSwapper] "${entry.label}" has no visible geometry`);
      }
      polishCarMaterials(resident.scene);
      this.loading.value = false;
    } else if (token !== this.loadToken) {
      return;
    }

    // Re-insert so this becomes the most recently used entry.
    this.residents.delete(entry.assetId);
    this.residents.set(entry.assetId, resident);

    mount.add(resident.scene);
    this.mounted = resident.scene;
    this.startAnimations(resident);
    this.evictBeyondLimit();
  }

  /**
   * Play whatever the model ships with. Only one car currently has a clip (the
   * black M3 GTR); the rest fall through and cost nothing.
   */
  private startAnimations(resident: ResidentCar): void {
    this.mixer = undefined;
    if (resident.clips.length === 0) {
      return;
    }
    const mixer = new AnimationMixer(resident.scene);
    for (const clip of resident.clips) {
      mixer.clipAction(clip).play();
    }
    this.mixer = mixer;
  }

  private unmount(): void {
    this.mixer?.stopAllAction();
    this.mixer = undefined;
    this.mounted?.removeFromParent();
    this.mounted = undefined;
  }

  /**
   * Free the least recently used cars. Both halves matter: `disposeHierarchy`
   * releases the VRAM, and deleting the cache entry stops AssetManager handing
   * back the now-disposed hierarchy on a later visit.
   */
  private evictBeyondLimit(): void {
    while (this.residents.size > RESIDENT_LIMIT) {
      const oldest = this.residents.keys().next();
      if (oldest.done === true) {
        return;
      }
      const assetId = oldest.value;
      const evicted = this.residents.get(assetId);
      this.residents.delete(assetId);
      if (evicted == null || evicted.scene === this.mounted) {
        continue;
      }
      disposeHierarchy(evicted.scene);
      CacheManager.deleteAsset(assetId);
    }
  }

  /** Net carousel steps requested this frame. */
  private readInput(): number {
    let step = 0;
    const keyboard = this.input.keyboard;
    if (keyboard.getKeyDown('ArrowRight')) {
      step += 1;
    }
    if (keyboard.getKeyDown('ArrowLeft')) {
      step -= 1;
    }
    return step + this.readGamepad(this.input.xr.gamepads.right);
  }

  /**
   * Right hand only. The left controller is deliberately left alone: X drives
   * the turntable and Y is unbound, so the off hand never changes the car by
   * accident.
   */
  private readGamepad(pad: StatefulGamepad | undefined): number {
    if (pad == null) {
      return 0;
    }
    let step = 0;
    if (pad.getButtonDown(InputComponent.A_Button)) {
      step += 1;
    }
    if (pad.getButtonDown(InputComponent.B_Button)) {
      step -= 1;
    }
    return step;
  }
}
