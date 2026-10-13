import * as THREE from "three";
import type { FloorGeometryLevel } from "./floorGeometry";

interface MeshRecord {
  mesh: THREE.Mesh;
  originalVisible: boolean;
  floor: number | null;
  shared: boolean;
}

export interface FloorVisibilityController {
  showFloor(level: FloorGeometryLevel): void;
  showAll(): void;
  dispose(): void;
}

function floorFromNodeName(name: string): number | null {
  const normalized = name.trim().toLowerCase().replace(/[\\s-]+/g, "_");
  if (/^(ground|ground_floor|stilt|floor_?0|level_?0|gf)$/.test(normalized)) return 0;
  const match = normalized.match(/^(?:floor|level|storey|story|f)_?(\\d+)(?:_.*)?$/);
  if (match) return Number(match[1]);
  const suffix = normalized.match(/(?:^|_)(?:floor|level|storey|story|f)_?(\\d+)(?:_|$)/);
  if (suffix) return Number(suffix[1]);
  return null;
}

function boxFor(mesh: THREE.Mesh): THREE.Box3 | null {
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  return box.isEmpty() ? null : box;
}

/**
 * Isolates customer floors by toggling the original imported mesh objects.
 * Meshes spanning multiple floor bands are treated as shared building fabric
 * and remain visible rather than being cut or destructively split.
 */
export function createFloorVisibilityController(
  root: THREE.Object3D,
): FloorVisibilityController {
  root.updateMatrixWorld(true);
  const records: MeshRecord[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const box = boxFor(node);
    if (!box) return;
    const nameFloor = floorFromNodeName(node.name);
    records.push({
      mesh: node,
      originalVisible: node.visible,
      floor: nameFloor,
      shared: false,
    });
  });

  const showAll = () => {
    for (const record of records) record.mesh.visible = record.originalVisible;
  };

  return {
    showFloor(level) {
      const bottom = level.elevationM;
      const top = level.topElevationM;
      for (const record of records) {
        const box = boxFor(record.mesh);
        if (!box) {
          record.mesh.visible = record.originalVisible;
          continue;
        }
        const height = box.max.y - box.min.y;
        const centerY = (box.min.y + box.max.y) / 2;
        const nameFloor = record.floor;

        // A name-based assignment is only trusted for explicit floor labels.
        if (nameFloor !== null) {
          record.mesh.visible = record.originalVisible &&
            (nameFloor === level.floor || height > Math.max(top - bottom, 0.1) * 1.5);
          continue;
        }

        // Keep structural/facade objects spanning several storeys intact.
        // Never slice them: they stay visible in every floor view.
        if (height > Math.max(top - bottom, 0.1) * 1.5) {
          record.mesh.visible = record.originalVisible;
          continue;
        }

        const centerInSelectedBand = centerY >= bottom - 0.02 && centerY <= top + 0.02;
        record.mesh.visible = record.originalVisible && centerInSelectedBand;
      }
    },
    showAll,
    dispose: showAll,
  };
}
