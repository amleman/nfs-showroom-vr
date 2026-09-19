/**
 * Cycles the exhibit's machine, loading each model on demand and holding only a
 * bounded number in memory.
 *
 * Even after `npm run models` rewrites the catalog to fit a headset it is ~40 MB
 * across seven machines, and the texture sets behind them are what actually
 * decide whether this runs. Keeping it all resident is not an option on a
 * standalone device, but neither is discarding every machine the instant you
 * leave it — Prev/Next ping-pong would re-download each time.
 *
 * So residency is an LRU of {@link RESIDENT_LIMIT} machines. A JS `Map` iterates
 * in insertion order, which is exactly an LRU queue: re-inserting on access
 * moves an entry to the back, and the oldest is always `keys().next()`. Evicting
 * frees the GPU resources *and* drops the AssetManager cache entry, otherwise
 * the cache would keep handing back geometry that has already been disposed.
 */

import {
  AnimationMixer,
  AssetManager,
  CacheManager,
  createSystem,
  Group,
  InputComponent,
  LoopRepeat,
  MathUtils,
  Mesh,
  signal,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
  type StatefulGamepad,
} from '@iwsdk/core';
import { MACHINE_CATALOG, type MachineEntry } from './machine-catalog.js';
import { finishMachineMaterials } from './machine-finish.js';
import { fitMachineToFloor, type MachineFit } from './machine-fit.js';
import { disposeHierarchy } from './gpu-memory.js';

/** Scene node the loaded machine is parented to. */
const MOUNT_NODE_ID = 'machine-mount';
/**
 * Machines kept in memory. Two means stepping back and forth between neighbours
 * is instant while at most two texture sets are resident, against roughly 1 GB
 * of headroom for the whole page on a Quest 3. Raise it only against numbers
 * measured on the device, not on desktop.
 */
const RESIDENT_LIMIT = 2;

interface ResidentMachine {
  /**
   * Wrapper carrying the presentation yaw, and what actually gets mounted.
   *
   * The yaw cannot live on the model itself. `fitMachineToFloor` scales so the
   * measured bounding box is `realHeight` tall, and while a yaw about Y does not
   * change the measured height, it does change the measured footprint — which is
   * what the inspection hotspots are anchored against. Fitting first and
   * rotating a wrapper afterwards keeps both exact.
   *
   * It is also the frame the per-machine hotspots are authored in, since it
   * turns with the machine.
   */
  pivot: Object3D;
  scene: Object3D;
  clips: AnimationClip[];
  fit: MachineFit | undefined;
}

export class MachineSwapperSystem extends createSystem({}) {
  /** Name of the machine on the floor. */
  readonly activeLabel = signal(MACHINE_CATALOG[0]?.label ?? '');
  /** Position in the carousel, for "2 / 7"-style readouts. */
  readonly activePosition = signal(1);
  /** How many machines are in the carousel. */
  readonly machineCount = signal(MACHINE_CATALOG.length);
  /** True while a model is being fetched, so the UI can show progress. */
  readonly loading = signal(false);
  /** Bumped every time a machine finishes mounting; panels rebuild on it. */
  readonly mountedRevision = signal(0);
  /** Whether the mounted machine ships an animation clip at all. */
  readonly hasCycle = signal(false);
  /** Whether that clip is currently running. */
  readonly cycleRunning = signal(false);

  private activeIndex = 0;
  private mount: Object3D | undefined;
  private mounted: Object3D | undefined;
  private mixer: AnimationMixer | undefined;
  private actions: AnimationAction[] = [];
  /** Measured dimensions of the machine on the floor, in metres. */
  private activeFit: MachineFit | undefined;
  /** LRU: insertion order is access order, oldest first. */
  private readonly residents = new Map<string, ResidentMachine>();
  /** Bumped on every swap so a slow load cannot mount a stale machine. */
  private loadToken = 0;

