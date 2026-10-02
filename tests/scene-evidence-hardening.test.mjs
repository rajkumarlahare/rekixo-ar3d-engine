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

const pack = {
  format: "rekixo-source-pack",
  version: 1,
  project: { id: "project_sample", slug: "sample-project", name: "Sample Project" },
  sources: [
    {
      id: "source-model",
      filename: "building.fbx",
      mediaType: "application/octet-stream",
      byteSize: 100,
      sha256: "a".repeat(64),
      role: "source-model",
      authority: "primary",
      capabilities: ["geometry", "openings"],
    },
    {
      id: "source-plan",
      filename: "floor-plan.dwg",
      mediaType: "image/vnd.dwg",
      byteSize: 200,
      sha256: "b".repeat(64),
      role: "drawing",
      authority: "primary",
      capabilities: ["dimensions", "openings"],
    },
  ],
  precedence: [
    { capability: "geometry", orderedSourceIds: ["source-model"] },
    { capability: "dimensions", orderedSourceIds: ["source-plan"] },
    { capability: "openings", orderedSourceIds: ["source-plan", "source-model"] },
  ],
  claims: [
    {
      id: "claim-size",
      sourceId: "source-plan",
      key: "room.size",
      value: [4, 3],
      status: "source-stated",
    },
    {
      id: "claim-conflict",
      sourceId: "source-plan",
      key: "floor.count",
      value: 5,
      status: "conflicted",
    },
  ],
};

const base = {
  format: "rekixo-scene-manifest",
  version: 2,
  project: { id: "project_sample", slug: "sample-project", name: "Sample Project" },
  coordinateSystem: {
    linearUnit: "metre",
    upAxis: "Y",
    handedness: "right",
    modelScaleToMetres: 1,
  },
  assets: [
    {
      id: "asset-model",
      name: "building.fbx",
      mimeType: "application/octet-stream",
      byteSize: 100,
      sha256: "a".repeat(64),
      role: "model",
    },
    {
      id: "asset-plan",
      name: "floor-plan.dwg",
      mimeType: "image/vnd.dwg",
      byteSize: 200,
      sha256: "b".repeat(64),
      role: "reference",
    },
  ],
  models: [
    {
      id: "model-shell",
      assetId: "asset-model",
      role: "shell",
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
  ],
  sites: [{ id: "site-1", name: "Site" }],
  buildings: [{ id: "building-1", siteId: "site-1", name: "Building" }],
  floors: [{ id: "floor-1", buildingId: "building-1", name: "Floor 1", elevationM: 0 }],
  units: [{ id: "unit-1", floorId: "floor-1", name: "Unit 1" }],
  rooms: [
    {
      id: "room-1",
      floorId: "floor-1",
      unitId: "unit-1",
      name: "Living",
      boundary: { kind: "rectangle", center: [0, 0], size: [4, 3] },
      ceilingHeightM: 2.8,
      evidence: {
        status: "unverified",
        sourceAssetId: "asset-plan",
        sourcePackSourceId: "source-plan",
        sourceClaimIds: ["claim-size"],
      },
      meshBindings: [],
    },
  ],
  openings: [],
  furniture: [],
  materials: [],
  cameras: [],
};

test("generic Scene V2 remains source-pack traceable", () => {
  assert.doesNotThrow(() => assertSceneManifestV2(base));
  assert.doesNotThrow(() => assertProjectSourcePackV1(pack));
  assert.doesNotThrow(() => assertSceneSourceEvidenceV2(base, pack));
});

test("room/unit and opening floor references stay consistent", () => {
  const scene = structuredClone(base);
  scene.floors.push({ id: "floor-other", buildingId: "building-1", name: "Other", elevationM: 3 });
  scene.units.push({ id: "unit-other", floorId: "floor-other", name: "Other" });
  scene.rooms[0].unitId = "unit-other";
  assert.throws(() => assertSceneManifestV2(scene), /Invalid scene room/);

  const openingScene = structuredClone(base);
  openingScene.floors.push({ id: "floor-other", buildingId: "building-1", name: "Other", elevationM: 3 });
  openingScene.units.push({ id: "unit-other", floorId: "floor-other", name: "Other" });
  openingScene.rooms.push({
    ...structuredClone(openingScene.rooms[0]),
    id: "room-other",
    floorId: "floor-other",
    unitId: "unit-other",
  });
  openingScene.openings = [{
    id: "door-cross-floor",
    floorId: "floor-1",
    kind: "door",
    roomIds: ["room-1", "room-other"],
    position: [0, 0, 0],
    widthM: 0.9,
    heightM: 2.1,
  }];
  assert.throws(() => assertSceneManifestV2(openingScene), /Invalid scene opening/);
});

test("model instances require model-role assets", () => {
  const scene = structuredClone(base);
  scene.models[0].assetId = "asset-plan";
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
  const altered = structuredClone(pack);
  const plan = altered.sources.find((source) => source.id === "source-plan");
  plan.capabilities = plan.capabilities.filter((capability) => capability !== "openings");
  assert.throws(() => assertProjectSourcePackV1(altered), /Invalid source precedence rule/);
});

test("reviewed evidence cannot rely on a conflicted claim", () => {
  const scene = structuredClone(base);
  scene.rooms[0].evidence = {
    status: "reviewed",
    sourceAssetId: "asset-plan",
    sourcePackSourceId: "source-plan",
    sourceClaimIds: ["claim-conflict"],
  };
  assert.doesNotThrow(() => assertSceneManifestV2(scene));
  assert.throws(
    () => assertSceneSourceEvidenceV2(scene, pack),
    /cannot depend on a conflicted claim/,
  );
});
