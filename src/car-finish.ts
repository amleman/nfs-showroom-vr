/**
 * Gives the showcase cars a polished finish instead of the flat, matte look the
 * raw Sketchfab materials render with under a gradient IBL.
 *
 * Cost is a one-time pass at load and nothing per frame. It only writes shader
 * *uniforms* — `roughness` and `envMapIntensity` — so no material recompiles and
 * no new shader permutations. Deliberately absent: switching on `clearcoat` where
 * a material lacks it, which would change the shader permutation and cost a
 * compile hitch for every affected material.
 */

import {
  createSystem,
  Entity,
  Mesh,
  type Material,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
} from '@iwsdk/core';
import { CarShowcase } from './car-showcase-component.js';

/**
 * Materials rougher than this are tyres, carpet, rubber trim and matte plastic.
 * Leave them alone — polishing everything makes a car look like a toy.
 */
const ROUGHNESS_CEILING = 0.65;
/** How far to close the gap to a mirror finish for everything under the ceiling. */
const ROUGHNESS_SCALE = 0.55;
/** Never fully mirror: a little roughness keeps the reflection reading as paint. */
const ROUGHNESS_FLOOR = 0.06;
/** Lifts environment reflection so the IBL actually shows on the bodywork. */
const ENV_MAP_INTENSITY = 1.85;
/** Only strengthened where the glTF already declared clearcoat. */
const MIN_CLEARCOAT = 0.65;

export class CarFinishSystem extends createSystem({
  cars: { required: [CarShowcase] },
}) {
  /**
   * glTF materials are shared across every mesh that uses them, so the same
   * material reaches this pass many times over. Each car asset is placed exactly
   * once in the scene, so mutating in place is safe here — add a second placement
   * of the same asset and both would inherit this finish.
   */
  private readonly polished = new Set<Material>();

  init(): void {
    this.queries.cars.subscribe('qualify', (entity) => this.polish(entity));
    for (const entity of this.queries.cars.entities) {
      this.polish(entity);
    }
  }

  private polish(entity: Entity): void {
    const root = entity.object3D;
    if (root == null) {
      return;
    }
    root.traverse((object) => {
      const material = (object as Mesh).material;
      if (material == null) {
        return;
      }
      if (Array.isArray(material)) {
        for (const entry of material) {
          this.polishMaterial(entry);
        }
      } else {
        this.polishMaterial(material);
      }
    });
  }

  private polishMaterial(material: Material): void {
    const standard = material as MeshStandardMaterial;
    if (standard.isMeshStandardMaterial !== true || this.polished.has(material)) {
      return;
    }
    this.polished.add(material);

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
}
