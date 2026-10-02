import type { SmartArchitecturalKind } from "./projectAnalyzer";

export type DxfPoint = [number, number];
export type DxfCadKind =
  | SmartArchitecturalKind
  | "stair"
  | "lift"
  | "column"
  | "slab";

export interface DxfSemanticSegment {
  id?: string;
  kind: DxfCadKind;
  layer: string;
  start: DxfPoint;
  end: DxfPoint;
  sourceEntity: "LINE" | "LWPOLYLINE" | "POLYLINE" | "DWG";
  confidence?: number;
  thickness?: number;
  thicknessBasis?: string;
  height?: number;
  floorLabel?: string;
}

export interface DxfTextLabel {
  layer: string;
  text: string;
  point: DxfPoint;
  floorLabel?: string;
}

export interface DxfCadAnchor {
  id?: string;
  kind: DxfCadKind;
  layer: string;
  blockName?: string;
  point: DxfPoint;
  rotationY?: number;
  scaleX?: number;
  scaleY?: number;
  confidence?: number;
  floorLabel?: string;
}

export interface DxfCadDimension {
  layer: string;
  valueMetres?: number;
  text?: string;
  point?: DxfPoint;
  floorLabel?: string;
}

export interface DxfPlanGeometry {
  ascii: boolean;
  insUnitsCode?: number;
  unitName?: string;
  metresPerUnit?: number;
  geometryReady: boolean;
  segments: DxfSemanticSegment[];
  labels: DxfTextLabel[];
  anchors?: DxfCadAnchor[];
  dimensions?: DxfCadDimension[];
  floorHints?: string[];
  bounds?: {
    min: DxfPoint;
    max: DxfPoint;
  };
  issues: string[];
}

interface Pair {
  code: number;
  value: string;
}

const UNIT: Record<number, { name: string; metres: number }> = {
  1: { name: "inch", metres: 0.0254 },
  2: { name: "foot", metres: 0.3048 },
  3: { name: "mile", metres: 1609.344 },
  4: { name: "millimetre", metres: 0.001 },
  5: { name: "centimetre", metres: 0.01 },
  6: { name: "metre", metres: 1 },
  7: { name: "kilometre", metres: 1000 },
  10: { name: "yard", metres: 0.9144 },
  14: { name: "decimetre", metres: 0.1 },
  21: { name: "US survey foot", metres: 1200 / 3937 },
};

function semanticLayerKind(layer: string): DxfCadKind | undefined {
  const normalized = layer.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\b(door|doors|gate|entry)\b/.test(normalized)) return "door";
  if (/\b(window|windows|glazing|fenestration)\b/.test(normalized))
    return "window";
  if (/\b(stair|stairs|staircase|step|steps)\b/.test(normalized))
    return "stair";
  if (/\b(lift|elevator|elevators)\b/.test(normalized)) return "lift";
  if (/\b(column|columns|pillar|pillars)\b/.test(normalized))
    return "column";
  if (/\b(slab|slabs)\b/.test(normalized)) return "slab";
  if (/\b(wall|walls|partition|masonry|brick)\b/.test(normalized))
    return "wall";
  return undefined;
}

function pairs(text: string): Pair[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const result: Pair[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index].trim(), 10);
    if (!Number.isFinite(code)) continue;
    result.push({ code, value: lines[index + 1].trim() });
  }
  return result;
}

function firstNumber(rows: readonly Pair[], code: number) {
  const row = rows.find((entry) => entry.code === code);
  if (!row) return undefined;
  const value = Number(row.value);
  return Number.isFinite(value) ? value : undefined;
}

function firstString(rows: readonly Pair[], code: number) {
  return rows.find((entry) => entry.code === code)?.value?.trim();
}

function normalizePoint(
  x: number,
  y: number,
  metresPerUnit: number,
): DxfPoint {
  return [
    Number((x * metresPerUnit).toFixed(5)),
    Number((y * metresPerUnit).toFixed(5)),
  ];
}

function entityGroups(rows: readonly Pair[]) {
  const entities: Array<{ type: string; rows: Pair[] }> = [];
  let inEntities = false;
  let current: { type: string; rows: Pair[] } | undefined;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      row.code === 0 &&
      row.value.toUpperCase() === "SECTION" &&
      rows[index + 1]?.code === 2 &&
      rows[index + 1]?.value.toUpperCase() === "ENTITIES"
    ) {
      inEntities = true;
      index += 1;
      continue;
    }
    if (!inEntities) continue;
    if (row.code === 0 && row.value.toUpperCase() === "ENDSEC") {
      if (current) entities.push(current);
      break;
    }
    if (row.code === 0) {
      if (current) entities.push(current);
      current = { type: row.value.toUpperCase(), rows: [] };
      continue;
    }
    if (current) current.rows.push(row);
  }
  return entities;
}

function lwPolylinePoints(rows: readonly Pair[]) {
  const points: DxfPoint[] = [];
  let pendingX: number | undefined;
  for (const row of rows) {
    if (row.code === 10) {
      const value = Number(row.value);
      pendingX = Number.isFinite(value) ? value : undefined;
      continue;
    }
    if (row.code === 20 && pendingX !== undefined) {
      const y = Number(row.value);
      if (Number.isFinite(y)) points.push([pendingX, y]);
      pendingX = undefined;
    }
  }
  return points;
}

