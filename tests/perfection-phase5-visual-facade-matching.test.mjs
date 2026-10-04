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

const visual = await import(
  asUrl(compile("apps/admin/src/studio/visualFacadeMatching.ts")),
);

function projectWithEvidence(overrides = {}) {
  return {
    schema: 1,
    id: "project-a",
    name: "Visual match",
    updated: "2026-10-04T00:00:00.000Z",
    assets: ["visual-a"],
    releases: [],
    scene: {
      floors: [],
      rooms: [],
      furniture: [],
      scale: 1,
      referenceImageEvidence: {
        assetId: "visual-a",
        sourceWidth: 1600,
        sourceHeight: 1000,
        sampledWidth: 640,
        sampledHeight: 400,
        renderedPalette: ["#e6ded1", "#a76b48", "#263038", "#b7d2dc"],
        averageLuminance: 0.52,
        warmFraction: 0.28,
        darkFraction: 0.21,
        highlightFraction: 0.11,
        averageSaturation: 0.24,
        verticalEdgeStrength: 0.12,
        horizontalEdgeStrength: 0.09,
        lightingMood: "evening",
        confidence: 0.84,
        sampleCount: 22000,
        ...overrides,
      },
    },
  };
}

const audits = [
  {
    assetId: "model-a",
    filename: "building.fbx",
    ascii: true,
    materialNames: [
      "Facade Paint",
      "Window Glass",
      "Aluminium Frame",
      "Wood Cladding",
      "Mystery_17",
    ],
    externalTextureFiles: [],
    matchedTextureFiles: [],
  },
];

test("Phase 5 keeps visual matching unavailable without analyzed image evidence", () => {
  const project = projectWithEvidence();
  delete project.scene.referenceImageEvidence;
  const plan = visual.buildVisualFacadeMatchPlan(project, audits);
  assert.equal(plan.status, "unavailable");
  assert.equal(plan.materials.length, 0);
  assert.deepEqual(plan.invariants, [
    "visual-non-metric",
    "source-material-names-only",
    "geometry-immutable",
  ]);
});

test("Phase 5 builds deterministic source-material facade suggestions from the reference palette", () => {
  const first = visual.buildVisualFacadeMatchPlan(projectWithEvidence(), audits);
  const second = visual.buildVisualFacadeMatchPlan(projectWithEvidence(), [
    { ...audits[0], materialNames: [...audits[0].materialNames].reverse() },
  ]);

  assert.equal(first.status, "auto-ready");
  assert.equal(first.appearance.status, "auto-ready");
  assert.equal(first.appearance.appearance.nightMode, false);
  assert.deepEqual(first.materials, second.materials);
  assert.equal(first.materials.length, 4);
  assert.ok(first.materials.every((entry) => entry.reviewRequired));
  assert.ok(first.materials.every((entry) => entry.sourceAssetId === "visual-a"));
  assert.ok(first.materials.every((entry) => /^#[0-9a-f]{6}$/.test(entry.baseColor)));
  assert.ok(!first.materials.some((entry) => entry.materialName === "Mystery_17"));
});

test("Phase 5 refuses material color suggestions when visual confidence is weak", () => {
  const plan = visual.buildVisualFacadeMatchPlan(
    projectWithEvidence({ confidence: 0.49, lightingMood: "unknown" }),
    audits,
  );
  assert.equal(plan.status, "needs-review");
  assert.equal(plan.appearance.status, "needs-review");
  assert.equal(plan.materials.length, 0);
  assert.match(plan.issues.join(" "), /too low for material suggestions/i);
});

test("Phase 5 planner exposes no geometry mutation surface", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/visualFacadeMatching.ts",
    "utf8",
  );
  assert.match(source, /visual-non-metric/);
  assert.match(source, /source-material-names-only/);
  assert.match(source, /geometry-immutable/);
  assert.doesNotMatch(source, /\.scene\.walls\s*=/);
  assert.doesNotMatch(source, /\.scene\.rooms\s*=/);
  assert.doesNotMatch(source, /\.scene\.openings\s*=/);
});

test("Phase 5 AutoBuild result carries the visual facade plan without making it certification truth", () => {
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );
  assert.match(pipeline, /buildVisualFacadeMatchPlan/);
  assert.match(pipeline, /visualFacadeMatch: VisualFacadeMatchPlan/);
  assert.match(pipeline, /visualFacadeMatch = buildVisualFacadeMatchPlan/);
  assert.match(pipeline, /Phase 5 visual/);
});
