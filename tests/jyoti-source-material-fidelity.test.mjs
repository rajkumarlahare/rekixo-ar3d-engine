import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("viewer ships textures extracted from the supplied SKB", () => {
  const textures = read("apps/public/src/viewer/sourceTextureData.ts");
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
    assert.match(textures, new RegExp(`"${key}"`));
  }
  assert.match(textures, /data:image\/jpeg;base64/);
});

test("architectural model reapplies source textures to GLB material names", () => {
  const realism = read("apps/public/src/viewer/referenceSourceV9Materials.ts");
  assert.match(realism, /sourceTextureData/);
  assert.match(realism, /TextureLoader/);
  assert.match(realism, /texture\.flipY = false/);
  assert.match(realism, /name === "frontcolor"/);
  assert.match(realism, /name === "color_m06"/);
  assert.match(realism, /name === "color_a06"/);
  assert.match(realism, /glass\|window\|translucent/);
});
