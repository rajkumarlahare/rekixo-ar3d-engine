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
const autoRooms = await import(
  asUrl(compile("apps/admin/src/studio/autoRoomDraft.ts"))
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
  assert.match(builder, /Recover SKB textures/);
  assert.match(studio, /extractSketchUpTextures/);
  assert.match(studio, /SketchUp material texture/);
});
