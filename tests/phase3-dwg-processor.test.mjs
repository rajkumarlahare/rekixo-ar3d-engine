import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeDxfArchitecture } from "../services/cad-processor/cad-normalizer.mjs";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const dwgProcessor = await import(
  asUrl(compile("apps/admin/src/studio/dwgProcessor.ts"))
);
const graph = await import(
  asUrl(compile("apps/admin/src/studio/architectureGraph.ts"))
);

function pair(code, value) {
  return String(code) + "\n" + String(value) + "\n";
}

function dxfFixture({ units = 4, includeUnits = true } = {}) {
  let value = "";
  value += pair(0, "SECTION");
  value += pair(2, "HEADER");
  if (includeUnits) {
    value += pair(9, "$INSUNITS");
    value += pair(70, units);
  }
  value += pair(0, "ENDSEC");
  value += pair(0, "SECTION");
  value += pair(2, "ENTITIES");

  const line = (layer, x1, y1, x2, y2) => {
    value += pair(0, "LINE");
    value += pair(8, layer);
    value += pair(10, x1);
    value += pair(20, y1);
    value += pair(11, x2);
    value += pair(21, y2);
  };

  line("WALL", 0, 0, 5000, 0);
  line("WALL", 0, 200, 5000, 200);
  line("WALL", 0, 0, 0, 4000);
  line("WALL", 200, 0, 200, 4000);

  value += pair(0, "INSERT");
  value += pair(8, "DOOR");
  value += pair(2, "D1");
  value += pair(10, 1000);
  value += pair(20, 0);
  value += pair(50, 90);

  value += pair(0, "TEXT");
  value += pair(8, "TEXT");
  value += pair(10, 100);
  value += pair(20, 100);
  value += pair(1, "GROUND FLOOR PLAN");

  value += pair(0, "DIMENSION");
  value += pair(8, "DIM");
  value += pair(10, 100);
  value += pair(20, 200);
  value += pair(42, 5000);

  value += pair(0, "ENDSEC");
  value += pair(0, "EOF");
  return value;
}

test("Phase 3 normalizes DWG-converted DXF into measured architectural evidence", () => {
  const result = normalizeDxfArchitecture(dxfFixture(), {
    sourceName: "building.dwg",
    sha256: "a".repeat(64),
    dwgVersion: "AC1015",
    engine: "fixture",
    engineVersion: "1",
  });

  assert.equal(result.geometryReady, true);
  assert.equal(result.units.name, "millimetre");
  assert.equal(result.units.metresPerUnit, 0.001);
  assert.equal(result.units.basis, "dxf-insunits");
  const walls = result.segments.filter((segment) => segment.kind === "wall");
  assert.equal(walls.length, 2, "paired wall boundaries should collapse to centerlines");
  assert.ok(walls.every((wall) => Math.abs(wall.thickness - 0.2) < 1e-6));
  assert.ok(
    walls.every(
      (wall) => wall.thicknessBasis === "paired-parallel-wall-boundaries",
    ),
  );
  assert.equal(result.anchors.length, 1);
  assert.equal(result.anchors[0].kind, "door");
  assert.equal(result.dimensions.length, 1);
  assert.equal(result.dimensions[0].valueMetres, 5);
  assert.deepEqual(result.floorHints, ["Ground"]);
});

test("Phase 3 can recover units only from explicit drawing text, never from a silent default", () => {
  const explicit = dxfFixture({ includeUnits: false }).replace(
    "GROUND FLOOR PLAN",
    "ALL DIMENSIONS ARE IN mm GROUND FLOOR PLAN",
  );
  const recovered = normalizeDxfArchitecture(explicit, {
    sourceName: "building.dwg",
  });
  assert.equal(recovered.units.name, "millimetre");
  assert.equal(recovered.units.basis, "drawing-text");
  assert.ok(
    recovered.issues.some((issue) =>
      /recovered from explicit drawing text/i.test(issue),
    ),
  );

  const unknown = normalizeDxfArchitecture(
    dxfFixture({ includeUnits: false }).replace(
      "GROUND FLOOR PLAN",
      "GROUND FLOOR PLAN",
    ),
    { sourceName: "building.dwg" },
  );
  assert.equal(unknown.geometryReady, false);
  assert.equal(unknown.units.metresPerUnit, null);
  assert.ok(unknown.issues.some((issue) => /unit/i.test(issue)));
});

test("Phase 3 validates the processor contract before Studio trusts it", () => {
  const normalized = normalizeDxfArchitecture(dxfFixture(), {
    sourceName: "building.dwg",
  });
  const valid = dwgProcessor.validateDwgProcessorResult(normalized);
  assert.equal(valid.format, "rekixo-cad-architecture");
  assert.equal(valid.version, 1);

  assert.throws(
    () =>
      dwgProcessor.validateDwgProcessorResult({
        ...normalized,
        segments: [
          {
            kind: "wall",
            layer: "WALL",
            start: ["bad", 0],
            end: [1, 0],
            confidence: 0.9,
          },
        ],
      }),
    /invalid semantic segment/i,
  );
});

