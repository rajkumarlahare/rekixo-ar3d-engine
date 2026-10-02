import http from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 8080);
const MAX_DWG_BYTES = 32 * 1024 * 1024;
const MAX_DXF_BYTES = 96 * 1024 * 1024;
const MAX_SEGMENTS = 60_000;
const MAX_TEXTS = 30_000;
const MAX_DIMENSIONS = 20_000;
const MAX_INSERTS = 30_000;
const MAX_OBJECTS = 40_000;
const LIBREDWG_VERSION = process.env.LIBREDWG_VERSION || "0.14";
const ADAPTER_VERSION = "rekixo-dwg-adapter-v1";

const UNITS = {
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

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function cleanText(value, max = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\\P/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeHeader(req, name, max) {
  const value = req.headers[name];
  if (Array.isArray(value)) return cleanText(value[0], max);
  return cleanText(value, max);
}

async function readBoundedBody(req) {
  const declared = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(declared) && declared > MAX_DWG_BYTES)
    throw Object.assign(Error("DWG exceeds the 32 MB processor limit."), {
      status: 413,
    });

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_DWG_BYTES)
      throw Object.assign(Error("DWG exceeds the 32 MB processor limit."), {
        status: 413,
      });
    chunks.push(buffer);
  }
  if (!size)
    throw Object.assign(Error("DWG request body is empty."), { status: 400 });
  return Buffer.concat(chunks, size);
}

function versionCode(buffer) {
  return buffer.subarray(0, 16).toString("ascii").match(/AC10\d{2}/)?.[0];
}

