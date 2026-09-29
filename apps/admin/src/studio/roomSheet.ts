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
  suggestedX?: number;
  suggestedZ?: number;
  sourcePackSourceId?: string;
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
  suggestedX?: number;
  suggestedZ?: number;
  sourcePackSourceId?: string;
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
      ...(typeof row.suggestedX === "number" && Number.isFinite(row.suggestedX)
        ? { suggestedX: cleanDimension(row.suggestedX) }
        : {}),
      ...(typeof row.suggestedZ === "number" && Number.isFinite(row.suggestedZ)
        ? { suggestedZ: cleanDimension(row.suggestedZ) }
        : {}),
      ...(row.sourcePackSourceId?.trim()
        ? { sourcePackSourceId: row.sourcePackSourceId.trim() }
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

export function mappedRoomSheetKeys(rooms: readonly Room[]) {
  return new Set(
    rooms
      .map(roomSheetKeyFromRoom)
      .filter((key): key is string => Boolean(key)),
  );
}

function roomIdentity(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function closeTo(value: number, expected: number, tolerance = 0.08) {
  return Math.abs(value - expected) <= tolerance;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function nearAngle(value: number, target: number) {
  const delta = Math.abs(normalizeDegrees(value) - target);
  return Math.min(delta, 360 - delta) < 0.001;
}

export function createSuggestedRoomDrafts(
  rows: readonly RoomSheetRow[],
  existingRooms: readonly Room[],
  floorId: string,
  modelTransform: { x: number; y: number; z: number; rotationY: number } = {
    x: 0,
    y: 0,
    z: 0,
    rotationY: 0,
  },
  modelScale = 1,
  makeId: () => string = () => crypto.randomUUID(),
): Room[] {
  if (!floorId) return [];
  const scale =
    Number.isFinite(modelScale) && modelScale > 0 ? modelScale : 1;
  const rotationY = Number.isFinite(modelTransform.rotationY)
    ? modelTransform.rotationY
    : 0;
  const angle = (rotationY * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const translateX = Number.isFinite(modelTransform.x) ? modelTransform.x : 0;
  const translateZ = Number.isFinite(modelTransform.z) ? modelTransform.z : 0;
  const mappedKeys = mappedRoomSheetKeys(existingRooms);
  const additions: Room[] = [];

  const worldPoint = (x: number, z: number): [number, number] => {
    const scaledX = x * scale;
    const scaledZ = z * scale;
    return [
      translateX + scaledX * cosine + scaledZ * sine,
      translateZ - scaledX * sine + scaledZ * cosine,
    ];
  };

  for (const row of rows) {
    if (
      row.origin !== "profile" ||
      typeof row.suggestedX !== "number" ||
      !Number.isFinite(row.suggestedX) ||
      typeof row.suggestedZ !== "number" ||
      !Number.isFinite(row.suggestedZ) ||
      mappedKeys.has(row.key)
    )
      continue;

    const [x, z] = worldPoint(row.suggestedX, row.suggestedZ);
    const sourceWidth = row.width * scale;
    const sourceDepth = row.depth * scale;
    const quarterTurn = nearAngle(rotationY, 90) || nearAngle(rotationY, 270);
    const axisAligned =
      nearAngle(rotationY, 0) ||
      nearAngle(rotationY, 90) ||
      nearAngle(rotationY, 180) ||
      nearAngle(rotationY, 270);
    const expectedWidth = quarterTurn ? sourceDepth : sourceWidth;
    const expectedDepth = quarterTurn ? sourceWidth : sourceDepth;
    const candidates = [...existingRooms, ...additions];
    const duplicate = candidates.some(
      (room) =>
        room.floorId === floorId &&
        roomIdentity(room.unit) === roomIdentity(row.unit) &&
        roomIdentity(room.name) === roomIdentity(row.name) &&
        closeTo(room.width, expectedWidth) &&
        closeTo(room.depth, expectedDepth),
    );
    if (duplicate) continue;

    let geometry: Pick<Room, "x" | "z" | "width" | "depth" | "polygon"> = {
      x,
      z,
      width: expectedWidth,
      depth: expectedDepth,
      polygon: undefined,
    };

    if (!axisAligned) {
      const halfWidth = row.width / 2;
      const halfDepth = row.depth / 2;
      const polygon = [
        [row.suggestedX - halfWidth, row.suggestedZ - halfDepth],
        [row.suggestedX + halfWidth, row.suggestedZ - halfDepth],
        [row.suggestedX + halfWidth, row.suggestedZ + halfDepth],
        [row.suggestedX - halfWidth, row.suggestedZ + halfDepth],
      ].map(([pointX, pointZ]) => worldPoint(pointX, pointZ));
      const minX = Math.min(...polygon.map((point) => point[0]));
      const maxX = Math.max(...polygon.map((point) => point[0]));
      const minZ = Math.min(...polygon.map((point) => point[1]));
      const maxZ = Math.max(...polygon.map((point) => point[1]));
      geometry = {
        x: (minX + maxX) / 2,
        z: (minZ + maxZ) / 2,
        width: maxX - minX,
        depth: maxZ - minZ,
        polygon,
      };
    }

    const room: Room = {
      id: makeId(),
      name: row.name,
      unit: row.unit,
      floorId,
      x: Number(geometry.x.toFixed(3)),
      z: Number(geometry.z.toFixed(3)),
      width: Number(geometry.width.toFixed(3)),
      depth: Number(geometry.depth.toFixed(3)),
      ...(geometry.polygon
        ? {
            polygon: geometry.polygon.map(
              ([pointX, pointZ]) =>
                [
                  Number(pointX.toFixed(3)),
                  Number(pointZ.toFixed(3)),
                ] as [number, number],
            ),
          }
        : {}),
      height: Number(((row.height ?? 2.8) * scale).toFixed(3)),
      color: "#cdbfa9",
      source: roomSheetMarker(row),
      verified: false,
      ...(row.assetId ? { sourceAssetId: row.assetId } : {}),
      ...(row.sourcePackSourceId
        ? { sourcePackSourceId: row.sourcePackSourceId }
        : {}),
    };
    additions.push(room);
    mappedKeys.add(row.key);
  }

  return additions;
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
