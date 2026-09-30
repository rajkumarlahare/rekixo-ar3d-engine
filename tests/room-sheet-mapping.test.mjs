import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync("apps/admin/src/studio/roomSheet.ts", "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const roomSheet = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);

test("suggested drafts follow arbitrary model alignment and retain dimensions as a polygon", () => {
  const rows = roomSheet.profileRoomSheetRows([{ key: "living", unit: "101", name: "Living",
    width: 4.954, depth: 3.05, suggestedX: 10, suggestedZ: -5 }], "fixture");
  const transform = { x: 7, y: 3, z: -2, rotationY: 37 };
  const [draft] = roomSheet.createSuggestedRoomDrafts(rows, [], "f1", transform, 1.2);
  const angle = 37 * Math.PI / 180;
  assert.ok(Math.abs(draft.x - (7 + 12 * Math.cos(angle) - 6 * Math.sin(angle))) < 0.001);
  assert.ok(Math.abs(draft.z - (-2 - 12 * Math.sin(angle) - 6 * Math.cos(angle))) < 0.001);
  assert.equal(draft.polygon.length, 4);
  assert.ok(Math.abs(Math.hypot(draft.polygon[1][0] - draft.polygon[0][0],
    draft.polygon[1][1] - draft.polygon[0][1]) - 4.954 * 1.2) < 0.002);
  draft.width += 1; // Operator correction must survive another preparation.
  assert.equal(roomSheet.createSuggestedRoomDrafts(rows, [draft], "f1", transform, 1.2).length, 0);
  assert.equal(draft.verified, false);
});

test("CSV room sheet accepts metric and feet/inches without manual conversion", async () => {
  const csv = [
    "Floor,Flat,Room,Width,Depth,Height,Units,Notes",
    '1,101,Living,4.954,3.050,2.75,m,"Brochure page 2"',
    '1,101,Bed Room,"12 ft 1 in","10 ft 4 in","9 ft",ft,"client sheet"',
  ].join("\n");
  const asset = {
    id: "asset_csv",
    projectId: "project",
    name: "rooms.csv",
    type: "text/csv",
    size: csv.length,
    hash: "a".repeat(64),
    blob: new Blob([csv], { type: "text/csv" }),
  };
  const parsed = await roomSheet.parseRoomSheetAsset(asset);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].unit, "101");
  assert.equal(parsed.rows[0].name, "Living");
  assert.equal(parsed.rows[0].width, 4.954);
  assert.equal(parsed.rows[0].depth, 3.05);
  assert.equal(parsed.rows[1].width, 3.683);
  assert.equal(parsed.rows[1].depth, 3.15);
  assert.equal(parsed.rows[1].height, 2.743);
});

test("CSV room sheet also accepts a single Size column", async () => {
  const csv = [
    "Level,Unit,Room,Size,Units",
    "Typical,102,Kitchen,342x216,cm",
  ].join("\n");
  const asset = {
    id: "asset_size",
    projectId: "project",
    name: "room-sheet.csv",
    type: "text/csv",
    size: csv.length,
    hash: "b".repeat(64),
    blob: new Blob([csv], { type: "text/csv" }),
  };
  const parsed = await roomSheet.parseRoomSheetAsset(asset);
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].width, 3.42);
  assert.equal(parsed.rows[0].depth, 2.16);
});

test("room-sheet markers make mapped/unmapped state reconstructable after reload", () => {
  const row = {
    key: "profile:jyoti:101-living",
    assetId: "brochure",
    assetName: "Jyoti Paradise.pdf",
    rowNumber: 1,
    floorLabel: "Typical",
    unit: "101",
    name: "Living",
    width: 4.95,
    depth: 3.05,
    sourceNote: "Brochure page 2",
    origin: "profile",
  };
  const room = {
    id: "r1",
    name: "Living",
    floorId: "f1",
    unit: "101",
    x: 0,
    z: 0,
    width: 4.95,
    depth: 3.05,
    height: 2.75,
    color: "#cccccc",
    source: roomSheet.roomSheetMarker(row),
    verified: false,
    sourceAssetId: "brochure",
  };
  assert.equal(roomSheet.roomSheetKeyFromRoom(room), row.key);
  assert.deepEqual([...roomSheet.mappedRoomSheetKeys([room])], [row.key]);
});

test("Jyoti profile derives starter queue and suggested centres from existing evidence", () => {
  const profile = fs.readFileSync(
    "project-profiles/studio-source-profiles.ts",
    "utf8",
  );
  assert.match(profile, /jyotiRoomSheetTemplate/);
  assert.match(profile, /jyotiInteriorScene\.rooms/);
  assert.match(profile, /unit\.id\.includes\("101"\)/);
  assert.match(profile, /roomSheetTemplate: jyotiRoomSheetTemplate/);
  assert.match(profile, /suggestedX:/);
  assert.match(profile, /suggestedZ:/);
  assert.match(profile, /sourcePackSourceId:/);
  assert.match(profile, /audit\.architecturalFloorLevelsM/);
  assert.match(profile, /floorSkeleton: jyotiFloorSkeleton/);
  assert.match(profile, /repeatPlan: jyotiRepeatPlan/);
  assert.match(profile, /101 to 501/);
  assert.match(profile, /102 to 502/);
  assert.match(profile, /103 to 403/);
});

