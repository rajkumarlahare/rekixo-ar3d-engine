import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const retired = [
  "apps/admin/src/studio/StudioOverview.tsx",
  "apps/admin/src/studio/StudioPublish.tsx",
  "apps/admin/src/studio/StudioSources.tsx",
  "apps/admin/src/studio/useStudioCloudState.ts",
];

const retained = [
  "apps/admin/src/source-pack/SourcePackReview.tsx",
  "apps/admin/src/studio/PresentationCanvas.tsx",
  "apps/admin/src/studio/PublishedViewer.tsx",
  "apps/admin/src/studio/StudioEvidence.tsx",
  "apps/admin/src/studio/readiness.ts",
  "apps/admin/src/studio/cloud.ts",
  "apps/admin/src/studio/autoBuildPipeline.ts",
  "apps/admin/src/geo/GeoMapper3D.tsx",
];

test("detached legacy Studio operations wrappers stay retired", () => {
  for (const path of retired)
    assert.equal(fs.existsSync(path), false, `${path} must stay retired`);
});

test("Automatic Engine, evidence, release, cloud and Geo foundations stay present", () => {
  for (const path of retained)
    assert.equal(fs.existsSync(path), true, `${path} is a retained foundation`);
});

test("production Admin entry remains Automatic Engine / Source Pack", () => {
  const main = fs.readFileSync("apps/admin/src/main.tsx", "utf8");
  assert.match(main, /SourcePackReview/);
  assert.match(main, /\/3Dprojects\/source-pack/);
  assert.match(main, /function LegacyStudioRedirect\(\)/);
  assert.doesNotMatch(main, /StudioOverview|StudioPublish|StudioSources|useStudioCloudState/);
});
