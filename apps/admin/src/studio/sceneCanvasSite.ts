import * as T from "three";
import type { SiteElement } from "./domain";
import { disposeObjectResources } from "./threeResources";
import { addSiteElementVisual } from "./siteElementVisual";

export type SiteElementTransformMode = "translate" | "rotate" | "scale";

export interface SiteElementTransformChange {
  kind: "siteElement";
  id: string;
  x?: number;
  z?: number;
  rotation?: number;
  width?: number;
  depth?: number;
  height?: number;
}

export function siteElementTransformChange(
  item: SiteElement,
  target: T.Object3D,
  mode: SiteElementTransformMode,
): SiteElementTransformChange {
  if (mode === "translate")
    return {
      kind: "siteElement",
      id: item.id,
      x: target.position.x,
      z: target.position.z,
    };
  if (mode === "rotate")
    return {
      kind: "siteElement",
      id: item.id,
      rotation: T.MathUtils.radToDeg(target.rotation.y),
    };
  return {
    kind: "siteElement",
    id: item.id,
    width: Math.max(0.05, item.width * Math.abs(target.scale.x)),
    height: Math.max(0.01, item.height * Math.abs(target.scale.y)),
    depth: Math.max(0.05, item.depth * Math.abs(target.scale.z)),
  };
}

export function renderSiteElements(
  group: T.Group,
  elements: readonly SiteElement[],
  selected: string,
  selectables: Map<string, T.Object3D>,
) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObjectResources(child);
  }

  for (const element of elements) {
    const root = new T.Group();
    root.userData.selectId = element.id;
    root.position.set(element.x, 0, element.z);
    root.rotation.y = T.MathUtils.degToRad(element.rotation);
    addSiteElementVisual(root, element);
    group.add(root);
    selectables.set(element.id, root);
    if (element.id === selected) {
      root.updateWorldMatrix(true, true);
      group.add(new T.BoxHelper(root, 0x4f9c6c));
    }
  }
}
