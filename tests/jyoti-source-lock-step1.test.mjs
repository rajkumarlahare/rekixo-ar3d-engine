import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Jyoti quick setup is anchored to the canonical source-pack fingerprints", () => {
  const sourcePack = JSON.parse(
    read("project-profiles/jyoti-paradise/source-pack.json"),
  );
  const setup = read("apps/admin/src/studio/sourcePackSetup.ts");
  const profiles = read("project-profiles/studio-source-profiles.ts");

  for (const sourceId of [
    "jyoti-source-fbx",
    "jyoti-source-dwg",
    "jyoti-source-skb",
    "jyoti-source-drs",
    "jyoti-source-brochure",
    "jyoti-source-render",
  ]) {
    assert.ok(
      sourcePack.sources.some((source) => source.id === sourceId),
      `canonical source pack is missing ${sourceId}`,
    );
    assert.match(profiles, new RegExp(sourceId));
  }

  assert.match(setup, /candidate\.hash\.toLowerCase\(\)/);
  assert.match(setup, /candidate\.size === source\.byteSize/);
  assert.match(setup, /import\("\.\.\/\.\.\/\.\.\/\.\.\/project-profiles\/studio-source-profiles"\)/);
  assert.match(profiles, /slug: "jyoti-paradise"/);
  assert.match(profiles, /location: "Hingna, Nagpur"/);
});

test("Project Builder exposes one-click Jyoti source lock status", () => {
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(builder, /SOURCE LOCK DETECTED/);
  assert.match(builder, /Auto setup \$\{quickSetup\.name/);
  assert.match(builder, /Exact SHA-256 source matches/);
  const profiles = read("project-profiles/studio-source-profiles.ts");
  assert.match(profiles, /Primary 3D model/);
  assert.match(profiles, /Brochure \/ floor plan/);
  assert.match(profiles, /Exterior realism reference/);

  assert.match(studio, /detectQuickSourceSetup/);
  assert.match(studio, /applyQuickSourceSetup/);
  assert.match(studio, /autoSetupDetectedSourcePack/);
  assert.match(studio, /duplicate checksum/);
  assert.match(studio, /primary model selected/);
});

test("source-pack drop deduplicates identical bytes before they enter project assets", () => {
  const studio = read("apps/admin/src/studio/Studio.tsx");
  assert.match(studio, /knownHashes = new Set/);
  assert.match(studio, /batchHashes = new Set<string>\(\)/);
  assert.match(
    studio,
    /knownHashes\.has\(hash\) \|\| batchHashes\.has\(hash\)/,
  );
});
