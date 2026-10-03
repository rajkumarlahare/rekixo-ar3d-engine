import * as T from "three";
import type { Furniture, Opening } from "./domain";
import { addFurnitureVisual } from "./furnitureVisual";

export function renderRoomFurniture(
  roomRoot: T.Group,
  selectionRoot: T.Group,
  roomId: string,
  furniture: readonly Furniture[],
  selected: string,
  selectables: Map<string, T.Object3D>,
) {
  for (const item of furniture) {
    if (item.roomId !== roomId) continue;
    const root = new T.Group();
    root.userData.selectId = item.id;
    root.position.set(item.x, 0, item.z);
    root.rotation.y = T.MathUtils.degToRad(item.rotation);
    roomRoot.add(root);
    selectables.set(item.id, root);
    addFurnitureVisual(root, item);
    if (item.id === selected) {
      root.updateWorldMatrix(true, true);
      selectionRoot.add(new T.BoxHelper(root, 0xd67e34));
    }
  }
}

export function renderReviewedOpeningMarkers(
  root: T.Group,
  openings: readonly Opening[],
  options: {
    view: "building" | "rooms" | "walk";
    roomId: string;
    isolateFloorId?: string;
    soloRoomId?: string;
    roomMapEnabled?: boolean;
  },
) {
  for (const opening of openings) {
    if (!opening.reviewed) continue;
    if (
      options.isolateFloorId &&
      opening.floorId !== options.isolateFloorId
    )
      continue;
    if (
      options.view === "rooms" &&
      options.soloRoomId &&
      !opening.roomIds.includes(options.soloRoomId)
    )
      continue;
    if (
      options.view === "walk" &&
      !opening.roomIds.includes(options.roomId)
    )
      continue;

    const material = new T.MeshStandardMaterial({
      color: opening.kind === "door" ? 0xd0a45d : 0x72b9d6,
      transparent: true,
      opacity:
        options.roomMapEnabled && options.view === "building" ? 0.78 : 0.58,
      depthWrite: false,
      roughness: 0.45,
      metalness: opening.kind === "window" ? 0.08 : 0,
    });
    const marker = new T.Mesh(
      new T.BoxGeometry(
        Math.max(0.08, opening.width),
        Math.max(0.08, opening.height),
        0.09,
      ),
      material,
    );
    marker.name = "Opening · " + opening.kind;
    marker.position.set(opening.x, opening.y, opening.z);
    marker.rotation.y = T.MathUtils.degToRad(opening.rotationY);
    marker.renderOrder = 24;
    marker.userData.openingId = opening.id;
    root.add(marker);
  }
}
