import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const planning = await import(
  asUrl(compile("apps/admin/src/studio/cadFloorPlanning.ts")),
);

const audit = (name, labels = []) => ({
  name,
  textLabels: labels.map((text) => ({ text })),
});

test("Phase 15 resolves explicit ground and upper CAD floor sources", () => {
  const result = planning.resolveCadFloorPlanRoles([
    audit("Block A - Ground Floor.dwg"),
    audit("Block A - 1st Floor.dwg"),
    audit("Block A - 2nd Floor.dwg"),
  ]);

  assert.deepEqual(
    result.roles.map((role) => [role.label, role.elevation]),
    [
      ["Ground", 0],
      ["Floor 1", 3],
      ["Floor 2", 6],
    ],
  );
  assert.ok(result.issues.some((issue) => issue.includes("inferred")));
});

test("Phase 15 resolves basement identities below ground", () => {
  const result = planning.resolveCadFloorPlanRoles([
    audit("B2 parking floor.dwg"),
    audit("B1 parking floor.dwg"),
    audit("Ground Floor.dwg"),
  ]);
  assert.deepEqual(
    result.roles.map((role) => [role.label, role.elevation]),
    [
      ["Basement 2", -6],
      ["Basement 1", -3],
      ["Ground", 0],
    ],
  );
});

test("Phase 15 fails closed on duplicate CAD floor roles", () => {
  assert.throws(
    () =>
      planning.resolveCadFloorPlanRoles([
        audit("Tower First Floor.dwg"),
        audit("Tower 1st Floor revision.dxf"),
      ]),
    /Multiple CAD sources resolve to Floor 1/,
  );
});

test("Phase 15 fails closed when one CAD source mixes multiple floor plans", () => {
  assert.throws(
    () =>
      planning.resolveCadFloorPlanRoles([
        audit("Architectural plans.dwg", [
          "GROUND FLOOR PLAN",
          "FIRST FLOOR PLAN",
        ]),
        audit("Second Floor.dwg"),
      ]),
    /contains multiple floor identities/,
  );
});

test("Phase 15 preserves legacy single CAD plan when floor identity is absent", () => {
  const result = planning.resolveCadFloorPlanRoles([
    audit("architectural-plan.dxf"),
  ]);
  assert.equal(result.roles.length, 1);
  assert.equal(result.roles[0].label, "CAD Plan");
  assert.equal(result.roles[0].explicit, false);
  assert.equal(result.roles[0].elevation, 0);
});

test("Phase 15 readiness no longer blocks a multi-file model-less CAD pack before semantic validation", () => {
  const readiness = fs.readFileSync(
    "apps/admin/src/studio/sourcePackReadiness.ts",
    "utf8",
  );
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/cadOnlyAutoBuildPipeline.ts",
    "utf8",
  );
  const draft = fs.readFileSync(
    "apps/admin/src/studio/cadOnlySceneDraft.ts",
    "utf8",
  );

  assert.doesNotMatch(readiness, /needs exactly one DWG\/DXF source/);
  assert.match(readiness, /unique explicit floor identity/);
  assert.match(pipeline, /for \(const cadSource of cadSources\)/);
  assert.match(pipeline, /cadDraft\.unmatchedOpeningEvidence/);
  assert.match(draft, /assertCompatibleFloorFootprints/);
  assert.match(draft, /if \(!roomIds\.length\)/);
  assert.match(draft, /remain evidence-only instead of becoming invalid scene openings/);
});
