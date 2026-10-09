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

test("public Geo customer chrome hides authoring metadata and keeps map-level customer actions", () => {
  assert.match(
    publicGeoCss,
    /\.jio-public-meta,\s*\.geo-runtime-note\s*\{\s*display:\s*none\s*!important;/s,
  );
  assert.doesNotMatch(publicGeoSource, /INTEGRATED 3D GEO EXPERIENCE|Enter building|Open location/);
  assert.match(publicGeoSource, /className="geo-camera-toolbar"/);
  assert.match(publicGeoSource, /className="geo-building-link"/);
  assert.match(publicGeoSource, /Building <span aria-hidden="true">↗<\/span>/);
});

test("public Geo header remains responsive and premium without exposing internals", () => {
  assert.match(publicGeoCss, /\.jio-public-header\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;[\s\S]*box-shadow:\s*none;/);
  assert.match(publicGeoCss, /\.jio-public-header::before/);
  assert.match(publicGeoCss, /\.geo-building-link:hover/);
  assert.match(publicGeoCss, /\.geo-camera-toolbar\s*\{[\s\S]*right:\s*14px;/);
  assert.match(publicGeoCss, /backdrop-filter:\s*blur\(14px\)/);
  assert.match(publicGeoCss, /@media \(max-width:\s*640px\)/);
});
