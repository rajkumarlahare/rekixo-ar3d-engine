import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("apps/public/src/geo/GeoPublicDemo.tsx", "utf8");
const css = fs.readFileSync("apps/public/src/geo/geo-public-demo.css", "utf8");

test("public Geo owns fullscreen so customer controls remain visible", () => {
  assert.match(source, /fullscreenControl:\s*false/);
  assert.match(source, /requestFullscreen/);
  assert.match(source, /document\.exitFullscreen/);
  assert.match(source, /fullscreenchange/);
  assert.match(source, /geo-fullscreen-toggle/);
  assert.match(source, /ref=\{sceneRef\}/);
});

test("fullscreen and mobile CSS preserve map and camera controls", () => {
  assert.match(css, /\.geo-integrated-scene:fullscreen/);
  assert.match(css, /\.geo-fullscreen-toggle/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.geo-camera-toolbar\s*\{[\s\S]*?top:\s*68px/);
});