function pairs(text) {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const result = [];
  for (let index = 0; index + 1 < rows.length; index += 2) {
    const code = Number.parseInt(rows[index].trim(), 10);
    if (!Number.isFinite(code)) continue;
    result.push({ code, value: rows[index + 1].trim() });
  }
  return result;
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

function allStrings(rows, codes) {
  return rows
    .filter((entry) => codes.includes(entry.code))
    .map((entry) => entry.value)
    .join("");
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

function dxfUnits(rows) {
  for (let index = 0; index + 1 < rows.length; index += 1) {
    if (rows[index].code !== 9 || rows[index].value !== "$INSUNITS") continue;
    for (let next = index + 1; next < Math.min(rows.length, index + 10); next += 1) {
      if (rows[next].code === 70) {
        const value = Number.parseInt(rows[next].value, 10);
        if (Number.isFinite(value)) return value;
      }
      if (rows[next].code === 9 || rows[next].code === 0) break;
    }
  }
  return undefined;
}

function normalizedWords(value) {
  return cleanText(value, 600)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function semanticKind(...values) {
  const text = normalizedWords(values.join(" "));
  if (!text) return "other";
  if (/\b(door|doors|gate|resistant door|entry)\b/.test(text)) return "door";
  if (/\b(window|windows|glazing|fenestration)\b/.test(text)) return "window";
  if (/\b(wall|walls|partition|masonry|brick)\b/.test(text)) return "wall";
  if (/\b(stair|stairs|staircase|floorlanding|landing)\b/.test(text))
    return "stair";
  if (/\b(lift|elevator|fire lift|normal lift)\b/.test(text)) return "lift";
  if (/\b(column|columns|pillar|pillars)\b/.test(text)) return "column";
  if (/\b(slab|floor slab)\b/.test(text)) return "slab";
  if (/\b(roof|terrace)\b/.test(text)) return "roof";
  if (/\b(duct|shaft)\b/.test(text)) return "duct";
  if (/\b(balcony|verandah|veranda)\b/.test(text)) return "balcony";
  if (/\b(room|living|kitchen|bedroom|bed room|toilet|bath|lobby)\b/.test(text))
    return "room";
  return "other";
}

function semanticConfidence(layer, entityType, blockName = "") {
  const byLayer = semanticKind(layer);
  if (byLayer !== "other") return 0.97;
  if (semanticKind(blockName) !== "other") return 0.93;
  if (semanticKind(entityType) !== "other") return 0.88;
  return 0.5;
}

function textKind(value) {
  const text = normalizedWords(value);
  if (/\b(?:ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|\d+(?:st|nd|rd|th)?)\s+floor\b|\bfloor\s+(?:plan|lvl|level|\d+)\b/.test(text))
    return "floor";
  if (/\b(?:living|kitchen|bed ?room|toilet|bath|lobby|balcony|duct|room|lift)\b/.test(text))
    return "room";
  if (/\b(?:dimension|dimensions|all dimensions|mm|cm|metre|meter)\b/.test(text))
    return "dimension";
  if (/\b(?:note|notes|drawing|plan|section|elevation)\b/.test(text))
    return "note";
  return "other";
}

function metresPoint(x, y, scale) {
  if (![x, y].every(Number.isFinite) || !scale) return undefined;
  return [
    Number((x * scale).toFixed(6)),
    Number((y * scale).toFixed(6)),
  ];
}

function pointsFromLwPolyline(rows) {
  const points = [];
  let x;
  for (const row of rows) {
    if (row.code === 10) {
      const value = Number(row.value);
      x = Number.isFinite(value) ? value : undefined;
    } else if (row.code === 20 && x !== undefined) {
      const y = Number(row.value);
      if (Number.isFinite(y)) points.push([x, y]);
      x = undefined;
    }
  }
  return points;
}

function widthMetres(rows, scale) {
  if (!scale) return undefined;
  const width =
    firstNumber(rows, 43) ??
    firstNumber(rows, 40) ??
    firstNumber(rows, 41);
  if (!(width > 0)) return undefined;
  const metres = width * scale;
  return metres > 0 && metres <= 5 ? Number(metres.toFixed(5)) : undefined;
}

function uniqueFloorLabels(texts) {
  const result = [];
  const seen = new Set();
  for (const row of texts.filter((entry) => entry.kind === "floor")) {
    const label = cleanText(row.text, 180);
    const key = normalizedWords(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      label,
      confidence: 0.9,
      sourceTextId: row.id,
    });
    if (result.length >= 200) break;
  }
  return result;
}

function calculateBounds(points) {
  if (!points.length) return undefined;
  const xs = points.map((entry) => entry[0]).filter(Number.isFinite);
  const ys = points.map((entry) => entry[1]).filter(Number.isFinite);
  if (!xs.length || !ys.length) return undefined;
  return {
    min: [Math.min(...xs), Math.min(...ys)].map((value) =>
      Number(value.toFixed(6)),
    ),
    max: [Math.max(...xs), Math.max(...ys)].map((value) =>
      Number(value.toFixed(6)),
    ),
  };
}

function normalizeDxf(text, source) {
  const parsedPairs = pairs(text);
  const entities = entityGroups(parsedPairs);
  const unitCode = dxfUnits(parsedPairs);
  const unit = unitCode !== undefined ? UNITS[unitCode] : undefined;
  const scale = unit?.metres;
  const issues = [];
  if (!unit)
    issues.push(
      unitCode === 0
        ? "DWG/DXF units are unitless; positional geometry remains review-only and is not emitted as metre geometry."
        : "DWG/DXF units are missing or unsupported; positional geometry remains review-only and is not emitted as metre geometry.",
    );

  const segments = [];
  const texts = [];
  const dimensions = [];
  const inserts = [];
  const objects = [];
  const layers = new Map();
  const boundsPoints = [];
  let truncated = false;

  const rememberLayer = (layer, kind) => {
    const safeLayer = cleanText(layer || "0", 260) || "0";
    const current = layers.get(safeLayer) ?? {
      name: safeLayer,
      entityCount: 0,
    };
    current.entityCount += 1;
    if (kind && kind !== "other" && !current.semanticKind)
      current.semanticKind = kind;
    layers.set(safeLayer, current);
  };

  const pushSegment = (kind, layer, start, end, sourceEntity, confidence, widthM) => {
    if (!scale || !["wall", "door", "window"].includes(kind)) return;
    if (segments.length >= MAX_SEGMENTS) {
      truncated = true;
      return;
    }
    const a = metresPoint(start?.[0], start?.[1], scale);
    const b = metresPoint(end?.[0], end?.[1], scale);
    if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.005) return;
    boundsPoints.push(a, b);
    segments.push({
      id: `seg-${segments.length + 1}`,
      kind,
      layer: cleanText(layer || "0", 260) || "0",
      start: a,
      end: b,
      sourceEntity: cleanText(sourceEntity, 120) || "UNKNOWN",
      confidence,
      ...(widthM ? { widthM } : {}),
    });
  };

  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];
    const layer = firstString(entity.rows, 8) || "0";
    const blockName = firstString(entity.rows, 2) || "";
    const kind = semanticKind(layer, entity.type, blockName);
    const conf = semanticConfidence(layer, entity.type, blockName);
    rememberLayer(layer, kind);

    if (entity.type === "LINE") {
      pushSegment(
        kind,
        layer,
        [firstNumber(entity.rows, 10), firstNumber(entity.rows, 20)],
        [firstNumber(entity.rows, 11), firstNumber(entity.rows, 21)],
        entity.type,
        conf,
        widthMetres(entity.rows, scale),
      );
      continue;
    }

    if (entity.type === "LWPOLYLINE") {
      const points = pointsFromLwPolyline(entity.rows);
      const widthM = widthMetres(entity.rows, scale);
      for (let pointIndex = 0; pointIndex + 1 < points.length; pointIndex += 1)
        pushSegment(
          kind,
          layer,
          points[pointIndex],
          points[pointIndex + 1],
          entity.type,
          conf,
          widthM,
        );
      const flags = firstNumber(entity.rows, 70) ?? 0;
      if ((flags & 1) === 1 && points.length > 2)
        pushSegment(
          kind,
          layer,
          points.at(-1),
          points[0],
          entity.type,
          conf,
          widthM,
        );
      continue;
    }

    if (entity.type === "POLYLINE") {
      const polylinePoints = [];
      let next = index + 1;
      for (; next < entities.length; next += 1) {
        const child = entities[next];
        if (child.type === "SEQEND") break;
        if (child.type !== "VERTEX") break;
        const x = firstNumber(child.rows, 10);
        const y = firstNumber(child.rows, 20);
        if (Number.isFinite(x) && Number.isFinite(y))
          polylinePoints.push([x, y]);
      }
      const widthM = widthMetres(entity.rows, scale);
      for (
        let pointIndex = 0;
        pointIndex + 1 < polylinePoints.length;
        pointIndex += 1
      )
        pushSegment(
          kind,
          layer,
          polylinePoints[pointIndex],
          polylinePoints[pointIndex + 1],
          entity.type,
          conf,
          widthM,
        );
      const flags = firstNumber(entity.rows, 70) ?? 0;
      if ((flags & 1) === 1 && polylinePoints.length > 2)
        pushSegment(
          kind,
          layer,
          polylinePoints.at(-1),
          polylinePoints[0],
          entity.type,
          conf,
          widthM,
        );
      index = Math.max(index, next - 1);
      continue;
    }

    if (entity.type === "TEXT" || entity.type === "MTEXT") {
      if (!scale || texts.length >= MAX_TEXTS) {
        if (texts.length >= MAX_TEXTS) truncated = true;
        continue;
      }
      const value = cleanText(allStrings(entity.rows, [1, 3]), 500);
      const at = metresPoint(
        firstNumber(entity.rows, 10),
        firstNumber(entity.rows, 20),
        scale,
      );
      if (!value || !at) continue;
      boundsPoints.push(at);
      texts.push({
        id: `text-${texts.length + 1}`,
        layer: cleanText(layer, 260) || "0",
        text: value,
        point: at,
        kind: textKind(value),
      });
      continue;
    }

    if (entity.type === "DIMENSION") {
      if (!scale || dimensions.length >= MAX_DIMENSIONS) {
        if (dimensions.length >= MAX_DIMENSIONS) truncated = true;
        continue;
      }
      const measured = firstNumber(entity.rows, 42);
      const at = metresPoint(
        firstNumber(entity.rows, 10),
        firstNumber(entity.rows, 20),
        scale,
      );
      const start = metresPoint(
        firstNumber(entity.rows, 13),
        firstNumber(entity.rows, 23),
        scale,
      );
      const end = metresPoint(
        firstNumber(entity.rows, 14),
        firstNumber(entity.rows, 24),
        scale,
      );
      for (const p of [at, start, end]) if (p) boundsPoints.push(p);
      dimensions.push({
        id: `dim-${dimensions.length + 1}`,
        layer: cleanText(layer, 260) || "0",
        ...(Number.isFinite(measured)
          ? { valueM: Number((Math.abs(measured) * scale).toFixed(6)) }
          : {}),
        ...(firstString(entity.rows, 1)
          ? { text: cleanText(firstString(entity.rows, 1), 240) }
          : {}),
        ...(at ? { point: at } : {}),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
      });
      continue;
    }

    if (entity.type === "INSERT") {
      if (!scale || inserts.length >= MAX_INSERTS) {
        if (inserts.length >= MAX_INSERTS) truncated = true;
        continue;
      }
      const at = metresPoint(
        firstNumber(entity.rows, 10),
        firstNumber(entity.rows, 20),
        scale,
      );
      if (!at) continue;
      boundsPoints.push(at);
      inserts.push({
        id: `insert-${inserts.length + 1}`,
        layer: cleanText(layer, 260) || "0",
        name: cleanText(blockName || "Unnamed block", 260),
        point: at,
        rotationDeg: firstNumber(entity.rows, 50) ?? 0,
        scale: [
          firstNumber(entity.rows, 41) ?? 1,
          firstNumber(entity.rows, 42) ?? 1,
          firstNumber(entity.rows, 43) ?? 1,
        ],
        kind,
        confidence: conf,
      });
      continue;
    }

    const entityKind = semanticKind(layer, entity.type, blockName);
    if (entityKind !== "other" && objects.length < MAX_OBJECTS) {
      const at = scale
        ? metresPoint(
            firstNumber(entity.rows, 10),
            firstNumber(entity.rows, 20),
            scale,
          )
        : undefined;
      if (at) boundsPoints.push(at);

      const end = scale
        ? metresPoint(
            firstNumber(entity.rows, 11),
            firstNumber(entity.rows, 21),
            scale,
          )
        : undefined;
      if (
        ["wall", "door", "window"].includes(entityKind) &&
        at &&
        end
      ) {
        pushSegment(
          entityKind,
          layer,
          [
            firstNumber(entity.rows, 10),
            firstNumber(entity.rows, 20),
          ],
          [
            firstNumber(entity.rows, 11),
            firstNumber(entity.rows, 21),
          ],
          entity.type,
          conf,
          widthMetres(entity.rows, scale),
        );
      }

      objects.push({
        id: `object-${objects.length + 1}`,
        layer: cleanText(layer, 260) || "0",
        sourceEntity: cleanText(entity.type, 120),
        kind: entityKind,
        confidence: conf,
        ...(at ? { point: at } : {}),
      });
    } else if (objects.length >= MAX_OBJECTS) {
      truncated = true;
    }
  }

  if (truncated)
    issues.push("DWG normalization reached one or more bounded entity safety limits.");

  const layerRows = [...layers.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 10_000);

  return {
    contract: "rekixo-dwg-normalized",
    version: 1,
    source,
    processor: {
      engine: "gnu-libredwg",
      engineVersion: LIBREDWG_VERSION,
      adapterVersion: ADAPTER_VERSION,
    },
    units: {
      ...(unitCode !== undefined ? { code: unitCode } : {}),
      ...(unit ? { name: unit.name, metresPerUnit: unit.metres } : {}),
      reviewed: Boolean(unit),
    },
    ...(scale && boundsPoints.length
      ? { bounds: calculateBounds(boundsPoints) }
      : {}),
    layers: layerRows,
    segments,
    texts,
    dimensions,
    inserts,
    objects,
    floors: uniqueFloorLabels(texts),
    issues,
  };
}

