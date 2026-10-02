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

test("Studio editor never traps the operator in full screen", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const css = read("apps/admin/src/studio/studio-editor-core.css");

  assert.match(studio, /const \[editorFocus, setEditorFocus\] = useState\(false\)/);
  assert.doesNotMatch(studio, /setEditorFocus\(true\);/);
  assert.match(studio, /event\.key === "Escape" && editorFocus/);
  assert.match(studio, /className="editor-fullscreen-exit"/);
  assert.match(studio, /Exit full screen <kbd>Esc<\/kbd>/);
  assert.match(css, /\.editor-fullscreen-exit/);
});

test("advanced editor capabilities stay available but collapsed by default", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const materials = read("apps/admin/src/studio/MaterialQuickEditor.tsx");

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
    "Review & versions",
  ])
    assert.match(studio, new RegExp(`<summary>${label}<\\/summary>`));

  assert.match(materials, /<summary>Materials<\/summary>/);
  assert.match(materials, /<summary>Fine tune material<\/summary>/);
  assert.match(studio, /<MaterialQuickEditor/);
  assert.match(studio, /className="room-object-details"/);
  assert.match(studio, /view === "rooms" && showAssetShelf/);
  assert.match(studio, /showReferenceWorkspace \? "editor-core--alignment" : ""/);
  assert.match(studio, /aria-label="Plan alignment tools"/);
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
