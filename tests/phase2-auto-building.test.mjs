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

const repeat = await import(
  asUrl(compile("apps/admin/src/studio/repeatedFloorDetector.ts"))
);
const graph = await import(
  asUrl(compile("apps/admin/src/studio/architectureGraph.ts"))
);
const sketch = await import(
  asUrl(compile("apps/admin/src/studio/sketchUpArchive.ts"))
);
const dwg = await import(
  asUrl(compile("apps/admin/src/studio/dwgEvidence.ts"))
);
const dxf = await import(
  asUrl(compile("apps/admin/src/studio/dxfArchitecture.ts"))
);
const autoRooms = await import(
  asUrl(compile("apps/admin/src/studio/autoRoomDraft.ts"))
);
const sourceConflicts = await import(
  asUrl(compile("apps/admin/src/studio/sourceConflicts.ts"))
);
const autoReview = await import(
  asUrl(compile("apps/admin/src/studio/autoBuildingReview.ts"))
);
const materialResolver = await import(
  asUrl(compile("apps/admin/src/studio/sketchUpMaterialResolver.ts"))
);
const openingWorkflow = await import(
  asUrl(compile("apps/admin/src/studio/openingWorkflow.ts"))
);

function analysisFixture() {
  return {
    createdAt: new Date().toISOString(),
    sources: [],
    modelAssetId: "model",
    modelName: "building.fbx",
    meshCount: 12,
    materialCount: 2,
    floorCandidates: [
      { elevation: 0, confidence: 0.9, evidenceCount: 5 },
      { elevation: 3, confidence: 0.9, evidenceCount: 5 },
      { elevation: 6, confidence: 0.9, evidenceCount: 2 },
    ],
    nodeAssignments: [
      { nodeName: "Wall 101", occurrence: 1, floorIndex: 0, confidence: 0.9, reason: "floor" },
      { nodeName: "Door 101", occurrence: 1, floorIndex: 0, confidence: 0.9, reason: "floor" },
      { nodeName: "Wall 201", occurrence: 2, floorIndex: 1, confidence: 0.9, reason: "floor" },
      { nodeName: "Door 201", occurrence: 2, floorIndex: 1, confidence: 0.9, reason: "floor" },
      { nodeName: "Roof", occurrence: 1, floorIndex: 2, confidence: 0.9, reason: "floor" },
    ],
    architecturalCandidates: [
      {
        nodeName: "Wall 101",
        occurrence: 1,
        kind: "wall",
        confidence: 0.93,
        floorIndex: 0,
        position: [2, 1.4, 0],
        size: [4, 2.8, 0.18],
        reasons: ["wall-like proportions"],
      },
      {
        nodeName: "Wall 201",
        occurrence: 2,
        kind: "wall",
        confidence: 0.93,
        floorIndex: 1,
        position: [2, 4.4, 0],
        size: [4, 2.8, 0.18],
        reasons: ["wall-like proportions"],
      },
    ],
    cadAudits: [],
    highConfidenceAssignments: 5,
    reviewAssignments: 0,
    commonAssignments: 0,
    externalTextureRefs: 0,
    matchedTextureRefs: 0,
    issues: [],
  };
}

test("Phase 2 detects repeated floors from project-neutral geometry fingerprints", () => {
  const analysis = analysisFixture();
  const score = repeat.repeatedFloorSimilarity(analysis, 0, 1);
  assert.ok(score >= 0.86, `expected repeated floor score, got ${score}`);
  const groups = repeat.detectRepeatedFloors(analysis);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceFloorIndex, 0);
  assert.equal(groups[0].members[0].floorIndex, 1);
  assert.ok(groups[0].confidence >= 0.86);
});

