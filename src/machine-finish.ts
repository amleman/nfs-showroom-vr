/**
 * Gives a machine the finish of equipment under plant lighting, rather than the
 * flat matte look raw Sketchfab materials render with.
 *
 * A one-time pass per model, not a system: machines are mounted on demand, so
 * the swapper calls this the moment a model is fitted.
 *
 * This is deliberately a much lighter touch than the showroom-car pass it
 * replaces. A car is a polished object and wants to read as one; a haul truck is
 * painted steel that has been outdoors, and mirror-finishing it makes a 500-tonne
 * machine look like a die-cast model. So roughness is only nudged, and the real
 * work is `envMapIntensity` — without it these materials receive almost nothing
 * from the studio environment and the machine reads as a cutout.
 *
 * It only writes shader *uniforms*, so no material recompiles and no new shader
 * permutations. Deliberately absent: switching on `clearcoat` where a material
 * lacks it, which would change the permutation and cost a compile hitch for
 * every affected material.
 */

import type {
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
} from '@iwsdk/core';

/**
 * Materials rougher than this are rubber, track pad, canvas and matte plastic.
 * Leave them alone.
 */
const ROUGHNESS_CEILING = 0.7;
/** How far to close the gap to a polished finish, for everything under it. */
const ROUGHNESS_SCALE = 0.82;
/** Never fully mirror: industrial paint is never a mirror. */
const ROUGHNESS_FLOOR = 0.18;
/** Lifts environment reflection so the studio environment reaches the metal. */
const ENV_MAP_INTENSITY = 1.15;

/**
 * glTF materials are shared between the meshes that use them, and the asset
 * cache hands back a hierarchy whose materials are still the cached prototype's.
 * Tracking what has been finished keeps a re-visited machine from being
 * processed twice — and makes this safe to call on every mount.
 */
const finished = new WeakSet<Material>();

export function finishMachineMaterials(root: Object3D): void {
  root.traverse((object) => {
    const material = (object as Mesh).material;
    if (material == null) {
      return;
    }
    if (Array.isArray(material)) {
      for (const entry of material) {
        finishMaterial(entry);
      }
    } else {
      finishMaterial(material);
    }
  });
}

function finishMaterial(material: Material): void {
  const standard = material as MeshStandardMaterial;
  if (standard.isMeshStandardMaterial !== true || finished.has(material)) {
    return;
  }
  finished.add(material);

  standard.envMapIntensity = ENV_MAP_INTENSITY;

  if (standard.roughness > ROUGHNESS_CEILING) {
    return;
  }
  standard.roughness = Math.max(
    standard.roughness * ROUGHNESS_SCALE,
    ROUGHNESS_FLOOR,
  );

  // Clearcoat that the model already declared is kept but toned down: the
  // backhoe and the precision arm both ship it at showroom-car strength, which
  // under a white studio reads as wet rather than painted.
  const physical = material as MeshPhysicalMaterial;
  if (physical.isMeshPhysicalMaterial === true && physical.clearcoat > 0) {
    physical.clearcoat = Math.min(physical.clearcoat, 0.45);
  }
}