test("profile suggested rooms seed once and preserve evidence provenance", () => {
  const sourceAsset = {
    id: "brochure",
    projectId: "project",
    name: "Jyoti Paradise.pdf",
    type: "application/pdf",
    size: 10,
    hash: "c".repeat(64),
    blob: new Blob(["pdf"]),
  };
  const [row] = roomSheet.profileRoomSheetRows(
    [
      {
        key: "101-living",
        floor: "Typical residential floor",
        unit: "101",
        name: "Living",
        width: 4.95,
        depth: 3.05,
        height: 2.75,
        suggestedX: 10,
        suggestedZ: -5,
        sourcePackSourceId: "jyoti-source-brochure",
        sourceNote: "Reconstructed placement from brochure page 2",
      },
    ],
    "jyoti-paradise",
    sourceAsset,
  );

  const rooms = roomSheet.createSuggestedRoomDrafts(
    [row],
    [],
    "floor-1",
    { x: 2, y: 0, z: 3, rotationY: 0 },
    1,
    () => "seed-room",
  );
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].id, "seed-room");
  assert.equal(rooms[0].x, 12);
  assert.equal(rooms[0].z, -2);
  assert.equal(rooms[0].width, 4.95);
  assert.equal(rooms[0].depth, 3.05);
  assert.equal(rooms[0].verified, false);
  assert.equal(rooms[0].sourceAssetId, "brochure");
  assert.equal(rooms[0].sourcePackSourceId, "jyoti-source-brochure");
  assert.equal(roomSheet.roomSheetKeyFromRoom(rooms[0]), row.key);

  const repeated = roomSheet.createSuggestedRoomDrafts(
    [row],
    rooms,
    "floor-1",
    { x: 2, y: 0, z: 3, rotationY: 0 },
    1,
    () => "should-not-be-used",
  );
  assert.equal(repeated.length, 0);
});

test("visual mapper exposes Unmapped Rooms and exact one-click placement", () => {
  const mapper = fs.readFileSync(
    "apps/admin/src/studio/VisualRoomMapper.tsx",
    "utf8",
  );
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");
  const canvas = fs.readFileSync(
    "apps/admin/src/studio/SceneCanvas.tsx",
    "utf8",
  );

  assert.match(mapper, /Unmapped Rooms/);
  assert.match(mapper, /Place exact room/);
  assert.match(mapper, /Click\/tap once on the plan to place exact size/);
  assert.match(studio, /roomMapAction === "stamp"/);
  assert.match(studio, /roomSheetMarker\(sheetRow\)/);
  assert.match(mapper, /Prepare suggested floor/);
  assert.match(studio, /prepareSuggestedTypicalFloor/);
  assert.match(studio, /createSuggestedRoomDrafts/);
  assert.match(studio, /nextMappedKeys/);
  assert.match(studio, /nextRow/);
  assert.match(canvas, /roomStamp\?:/);
  assert.match(canvas, /latest\.current\.roomStamp\?\.enabled/);
  assert.match(canvas, /width: Number\(stamp\.width\.toFixed\(3\)\)/);
  assert.match(canvas, /Click or tap once to place the exact room-sheet size/);
});


test("whole-unit review keeps the fast path while individual correction remains available", () => {
  const review = fs.readFileSync("apps/admin/src/studio/FloorRoomReview.tsx", "utf8");
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");

  assert.match(review, /Accept whole unit/);
  assert.match(review, /onReviewUnit\(activeUnit, true\)/);
  assert.match(review, /Needs correction/);
  assert.match(studio, /onReviewUnit=\{\(unit, accepted\) =>/);
  assert.match(studio, /candidate\.floorId === isolateFloorId && candidate\.unit === unit/);
  assert.match(studio, /verified: accepted/);
});


test("generated floors have one-click floor review while source rooms keep individual correction", () => {
  const review = fs.readFileSync("apps/admin/src/studio/FloorRoomReview.tsx", "utf8");
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");

  assert.match(review, /Generated floor review/);
  assert.match(review, /Accept generated floor/);
  assert.match(review, /onReviewGeneratedFloor\(floorId\)/);
  assert.match(studio, /function reviewGeneratedFloor/);
  assert.match(studio, /isBatchRepeatedRoom\(entry\)/);
  assert.match(studio, /next repeated floor opened for review/);
  assert.match(studio, /analyzeAndApproveReadyOpenings\(next\)/);
});


test("fully reviewed source floor exposes direct repeat rollout action", () => {
  const review = fs.readFileSync("apps/admin/src/studio/FloorRoomReview.tsx", "utf8");
  assert.match(review, /Source floor reviewed/);
  assert.match(review, /Generate repeated floors/);
  assert.match(review, /sourceFloorReviewed/);
  assert.match(review, /repeat\.readyTargets > 0/);
  assert.match(review, /generatedOnFloor\.length === 0/);
  assert.match(review, /rooms\.every\(\(room\) => room\.verified\)/);
});
