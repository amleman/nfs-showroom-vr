/**
 * Lets somebody walk the exhibit in a plain browser, with no headset.
 *
 * This is not a fallback, it is the second shipping surface. A page on GitHub
 * Pages opened on a laptop has no XR device, so `navigator.xr` reports no
 * immersive session and the only thing on offer is a static hero shot and a
 * message telling the visitor to come back with a Quest. That is a dead end for
 * anyone who wants to look at the stand from their desk.
 *
 * Two halves make it work, and IWSDK already ships one of them:
 *
 * - **Movement.** `locomotion.browserControls` in `iwsdk.config.json` binds
 *   WASD and the arrow keys to the same locomotion actions the thumbstick
 *   drives, and outside an XR session the locomotor takes its movement
 *   reference from `world.camera` rather than the headset. So walking, gravity
 *   and the floor collision are all the engine's, unchanged.
 * - **Looking.** Nothing binds a mouse, so that part is here.
 *
 * The camera is free to drive: the authored hero view is applied exactly once,
 * when the level loads, and never re-asserted. This system takes it over from
 * there — which is also why it re-writes the camera's local position every
 * frame rather than once, so a level reload cannot leave the visitor floating
 * at the hero camera's vantage point.
 */

import { createSystem, Euler, signal, Vector3 } from '@iwsdk/core';

/** Eye height above the player rig origin, in metres. */
const EYE_HEIGHT = 1.6;
/** Radians of look per pixel of drag. Tuned against a 1080p window. */
const LOOK_SENSITIVITY = 0.0032;
/** Pitch limit, just short of straight up and down. */
const MAX_PITCH = (85 * Math.PI) / 180;
/**
 * Pixels of movement past which a press is a look, not a click.
 *
 * Dragging to look and clicking a spatial panel are the same gesture until this
 * threshold decides otherwise, so the drag suppresses the click it would
 * otherwise also fire — in the capture phase, before IWSDK's canvas pointer
 * handling sees it.
 */
const DRAG_SLOP = 6;

export class DesktopNavigationSystem extends createSystem({}) {
  /** True once the visitor has left the landing page for the scene. */
  readonly active = signal(false);

  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private dragDistance = 0;
  private lastX = 0;
  private lastY = 0;
  /** Preallocated: `update` runs every frame and must not allocate. */
  private orientation!: Euler;
  private eye!: Vector3;
  private listenersAttached = false;

  init(): void {
    this.orientation = new Euler(0, 0, 0, 'YXZ');
    this.eye = new Vector3(0, EYE_HEIGHT, 0);
  }

  /**
   * Hand the camera over to the mouse and drop the visitor at the spawn.
   *
   * Called by the landing page rather than at startup: until the visitor asks
   * to go in, the authored hero view is the better picture to have behind the
   * landing copy.
   */
  enable(): void {
    if (this.active.peek()) {
      return;
    }
    // Face the way the scene author pointed the player, not wherever the hero
    // camera happened to be looking.
    this.yaw = this.world.player?.rotation.y ?? 0;
    this.pitch = 0;
    this.active.value = true;
    this.attachListeners();
  }

  update(): void {
    if (!this.active.peek()) {
      return;
    }
    // In an immersive session the tracked rig owns the camera absolutely, and
    // writing to it fights the XR pose.
    if (this.world.session != null) {
      return;
    }
    this.world.camera.position.copy(this.eye);
    this.orientation.set(this.pitch, this.yaw, 0);
    this.world.camera.quaternion.setFromEuler(this.orientation);
  }

  private attachListeners(): void {
    if (this.listenersAttached) {
      return;
    }
    const canvas = this.renderer.domElement;
    this.listenersAttached = true;

    const onPointerDown = (event: PointerEvent): void => {
      this.dragging = true;
      this.dragDistance = 0;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!this.dragging) {
        return;
      }
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      this.yaw -= dx * LOOK_SENSITIVITY;
      this.pitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, this.pitch - dy * LOOK_SENSITIVITY),
      );
    };
    const onPointerUp = (): void => {
      this.dragging = false;
    };
    // Capture phase: a drag that turned the view must not also press whatever
    // spatial button happens to be under the pointer when it is released.
    const onClickCapture = (event: MouseEvent): void => {
      if (this.dragDistance > DRAG_SLOP) {
        event.stopPropagation();
        event.preventDefault();
      }
      this.dragDistance = 0;
    };
    const onContextMenu = (event: Event): void => event.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('click', onClickCapture, true);
    canvas.addEventListener('contextmenu', onContextMenu);

    this.cleanupFuncs.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('click', onClickCapture, true);
      canvas.removeEventListener('contextmenu', onContextMenu);
      this.listenersAttached = false;
    });
  }
}
