import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Smart Project Builder keeps the source-to-draft analysis workflow reusable", () => {
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");
  assert.match(builder, /UNIVERSAL SOURCE DROP/);
  assert.match(builder, /Analyze project/);
  assert.match(builder, /Build automatically/);
  assert.match(builder, /Build analyzed draft/);
  assert.match(analyzer, /inferFloorCandidates/);
  assert.match(analyzer, /suggestNodeFloorAssignments/);
  assert.match(analyzer, /suggestArchitecturalCandidates/);
  assert.match(analyzer, /auditCadSources/);
  assert.match(builder, /Architectural candidate detection/);
  assert.match(builder, /Apply .* confident labels/);
});

test("Smart analyzer keeps ambiguous geometry in review instead of inventing semantics", () => {
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");
  const smartDraft = read("apps/admin/src/studio/smartDraftBuilder.ts");
  assert.match(analyzer, /reason: "multi-floor"/);
  assert.match(analyzer, /reason: "outside"/);
  assert.match(analyzer, /confidence >= 0\.78/);
  assert.match(smartDraft, /assignment\.confidence < 0\.62/);
});

test("builder metadata stays authoring-only in public Studio snapshots", () => {
  const sanitizer = read("workers/studio-draft-validation.mjs");
  assert.match(sanitizer, /export function publicStudioSnapshot/);
  assert.match(sanitizer, /referenceLayers: \[\]/);
  assert.match(sanitizer, /modelNodeTags: \[\]/);
  assert.doesNotMatch(sanitizer, /referenceUrl:/);
  assert.doesNotMatch(sanitizer, /brief:/);
});

test("architectural automation stays suggestion-first", () => {
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");
  assert.match(analyzer, /kind: SmartArchitecturalKind/);
  assert.match(analyzer, /confidence:/);
  assert.match(analyzer, /source name\/material says door/);
  assert.match(analyzer, /source name\/material says window/);
  assert.match(analyzer, /thin vertical storey-scale geometry/);
});

test("CAD intake keeps raw DWG fail-closed until its source-bound normalized derivative exists", () => {
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");
  const dxf = read("apps/admin/src/studio/dxfArchitecture.ts");
  assert.match(analyzer, /extension === "dwg"/);
  assert.match(analyzer, /findDwgNormalizedDocument/);
  assert.match(analyzer, /controlled normalized architecture derivative is not available yet/);
  assert.match(analyzer, /semanticReady: false/);
  assert.match(analyzer, /normalizedDwg: document/);
  assert.match(analyzer, /parseAsciiDxfArchitecture\(text\)/);
  assert.match(dxf, /firstString\(entity\.rows, 8\)/);
  assert.match(dxf, /metresPerUnit/);
});

test("generic builder keeps web model and plan alignment independent from project profiles", () => {
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");
  const pipeline = read("apps/admin/src/studio/autoBuildPipeline.ts");
  assert.match(builder, /WEB MODEL READY/);
  assert.match(builder, /Align floor plan →/);
  assert.match(builder, /Build automatically/);
  assert.doesNotMatch(builder, /quickSetupAuthoringModelReady/);
  assert.match(pipeline, /scene\.publishModelId/);
  assert.match(pipeline, /scene\.modelId/);
});

test("FBX texture warning follows the selected authoring model only", () => {
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");
  assert.match(builder, /audit\.assetId === project\.scene\.modelId/);
  assert.match(builder, /Selected FBX external textures incomplete/);
});

test("completed smart draft is explicit and rebuild stays advanced", () => {
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");
  assert.match(builder, /const draftBuilt =/);
  assert.match(builder, /Draft built ✓/);
  assert.match(builder, /Draft options/);
  assert.match(builder, /Rebuild draft/);
  assert.match(builder, /draftBuilt \|\|/);
});
