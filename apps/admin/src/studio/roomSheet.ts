import type { Asset, Room, Scene } from "./domain";

export interface RoomSheetTemplateRow {
  key: string;
  floor?: string;
  unit: string;
  name: string;
  width: number;
  depth: number;
  height?: number;
  sourceNote?: string;
}

export interface RoomSheetRow {
  key: string;
  assetId?: string;
  assetName: string;
  rowNumber: number;
  floorLabel: string;
  unit: string;
  name: string;
  width: number;
  depth: number;
  height?: number;
  sourceNote: string;
  origin: "csv" | "profile";
}

export interface RoomSheetParseResult {
  rows: RoomSheetRow[];
  issues: string[];
  sourceCount: number;
}

const ROOM_SHEET_MARKER = "[room-sheet:";

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function detectDelimiter(line: string) {
  const candidates = [",", "\t", ";"];
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: line.split(delimiter).length - 1,
    }))
    .sort((left, right) => right.count - left.count)[0]?.delimiter ?? ",";
}

function parseDelimited(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const delimiter = detectDelimiter(normalized.split("\n")[0] ?? "");
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === delimiter) {
      row.push(current.trim());
      current = "";
      continue;
    }
    if (!quoted && character === "\n") {
      row.push(current.trim());
      current = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    current += character;
  }
  row.push(current.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function columnIndex(headers: string[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  return aliases
    .map(normalizeHeader)
    .map((alias) => normalized.indexOf(alias))
    .find((index) => index >= 0) ?? -1;
}

function readNumber(value: string) {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

function feetAndInches(value: string) {
  const source = value.trim().toLowerCase();
  const explicit = source.match(
    /^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|inch|inches|"))?/,
  );
  if (!explicit) return undefined;
  const feet = Number(explicit[1]);
  const inches = Number(explicit[2] ?? 0);
  if (!Number.isFinite(feet) || !Number.isFinite(inches)) return undefined;
  return feet * 0.3048 + inches * 0.0254;
}

function measurement(value: string, header: string, unitHint: string) {
  const source = value.trim().toLowerCase();
  if (!source) return Number.NaN;
  const imperial = feetAndInches(source);
  if (imperial !== undefined) return imperial;

  const parsed = readNumber(source);
  if (!Number.isFinite(parsed)) return Number.NaN;
  const headerKey = normalizeHeader(header);
  const hint = unitHint.trim().toLowerCase();

  if (/mm\b/.test(source) || headerKey.endsWith("mm") || /^mm$/.test(hint))
    return parsed / 1000;
  if (/cm\b/.test(source) || headerKey.endsWith("cm") || /^cm$/.test(hint))
    return parsed / 100;
  if (
    /(?:ft|feet|foot)\b/.test(source) ||
    headerKey.endsWith("ft") ||
    /^(?:ft|feet|foot)$/.test(hint)
  )
    return parsed * 0.3048;
  return parsed;
}

function dimensionPair(
  value: string,
  header: string,
  unitHint: string,
): [number, number] | undefined {
  const parts = value.split(/\s*[x×*]\s*/i);
  if (parts.length !== 2) return undefined;
  const width = measurement(parts[0], header, unitHint);
  const depth = measurement(parts[1], header, unitHint);
  return Number.isFinite(width) && Number.isFinite(depth)
    ? [width, depth]
    : undefined;
}

function cleanDimension(value: number) {
  return Number(value.toFixed(3));
}

function validDimension(value: number) {
  return Number.isFinite(value) && value >= 0.5 && value <= 200;
}

function stableRowKey(
  assetId: string,
  rowNumber: number,
  floorLabel: string,
  unit: string,
  name: string,
  width: number,
  depth: number,
) {
  const identity = [floorLabel, unit, name, width.toFixed(3), depth.toFixed(3)]
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|.-]+/g, "-")
    .slice(0, 180);
  return `${assetId}:${rowNumber}:${identity}`;
}

export async function parseRoomSheetAsset(
  asset: Asset,
): Promise<RoomSheetParseResult> {
  if (!/\.(csv|tsv)$/i.test(asset.name))
    return { rows: [], issues: [], sourceCount: 0 };

  const table = parseDelimited(await asset.blob.text());
  if (table.length < 2)
    return {
      rows: [],
      issues: [`${asset.name}: header + at least one room row is required.`],
      sourceCount: 1,
    };

  const headers = table[0];
  const floorColumn = columnIndex(headers, ["floor", "floor name", "level"]);
  const unitColumn = columnIndex(headers, [
    "unit",
    "unit no",
    "flat",
    "flat no",
    "apartment",
  ]);
  const nameColumn = columnIndex(headers, [
    "room",
    "room name",
    "space",
    "space name",
    "name",
  ]);
  const widthColumn = columnIndex(headers, [
    "width",
    "width m",
    "room width",
    "breadth",
  ]);
  const depthColumn = columnIndex(headers, [
    "depth",
    "depth m",
    "length",
    "length m",
    "room depth",
  ]);
  const heightColumn = columnIndex(headers, [
    "height",
    "height m",
    "ceiling height",
  ]);
  const sizeColumn = columnIndex(headers, [
    "size",
    "dimensions",
    "room size",
    "measurement",
  ]);
  const unitsColumn = columnIndex(headers, [
    "unit system",
    "units",
    "measurement unit",
  ]);
  const sourceColumn = columnIndex(headers, [
    "source",
    "source note",
    "notes",
    "note",
  ]);

  if (unitColumn < 0 || nameColumn < 0 || (sizeColumn < 0 && (widthColumn < 0 || depthColumn < 0)))
    return {
      rows: [],
      issues: [
        `${asset.name}: need Unit/Flat, Room, and either Width + Depth or Size columns.`,
      ],
      sourceCount: 1,
    };

  const rows: RoomSheetRow[] = [];
  const issues: string[] = [];

  for (let index = 1; index < table.length; index += 1) {
    const values = table[index];
    const unit = (values[unitColumn] ?? "").trim();
    const name = (values[nameColumn] ?? "").trim();
    const floorLabel =
      floorColumn >= 0 ? (values[floorColumn] ?? "").trim() : "";
    const unitHint =
      unitsColumn >= 0 ? (values[unitsColumn] ?? "").trim() : "";
    if (!unit && !name) continue;
    if (!unit || !name) {
      issues.push(`${asset.name} row ${index + 1}: Unit and Room are required.`);
      continue;
    }

    let width = Number.NaN;
    let depth = Number.NaN;
    if (sizeColumn >= 0) {
      const pair = dimensionPair(
        values[sizeColumn] ?? "",
        headers[sizeColumn] ?? "size",
        unitHint,
      );
      if (pair) [width, depth] = pair;
    }
    if (!Number.isFinite(width) || !Number.isFinite(depth)) {
      width = measurement(
        values[widthColumn] ?? "",
        headers[widthColumn] ?? "width",
        unitHint,
      );
      depth = measurement(
        values[depthColumn] ?? "",
        headers[depthColumn] ?? "depth",
        unitHint,
      );
    }
    const height =
      heightColumn >= 0
        ? measurement(
            values[heightColumn] ?? "",
            headers[heightColumn] ?? "height",
            unitHint,
          )
        : undefined;

    if (!validDimension(width) || !validDimension(depth)) {
      issues.push(
        `${asset.name} row ${index + 1}: width/depth must resolve to 0.5–200 metres.`,
      );
      continue;
    }
    if (
      height !== undefined &&
      Number.isFinite(height) &&
      (height < 1.8 || height > 20)
    ) {
      issues.push(
        `${asset.name} row ${index + 1}: height must resolve to 1.8–20 metres.`,
      );
      continue;
    }

    const cleanWidth = cleanDimension(width);
    const cleanDepth = cleanDimension(depth);
    rows.push({
      key: stableRowKey(
        asset.id,
        index + 1,
        floorLabel,
        unit,
        name,
        cleanWidth,
        cleanDepth,
      ),
      assetId: asset.id,
      assetName: asset.name,
      rowNumber: index + 1,
      floorLabel,
      unit,
      name,
      width: cleanWidth,
      depth: cleanDepth,
      ...(height !== undefined && Number.isFinite(height)
        ? { height: cleanDimension(height) }
        : {}),
      sourceNote:
        sourceColumn >= 0
          ? (values[sourceColumn] ?? "").trim()
          : "Imported room-sheet measurement",
      origin: "csv",
    });
  }

  return { rows, issues, sourceCount: 1 };
}

export async function parseRoomSheetAssets(
  assets: Asset[],
): Promise<RoomSheetParseResult> {
  const sources = assets.filter((asset) => /\.(csv|tsv)$/i.test(asset.name));
  const parsed = await Promise.all(sources.map(parseRoomSheetAsset));
  return {
    rows: parsed.flatMap((result) => result.rows),
    issues: parsed.flatMap((result) => result.issues),
    sourceCount: sources.length,
  };
}

export function profileRoomSheetRows(
  rows: readonly RoomSheetTemplateRow[],
  profileId: string,
  sourceAsset?: Asset,
): RoomSheetRow[] {
  return rows
    .filter(
      (row) =>
        row.unit.trim() &&
        row.name.trim() &&
        validDimension(row.width) &&
        validDimension(row.depth),
    )
    .map((row, index) => ({
      key: `profile:${profileId}:${row.key}`,
      assetId: sourceAsset?.id,
      assetName: sourceAsset?.name ?? `${profileId} project profile`,
      rowNumber: index + 1,
      floorLabel: row.floor?.trim() ?? "",
      unit: row.unit.trim(),
      name: row.name.trim(),
      width: cleanDimension(row.width),
      depth: cleanDimension(row.depth),
      ...(row.height !== undefined && Number.isFinite(row.height)
        ? { height: cleanDimension(row.height) }
        : {}),
      sourceNote:
        row.sourceNote?.trim() ||
        "Project-profile room measurement; review against the attached source.",
      origin: "profile" as const,
    }));
}

export function roomSheetMarker(row: RoomSheetRow) {
  return `${ROOM_SHEET_MARKER}${row.key}] ${row.sourceNote}`.slice(0, 2000);
}

export function roomSheetKeyFromRoom(room: Room) {
  if (!room.source.startsWith(ROOM_SHEET_MARKER)) return undefined;
  const end = room.source.indexOf("]");
  if (end < ROOM_SHEET_MARKER.length) return undefined;
  return room.source.slice(ROOM_SHEET_MARKER.length, end);
}

export function mappedRoomSheetKeys(rooms: Room[]) {
  return new Set(
    rooms
      .map(roomSheetKeyFromRoom)
      .filter((key): key is string => Boolean(key)),
  );
}

function normalizeFloor(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(first|1st)\b/g, "1")
    .replace(/\b(second|2nd)\b/g, "2")
    .replace(/\b(third|3rd)\b/g, "3")
    .replace(/\b(fourth|4th)\b/g, "4")
    .replace(/\b(fifth|5th)\b/g, "5")
    .replace(/\bground\b/g, "0")
    .replace(/[^a-z0-9]+/g, "");
}

export function resolveRoomSheetFloorId(
  row: RoomSheetRow,
  scene: Scene,
  fallbackFloorId: string,
) {
  const label = normalizeFloor(row.floorLabel);
  if (!label || /typical|residential/.test(label)) return fallbackFloorId;
  const exact = scene.floors.find(
    (floor) => normalizeFloor(floor.name) === label,
  );
  if (exact) return exact.id;
  const number = label.match(/\d+/)?.[0];
  if (number) {
    const byNumber = scene.floors.find((floor) =>
      normalizeFloor(floor.name).includes(number),
    );
    if (byNumber) return byNumber.id;
  }
  return fallbackFloorId;
}
