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

const paletteCode = compile("apps/admin/src/studio/referenceImagePalette.ts");
const paletteUrl = asUrl(paletteCode);
const palette = await import(paletteUrl);
const matchingCode = compile("apps/admin/src/studio/visualFacadeMatching.ts");
const matchingUrl = asUrl(matchingCode);
const matching = await import(matchingUrl);
const difference = await import(
  asUrl(
    compile("apps/admin/src/studio/visualDifference.ts").replace(
      '"./referenceImagePalette"',
      JSON.stringify(paletteUrl),
    ),
  ),
);

function pixels(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = fn(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  return data;
}

function evidence(assetId, overrides = {}) {
  return {
    assetId,
    sourceWidth: 1600,
    sourceHeight: 1000,
    sampledWidth: 640,
    sampledHeight: 400,
    renderedPalette: ["#eee8df", "#78624f", "#1e2932"],
    regions: [
      {
        id: `r-${assetId}-paint`,
        color: "#eee8df",
        coverage: 0.28,
        centroidX: 0.45,
        centroidY: 0.42,
        minX: 0.2,
        minY: 0.2,
        maxX: 0.7,
        maxY: 0.65,
        luminance: 0.91,
        saturation: 0.06,
        warmth: 0.06,
        edgeStrength: 0.09,
        confidence: 0.88,
      },
      {
        id: `r-${assetId}-wood`,
        color: "#89654c",
        coverage: 0.11,
        centroidX: 0.7,
        centroidY: 0.55,
        minX: 0.55,
        minY: 0.35,
        maxX: 0.85,
        maxY: 0.75,
        luminance: 0.43,
        saturation: 0.45,
        warmth: 0.24,
        edgeStrength: 0.12,
        confidence: 0.81,
      },
    ],
    averageLuminance: 0.61,
    warmFraction: 0.22,
    darkFraction: 0.15,
    highlightFraction: 0.18,
    averageSaturation: 0.23,
    verticalEdgeStrength: 0.12,
    horizontalEdgeStrength: 0.09,
    lightingMood: "day",
    confidence: 0.84,
    sampleCount: 22000,
    ...overrides,
  };
}

function projectWithReferences(rows) {
  return {
    schema: 1,
    id: "project-visual",
    name: "Visual complete",
    updated: "2026-10-04T00:00:00.000Z",
    assets: ["model-a", ...rows.map((row) => row.assetId)],
    releases: [],
    scene: {
      modelId: "model-a",
      floors: [],
      rooms: [],
      furniture: [],
      scale: 1,
      referenceImageEvidence: rows[0],
      referenceImageEvidenceSet: rows,
    },
  };
}

const audits = [
  {
    assetId: "model-a",
    filename: "building.fbx",
    ascii: true,
    materialNames: ["Facade Paint", "Window Glass", "Wood Cladding"],
    externalTextureFiles: [],
    matchedTextureFiles: [],
  },
];

test("Phase 5 extracts deterministic bounded spatial color regions", () => {
  const width = 160;
  const height = 100;
  const data = pixels(width, height, (x, y) => {
    if (y < 45) return x < 80 ? [232, 226, 214] : [190, 211, 220];
    return x < 95 ? [137, 101, 76] : [45, 51, 58];
  });
  const first = palette.analyzeReferencePixels(data, width, height);
  const second = palette.analyzeReferencePixels(data, width, height);
  assert.deepEqual(first.regions, second.regions);
  assert.ok(first.regions.length >= 4);
  assert.ok(first.regions.length <= 24);
  assert.ok(first.regions.every((region) => region.coverage > 0 && region.coverage <= 1));
  assert.ok(first.regions.every((region) => region.centroidX >= region.minX && region.centroidX <= region.maxX));
  assert.ok(first.regions.every((region) => region.centroidY >= region.minY && region.centroidY <= region.maxY));
});

test("Phase 5 arbitrates multiple references and preserves lighting/material conflicts", () => {
  const day = evidence("visual-day", { confidence: 0.9, lightingMood: "day" });
  const night = evidence("visual-night", {
    confidence: 0.82,
    lightingMood: "night",
    averageLuminance: 0.24,
    darkFraction: 0.62,
    regions: [
      {
        ...evidence("tmp").regions[0],
        id: "r-night-paint",
        color: "#918171",
        luminance: 0.51,
        saturation: 0.22,
        warmth: 0.13,
        coverage: 0.31,
      },
      {
        ...evidence("tmp").regions[1],
        id: "r-night-wood",
        color: "#5b3828",
        luminance: 0.25,
        saturation: 0.56,
        warmth: 0.2,
      },
    ],
  });
  const project = projectWithReferences([day, night]);
  const plan = matching.buildVisualFacadeMatchPlan(project, audits);
  assert.equal(plan.references.length, 2);
  assert.equal(plan.primarySourceAssetId, "visual-day");
  assert.equal(plan.lightingConflict, true);
  assert.equal(plan.appearance.status, "needs-review");
  assert.ok(plan.counts.regions >= 4);
  assert.ok(plan.counts.regionMatches >= 1);
  assert.ok(plan.materials.every((row) => row.reviewRequired));
  assert.ok(plan.materials.some((row) => row.conflict));
  assert.match(plan.issues.join(" "), /disagree on lighting/i);
  assert.deepEqual(
    plan,
    matching.buildVisualFacadeMatchPlan(project, [...audits].reverse()),
  );
});

test("Phase 5 conflicting material requires explicit reference-region review", async () => {
  const day = evidence("visual-day", { confidence: 0.9 });
  const night = evidence("visual-night", {
    confidence: 0.84,
    regions: [
      {
        ...evidence("tmp").regions[0],
        id: "r-night-paint",
        color: "#918171",
        luminance: 0.51,
        saturation: 0.22,
        warmth: 0.13,
        coverage: 0.31,
      },
    ],
  });
  const project = projectWithReferences([day, night]);
  project.scene.materialOverrides = [];
  const review = await import(
    asUrl(
      compile("apps/admin/src/studio/visualFacadeReview.ts").replace(
        '"./visualFacadeMatching"',
        JSON.stringify(matchingUrl),
      ),
    ),
  );
  const built = review.buildVisualFacadeReview(project, audits);
  const paint = built.plan.materials.find((row) => row.materialName === "Facade Paint");
  assert.ok(paint?.conflict);
  const generic = {
    key: built.key,
    kind: "material",
    materialName: "Facade Paint",
  };
  assert.equal(
    review.applyVisualFacadeReview(project, audits, ["Facade Paint"], generic),
    project,
  );
  const candidate = paint.candidates[0];
  const next = review.applyVisualFacadeReview(
    project,
    audits,
    ["Facade Paint"],
    {
      ...generic,
      sourceAssetId: candidate.sourceAssetId,
      regionId: candidate.regionId,
    },
  );
  assert.notEqual(next, project);
  assert.equal(next.scene.materialOverrides[0].baseColor, candidate.baseColor);
  assert.deepEqual(next.scene.rooms, project.scene.rooms);
});

test("Phase 5 visual-difference score requires user-aligned camera and remains appearance-only", () => {
  const ref = evidence("visual-a");
  const rendered = {
    ...ref,
    renderedPalette: [...ref.renderedPalette],
    regions: [...ref.regions],
  };
  delete rendered.assetId;
  delete rendered.sourceWidth;
  delete rendered.sourceHeight;
  delete rendered.sampledWidth;
  delete rendered.sampledHeight;
  const blocked = difference.compareVisualAppearance(ref, rendered, {
    viewpointAligned: false,
  });
  assert.equal(blocked.status, "viewpoint-required");
  assert.equal(blocked.similarityPercent, undefined);
  const same = difference.compareVisualAppearance(ref, rendered, {
    viewpointAligned: true,
  });
  assert.ok(same.similarityPercent >= 95);
  const changed = difference.compareVisualAppearance(
    ref,
    {
      ...rendered,
      renderedPalette: ["#101820"],
      averageLuminance: 0.12,
      averageSaturation: 0.7,
      lightingMood: "night",
      verticalEdgeStrength: 0.6,
      horizontalEdgeStrength: 0.5,
    },
    { viewpointAligned: true },
  );
  assert.ok(changed.similarityPercent < same.similarityPercent);
  assert.match(changed.detail, /does not certify dimensions, geometry/i);
});

test("Phase 5 completion is wired through AutoBuild, Studio, cloud validation, replay and protected golden proof", () => {
  const legacy = fs.readFileSync("apps/admin/src/studio/autoBuildPipelineLegacy.ts", "utf8");
  const studio = fs.readFileSync("apps/admin/src/studio/Studio.tsx", "utf8");
  const canvas = fs.readFileSync("apps/admin/src/studio/SceneCanvas.tsx", "utf8");
  const domain = fs.readFileSync("apps/admin/src/studio/domain.ts", "utf8");
  const worker = fs.readFileSync("workers/studio-draft-validation.mjs", "utf8");
  const replay = fs.readFileSync("apps/admin/src/studio/sceneReplayFingerprint.ts", "utf8");
  const golden = fs.readFileSync("e2e/golden-source-pack.spec.ts", "utf8");
  assert.match(legacy, /referenceImageEvidenceSet/);
  assert.match(legacy, /choosePrimaryVisualReference/);
  assert.match(studio, /compareVisualAppearance/);
  assert.match(studio, /visualSampleRequest/);
  assert.match(canvas, /analyzeReferencePixels/);
  assert.match(canvas, /Rendered-view comparison canvas/);
  assert.match(domain, /ReferenceColorRegion/);
  assert.match(worker, /referenceImageEvidenceSet/);
  assert.match(replay, /referenceEvidenceSeed/);
  assert.match(replay, /referenceImageEvidenceSet/);
  assert.match(golden, /visual-reference-summary/);
  assert.match(golden, /color region/);
});
