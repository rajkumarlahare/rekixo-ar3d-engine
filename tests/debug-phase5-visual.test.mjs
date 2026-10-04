import fs from "node:fs";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const asUrl = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const visual = await import(asUrl(compile("apps/admin/src/studio/visualFacadeMatching.ts")));
const review = await import(asUrl(
  compile("apps/admin/src/studio/visualFacadeReview.ts").replace(
    '"./visualFacadeMatching"',
    JSON.stringify(asUrl(compile("apps/admin/src/studio/visualFacadeMatching.ts"))),
  ),
));
const project = {
  schema: 1, id: "project-a", name: "Visual match", updated: "2026-10-04T00:00:00.000Z",
  assets: ["visual-a", "model-a", "other-model"], releases: [],
  scene: {
    floors: [], rooms: [{ id: "room-a", width: 5, depth: 4 }], furniture: [], scale: 1,
    modelId: "model-a",
    referenceImageEvidence: {
      assetId: "visual-a", sourceWidth: 1600, sourceHeight: 1000, sampledWidth: 640, sampledHeight: 400,
      renderedPalette: ["#e6ded1", "#a76b48", "#263038", "#b7d2dc"], averageLuminance: 0.52,
      warmFraction: 0.28, darkFraction: 0.21, highlightFraction: 0.11, averageSaturation: 0.24,
      verticalEdgeStrength: 0.12, horizontalEdgeStrength: 0.09, lightingMood: "evening", confidence: 0.84,
      sampleCount: 22000,
    },
    walls: [{ id: "wall-a", start: { x: 0, z: 0 }, end: { x: 5, z: 0 } }],
    materialOverrides: [
      { materialName: "Facade Paint", roughness: 0.7, opacity: 0.8, baseColor: "#ffffff" },
      { materialName: "Other", metalness: 0.9 },
    ],
  },
};
const audits = [{
  assetId: "model-a", filename: "building.fbx", ascii: true,
  materialNames: ["Facade Paint", "Window Glass", "Aluminium Frame", "Wood Cladding", "Mystery_17"],
  externalTextureFiles: [], matchedTextureFiles: [],
}];
const plan = visual.buildVisualFacadeMatchPlan(project, audits);
console.log("PHASE5_DEBUG_PLAN", JSON.stringify({ status: plan.status, materials: plan.materials }, null, 2));
const key = review.buildVisualFacadeReview(project, audits).key;
const applied = review.applyVisualFacadeReview(project, audits, ["Facade Paint"], { key, kind: "material", materialName: "Facade Paint" });
console.log("PHASE5_DEBUG_APPLIED", JSON.stringify(applied.scene.materialOverrides, null, 2));
