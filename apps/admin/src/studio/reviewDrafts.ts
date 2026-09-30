import type { Room, Scene } from "./domain";

function normalizeUnit(value: string) {
  return value.trim().toLowerCase().replace(/^unit\s+/, "");
}

function baseRoomName(value: string) {
  return value
    .toLowerCase()
    .replace(/\s*·\s*layout draft\s*$/i, "")
    .trim();
}

function dependencyFree(scene: Scene, room: Room) {
  if (scene.furniture.some((item) => item.roomId === room.id)) return false;
  if ((scene.openings ?? []).some((opening) => opening.roomIds.includes(room.id)))
    return false;
  return true;
}

function hasReviewedReplacement(scene: Scene, room: Room) {
  const floor = scene.floors.find((candidate) => candidate.id === room.floorId);
  if (!floor || floor.elevation > 0.01) return false;

  const unit = normalizeUnit(room.unit);
  const name = baseRoomName(room.name);
  return scene.rooms.some((candidate) => {
    if (!candidate.verified || candidate.id === room.id) return false;
    const candidateFloor = scene.floors.find(
      (entry) => entry.id === candidate.floorId,
    );
    if (!candidateFloor || candidateFloor.elevation <= floor.elevation + 0.01)
      return false;
    if (normalizeUnit(candidate.unit) !== unit) return false;
    if (baseRoomName(candidate.name) !== name) return false;
    return (
      Math.abs(candidate.width - room.width) <= 0.05 &&
      Math.abs(candidate.depth - room.depth) <= 0.05
    );
  });
}

export function isRemovableUnsourcedDraft(scene: Scene, room: Room) {
  if (room.verified || !dependencyFree(scene, room)) return false;
  if (
    room.sourceAssetId ||
    room.sourcePackSourceId ||
    room.sourceClaimIds?.length
  )
    return false;

  const source = room.source.trim().toLowerCase();
  const supersededBrochureDraft =
    room.name.toLowerCase().includes("layout draft") &&
    source.includes("brochure page 2 living dimensions") &&
    source.includes("placement is a draft") &&
    hasReviewedReplacement(scene, room);
  if (supersededBrochureDraft) return true;

  if (room.mesh) return false;

  const draftOnly =
    !source ||
    source.startsWith("visual room mapper draft") ||
    source.startsWith("visual room mapper polygon draft") ||
    source.includes("layout draft");

  return draftOnly;
}
