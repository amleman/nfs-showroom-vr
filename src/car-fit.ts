/**
 * Normalises an arbitrary car glTF onto the display dais.
 *
 * The models in `public/gltf/cars` are downloads from different authors and
 * agree on nothing: one is 40 m long, another is Z-up and arrives lying on its
 * back, several ship a big flat "ground" quad that z-fights the garage floor.
 * Hand-tuning a transform per model does not survive the next download, so the
 * fit is measured at load time instead.
 *
 * Order matters: hide the junk, then stand the model up, then scale, then seat
 * it. Each step invalidates the bounds the next one needs.
 */

import { Box3, Vector3, type Mesh, type Object3D } from '@iwsdk/core';

/** Every car is scaled to read at this length, so the carousel stays consistent. */
export const DISPLAY_LENGTH = 4.6;

/**
 * A backdrop or ground quad is far wider than the car and effectively flat.
 * Both tests are relative, so they hold whatever units the model is authored in.
 */
const OVERSIZE_FACTOR = 1.5;
const FLATNESS_RATIO = 0.05;

const meshBox = new Box3();
const bounds = new Box3();
const size = new Vector3();
const center = new Vector3();

/**
 * Fit `model` so it is centred on the origin, sitting on `deckY`, and
 * `DISPLAY_LENGTH` long. Returns false when the model has no usable geometry.
 */
export function fitCarToStage(model: Object3D, deckY: number): boolean {
  hideGroundPlanes(model);

  if (!measure(model, bounds)) {
    return false;
  }
  bounds.getSize(size);

  // Z-up exports with no root conversion matrix arrive standing on the nose or
  // lying on the back: the tallest axis is the one that should be the length.
  if (size.y > Math.max(size.x, size.z)) {
    model.rotation.x -= Math.PI / 2;
    model.updateMatrixWorld(true);
    if (!measure(model, bounds)) {
      return false;
    }
    bounds.getSize(size);
  }

  const length = Math.max(size.x, size.z);
  if (length > 0) {
    const scale = DISPLAY_LENGTH / length;
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    if (!measure(model, bounds)) {
      return false;
    }
  }

  // Seat it: centred horizontally, wheels on the deck.
  bounds.getCenter(center);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y += deckY - bounds.min.y;
  model.updateMatrixWorld(true);
  return true;
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
 * Hide flat quads far larger than the car itself. Excluding them from the bounds
 * is not enough — left visible they sit at y=0 and fight the garage floor.
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
  for (let i = 0; i < meshes.length; i += 1) {
    const mesh = meshes[i];
    const span = spans[i];
    if (span <= median * OVERSIZE_FACTOR || span === 0) {
      continue;
    }
    mesh.geometry.computeBoundingBox();
    const geometryBox = mesh.geometry.boundingBox;
    if (geometryBox == null) {
      continue;
    }
    meshBox.copy(geometryBox).applyMatrix4(mesh.matrixWorld);
    meshBox.getSize(size);
    if (size.y < span * FLATNESS_RATIO) {
      mesh.visible = false;
    }
  }
}