async function convertDwg(buffer, source) {
  const dir = await mkdtemp(path.join(tmpdir(), "rekixo-dwg-"));
  const input = path.join(dir, "source.dwg");
  const output = path.join(dir, "normalized.dxf");
  try {
    await writeFile(input, buffer, { flag: "wx" });
    try {
      await execFileAsync(
        "dwgread",
        ["-O", "DXF", "-o", output, input],
        {
          timeout: 45_000,
          maxBuffer: 8 * 1024 * 1024,
          env: {
            ...process.env,
            LANG: "C.UTF-8",
          },
        },
      );
    } catch (error) {
      const stderr = cleanText(error?.stderr || error?.message, 1200);
      throw Object.assign(
        Error(`LibreDWG could not decode this DWG${stderr ? `: ${stderr}` : "."}`),
        { status: 422 },
      );
    }

    const dxf = await readFile(output);
    if (!dxf.length)
      throw Object.assign(Error("LibreDWG produced an empty DXF derivative."), {
        status: 422,
      });
    if (dxf.length > MAX_DXF_BYTES)
      throw Object.assign(
        Error("Decoded DWG exceeds the 96 MB normalized DXF safety limit."),
        { status: 413 },
      );
    return normalizeDxf(dxf.toString("utf8"), source);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health")
    return json(res, 200, {
      ok: true,
      processor: "rekixo-dwg-processor",
      libredwg: LIBREDWG_VERSION,
      adapter: ADAPTER_VERSION,
    });

  if (req.method !== "POST" || req.url !== "/v1/dwg/normalize")
    return json(res, 404, { error: "Route not found." });

  try {
    const body = await readBoundedBody(req);
    const code = versionCode(body);
    if (!code)
      return json(res, 415, { error: "DWG AC10xx header was not recognized." });

    const sha256 = createHash("sha256").update(body).digest("hex");
    const expectedHash = safeHeader(req, "x-rekixo-source-sha256", 64).toLowerCase();
    if (expectedHash && expectedHash !== sha256)
      return json(res, 409, { error: "DWG checksum does not match the request metadata." });

    const assetId = safeHeader(req, "x-rekixo-source-asset-id", 120);
    if (!assetId)
      return json(res, 400, { error: "DWG source asset ID is required." });
    const sourceName =
      safeHeader(req, "x-rekixo-source-name", 260) || "source.dwg";

    const document = await convertDwg(body, {
      format: "dwg",
      assetId,
      name: sourceName,
      sha256,
      byteSize: body.length,
      versionCode: code,
    });
    return json(res, 200, document);
  } catch (error) {
    const status =
      Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
        ? error.status
        : 500;
    return json(res, status, {
      error:
        status === 500
          ? "DWG processor failed safely."
          : cleanText(error?.message || "DWG processor rejected the source.", 1400),
    });
  }
});

server.requestTimeout = 60_000;
server.headersTimeout = 10_000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "dwg-processor.ready",
      port: PORT,
      libredwg: LIBREDWG_VERSION,
      adapter: ADAPTER_VERSION,
    }),
  );
});