test("Phase 3 derives editable CAD walls only when measured DWG wall evidence is safe", () => {
  const analysis = {
    bounds: { min: [0, 0, 0], max: [5, 9, 4] },
    cadAudits: [
      {
        assetId: "dwg-asset",
        name: "building.dwg",
        kind: "dwg",
        semanticReady: true,
        geometryReady: true,
        layerHints: [{ layer: "WALL", kind: "wall" }],
        semanticSegments: [
          { kind: "wall", layer: "WALL", start: [0, 0], end: [5, 0], sourceEntity: "DWG", confidence: 0.95, thickness: 0.2 },
          { kind: "wall", layer: "WALL", start: [5, 0], end: [5, 4], sourceEntity: "DWG", confidence: 0.95, thickness: 0.2 },
          { kind: "wall", layer: "WALL", start: [5, 4], end: [0, 4], sourceEntity: "DWG", confidence: 0.95, thickness: 0.2 },
          { kind: "wall", layer: "WALL", start: [0, 4], end: [0, 0], sourceEntity: "DWG", confidence: 0.95, thickness: 0.2 },
        ],
        textLabels: [],
        floorHints: [],
        note: "fixture",
      },
    ],
  };
  const result = graph.deriveCadWallGraph(
    analysis,
    [{ id: "ground", name: "Ground", elevation: 0 }],
    1,
    { x: 0, y: 0, z: 0, rotationY: 0 },
  );
  assert.equal(result.compatible, true);
  assert.equal(result.auditKind, "dwg");
  assert.equal(result.measuredWallCount, 4);
  assert.equal(result.walls.length, 4);
  assert.ok(result.walls.every((wall) => wall.thickness === 0.2));
  assert.ok(result.walls.every((wall) => wall.reviewed === false));
  assert.ok(result.walls.every((wall) => wall.reviewState === "suggested"));
});

test("Phase 3 refuses to assign one CAD graph when multiple floor identities conflict", () => {
  const analysis = {
    bounds: { min: [0, 0, 0], max: [5, 9, 4] },
    cadAudits: [
      {
        assetId: "dwg-asset",
        name: "building.dwg",
        kind: "dwg",
        semanticReady: true,
        geometryReady: true,
        layerHints: [{ layer: "WALL", kind: "wall" }],
        semanticSegments: [
          { kind: "wall", layer: "WALL", start: [0, 0], end: [5, 0], sourceEntity: "DWG", confidence: 0.95, thickness: 0.2 },
          { kind: "wall", layer: "WALL", start: [0, 0], end: [0, 4], sourceEntity: "DWG", confidence: 0.95, thickness: 0.2 },
        ],
        textLabels: [
          { layer: "TEXT", text: "GROUND FLOOR PLAN", point: [0, 0] },
          { layer: "TEXT", text: "FIRST FLOOR PLAN", point: [10, 0] },
        ],
        floorHints: ["Ground", "Floor 1"],
        note: "fixture",
      },
    ],
  };
  const result = graph.deriveCadWallGraph(
    analysis,
    [
      { id: "ground", name: "Ground", elevation: 0 },
      { id: "f1", name: "Floor 1", elevation: 3 },
    ],
    1,
  );
  assert.equal(result.compatible, false);
  assert.match(result.reason, /floor identity is ambiguous/i);
});

test("Phase 3 keeps DWG processing behind the authenticated Admin proxy", () => {
  const worker = fs.readFileSync("workers/admin-cloud.mjs", "utf8");
  const proxy = fs.readFileSync("workers/cad-processor-proxy.mjs", "utf8");
  const client = fs.readFileSync("apps/admin/src/studio/dwgProcessor.ts", "utf8");
  const builder = fs.readFileSync("apps/admin/src/studio/smartDraftBuilder.ts", "utf8");
  const service = fs.readFileSync("services/cad-processor/server.mjs", "utf8");

  assert.match(worker, /from "\.\/cad-processor-proxy\.mjs"/);
  assert.match(worker, /processCadDwg\(request, env, actor, url\)/);
  assert.match(proxy, /CAD_PROCESSOR_URL/);
  assert.match(proxy, /CAD_PROCESSOR_TOKEN/);
  assert.match(proxy, /sameOrigin\(request\)/);
  assert.match(proxy, /cad\.dwg_processed/);
  assert.match(client, /\/3Dprojects\/api\/cloud\/cad\/process/);
  assert.doesNotMatch(client, /CAD_PROCESSOR_TOKEN/);
  assert.match(service, /authorization/);
  assert.match(service, /32 MB processor limit/);
  assert.match(builder, /preferMeasuredDwg/);
  assert.match(builder, /wall\.origin !== "cad-auto"/);
});
