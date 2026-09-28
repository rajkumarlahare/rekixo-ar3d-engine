import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const sceneUrl = asUrl(compile("packages/contracts/src/scene-manifest-v2.ts"));
const sourceUrl = asUrl(compile("packages/contracts/src/source-pack-v1.ts"));
const evidenceUrl = asUrl(
  compile("packages/contracts/src/scene-source-evidence.ts")
    .replace(/(["'])\.\/scene-manifest-v2\1/, JSON.stringify(sceneUrl))
    .replace(/(["'])\.\/source-pack-v1\1/, JSON.stringify(sourceUrl)),
);

const { assertSceneManifestV2 } = await import(sceneUrl);
const { assertProjectSourcePackV1 } = await import(sourceUrl);
const { assertSceneSourceEvidenceV2 } = await import(evidenceUrl);

const pack = JSON.parse(fs.readFileSync(
  "project-profiles/jyoti-paradise/source-pack.json", "utf8",
));
const base = JSON.parse(fs.readFileSync(
  "project-profiles/jyoti-paradise/interior-scene-v2.json", "utf8",
));

test("Jyoti interior Scene V2 is source-pack traceable", () => {
  assert.doesNotThrow(() => assertSceneManifestV2(base));
  assert.doesNotThrow(() => assertSceneSourceEvidenceV2(base, pack));
  assert.equal(base.openings.length, 0);
  assert.ok(base.rooms.length >= 30);
  for (const room of base.rooms) {
    assert.equal(room.evidence.status, "unverified");
    assert.equal(room.evidence.sourcePackSourceId, "jyoti-source-brochure");
    assert.equal(room.meshBindings.length, 0);
  }
});

test("room/unit and opening floor references stay consistent", () => {
  const scene = structuredClone(base);
  scene.floors.push({ id: "floor-other", buildingId: "building-jyoti", name: "Other", elevationM: 3 });
  scene.units.push({ id: "unit-other", floorId: "floor-other", name: "Other" });
  scene.rooms[0].unitId = "unit-other";
  assert.throws(() => assertSceneManifestV2(scene), /Invalid scene room/);

  const openingScene = structuredClone(base);
  openingScene.floors.push({ id: "floor-other", buildingId: "building-jyoti", name: "Other", elevationM: 3 });
  openingScene.units.push({ id: "unit-other", floorId: "floor-other", name: "Other" });
  openingScene.rooms.push({
    ...structuredClone(openingScene.rooms[0]),
    id: "room-other", floorId: "floor-other", unitId: "unit-other",
  });
  openingScene.openings = [{
    id: "door-cross-floor", floorId: "floor-typical", kind: "door",
    roomIds: ["101-living", "room-other"], position: [0, 0, 0],
    widthM: 0.9, heightM: 2.1,
  }];
  assert.throws(() => assertSceneManifestV2(openingScene), /Invalid scene opening/);
});

test("model instances require model-role assets", () => {
  const scene = structuredClone(base);
  scene.models[0].assetId = "source-brochure";
  assert.throws(() => assertSceneManifestV2(scene), /Invalid scene model/);
});

test("invalid polygons are rejected", () => {
  for (const points of [
    [[0,0],[1,0],[2,0]],
    [[0,0],[2,0],[2,0],[0,2]],
    [[0,0],[2,2],[0,2],[2,0]],
    [[0,0],[2,0],[2,2],[0,2],[0,0]],
  ]) {
    const scene = structuredClone(base);
    scene.rooms[0].boundary = { kind: "polygon", points };
    assert.throws(() => assertSceneManifestV2(scene), /Invalid polygon room boundary/);
  }
});

test("source precedence requires the declared capability", () => {
  assert.doesNotThrow(() => assertProjectSourcePackV1(pack));
  const altered = structuredClone(pack);
  const skb = altered.sources.find((source) => source.id === "jyoti-source-skb");
  skb.capabilities = skb.capabilities.filter((capability) => capability !== "openings");
  assert.throws(() => assertProjectSourcePackV1(altered), /Invalid source precedence rule/);
});

test("reviewed evidence cannot rely on a conflicted claim", () => {
  const scene = structuredClone(base);
  const conflict = pack.claims.find((claim) => claim.status === "conflicted");
  scene.rooms[0].evidence = {
    status: "reviewed",
    sourcePackSourceId: conflict.sourceId,
    sourceClaimIds: [conflict.id],
  };
  assert.doesNotThrow(() => assertSceneManifestV2(scene));
  assert.throws(
    () => assertSceneSourceEvidenceV2(scene, pack),
    /cannot depend on a conflicted claim/,
  );
});

test("project experience consumes Scene V2 room geometry", () => {
  const experience = fs.readFileSync("apps/public/src/viewer/projectExperience.ts", "utf8");
  assert.match(experience, /interior-scene-v2\.json/);
  assert.match(experience, /for \(const room of interiorScene\.rooms\)/);
  assert.doesNotMatch(experience, /addLowRoom\(root, features, "101-living"/);
});
