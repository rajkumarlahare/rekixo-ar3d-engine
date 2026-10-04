import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");
const compile = (path) =>
  ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const slugPolicyUrl = url(read("shared/project-slug-policy.js"));
const domainCode = compile("apps/admin/src/studio/domain.ts").replace(
  /(["'])\.\.\/\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js\1/,
  JSON.stringify(slugPolicyUrl),
);
const domainUrl = url(domainCode);
const domain = await import(domainUrl);

const integrityUrl = url(
  compile("apps/admin/src/studio/sceneGeometryIntegrity.ts").replace(
    /(["'])\.\/domain\1/,
    JSON.stringify(domainUrl),
  ),
);
const reviewQueueUrl = url(
  compile("apps/admin/src/studio/actionableReviewQueue.ts"),
);

let readinessCode = compile("apps/admin/src/studio/readiness.ts");
readinessCode = readinessCode.replace(
  /(["'])\.\/domain\1/,
  JSON.stringify(domainUrl),
);
readinessCode = readinessCode
  .replace(/(["'])\.\/sceneGeometryIntegrity\1/, JSON.stringify(integrityUrl))
  .replace(/(["'])\.\/actionableReviewQueue\1/, JSON.stringify(reviewQueueUrl));
const readiness = await import(url(readinessCode));

const workerSnapshot = await import(
  url(read("workers/studio-draft-validation.mjs")),
);

test("publish readiness blocks duplicate floor geometry and recovers after correction", () => {
  const project = domain.newProject("Geometry gate");
  project.assets = ["web-glb"];
  project.scene.modelId = "web-glb";
  project.cloud = { revision: 1, syncedAt: "2026-10-03T00:00:00Z" };
  const files = [{
    id: "web-glb", projectId: project.id, name: "web.glb",
    type: "model/gltf-binary", size: 4, hash: "a".repeat(64),
    blob: new Blob(["test"]),
  }];
  const inspect = () => readiness.buildStudioReadiness(
    project, files, false, { authenticated: true }, [],
  );
  assert.equal(inspect().publishable, true);

  project.scene.floors.push({
    id: "duplicate-floor", name: "Duplicate", elevation: 0,
  });
  const blocked = inspect();
  assert.equal(blocked.publishable, false);
  assert.ok(blocked.blockers.some((item) => item.id === "scene-integrity"));
  const action = blocked.reviewQueue.blockers.find(
    (item) => item.entityId === "duplicate-floor",
  );
  assert.ok(action);
  assert.match(action.action, /Correct or merge/);

  project.scene.floors[1].elevation = 3;
  assert.equal(inspect().publishable, true);
  assert.equal(inspect().geometryIntegrity.counts.blocker, 0);
});

test("Studio scene can retain FBX for authoring and a distinct GLB for publish", () => {
  const project = domain.newProject("Dual model");
  project.assets = ["source-fbx", "web-glb"];
  project.scene.modelId = "source-fbx";
  project.scene.publishModelId = "web-glb";

  assert.doesNotThrow(() => domain.validateProject(project));

  project.scene.publishModelId = "missing";
  assert.throws(
    () => domain.validateProject(project),
    /Publish model asset is missing/,
  );
});

test("publish readiness accepts FBX authoring when a separate web GLB is ready", () => {
  const project = domain.newProject("Dual model readiness");
  project.assets = ["source-fbx", "web-glb"];
  project.scene.modelId = "source-fbx";
  project.scene.publishModelId = "web-glb";
  project.cloud = {
    revision: 1,
    syncedAt: "2026-09-29T00:00:00.000Z",
  };

  const files = [
    {
      id: "source-fbx",
      projectId: project.id,
      name: "source.fbx",
      type: "application/octet-stream",
      size: 1024,
      hash: "a".repeat(64),
      blob: new Blob(["source"]),
    },
    {
      id: "web-glb",
      projectId: project.id,
      name: "web.glb",
      type: "model/gltf-binary",
      size: 2048,
      hash: "b".repeat(64),
      blob: new Blob(["web"]),
    },
  ];

  const result = readiness.buildStudioReadiness(
    project,
    files,
    false,
    {
      configured: true,
      databaseReady: true,
      authenticated: true,
      user: { email: "owner@example.com" },
    },
    [],
  );

  assert.equal(
    result.blockers.some((item) => item.id === "model-format"),
    false,
  );
  assert.equal(result.modelAsset.id, "web-glb");
  assert.equal(result.sourceModelAsset.id, "source-fbx");
  assert.ok(
    result.items.some(
      (item) =>
        item.id === "authoring-model" &&
        /Source model retained for authoring/.test(item.title),
    ),
  );
  assert.ok(
    result.items.some(
      (item) =>
        item.id === "model-format" &&
        item.severity === "ready" &&
        /Web publish model ready/.test(item.title),
    ),
  );
});

test("public immutable Studio snapshot swaps source model for publish model", () => {
  const draft = {
    schema: 1,
    id: "project",
    name: "Sample Project",
    slug: "sample-project",
    updated: "2026-09-29T00:00:00.000Z",
    assets: ["source-fbx", "web-glb"],
    releases: [],
    scene: {
      modelId: "source-fbx",
      publishModelId: "web-glb",
      scale: 1,
      floors: [{ id: "floor", name: "Ground", elevation: 0 }],
      rooms: [],
      furniture: [],
    },
  };

  const publicProject = workerSnapshot.publicStudioSnapshot(draft);
  assert.equal(publicProject.scene.modelId, "web-glb");
  assert.deepEqual(publicProject.assets, ["web-glb"]);
  assert.equal("publishModelId" in publicProject.scene, false);
});


test("cloud and immutable release route the explicit publish GLB", () => {
  const cloud = read("apps/admin/src/studio/cloud.ts");
  const validation = read("workers/studio-draft-validation.mjs");
  const release = read("workers/release-publish.mjs");

  assert.match(
    cloud,
    /assetId === project\.scene\.publishModelId/,
  );
  assert.match(
    validation,
    /scene\.publishModelId !== undefined/,
  );
  assert.match(
    validation,
    /requestedModelId =[\s\S]*scene\?\.publishModelId/,
  );
  assert.match(
    release,
    /explicitStudioPublishModelId =[\s\S]*scene\?\.publishModelId/,
  );
  assert.match(
    release,
    /experience\.model && !explicitStudioPublishModelId/,
  );
  assert.match(
    release,
    /studioReleaseModelId =[\s\S]*publishModelId[\s\S]*modelId/,
  );
  assert.match(
    release,
    /Studio customer release model must be a self-contained GLB/,
  );
  assert.match(
    release,
    /experience\.scenes = experience\.scenes\.map/,
  );
});

test("copy/import paths remap publishModelId with the rest of project assets", () => {
  const storage = read("apps/admin/src/studio/storage.ts");
  const published = read("apps/admin/src/studio/published.ts");

  assert.match(storage, /if \(s\.publishModelId\)/);
  assert.match(storage, /if \(p\.scene\.publishModelId\)/);
  assert.match(published, /if \(scene\.publishModelId\)/);
});
