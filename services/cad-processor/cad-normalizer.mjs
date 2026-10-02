const UNIT = {
  1: { name: "inch", metres: 0.0254 },
  2: { name: "foot", metres: 0.3048 },
  4: { name: "millimetre", metres: 0.001 },
  5: { name: "centimetre", metres: 0.01 },
  6: { name: "metre", metres: 1 },
  10: { name: "yard", metres: 0.9144 },
  14: { name: "decimetre", metres: 0.1 },
  21: { name: "US survey foot", metres: 1200 / 3937 },
};

const MAX_SEGMENTS = 30000;
const MAX_LABELS = 5000;
const MAX_DIMENSIONS = 5000;
const MAX_ANCHORS = 10000;

function pairs(text) {
  const lines = text.replace(/^\\uFEFF/, "").split(/\\r?\\n/);
  const result = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index].trim(), 10);
    if (!Number.isFinite(code)) continue;
    result.push({ code, value: lines[index + 1].trim() });
  }
  return result;
}

function entityGroups(rows) {
  const entities = [];
  let inEntities = false;
  let current;
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

function firstNumber(rows, code) {
  const row = rows.find((entry) => entry.code === code);
  if (!row) return undefined;
  const value = Number(row.value);
  return Number.isFinite(value) ? value : undefined;
}

function firstString(rows, code) {
  return rows.find((entry) => entry.code === code)?.value?.trim();
}

function dxfUnits(rows) {
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

function semanticKind(layer, blockName = "") {
  const text = (layer + " " + blockName).toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\\b(door|doors|gate|entry|shutter)\\b/.test(text)) return "door";
  if (/\\b(window|windows|glazing|fenestration)\\b/.test(text)) return "window";
  if (/\\b(stair|stairs|staircase|step|steps)\\b/.test(text)) return "stair";
  if (/\\b(lift|elevator|elevators)\\b/.test(text)) return "lift";
  if (/\\b(column|columns|pillar|pillars)\\b/.test(text)) return "column";
  if (/\\b(slab|slabs|floor slab|roof slab)\\b/.test(text)) return "slab";
  if (/\\b(wall|walls|partition|masonry|brick)\\b/.test(text)) return "wall";
  return undefined;
}

function floorLabelFromText(value) {
  const text = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const named = [
    [/\\b(?:ground floor|ground|gf|g floor)\\b/, "Ground"],
    [/\\b(?:first floor|1st floor|floor 1|f1)\\b/, "Floor 1"],
    [/\\b(?:second floor|2nd floor|floor 2|f2)\\b/, "Floor 2"],
    [/\\b(?:third floor|3rd floor|floor 3|f3)\\b/, "Floor 3"],
    [/\\b(?:fourth floor|4th floor|floor 4|f4)\\b/, "Floor 4"],
    [/\\b(?:fifth floor|5th floor|floor 5|f5)\\b/, "Floor 5"],
    [/\\b(?:sixth floor|6th floor|floor 6|f6)\\b/, "Floor 6"],
    [/\\b(?:basement|lower ground|lg)\\b/, "Basement"],
  ];
  for (const [pattern, label] of named) if (pattern.test(text)) return label;
  const numbered = text.match(/\\bfloor\\s*(\\d{1,2})\\b/);
  return numbered ? "Floor " + Number(numbered[1]) : undefined;
}

function normPoint(x, y, metresPerUnit) {
  return [
    Number((x * metresPerUnit).toFixed(5)),
    Number((y * metresPerUnit).toFixed(5)),
  ];
}

function polylinePoints(rows) {
  const result = [];
  let x;
  for (const row of rows) {
    if (row.code === 10) {
      const candidate = Number(row.value);
      x = Number.isFinite(candidate) ? candidate : undefined;
    } else if (row.code === 20 && x !== undefined) {
      const y = Number(row.value);
      if (Number.isFinite(y)) result.push([x, y]);
      x = undefined;
    }
  }
  return result;
}

function cleanText(rows) {
  return rows
    .filter((row) => row.code === 1 || row.code === 3)
    .map((row) => row.value)
    .join("")
    .replace(/\\\\P/g, " ")
    .replace(/\\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function safeNumber(value, min = -1e7, max = 1e7) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function segmentConfidence(kind, entityType) {
  let confidence = 0.76;
  if (entityType === "LINE" || entityType === "LWPOLYLINE") confidence += 0.07;
  if (kind === "wall") confidence += 0.04;
  return Math.min(0.93, confidence);
}

export function normalizeDxfArchitecture(text, meta = {}) {
  const result = {
    format: "rekixo-cad-architecture",
    version: 1,
    processor: {
      engine: meta.engine || "libredwg-dwg2dxf",
      engineVersion: meta.engineVersion || "unknown",
    },
    source: {
      name: String(meta.sourceName || "source.dwg").slice(0, 500),
      ...(meta.sha256 ? { sha256: String(meta.sha256) } : {}),
      ...(meta.dwgVersion ? { dwgVersion: String(meta.dwgVersion) } : {}),
    },
    units: { name: "unknown", metresPerUnit: null },
    geometryReady: false,
    segments: [],
    anchors: [],
    dimensions: [],
    labels: [],
    floorHints: [],
    bounds: undefined,
    issues: [],
  };

  if (!/\\bSECTION\\b/i.test(text) || !/\\bENTITIES\\b/i.test(text)) {
    result.issues.push("Converted DXF does not contain a readable ENTITIES section.");
    return result;
  }

  const rows = pairs(text);
  const unitCode = dxfUnits(rows);
  const unit = unitCode !== undefined ? UNIT[unitCode] : undefined;
  if (!unit) {
    result.issues.push(
      "DWG conversion did not preserve a supported drawing unit. Geometry remains evidence-only until scale is reviewed.",
    );
    return result;
  }
  result.units = { code: unitCode, name: unit.name, metresPerUnit: unit.metres };

  const entities = entityGroups(rows);
  const floorHints = new Set();
  let truncated = false;
  let segmentIndex = 0;
  let anchorIndex = 0;

  const pushSegment = (kind, layer, start, end, sourceEntity, floorLabel) => {
    if (result.segments.length >= MAX_SEGMENTS) {
      truncated = true;
      return;
    }
    const a = normPoint(start[0], start[1], unit.metres);
    const b = normPoint(end[0], end[1], unit.metres);
    if (![...a, ...b].every((value) => safeNumber(value))) return;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.01) return;
    segmentIndex += 1;
    result.segments.push({
      id: "cad-segment-" + segmentIndex,
      kind,
      layer: layer.slice(0, 240),
      start: a,
      end: b,
      sourceEntity,
      confidence: segmentConfidence(kind, sourceEntity),
      ...(floorLabel ? { floorLabel } : {}),
    });
  };

  for (const entity of entities) {
    const layer = firstString(entity.rows, 8) || "0";
    const blockName = firstString(entity.rows, 2) || "";
    const floorLabel =
      floorLabelFromText(layer) ||
      floorLabelFromText(blockName) ||
      floorLabelFromText(meta.sourceName);
    if (floorLabel) floorHints.add(floorLabel);
    const kind = semanticKind(layer, blockName);

    if (entity.type === "LINE" && kind) {
      const x1 = firstNumber(entity.rows, 10);
      const y1 = firstNumber(entity.rows, 20);
      const x2 = firstNumber(entity.rows, 11);
      const y2 = firstNumber(entity.rows, 21);
      if ([x1, y1, x2, y2].every((value) => value !== undefined))
        pushSegment(kind, layer, [x1, y1], [x2, y2], "LINE", floorLabel);
      continue;
    }

    if ((entity.type === "LWPOLYLINE" || entity.type === "POLYLINE") && kind) {
      const points = polylinePoints(entity.rows);
      const flags = firstNumber(entity.rows, 70) || 0;
      for (let index = 0; index + 1 < points.length; index += 1)
        pushSegment(kind, layer, points[index], points[index + 1], entity.type, floorLabel);
      if ((flags & 1) === 1 && points.length > 2)
        pushSegment(kind, layer, points.at(-1), points[0], entity.type, floorLabel);
      continue;
    }

    if (entity.type === "INSERT" && kind && result.anchors.length < MAX_ANCHORS) {
      const x = firstNumber(entity.rows, 10);
      const y = firstNumber(entity.rows, 20);
      if (x !== undefined && y !== undefined) {
        anchorIndex += 1;
        result.anchors.push({
          id: "cad-anchor-" + anchorIndex,
          kind,
          layer: layer.slice(0, 240),
          blockName: blockName.slice(0, 240),
          point: normPoint(x, y, unit.metres),
          rotationY: Number((firstNumber(entity.rows, 50) || 0).toFixed(4)),
          scaleX: Number((firstNumber(entity.rows, 41) || 1).toFixed(5)),
          scaleY: Number((firstNumber(entity.rows, 42) || 1).toFixed(5)),
          confidence: 0.78,
          ...(floorLabel ? { floorLabel } : {}),
        });
      }
      continue;
    }

    if ((entity.type === "TEXT" || entity.type === "MTEXT") && result.labels.length < MAX_LABELS) {
      const x = firstNumber(entity.rows, 10);
      const y = firstNumber(entity.rows, 20);
      const textValue = cleanText(entity.rows);
      if (x !== undefined && y !== undefined && textValue) {
        const detectedFloor = floorLabelFromText(textValue);
        if (detectedFloor) floorHints.add(detectedFloor);
        result.labels.push({
          layer: layer.slice(0, 240),
          text: textValue,
          point: normPoint(x, y, unit.metres),
          ...(detectedFloor || floorLabel ? { floorLabel: detectedFloor || floorLabel } : {}),
        });
      }
      continue;
    }

    if (entity.type === "DIMENSION" && result.dimensions.length < MAX_DIMENSIONS) {
      const measurement = firstNumber(entity.rows, 42);
      const textValue = firstString(entity.rows, 1);
      const x = firstNumber(entity.rows, 10);
      const y = firstNumber(entity.rows, 20);
      result.dimensions.push({
        layer: layer.slice(0, 240),
        ...(measurement !== undefined && safeNumber(measurement)
          ? { valueMetres: Number((measurement * unit.metres).toFixed(5)) }
          : {}),
        ...(textValue && textValue !== "<>" ? { text: textValue.slice(0, 240) } : {}),
        ...(x !== undefined && y !== undefined ? { point: normPoint(x, y, unit.metres) } : {}),
        ...(floorLabel ? { floorLabel } : {}),
      });
    }
  }

  if (truncated)
    result.issues.push("CAD segment extraction stopped at the " + MAX_SEGMENTS + " segment safety limit.");

  if (result.segments.length) {
    const points = result.segments.flatMap((segment) => [segment.start, segment.end]);
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

  result.floorHints = [...floorHints].slice(0, 50);
  result.geometryReady = result.segments.some(
    (segment) => segment.kind === "wall" && segment.confidence >= 0.75,
  );
  if (!result.segments.length)
    result.issues.push(
      "No semantic wall/door/window/stair/lift/column/slab geometry was found after DWG conversion.",
    );
  return result;
}
