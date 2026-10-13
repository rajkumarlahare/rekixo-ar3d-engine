import * as THREE from "three";
import type { FloorGeometryLevel } from "./floorGeometry";

interface MeshRecord {
  mesh: THREE.Mesh;
  box: THREE.Box3;
  originalVisible: boolean;
  originalMaterial: THREE.Material | THREE.Material[];
  contextMaterials?: Map<number, THREE.Material | THREE.Material[]>;
  floor: number | null;
}

export interface FloorVisibilityController {
  /** True when this level contains original opaque meshes that can be isolated. */
  hasFloor(level: FloorGeometryLevel): boolean;
  /** Show one complete source floor and return its non-ghost mesh bounds. */
  showFloor(level: FloorGeometryLevel, mode?: "stacked" | "isolate"): THREE.Box3 | undefined;
  /** Restore exact imported visibility/material state and return the whole model. */
  showAll(): THREE.Box3 | undefined;
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

function contextMaterialFor(
  record: MeshRecord,
  requestedOpacity: number,
): THREE.Material | THREE.Material[] {
  const opacityKey = Math.round(requestedOpacity * 100) / 100;
  record.contextMaterials ??= new Map();
  const cached = record.contextMaterials.get(opacityKey);
  if (cached) return cached;
  const makeContext = (material: THREE.Material) => {
    const clone = material.clone();
    clone.opacity = Math.min(clone.opacity, opacityKey);
    clone.transparent = true;
    clone.depthWrite = false;
    clone.needsUpdate = true;
    return clone;
  };
  const contextMaterial = Array.isArray(record.originalMaterial)
    ? record.originalMaterial.map(makeContext)
    : makeContext(record.originalMaterial);
  record.contextMaterials.set(opacityKey, contextMaterial);
  return contextMaterial;
}

function emptyBounds() {
  return new THREE.Box3();
}

function addBounds(bounds: THREE.Box3, box: THREE.Box3) {
  if (box.isEmpty()) return;
  bounds.union(box);
}

/**
 * Non-destructively isolates the imported model's existing mesh objects.
 * Explicit Floor/Level group labels win; otherwise a mesh is assigned by its
 * world-space vertical centre. Objects spanning multiple storeys remain as
 * translucent context, never cut by clipping planes.
 */
export function createFloorVisibilityController(
  root: THREE.Object3D,
): FloorVisibilityController {
  root.updateMatrixWorld(true);
  const records: MeshRecord[] = [];
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(node);
    if (box.isEmpty()) return;
    records.push({
      mesh: node,
      box,
      originalVisible: node.visible,
      originalMaterial: node.material,
      floor: floorFromHierarchy(node),
    });
  });

  const hasFloor = (level: FloorGeometryLevel) => {
    const bottom = level.elevationM;
    const top = level.topElevationM;
    const selectedHeight = Math.max(top - bottom, 0.1);
    return records.some((record) => {
      if (!record.originalVisible) return false;
      if (record.floor !== null) return record.floor === level.floor;
      const height = record.box.max.y - record.box.min.y;
      if (height > selectedHeight * 1.5) return false;
      const centerY = (record.box.min.y + record.box.max.y) / 2;
      return centerY >= bottom - 0.02 && centerY <= top + 0.02;
    });
  };

  const showAll = () => {
    const bounds = emptyBounds();
    for (const record of records) {
      record.mesh.visible = record.originalVisible;
      record.mesh.material = record.originalMaterial;
      if (record.originalVisible) addBounds(bounds, record.box);
    }
    return bounds.isEmpty() ? undefined : bounds;
  };

  return {
    hasFloor,
    showFloor(level, mode = "isolate") {
      const bounds = emptyBounds();
      const bottom = level.elevationM;
      const top = level.topElevationM;
      const selectedHeight = Math.max(top - bottom, 0.1);
      const stacked = mode === "stacked";
      const selectedContextOpacity = 0.46;
      const sharedContextOpacity = 0.16;

      for (const record of records) {
        const height = record.box.max.y - record.box.min.y;
        const centerY = (record.box.min.y + record.box.max.y) / 2;

        // A floor-labelled source group is authoritative for floor membership.
        if (record.floor !== null) {
          const belongsToSelected = record.floor === level.floor;
          const belongsBelowSelected = stacked && record.floor < level.floor;
          record.mesh.visible = record.originalVisible &&
            (belongsToSelected || belongsBelowSelected);
          if (belongsToSelected) {
            record.mesh.material = record.originalMaterial;
            if (record.mesh.visible) addBounds(bounds, record.box);
          } else if (record.mesh.visible && belongsBelowSelected) {
            record.mesh.material = contextMaterialFor(record, selectedContextOpacity);
            addBounds(bounds, record.box);
          } else {
            record.mesh.material = record.originalMaterial;
          }
          continue;
        }

        // Objects spanning multiple storeys (lift core, columns, facade shell)
        // cannot be split without cutting. Keep them whole as a subtle context.
        if (height > selectedHeight * 1.5) {
          record.mesh.visible = record.originalVisible;
          record.mesh.material = contextMaterialFor(record, sharedContextOpacity);
          continue;
        }

        const belongsToSelected = centerY >= bottom - 0.02 && centerY <= top + 0.02;
        const belongsBelowSelected = stacked && centerY < bottom - 0.02;
        const belongsInVisibleStack =
          stacked && centerY <= top + 0.02 && (belongsToSelected || belongsBelowSelected);

        if (belongsToSelected) {
          record.mesh.visible = record.originalVisible;
          record.mesh.material = record.originalMaterial;
          if (record.mesh.visible) addBounds(bounds, record.box);
        } else if (belongsInVisibleStack && belongsBelowSelected) {
          record.mesh.visible = record.originalVisible;
          record.mesh.material = contextMaterialFor(record, selectedContextOpacity);
          if (record.mesh.visible) addBounds(bounds, record.box);
        } else {
          record.mesh.visible = false;
          record.mesh.material = record.originalMaterial;
        }
      }
      return bounds.isEmpty() ? undefined : bounds;
    },
    showAll,
    dispose() {
      showAll();
      for (const record of records) {
        for (const cached of record.contextMaterials?.values() ?? []) {
          const materials = Array.isArray(cached) ? cached : [cached];
          for (const material of materials) material.dispose();
        }
        record.contextMaterials?.clear();
        record.contextMaterials = undefined;
      }
    },
  };
}
