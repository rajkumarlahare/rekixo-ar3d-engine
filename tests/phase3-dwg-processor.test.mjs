import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const normalized = await import(
  asUrl(compile("apps/admin/src/studio/dwgNormalized.ts")),
);
const graph = await import(
  asUrl(compile("apps/admin/src/studio/architectureGraph.ts")),
);

function documentFixture() {
  return {
    contract: "rekixo-dwg-normalized",
    version: 1,
    source: {
      format: "dwg",
      assetId: "asset_dwg_12345",
      name: "building.dwg",
      sha256: "a".repeat(64),
      byteSize: 1024,
      versionCode: "AC1015",
    },
    processor: {
      engine: "gnu-libredwg",
      engineVersion: "0.14",
      adapterVersion: "rekixo-dwg-adapter-v1",
    },
    units: {
      code: 4,
      name: "millimetre",
      metresPerUnit: 0.001,
      reviewed: true,
    },
    bounds: { min: [0, 0], max: [4, 3] },
    layers: [
      { name: "A-WALL", semanticKind: "wall", entityCount: 4 },
      { name: "A-DOOR", semanticKind: "door", entityCount: 1 },
    ],
    segments: [
      {
        id: "seg-1",
        kind: "wall",
        layer: "A-WALL",
        start: [0, 0],
        end: [4, 0],
        sourceEntity: "LWPOLYLINE",
        confidence: 0.97,
        widthM: 0.24,
      },
    ],
    texts: [
      {
        id: "text-1",
        layer: "A-ROOM",
        text: "LIVING",
        point: [2, 1.5],
        kind: "room",
      },
      {
        id: "text-2",
        layer: "A-TEXT",
        text: "FIRST FLOOR PLAN",
        point: [0, 0],
        kind: "floor",
      },
    ],
    dimensions: [
      {
        id: "dim-1",
        layer: "A-DIMS",
        valueM: 4,
        start: [0, 0],
        end: [4, 0],
      },
    ],
    inserts: [
      {
        id: "insert-1",
        layer: "TPClient-LIFT-Normal_Lift",
        name: "Lift",
        point: [1, 1],
        rotationDeg: 0,
        scale: [1, 1, 1],
        kind: "lift",
        confidence: 0.97,
      },
    ],
    objects: [
      {
        id: "object-1",
        layer: "TPClient-STAIR",
        sourceEntity: "AEC_STAIR",
        kind: "stair",
        confidence: 0.97,
        point: [2, 2],
      },
    ],
    floors: [
      {
        label: "FIRST FLOOR PLAN",
        confidence: 0.9,
        sourceTextId: "text-2",
      },
    ],
    issues: [],
  };
}

test("Phase 3 normalized DWG contract is source-bound and metre-safe", () => {
  const source = {
    id: "asset_dwg_12345",
    projectId: "project_12345678",
    name: "building.dwg",
    type: "application/acad",
    size: 1024,
    hash: "a".repeat(64),
    blob: new Blob(["x"]),
  };
  const parsed = normalized.parseDwgNormalizedDocument(
    documentFixture(),
    source,
  );
  assert.equal(parsed.source.versionCode, "AC1015");
  assert.equal(parsed.units.metresPerUnit, 0.001);
  assert.equal(parsed.segments[0].widthM, 0.24);
  assert.equal(parsed.dimensions[0].valueM, 4);
  assert.equal(parsed.inserts[0].kind, "lift");
  assert.equal(parsed.objects[0].kind, "stair");

  const wrong = documentFixture();
  wrong.source.sha256 = "b".repeat(64);
  assert.throws(
    () => normalized.parseDwgNormalizedDocument(wrong, source),
    /does not match the source asset/,
  );

  const extreme = documentFixture();
  extreme.segments[0].end = [99_000_000, 0];
  assert.throws(
    () => normalized.parseDwgNormalizedDocument(extreme, source),
    /coordinate limits/,
  );
});

