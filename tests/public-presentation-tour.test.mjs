import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../apps/public/index.html", import.meta.url), "utf8");
const tour = fs.readFileSync(new URL("../apps/public/src/presentation-tour.ts", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../apps/public/src/viewer/walkthrough-ui.css", import.meta.url), "utf8");

test("public HTML loads the presentation tour runtime", () => {
  assert.match(index, /presentation-tour\.ts/);
});

test("guided tour follows the launch presentation sequence", () => {
  const project = tour.indexOf('mode: "project"');
  const building = tour.indexOf('mode: "building"');
  const balcony = tour.indexOf('mode: "balcony"');
  const floors = tour.indexOf('mode: "floors"');
  assert.ok(project >= 0 && building > project && balcony > building && floors > balcony);
  assert.match(tour, /label: "Project overview"/);
  assert.match(tour, /label: "Building facade"/);
  assert.match(tour, /label: "Facade detail"/);
  assert.match(tour, /label: "Floor explorer"/);
});

test("tour waits for the real viewer and stops on user interaction", () => {
  assert.match(tour, /viewerReady\(stage\)/);
  assert.match(tour, /\.viewer-loader/);
  assert.match(tour, /addEventListener\("pointerdown", cancelFromUserInput, true\)/);
  assert.match(tour, /addEventListener\("wheel", cancelFromUserInput/);
  assert.match(tour, /addEventListener\("keydown", cancelFromUserInput, true\)/);
});

test("cinematic intro respects reduced-motion and uses semantic rail/camera selection", () => {
  assert.match(tour, /prefers-reduced-motion: reduce/);
  assert.match(tour, /activateRailMode\(stage, "context"\)/);
  assert.match(tour, /activateRailMode\(stage, "building"\)/);
  assert.match(tour, /shot\.kind === "hero"/);
  assert.match(tour, /activateCamera\(stage, "hero"\)/);
});

test("tour UI is project-agnostic and responsive", () => {
  assert.doesNotMatch(tour, /Jyoti|Paradise/i);
  assert.match(ui, /\.twin-tour-control/);
  assert.match(ui, /data-presentation-motion="active"/);
  assert.match(ui, /@media \(max-width: 760px\)/);
});
