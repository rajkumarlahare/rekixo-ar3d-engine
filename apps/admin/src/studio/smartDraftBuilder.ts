import { id, type ModelNodeTag, type Project, type Scene } from "./domain";
import type { SmartProjectAnalysis } from "./projectAnalyzer";
import { deriveModelWallGraph } from "./architectureGraph";
import { detectRepeatedFloors } from "./repeatedFloorDetector";
import { deriveAutoRoomDrafts } from "./autoRoomDraft";

export interface SmartDraftBuildResult {
  scene: Scene;
  summary: {
    floors: number;
    autoTagged: number;
    walls: number;
    repeatedFloors: number;
    autoRooms: number;
    skippedRoomFloors: number;
  };
}

export function buildSmartSceneDraft(
  project: Project,
  analysis: SmartProjectAnalysis,
): SmartDraftBuildResult {
  if (!analysis.modelAssetId)
    throw Error("Analyze a selected GLB/FBX model before building the draft.");
  if (!analysis.floorCandidates.length)
    throw Error("No reliable floor structure was detected. Review the model manually.");

  const hasAuthoredRooms = project.scene.rooms.length > 0;
  const replaceFloorSkeleton =
    !hasAuthoredRooms &&
    project.scene.floors.length === 1 &&
    !(project.scene.modelNodeTags?.length);
  const modelY = project.scene.modelTransform?.y ?? 0;
  const scale = project.scene.scale;
  const suggestedElevations = analysis.floorCandidates
    .map((candidate) => candidate.elevation * scale + modelY)
    .sort((left, right) => left - right);
  let floors = replaceFloorSkeleton
    ? suggestedElevations.map((elevation, index) => ({
        id: id(),
        name: index === 0 ? "Ground" : `Floor ${index}`,
        elevation: Number(elevation.toFixed(4)),
      }))
    : [...project.scene.floors].sort(
        (left, right) => left.elevation - right.elevation,
      );

  if (!floors.length)
    throw Error("Create or detect at least one floor before auto-tagging meshes.");

  const repeatGroups = detectRepeatedFloors(analysis);
  const repeatByTarget = new Map<
    number,
    { sourceFloorIndex: number; similarity: number }
  >();
  for (const group of repeatGroups)
    for (const member of group.members)
      repeatByTarget.set(member.floorIndex, {
        sourceFloorIndex: group.sourceFloorIndex,
        similarity: member.similarity,
      });

  floors = floors.map((floor, index) => {
    const repeat = repeatByTarget.get(index);
    if (!repeat)
      return {
        ...floor,
        repeatOfFloorId: undefined,
        repeatConfidence: undefined,
        repeatReviewed: undefined,
      };
    const sourceFloor = floors[repeat.sourceFloorIndex];
    return {
      ...floor,
      repeatOfFloorId: sourceFloor?.id,
      repeatConfidence: Number(repeat.similarity.toFixed(3)),
      repeatReviewed: false,
    };
  });

  const existingTags = project.scene.modelNodeTags ?? [];
  const byKey = new Map<string, ModelNodeTag>();
  for (const tag of existingTags) {
    const cleaned = { ...tag };
    if (cleaned.assignment === "auto") {
      delete cleaned.floorId;
      delete cleaned.assignment;
      delete cleaned.confidence;
    }
    const keep =
      Boolean(cleaned.floorId) ||
      Boolean(cleaned.unit) ||
      Boolean(cleaned.roomId) ||
      Boolean(cleaned.semantic) ||
      Boolean(cleaned.semanticAssignment) ||
      cleaned.semanticConfidence !== undefined;
    if (keep)
      byKey.set(
        `${cleaned.nodeName}\u0000${cleaned.occurrence}`,
        cleaned,
      );
  }

  let autoTagged = 0;
  for (const assignment of analysis.nodeAssignments) {
    if (
      assignment.floorIndex === undefined ||
      assignment.confidence < 0.62
    )
      continue;
    const key = `${assignment.nodeName}\u0000${assignment.occurrence}`;
    const current = byKey.get(key);
    if (current?.assignment === "manual") continue;
    const sourceFloor = analysis.floorCandidates[assignment.floorIndex];
    if (!sourceFloor) continue;
    const worldElevation = sourceFloor.elevation * scale + modelY;
    const targetFloor = [...floors].sort(
      (left, right) =>
        Math.abs(left.elevation - worldElevation) -
        Math.abs(right.elevation - worldElevation),
    )[0];
    if (!targetFloor) continue;
    byKey.set(key, {
      ...(current ?? {
        nodeName: assignment.nodeName,
        occurrence: assignment.occurrence,
      }),
      floorId: targetFloor.id,
      assignment: "auto",
      confidence: Number(assignment.confidence.toFixed(3)),
    });
    autoTagged += 1;
  }

  const generatedWalls = deriveModelWallGraph(
    analysis,
    floors,
    project.scene.scale,
    project.scene.modelTransform,
  );
  const retainedWalls = (project.scene.walls ?? []).filter(
    (wall) => wall.origin !== "model-auto" || wall.reviewed,
  );
  const retainedIds = new Set(retainedWalls.map((wall) => wall.id));
  const walls = [
    ...retainedWalls,
    ...generatedWalls.filter((wall) => !retainedIds.has(wall.id)),
  ];

  const autoRoomDraft =
    project.scene.rooms.length === 0
      ? deriveAutoRoomDrafts(walls, floors, analysis.modelAssetId)
      : { rooms: [], skippedFloors: [] as string[] };
  const rooms =
    project.scene.rooms.length > 0
      ? project.scene.rooms
      : autoRoomDraft.rooms;

  const scene: Scene = {
    ...project.scene,
    floors,
    rooms,
    walls,
    modelNodeTags: [...byKey.values()],
  };

  return {
    scene,
    summary: {
      floors: floors.length,
      autoTagged,
      walls: walls.length,
      repeatedFloors: floors.filter((floor) => floor.repeatOfFloorId).length,
      autoRooms: autoRoomDraft.rooms.length,
      skippedRoomFloors: autoRoomDraft.skippedFloors.length,
    },
  };
}
