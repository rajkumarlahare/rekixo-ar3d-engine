import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Studio editor keeps the default toolbar operator-first", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(studio, /aria-label="3D editor tools"/);
  assert.match(studio, /aria-label="Editor mode"/);
  assert.match(studio, /\["building", "Building"\]/);
  assert.match(studio, /\["rooms", "Interior"\]/);
  assert.match(studio, /\["walk", "Walk"\]/);
  assert.match(studio, /<summary>View /);
  assert.match(studio, /<summary>Edit /);
  assert.match(studio, /<summary>Floor /);
  assert.match(studio, /Focus <kbd>F<\/kbd>/);

  for (const label of ["Perspective", "Top", "Section"])
    assert.match(studio, new RegExp(`\\b${label}\\b`));

  for (const label of ["Move", "Rotate", "Scale", "Undo", "Redo"])
    assert.match(studio, new RegExp(`${label}`));

  assert.match(studio, /Snap \{transformSnap \? "On" : "Off"\}/);
  assert.match(studio, /aria-label="Isolate floor"/);
});

test("advanced editor capabilities stay available but collapsed by default", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");

  for (const label of [
    "Project utilities",
    "Advanced model structure",
    "Source files",
    "Model properties",
    "More properties",
    "Source & verification",
    "Model binding",
    "Room actions",
    "Model scale",
    "Materials",
    "Fine tune",
    "Review & versions",
  ])
    assert.match(studio, new RegExp(`<summary>${label}<\\/summary>`));

  assert.match(studio, /className="room-object-details"/);
  assert.match(studio, /view === "rooms" && showAssetShelf/);
  assert.match(studio, /showReferenceWorkspace && \(/);
  assert.match(studio, /aria-label="Plan alignment mode"/);
  assert.match(studio, /<strong>Plan alignment<\/strong>/);
});

test("simplified editor chrome is keyboard-visible and responsive", () => {
  const css = read("apps/admin/src/studio/studio-editor-core.css");

  assert.match(css, /\/\* Phase 2 simplified operator editor \*\//);
  assert.match(css, /\.editor-tool-menu > summary:focus-visible/);
  assert.match(css, /\.editor-sidebar-details > summary:focus-visible/);
  assert.match(css, /\.room-object-details > summary:focus-visible/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /grid-template-columns: repeat\(3, 1fr\)/);
  assert.match(css, /width: min\(230px, calc\(100vw - 18px\)\)/);
});