test("Phase 2 derives bounded parametric wall segments from high-confidence model evidence", () => {
  const walls = graph.deriveModelWallGraph(
    analysisFixture(),
    [
      { id: "ground", name: "Ground", elevation: 0 },
      { id: "f1", name: "Floor 1", elevation: 3 },
      { id: "roof", name: "Roof", elevation: 6 },
    ],
    1,
    { x: 10, y: 0, z: 5, rotationY: 0 },
  );
  assert.equal(walls.length, 2);
  assert.equal(walls[0].origin, "model-auto");
  assert.equal(walls[0].reviewed, false);
  assert.deepEqual(walls[0].start, [10, 5]);
  assert.deepEqual(walls[0].end, [14, 5]);
  assert.equal(walls[0].floorId, "ground");
  assert.ok(walls[0].thickness >= 0.06);
});

function zipDirectory(names) {
  const encoder = new TextEncoder();
  const chunks = [];
  let centralLength = 0;
  for (const name of names) {
    const bytes = encoder.encode(name);
    const header = new Uint8Array(46 + bytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(28, bytes.length, true);
    header.set(bytes, 46);
    chunks.push(header);
    centralLength += header.length;
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, names.length, true);
  view.setUint16(10, names.length, true);
  view.setUint32(12, centralLength, true);
  view.setUint32(16, 0, true);
  return new Blob([...chunks, end]);
}

test("Phase 2 inspects ZIP-style SKB material/texture evidence without decoding geometry", async () => {
  const blob = zipDirectory([
    "model.dat",
    "materials/Brick.xml",
    "materials/Brick/brick.jpg",
    "preview/thumbnail.png",
  ]);
  const result = await sketch.inspectSketchUpArchive({
    id: "skb",
    projectId: "p",
    name: "model.skb",
    type: "application/octet-stream",
    size: blob.size,
    hash: "a".repeat(64),
    blob,
  });
  assert.equal(result.zipLike, true);
  assert.equal(result.entryCount, 4);
  assert.deepEqual(result.materialDefinitionFiles, ["materials/Brick.xml"]);
  assert.deepEqual(result.textureFiles, ["materials/Brick/brick.jpg"]);
  assert.deepEqual(result.modelFiles, ["model.dat"]);
});

test("Phase 2 DWG evidence scan reports version and architectural strings without claiming geometry", async () => {
  const blob = new Blob([
    "AC1015\0random\0AEC_WALL\0AEC_DOOR\0FIRST FLOOR PLAN\0BEDROOM\0KITCHEN\0",
  ]);
  const result = await dwg.inspectDwgEvidence({
    id: "dwg",
    projectId: "p",
    name: "plan.dwg",
    type: "image/vnd.dwg",
    size: blob.size,
    hash: "b".repeat(64),
    blob,
  });
  assert.equal(result.versionCode, "AC1015");
  assert.match(result.versionLabel, /AutoCAD 2000/);
  assert.ok(result.aecTokens.includes("AEC_WALL"));
  assert.ok(result.aecTokens.includes("AEC_DOOR"));
  assert.ok(result.drawingTextHints.some((item) => /FLOOR PLAN/.test(item)));
});

test("reviewed openings cut real procedural wall pieces and wall graph is cloud-validated", () => {
  const roomRenderer = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasRooms.ts",
    "utf8",
  );
  const sceneCanvas = fs.readFileSync(
    "apps/admin/src/studio/SceneCanvas.tsx",
    "utf8",
  );
  const worker = fs.readFileSync(
    "workers/studio-draft-validation.mjs",
    "utf8",
  );
  const domain = fs.readFileSync(
    "apps/admin/src/studio/domain.ts",
    "utf8",
  );

  assert.match(roomRenderer, /opening\.reviewed/);
  assert.match(roomRenderer, /floorGap/);
  assert.match(roomRenderer, /new T\.BoxGeometry\(pieceLength, pieceHeight, 0\.12\)/);
  assert.match(sceneCanvas, /props\.scene\.openings \?\? \[\]/);
  assert.match(worker, /scene\.walls/);
  assert.match(worker, /Invalid Studio parametric wall/);
  assert.match(domain, /origin: WallOrigin/);
  assert.match(domain, /repeatOfFloorId/);
});


