import type { Project, Room } from "./domain";
import type { RoomSheetRow } from "./roomSheet";

export interface RoomSheetFusionSummary {
  rowCount: number;
  matched: number;
  applied: number;
  verifiedMatches: number;
  conflicts: number;
  ambiguous: number;
  unmatched: number;
  polygonReview: number;
}

export interface RoomSheetFusionResult {
  project: Project;
  summary: RoomSheetFusionSummary;
  issues: string[];
}

function identity(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function floorIdentity(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\bground\b/g, "0")
    .replace(/\b(first|1st)\b/g, "1")
    .replace(/\b(second|2nd)\b/g, "2")
    .replace(/\b(third|3rd)\b/g, "3")
    .replace(/\b(fourth|4th)\b/g, "4")
    .replace(/\b(fifth|5th)\b/g, "5")
    .replace(/\b(sixth|6th)\b/g, "6")
    .replace(/\b(seventh|7th)\b/g, "7")
    .replace(/\b(eighth|8th)\b/g, "8")
    .replace(/\b(ninth|9th)\b/g, "9")
    .replace(/\b(tenth|10th)\b/g, "10")
    .replace(/[^a-z0-9]+/g, "");
}

function genericFloorLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  return !normalized || /\b(?:typical|residential|all floors?)\b/.test(normalized);
}

function sameFloor(row: RoomSheetRow, room: Room, project: Project) {
  if (genericFloorLabel(row.floorLabel)) return true;
  const floor = project.scene.floors.find((entry) => entry.id === room.floorId);
  if (!floor) return false;
  const expected = floorIdentity(row.floorLabel);
  const actual = floorIdentity(floor.name);
  if (expected === actual) return true;
  const expectedNumber = expected.match(/\d+/)?.[0];
  const actualNumber = actual.match(/\d+/)?.[0];
  return Boolean(
    expectedNumber && actualNumber && expectedNumber === actualNumber,
  );
}

function tolerance(expected: number) {
  return Math.min(0.15, Math.max(0.05, Math.abs(expected) * 0.02));
}

function close(actual: number, expected: number) {
  return Math.abs(actual - expected) <= tolerance(expected);
}

function heightClose(actual: number, expected: number) {
  return Math.abs(actual - expected) <= Math.max(0.08, expected * 0.025);
}

function sourceMarker(row: RoomSheetRow, prior: string) {
  const note = row.sourceNote.trim() || "Imported room-sheet measurement";
  const previous = prior.trim() ? ` · prior: ${prior.trim()}` : "";
  return `[room-sheet:${row.key}] ${note}${previous}`.slice(0, 2000);
}

function candidateRooms(project: Project, row: RoomSheetRow) {
  const unit = identity(row.unit);
  const name = identity(row.name);
  return project.scene.rooms.filter(
    (room) =>
      identity(room.unit) === unit &&
      identity(room.name) === name &&
      sameFloor(row, room, project),
  );
}

function dimensionTarget(room: Room, row: RoomSheetRow) {
  const direct =
    close(room.width, row.width) && close(room.depth, row.depth);
  const swapped =
    close(room.width, row.depth) && close(room.depth, row.width);
  if (!direct && !swapped) return undefined;
  const directError =
    Math.abs(room.width - row.width) + Math.abs(room.depth - row.depth);
  const swappedError =
    Math.abs(room.width - row.depth) + Math.abs(room.depth - row.width);
  return direct || directError <= swappedError
    ? { width: row.width, depth: row.depth }
    : { width: row.depth, depth: row.width };
}

/**
 * Conservatively reconciles optional CSV/TSV room measurements with an already
 * reconstructed scene. CSV can snap a nearby unverified rectangular draft to
 * exact supplied dimensions, but it never invents room placement, rewrites a
 * reviewed room, or stretches polygon geometry.
 */
export function fuseRoomSheetEvidence(
  project: Project,
  rows: readonly RoomSheetRow[],
): RoomSheetFusionResult {
  const csvRows = rows.filter((row) => row.origin === "csv");
  const summary: RoomSheetFusionSummary = {
    rowCount: csvRows.length,
    matched: 0,
    applied: 0,
    verifiedMatches: 0,
    conflicts: 0,
    ambiguous: 0,
    unmatched: 0,
    polygonReview: 0,
  };
  if (!csvRows.length)
    return { project, summary, issues: [] };

  const issues: string[] = [];
  const replacements = new Map<string, Room>();

  for (const row of csvRows) {
    const matches = candidateRooms(project, row);
    if (!matches.length) {
      summary.unmatched += 1;
      issues.push(
        `CSV row ${row.rowNumber} (${row.unit} · ${row.name}) has no unambiguous reconstructed room; placement stays review-only.`,
      );
      continue;
    }
    if (matches.length > 1) {
      summary.ambiguous += 1;
      issues.push(
        `CSV row ${row.rowNumber} (${row.unit} · ${row.name}) matches multiple reconstructed rooms; Rekixo will not choose one automatically.`,
      );
      continue;
    }

    const room = replacements.get(matches[0].id) ?? matches[0];
    summary.matched += 1;
    const target = dimensionTarget(room, row);
    const heightCompatible =
      row.height === undefined || heightClose(room.height, row.height);

    if (!target || !heightCompatible) {
      summary.conflicts += 1;
      issues.push(
        `CSV row ${row.rowNumber} conflicts with reconstructed ${room.unit} · ${room.name} dimensions; source values were kept for review instead of reshaping geometry automatically.`,
      );
      continue;
    }

    if (room.verified) {
      summary.verifiedMatches += 1;
      continue;
    }

    if (room.polygon?.length) {
      summary.polygonReview += 1;
      issues.push(
        `CSV row ${row.rowNumber} matches polygon room ${room.unit} · ${room.name}; dimensions agree, but polygon geometry requires visual review before reshaping.`,
      );
      continue;
    }

    const next: Room = {
      ...room,
      width: Number(target.width.toFixed(3)),
      depth: Number(target.depth.toFixed(3)),
      ...(row.height !== undefined
        ? { height: Number(row.height.toFixed(3)) }
        : {}),
      source: sourceMarker(row, room.source),
      ...(room.sourceAssetId
        ? { sourceAssetId: room.sourceAssetId }
        : row.assetId
          ? { sourceAssetId: row.assetId }
          : {}),
      ...(room.sourcePackSourceId
        ? { sourcePackSourceId: room.sourcePackSourceId }
        : row.sourcePackSourceId
          ? { sourcePackSourceId: row.sourcePackSourceId }
          : {}),
      verified: false,
    };
    replacements.set(room.id, next);
    summary.applied += 1;
  }

  if (!replacements.size)
    return { project, summary, issues };

  return {
    project: {
      ...project,
      scene: {
        ...project.scene,
        rooms: project.scene.rooms.map(
          (room) => replacements.get(room.id) ?? room,
        ),
      },
    },
    summary,
    issues,
  };
}
