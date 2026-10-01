import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const builder = fs.readFileSync("scripts/build-geo-model-derivative.mjs", "utf8");
const runtime = fs.readFileSync("workers/release-runtime.mjs", "utf8");

test("Geo derivative v3 keeps Google-safe explicit normals and source PBR materials", () => {
  assert.match(builder, /pipeline: "core-map-v3"/);
  assert.match(runtime, /metadata\?\.pipeline !== "core-map-v3"/);

  assert.doesNotMatch(builder, /palette\s*\(/);
  assert.doesNotMatch(builder, /getAttribute\("NORMAL"\)\?\.dispose\(\)/);
  assert.match(builder, /getAttribute\("NORMAL"\)/);
  assert.match(builder, /primitivesWithoutNormals !== 0/);
  assert.match(builder, /primitivesWithNormals !== stats\.primitives/);
  assert.match(builder, /sourceTextureCount === 0 && stats\.textures !== 0/);
  assert.match(builder, /materialStrategy: "source-pbr"/);
  assert.match(builder, /syntheticPaletteTexture: false/);
});

test("Geo derivative v3 URL changes whenever rebuilt bytes change", () => {
  assert.match(runtime, /max-age=31536000, immutable/);
  assert.match(runtime, /&geo=\\\$\\\{encodeURIComponent\\\(derivative\\\.metadata\\\.geoSha256\\\)\\\}/);
});

test("Geo derivative v3 stays bounded and triangle-only", () => {
  assert.match(builder, /chosen\.bytes\.byteLength > 8_000_000/);
  assert.match(builder, /bytes\.byteLength <= 6_000_000/);
  assert.match(builder, /stats\.meshes <= 120/);
  assert.match(builder, /stats\.meshes > 180/);
  assert.match(builder, /primitive\.getMode\(\) !== 4/);
  assert.match(builder, /stats\.nonTrianglePrimitives !== 0/);
  assert.match(builder, /center\(\{ pivot: "below" \}\)/);
});

test("textureless source drops only texture-dependent dead attributes", () => {
  assert.match(builder, /if \(!hasTextures\)/);
  assert.match(builder, /getAttribute\("TANGENT"\)\?\.dispose\(\)/);
  assert.match(builder, /semantic\.startsWith\("TEXCOORD_"\)/);
  assert.doesNotMatch(builder, /getAttribute\("NORMAL"\).*dispose/);
});
