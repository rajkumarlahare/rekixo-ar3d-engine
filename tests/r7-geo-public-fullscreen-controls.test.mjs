import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const helper = fs.readFileSync("apps/public/src/geo/fullscreen-controls.ts", "utf8");
const css = fs.readFileSync("apps/public/src/geo/fullscreen-controls.css", "utf8");
const html = fs.readFileSync("apps/public/index.html", "utf8");

test("public Geo mirrors camera controls into Google native fullscreen", () => {
  assert.match(helper, /fullscreenchange/);
  assert.match(helper, /document\.fullscreenElement/);
  assert.match(helper, /cloneNode\(true\)/);
  assert.match(helper, /sourceButtons\[index\]\?\.click\(\)/);
  assert.match(helper, /geo-camera-toolbar--fullscreen-clone/);
});

test("mobile camera strip stays below Google Map\/Satellite controls", () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?top:\s*68px\s*!important/);
  assert.match(css, /z-index:\s*2147483646\s*!important/);
});

test("fullscreen bridge assets are loaded by the public shell", () => {
  assert.match(html, /\/src\/geo\/fullscreen-controls\.css/);
  assert.match(html, /\/src\/geo\/fullscreen-controls\.ts/);
});
