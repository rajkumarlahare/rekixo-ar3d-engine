import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("public viewer uses reviewed graph movement and destination mini-map", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const main = read("apps/public/src/main.tsx");
  const css = read("apps/public/src/viewer/walkthrough-ui.css");

  assert.match(viewer, /resolvePublicWalkStep/);
  assert.match(viewer, /publicWalkConnections/);
  assert.match(viewer, /REVIEWED ROOM GRAPH/);
  assert.match(viewer, /CONNECTED ROOMS/);
  assert.match(viewer, /viewer-walk-map__room--connected/);
  assert.match(viewer, /via reviewed door/);
  assert.match(main, /walkthrough=\{experience\.walkthrough\}/);
  assert.match(main, /crosses only approved shared doors/);
  assert.match(css, /\.viewer-walk-graph/);
  assert.match(css, /\.viewer-walk-map/);
});

test("public release projection filters unreviewed and non-door openings", () => {
  const runtime = read("workers/release-runtime.mjs");
  assert.match(runtime, /opening\.reviewed !== true/);
  assert.match(runtime, /opening\.kind !== "door"/);
  assert.match(runtime, /opening\.roomIds\.length !== 2/);
  assert.match(runtime, /publicWalkthroughFromStudio/);
});
