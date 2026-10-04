import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync("apps/public/index.html", "utf8");
const runtime = fs.readFileSync("apps/public/src/client-showcase.ts", "utf8");
const css = fs.readFileSync("apps/public/src/client-showcase.css", "utf8");
const environment = fs.readFileSync(
  "apps/public/src/viewer/siteEnvironment.ts",
  "utf8",
);
const camera = fs.readFileSync("apps/public/src/viewer/viewerCamera.ts", "utf8");
const realism = fs.readFileSync("apps/public/src/viewer/realism.ts", "utf8");

test("public client showcase is wired into the customer runtime", () => {
  assert.match(index, /client-showcase\.css/);
  assert.match(index, /client-showcase\.ts/);
  assert.match(runtime, /Source pending/);
  assert.match(runtime, /client-module-nav--single/);
  assert.match(runtime, /client-location-card/);
  assert.match(runtime, /google\.com\/maps\/search/);
  assert.match(runtime, /client-hero-overlay/);
  assert.doesNotMatch(runtime, /innerHTML\s*=/);
});

test("exterior-only customer presentation hides empty and technical surfaces", () => {
  assert.match(runtime, /production-badge/);
  assert.match(runtime, /source-note/);
  assert.match(runtime, /media-placeholder/);
  assert.match(runtime, /\["walk", "explode", "section"\]/);
  assert.match(css, /\.client-module-nav--single/);
  assert.match(css, /\.client-showcase \.source-note/);
  assert.match(css, /\.client-hero-overlay/);
  assert.match(css, /\.client-location-card/);
});

test("viewer supplies a clearly non-authoritative presentation environment when site data is absent", () => {
  assert.match(environment, /sourceBackedSiteElementCount/);
  assert.match(environment, /presentationOnly = true/);
  assert.match(environment, /nonAuthoritative = true/);
  assert.match(environment, /Presentation road/);
  assert.match(environment, /Presentation sidewalk/);
  assert.match(environment, /Presentation lawn left/);
  assert.match(environment, /Presentation driveway/);
  assert.match(environment, /addTree/);
  assert.match(environment, /addPlant/);
  assert.match(environment, /addLamp/);
  assert.doesNotMatch(environment, /jyoti|paradise/i);
});

test("launch camera and material polish stay project-neutral", () => {
  assert.match(camera, /MAX_ARCHITECTURAL_ELEVATION_RATIO/);
  assert.match(camera, /reduceTopDownLaunchAngle/);
  assert.match(camera, /target, azimuth and distance/);
  assert.match(realism, /gentlyWarmUntexturedSurface/);
  assert.match(realism, /Missing texture bytes are not fabricated/);
  assert.doesNotMatch(camera, /jyoti|paradise/i);
  assert.doesNotMatch(realism, /jyoti|paradise/i);
});
