/**
 * Makes snap/smooth turning pivot on the player's head instead of the rig origin.
 *
 * `TurnSystem` turns with `player.rotateY()`, which spins the rig about its own
 * origin — the centre of the physical play space. Stand anywhere other than that
 * origin and turning sweeps you around a point metres away instead of turning you
 * on the spot.
 *
 * The fix brackets `TurnSystem` rather than replacing it, so its turn-signal
 * arrows and hand micro-gesture turning keep working. Capture runs before it,
 * correction after.
 *
 * The correction is computed from the yaw delta, not by re-measuring the head, so
 * it composes with `SlideSystem`: translation applied by locomotion in the same
 * frame is preserved rather than being cancelled out.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';

/** Movements below this (in metres) are float noise, not a turn. */
const CORRECTION_EPSILON = 1e-5;

/** Runs before TurnSystem and records where the head sits relative to the rig. */
export class TurnPivotCaptureSystem extends createSystem({}) {
  /** Head position relative to the rig origin, in world axes. */
  readonly headOffset = new Vector3();
  /**
   * Rig orientation before any turn this frame. Read from the quaternion rather
   * than `rotation.y`: the rig's quaternion is a synced proxy that writes into
   * the Transform component, so three.js never runs its quaternion-to-Euler
   * callback and `rotation` stays stale at zero.
   */
  readonly orientation = new Quaternion();

  private rigPosition!: Vector3;

  init(): void {
    this.rigPosition = new Vector3();
  }

  update(): void {
    const player = this.player;
    player.updateWorldMatrix(true, false);
    player.head.updateWorldMatrix(true, false);
    this.headOffset.setFromMatrixPosition(player.head.matrixWorld);
    this.rigPosition.setFromMatrixPosition(player.matrixWorld);
    this.headOffset.sub(this.rigPosition);
    this.orientation.copy(player.quaternion);
  }
}

/** Runs after TurnSystem and slides the rig so the head stayed put. */
export class TurnPivotCorrectSystem extends createSystem({}) {
  private capture: TurnPivotCaptureSystem | undefined;
  private delta!: Quaternion;
  private turnedOffset!: Vector3;

  init(): void {
    this.capture = this.world.getSystem(TurnPivotCaptureSystem);
    this.delta = new Quaternion();
    this.turnedOffset = new Vector3();
  }

  update(): void {
    const capture = this.capture;
    if (capture == null) {
      return;
    }
    const player = this.player;

    // Rotation applied this frame: after * before⁻¹.
    this.delta.copy(capture.orientation).invert().premultiply(player.quaternion);
    this.turnedOffset.copy(capture.headOffset).applyQuaternion(this.delta);

    // How far the head drifted, and therefore how far to push the rig back so it
    // ends up where it started. Y is untouched: turning is yaw only.
    const offsetX = capture.headOffset.x - this.turnedOffset.x;
    const offsetZ = capture.headOffset.z - this.turnedOffset.z;
    if (
      Math.abs(offsetX) < CORRECTION_EPSILON &&
      Math.abs(offsetZ) < CORRECTION_EPSILON
    ) {
      return;
    }

    player.position.set(
      player.position.x + offsetX,
      player.position.y,
      player.position.z + offsetZ,
    );
  }
}
