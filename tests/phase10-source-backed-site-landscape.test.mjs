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

const semantics = await import(
  asUrl(compile("apps/admin/src/studio/siteSemantics.ts")),
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

test("Phase 10 classifies only explicit site and landscape semantics", () => {
  assert.equal(semantics.classifySiteSemantic("A-LANDSCAPE-GARDEN"), "garden");
  assert.equal(semantics.classifySiteSemantic("Landscape Lawn / Grass"), "lawn");
  assert.equal(semantics.classifySiteSemantic("TREE_PALM_01"), "tree");
  assert.equal(semantics.classifySiteSemantic("Parking Bay"), "parking");
  assert.equal(semantics.classifySiteSemantic("Main Driveway"), "road");
  assert.equal(semantics.classifySiteSemantic("Footpath Paving"), "path");
  assert.equal(semantics.classifySiteSemantic("Entrance Gate"), "gate");
  assert.equal(
    semantics.classifySiteSemantic("Street Light Pole"),
    "outdoor-light",
  );
  assert.equal(semantics.classifySiteSemantic("A-WALL-EXTERNAL"), undefined);
  assert.equal(semantics.classifySiteSemantic("Bedroom Window"), undefined);
});

test("Phase 10 domain validates reviewed and source-backed site elements", () => {
  const project = domain.newProject("Site project");
  project.assets.push("dwg-source");
  project.scene.siteElements.push({
    id: "site-tree-1",
    kind: "tree",
    x: 4,
    z: -3,
    width: 2.2,
    depth: 2.2,
    height: 5,
    rotation: 0,
    color: "#4f7b48",
    reviewed: false,
    reviewState: "auto_ready",
    origin: "cad-auto",
    confidence: 0.91,
    sourceAssetId: "dwg-source",
    sourceRef: "insert:tree-12",
  });

  assert.doesNotThrow(() => domain.validateProject(project));

  project.scene.siteElements[0].reviewed = true;
  project.scene.siteElements[0].reviewState = "human_reviewed";
  assert.doesNotThrow(() => domain.validateProject(project));
});

test("Phase 10 rejects orphan site evidence and invalid review state", () => {
  const project = domain.newProject("Invalid site");
  project.scene.siteElements.push({
    id: "site-gate-1",
    kind: "gate",
    x: 0,
    z: 0,
    width: 3,
    depth: 0.2,
    height: 1.8,
    rotation: 0,
    color: "#5e5851",
    reviewed: true,
    reviewState: "auto_ready",
    origin: "cad-auto",
    confidence: 0.9,
    sourceAssetId: "missing",
    sourceRef: "insert:gate",
  });

  assert.throws(
    () => domain.validateProject(project),
    /Invalid site\/landscape element/,
  );

  project.scene.siteElements[0].reviewed = false;
  project.scene.siteElements[0].reviewState = "auto_ready";
  assert.throws(
    () => domain.validateProject(project),
    /Site element source asset is missing/,
  );
});

test("Phase 10 AutoBuild derives site drafts only from source-backed CAD semantics", () => {
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );
  const draft = fs.readFileSync(
    "apps/admin/src/studio/siteLandscapeDraft.ts",
    "utf8",
  );

  assert.match(pipeline, /deriveSourceBackedSiteLandscape/);
  assert.match(pipeline, /siteElementsPrepared/);
  assert.match(draft, /audit\.kind === "dwg"/);
  assert.match(draft, /resolveCadFloorIndex/);
  assert.match(draft, /estimateCadModelRegistration/);
  assert.match(draft, /registration\.ambiguous/);
  assert.match(draft, /areaKind\(kind\) && !sizing\.sourceSized/);
  assert.match(
    draft,
    /instead of becoming guessed geometry/,
  );
});

test("Phase 10 site elements are editable in Studio and publish only after review", () => {
  const canvas = fs.readFileSync(
    "apps/admin/src/studio/SceneCanvas.tsx",
    "utf8",
  );
  const studio = fs.readFileSync(
    "apps/admin/src/studio/Studio.tsx",
    "utf8",
  );
  const siteCanvas = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasSite.ts",
    "utf8",
  );
  const worker = fs.readFileSync(
    "workers/studio-draft-validation.mjs",
    "utf8",
  );
  const manifest = fs.readFileSync(
    "apps/admin/src/studio/manifestV2.ts",
    "utf8",
  );
  const contract = fs.readFileSync(
    "packages/contracts/src/scene-manifest-v2.ts",
    "utf8",
  );

  assert.match(canvas, /renderSiteElements/);
  assert.match(canvas, /siteElementTransformChange/);
  assert.match(canvas, /props\.scene\.siteElements/);
  assert.match(siteCanvas, /addSiteElementVisual/);
  assert.match(siteCanvas, /kind: "siteElement"/);
  assert.match(studio, /SITE &amp; LANDSCAPE/);
  assert.match(studio, /Accept site element/);
  assert.match(studio, /origin: "manual" as const/);
  assert.match(worker, /siteElements: \(scene\.siteElements \?\? \[\]\)/);
  assert.match(worker, /filter\(\(site\) => site\?\.reviewed === true\)/);
  assert.match(manifest, /siteElements: \(project\.scene\.siteElements \?\? \[\]\)/);
  assert.match(manifest, /filter\(\(item\) => item\.reviewed\)/);
  assert.match(contract, /SceneSiteElementKindV2/);
  assert.match(contract, /siteElements\?: SceneSiteElementV2\[\]/);
});
