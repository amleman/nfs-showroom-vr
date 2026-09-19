/**
 * Puts the machine's inspection points on the machine.
 *
 * This is what separates a model viewer from a technical tool: a visitor can
 * walk up to the rear of a haul truck, point at the thing in front of them, and
 * read why a ten-metre exclusion zone exists around it. The panel carries the
 * same list as buttons, so the information is reachable either way — the markers
 * are the spatial affordance, not the only route to the content.
 *
 * ## Where a marker ends up
 *
 * Hotspots are authored in normalised bounds space (see `MACHINE_CATALOG`), so
 * one authored anchor lands on the right part of a 1.45 m robot arm and a 7.9 m
 * haul truck. Turning that into a position needs the machine's measured
 * footprint, which only exists after `fitMachineToFloor` has run — hence the
 * rebuild on `mountedRevision` rather than anything at init time.
 *
 * Markers are parented to the **mount entity**, not to the machine's pivot:
 * `createTransformEntity` takes an `Entity` as its parent and the pivot is a
 * plain `Object3D` the swapper owns. So the pivot's presentation yaw is applied
 * to the anchor by hand here. Both live under the turntable, so both turn
 * together and a marker stays on the part it names.
 */

import {
  Color,
  createSystem,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  PokeInteractable,
  Pressed,
  RayInteractable,
  Raycaster,
  signal,
  SphereGeometry,
  Vector3,
  type Entity,
  type Object3D,
} from '@iwsdk/core';
import { InspectionPoint } from './inspection-component.js';
import { MachineSwapperSystem } from './machine-swapper.js';
import type { Hotspot } from './machine-catalog.js';

/** Scene node the machine hangs from; markers are parented to its entity. */
const MOUNT_NODE_ID = 'machine-mount';

/** Marker radius as a fraction of the machine's height, and its hard limits. */
const RADIUS_RATIO = 0.035;
const RADIUS_MIN = 0.07;
const RADIUS_MAX = 0.3;
/** The halo is this many times the core. */
const HALO_SCALE = 2.1;
/** Growth applied to the marker under the pointer, and to the selected one. */
const HOVER_SCALE = 1.3;
const SELECTED_SCALE = 1.45;
/**
 * How far outside the machine each snap ray starts, as a multiple of the
 * authored anchor's own offset from the centreline.
 */
const RAY_START_FACTOR = 1.8;
/**
 * A marker floats this fraction of its own radius off the surface it landed on,
 * so it reads as a tag on the machine rather than a bubble inside it.
 */
const SURFACE_LIFT = 0.55;
/**
 * Anchors closer to the machine's vertical axis than this fraction of its
 * half-extent are left where they are. There is no meaningful outward direction
 * for a point on the centreline, and those anchors — a robot's base reducer, a
 * truck's driveline — are deliberately inside the machine anyway.
 */
const CENTRELINE_EPSILON = 0.08;

/**
 * Safety orange, instrument cyan, maintenance green. Three colours because a
 * visitor should be able to tell an occupational-safety point from a service
 * point across the hall, before reading a word of it.
 */
const KIND_COLOR: Record<Hotspot['kind'], number> = {
  sso: 0xff8c1a,
  tec: 0x28c8ff,
  mto: 0x3ddc84,
};

interface Marker {
  entity: Entity;
  halo: Mesh;
  baseScale: number;
}

