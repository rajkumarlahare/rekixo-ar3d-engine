import type { Project } from "./domain";
import type { AutoBuildExecutionReport } from "./autoBuildReport";
import type { SceneGeometryIntegrityReport } from "./sceneGeometryIntegrity";

export type ActionableReviewSeverity = "review" | "blocker";
export type ActionableReviewCategory =
  | "certification"
  | "geometry"
  | "room"
  | "wall"
  | "opening"
  | "site"
  | "floor";

export interface ActionableReviewItem {
  id: string;
  severity: ActionableReviewSeverity;
  category: ActionableReviewCategory;
  title: string;
  detail: string;
  action: string;
  entityType?: "floor" | "room" | "wall" | "opening" | "site";
  entityId?: string;
  floorId?: string;
}

export interface ActionableReviewQueue {
  items: ActionableReviewItem[];
  blockers: ActionableReviewItem[];
  review: ActionableReviewItem[];
  total: number;
  truncated: number;
}

const MAX_QUEUE_ITEMS = 500;

function uniqueQueue(values: readonly ActionableReviewItem[]) {
  return [...new Map(values.map((row) => [row.id, row])).values()];
}

function certificationAction(key: string) {
  if (key.includes("dwg")) return "Process the DWG source and resolve units/geometry before publication.";
  if (key.includes("web-model")) return "Prepare a self-contained GLB publication model.";
  if (key.includes("source")) return "Open Sources and resolve the missing or invalid source evidence.";
  if (key.includes("pdf")) return "Open source alignment and review the PDF/CAD registration.";
  if (key.includes("wall") || key.includes("room") || key.includes("opening"))
    return "Open the visual editor and correct the highlighted architectural evidence.";
  return "Open Review and resolve this certification item before treating it as verified.";
}

/**
 * Converts machine findings into operator work. Review items never become human
 * verified automatically; blockers are suitable for fail-closed publish gates.
 */
export function buildActionableReviewQueue(
  project: Project,
  certification?: AutoBuildExecutionReport,
  geometry?: SceneGeometryIntegrityReport,
): ActionableReviewQueue {
  const values: ActionableReviewItem[] = [];

  for (const row of certification?.checks ?? []) {
    if (row.status !== "blocked" && row.status !== "needs-review") continue;
    values.push({
      id: `certification:${row.key}`,
      severity: row.status === "blocked" ? "blocker" : "review",
      category: "certification",
      title: row.label,
      detail: row.detail,
      action: certificationAction(row.key),
    });
  }

  for (const row of geometry?.issues ?? [])
    values.push({
      id: `geometry:${row.id}`,
      severity: row.severity,
      category: "geometry",
      title: row.title,
      detail: row.detail,
      action: row.action,
      entityType:
        row.entityType === "project" ? undefined : row.entityType,
      entityId: row.entityId,
      floorId: row.floorId,
    });

  for (const room of project.scene.rooms) {
    if (room.verified) continue;
    values.push({
      id: `room:${room.id}`,
      severity: "review",
      category: "room",
      title: `Review room: ${room.name}`,
      detail: "This room is still a draft and has not been human-reviewed.",
      action: "Open the room in the visual editor, correct its boundary/dimensions, then mark it reviewed.",
      entityType: "room",
      entityId: room.id,
      floorId: room.floorId,
    });
  }

  for (const wall of project.scene.walls ?? []) {
    if (wall.reviewed) continue;
    values.push({
      id: `wall:${wall.id}`,
      severity: "review",
      category: "wall",
      title: "Review wall",
      detail: `Wall ${wall.id} is ${wall.reviewState ?? "suggested"} and has not been human-reviewed.`,
      action: "Inspect its position/thickness in the visual editor and accept or correct it.",
      entityType: "wall",
      entityId: wall.id,
      floorId: wall.floorId,
    });
  }

  for (const opening of project.scene.openings ?? []) {
    if (opening.reviewed) continue;
    values.push({
      id: `opening:${opening.id}`,
      severity: "review",
      category: "opening",
      title: `Review ${opening.kind}`,
      detail: `${opening.kind} ${opening.id} has not been human-reviewed.`,
      action: "Confirm the host wall, room connection and size before accepting the opening.",
      entityType: "opening",
      entityId: opening.id,
      floorId: opening.floorId,
    });
  }

  for (const site of project.scene.siteElements ?? []) {
    if (site.reviewed) continue;
    values.push({
      id: `site:${site.id}`,
      severity: "review",
      category: "site",
      title: `Review ${site.kind}`,
      detail: `${site.kind} ${site.id} is source-derived/manual draft evidence and is not reviewed.`,
      action: "Inspect the site/structural envelope and accept, correct or remove it.",
      entityType: "site",
      entityId: site.id,
      floorId: site.floorId,
    });
  }

  for (const floor of project.scene.floors) {
    if (!floor.repeatOfFloorId || floor.repeatReviewed === true) continue;
    values.push({
      id: `floor-repeat:${floor.id}`,
      severity: "review",
      category: "floor",
      title: `Review repeated floor: ${floor.name}`,
      detail: `The repeated-floor relationship is ${floor.repeatReviewState ?? "suggested"}.`,
      action: "Confirm the source-floor relationship before rolling repeated geometry out as reviewed.",
      entityType: "floor",
      entityId: floor.id,
      floorId: floor.id,
    });
  }

  const ordered = uniqueQueue(values).sort((left, right) => {
    if (left.severity !== right.severity)
      return left.severity === "blocker" ? -1 : 1;
    return `${left.category}:${left.title}:${left.id}`.localeCompare(
      `${right.category}:${right.title}:${right.id}`,
    );
  });
  const truncated = Math.max(0, ordered.length - MAX_QUEUE_ITEMS);
  const items = ordered.slice(0, MAX_QUEUE_ITEMS);
  if (truncated)
    items.push({
      id: "queue:overflow",
      severity: "review",
      category: "certification",
      title: `${truncated} additional review items hidden`,
      detail: "The operator queue is capped to keep the Studio responsive.",
      action: "Resolve visible items and rerun AutoBuild/review to refresh the queue.",
    });

  return {
    items,
    blockers: items.filter((row) => row.severity === "blocker"),
    review: items.filter((row) => row.severity === "review"),
    total: ordered.length,
    truncated,
  };
}
