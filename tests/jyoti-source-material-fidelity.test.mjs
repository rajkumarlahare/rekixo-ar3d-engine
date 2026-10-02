import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("viewer ships textures extracted from the supplied SKB as a lazy asset", () => {
  const textures = JSON.parse(
    read("project-profiles/reference-source-v9/source-textures.json"),
  );
  for (const key of [
    "Metal_Panel",
    "Color_A06",
    "Tile_Canvas",
    "Slate",
    "Concrete_Pavers_Block_Multi",
    "Marble_Carrara_Floor_Tile",
    "Roofing_Slate_Tan",
    "Tile_Ceramic_Multi",
    "Granite_Tile",
  ]) {
    assert.equal(typeof textures[key], "string", key);
    assert.match(textures[key], /^data:image\/jpeg;base64,/);
  }
  assert.equal(
    fs.existsSync("apps/public/src/viewer/sourceTextureData.ts"),
    false,
  );
});

test("architectural model reapplies source textures to GLB material names", () => {
  const realism = read("packages/model-profiles/src/referenceMaterials.ts");
  assert.match(realism, /source-textures\.json\?url/);
  assert.match(realism, /sourceTextureData/);
  assert.match(realism, /TextureLoader/);
  assert.match(realism, /texture\.flipY = false/);
  assert.match(realism, /name === "frontcolor"/);
  assert.match(realism, /name === "color_m06"/);
  assert.match(realism, /name === "color_a06"/);
  assert.match(realism, /glass\|window\|translucent/);
});
