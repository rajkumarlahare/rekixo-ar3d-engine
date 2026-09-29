import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Jyoti quick setup is anchored to the canonical source-pack fingerprints", () => {
  const sourcePack = JSON.parse(
    read("project-profiles/jyoti-paradise/source-pack.json"),
  );
  const setup = read("apps/admin/src/studio/sourcePackSetup.ts");

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
    assert.match(setup, new RegExp(sourceId));
  }

  assert.match(setup, /asset\.hash\.toLowerCase\(\)/);
  assert.match(setup, /asset\.size === Number\(source\.byteSize\)/);
  assert.match(setup, /slug: "jyoti-paradise"/);
  assert.match(setup, /location: "Hingna, Nagpur"/);
});

test("Project Builder exposes one-click Jyoti source lock status", () => {
  const builder = read("apps/admin/src/studio/SmartProjectBuilder.tsx");
  const studio = read("apps/admin/src/studio/Studio.tsx");

  assert.match(builder, /SOURCE LOCK DETECTED/);
  assert.match(builder, /Auto setup Jyoti Paradise/);
  assert.match(builder, /Exact SHA-256 source matches/);
  assert.match(builder, /Primary 3D model/);
  assert.match(builder, /Brochure \/ floor plan/);
  assert.match(builder, /Exterior realism reference/);

  assert.match(studio, /detectQuickSourceSetup/);
  assert.match(studio, /applyQuickSourceSetup/);
  assert.match(studio, /autoSetupJyotiSourcePack/);
  assert.match(studio, /duplicate checksum/);
  assert.match(studio, /primary FBX selected/);
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
