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

test("Jyoti profile derives starter queue from the existing interior scene evidence", () => {
  const profile = fs.readFileSync(
    "project-profiles/studio-source-profiles.ts",
    "utf8",
  );
  assert.match(profile, /jyotiRoomSheetTemplate/);
  assert.match(profile, /jyotiInteriorScene\.rooms/);
  assert.match(profile, /unit\.id\.includes\("101"\)/);
  assert.match(profile, /roomSheetTemplate: jyotiRoomSheetTemplate/);
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
  assert.match(studio, /nextMappedKeys/);
  assert.match(studio, /nextRow/);
  assert.match(canvas, /roomStamp\?:/);
  assert.match(canvas, /latest\.current\.roomStamp\?\.enabled/);
  assert.match(canvas, /width: Number\(stamp\.width\.toFixed\(3\)\)/);
  assert.match(canvas, /Click or tap once to place the exact room-sheet size/);
});
