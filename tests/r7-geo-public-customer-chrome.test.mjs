import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const publicGeoSource = fs.readFileSync(
  "apps/public/src/geo/GeoPublicDemo.tsx",
  "utf8",
);
const publicGeoCss = fs.readFileSync(
  "apps/public/src/geo/geo-public-demo.css",
  "utf8",
);

test("public Geo customer chrome hides authoring metadata and technical footer", () => {
  assert.match(
    publicGeoCss,
    /\.jio-public-meta,\s*\.geo-runtime-note\s*\{\s*display:\s*none\s*!important;/s,
  );
  assert.match(publicGeoSource, /INTEGRATED 3D GEO EXPERIENCE/);
  assert.match(publicGeoSource, /Enter building/);
  assert.match(publicGeoSource, /Open location/);
});

test("public Geo header remains responsive and premium without exposing internals", () => {
  assert.match(publicGeoCss, /\.jio-public-header\s*\{[\s\S]*border-radius:\s*20px;/);
  assert.match(publicGeoCss, /\.jio-public-header::before/);
  assert.match(publicGeoCss, /\.jio-public-header-actions a:hover/);
  assert.match(publicGeoCss, /@media \(max-width:\s*640px\)/);
});
