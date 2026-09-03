/**
 * Gives a showcase car a polished finish instead of the flat, matte look the raw
 * Sketchfab materials render with.
 *
 * A one-time pass per model, not a system: cars are now mounted on demand, so
 * the swapper calls this the moment a model is fitted.
 *
 * It only writes shader *uniforms* — `roughness` and `envMapIntensity` — so no
 * material recompiles and no new shader permutations. Deliberately absent:
 * switching on `clearcoat` where a material lacks it, which would change the
 * shader permutation and cost a compile hitch for every affected material.
 */

import type {
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
} from '@iwsdk/core';

/**
 * Materials rougher than this are tyres, carpet, rubber trim and matte plastic.
 * Leave them alone — polishing everything makes a car look like a toy.
 */
const ROUGHNESS_CEILING = 0.65;
/** How far to close the gap to a mirror finish for everything under the ceiling. */
const ROUGHNESS_SCALE = 0.55;
/** Never fully mirror: a little roughness keeps the reflection reading as paint. */
const ROUGHNESS_FLOOR = 0.06;
/** Lifts environment reflection so the studio HDR actually shows on the bodywork. */
const ENV_MAP_INTENSITY = 1.85;
/** Only strengthened where the glTF already declared clearcoat. */
const MIN_CLEARCOAT = 0.65;

/**
 * glTF materials are shared between the meshes that use them, and
 * `assets.instantiate` hands out clones that still share the cached prototype's
 * materials. Tracking what has been polished keeps a re-visited car from being
 * polished twice — and makes this safe to call on every mount.
 */
const polished = new WeakSet<Material>();

export function polishCarMaterials(root: Object3D): void {
  root.traverse((object) => {
    const material = (object as Mesh).material;
    if (material == null) {
      return;
    }
    if (Array.isArray(material)) {
      for (const entry of material) {
        polishMaterial(entry);
      }
    } else {
      polishMaterial(material);
    }
  });
}

function polishMaterial(material: Material): void {
  const standard = material as MeshStandardMaterial;
  if (standard.isMeshStandardMaterial !== true || polished.has(material)) {
    return;
  }
  polished.add(material);

  if (standard.roughness > ROUGHNESS_CEILING) {
    return;
  }
  standard.roughness = Math.max(
    standard.roughness * ROUGHNESS_SCALE,
    ROUGHNESS_FLOOR,
  );
  standard.envMapIntensity = ENV_MAP_INTENSITY;

  const physical = material as MeshPhysicalMaterial;
  if (physical.isMeshPhysicalMaterial === true && physical.clearcoat > 0) {
    physical.clearcoat = Math.max(physical.clearcoat, MIN_CLEARCOAT);
  }
}
