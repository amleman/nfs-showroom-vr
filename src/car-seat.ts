/**
 * Puts the player in the driver's seat, and takes them out again.
 *
 * B on the right controller toggles. While seated the player is anchored to the
 * car: locomotion is off, so leaning and looking still work — roomscale head
 * movement is what makes sitting in a car feel like sitting in a car — but the
 * sticks do nothing until they get out.
 *
 * Five things about IWSDK's rig make this less obvious than it looks, and all
 * five were found the hard way:
 *
 * 1. **Position goes through `LocomotionSystem.setPlayerPosition`.** Writing
 *    `player.position` is pointless: `LocomotionSystem.update()` re-stamps it
 *    from the locomotor every frame. `setPlayerPosition` also teleports the
 *    locomotor and zeroes its velocity.
 *
 * 2. **Yaw goes on the quaternion, never `player.rotation.y`.** That assignment
 *    is silently a no-op whenever anything has touched the quaternion since the
 *    last rotation read — the internal resync runs first and discards the value
 *    being written. The same trap is documented from the other side in
 *    `turn-pivot.ts`.
 *
 * 3. **`LocomotionSystem` itself has to be paused**, not just the input systems.
 *    Left running, its gravity drags the rig off the seat and down to the
 *    nearest `LocomotionEnvironment` within a second or so.
 *
 * 4. **The turn-pivot pair has to be paused too.** `TurnPivotCorrectSystem`
 *    writes `player.position` at priority 10, so it would keep nudging a seated
 *    player around.
 *
 * 5. **`SlideSystem` and `TeleportSystem` are registered asynchronously**, after
 *    the locomotor finishes initialising, so `getSystem` can return undefined
 *    early on. Everything here resolves lazily and tolerates a miss.
 *
 * The seat anchor is where the player's **eyes** should end up, but the rig is
 * placed by its origin, so the head's offset within the play space is measured
 * and subtracted — all three axes of it.
 */

import {
  createSystem,
  InputComponent,
  LocomotionSystem,
  Quaternion,
  signal,
  SlideSystem,
  TeleportSystem,
  TurnSystem,
  Vector3,
  type StatefulGamepad,
} from '@iwsdk/core';
import { CarSwapperSystem } from './car-swapper.js';
import { CarTurntableSystem } from './car-turntable.js';
import { TurnPivotCaptureSystem, TurnPivotCorrectSystem } from './turn-pivot.js';

const UP = new Vector3(0, 1, 0);

/** The slice of the system API this needs: elics honours `isPaused`. */
interface Pausable {
  play(): void;
  stop(): void;
}

export class CarSeatSystem extends createSystem({}) {
  /** True while the player is in the car. Other systems gate their input on it. */
  readonly seated = signal(false);
  /** Whether the car on the platform declares a seat at all. */
  readonly canSit = signal(false);

  private swapper: CarSwapperSystem | undefined;

  /** Rig pose to restore on exit. */
  private readonly exitPosition = new Vector3();
  private readonly exitOrientation = new Quaternion();

  private seatWorld!: Vector3;
  private seatOrientation!: Quaternion;
  private rigOffset!: Vector3;

  init(): void {
    this.swapper = this.world.getSystem(CarSwapperSystem);
    this.seatWorld = new Vector3();
    this.seatOrientation = new Quaternion();
    this.rigOffset = new Vector3();

    const swapper = this.swapper;
    if (swapper != null) {
      this.cleanupFuncs.push(
        // Swapping the car out from under a seated player would leave them
        // floating where the cabin used to be.
        swapper.activeLabel.subscribe(() => {
          if (this.seated.peek()) {
            this.exit();
          }
          this.canSit.value = swapper.activeEntry?.seat != null;
        }),
      );
    }
  }

  update(): void {
    if (this.readToggle()) {
      this.toggle();
    }
    // Mirror the seated state onto the systems that must go quiet. Done here
    // rather than in enter/exit so a system registered later still picks it up.
    const suspended = this.seated.peek();
    if (this.swapper != null) {
      this.swapper.inputSuspended = suspended;
    }
    const turntable = this.world.getSystem(CarTurntableSystem);
    if (turntable != null) {
      turntable.inputSuspended = suspended;
    }
  }

  toggle(): void {
    if (this.seated.peek()) {
      this.exit();
    } else {
      this.enter();
    }
  }

