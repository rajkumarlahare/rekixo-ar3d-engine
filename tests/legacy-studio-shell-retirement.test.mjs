import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const retiredStudioShell = [
  "apps/admin/src/studio/Studio.tsx",
  "apps/admin/src/studio/ArchitectureEditingPanels.tsx",
  "apps/admin/src/studio/FloorRoomReview.tsx",
  "apps/admin/src/studio/FurnitureShelf.tsx",
  "apps/admin/src/studio/RoomNavigationPanel.tsx",
  "apps/admin/src/studio/VisualRoomMapper.tsx",
  "apps/admin/src/studio/SceneCanvas.tsx",
  "apps/admin/src/studio/SceneCanvasOverlays.tsx",
  "apps/admin/src/studio/ReferenceWorkspace.tsx",
  "apps/admin/src/studio/studio-editor-core.css",
  "apps/admin/src/studio/studio-operations.css",
  "apps/admin/src/studio/studio-superadmin-theme.css",
];

const retainedFoundations = [
  "apps/admin/src/studio/PresentationCanvas.tsx",
  "apps/admin/src/studio/PublishedViewer.tsx",
  "apps/admin/src/studio/fbxWebModel.ts",
  "apps/admin/src/studio/sketchUpRecovery.ts",
  "apps/admin/src/studio/dwgEvidence.ts",
  "apps/admin/src/studio/pdfPlanInspector.ts",
  "apps/admin/src/geo/GeoMapper3D.tsx",
];

test("retired legacy Studio shell stays deleted", () => {
  for (const retiredPath of retiredStudioShell) {
    assert.equal(fs.existsSync(retiredPath), false, `${retiredPath} must stay retired`);
  }
});

test("shared presentation, source-processing, and Geo foundations stay present", () => {
  for (const retainedPath of retainedFoundations) {
    assert.equal(fs.existsSync(retainedPath), true, `${retainedPath} is a retained Engine foundation`);
  }
});

test("production Admin entry remains Automatic Engine only", () => {
  const main = fs.readFileSync("apps/admin/src/main.tsx", "utf8");

  assert.doesNotMatch(main, /import\("\.\/studio\/Studio"\)/);
  assert.match(main, /\/3Dprojects\/source-pack/);
  assert.match(main, /function LegacyStudioRedirect\(\)/);
});

test("test contracts do not read retired Studio shell files", () => {
  const self = path.basename(import.meta.filename ?? "legacy-studio-shell-retirement.test.mjs");
  const testFiles = fs.readdirSync("tests").filter((name) => name.endsWith(".test.mjs") && name !== self);

  for (const testFile of testFiles) {
    const source = fs.readFileSync(path.join("tests", testFile), "utf8");
    // Absence assertions are valid retirement guards, not dependencies. Strip those
    // single-line checks before looking for stale test fixtures that still read a
    // retired implementation as executable/source input.
    const dependencySource = source
      .split("\n")
      .filter((line) => !line.includes("existsSync("))
      .join("\n");

    for (const retiredPath of retiredStudioShell) {
      assert.equal(
        dependencySource.includes(retiredPath),
        false,
        `${testFile} must not read retired ${retiredPath}`,
      );
    }
  }
});