  update(delta: number): void {
    if (this.mount == null) {
      // The level loads after this system's init(), so resolve lazily and kick
      // off the first machine the moment the mount exists.
      this.mount = this.world.getSceneObject(MOUNT_NODE_ID);
      if (this.mount != null) {
        void this.mountCurrent();
      }
      return;
    }
    if (this.cycleRunning.peek()) {
      this.mixer?.update(delta);
    }
    if (this.readCycleToggle()) {
      this.toggleCycle();
    }
    const step = this.readInput();
    if (step !== 0) {
      this.cycle(step);
    }
  }

  /** Advance the carousel by `step`, wrapping in both directions. */
  cycle(step: number): void {
    const count = MACHINE_CATALOG.length;
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
    if (
      index < 0 ||
      index >= MACHINE_CATALOG.length ||
      index === this.activeIndex
    ) {
      return;
    }
    this.activeIndex = index;
    void this.mountCurrent();
  }

  private async mountCurrent(): Promise<void> {
    const mount = this.mount;
    const entry = MACHINE_CATALOG[this.activeIndex];
    if (mount == null || entry == null) {
      return;
    }

    const token = (this.loadToken += 1);
    this.activeLabel.value = entry.label;
    this.activePosition.value = this.activeIndex + 1;

    // Take the old machine off the floor first, so two never overlap mid-swap.
    // It stays resident; the LRU decides when it is actually freed.
    this.unmount();

    let resident = this.residents.get(entry.assetId);
    if (resident == null) {
      this.loading.value = true;
      try {
        const gltf = await AssetManager.loadGLTFById(entry.assetId);
        resident = {
          pivot: new Group(),
          scene: gltf.scene,
          clips: gltf.animations ?? [],
          fit: undefined,
        };
      } catch (error) {
        if (token === this.loadToken) {
          console.warn(`[MachineSwapper] Could not load "${entry.label}"`, error);
          this.loading.value = false;
        }
        return;
      }
      // A newer swap started while this model was downloading.
      if (token !== this.loadToken) {
        return;
      }

      // Fit the model square-on so the footprint the hotspots are anchored
      // against is the machine's own, not a box inflated by its display angle.
      resident.fit = fitMachineToFloor(
        resident.scene,
        entry.realHeight,
        entry.alignYawDeg ?? 0,
      );
      if (resident.fit == null) {
        console.warn(`[MachineSwapper] "${entry.label}" has no visible geometry`);
      }
      resident.pivot.name = `machine:${entry.assetId}`;
      resident.pivot.rotation.y = MathUtils.degToRad(entry.yawDeg);
      resident.pivot.add(resident.scene);
      finishMachineMaterials(resident.scene);
      castShadows(resident.scene);
      this.loading.value = false;
    } else if (token !== this.loadToken) {
      return;
    }

    // Re-insert so this becomes the most recently used entry.
    this.residents.delete(entry.assetId);
    this.residents.set(entry.assetId, resident);

    await this.warmShaders(resident.pivot, mount);
    // Warming yields to the event loop, so a swap may have started meanwhile.
    if (token !== this.loadToken) {
      resident.pivot.removeFromParent();
      return;
    }
    resident.pivot.visible = true;

    this.mounted = resident.pivot;
    this.activeFit = resident.fit;
    this.startAnimations(resident);
    this.evictBeyondLimit();
    // Last: everything downstream reads mountedCar/activeFit off this.
    this.mountedRevision.value = this.mountedRevision.peek() + 1;
  }

  /**
   * Compile the machine's shaders before it is on screen.
   *
   * three.js compiles a material the first frame it is drawn. These models carry
   * up to sixty of them, so mounting one otherwise spends that whole compile
   * inside a single frame — a hitch landing exactly on the reveal, and a far
   * worse one on a headset than on a desktop GPU. `compileAsync` moves it into
   * the load the visitor is already waiting through.
   *
   * The machine is parented but hidden while this runs: `compile` walks
   * materials with `traverse` (so hidden meshes still compile) but gathers
   * lights from the target scene with `traverseVisible`, which is what makes the
   * compiled programs match how the machine will actually be lit.
   */
  private async warmShaders(machine: Object3D, mount: Object3D): Promise<void> {
    machine.visible = false;
    mount.add(machine);
    try {
      await this.renderer.compileAsync(machine, this.world.camera, this.scene);
    } catch (error) {
      // Warming is an optimisation. If it fails the machine must still appear;
      // the cost is the hitch this was avoiding.
      console.warn('[MachineSwapper] Shader warm-up failed', error);
    }
  }

