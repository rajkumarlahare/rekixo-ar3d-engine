import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Smart Project Builder exposes the guided source-to-draft workflow", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");

  assert.match(studio, /"builder" \| "overview" \| "editor"/);
  assert.match(studio, /\["builder", "Setup"\]/);
  assert.match(studio, /aria-label="Project workflow"/);
  assert.match(studio, /uploadSourcePack/);
  assert.match(studio, /analyzeSmartProject/);
  assert.match(studio, /buildSmartDraft/);
  assert.match(builder, /UNIVERSAL SOURCE DROP/);
  assert.match(builder, /Analyze project/);
  assert.match(builder, /Build smart draft/);
  assert.match(analyzer, /inferFloorCandidates/);
  assert.match(analyzer, /suggestNodeFloorAssignments/);
  assert.match(analyzer, /suggestArchitecturalCandidates/);
  assert.match(analyzer, /auditCadSources/);
  assert.match(builder, /Architectural candidate detection/);
  assert.match(builder, /Apply .* confident labels/);
});

test("Smart analyzer keeps ambiguous geometry in review instead of inventing semantics", () => {
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");
  assert.match(analyzer, /reason: "multi-floor"/);
  assert.match(analyzer, /reason: "outside"/);
  assert.match(analyzer, /confidence >= 0\.78/);

  const studio = read("apps/admin/src/studio/Studio.tsx");
  assert.match(studio, /assignment\.confidence < 0\.62/);
  assert.match(studio, /Ambiguous\/multi-floor meshes remain unassigned/);
});

test("builder metadata stays authoring-only in public Studio snapshots", () => {
  const sanitizer = read("workers/studio-draft-validation.mjs");
  assert.match(sanitizer, /export function publicStudioSnapshot/);
  assert.match(sanitizer, /referenceLayers: \[\]/);
  assert.match(sanitizer, /modelNodeTags: \[\]/);
  assert.doesNotMatch(sanitizer, /referenceUrl:/);
  assert.doesNotMatch(sanitizer, /brief:/);
});


test("architectural automation stays suggestion-first and preserves manual labels", () => {
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(analyzer, /kind: SmartArchitecturalKind/);
  assert.match(analyzer, /confidence:/);
  assert.match(analyzer, /source name\/material says door/);
  assert.match(analyzer, /source name\/material says window/);
  assert.match(analyzer, /thin vertical storey-scale geometry/);
  assert.match(studio, /semanticAssignment === "manual"/);
  assert.match(studio, /semanticAssignment: "auto"/);
  assert.match(studio, /const threshold = 0\.82/);
  assert.match(studio, /Review them visually before treating them as architecture/);
});

test("CAD intake does not pretend binary DWG is semantically parsed", () => {
  const analyzer = read("apps/admin/src/studio/projectAnalyzer.ts");
  assert.match(analyzer, /extension === "dwg"/);
  assert.match(analyzer, /Convert\/export to ASCII DXF/);
  assert.match(analyzer, /no CAD semantics were guessed/);
  assert.match(analyzer, /code === "8"/);
});
