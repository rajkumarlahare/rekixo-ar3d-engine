import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  "packages/contracts/src/runtime-validation.ts",
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { assertAdminStatusPayload } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);

function status(url) {
  const model = {
    id: "model_jyoti_exterior_v1",
    projectId: "project_jyoti_paradise",
    name: "Jyoti Paradise Exterior",
    version: 2,
    mimeType: "model/gltf-binary",
    available: true,
    byteSize: 4033620,
    sourceFilename: "jyoti model.fbx",
    url,
  };
  return {
    project: {
      id: "project_jyoti_paradise",
      slug: "jyoti-paradise",
      name: "Jyoti Paradise",
      status: "published",
    },
    scenes: [],
    models: [model],
    activeModel: model,
    storage: {
      bucket: "rekixo-3d-assets",
      activeModelObjectAvailable: true,
    },
    modelPage: {
      limit: 50,
      offset: 0,
      total: 1,
      hasMore: false,
    },
  };
}

test("admin status accepts secure absolute Engine model URLs", () => {
  assert.doesNotThrow(() =>
    assertAdminStatusPayload(
      status(
        "https://ar3dstudio.in/3Dprojects/api/models/model_jyoti_exterior_v1/content",
      ),
    ),
  );
});

test("admin status continues to accept relative Engine model URLs", () => {
  assert.doesNotThrow(() =>
    assertAdminStatusPayload(
      status("/3Dprojects/api/models/model_jyoti_exterior_v1/content"),
    ),
  );
});

test("admin status rejects insecure or non-Engine model URLs", () => {
  assert.throws(
    () =>
      assertAdminStatusPayload(
        status(
          "http://ar3dstudio.in/3Dprojects/api/models/model_jyoti_exterior_v1/content",
        ),
      ),
    /Invalid model payload/,
  );
  assert.throws(
    () =>
      assertAdminStatusPayload(
        status("https://example.com/not-an-engine-model"),
      ),
    /Invalid model payload/,
  );
});


test("admin worker prefers immutable release model/scenes when legacy registry is empty", () => {
  const worker = fs.readFileSync("workers/admin.mjs", "utf8");

  assert.match(worker, /let immutableExperience/);
  assert.match(worker, /activeReleaseState\(env, slug\)/);
  assert.match(worker, /experienceFromActiveReleaseState\(releaseState\)/);
  assert.match(worker, /const activeModel = immutableModel \?\? mutableActiveModel/);
  assert.match(worker, /const scenes = immutableScenes\.length \? immutableScenes : mutableScenes/);
});

test("admin status accepts immutable release model URL shape", () => {
  const payload = status(
    "/3Dprojects/api/releases/release_123/models/model_123/model.glb?v=1",
  );
  payload.models = [];
  payload.modelPage.total = 0;
  payload.activeModel = {
    id: "model_123",
    projectId: "project_jyoti_paradise",
    name: "Published immutable model",
    version: 1,
    mimeType: "model/gltf-binary",
    available: true,
    byteSize: 25582856,
    url: "/3Dprojects/api/releases/release_123/models/model_123/model.glb?v=1",
  };
  assert.doesNotThrow(() => assertAdminStatusPayload(payload));
});