export class InspectionHotspotSystem extends createSystem({
  pressed: { required: [InspectionPoint, Pressed] },
  hovered: { required: [InspectionPoint, Hovered] },
}) {
  /** Index of the inspection point on show, or -1 for none. */
  readonly selectedIndex = signal(-1);

  private swapper: MachineSwapperSystem | undefined;
  private mountEntity: Entity | undefined;
  private readonly markers: Marker[] = [];
  /** Preallocated: `update` and the rebuild both run without allocating. */
  private anchor!: Vector3;
  private centre!: Vector3;
  private rayOrigin!: Vector3;
  private rayDirection!: Vector3;
  private raycaster!: Raycaster;
  /** Shared across every marker; disposed by world teardown, never by a marker. */
  private coreGeometry!: SphereGeometry;
  private haloGeometry!: SphereGeometry;

  init(): void {
    this.anchor = new Vector3();
    this.centre = new Vector3();
    this.rayOrigin = new Vector3();
    this.rayDirection = new Vector3();
    // A raycaster used for geometry, not for interaction — the project rule
    // against hand-rolled raycasters is about input, and input here is
    // `RayInteractable`. This runs five times per machine swap, inside the load
    // the visitor is already waiting through.
    this.raycaster = new Raycaster();
    // Low segment counts on purpose: these are 10 cm spheres and there may be
    // five of them. Nobody counts the facets, and the triangles are better spent
    // on the machine.
    this.coreGeometry = new SphereGeometry(1, 12, 8);
    this.haloGeometry = new SphereGeometry(1, 12, 8);

    this.swapper = this.world.getSystem(MachineSwapperSystem);
    if (this.swapper == null) {
      return;
    }

    this.cleanupFuncs.push(
      // Fires immediately with the current value, so a machine already mounted
      // when this system starts still gets its markers.
      this.swapper.mountedRevision.subscribe(() => this.rebuild()),
      this.queries.pressed.subscribe('qualify', (entity) => {
        const index = entity.getValue(InspectionPoint, 'index');
        if (index != null) {
          this.select(index);
        }
      }),
      this.queries.hovered.subscribe('qualify', (entity) =>
        this.applyScale(entity),
      ),
      this.queries.hovered.subscribe('disqualify', (entity) =>
        this.applyScale(entity),
      ),
    );
  }

  /** Show an inspection point, or clear the selection with -1. */
  select(index: number): void {
    const previous = this.selectedIndex.peek();
    if (previous === index) {
      return;
    }
    this.selectedIndex.value = index;
    for (const marker of this.markers) {
      this.applyScale(marker.entity);
    }
  }

  /** The inspection point on show, or undefined. */
  get selected(): Hotspot | undefined {
    const index = this.selectedIndex.peek();
    return index < 0 ? undefined : this.hotspots[index];
  }

  /**
   * The marker object for the point on show, or undefined.
   *
   * `HotspotCardSystem` anchors its floating card and connector to this. It is
   * handed out as the live object rather than a copied position because the
   * marker turns with the machine, and a position read once would be stale the
   * moment the turntable moved.
   */
  get selectedMarker(): Object3D | undefined {
    const index = this.selectedIndex.peek();
    if (index < 0) {
      return undefined;
    }
    return this.markers.find(
      (marker) => marker.entity.getValue(InspectionPoint, 'index') === index,
    )?.entity.object3D;
  }

  private get hotspots(): readonly Hotspot[] {
    return this.swapper?.activeEntry?.hotspots ?? [];
  }

  /**
   * Tear the old markers down and place the new machine's.
   *
   * `disposeResources: false` matters: every marker shares two geometries and
   * the default would dispose them out from under the markers still standing.
   */
  private rebuild(): void {
    for (const marker of this.markers) {
      marker.entity.dispose({ disposeResources: false });
    }
    this.markers.length = 0;
    this.selectedIndex.value = -1;

    const swapper = this.swapper;
    const fit = swapper?.mountedFit;
    const entry = swapper?.activeEntry;
    if (swapper == null || fit == null || entry == null) {
      return;
    }
    this.mountEntity ??= this.world.getSceneEntity(MOUNT_NODE_ID);
    if (this.mountEntity == null) {
      return;
    }

    const radius = Math.min(
      RADIUS_MAX,
      Math.max(RADIUS_MIN, fit.height * RADIUS_RATIO),
    );
    const yaw = (entry.yawDeg * Math.PI) / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const mountObject = this.world.getSceneObject(MOUNT_NODE_ID);
    const machine = swapper.mountedMachine;
    mountObject?.updateWorldMatrix(true, true);

    for (let i = 0; i < entry.hotspots.length; i += 1) {
      const hotspot = entry.hotspots[i];
      const [nx, ny, nz] = hotspot.anchor;
      // Normalised bounds space -> the machine's own frame, then rotated by the
      // presentation yaw the pivot carries, which puts it in mount space.
      const x = nx * fit.halfX;
      const z = nz * fit.halfZ;
      this.anchor.set(x * cos + z * sin, ny * fit.height, -x * sin + z * cos);
      this.snapToSurface(this.anchor, fit, radius, mountObject, machine);

      const color = KIND_COLOR[hotspot.kind];

      // The halo is the ROOT and the bright core hangs off it, which looks
      // backwards and is not. `RayInteractable` registers the entity's own
      // Object3D as the raycast target, and whether that walks into children is
      // not something to find out in front of a visitor — so the thing being
      // aimed at is the 60 cm shell, not the 12 cm bead inside it. It is also
      // what makes the marker findable across a fifty-metre hall.
      const halo = new Mesh(
        this.haloGeometry,
        new MeshBasicMaterial({
          color: new Color(color),
          toneMapped: false,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        }),
      );
      halo.name = `hotspot:${hotspot.id}`;
      halo.position.copy(this.anchor);

      const core = new Mesh(
        this.coreGeometry,
        new MeshBasicMaterial({ color: new Color(color), toneMapped: false }),
      );
      core.name = `hotspot-core:${hotspot.id}`;
      // Local to the halo, so the visible bead stays `radius` across whatever
      // the halo is scaled to for hover and selection.
      core.scale.setScalar(1 / HALO_SCALE);
      halo.add(core);

      const baseScale = radius * HALO_SCALE;
      halo.scale.setScalar(baseScale);

      const entity = this.world.createTransformEntity(halo, {
        parent: this.mountEntity,
      });
      entity.addComponent(InspectionPoint, { index: i });
      entity.addComponent(RayInteractable);
      // Poke as well as ray. A visitor reading a point is standing at the
      // machine, and at half a metre a finger or a controller tip is a better
      // instrument than a ray they have to hold steady.
      entity.addComponent(PokeInteractable);

      this.markers.push({ entity, halo, baseScale });
    }
  }

  /**
   * Pull an authored anchor onto the machine's actual skin.
   *
   * The anchors in `MACHINE_CATALOG` are normalised against the bounding box,
   * which is what lets one authored point work on a 1.5 m robot arm and a 7.9 m
   * haul truck — but a bounding box around an excavator with its boom up is
   * mostly air, so an anchor that is correct in proportion can still land two
   * metres off the steel. And every time a machine's `realHeight` is retuned,
   * every one of its anchors moves again.
   *
   * So the anchor stops being a position and becomes a direction: a ray is cast
   * from outside the machine, inward toward its centreline at that height, and
   * the marker sits wherever that ray first meets geometry. Anchors are then
   * only ever wrong about *which side* of the machine they name, which is a much
   * easier thing to get right by eye.
   *
   * Leaves the anchor untouched when there is nothing to hit, so a bad snap can
   * never be worse than the authored position.
   */
  private snapToSurface(
    anchor: Vector3,
    fit: NonNullable<MachineSwapperSystem['mountedFit']>,
    radius: number,
    mountObject: Object3D | undefined,
    machine: Object3D | undefined,
  ): void {
    if (mountObject == null || machine == null) {
      return;
    }
    // Points on the centreline have no outward direction, and are deliberately
    // inside the machine in any case.
    const reach = Math.hypot(anchor.x, anchor.z);
    if (reach < Math.max(fit.halfX, fit.halfZ) * CENTRELINE_EPSILON) {
      return;
    }

    this.centre.set(0, anchor.y, 0);
    this.rayOrigin
      .copy(this.centre)
      .addScaledVector(
        this.rayDirection.subVectors(anchor, this.centre),
        RAY_START_FACTOR,
      );
    mountObject.localToWorld(this.rayOrigin);
    mountObject.localToWorld(this.centre);
    this.rayDirection.subVectors(this.centre, this.rayOrigin).normalize();

    this.raycaster.set(this.rayOrigin, this.rayDirection);
    const hits = this.raycaster.intersectObject(machine, true);
    if (hits.length === 0) {
      return;
    }
    anchor
      .copy(hits[0].point)
      .addScaledVector(this.rayDirection, -radius * SURFACE_LIFT);
    mountObject.worldToLocal(anchor);
  }

  /**
   * Size a marker for its current state. Hover and selection are both expressed
   * as scale rather than colour, so the kind colour stays readable throughout.
   */
  private applyScale(entity: Entity): void {
    const marker = this.markers.find((candidate) => candidate.entity === entity);
    if (marker == null) {
      return;
    }
    const index = entity.getValue(InspectionPoint, 'index');
    const selected = index != null && index === this.selectedIndex.peek();
    const hovered = entity.hasComponent(Hovered);
    const scale = selected
      ? SELECTED_SCALE
      : hovered
        ? HOVER_SCALE
        : 1;
    entity.object3D?.scale.setScalar(marker.baseScale * scale);
    (marker.halo.material as MeshBasicMaterial).opacity = selected
      ? 0.42
      : hovered
        ? 0.34
        : 0.22;
  }
}
