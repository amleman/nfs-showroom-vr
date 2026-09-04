/**
 * Cycles the showroom's hero vehicle, loading each model on demand and holding
 * only a bounded number in memory.
 *
 * Even after `npm run models` shrinks the catalog to fit a headset it is ~440 MB
 * of texture memory across eight cars. Keeping it all resident is not an option
 * on a standalone device, but neither is discarding every car the instant you
 * leave it — Prev/Next ping-pong would re-download each time.
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
  LoopOnce,
  MathUtils,
  Mesh,
  signal,
  type AnimationAction,
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
 * instant while at most two texture sets are resident — a worst-case pair of
 * ~186 MB, against roughly 1 GB of headroom for the whole page on a Quest 3.
 * Raise it only against numbers measured on the device, not on desktop.
 */
const RESIDENT_LIMIT = 2;
/**
 * Where in the clip the doors are fully open.
 *
 * The M3 GTR clip is authored as a complete cycle — shut at 0 s, 60 degrees open
 * at the midpoint, shut again at the end — so playing it through opens and then
 * closes the car on its own. Open is therefore the midpoint, and closing runs
 * the first half backwards. A model whose clip only opens would want 1 here.
 */
const DOOR_OPEN_RATIO = 0.5;

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
  /** Doors and hood open. */
  readonly doorsOpen = signal(false);
  /** Whether the mounted car ships an openable clip at all. */
  readonly hasDoors = signal(false);

  private activeIndex = 0;
  private mount: Object3D | undefined;
  private mounted: Object3D | undefined;
  private mixer: AnimationMixer | undefined;
  private action: AnimationAction | undefined;
  private clipDuration = 0;
  /** 0 shut, 1 open. The action plays toward whichever end this names. */
  private doorsTarget = 0;
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
    this.updateDoors(delta);
    if (this.readDoorToggle()) {
      this.toggleDoors();
    }
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
      castShadows(resident.scene);
      this.loading.value = false;
    } else if (token !== this.loadToken) {
      return;
    }

    // Re-insert so this becomes the most recently used entry.
    this.residents.delete(entry.assetId);
    this.residents.set(entry.assetId, resident);

    await this.warmShaders(resident.scene, mount);
    // Warming yields to the event loop, so a swap may have started meanwhile.
    if (token !== this.loadToken) {
      resident.scene.removeFromParent();
      return;
    }
    resident.scene.visible = true;

    this.mounted = resident.scene;
    this.startAnimations(resident);
    this.evictBeyondLimit();
  }

  /**
   * Compile the car's shaders before it is on screen.
   *
   * three.js compiles a material the first frame it is drawn. A car arrives with
   * forty to eighty of them, so mounting one otherwise spends that whole compile
   * inside a single frame — a hitch landing exactly on the reveal, and a far
   * worse one on a headset than on a desktop GPU. `compileAsync` moves it into
   * the load the player is already waiting through.
   *
   * The car is parented but hidden while this runs: `compile` walks materials
   * with `traverse` (so hidden meshes still compile) but gathers lights from the
   * target scene with `traverseVisible`, which is what makes the compiled
   * programs match how the car will actually be lit.
   */
  private async warmShaders(car: Object3D, mount: Object3D): Promise<void> {
    car.visible = false;
    mount.add(car);
    try {
      await this.renderer.compileAsync(car, this.world.camera, this.scene);
    } catch (error) {
      // Warming is an optimisation. If it fails the car must still appear; the
      // cost is the hitch this was avoiding.
      console.warn('[CarSwapper] Shader warm-up failed', error);
    }
  }

  /** Open the doors and hood if they are shut, close them if they are open. */
  toggleDoors(): void {
    const action = this.action;
    if (action == null) {
      return;
    }
    this.doorsTarget = this.doorsTarget === 1 ? 0 : 1;
    this.doorsOpen.value = this.doorsTarget === 1;
    // Un-pause and point the clip at the chosen end. Reversing mid-swing is just
    // a sign flip, so a half-open car closes from where it is.
    action.paused = false;
    action.timeScale = this.doorsTarget === 1 ? 1 : -1;
  }

  /**
   * Arm the model's clip, parked shut.
   *
   * Scrubbing `action.time` by hand while the action is paused does NOT work:
   * a paused action contributes nothing, so the car stays in its rest pose no
   * matter what the time says. Direction is driven with `timeScale` instead and
   * the action is only paused once it has come to rest at an end.
   *
   * Only the black M3 GTR ships a clip today; the rest fall through and cost
   * nothing.
   */
  private startAnimations(resident: ResidentCar): void {
    this.mixer = undefined;
    this.action = undefined;
    this.doorsTarget = 0;
    this.doorsOpen.value = false;
    this.hasDoors.value = resident.clips.length > 0;
    if (resident.clips.length === 0) {
      return;
    }

    const clip = resident.clips[0];
    const mixer = new AnimationMixer(resident.scene);
    const action = mixer.clipAction(clip);
    // LoopOnce + clampWhenFinished makes the action stop and hold at whichever
    // end it reaches, in BOTH directions, so the doors never wrap around from
    // shut back to open. Parked shut and paused until the player asks.
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.time = 0;
    action.paused = true;

    this.mixer = mixer;
    this.action = action;
    this.clipDuration = clip.duration;
  }

  /**
   * Advance the door clip. All the clamping lives in the action itself, so this
   * is just the mixer tick.
   */
  private updateDoors(delta: number): void {
    const mixer = this.mixer;
    const action = this.action;
    if (mixer == null || action == null) {
      return;
    }
    mixer.update(delta);
    // Halt at the open pose. Left alone the clip would carry straight on through
    // its closing half, which is what made a single press look like two.
    // Closing needs no such guard: LoopOnce clamps and pauses at 0 by itself.
    const openTime = this.clipDuration * DOOR_OPEN_RATIO;
    if (this.doorsTarget === 1 && action.time >= openTime) {
      action.time = openTime;
      action.paused = true;
    }
  }

  private unmount(): void {
    this.mixer?.stopAllAction();
    this.mixer = undefined;
    this.action = undefined;
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

  /** The car currently on the platform, for systems that need its bounds. */
  get mountedCar(): Object3D | undefined {
    return this.mounted;
  }

  /** Y on the left hand toggles the doors; E is the browser equivalent. */
  private readDoorToggle(): boolean {
    if (this.input.keyboard.getKeyDown('KeyE')) {
      return true;
    }
    const left: StatefulGamepad | undefined = this.input.xr.gamepads.left;
    return left?.getButtonDown(InputComponent.Y_Button) === true;
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
   * Car changes are right hand only. The left controller drives presentation
   * instead — X spins the turntable, Y opens the doors — so the off hand can
   * never change the car by accident.
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

/**
 * Let the car drop a shadow on the dais.
 *
 * `GLTFLoader` leaves every mesh at `castShadow: false`, and scene-authored
 * nodes get the flag from their `content.castShadow` — but a car mounted through
 * `AssetManager` never passes through that path, so until this ran the key
 * spotlight was rendering a shadow map with no car in it and the car looked like
 * it was hovering. `receiveShadow` stays off: self-shadowing a car body costs a
 * second lookup for detail nobody reads at showroom distance.
 */
function castShadows(root: Object3D): void {
  root.traverse((object) => {
    if ((object as Mesh).isMesh === true) {
      object.castShadow = true;
    }
  });
}
