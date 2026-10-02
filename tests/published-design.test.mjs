import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import "fake-indexeddb/auto";
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (text) =>
  "data:text/javascript;base64," + Buffer.from(text).toString("base64");
const slugPolicyUrl = url(
  fs.readFileSync("shared/project-slug-policy.js", "utf8"),
);
const domainUrl = url(
  compile("apps/admin/src/studio/domain.ts").replace(
    /(["'])\.\.\/\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js\1/,
    JSON.stringify(slugPolicyUrl),
  ),
);
const storageUrl = url(
  compile("apps/admin/src/studio/storage.ts").replace(
    '"./domain"',
    JSON.stringify(domainUrl),
  ),
);
const publicationUrl = url(
  compile("apps/admin/src/studio/published.ts")
    .replace(/(['"])\.\/domain\1/, JSON.stringify(domainUrl))
    .replace(/(['"])\.\/storage\1/, JSON.stringify(storageUrl)),
);
const { newProject, validateProject } = await import(domainUrl);
const { makeAsset, projects } = await import(storageUrl);
const { loadPublished, importPublished } = await import(publicationUrl);

test("published loader verifies bytes; editable copies cannot overwrite original or each other", async () => {
  const p = { ...newProject("Published test"), slug: "published-test" };
  const a = await makeAsset(
    new File(["model"], "source.glb", { type: "model/gltf-binary" }),
    p.id,
  );
  p.assets = [a.id];
  p.scene.modelId = a.id;
  const metadata = { ...a, path: a.hash + ".glb" };
  delete metadata.blob;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (path) =>
    path.endsWith("manifest.json")
      ? Response.json({ project: p, assets: [metadata] })
      : new Response(a.blob);
  try {
    const d = await loadPublished("published-test");
    assert.equal(await d.files[0].blob.text(), "model");
    const copy1 = await importPublished("published-test"),
      copy2 = await importPublished("published-test");
    assert.notEqual(copy1.id, p.id);
    assert.notEqual(copy1.id, copy2.id);
    assert.notEqual(copy1.scene.modelId, copy2.scene.modelId);
    assert.equal(
      (await projects()).some((x) => x.id === p.id),
      false,
    );
    globalThis.fetch = async (path) =>
      path.endsWith("manifest.json")
        ? Response.json({ project: p, assets: [metadata] })
        : new Response("other");
    await assert.rejects(loadPublished("published-test"), /checksum mismatch/);
    metadata.path = "../private.glb";
    await assert.rejects(
      loadPublished("published-test"),
      /Invalid published asset/,
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});
