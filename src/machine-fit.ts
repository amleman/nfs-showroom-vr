/**
 * Puts an arbitrary machine glTF on the floor at true 1:1 scale.
 *
 * The models in `public/gltf/industrial` are downloads from different authors
 * and agree on nothing. Measured as authored, the dump truck is 16.7 units long,
 * the excavator 0.117, the tracked vehicle 31 million. None of them carries a
 * unit, and several arrive lying on their back. There is no property of the file
 * that says how big the thing is meant to be, which is why `MACHINE_CATALOG`
 * declares the real height in metres and this measures the rest.
 *
 * That is the whole point of the exhibit: a visitor standing next to a haul
 * truck has to read 7.9 m off their own body, and that only works if the number
 * is right. A machine scaled to "looks about right" is a toy.
 *
 * Order matters: hide the junk, then stand the model up, then scale, then seat
 * it. Each step invalidates the bounds the next one needs.
 */

import { Box3, MathUtils, Vector3, type Mesh, type Object3D } from '@iwsdk/core';

/**
 * What the fit measured, in metres, once the machine is on the floor.
 *
 * The spec panel quotes these rather than the catalog, so the dimensions a
 * visitor reads are the dimensions of the object actually in front of them.
 */
export interface MachineFit {
  /** Longest horizontal extent. */
  length: number;
  /** Shortest horizontal extent. */
  width: number;
  height: number;
  /** Half-extents about the machine's own centre, for anchoring hotspots. */
  halfX: number;
  halfZ: number;
}

/**
 * A backdrop or ground quad is far wider than the machine and effectively flat.
 * Both tests are relative, so they hold in whatever units the model is authored
 * in — which is the only reason they work across a 0.117-unit excavator and a
 * 31-million-unit tracked vehicle.
 */
const OVERSIZE_FACTOR = 1.5;
const FLATNESS_RATIO = 0.05;
/**
 * Second, narrower test for author-signature decals and shadow-catcher planes
 * laid on the floor beside the model. They are single quads of effectively zero
 * height but not wide enough to trip OVERSIZE_FACTOR, so they survive the first
 * test and drag the model's centre sideways.
 *
 * Nothing structural on a machine is a zero-thickness sheet lying on the ground,
 * so the test is height against the model's own height plus proximity to its
 * floor. Both ratios are deliberately tight: a real undercarriage has thickness.
 */
const SHEET_HEIGHT_RATIO = 0.005;
const FLOOR_PROXIMITY_RATIO = 0.02;

const meshBox = new Box3();
const bounds = new Box3();
const size = new Vector3();
const center = new Vector3();

/**
 * Fit `model` so it stands on y = 0, centred on the origin horizontally, at
 * exactly `realHeight` metres tall. Returns the measured dimensions, or
 * undefined when the model has no usable geometry.
 *
 * `alignYawDeg` turns the model square-on **before** it is measured, for the
 * models whose author left the whole assembly rotated inside the file. That is
 * not cosmetic: an axis-aligned box drawn around a vehicle sitting at 29 degrees
 * is far wider than the vehicle, and the spec panel quotes that width to a
 * visitor as a fact. On the service truck it is the difference between reporting
 * 4.9 m and 2.8 m across.
 *
 * It is a different thing from the catalog's `yawDeg`, which is the presentation
 * angle and lives on the pivot above this — applied after the fit, so it can
 * never falsify the measurement.
 */
