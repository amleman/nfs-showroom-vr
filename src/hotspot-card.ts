/**
 * Shows the selected inspection point where the visitor is standing, not on the
 * console across the hall.
 *
 * The console panel was the first design and it has one bad property: a visitor
 * walks up to the rear axle of a haul truck to look at the thing the marker is
 * on, presses it, and then has to walk fifteen metres back to read what it said.
 * The information is furthest away exactly when the visitor is closest to what
 * it describes.
 *
 * So the card follows the point. It sits beside the marker, turns to face
 * whoever is reading it, and draws a line back to the marker so there is never a
 * question of which point it belongs to. The console panel stays as it was —
 * both routes write the same selection.
 *
 * ## One card, moved
 *
 * The card is a single scene-authored panel that gets repositioned, not one
 * panel per point. Five markers on a machine would otherwise mean five UIKitML
 * instances resident and five sets of glyph geometry, to show one of them at a
 * time.
 *
 * ## When it hides
 *
 * Turning the machine, changing machine, and clearing the selection all hide it.
 * The first of those is the one that matters: the card is placed in world space
 * against a marker that is about to travel through a full revolution, and a card
 * that chases it around the room is nausea, not information.
 */

import {
  createSystem,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  UIKit,
  UIKitMLAsset,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import { InspectionHotspotSystem } from './inspection-hotspots.js';
import { MachineSwapperSystem } from './machine-swapper.js';
import { MachineTurntableSystem } from './machine-turntable.js';
import type { Hotspot } from './machine-catalog.js';

const CARD_NODE_ID = 'hotspot-card';

/**
 * How far the card floats from its marker, toward the reader and upward.
 *
 * The horizontal part is capped against the reader's actual distance further
 * down: pushing a card 55 cm toward somebody standing 40 cm away would put it
 * behind their head.
 */
const OFFSET_TOWARD_READER = 0.55;
const OFFSET_UP = 0.5;
/** Never place the card closer to the reader than this, in metres. */
const MIN_READER_CLEARANCE = 0.35;
/** Radius of the connector, in metres. Thin enough to read as a leader line. */
const CONNECTOR_RADIUS = 0.008;

const KIND_LABEL: Record<Hotspot['kind'], string> = {
  sso: 'SEGURIDAD Y SALUD OCUPACIONAL',
  tec: 'ESPECIFICACION TECNICA',
  mto: 'MANTENIMIENTO PREVENTIVO',
};

const KIND_COLOR: Record<Hotspot['kind'], string> = {
  sso: '#d9700c',
  tec: '#0090c8',
  mto: '#1f9d55',
};

/** Matches the marker colours in InspectionHotspotSystem. */
const CONNECTOR_COLOR: Record<Hotspot['kind'], number> = {
  sso: 0xff8c1a,
  tec: 0x28c8ff,
  mto: 0x3ddc84,
};

export class HotspotCardSystem extends createSystem({}) {
  private hotspots: InspectionHotspotSystem | undefined;
  private card: UIKitMLAsset | undefined;
  private machineField: UIKit.Text | null | undefined;
  private kindField: UIKit.Text | null | undefined;
  private titleField: UIKit.Text | null | undefined;
  private bodyField: UIKit.Text | null | undefined;

  private connector: Mesh | undefined;
  private connectorMaterial: MeshBasicMaterial | undefined;
  /** True while the card should be on screen and tracking its marker. */
  private showing = false;

  /** Preallocated: `update` runs every frame and must not allocate. */
  private markerWorld!: Vector3;
  private readerWorld!: Vector3;
  private toReader!: Vector3;
  private cardWorld!: Vector3;
  private cardLocal!: Vector3;
  private connectorLocal!: Vector3;
  private axis!: Vector3;
  private up!: Vector3;
  private spin!: Quaternion;

  init(): void {
    this.markerWorld = new Vector3();
    this.readerWorld = new Vector3();
    this.toReader = new Vector3();
    this.cardWorld = new Vector3();
    this.cardLocal = new Vector3();
    this.connectorLocal = new Vector3();
    this.axis = new Vector3();
    this.up = new Vector3(0, 1, 0);
    this.spin = new Quaternion();

    const hotspots = this.world.getSystem(InspectionHotspotSystem);
    const swapper = this.world.getSystem(MachineSwapperSystem);
    const turntable = this.world.getSystem(MachineTurntableSystem);
    this.card = this.world.getSceneObject<UIKitMLAsset>(CARD_NODE_ID);
    if (hotspots == null || this.card == null) {
      console.warn(`[HotspotCard] ${CARD_NODE_ID} or its systems are missing`);
      return;
    }
    this.hotspots = hotspots;

    this.machineField = this.card.getElementById<UIKit.Text>('card-machine');
    this.kindField = this.card.getElementById<UIKit.Text>('card-kind');
    this.titleField = this.card.getElementById<UIKit.Text>('card-title');
    this.bodyField = this.card.getElementById<UIKit.Text>('card-body');

    // A unit cylinder along +Y, stretched and aimed each frame. A THREE.Line
    // would be cheaper but `linewidth` is ignored on every platform that
    // matters, which leaves a one-pixel thread nobody can see at two metres.
    const geometry = new CylinderGeometry(
      CONNECTOR_RADIUS,
      CONNECTOR_RADIUS,
      1,
      6,
    );
    this.connectorMaterial = new MeshBasicMaterial({
      color: CONNECTOR_COLOR.sso,
      toneMapped: false,
      transparent: true,
      opacity: 0.85,
    });
    this.connector = new Mesh(geometry, this.connectorMaterial);
    this.connector.name = 'hotspot-connector';
    this.connector.visible = false;
    this.world.createTransformEntity(this.connector);

    this.hide();

    this.cleanupFuncs.push(
      hotspots.selectedIndex.subscribe(() => this.render()),
      // Turning is the reason this hides at all: the marker is about to travel
      // a full revolution and the card cannot follow it without making the
      // reader seasick.
      turntable?.spinning.subscribe((spinning) => {
        if (spinning) {
          hotspots.select(-1);
        }
      }) ?? (() => {}),
      swapper?.mountedRevision.subscribe(() => this.hide()) ?? (() => {}),
    );
  }

  update(): void {
    if (!this.showing) {
      return;
    }
    const marker = this.hotspots?.selectedMarker;
    const card = this.card;
    if (marker == null || card == null) {
      this.hide();
      return;
    }

    marker.getWorldPosition(this.markerWorld);
    this.world.camera.getWorldPosition(this.readerWorld);

    // Push the card toward whoever is reading it, but never past them: at close
    // range the offset shrinks to whatever clearance is left.
    this.toReader.subVectors(this.readerWorld, this.markerWorld);
    this.toReader.y = 0;
    const distance = this.toReader.length();
    if (distance < 1e-3) {
      this.toReader.set(0, 0, 1);
    } else {
      this.toReader.divideScalar(distance);
    }
    const reach = Math.min(
      OFFSET_TOWARD_READER,
      Math.max(0, distance - MIN_READER_CLEARANCE),
    );
    this.cardWorld
      .copy(this.markerWorld)
      .addScaledVector(this.toReader, reach);
    this.cardWorld.y += OFFSET_UP;

    this.place(card, this.cardWorld);
    // Panels are single-sided and face +Z, so this is atan2(dx, dz) toward the
    // reader with no 180-degree term. Yaw only: a card that pitches to follow
    // someone's eye line is harder to read, not easier.
    card.rotation.set(
      0,
      Math.atan2(
        this.readerWorld.x - this.cardWorld.x,
        this.readerWorld.z - this.cardWorld.z,
      ),
      0,
    );

    this.updateConnector();
  }

  /** Fill the card for the current selection, or hide it when there is none. */
  private render(): void {
    const hotspot = this.hotspots?.selected;
    if (hotspot == null) {
      this.hide();
      return;
    }
    const swapper = this.world.getSystem(MachineSwapperSystem);
    this.machineField?.setProperties({
      text: swapper?.activeEntry?.label.toUpperCase() ?? '',
    });
    this.kindField?.setProperties({
      text: KIND_LABEL[hotspot.kind],
      color: KIND_COLOR[hotspot.kind],
    });
    this.titleField?.setProperties({ text: hotspot.title });
    this.bodyField?.setProperties({ text: hotspot.body });
    this.connectorMaterial?.color.setHex(CONNECTOR_COLOR[hotspot.kind]);

    this.showing = true;
    if (this.card != null) {
      this.card.visible = true;
    }
    if (this.connector != null) {
      this.connector.visible = true;
    }
    // Place it now rather than next frame, so it never appears for one frame at
    // wherever the last selection left it.
    this.update();
  }

  private hide(): void {
    this.showing = false;
    if (this.card != null) {
      this.card.visible = false;
    }
    if (this.connector != null) {
      this.connector.visible = false;
    }
  }

  /** Stretch and aim the connector between the marker and the card. */
  private updateConnector(): void {
    const connector = this.connector;
    if (connector == null) {
      return;
    }
    this.axis.subVectors(this.cardWorld, this.markerWorld);
    const length = this.axis.length();
    if (length < 1e-4) {
      connector.visible = false;
      return;
    }
    connector.visible = true;
    this.axis.divideScalar(length);

    this.connectorLocal
      .copy(this.markerWorld)
      .addScaledVector(this.axis, length / 2);
    this.place(connector, this.connectorLocal);
    // The geometry is a unit cylinder standing on +Y; this turns that axis onto
    // the marker-to-card direction and stretches it to span the gap.
    connector.quaternion.setFromUnitVectors(this.up, this.axis);
    connector.scale.set(1, length, 1);
  }

  /**
   * Put `object` at a world position, whatever it happens to be parented to.
   *
   * Both the card and the connector live under the level root, which is at the
   * origin today — but a scene that ever offsets its root would silently put
   * every card in the wrong place, and the conversion costs one matrix.
   */
  private place(object: Object3D, worldPosition: Vector3): void {
    const parent = object.parent;
    if (parent == null) {
      object.position.copy(worldPosition);
      return;
    }
    parent.updateWorldMatrix(true, false);
    this.cardLocal.copy(worldPosition);
    parent.worldToLocal(this.cardLocal);
    object.position.copy(this.cardLocal);
  }
}
