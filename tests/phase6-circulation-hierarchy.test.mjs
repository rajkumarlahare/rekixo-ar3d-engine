import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const hierarchy = fs.readFileSync(
  "apps/admin/src/studio/circulationHierarchy.ts",
  "utf8",
);
const structuralFusion = fs.readFileSync(
  "apps/admin/src/studio/structuralPrimitiveFusion.ts",
  "utf8",
);
const roadmap = fs.readFileSync(
  "docs/FINAL-AUTO-BUILD-PHASES.md",
  "utf8",
);

function transpile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (entry) => entry.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")),
    [],
  );
}

test("R2 circulation hierarchy module transpiles", () => {
  transpile(hierarchy, "circulationHierarchy.ts");
});

test("R2 binds only source-backed stair/lift evidence", () => {
  assert.match(hierarchy, /new Set<CirculationKind>\(\["stair", "lift"\]\)/);
  assert.match(hierarchy, /element\.origin === "model-cad-auto"/);
  assert.match(hierarchy, /typeof element\.sourceRef === "string"/);
  assert.match(structuralFusion, /"stair"/);
  assert.match(structuralFusion, /"lift"/);
  assert.match(structuralFusion, /CAD-only evidence never receives/);
});

test("R2 cross-floor binding is adjacent, spatially guarded, unique, and fail-closed", () => {
  assert.match(hierarchy, /last\.floorIndex === member\.floorIndex - 1/);
  assert.match(hierarchy, /MAX_BIND_SCORE = 0\.58/);
  assert.match(hierarchy, /MIN_UNIQUE_SCORE_GAP = 0\.12/);
  assert.match(hierarchy, /centreDistance > Math\.max\(0\.6, referenceDiagonal \* 0\.42\)/);
  assert.match(hierarchy, /if \(sizeError > 0\.42\)/);
  assert.match(hierarchy, /second\.score - best\.score >= MIN_UNIQUE_SCORE_GAP/);
  assert.match(hierarchy, /ambiguousBindings \+= 1/);
});

test("R2 derives hierarchy metadata without inventing or approving geometry", () => {
  assert.match(hierarchy, /not mutate the scene/);
  assert.match(hierarchy, /never marks anything human-reviewed/);
  assert.match(hierarchy, /status: "review"/);
  assert.match(hierarchy, /Derived binding is not a human review decision/);
  assert.doesNotMatch(hierarchy, /reviewed:\s*true/);
});

test("roadmap keeps Phase 6 focused on stairs, lifts, and unit hierarchy", () => {
  assert.match(roadmap, /Phase 6 — Automatic building reconstruction/);
  assert.match(roadmap, /stairs\/lifts\/unit hierarchy/);
});
