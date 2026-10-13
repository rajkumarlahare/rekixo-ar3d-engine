import * as THREE from "three";
import type { FloorGeometryLevel } from "./floorGeometry";

interface MeshRecord {
  mesh: THREE.Mesh;
  originalVisible: boolean;
  originalMaterial: THREE.Material | THREE.Material[];
  ghostMaterial?: THREE.Material | THREE.Material[];
  floor: number | null;
}

export interface FloorVisibilityController {
  showFloor(level: FloorGeometryLevel): void;
  showAll(): void;
  dispose(): void;
}

function floorFromNodeName(name: string): number | null {
  const normalized = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/^(ground|ground_floor|stilt|floor_?0|level_?0|gf|groundfloor)$/.test(normalized)) return 0;

  const wordFloor: Record<string, number> = {
    first: 1, first_floor: 1, "1st_floor": 1,
    second: 2, second_floor: 2, "2nd_floor": 2,
    third: 3, third_floor: 3, "3rd_floor": 3,
    fourth: 4, fourth_floor: 4, "4th_floor": 4,
    fifth: 5, fifth_floor: 5, "5th_floor": 5,
    sixth: 6, sixth_floor: 6, "6th_floor": 6,
    seventh: 7, seventh_floor: 7, "7th_floor": 7,
    eighth: 8, eighth_floor: 8, "8th_floor": 8,
    ninth: 9, ninth_floor: 9, "9th_floor": 9,
    tenth: 10, tenth_floor: 10, "10th_floor": 10,
  };
  if (wordFloor[normalized] !== undefined) return wordFloor[normalized];

  const prefixed = normalized.match(/^(?:floor|level|storey|story|f)_?(\d+)(?:_.*)?$/);
  if (prefixed) return Number(prefixed[1]);

  const suffixed = normalized.match(/^(\d+)(?:st|nd|rd|th)?_?(?:floor|level|storey|story|f)$/);
  if (suffixed) return Number(suffixed[1]);

  const embedded = normalized.match(/(?:^|_)(?:floor|level|storey|story)_?(\d+)(?:_|$)/);
  if (embedded) return Number(embedded[1]);

  return null;
}

function floorFromHierarchy(node: THREE.Object3D): number | null {
  let current: THREE.Object3D | null = node;
  while (current) {
    const floor = floorFromNodeName(current.name);
    if (floor !== null) return floor;
    current = current.parent;
  }
  return null;
}

function boxFor(mesh: THREE.Mesh): THREE.Box3 | null {
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  return box.isEmpty() ? null : box;
}

function ghostMaterialFor(record: MeshRecord): THREE.Material | THREE.Material[] {
  if (record.ghostMaterial) return record.ghostMaterial;
  const makeGhost = (material: THREE.Material) => {
    const clone = material.clone();
    const materialWithOpacity = clone as THREE.Material & {
      opacity?: number;
      transparent?: boolean;
      depthWrite?: boolean;
    };
    if (typeof materialWithOpacity.opacity === "number")
      materialWithOpacity.opacity = Math.min(materialWithOpacity.opacity, 0.16);
    if ("transparent" in materialWithOpacity) materialWithOpacity.transparent = true;
    if ("depthWrite" in materialWithOpacity) materialWithOpacity.depthWrite = false;
    clone.needsUpdate = true;
    return clone;
  };
  record.ghostMaterial = Array.isArray(record.originalMaterial)
    ? record.originalMaterial.map(makeGhost)
    : makeGhost(record.originalMaterial);
  return record.ghostMaterial;
}

/**
 * Shows the selected floor using existing mesh objects; no mesh is cut or
 * reconstructed. Unlabelled objects spanning multiple storeys remain as
 * translucent context so they do not obscure the selected floor in plan view.
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
    records.push({
      mesh: node,
      originalVisible: node.visible,
      originalMaterial: node.material,
      floor: floorFromHierarchy(node),
    });
  });

  const showAll = () => {
    for (const record of records) {
      record.mesh.visible = record.originalVisible;
      record.mesh.material = record.originalMaterial;
    }
  };

  return {
    showFloor(level) {
      const bottom = level.elevationM;
      const top = level.topElevationM;
      const selectedHeight = Math.max(top - bottom, 0.1);

      for (const record of records) {
        const box = boxFor(record.mesh);
        if (!box) {
          record.mesh.visible = record.originalVisible;
          record.mesh.material = record.originalMaterial;
          continue;
        }

        const height = box.max.y - box.min.y;
        const centerY = (box.min.y + box.max.y) / 2;

        // A reviewed/explicit group label wins over bounds heuristics.
        if (record.floor !== null) {
          record.mesh.material = record.originalMaterial;
          record.mesh.visible = record.originalVisible && record.floor === level.floor;
          continue;
        }

        // The original object spans storeys: keep it as ghost context, never cut it.
        if (height > selectedHeight * 1.5) {
          record.mesh.visible = record.originalVisible;
          record.mesh.material = ghostMaterialFor(record);
          continue;
        }

        record.mesh.material = record.originalMaterial;
        const centerInSelectedBand =
          centerY >= bottom - 0.02 && centerY <= top + 0.02;
        record.mesh.visible = record.originalVisible && centerInSelectedBand;
      }
    },
    showAll,
    dispose() {
      showAll();
      for (const record of records) {
        const materials = Array.isArray(record.ghostMaterial)
          ? record.ghostMaterial
          : record.ghostMaterial
            ? [record.ghostMaterial]
            : [];
        for (const material of materials) material.dispose();
        record.ghostMaterial = undefined;
      }
    },
  };
}
