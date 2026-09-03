/**
 * GPU resource release for models the app owns outright.
 *
 * three.js reference-counts nothing: a geometry, material or texture stays in
 * VRAM until something calls `dispose()` on it. On a standalone headset that is
 * the difference between a showroom that runs and one the browser kills — a
 * single car here is up to 40 MB of source and far more decoded.
 *
 * Only ever call this on a hierarchy whose resources are not shared with the
 * rest of the scene. It walks materials to their textures, which is exactly what
 * you must NOT do to something sharing the environment map or a prototype.
 */

import { Mesh, type Material, type Object3D, type Texture } from '@iwsdk/core';

/** Material fields that can hold a texture, in three's standard/physical set. */
const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'lightMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'specularMap',
  'specularColorMap',
  'specularIntensityMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'anisotropyMap',
] as const;

/**
 * Dispose every geometry, material and texture under `root`.
 *
 * Sets dedupe: glTF materials are shared between the meshes that use them, and a
 * texture is shared between the materials that reference it, so a naive walk
 * would call `dispose()` on the same object dozens of times.
 */
export function disposeHierarchy(root: Object3D): void {
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true) {
      return;
    }
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        materials.add(entry);
      }
    } else if (material != null) {
      materials.add(material);
    }
  });

  for (const material of materials) {
    collectTextures(material, textures);
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
  }

  root.removeFromParent();
}

function collectTextures(material: Material, into: Set<Texture>): void {
  const record = material as unknown as Record<string, unknown>;
  for (const slot of TEXTURE_SLOTS) {
    const value = record[slot] as Texture | null | undefined;
    // `envMap` is deliberately absent from TEXTURE_SLOTS: it points at the
    // scene's shared IBL, and disposing it would black out every other material.
    if (value != null && (value as Texture).isTexture === true) {
      into.add(value);
    }
  }
}
