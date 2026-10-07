import * as THREE from "three";
import type { BuildingPresentationManifestV1 } from "@rekixo/3d-contracts";
import type { HomeView } from "./viewerCamera";
import type { ExteriorView } from "./exteriorCamera";

async function sha256Hex(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function presentationMatchesModel(
  bytes: ArrayBuffer,
  presentation: BuildingPresentationManifestV1,
) {
  return (await sha256Hex(bytes)) === presentation.model.canonicalSha256;
}

/**
 * Apply release-bound presentation overrides only after the downloaded GLB
 * bytes match the immutable canonical checksum. Source maps and geometry are
 * intentionally left untouched.
 */
export async function applyBuildingPresentationMaterials(
  root: THREE.Object3D,
  presentation: BuildingPresentationManifestV1,
  modelBytes: ArrayBuffer,
  disposed: () => boolean,
) {
  if (!(await presentationMatchesModel(modelBytes, presentation)) || disposed())
    return false;

  const overrides = new Map(
    presentation.materials.overrides.map((item) => [item.materialName, item]),
  );
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const override = overrides.get(material.name);
      if (!override) continue;
      if (override.baseColor) material.color.set(override.baseColor);
      if (override.roughness !== undefined)
        material.roughness = override.roughness;
      if (override.metalness !== undefined)
        material.metalness = override.metalness;
      if (override.opacity !== undefined) {
        material.opacity = override.opacity;
        material.transparent = override.opacity < 0.999;
        material.depthWrite = override.opacity >= 0.999;
      }
      if (override.emissive) material.emissive.set(override.emissive);
      if (override.emissiveIntensity !== undefined)
        material.emissiveIntensity = override.emissiveIntensity;
      material.userData.buildingPresentationSource = override.source;
      material.needsUpdate = true;
    }
  });
  return true;
}

export function authoredExteriorView(
  presentation: BuildingPresentationManifestV1 | undefined,
  view: ExteriorView,
): HomeView | undefined {
  const shot = presentation?.cameras.shots.find((item) => item.kind === view);
  if (!shot) return undefined;
  return {
    position: new THREE.Vector3(
      shot.position.x,
      shot.position.y,
      shot.position.z,
    ),
    target: new THREE.Vector3(shot.target.x, shot.target.y, shot.target.z),
    fov: shot.fov,
  };
}

export function presentationStartsAtNight(
  presentation: BuildingPresentationManifestV1 | undefined,
) {
  return presentation?.appearance.mood === "evening" ||
    presentation?.appearance.mood === "night";
}
