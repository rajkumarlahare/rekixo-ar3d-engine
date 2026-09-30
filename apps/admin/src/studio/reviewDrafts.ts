import type { Room, Scene } from "./domain";

export function isRemovableUnsourcedDraft(scene: Scene, room: Room) {
  if (room.verified) return false;
  if (
    room.sourceAssetId ||
    room.sourcePackSourceId ||
    room.sourceClaimIds?.length ||
    room.mesh
  )
    return false;

  const source = room.source.trim().toLowerCase();
  const draftOnly =
    !source ||
    source.startsWith("visual room mapper draft") ||
    source.startsWith("visual room mapper polygon draft") ||
    source.includes("layout draft");
  if (!draftOnly) return false;

  if (scene.furniture.some((item) => item.roomId === room.id)) return false;
  if ((scene.openings ?? []).some((opening) => opening.roomIds.includes(room.id)))
    return false;

  return true;
}
