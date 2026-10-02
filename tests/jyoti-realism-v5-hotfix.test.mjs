import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("common FBX source materials have explicit original diffuse tints", () => {
  const realism = read("packages/model-profiles/src/referenceMaterials.ts");
  for (const token of [
    "frontcolor: 0xffffff",
    "color_004: 0x8e8e8e",
    "color_a06: 0xc29b7a",
    "translucent_glass_blue: 0x626b68",
    "color_m06: 0x565656",
    "color_m00: 0xffffff",
    "metal_panel: 0x8f9d9e",
    "slate: 0x666e6c",
  ]) assert.match(realism, new RegExp(token));
});

test("texture attachment preserves source tint instead of forcing white", () => {
  const realism = read("packages/model-profiles/src/referenceMaterials.ts");
  assert.match(realism, /targetTint/);
  assert.match(realism, /material\.color\.setHex\(tint\)/);
  assert.doesNotMatch(realism, /target\.color\.setHex\(0xffffff\)/);
});

test("no generic circular floor can cover the real plot from aerial cameras", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const environment = read("apps/public/src/viewer/siteEnvironment.ts");
  assert.doesNotMatch(viewer, /CircleGeometry/);
  assert.doesNotMatch(environment, /CircleGeometry/);
});

test("V5 migration documents the exact visual regression fix", () => {
  const migration = read("database/migrations/0012_jyoti_realism_v5_hotfix.sql");
  assert.match(migration, /source-color-realism/);
  assert.match(migration, /restore-fbx-diffuse-tints/);
  assert.match(migration, /remove-duplicate-circular-ground/);
  assert.match(migration, /No Platform\/customer website resources are modified/);
});
