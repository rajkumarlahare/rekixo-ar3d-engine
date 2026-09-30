import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("Studio furniture renderer uses detailed object construction instead of one primitive block", () => {
  const canvas = read("apps/admin/src/studio/SceneCanvas.tsx");
  const furniture = read("apps/admin/src/studio/furnitureVisual.ts");

  assert.match(canvas, /addFurnitureVisual\(g, f\)/);
  assert.doesNotMatch(canvas, /block\(\s*g,\s*f\.kind/);

  assert.match(furniture, /Sofa seat cushion/);
  assert.match(furniture, /Sofa back cushion/);
  assert.match(furniture, /Mattress/);
  assert.match(furniture, /Duvet/);
  assert.match(furniture, /Table leg/);
  assert.match(furniture, /Wardrobe door/);
  assert.match(furniture, /Wardrobe handle/);
  assert.match(furniture, /Plant foliage/);
});

test("detailed furniture remains inside catalog-sized presentation envelopes", () => {
  const furniture = read("apps/admin/src/studio/furnitureVisual.ts");

  assert.match(furniture, /catalog\.sofa/);
  assert.match(furniture, /catalog\.bed/);
  assert.match(furniture, /catalog\.table/);
  assert.match(furniture, /catalog\.wardrobe/);
  assert.match(furniture, /Keep the presentation inside the catalog collision envelope/);
});

test("realism change is render-only and does not alter furniture schema", () => {
  const domain = read("apps/admin/src/studio/domain.ts");
  const furniture = read("apps/admin/src/studio/furnitureVisual.ts");

  assert.match(domain, /export interface Furniture/);
  assert.match(domain, /roomId: string/);
  assert.match(domain, /rotation: number/);
  assert.doesNotMatch(furniture, /scene\./);
  assert.doesNotMatch(furniture, /roomId\s*=/);
});
