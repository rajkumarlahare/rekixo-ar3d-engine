import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const PRODUCTION_PROTECTION_WORKER = "workers/project-deletion.mjs";

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test("generic viewer and Studio keep shared profile registries project-neutral", () => {
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  const studio = read("apps/admin/src/studio/SceneCanvas.tsx");
  const modelRegistry = read("packages/model-profiles/src/index.ts");
  const projectRegistry = read("apps/public/src/viewer/projectProfiles.ts");
  const sourceRegistry = read("project-profiles/studio-source-profiles.ts");

  assert.match(studio, /@rekixo\/3d-model-profiles/);
  assert.match(viewer, /\.\/projectProfiles/);
  assert.match(modelRegistry, /return undefined/);
  assert.match(projectRegistry, /createSemanticStudioExperience/);
  assert.match(projectRegistry, /return semantic/);
  assert.doesNotMatch(projectRegistry, /jyoti-paradise|Jyoti Paradise/i);
  assert.match(sourceRegistry, /studioSourceProfiles = \[\] as const/);
});

test("no active runtime/profile/published file contains legacy project identity", () => {
  const roots = [
    "apps",
    "packages",
    "workers",
    "project-profiles",
    "published",
  ];
  const violations = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      if (!/\.(?:ts|tsx|js|mjs|json|jsonc|md)$/i.test(file)) continue;
      const normalized = file.split(path.sep).join("/");
      // The deletion worker contains a narrow, temporary production safety lock.
      // It is not a tenant/profile fallback and is covered by dedicated tests.
      if (normalized === PRODUCTION_PROTECTION_WORKER) continue;
      const source = read(file);
      if (
        /jyoti-paradise|Jyoti Paradise|reference-source-v9|project_jyoti|model_jyoti|scene_jyoti/i.test(
          source,
        )
      )
        violations.push(normalized);
    }
  }
  assert.deepEqual(violations, []);
});

test("no project-specific static publication remains in repository", () => {
  const files = walk("published").filter((file) => file.endsWith(".json"));
  assert.deepEqual(files, []);
});

test("bundle gate rejects project-specific chunks from returning", () => {
  const root = JSON.parse(read("package.json"));
  const budget = read("scripts/check-bundle-budgets.mjs");
  assert.match(root.scripts.test, /npm run test:bundles/);
  assert.match(
    budget,
    /referenceSource\|referenceMaterials\|source-textures\|projectExperience/,
  );
});

test("Studio propagates local FBX source hash only as source evidence", () => {
  const studio = read("apps/admin/src/studio/SceneCanvas.tsx");
  const fbxBlock = studio.match(
    /if \(f\.name\.toLowerCase\(\)\.endsWith\("\.fbx"\)\) \{[\s\S]*?\} else \{/,
  )?.[0];

  assert.ok(fbxBlock, "FBX parse block should stay explicit");
  assert.match(fbxBlock, /object\.userData\.sourceGeometry/);
  assert.match(fbxBlock, /sha256: f\.hash\.toLowerCase\(\)/);
  assert.doesNotMatch(
    studio.slice(studio.indexOf("} else {"), studio.indexOf("if (cancelled)")),
    /sha256:\s*f\.hash/,
  );
});
