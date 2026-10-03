import * as T from "three";
import type { SiteElement, StructuralElementKind } from "./domain";

const STRUCTURAL_KINDS = new Set<StructuralElementKind>([
  "column",
  "beam",
  "slab",
  "roof",
  "duct",
  "balcony",
  "boundary",
  "stair",
  "lift",
]);

export function isStructuralVisual(item: SiteElement) {
  return STRUCTURAL_KINDS.has(item.kind as StructuralElementKind);
}

export function addStructuralElementVisual(
  root: T.Object3D,
  item: SiteElement,
) {
  const geometry =
    item.shape === "cylinder"
      ? new T.CylinderGeometry(
          Math.max(0.025, Math.min(item.width, item.depth) / 2),
          Math.max(0.025, Math.min(item.width, item.depth) / 2),
          item.height,
          24,
        )
      : new T.BoxGeometry(item.width, item.height, item.depth);
  const mesh = new T.Mesh(
    geometry,
    new T.MeshStandardMaterial({
      color: item.color,
      roughness: 0.72,
      metalness: 0.03,
    }),
  );
  mesh.position.y = item.height / 2;
  mesh.name = `Structural · ${item.kind}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
}