test("Phase 3 normalized DWG walls can feed the CAD graph with decoded width", () => {
  const analysis = {
    createdAt: new Date().toISOString(),
    sources: [],
    modelAssetId: "model",
    modelName: "building.fbx",
    meshCount: 1,
    materialCount: 1,
    bounds: { min: [0, 0, 0], max: [4, 3, 3] },
    floorCandidates: [{ elevation: 0, confidence: 0.9, evidenceCount: 1 }],
    nodeAssignments: [],
    architecturalCandidates: [],
    cadAudits: [
      {
        assetId: "asset_dwg_12345",
        name: "ground-floor.dwg",
        kind: "dwg",
        semanticReady: true,
        layerHints: [{ layer: "A-WALL", kind: "wall" }],
        unitName: "millimetre",
        metresPerUnit: 0.001,
        geometryReady: true,
        semanticSegments: [
          {
            kind: "wall",
            layer: "A-WALL",
            start: [0, 0],
            end: [4, 0],
            sourceEntity: "LWPOLYLINE",
            widthM: 0.24,
          },
          {
            kind: "wall",
            layer: "A-WALL",
            start: [4, 0],
            end: [4, 3],
            sourceEntity: "LWPOLYLINE",
            widthM: 0.24,
          },
          {
            kind: "wall",
            layer: "A-WALL",
            start: [4, 3],
            end: [0, 3],
            sourceEntity: "LWPOLYLINE",
            widthM: 0.24,
          },
          {
            kind: "wall",
            layer: "A-WALL",
            start: [0, 3],
            end: [0, 0],
            sourceEntity: "LWPOLYLINE",
            widthM: 0.24,
          },
        ],
        textLabels: [],
        normalizedDwg: documentFixture(),
        note: "fixture",
      },
    ],
    highConfidenceAssignments: 0,
    reviewAssignments: 0,
    commonAssignments: 0,
    externalTextureRefs: 0,
    matchedTextureRefs: 0,
    issues: [],
  };

  const result = graph.deriveCadWallGraph(
    analysis,
    [{ id: "ground", name: "Ground", elevation: 0 }],
    1,
    { x: 0, y: 0, z: 0, rotationY: 0 },
  );
  assert.equal(result.compatible, true);
  assert.equal(result.walls.length, 4);
  assert.ok(result.walls.every((wall) => wall.origin === "cad-auto"));
  assert.ok(result.walls.every((wall) => wall.thickness === 0.24));
  assert.ok(result.walls.every((wall) => wall.confidence === 0.92));
  assert.ok(result.walls.every((wall) => wall.reviewed === false));
});

test("Phase 3 controlled DWG processor is isolated, pinned and bounded", () => {
  const service = fs.readFileSync(
    "services/dwg-processor/server.mjs",
    "utf8",
  );
  const docker = fs.readFileSync(
    "services/dwg-processor/Dockerfile",
    "utf8",
  );
  const notices = fs.readFileSync(
    "services/dwg-processor/THIRD_PARTY_NOTICES.md",
    "utf8",
  );
  const wrangler = fs.readFileSync("wrangler.admin.jsonc", "utf8");

  assert.match(service, /execFileAsync/);
  assert.match(service, /"dwgread"/);
  assert.match(service, /\["-O", "DXF", "-o", output, input\]/);
  assert.match(service, /MAX_DWG_BYTES = 32 \* 1024 \* 1024/);
  assert.match(service, /timeout: 45_000/);
  assert.match(service, /rekixo-dwg-normalized/);
  assert.match(service, /DIMENSION/);
  assert.match(service, /INSERT/);
  assert.match(service, /TPClient|semanticKind/);

  assert.match(docker, /LIBREDWG_VERSION=0\.14/);
  assert.match(
    docker,
    /62ebb73b984f865960f20ed26619ea5f8789d5e3fd088fa40a2598384da81275/,
  );
  assert.match(docker, /sha256sum -c -/);
  assert.match(notices, /GNU LibreDWG/);
  assert.match(notices, /General Public License/);

  assert.match(wrangler, /"main": "\.\/workers\/admin-entry\.mjs"/);
  assert.match(wrangler, /"class_name": "DwgProcessor"/);
  assert.match(wrangler, /"name": "DWG_PROCESSOR"/);
  assert.match(wrangler, /"new_sqlite_classes": \["DwgProcessor"\]/);
  assert.match(wrangler, /"image_build_context": "\."/);
  assert.match(wrangler, /"instance_type": "basic"/);
  assert.match(wrangler, /"max_instances": 2/);
});

test("Phase 3 cloud boundary is authenticated, same-origin and source-bound", () => {
  const worker = fs.readFileSync("workers/admin-cloud.mjs", "utf8");
  const route = fs.readFileSync(
    "workers/dwg-processor-route.mjs",
    "utf8",
  );
  const controller = fs.readFileSync(
    "workers/dwg-processor-container.mjs",
    "utf8",
  );
  const client = fs.readFileSync("apps/admin/src/studio/cloud.ts", "utf8");
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );
  const analyzer = fs.readFileSync(
    "apps/admin/src/studio/projectAnalyzer.ts",
    "utf8",
  );

  assert.match(worker, /CLOUD_PATH}\/processors\/dwg/);
  assert.match(worker, /processDwgArchitecture/);
  assert.match(worker, /sameOrigin\(request\)/);
  assert.match(route, /validSha256\(sha256\)/);
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /DWG_PROCESSOR\.getByName/);
  assert.match(controller, /extends DurableObject/);
  assert.match(controller, /container\.start\(\)/);
  assert.match(controller, /getTcpPort\(PROCESSOR_PORT\)/);
  assert.match(controller, /\/health/);

  assert.match(client, /processDwgArchitecture/);
  assert.match(client, /X-Rekixo-Source-Sha256/);
  assert.match(pipeline, /prepareDwgArchitectureDerivative/);
  assert.match(pipeline, /findDwgNormalizedDocument/);
  assert.match(analyzer, /normalizedDwg/);
  assert.match(analyzer, /document\.dimensions\.length/);
  assert.match(analyzer, /document\.objects\.length/);
});
