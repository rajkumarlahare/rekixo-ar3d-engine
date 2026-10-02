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

const { evaluateSourcePackReadiness } = await import(
  asUrl(compile("apps/admin/src/studio/sourcePackReadiness.ts")),
);

function asset(id, name, type = "application/octet-stream") {
  const blob = new Blob(["fixture"], { type });
  return {
    id,
    projectId: "project-1",
    name,
    type,
    size: blob.size,
    hash: id.padEnd(64, "a").slice(0, 64),
    blob,
  };
}

function project(modelId) {
  return {
    id: "project-1",
    name: "Acceptance project",
    location: "",
    referenceUrl: "",
    brief: "",
    assets: [],
    scene: {
      version: 1,
      modelId,
      modelTransform: { x: 0, y: 0, z: 0, rotationY: 0 },
      scale: 1,
      floors: [{ id: "floor-0", name: "Ground", elevation: 0 }],
      rooms: [],
      furniture: [],
      walls: [],
      openings: [],
      referenceLayers: [],
      materialOverrides: [],
      lighting: {},
    },
  };
}

test("six-role customer source pack is ready for generic automatic building", () => {
  const files = [
    asset("fbx", "building-source.fbx"),
    asset("dwg", "architectural-first-floor.dwg", "image/vnd.dwg"),
    asset("skb", "design-backup.skb"),
    asset("pdf", "brochure-floor-plan.pdf", "application/pdf"),
    asset("jpg", "exterior-reference.jpg", "image/jpeg"),
    asset("drs", "render-scene.drs", "application/json"),
  ];
  const fusion = {
    createdAt: new Date().toISOString(),
    items: [
      {
        assetId: "fbx",
        name: "building-source.fbx",
        extension: "fbx",
        kind: "authoring-model",
        support: "partial",
        capabilities: ["geometry"],
        findings: [],
        warnings: [],
      },
      {
        assetId: "dwg",
        name: "architectural-first-floor.dwg",
        extension: "dwg",
        kind: "cad",
        support: "needs-conversion",
        capabilities: ["walls"],
        findings: [],
        warnings: [],
      },
      {
        assetId: "skb",
        name: "design-backup.skb",
        extension: "skb",
        kind: "sketchup",
        support: "needs-conversion",
        capabilities: ["materials"],
        findings: [],
        warnings: [],
      },
    ],
    facts: [],
    readySources: 0,
    partialSources: 1,
    evidenceOnlySources: 0,
    needsConversionSources: 2,
    reviewCount: 0,
    conflicts: [],
    recommendedActions: [],
  };

  const result = evaluateSourcePackReadiness(project("fbx"), files, fusion);
  assert.equal(result.completeSupportPack, true);
  assert.equal(result.autoBuildReady, true);
  assert.equal(result.blockingIssues.length, 0);
  assert.equal(result.roles.filter((role) => role.present).length, 6);
  assert.ok(result.reviewIssues.some((issue) => /DWG/.test(issue)));
  assert.ok(result.reviewIssues.some((issue) => /SketchUp/.test(issue)));
});

test("multiple unselected 3D sources block one-click automatic building without guessing", () => {
  const files = [
    asset("fbx-1", "building-a.fbx"),
    asset("fbx-2", "building-b.fbx"),
  ];
  const result = evaluateSourcePackReadiness(project(undefined), files);
  assert.equal(result.autoBuildReady, false);
  assert.ok(
    result.blockingIssues.some((issue) =>
      /Multiple 3D models/.test(issue),
    ),
  );
});

test("source-pack readiness stays generic and does not encode customer names or hashes", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/sourcePackReadiness.ts",
    "utf8",
  );
  assert.doesNotMatch(source, /jyoti|paradise|source-profile|sha256/i);
  assert.match(source, /completeSupportPack/);
  assert.match(source, /autoBuildReady/);
  assert.match(source, /DWG/);
  assert.match(source, /SketchUp/);
});

test("critical browser smoke controls use stable data-testid selectors", () => {
  const builder = fs.readFileSync(
    "apps/admin/src/studio/SmartProjectBuilder.tsx",
    "utf8",
  );
  const e2e = fs.readFileSync("e2e/studio-authoring.spec.ts", "utf8");

  for (const id of [
    "analyze-project",
    "detected-floor-levels",
    "build-automatically",
    "build-analyzed-draft",
    "open-visual-editor",
  ])
    assert.match(builder, new RegExp(`data-testid=["']${id}["']`));

  assert.match(e2e, /getByTestId\("analyze-project"\)/);
  assert.match(e2e, /getByTestId\("detected-floor-levels"\)/);
  assert.match(e2e, /getByTestId\("build-analyzed-draft"\)/);
  assert.match(e2e, /getByTestId\("open-visual-editor"\)/);
});