export function fitMachineToFloor(
  model: Object3D,
  realHeight: number,
  alignYawDeg = 0,
): MachineFit | undefined {
  hideGroundPlanes(model);

  if (!measure(model, bounds)) {
    return undefined;
  }
  bounds.getSize(size);

  // Z-up exports with no root conversion matrix arrive standing on the nose or
  // lying on their back: the tallest axis is the one that should be the length.
  // A machine is wider or longer than it is tall in every case in this catalog,
  // including the robot arms.
  if (size.y > Math.max(size.x, size.z)) {
    model.rotation.x -= Math.PI / 2;
    model.updateMatrixWorld(true);
    if (!measure(model, bounds)) {
      return undefined;
    }
    bounds.getSize(size);
  }

  if (alignYawDeg !== 0) {
    model.rotation.y += MathUtils.degToRad(alignYawDeg);
    model.updateMatrixWorld(true);
    if (!measure(model, bounds)) {
      return undefined;
    }
    bounds.getSize(size);
  }

  // The scale that makes this 1:1. Height is the anchor — see MACHINE_CATALOG
  // for why it beats length on machines that carry an articulated arm.
  if (size.y > 0) {
    model.scale.multiplyScalar(realHeight / size.y);
    model.updateMatrixWorld(true);
    if (!measure(model, bounds)) {
      return undefined;
    }
    bounds.getSize(size);
  }

  // Seat it: centred horizontally, tracks and wheels on the floor.
  bounds.getCenter(center);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= bounds.min.y;
  model.updateMatrixWorld(true);

  return {
    length: Math.max(size.x, size.z),
    width: Math.min(size.x, size.z),
    height: size.y,
    halfX: size.x / 2,
    halfZ: size.z / 2,
  };
}

/**
 * World-space bounds of the visible meshes. `Box3.setFromObject` would include
 * the planes hidden above, which is the whole reason this is done by hand.
 */
function measure(model: Object3D, target: Box3): boolean {
  model.updateMatrixWorld(true);
  target.makeEmpty();
  model.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true || !mesh.visible || mesh.geometry == null) {
      return;
    }
    mesh.geometry.computeBoundingBox();
    const geometryBox = mesh.geometry.boundingBox;
    if (geometryBox == null) {
      return;
    }
    meshBox.copy(geometryBox).applyMatrix4(mesh.matrixWorld);
    target.union(meshBox);
  });
  return !target.isEmpty();
}

/**
 * Hide flat quads far larger than the machine itself. Excluding them from the
 * bounds is not enough — left visible they sit at the model's floor and fight
 * the showroom floor, and one of these models ships a mesh whose material is
 * literally named `floor`.
 */
function hideGroundPlanes(model: Object3D): void {
  model.updateMatrixWorld(true);

  const meshes: Mesh[] = [];
  const spans: number[] = [];
  model.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true || mesh.geometry == null) {
      return;
    }
    mesh.geometry.computeBoundingBox();
    const geometryBox = mesh.geometry.boundingBox;
    if (geometryBox == null) {
      return;
    }
    meshBox.copy(geometryBox).applyMatrix4(mesh.matrixWorld);
    meshBox.getSize(size);
    meshes.push(mesh);
    spans.push(Math.max(size.x, size.z));
  });
  if (meshes.length === 0) {
    return;
  }

  const median = [...spans].sort((a, b) => a - b)[Math.floor(spans.length / 2)];

  // Reference height for the sheet test. Measured over everything, junk
  // included — it only has to be the right order of magnitude.
  bounds.makeEmpty();
  for (const mesh of meshes) {
    const geometryBox = mesh.geometry.boundingBox;
    if (geometryBox != null) {
      bounds.union(meshBox.copy(geometryBox).applyMatrix4(mesh.matrixWorld));
    }
  }
  bounds.getSize(size);
  const totalHeight = size.y;
  const floorY = bounds.min.y;

  for (let i = 0; i < meshes.length; i += 1) {
    const mesh = meshes[i];
    const span = spans[i];
    if (span === 0) {
      continue;
    }
    const geometryBox = mesh.geometry.boundingBox;
    if (geometryBox == null) {
      continue;
    }
    meshBox.copy(geometryBox).applyMatrix4(mesh.matrixWorld);
    meshBox.getSize(size);

    const oversizedAndFlat =
      span > median * OVERSIZE_FACTOR && size.y < span * FLATNESS_RATIO;
    const sheetOnTheFloor =
      size.y <= totalHeight * SHEET_HEIGHT_RATIO &&
      meshBox.min.y <= floorY + totalHeight * FLOOR_PROXIMITY_RATIO;

    if (oversizedAndFlat || sheetOnTheFloor) {
      mesh.visible = false;
    }
  }
}