function dxfUnits(rows: readonly Pair[]) {
  for (let index = 0; index + 1 < rows.length; index += 1) {
    if (rows[index].code !== 9 || rows[index].value !== "$INSUNITS") continue;
    for (let next = index + 1; next < Math.min(rows.length, index + 8); next += 1) {
      if (rows[next].code === 70) {
        const value = Number.parseInt(rows[next].value, 10);
        if (Number.isFinite(value)) return value;
      }
      if (rows[next].code === 9 || rows[next].code === 0) break;
    }
  }
  return undefined;
}

export function parseAsciiDxfArchitecture(
  text: string,
  maxSegments = 20_000,
): DxfPlanGeometry {
  const result: DxfPlanGeometry = {
    ascii: false,
    geometryReady: false,
    segments: [],
    labels: [],
    anchors: [],
    dimensions: [],
    floorHints: [],
    issues: [],
  };
  if (!/\bSECTION\b/i.test(text) || !/\bENTITIES\b/i.test(text)) {
    result.issues.push("DXF does not contain a readable ASCII ENTITIES section.");
    return result;
  }
  result.ascii = true;

  const parsedPairs = pairs(text);
  const unitCode = dxfUnits(parsedPairs);
  result.insUnitsCode = unitCode;
  const unit = unitCode !== undefined ? UNIT[unitCode] : undefined;
  if (unit) {
    result.unitName = unit.name;
    result.metresPerUnit = unit.metres;
  } else {
    result.issues.push(
      unitCode === 0
        ? "DXF INSUNITS is unitless; geometry is retained as evidence until scale is reviewed."
        : "DXF drawing units are missing/unsupported; geometry is retained as evidence until scale is reviewed.",
    );
  }

  const metresPerUnit = unit?.metres ?? 1;
  const entities = entityGroups(parsedPairs);
  let truncated = false;

  const pushSegment = (
    kind: DxfCadKind,
    layer: string,
    start: DxfPoint,
    end: DxfPoint,
    sourceEntity: DxfSemanticSegment["sourceEntity"],
  ) => {
    if (result.segments.length >= maxSegments) {
      truncated = true;
      return;
    }
    const a = normalizePoint(start[0], start[1], metresPerUnit);
    const b = normalizePoint(end[0], end[1], metresPerUnit);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) return;
    result.segments.push({ kind, layer, start: a, end: b, sourceEntity });
  };

  for (const entity of entities) {
    const layer = firstString(entity.rows, 8) ?? "0";
    const kind = semanticLayerKind(layer);

    if (entity.type === "LINE" && kind) {
      const x1 = firstNumber(entity.rows, 10);
      const y1 = firstNumber(entity.rows, 20);
      const x2 = firstNumber(entity.rows, 11);
      const y2 = firstNumber(entity.rows, 21);
      if ([x1, y1, x2, y2].every((value) => value !== undefined))
        pushSegment(
          kind,
          layer,
          [x1!, y1!],
          [x2!, y2!],
          "LINE",
        );
      continue;
    }

    if (entity.type === "LWPOLYLINE" && kind) {
      const points = lwPolylinePoints(entity.rows);
      const flags = firstNumber(entity.rows, 70) ?? 0;
      for (let index = 0; index + 1 < points.length; index += 1)
        pushSegment(kind, layer, points[index], points[index + 1], "LWPOLYLINE");
      if ((flags & 1) === 1 && points.length > 2)
        pushSegment(
          kind,
          layer,
          points.at(-1)!,
          points[0],
          "LWPOLYLINE",
        );
      continue;
    }

    if (entity.type === "TEXT" || entity.type === "MTEXT") {
      const x = firstNumber(entity.rows, 10);
      const y = firstNumber(entity.rows, 20);
      const value = entity.rows
        .filter((row) => row.code === 1 || row.code === 3)
        .map((row) => row.value)
        .join("")
        .replace(/\\P/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (x !== undefined && y !== undefined && value)
        result.labels.push({
          layer,
          text: value.slice(0, 240),
          point: normalizePoint(x, y, metresPerUnit),
        });
    }
  }

  if (truncated)
    result.issues.push(
      `DXF semantic segment extraction stopped at the ${maxSegments.toLocaleString()} segment safety limit.`,
    );

  if (result.segments.length) {
    const points = result.segments.flatMap((segment) => [
      segment.start,
      segment.end,
    ]);
    result.bounds = {
      min: [
        Math.min(...points.map((point) => point[0])),
        Math.min(...points.map((point) => point[1])),
      ],
      max: [
        Math.max(...points.map((point) => point[0])),
        Math.max(...points.map((point) => point[1])),
      ],
    };
  }

  result.geometryReady = Boolean(unit && result.segments.length);
  if (!result.segments.length)
    result.issues.push(
      "No LINE/LWPOLYLINE geometry was found on clearly named architectural layers.",
    );
  return result;
}
