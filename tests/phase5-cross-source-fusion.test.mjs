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

const fusion = await import(
  asUrl(compile("apps/admin/src/studio/crossSourceFusion.ts")),
);

test("Phase 5 capability authority follows source purpose instead of one global winner", () => {
  const items = [
    {
      assetId: "dwg",
      name: "plan.dwg",
      extension: "dwg",
      kind: "cad",
      support: "ready",
      capabilities: ["geometry", "floors", "walls", "openings", "dimensions", "rooms"],
      findings: [],
      warnings: [],
    },
    {
      assetId: "skb",
      name: "design.skb",
      extension: "skb",
      kind: "sketchup",
      support: "partial",
      capabilities: ["geometry", "materials", "metadata"],
      findings: [],
      warnings: [],
    },
    {
      assetId: "jpg",
      name: "reference.jpg",
      extension: "jpg",
      kind: "visual-reference",
      support: "evidence-only",
      capabilities: ["visual-style"],
      findings: [],
      warnings: [],
    },
  ];
  const decisions = fusion.chooseSourceAuthorities(items);
  const byCapability = new Map(
    decisions.map((entry) => [entry.capability, entry]),
  );
  assert.equal(byCapability.get("dimensions")?.sourceAssetId, "dwg");
  assert.equal(byCapability.get("materials")?.sourceAssetId, "skb");
  assert.equal(byCapability.get("visual-style")?.sourceAssetId, "jpg");
});

test("Phase 5 equal authority stays review-only instead of silently choosing", () => {
  const items = ["a", "b"].map((assetId) => ({
    assetId,
    name: `${assetId}.dwg`,
    extension: "dwg",
    kind: "cad",
    support: "ready",
    capabilities: ["dimensions"],
    findings: [],
    warnings: [],
  }));
  const decision = fusion
    .chooseSourceAuthorities(items)
    .find((entry) => entry.capability === "dimensions");
  assert.equal(decision?.status, "review");
  assert.equal(decision?.sourceAssetId, undefined);
});

function pdfPage() {
  return {
    page: 2,
    score: 30,
    aspectRatio: 2,
    roomLabels: ["living", "kitchen", "bedroom", "toilet"],
    dimensionStrings: [],
    hasFloorPlanLabel: true,
    textSample: "",
    spatialLabels: [
      { text: "Living", kind: "room", x: 0.1, y: 0.2, width: 0.1, height: 0.02 },
      { text: "Kitchen", kind: "room", x: 0.7, y: 0.2, width: 0.1, height: 0.02 },
      { text: "Bed Room", kind: "room", x: 0.7, y: 0.8, width: 0.1, height: 0.02 },
      { text: "Toilet", kind: "room", x: 0.1, y: 0.8, width: 0.1, height: 0.02 },
    ],
    embeddedImages: [],
  };
}

function transformPdf(point) {
  // source coordinate is [x * aspectRatio, y]; rotate 90°, scale 10, translate.
  const [x, y] = point;
  return [100 - y * 10, 50 + x * 10];
}

function cadAudit() {
  const page = pdfPage();
  return {
    assetId: "dwg",
    name: "plan.dwg",
    kind: "dwg",
    semanticReady: true,
    layerHints: [],
    geometryReady: true,
    semanticSegments: [],
    textLabels: page.spatialLabels.map((entry) => ({
      layer: "TEXT",
      text: entry.text,
      point: transformPdf([entry.x * page.aspectRatio, entry.y]),
    })),
    note: "fixture",
  };
}

test("Phase 5 registers PDF spatial evidence to CAD with metric similarity transform", () => {
  const result = fusion.estimatePdfCadRegistration(pdfPage(), cadAudit());
  assert.equal(result.compatible, true);
  assert.equal(result.matches, 4);
  assert.ok(Math.abs((result.scaleMetresPerPdfUnit ?? 0) - 10) < 0.0001);
  assert.ok(Math.abs((result.rotationDeg ?? 0) - 90) < 0.001);
  assert.ok((result.normalizedRms ?? 1) < 0.00001);
  assert.ok(result.confidence > 0.9);

  const mapped = fusion.applyPdfCadPoint([0.2, 0.2], result);
  assert.ok(mapped);
  assert.ok(Math.abs(mapped[0] - 98) < 0.001);
  assert.ok(Math.abs(mapped[1] - 52) < 0.001);
});

test("Phase 5 PDF registration fails closed with too few unique shared labels", () => {
  const page = pdfPage();
  page.spatialLabels = page.spatialLabels.slice(0, 2);
  const result = fusion.estimatePdfCadRegistration(page, cadAudit());
  assert.equal(result.compatible, false);
  assert.equal(result.matches, 2);
  assert.match(result.reason, /at least three unique shared spatial labels/i);
});

test("Phase 5 links SketchUp and FBX by shared materials without claiming geometry", () => {
  const overlap = fusion.sketchUpFbxMaterialOverlap(
    ["[Metal Panel]", "Marble_Carrara_Floor_Tile", "Glass Blue"],
    ["Material::Metal_Panel", "Marble Carrara Floor Tile", "Other"],
  );
  assert.equal(overlap.matched, 2);
  assert.equal(overlap.denominator, 3);
  assert.equal(overlap.ratio, 0.6667);
});

test("Phase 5 Auto Build composes PDF to CAD to model only after both registrations pass", () => {
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );
  assert.match(pipeline, /estimatePdfCadRegistration/);
  assert.match(pipeline, /estimateCadModelRegistration/);
  assert.match(pipeline, /applyPdfCadPoint/);
  assert.match(pipeline, /applyCadRegistrationPoint/);
  assert.match(pipeline, /pdfReferenceAutoAligned = true/);
  assert.match(pipeline, /pixelScaleAgreement <= 0\.035/);
});
