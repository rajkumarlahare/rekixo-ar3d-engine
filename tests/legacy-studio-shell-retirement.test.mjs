import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const retiredStudioShell = [
  "apps/admin/src/studio/Studio.tsx",
  "apps/admin/src/studio/ArchitectureEditingPanels.tsx",
  "apps/admin/src/studio/FloorRoomReview.tsx",
  "apps/admin/src/studio/FurnitureShelf.tsx",
  "apps/admin/src/studio/RoomNavigationPanel.tsx",
  "apps/admin/src/studio/VisualRoomMapper.tsx",
  "apps/admin/src/studio/studio-editor-core.css",
  "apps/admin/src/studio/studio-operations.css",
  "apps/admin/src/studio/studio-superadmin-theme.css",
];

const retainedFoundations = [
  "apps/admin/src/studio/SceneCanvas.tsx",
  "apps/admin/src/studio/PublishedViewer.tsx",
  "apps/admin/src/studio/fbxWebModel.ts",
  "apps/admin/src/studio/sketchUpRecovery.ts",
  "apps/admin/src/studio/dwgEvidence.ts",
  "apps/admin/src/studio/pdfPlanInspector.ts",
  "apps/admin/src/geo/GeoMapper3D.tsx",
];

test("retired legacy Studio shell stays deleted", () => {
  for (const path of retiredStudioShell) {
    assert.equal(fs.existsSync(path), false, `${path} must stay retired`);
  }
});

test("shared presentation, source-processing, and Geo foundations stay present", () => {
  for (const path of retainedFoundations) {
    assert.equal(fs.existsSync(path), true, `${path} is a retained Engine foundation`);
  }
});

test("production Admin entry remains Automatic Engine only", () => {
  const main = fs.readFileSync("apps/admin/src/main.tsx", "utf8");

  assert.doesNotMatch(main, /import\("\.\/studio\/Studio"\)/);
  assert.match(main, /\/3Dprojects\/source-pack/);
  assert.match(main, /function LegacyStudioRedirect\(\)/);
});
