import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const analyzer = fs.readFileSync(
  "apps/admin/src/studio/projectAnalyzer.ts",
  "utf8",
);
const fusion = fs.readFileSync(
  "apps/admin/src/studio/structuralPrimitiveFusion.ts",
  "utf8",
);
const domain = fs.readFileSync(
  "apps/admin/src/studio/domain.ts",
  "utf8",
);
const publicRuntime = fs.readFileSync(
  "apps/public/src/viewer/publicRuntimeContext.ts",
  "utf8",
);
const publicEnvironment = fs.readFileSync(
  "apps/public/src/viewer/siteEnvironment.ts",
  "utf8",
);
const workerValidation = fs.readFileSync(
  "workers/studio-draft-validation.mjs",
  "utf8",
);

function transpile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
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

test("Phase 20 TypeScript modules transpile", () => {
  transpile(analyzer, "projectAnalyzer.ts");
  transpile(fusion, "structuralPrimitiveFusion.ts");
  transpile(domain, "domain.ts");
  transpile(publicRuntime, "publicRuntimeContext.ts");
  transpile(publicEnvironment, "siteEnvironment.ts");
});

test("3D structural candidates require explicit source semantics rather than size-only guessing", () => {
  assert.match(analyzer, /suggestStructuralCandidates/);
  assert.match(analyzer, /Structural candidates deliberately require explicit source naming\/material/);
  assert.match(analyzer, /Size-only classification is not used/);
  assert.match(analyzer, /source node name explicitly says/);
  assert.match(analyzer, /source material explicitly says/);
  assert.match(analyzer, /materialKinds\.some\(\(kind\) => kind !== nameKind\)/);
});

test("structural primitive creation requires CAD footprint plus a unique matching 3D envelope", () => {
  assert.match(fusion, /SAFE_FOOTPRINT_ENTITIES/);
  assert.match(fusion, /"LWPOLYLINE"/);
  assert.match(fusion, /"POLYLINE"/);
  assert.match(fusion, /"CIRCLE"/);
  assert.match(fusion, /if \(!object\.bounds/);
  assert.match(fusion, /candidate\.kind === kind/);
  assert.match(fusion, /candidate\.floorIndex === row\.floorIndex/);
  assert.match(fusion, /second\.score - best\.score < 0\.12/);
  assert.match(fusion, /CAD-only evidence never receives/);
  assert.match(fusion, /height: Number\(match\.envelope\.height\.toFixed\(4\)\)/);
  assert.match(fusion, /width: Number\(match\.envelope\.width\.toFixed\(4\)\)/);
});

test("automatic structural envelopes remain review gated and preserve reviewed geometry", () => {
  assert.match(fusion, /reviewState: "auto_ready"/);
  assert.match(fusion, /if \(values\[index\]\.reviewed\)/);
  assert.match(fusion, /object\.kind === "boundary"/);
  assert.match(fusion, /origin: "model-cad-auto"/);
  assert.match(domain, /"model-cad-auto"/);
  assert.match(domain, /human_reviewed/);
  assert.match(workerValidation, /site\?\.reviewed === true/);
});

test("public runtime publishes only reviewed structural envelopes and renders them separately", () => {
  assert.match(publicRuntime, /raw\.reviewed !== true/);
  assert.match(publicRuntime, /"column"/);
  assert.match(publicRuntime, /"beam"/);
  assert.match(publicRuntime, /raw\.shape === "box" \|\| raw\.shape === "cylinder"/);
  assert.match(publicEnvironment, /STRUCTURAL_KINDS/);
  assert.match(publicEnvironment, /addStructuralBatches/);
  assert.match(publicEnvironment, /Structural \$\{first\.kind\}/);
});
