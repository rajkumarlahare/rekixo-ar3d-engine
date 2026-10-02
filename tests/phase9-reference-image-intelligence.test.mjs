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

const palette = await import(
  asUrl(compile("apps/admin/src/studio/referenceImagePalette.ts")),
);

const slugPolicyUrl = asUrl(
  fs.readFileSync("shared/project-slug-policy.js", "utf8"),
);
const domainUrl = asUrl(
  compile("apps/admin/src/studio/domain.ts").replace(
    /(["'])\.\.\/\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js\1/,
    JSON.stringify(slugPolicyUrl),
  ),
);
const domain = await import(domainUrl);

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

test("Phase 9 extracts rendered palette and evening lighting evidence", () => {
  const width = 120;
  const height = 80;
  const data = pixels(width, height, (_x, y) =>
    y < height * 0.58 ? [55, 76, 105] : [255, 194, 145],
  );
  const result = palette.analyzeReferencePixels(data, width, height);

  assert.ok(result.renderedPalette.length >= 2);
  assert.equal(result.lightingMood, "evening");
  assert.ok(result.warmFraction > 0.25);
  assert.ok(result.highlightFraction > 0.1);
  assert.ok(result.confidence >= 0.55);
});

test("Phase 9 distinguishes bright day and dark night references", () => {
  const day = palette.analyzeReferencePixels(
    pixels(80, 60, (x) =>
      x < 40 ? [210, 226, 240] : [242, 238, 224],
    ),
    80,
    60,
  );
  const night = palette.analyzeReferencePixels(
    pixels(80, 60, (x) =>
      x < 8 ? [245, 172, 105] : [18, 25, 40],
    ),
    80,
    60,
  );

  assert.equal(day.lightingMood, "day");
  assert.equal(night.lightingMood, "night");
  assert.ok(night.darkFraction > 0.7);
});

test("Phase 9 records visual edge structure without claiming metric geometry", () => {
  const data = pixels(120, 90, (x, y) => {
    const vertical = Math.floor(x / 10) % 2;
    const horizontal = Math.floor(y / 15) % 2;
    const value = vertical === horizontal ? 225 : 55;
    return [value, value, value];
  });
  const result = palette.analyzeReferencePixels(data, 120, 90);

  assert.ok(result.verticalEdgeStrength > 0);
  assert.ok(result.horizontalEdgeStrength > 0);
  assert.ok(result.verticalEdgeStrength <= 1);
  assert.ok(result.horizontalEdgeStrength <= 1);
});

test("Phase 9 project validation accepts bounded evidence and rejects orphan evidence", () => {
  const project = domain.newProject("Reference evidence");
  project.assets.push("reference-image");
  project.scene.referenceImageEvidence = {
    assetId: "reference-image",
    sourceWidth: 2048,
    sourceHeight: 1365,
    sampledWidth: 640,
    sampledHeight: 427,
    renderedPalette: ["#515053", "#8f624e", "#d0b9aa"],
    averageLuminance: 0.51,
    warmFraction: 0.23,
    darkFraction: 0.18,
    highlightFraction: 0.14,
    averageSaturation: 0.29,
    verticalEdgeStrength: 0.11,
    horizontalEdgeStrength: 0.09,
    lightingMood: "evening",
    confidence: 0.82,
    sampleCount: 25000,
  };

  assert.doesNotThrow(() => domain.validateProject(project));

  const orphan = structuredClone(project);
  orphan.assets = [];
  assert.throws(
    () => domain.validateProject(orphan),
    /Reference image evidence asset is missing/,
  );
});

test("Phase 9 AutoBuild and cloud validation keep reference evidence source-bound", () => {
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );
  const worker = fs.readFileSync(
    "workers/studio-draft-validation.mjs",
    "utf8",
  );
  const inspector = fs.readFileSync(
    "apps/admin/src/studio/referenceImageInspector.ts",
    "utf8",
  );

  assert.match(pipeline, /inspectReferenceImage/);
  assert.match(pipeline, /referenceImageEvidence/);
  assert.match(pipeline, /Multiple visual reference images are attached/);
  assert.match(worker, /referenceImageEvidence/);
  assert.match(worker, /assetIds\.has\(evidence\.assetId\)/);
  assert.match(inspector, /looksLikeGeneratedPlanReference/);
  assert.match(
    inspector,
    /auto-plan-image\|auto-plan-page\|floor-plan\|reference/,
  );
});
