import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");

const helperCode = ts.transpileModule(
  read("apps/admin/src/studio/localDraftState.ts"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const helper = await import(
  "data:text/javascript;base64," +
    Buffer.from(helperCode).toString("base64"),
);

function project(updated, syncedAt) {
  return {
    schema: 1,
    id: "project",
    name: "Autosave",
    updated,
    assets: [],
    releases: [],
    scene: {
      scale: 1,
      floors: [{ id: "ground", name: "Ground", elevation: 0 }],
      rooms: [],
      furniture: [],
    },
    ...(syncedAt
      ? { cloud: { revision: 3, syncedAt } }
      : {}),
  };
}

test("local timestamp helper preserves reload state and detects cloud divergence", () => {
  const localOnly = project("2026-09-29T10:00:00.000Z");
  assert.equal(helper.projectAheadOfCloud(localOnly), false);

  const synced = project(
    "2026-09-29T10:00:00.000Z",
    "2026-09-29T10:00:00.000Z",
  );
  assert.equal(helper.projectAheadOfCloud(synced), false);

  const changed = helper.withLocalSaveTimestamp(
    synced,
    new Date("2026-09-29T10:00:01.000Z"),
  );
  assert.equal(
    changed.updated,
    "2026-09-29T10:00:01.000Z",
  );
  assert.equal(helper.projectAheadOfCloud(changed), true);
});

test("Studio debounces local edits into IndexedDB without marking cloud synchronized", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  const readiness = read("apps/admin/src/studio/readiness.ts");

  assert.match(studio, /window\.setTimeout\(\(\) => \{/);
  assert.match(studio, /\}, 650\)/);
  assert.match(studio, /storage[\s\S]*\.save\(next\)/);
  assert.match(studio, /setDirty\(false\)/);
  assert.match(studio, /if \(next\.cloud\) setCloudDirty\(true\)/);
  assert.match(studio, /projectAheadOfCloud\(p\)/);
  assert.match(studio, /Autosaved/);
  assert.match(studio, /Save to cloud before switching a release/);

  assert.match(readiness, /cloudDirty: boolean/);
  assert.match(readiness, /Local draft is newer than cloud/);
  assert.match(readiness, /work is autosaved in this browser/);
});

test("production browser entry no longer depends on legacy Studio autosave UI", () => {
  const main = read("apps/admin/src/main.tsx");
  const e2e = read("e2e/automatic-engine-entry.spec.ts");

  assert.doesNotMatch(main, /lazy\(\(\) => import\("\.\/studio\/Studio"\)\)/);
  assert.match(main, /window\.location\.replace\(`\/3Dprojects\/source-pack/);
  assert.match(e2e, /\/3Dprojects\/studio\?project=e2e-project/);
  assert.match(e2e, /\/3Dprojects\/source-pack\\\?project=e2e-project/);
  assert.doesNotMatch(e2e, /Save local|Autosaved/);
});