test("Phase 2 auto room draft creates only closed-wall-loop rooms", () => {
  const floor = { id: "f0", name: "Ground", elevation: 0 };
  const wall = (id, start, end) => ({
    id,
    floorId: "f0",
    roomIds: [],
    start,
    end,
    thickness: 0.12,
    height: 2.8,
    reviewed: false,
    origin: "model-auto",
    confidence: 0.95,
  });
  const closed = [
    wall("w1", [0, 0], [4, 0]),
    wall("w2", [4, 0], [4, 3]),
    wall("w3", [4, 3], [0, 3]),
    wall("w4", [0, 3], [0, 0]),
  ];
  const result = autoRooms.deriveAutoRoomDrafts(closed, [floor], "model");
  assert.equal(result.rooms.length, 1);
  assert.equal(result.rooms[0].verified, false);
  assert.equal(result.rooms[0].width, 4);
  assert.equal(result.rooms[0].depth, 3);
  assert.equal(result.rooms[0].sourceAssetId, "model");

  const open = closed.slice(0, 3);
  const openResult = autoRooms.deriveAutoRoomDrafts(open, [floor], "model");
  assert.equal(openResult.rooms.length, 0);
});


function storedZip(name, dataBytes) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const data = new Uint8Array(dataBytes);

  const local = new Uint8Array(30 + nameBytes.length + data.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(8, 0, true);
  localView.setUint32(18, data.length, true);
  localView.setUint32(22, data.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(data, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint32(20, data.length, true);
  centralView.setUint32(24, data.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);

  return new Blob([local, central, end]);
}

test("Phase 2 matches SketchUp material folders to FBX material names and prefers color maps", () => {
  assert.equal(
    materialResolver.materialNameFromArchivePath(
      "materials/[Metal Panel]/Metal_Panel.jpg",
    ),
    "Metal Panel",
  );

  const files = [
    {
      id: "normal",
      projectId: "p",
      name: "Metal_Panel_normal.png",
      type: "image/png",
      size: 1,
      hash: "a".repeat(64),
      blob: new Blob(["n"]),
    },
    {
      id: "base",
      projectId: "p",
      name: "Metal_Panel_basecolor.jpg",
      type: "image/jpeg",
      size: 1,
      hash: "b".repeat(64),
      blob: new Blob(["b"]),
    },
  ];
  const bindings = [
    {
      sourceArchiveId: "skb",
      archivePath: "materials/[Metal Panel]/Metal_Panel_normal.png",
      materialName: "Metal Panel",
      textureAssetId: "normal",
      textureName: "Metal_Panel_normal.png",
      confidence: 0.98,
    },
    {
      sourceArchiveId: "skb",
      archivePath: "materials/[Metal Panel]/Metal_Panel_basecolor.jpg",
      materialName: "Metal Panel",
      textureAssetId: "base",
      textureName: "Metal_Panel_basecolor.jpg",
      confidence: 0.98,
    },
  ];
  const resolved = materialResolver.resolveSketchUpMaterialTexture(
    "Material::Metal_Panel",
    bindings,
    files,
  );
  assert.equal(resolved?.asset.id, "base");
  assert.ok((resolved?.score ?? 0) > 100);
});

test("Phase 2 recovers safe material textures from a ZIP-style SKB", async () => {
  const blob = storedZip("materials/Brick/brick.jpg", [1, 2, 3, 4]);
  const recovered = await sketch.extractSketchUpTextures({
    id: "skb-texture",
    projectId: "p",
    name: "building.skb",
    type: "application/octet-stream",
    size: blob.size,
    hash: "c".repeat(64),
    blob,
  });
  assert.equal(recovered.issues.length, 0);
  assert.equal(recovered.textures.length, 1);
  assert.equal(recovered.textures[0].name, "brick.jpg");
  assert.equal(recovered.textures[0].type, "image/jpeg");
  assert.equal(recovered.textures[0].blob.size, 4);
});

test("Phase 2 builder exposes automatic SketchUp texture recovery", () => {
  const builder = fs.readFileSync(
    "apps/admin/src/studio/SmartProjectBuilder.tsx",
    "utf8",
  );
  const studio = fs.readFileSync(
    "apps/admin/src/studio/Studio.tsx",
    "utf8",
  );
  const recovery = fs.readFileSync(
    "apps/admin/src/studio/sketchUpRecovery.ts",
    "utf8",
  );
  assert.match(builder, /Recover SKB textures/);
  assert.match(studio, /prepareSketchUpTextureRecovery/);
  assert.match(recovery, /extractSketchUpTextures/);
  assert.match(studio, /SketchUp material texture/);
});


test("Phase 2 PDF plan evidence and auto-orientation are wired into alignment", () => {
  const pdfInspector = fs.readFileSync(
    "apps/admin/src/studio/pdfPlanInspector.ts",
    "utf8",
  );
  const fusion = fs.readFileSync(
    "apps/admin/src/studio/sourceFusion.ts",
    "utf8",
  );
  const reference = fs.readFileSync(
    "apps/admin/src/studio/ReferenceWorkspace.tsx",
    "utf8",
  );
  const canvas = fs.readFileSync(
    "apps/admin/src/studio/SceneCanvas.tsx",
    "utf8",
  );

  assert.match(pdfInspector, /getTextContent/);
  assert.match(pdfInspector, /dimensionStrings/);
  assert.match(pdfInspector, /bestPage/);
  assert.match(fusion, /pdf\.plan-page/);
  assert.match(reference, /recommendedPdfPage/);
  assert.match(canvas, /score90 \+ 0\.08 < score0 \? 90 : 0/);
  assert.match(canvas, /90° plan orientation selected automatically/);
});


test("Phase 2 one-click review approves only conservative high-confidence suggestions", () => {
  const scene = {
    floors: [
      { id: "f0", name: "Ground", elevation: 0 },
      {
        id: "f1",
        name: "Floor 1",
        elevation: 3,
        repeatOfFloorId: "f0",
        repeatConfidence: 0.95,
        repeatReviewed: false,
      },
      {
        id: "f2",
        name: "Floor 2",
        elevation: 6,
        repeatOfFloorId: "f0",
        repeatConfidence: 0.88,
        repeatReviewed: false,
      },
    ],
    rooms: [],
    furniture: [],
    walls: [
      {
        id: "ready",
        floorId: "f0",
        roomIds: [],
        start: [0, 0],
        end: [4, 0],
        thickness: 0.12,
        height: 2.8,
        reviewed: false,
        origin: "model-auto",
        confidence: 0.94,
      },
      {
        id: "review",
        floorId: "f0",
        roomIds: [],
        start: [0, 1],
        end: [4, 1],
        thickness: 0.12,
        height: 2.8,
        reviewed: false,
        origin: "model-auto",
        confidence: 0.84,
      },
      {
        id: "manual",
        floorId: "f0",
        roomIds: [],
        start: [0, 2],
        end: [4, 2],
        thickness: 0.12,
        height: 2.8,
        reviewed: false,
        origin: "manual",
        confidence: 1,
      },
    ],
    openings: [],
    scale: 1,
  };

  const counts = autoReview.autoBuildingReviewCounts(scene);
  assert.equal(counts.readyWalls, 1);
  assert.equal(counts.wallReview, 2);
  assert.equal(counts.readyRepeats, 1);
  assert.equal(counts.repeatReview, 1);

  const autoWalls = autoReview.markAutoReadyModelWalls(scene);
  assert.equal(autoWalls.prepared, 1);
  assert.equal(
    autoWalls.scene.walls.find((wall) => wall.id === "ready").reviewed,
    false,
  );
  assert.equal(
    autoWalls.scene.walls.find((wall) => wall.id === "ready").reviewState,
    "auto_ready",
  );

  const autoRepeats = autoReview.markAutoReadyRepeatedFloors(autoWalls.scene);
  assert.equal(autoRepeats.prepared, 1);
  assert.equal(autoRepeats.scene.floors[1].repeatReviewed, false);
  assert.equal(autoRepeats.scene.floors[1].repeatReviewState, "auto_ready");

  const walls = autoReview.approveReadyModelWalls(autoRepeats.scene);
  assert.equal(walls.approved, 1);
  assert.equal(walls.scene.walls.find((wall) => wall.id === "ready").reviewed, true);
  assert.equal(
    walls.scene.walls.find((wall) => wall.id === "ready").reviewState,
    "human_reviewed",
  );
  assert.equal(walls.scene.walls.find((wall) => wall.id === "review").reviewed, false);
  assert.equal(walls.scene.walls.find((wall) => wall.id === "manual").reviewed, false);

  const repeats = autoReview.acceptReadyRepeatedFloors(walls.scene);
  assert.equal(repeats.accepted, 1);
  assert.equal(repeats.scene.floors[1].repeatReviewed, true);
  assert.equal(
    repeats.scene.floors[1].repeatReviewState,
    "human_reviewed",
  );
  assert.equal(repeats.scene.floors[2].repeatReviewed, false);
});

test("Phase 1 auto-build prepares openings without pretending they were human-reviewed", () => {
  const scene = {
    floors: [{ id: "f0", name: "Ground", elevation: 0 }],
    rooms: [
      {
        id: "r0",
        name: "Living",
        floorId: "f0",
        unit: "101",
        x: 2,
        z: 2,
        width: 4,
        depth: 4,
        height: 2.8,
        color: "#ffffff",
        source: "fixture",
        verified: false,
      },
    ],
    furniture: [],
    walls: [],
    openings: [],
    modelNodeTags: [],
    scale: 1,
  };
  const candidate = {
    nodeName: "Door 101",
    occurrence: 1,
    kind: "door",
    confidence: 0.94,
    floorIndex: 0,
    position: [2, 1, 0],
    size: [0.9, 2, 0.12],
    reasons: ["source name says door"],
  };
  const suggestion = {
    key: "Door 101\u00001",
    sourceNodeName: "Door 101",
    sourceOccurrence: 1,
    kind: "door",
    floorId: "f0",
    roomIds: ["r0"],
    position: [2, 1, 0],
    width: 0.9,
    height: 2,
    rotationY: 0,
    wallDistance: 0.05,
    confidence: 0.94,
    ready: true,
    reasons: ["fixture"],
  };

  const automatic = openingWorkflow.applyReadyOpeningWorkflow(
    scene,
    [candidate],
    [suggestion],
    () => "opening-1",
    "auto",
  );
  assert.equal(automatic.prepared, 1);
  assert.equal(automatic.approved, 0);
  assert.equal(automatic.scene.openings.length, 1);
  assert.equal(automatic.scene.openings[0].reviewed, false);
  assert.equal(automatic.scene.openings[0].reviewState, "auto_ready");

  const human = openingWorkflow.applyReadyOpeningWorkflow(
    automatic.scene,
    [candidate],
    [suggestion],
    () => "opening-2",
    "human",
  );
  assert.equal(human.approved, 1);
  assert.equal(human.scene.openings.length, 1);
  assert.equal(human.scene.openings[0].reviewed, true);
  assert.equal(human.scene.openings[0].reviewState, "human_reviewed");

  const automaticRerun = openingWorkflow.applyReadyOpeningWorkflow(
    human.scene,
    [candidate],
    [suggestion],
    () => "opening-3",
    "auto",
  );
  assert.equal(automaticRerun.scene.openings.length, 1);
  assert.equal(automaticRerun.scene.openings[0].reviewed, true);
  assert.equal(
    automaticRerun.scene.openings[0].reviewState,
    "human_reviewed",
  );
  assert.equal(
    automaticRerun.scene.modelNodeTags[0].semanticAssignment,
    "manual",
  );
});

test("Phase 2 fast review UI and public sanitization are fail-closed", () => {
  const builder = fs.readFileSync(
    "apps/admin/src/studio/SmartProjectBuilder.tsx",
    "utf8",
  );
  const studio = fs.readFileSync(
    "apps/admin/src/studio/Studio.tsx",
    "utf8",
  );
  const worker = fs.readFileSync(
    "workers/studio-draft-validation.mjs",
    "utf8",
  );

  assert.match(builder, /Approve \{autoReview\.readyWalls\} ready walls/);
  assert.match(builder, /Accept \{autoReview\.readyRepeats\} repeated floors/);
  assert.match(studio, /approveReadyModelWalls/);
  assert.match(studio, /acceptReadyRepeatedFloors/);
  assert.match(worker, /wall\?\.reviewed === true/);
  assert.match(worker, /floor\.repeatReviewed === true/);
});


test("Phase 2 cross-source queue keeps ambiguity and missing metadata resources reviewable", () => {
  const blob = new Blob(["x"]);
  const files = [
    { id: "a", projectId: "p", name: "one.fbx", type: "application/octet-stream", size: 1, hash: "a".repeat(64), blob },
    { id: "b", projectId: "p", name: "two.fbx", type: "application/octet-stream", size: 1, hash: "b".repeat(64), blob },
    { id: "m", projectId: "p", name: "scene.drs", type: "application/json", size: 1, hash: "c".repeat(64), blob },
  ];
  const items = [
    { assetId: "a", name: "one.fbx", extension: "fbx", kind: "authoring-model", support: "partial", capabilities: ["geometry"], findings: [], warnings: [] },
    { assetId: "b", name: "two.fbx", extension: "fbx", kind: "authoring-model", support: "partial", capabilities: ["geometry"], findings: [], warnings: [] },
    { assetId: "m", name: "scene.drs", extension: "drs", kind: "metadata", support: "partial", capabilities: ["metadata"], findings: [], warnings: [] },
  ];
  const facts = [
    {
      id: "m:refs",
      sourceAssetId: "m",
      key: "metadata.resource-refs",
      value: ["source/missing-model.fbx"],
      confidence: 0.9,
      basis: "metadata",
      status: "observed",
    },
    {
      id: "a:floor",
      sourceAssetId: "a",
      key: "canonical.floor-count",
      value: 5,
      confidence: 0.9,
      basis: "model",
      status: "suggested",
    },
    {
      id: "b:floor",
      sourceAssetId: "b",
      key: "canonical.floor-count",
      value: 6,
      confidence: 0.9,
      basis: "provider",
      status: "suggested",
    },
  ];
  const conflicts = sourceConflicts.detectSourceFusionConflicts(
    files,
    items,
    facts,
    [],
  );
  assert.ok(conflicts.some((entry) => entry.id === "ambiguous-authoring-model"));
  assert.ok(conflicts.some((entry) => entry.id === "conflict:canonical.floor-count"));
  assert.ok(conflicts.some((entry) => entry.id === "missing-model-ref:m"));
});

test("Phase 2 normal builder exposes one-click generic Auto Build and no hash-profile setup panel", () => {
  const builder = fs.readFileSync(
    "apps/admin/src/studio/SmartProjectBuilder.tsx",
    "utf8",
  );
  const studio = fs.readFileSync(
    "apps/admin/src/studio/Studio.tsx",
    "utf8",
  );
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );

  assert.match(builder, /Build automatically/);
  assert.doesNotMatch(builder, /SOURCE LOCK DETECTED/);
  assert.doesNotMatch(builder, /Exact SHA-256 source matches/);
  assert.match(studio, /runAutoBuildPipeline/);
  assert.match(pipeline, /prepareFbxWebModel/);
  assert.match(pipeline, /prepareSketchUpTextureRecovery/);
  assert.match(pipeline, /materialBindings/);
  assert.ok(
    pipeline.indexOf("const recovery = await prepareSketchUpTextureRecovery") <
      pipeline.indexOf("const prepared = await prepareFbxWebModel"),
  );
  const webModel = fs.readFileSync(
    "apps/admin/src/studio/fbxWebModel.ts",
    "utf8",
  );
  assert.match(webModel, /resolveSketchUpMaterialTexture/);
  assert.match(webModel, /browser-fbx-to-glb-v2-material-fusion/);
  assert.match(webModel, /materialTexturesApplied/);
  assert.match(webModel, /unresolvedExternalTextures/);
  assert.doesNotMatch(webModel, /stripTextures/);
  assert.match(pipeline, /buildSmartSceneDraft/);
  assert.match(pipeline, /applyReadyOpeningWorkflow/);
  assert.match(pipeline, /markAutoReadyModelWalls/);
  assert.match(pipeline, /markAutoReadyRepeatedFloors/);
  assert.match(pipeline, /readyWallsPrepared/);
  assert.match(pipeline, /readyRepeatsPrepared/);
  assert.match(pipeline, /"auto"/);
  assert.doesNotMatch(pipeline, /approveReadyModelWalls/);
  assert.doesNotMatch(pipeline, /acceptReadyRepeatedFloors/);
});

test("Phase 2 six-source contract remains generic", () => {
  const fusion = fs.readFileSync(
    "apps/admin/src/studio/sourceFusion.ts",
    "utf8",
  );
  for (const extension of ["fbx", "dwg", "skb", "pdf", "jpg", "drs"])
    assert.match(fusion, new RegExp(extension, "i"));
  assert.doesNotMatch(fusion, /jyoti|project_jyoti|source lock/i);
});


test("Phase 2 parses normalized metre geometry from unit-aware ASCII DXF", () => {
  const source = [
    "0","SECTION","2","HEADER",
    "9","$INSUNITS","70","4",
    "0","ENDSEC",
    "0","SECTION","2","ENTITIES",
    "0","LINE","8","A-WALL","10","0","20","0","11","4000","21","0",
    "0","LWPOLYLINE","8","A-WALL","70","1",
    "10","0","20","0","10","4000","20","0","10","4000","20","3000","10","0","20","3000",
    "0","LINE","8","A-DOOR","10","900","20","0","11","1800","21","0",
    "0","TEXT","8","A-ROOM","10","2000","20","1500","1","LIVING",
    "0","ENDSEC","0","EOF",
  ].join("\n");

  const parsed = dxf.parseAsciiDxfArchitecture(source);
  assert.equal(parsed.ascii, true);
  assert.equal(parsed.unitName, "millimetre");
  assert.equal(parsed.metresPerUnit, 0.001);
  assert.equal(parsed.geometryReady, true);
  assert.ok(parsed.segments.some((segment) => segment.kind === "wall"));
  assert.ok(parsed.segments.some((segment) => segment.kind === "door"));
  assert.deepEqual(parsed.bounds, { min: [0, 0], max: [4, 3] });
  assert.equal(parsed.labels[0].text, "LIVING");
  assert.deepEqual(parsed.labels[0].point, [2, 1.5]);
});

test("Phase 2 CAD wall fallback is fail-closed on ambiguous floors and usable on a single resolved floor", () => {
  const analysis = analysisFixture();
  analysis.architecturalCandidates = [];
  analysis.cadAudits = [{
    assetId: "cad",
    name: "ground-floor.dxf",
    kind: "dxf",
    semanticReady: true,
    layerHints: [{ layer: "A-WALL", kind: "wall" }],
    unitName: "metre",
    metresPerUnit: 1,
    geometryReady: true,
    semanticSegments: [
      { kind: "wall", layer: "A-WALL", start: [0,0], end: [4,0], sourceEntity: "LINE" },
      { kind: "wall", layer: "A-WALL", start: [4,0], end: [4,3], sourceEntity: "LINE" },
      { kind: "wall", layer: "A-WALL", start: [4,3], end: [0,3], sourceEntity: "LINE" },
      { kind: "wall", layer: "A-WALL", start: [0,3], end: [0,0], sourceEntity: "LINE" },
    ],
    textLabels: [],
    note: "normalized",
  }];
  analysis.bounds = { min: [0,0,0], max: [4,3,3] };

  const one = graph.deriveCadWallGraph(
    analysis,
    [{ id: "g", name: "Ground", elevation: 0 }],
    1,
    { x: 0, y: 0, z: 0, rotationY: 0 },
  );
  assert.equal(one.compatible, true);
  assert.equal(one.walls.length, 4);
  assert.ok(one.walls.every((wall) => wall.origin === "cad-auto"));
  assert.ok(one.walls.every((wall) => wall.reviewed === false));

  const ambiguous = graph.deriveCadWallGraph(
    { ...analysis, cadAudits: [{ ...analysis.cadAudits[0], name: "typical.dxf" }] },
    [
      { id: "g", name: "Ground", elevation: 0 },
      { id: "f1", name: "Floor 1", elevation: 3 },
    ],
    1,
  );
  assert.equal(ambiguous.compatible, false);
  assert.equal(ambiguous.walls.length, 0);
});

test("SketchUp archive inspection supports prefixed SKB ZIP payloads", async () => {
  const base = new Uint8Array(await zipDirectory([
    "model.dat",
    "materials/[Basic Tile]/Basic Tile.jpg",
    "materials/[Basic Tile]/material.xml",
  ]).arrayBuffer());
  const prefix = new TextEncoder().encode("SketchUp Model prefixed container header...........................");
  const blob = new Blob([prefix, base]);
  const result = await sketch.inspectSketchUpArchive({
    id: "skb-prefix",
    projectId: "p",
    name: "model.skb",
    type: "application/octet-stream",
    size: blob.size,
    hash: "d".repeat(64),
    blob,
  });
  assert.equal(result.zipLike, true);
  assert.equal(result.entryCount, 3);
  assert.ok(result.textureFiles.includes("materials/[Basic Tile]/Basic Tile.jpg"));
});

test("Phase 2 active Studio path no longer depends on project hash profiles", () => {
  const studio = fs.readFileSync(
    "apps/admin/src/studio/Studio.tsx",
    "utf8",
  );
  const mapper = fs.readFileSync(
    "apps/admin/src/studio/VisualRoomMapper.tsx",
    "utf8",
  );
  const reference = fs.readFileSync(
    "apps/admin/src/studio/ReferenceWorkspace.tsx",
    "utf8",
  );
  const repeatSource = fs.readFileSync(
    "apps/admin/src/studio/unitRepeat.ts",
    "utf8",
  );
  const recovery = fs.readFileSync(
    "apps/admin/src/studio/sketchUpRecovery.ts",
    "utf8",
  );

  assert.doesNotMatch(studio, /quickSourceSetup|detectQuickSourceSetup|source lock|profileRoomSheetRows/i);
  assert.doesNotMatch(mapper, /onPrepareSuggestedLayout|PROJECT/);
  assert.doesNotMatch(reference, /QuickSourceSetup|quickSetup/);
  assert.match(studio, /buildDetectedRepeatPreview/);
  assert.match(studio, /applyDetectedRepeatPlan/);
  assert.match(repeatSource, /buildDetectedRepeatPreview/);
  assert.match(recovery, /canonicalRecoveredTextureName/);
  assert.match(recovery, /auditFbxSources/);
});
