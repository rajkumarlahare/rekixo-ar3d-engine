import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const normalized = fs.readFileSync(
  "apps/admin/src/studio/dwgNormalized.ts",
  "utf8",
);
const processor = fs.readFileSync(
  "services/dwg-processor/server.mjs",
  "utf8",
);
const phase2 = fs.readFileSync(
  "apps/admin/src/studio/phase2CadFusion.ts",
  "utf8",
);

test("normalized DWG contract accepts beam and boundary structural semantics", () => {
  const transpiled = ts.transpileModule(normalized, {
    fileName: "dwgNormalized.ts",
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (entry) => entry.category === ts.DiagnosticCategory.Error,
  );
  assert.deepEqual(
    errors.map((entry) => ts.flattenDiagnosticMessageText(entry.messageText, "\n")),
    [],
  );
  assert.match(normalized, /\| "beam"/);
  assert.match(normalized, /\| "boundary"/);
  assert.match(normalized, /"beam",[\s\S]*"boundary",/);
});

test("DWG adapter emits bounded structural footprint evidence without inventing height", () => {
  assert.match(processor, /rekixo-dwg-adapter-v2/);
  assert.match(processor, /FOOTPRINT_KINDS/);
  assert.match(processor, /return "beam"/);
  assert.match(processor, /return "boundary"/);
  assert.match(processor, /pushFootprintObject/);
  assert.match(processor, /closed && points\.length > 2/);
  assert.match(processor, /closed && polylinePoints\.length > 2/);
  assert.match(processor, /entity\.type === "CIRCLE"/);
  assert.match(processor, /bounds/);
  assert.doesNotMatch(processor, /structuralHeight|defaultStructuralHeight|inventedHeight/);
});

test("Phase 2 reports exact structural footprints separately from semantic-only evidence", () => {
  assert.match(phase2, /structuralFootprints: number/);
  assert.match(phase2, /footprint: Boolean\(entry\.bounds\)/);
  assert.match(phase2, /if \(entry\.footprint\) structuralFootprints \+= 1/);
  assert.match(phase2, /source-backed 2D bounds/);
  assert.match(phase2, /no vertical dimension is invented from plan evidence/);
});