  /** Move the player into the driver's seat and hand control to the car. */
  enter(): void {
    if (this.seated.peek()) {
      return;
    }
    const swapper = this.swapper;
    const seat = swapper?.activeEntry?.seat;
    const pivot = swapper?.mountedCar;
    if (seat == null || pivot == null) {
      return;
    }

    const player = this.player;
    this.exitPosition.copy(player.position);
    this.exitOrientation.copy(player.quaternion);

    // The anchor is authored in the car's own frame, so the car's world matrix
    // is what turns it into a place to stand — including the presentation yaw
    // the pivot carries.
    pivot.updateWorldMatrix(true, false);
    this.seatWorld.set(...seat.position).applyMatrix4(pivot.matrixWorld);

    // Face the seat's direction as posed on the stage: the car's yaw plus the
    // seat's own yaw within the car.
    this.seatOrientation.setFromAxisAngle(
      UP,
      carYaw(pivot) + (seat.yawDeg * Math.PI) / 180,
    );

    this.stopLocomotion();

    // Rig orientation first: the head's offset rotates with the rig, so where
    // the rig has to stand depends on which way it ends up facing.
    player.quaternion.copy(this.seatOrientation);

    // Place the rig so the HEAD lands on the anchor, not the rig origin.
    //
    // `head.position` is the viewer's pose within the play space, so it is
    // rig-local and includes the player's standing height. All three axes have
    // to be subtracted: leaving Y out puts the rig at eye height and the eyes a
    // further 1.6 m up, which parks the player above the roof looking down at
    // the car. The rig ending up below the floor is correct and invisible.
    //
    // It must be the rig-local offset rather than the world-space one
    // `TurnPivotCaptureSystem` tracks, or rotating it by the seat orientation
    // applies the rig's current yaw a second time.
    //
    // Outside XR the head sits at the rig origin and this is a no-op.
    this.rigOffset.copy(this.player.head.position).applyQuaternion(this.seatOrientation);
    this.seatWorld.sub(this.rigOffset);

    this.world.getSystem(LocomotionSystem)?.setPlayerPosition(this.seatWorld);
    this.seated.value = true;
  }

  /** Return the player to where they were standing and give locomotion back. */
  exit(): void {
    if (!this.seated.peek()) {
      return;
    }
    this.player.quaternion.copy(this.exitOrientation);

    const locomotion = this.world.getSystem(LocomotionSystem);
    // Resume before teleporting: setPlayerPosition has to reach a running
    // locomotor, or the rig snaps back to wherever it thinks the player is.
    locomotion?.play();
    locomotion?.setPlayerPosition(this.exitPosition);
    this.resumeLocomotion();

    this.seated.value = false;
  }

  private stopLocomotion(): void {
    for (const system of this.locomotionSystems()) {
      system?.stop();
    }
  }

  private resumeLocomotion(): void {
    for (const system of this.locomotionSystems()) {
      system?.play();
    }
  }

  /**
   * Everything that writes the rig. Resolved on every call rather than cached:
   * `SlideSystem` and `TeleportSystem` are registered after the locomotor
   * finishes initialising, so an early lookup returns undefined.
   *
   * Typed structurally rather than as `System`, whose generic parameters carry
   * each system's own queries and config and cannot be spelled for a mixed list.
   */
  private locomotionSystems(): (Pausable | undefined)[] {
    return [
      this.world.getSystem(LocomotionSystem),
      this.world.getSystem(SlideSystem),
      this.world.getSystem(TurnSystem),
      this.world.getSystem(TeleportSystem),
      this.world.getSystem(TurnPivotCaptureSystem),
      this.world.getSystem(TurnPivotCorrectSystem),
    ];
  }

  /**
   * B on the right hand gets in and out. It no longer steps the carousel — the
   * panel's Prev button owns that — so the right hand reads A for the next car
   * and B for the seat. `B` is the browser equivalent.
   */
  private readToggle(): boolean {
    if (this.input.keyboard.getKeyDown('KeyB')) {
      return true;
    }
    const right: StatefulGamepad | undefined = this.input.xr.gamepads.right;
    return right?.getButtonDown(InputComponent.B_Button) === true;
  }
}

/** Yaw of an object about world Y, read from its quaternion. */
function carYaw(object: { quaternion: Quaternion }): number {
  const { x, y, z, w } = object.quaternion;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x));
}
