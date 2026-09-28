import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Smart Project Builder exposes the guided source-to-draft workflow", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");

  assert.match(studio, /"builder" \| "overview" \| "editor"/);
  assert.match(studio, /\["builder", "Project Builder"\]/);
  assert.match(studio, /uploadSourcePack/);
  assert.match(studio, /analyzeSmartProject/);
  assert.match(studio, /buildSmartDraft/);
  assert.match(builder, /UNIVERSAL SOURCE DROP/);
  assert.match(builder, /Analyze project/);
  assert.match(builder, /Build smart draft/);
  assert.match(analyzer, /inferFloorCandidates/);
  assert.match(analyzer, /suggestNodeFloorAssignments/);
});

test("Smart analyzer keeps ambiguous geometry in review instead of inventing semantics", () => {
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");
  assert.match(analyzer, /reason: "multi-floor"/);
  assert.match(analyzer, /reason: "outside"/);
  assert.match(analyzer, /confidence >= 0\.78/);

  const studio = read("apps/admin/src/studio/Studio.tsx");
  assert.match(studio, /assignment\.confidence >= 0\.62/);
  assert.match(studio, /Ambiguous\/multi-floor meshes remain unassigned/);
});

test("builder metadata stays authoring-only in public Studio snapshots", () => {
  const publisher = read("workers/release-publish.mjs");
  assert.match(publisher, /delete project\.referenceUrl/);
  assert.match(publisher, /delete project\.brief/);
});
