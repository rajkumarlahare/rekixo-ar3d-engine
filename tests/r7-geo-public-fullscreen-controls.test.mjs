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

test("normal customer page mirrors the live camera controls into the header", () => {
  assert.match(helper, /jio-public-header-camera-slot/);
  assert.match(helper, /geo-camera-toolbar--header-clone/);
  assert.match(helper, /insertAdjacentElement\("afterend", slot\)/);
  assert.match(helper, /MutationObserver/);
  assert.match(css, /grid-template-areas:[\s\S]*?"copy actions"[\s\S]*?"copy cameras"/);
  assert.match(css, /geo-integrated-scene > \.geo-camera-toolbar/);
  assert.match(css, /visibility:\s*hidden\s*!important/);
});

test("mobile puts all five presets directly below the header actions", () => {
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?"copy"[\s\S]*?"actions"[\s\S]*?"cameras"/);
  assert.match(css, /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /geo-camera-toolbar--fullscreen-clone[\s\S]*?top:\s*68px\s*!important/);
});

test("customer camera controls use transparent glass styling", () => {
  assert.match(css, /geo-camera-toolbar--header-clone[\s\S]*?background:\s*transparent\s*!important/);
  assert.match(css, /background:\s*rgba\(8, 22, 32, \.38\)\s*!important/);
  assert.match(css, /backdrop-filter:\s*blur\(9px\)/);
});

test("fullscreen bridge assets are loaded by the public shell", () => {
  assert.match(html, /\/src\/geo\/fullscreen-controls\.css/);
  assert.match(html, /\/src\/geo\/fullscreen-controls\.ts/);
});
