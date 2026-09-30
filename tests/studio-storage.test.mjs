import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import "fake-indexeddb/auto";

// FileReader is the sole browser-only adapter needed by the package encoder.
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob
      .arrayBuffer()
      .then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload();
      })
      .catch((error) => {
        this.error = error;
        this.onerror();
      });
  }
};
const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const slugPolicyUrl = url(
  fs.readFileSync("shared/project-slug-policy.js", "utf8"),
);
const domainUrl = url(
  compile("apps/admin/src/studio/domain.ts").replace(
    /(["'])\.\.\/\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js\1/,
    JSON.stringify(slugPolicyUrl),
  ),
);
const { newProject, snapshot } = await import(domainUrl);
const storage = await import(
  url(
    compile("apps/admin/src/studio/storage.ts").replace(
      '"./domain"',
      JSON.stringify(domainUrl),
    ),
  )
);

test("backup round trip preserves asset bytes and review history with independent IDs", async () => {
  let p = newProject("Courtyard archive");
  const file = await storage.makeAsset(
    new File(["model-bytes"], "building.glb"),
    p.id,
  );
  p.assets.push(file.id);
  p.scene.modelId = file.id;
  p.scene.rooms.push({
    id: "living",
    name: "Living",
    unit: "A1",
    floorId: p.scene.floors[0].id,
    x: 0,
    z: 0,
    width: 4,
    depth: 4,
    height: 2.8,
    color: "#dddddd",
    source: "",
    verified: false,
  });
  p = snapshot(p, "Review 1");
  await storage.save(p, [file]);
  const backup = await storage.exportPackage(p);
  const restored = await storage.importPackage(
    new File([backup], "backup.rekixo.json"),
  );
  assert.notEqual(restored.id, p.id);
  assert.notEqual(restored.scene.modelId, p.scene.modelId);
  assert.equal(restored.releases[0].scene.modelId, restored.scene.modelId);
  assert.equal(restored.releases[0].name, "Review 1");
  const asset = await storage.asset(restored.scene.modelId);
  assert.equal(await asset.blob.text(), "model-bytes");
  assert.equal(asset.hash, file.hash);
  assert.equal(asset.projectId, restored.id);
  restored.name = "Edited copy";
  await storage.save(restored);
  assert.equal(
    (await storage.projects()).find((x) => x.id === p.id).name,
    p.name,
  );
});

test("tampered or incomplete backups do not persist a partial project", async () => {
  const p = newProject("Checksum guard");
  const a = await storage.makeAsset(
    new File(["original"], "reference.pdf"),
    p.id,
  );
  p.assets.push(a.id);
  await storage.save(p, [a]);
  const data = JSON.parse(await (await storage.exportPackage(p)).text());
  const before = (await storage.projects()).length;
  data.files[0].data = Buffer.from("tampered").toString("base64");
  await assert.rejects(
    storage.importPackage(new File([JSON.stringify(data)], "bad.json")),
    /Checksum mismatch/,
  );
  data.files = [];
  await assert.rejects(
    storage.importPackage(new File([JSON.stringify(data)], "missing.json")),
    /missing assets/,
  );
  assert.equal((await storage.projects()).length, before);
});

test("an asset owned by another project is rejected before saving", async () => {
  const p = newProject("Ownership guard");
  const a = await storage.makeAsset(
    new File(["bytes"], "building.glb"),
    "another-project",
  );
  p.assets.push(a.id);
  await assert.rejects(storage.save(p, [a]), /ownership mismatch/);
  assert.equal(
    (await storage.projects()).some((x) => x.id === p.id),
    false,
  );
});
test("slug collisions are rejected atomically even for simultaneous saves", async () => {
  const a = { ...newProject("A"), slug: "shared-slug" };
  const b = { ...newProject("B"), slug: "shared-slug" };
  const results = await Promise.allSettled([storage.save(a), storage.save(b)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await storage.projects()).filter((p) => p.slug === "shared-slug").length,
    1,
  );
});
test("reusing a design creates independent assets and clears review history", async () => {
  const p = newProject("Reusable villa");
  const a = await storage.makeAsset(
    new File(["villa model"], "villa.glb"),
    p.id,
  );
  p.assets.push(a.id);
  p.scene.modelId = a.id;
  await storage.save(p, [a]);
  const copied = await storage.duplicateProject(p);
  assert.notEqual(copied.id, p.id);
  assert.notEqual(copied.scene.modelId, a.id);
  assert.equal(copied.releases.length, 0);
  assert.equal(
    (await storage.asset(copied.scene.modelId)).projectId,
    copied.id,
  );
  assert.equal(
    await (await storage.asset(copied.scene.modelId)).blob.text(),
    "villa model",
  );
  copied.scene.scale = 2;
  await storage.save(copied);
  assert.equal(
    (await storage.projects()).find((x) => x.id === p.id).scene.scale,
    1,
  );
});


test("cloud-linked design copies clear project-specific review evidence", async () => {
  const p = newProject("Cloud source");
  p.slug = "cloud-source";
  p.cloud = { revision: 4, syncedAt: new Date().toISOString() };
  const model = await storage.makeAsset(
    new File(["model"], "building.glb", { type: "model/gltf-binary" }),
    p.id,
  );
  const drawing = await storage.makeAsset(
    new File(["drawing"], "plan.pdf", { type: "application/pdf" }),
    p.id,
  );
  p.assets = [model.id, drawing.id];
  p.scene.modelId = model.id;
  const floorId = p.scene.floors[0].id;
  p.scene.rooms.push({
    id: "evidence-room",
    name: "Living",
    unit: "A1",
    floorId,
    x: 0,
    z: 0,
    width: 4,
    depth: 3,
    height: 2.8,
    color: "#dddddd",
    source: "Plan",
    verified: true,
    sourceAssetId: drawing.id,
    sourcePackSourceId: "source-plan",
    sourceClaimIds: ["claim-room"],
    mesh: "LivingMesh",
  });
  p.scene.openings = [{
    id: "door-reviewed",
    floorId,
    kind: "door",
    roomIds: ["evidence-room"],
    x: 0,
    y: 1.05,
    z: -1.5,
    width: 0.9,
    height: 2.1,
    rotationY: 0,
    reviewed: true,
    sourceNodeName: "DoorMesh",
    sourceOccurrence: 1,
    confidence: 0.98,
  }];
  p.scene.modelNodeTags = [{
    nodeName: "DoorMesh",
    occurrence: 1,
    floorId,
    unit: "A1",
    roomId: "evidence-room",
    assignment: "manual",
    confidence: 1,
    semantic: "door",
    semanticAssignment: "manual",
    semanticConfidence: 1,
  }];
  await storage.save(p, [model, drawing]);

  const copied = await storage.duplicateProject(p);
  assert.equal(copied.cloud, undefined);
  assert.notEqual(copied.id, p.id);
  assert.notEqual(copied.scene.modelId, model.id);
  assert.equal(copied.scene.rooms[0].verified, false);
  assert.equal(copied.scene.rooms[0].sourceAssetId, undefined);
  assert.equal(copied.scene.rooms[0].sourcePackSourceId, undefined);
  assert.equal(copied.scene.rooms[0].sourceClaimIds, undefined);
  assert.equal(copied.scene.rooms[0].mesh, undefined);
  assert.match(copied.scene.rooms[0].source, /review for this project/i);
  assert.equal(copied.scene.openings[0].reviewed, false);
  assert.equal(copied.scene.openings[0].sourceNodeName, undefined);
  assert.equal(copied.scene.openings[0].confidence, undefined);
  assert.deepEqual(copied.scene.modelNodeTags, []);
});


test("existing cloud identity adoption preserves the working draft and conflicting local cache", async () => {
  const targetId = "project_cloud_identity_12345678";

  const cloudCache = newProject("Jyoti Paradise cloud cache");
  cloudCache.id = targetId;
  cloudCache.slug = "jyoti-paradise-adoption-test";
  cloudCache.cloud = {
    revision: 3,
    syncedAt: new Date().toISOString(),
  };
  const cachedAsset = await storage.makeAsset(
    new File(["old-cache"], "old.glb", { type: "model/gltf-binary" }),
    cloudCache.id,
  );
  cloudCache.assets = [cachedAsset.id];
  cloudCache.scene.modelId = cachedAsset.id;
  await storage.save(cloudCache, [cachedAsset]);

  const local = newProject("Jyoti Paradise working draft");
  local.slug = "jyoti-working-copy-adoption-test";
  const currentAsset = await storage.makeAsset(
    new File(["current-model"], "current.glb", {
      type: "model/gltf-binary",
    }),
    local.id,
  );
  local.assets = [currentAsset.id];
  local.scene.modelId = currentAsset.id;
  local.scene.rooms.push({
    id: "room_adoption_123",
    name: "Living",
    unit: "101",
    floorId: local.scene.floors[0].id,
    x: 0,
    z: 0,
    width: 4,
    depth: 4,
    height: 2.8,
    color: "#dddddd",
    source: "Reviewed local draft",
    verified: true,
  });
  await storage.save(local, [currentAsset]);

  // Match the existing cloud slug only in memory, reproducing a local edit that
  // cannot be persisted because another cached project already owns the slug.
  local.slug = "jyoti-paradise-adoption-test";

  const adopted = await storage.adoptExistingCloudIdentity(
    local,
    [currentAsset],
    {
      id: targetId,
      slug: "jyoti-paradise-adoption-test",
      name: "Jyoti Paradise",
      location: "Hingna, Nagpur",
    },
  );

  assert.equal(adopted.project.id, targetId);
  assert.equal(adopted.project.slug, "jyoti-paradise-adoption-test");
  assert.equal(adopted.project.scene.rooms.length, 1);
  assert.equal(adopted.project.cloud, undefined);
  assert.equal(
    (await storage.asset(currentAsset.id)).projectId,
    targetId,
  );

  assert.equal(adopted.backupProjects.length, 1);
  const backup = adopted.backupProjects[0];
  assert.match(backup.name, /local backup/i);
  assert.notEqual(backup.id, targetId);
  assert.notEqual(backup.slug, "jyoti-paradise-adoption-test");
  assert.equal(backup.cloud, undefined);
  assert.equal(
    (await storage.asset(cachedAsset.id)).projectId,
    backup.id,
  );

  const projects = await storage.projects();
  assert.equal(
    projects.filter((project) => project.slug === "jyoti-paradise-adoption-test")
      .length,
    1,
  );
  assert.equal(
    projects.some((project) => project.id === local.id),
    false,
  );
});
