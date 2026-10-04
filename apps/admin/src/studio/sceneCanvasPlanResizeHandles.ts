import * as T from "three";
import type { PlanResizeCorner } from "@rekixo/3d-engine-core";

const corners: readonly [PlanResizeCorner, number, number][] = [
  ["nw", -1, -1],
  ["ne", 1, -1],
  ["se", 1, 1],
  ["sw", -1, 1],
];

export function addPlanResizeHandles(
  root: T.Object3D,
  width: number,
  depth: number,
  options: { y?: number; color?: number } = {},
) {
  if (!(width > 0) || !(depth > 0)) return;
  const y = options.y ?? 0.12;
  const color = options.color ?? 0x8d84ff;

  for (const [corner, signX, signZ] of corners) {
    const handle = new T.Group();
    handle.name = `Resize ${corner.toUpperCase()}`;
    handle.position.set((signX * width) / 2, y, (signZ * depth) / 2);
    handle.userData.planResizeCorner = corner;

    const hit = new T.Mesh(
      new T.SphereGeometry(0.3, 10, 8),
      new T.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    hit.name = "Touch resize hit target";
    hit.userData.planResizeCorner = corner;

    const visible = new T.Mesh(
      new T.SphereGeometry(0.115, 16, 12),
      new T.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
      }),
    );
    visible.name = "Resize handle";
    visible.userData.planResizeCorner = corner;
    visible.renderOrder = 45;
    handle.add(hit, visible);
    root.add(handle);
  }
}