  /** Run the machine's own animation, or stop it if it is already running. */
  toggleCycle(): void {
    if (!this.hasCycle.peek()) {
      return;
    }
    const running = !this.cycleRunning.peek();
    this.cycleRunning.value = running;
    for (const action of this.actions) {
      action.paused = !running;
    }
  }

  /**
   * Arm every clip the model ships, parked at rest.
   *
   * All of them, not the first: the precision arm ships one clip per tool and
   * running a single one animates a quarter of the machine. A paused action
   * still contributes its rest pose to the mixer, which is what keeps the
   * machine from collapsing when the cycle is stopped.
   */
  private startAnimations(resident: ResidentMachine): void {
    this.mixer = undefined;
    this.actions = [];
    this.cycleRunning.value = false;
    this.hasCycle.value = resident.clips.length > 0;
    if (resident.clips.length === 0) {
      return;
    }

    const mixer = new AnimationMixer(resident.scene);
    for (const clip of resident.clips) {
      const action = mixer.clipAction(clip);
      action.setLoop(LoopRepeat, Infinity);
      action.play();
      action.paused = true;
      this.actions.push(action);
    }
    this.mixer = mixer;
  }

  private unmount(): void {
    this.mixer?.stopAllAction();
    this.mixer = undefined;
    this.actions = [];
    this.cycleRunning.value = false;
    this.mounted?.removeFromParent();
    this.mounted = undefined;
    this.activeFit = undefined;
  }

  /**
   * Free the least recently used machines. Both halves matter:
   * `disposeHierarchy` releases the VRAM, and deleting the cache entry stops
   * AssetManager handing back the now-disposed hierarchy on a later visit.
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
      if (evicted == null || evicted.pivot === this.mounted) {
        continue;
      }
      // The pivot owns no GPU resources of its own; disposing the model under it
      // is what frees the VRAM, and detaching the pivot drops the whole branch.
      disposeHierarchy(evicted.scene);
      evicted.pivot.removeFromParent();
      CacheManager.deleteAsset(assetId);
    }
  }

  /**
   * The pivot of the machine currently on the floor. Hotspots are authored in
   * this object's frame, so it is what turns them into world positions.
   */
  get mountedMachine(): Object3D | undefined {
    return this.mounted;
  }

  /** Measured dimensions of that machine, in metres, or undefined when empty. */
  get mountedFit(): MachineFit | undefined {
    return this.activeFit;
  }

  /** Catalog entry for the machine on the floor, or undefined when empty. */
  get activeEntry(): MachineEntry | undefined {
    return MACHINE_CATALOG[this.activeIndex];
  }

  /** Y on the left hand runs the machine's cycle; E is the browser equivalent. */
  private readCycleToggle(): boolean {
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
   * Machine changes are right hand only. The left controller drives
   * presentation instead — X turns the machine, Y runs its cycle — so the off
   * hand can never change the exhibit by accident.
   */
  private readGamepad(pad: StatefulGamepad | undefined): number {
    if (pad?.getButtonDown(InputComponent.A_Button) === true) {
      return 1;
    }
    return pad?.getButtonDown(InputComponent.B_Button) === true ? -1 : 0;
  }
}

/**
 * Let the machine drop a shadow on the showroom floor.
 *
 * `GLTFLoader` leaves every mesh at `castShadow: false`, and scene-authored
 * nodes get the flag from their `content.castShadow` — but a machine mounted
 * through `AssetManager` never passes through that path, so until this runs the
 * key light renders a shadow map with nothing in it and the machine looks like
 * it is hovering. `receiveShadow` stays off: self-shadowing costs a second
 * lookup for detail nobody reads at exhibit distance.
 */
function castShadows(root: Object3D): void {
  root.traverse((object) => {
    if ((object as Mesh).isMesh === true) {
      object.castShadow = true;
    }
  });
}
