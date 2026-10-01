import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("rebuildable Geo derivatives use content-addressed immutable URLs", () => {
  const runtime = read("workers/release-runtime.mjs");

  assert.match(runtime, /cacheControl: "public, max-age=31536000, immutable"/);
  assert.match(runtime, /derivative\.metadata\.geoSha256/);
  assert.match(runtime, /&geo=\$\{encodeURIComponent\(derivative\.metadata\.geoSha256\)\}/);
});

test("Geo derivative pipeline emits explicit normals after simplification", () => {
  const builder = read("scripts/build-geo-model-derivative.mjs");

  assert.match(builder, /normals\(\{ overwrite: true \}\)/);
  assert.match(builder, /sanitizeExplicitNormals\(document\)/);
  assert.match(builder, /normal\.setElement\(index, \[0, 1, 0\]\)/);
});
