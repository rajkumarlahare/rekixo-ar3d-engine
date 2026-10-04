import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 2 keeps the customer viewer full-screen and reduces navigation to launch essentials", () => {
  const css = read("apps/public/src/viewer/walkthrough-ui.css");

  assert.match(css, /Demo Launch Phase 2/);
  assert.match(css, /Building, Floors, Flats, Walk and Info/);
  assert.match(css, /twin-rail-item:nth-child\(1\)[\s\S]*display:\s*none/);
  assert.match(css, /twin-rail-item:nth-child\(4\) strong::after[\s\S]*content:\s*"Flats"/);
  assert.match(css, /twin-rail-item:nth-child\(10\) strong::after[\s\S]*content:\s*"Info"/);
  assert.match(css, /twin-bottom-bar[\s\S]*display:\s*none/);
  assert.match(css, /twin-source-conflicts[\s\S]*display:\s*none/);
});

test("Phase 2 preserves the source-model viewer runtime and customer interaction controls", () => {
  const main = read("apps/public/src/main.tsx");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");

  assert.match(main, /<Viewer3D/);
  assert.match(main, /visualPreset="reference-render"/);
  assert.match(viewer, /OrbitControls/);
  assert.match(viewer, /enablePan\s*=\s*true/);
  assert.match(viewer, /toggleFullscreen/);
  assert.match(viewer, /initialExploded/);
  assert.match(viewer, /initialWalk/);
});
