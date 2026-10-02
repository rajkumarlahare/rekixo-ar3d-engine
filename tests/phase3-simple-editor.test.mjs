import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const domainStub = asUrl(`
export const catalog = {
  sofa: { name: "Sofa", width: 2.1, depth: 0.85, height: 0.8, color: "#b9a58d" },
  bed: { name: "Double bed", width: 1.6, depth: 2, height: 0.55, color: "#d9d3c4" },
  table: { name: "Table", width: 1.1, depth: 0.65, height: 0.7, color: "#93684c" },
  wardrobe: { name: "Wardrobe", width: 1.5, depth: 0.6, height: 2.1, color: "#8b6d58" },
  plant: { name: "Plant", width: 0.45, depth: 0.45, height: 1, color: "#587958" },
};
export function roomContainsPoint(room, x, z, margin = 0) {
  const minX = room.x - room.width / 2 + margin;
  const maxX = room.x + room.width / 2 - margin;
  const minZ = room.z - room.depth / 2 + margin;
  const maxZ = room.z + room.depth / 2 - margin;
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}
`);
const placementCode = compile("apps/admin/src/studio/furniturePlacement.ts")
  .replace(/from "\.\/domain"/, `from ${JSON.stringify(domainStub)}`);
const placement = await import(asUrl(placementCode));

const presets = await import(
  asUrl(compile("apps/admin/src/studio/materialPresets.ts"))
);

test("Phase 3 furniture drop solver moves a near-wall request to the nearest safe room position", () => {
  const room = {
    id: "r",
    name: "Living",
    floorId: "f",
    unit: "101",
    x: 0,
    z: 0,
    width: 4,
    depth: 4,
    height: 2.8,
    color: "#ffffff",
    source: "test",
    verified: true,
  };
  const result = placement.findFurniturePlacement(room, "sofa", 1.85, 0);
  assert.ok(result);
  assert.ok(result.x < 1.85);
  assert.equal(
    placement.furnitureFitsAt(
      room,
      "sofa",
      result.x,
      result.z,
      result.rotation,
    ),
    true,
  );
});

test("Phase 3 furniture solver refuses an item that cannot fit the room", () => {
  const room = {
    id: "r",
    name: "Tiny",
    floorId: "f",
    unit: "101",
    x: 0,
    z: 0,
    width: 0.6,
    depth: 0.6,
    height: 2.8,
    color: "#ffffff",
    source: "test",
    verified: true,
  };
  assert.equal(
    placement.findFurniturePlacement(room, "bed", 0, 0),
    undefined,
  );
});

test("Phase 3 material presets provide one-tap architectural finishes", () => {
  assert.ok(presets.MATERIAL_PRESETS.length >= 6);
  assert.equal(
    presets.suggestedMaterialPreset("Translucent_Glass_Blue")?.id,
    "glass",
  );
  assert.equal(
    presets.suggestedMaterialPreset("Metal_Panel")?.id,
    "dark-metal",
  );
  assert.equal(
    presets.suggestedMaterialPreset("Marble_Carrara_Floor_Tile")?.id,
    "stone",
  );
});

test("Phase 3 canvas supports desktop drag/drop and mobile tap placement", () => {
  const canvas = fs.readFileSync(
    "apps/admin/src/studio/SceneCanvas.tsx",
    "utf8",
  );
  const shelf = fs.readFileSync(
    "apps/admin/src/studio/FurnitureShelf.tsx",
    "utf8",
  );
  const studio = fs.readFileSync(
    "apps/admin/src/studio/Studio.tsx",
    "utf8",
  );

  assert.match(canvas, /application\/x-rekixo-furniture/);
  assert.match(canvas, /addEventListener\("dragover"/);
  assert.match(canvas, /addEventListener\("drop"/);
  assert.match(canvas, /furniturePlacement\?\.enabled/);
  assert.match(canvas, /onFurniturePlace/);
  assert.match(shelf, /draggable=/);
  assert.match(shelf, /Drag \/ tap/);
  assert.match(studio, /findFurniturePlacement/);
  assert.match(studio, /furnitureFromPlacement/);
  assert.match(studio, /<FurnitureShelf/);
});

test("Phase 3 material numeric controls are extracted behind fine tune", () => {
  const material = fs.readFileSync(
    "apps/admin/src/studio/MaterialQuickEditor.tsx",
    "utf8",
  );
  const studio = fs.readFileSync(
    "apps/admin/src/studio/Studio.tsx",
    "utf8",
  );
  assert.match(material, /Quick material finishes/);
  assert.match(material, /Fine tune material/);
  assert.match(material, /MATERIAL_PRESETS/);
  assert.match(studio, /<MaterialQuickEditor/);
});
