import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adminGeo = fs.readFileSync("apps/admin/src/geo/GeoIntegratedAuthoringMap.tsx", "utf8");
const publicGeo = fs.readFileSync("apps/public/src/geo/GeoPublicDemo.tsx", "utf8");

test("Geo WebGL overlays preserve Google shared-context depth/scissor state and redraw after map idle", () => {
  for (const source of [adminGeo, publicGeo]) {
    assert.match(source, /renderer\.autoClear\s*=\s*false/);
    assert.match(source, /renderer\.autoClearDepth\s*=\s*false/);
    assert.match(source, /gl\.disable\(gl\.SCISSOR_TEST\)/);
    assert.match(source, /addListener\("idle",\s*\(\)\s*=>\s*\{\s*overlay\?\.requestRedraw\(\);/s);
    assert.doesNotMatch(source, /gl\.flush\(\)/);
  }
});
