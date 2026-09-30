import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const url = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const contractUrl = url(compile("packages/contracts/src/scene-manifest-v2.ts"));
const slugPolicyUrl = url(
  fs.readFileSync("shared/project-slug-policy.js", "utf8"),
);
const domainUrl = url(
  compile("apps/admin/src/studio/domain.ts").replace(
    /(["'])\.\.\/\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js\1/,
    JSON.stringify(slugPolicyUrl),
  ),
);
const adapterUrl = url(
  compile("apps/admin/src/studio/manifestV2.ts")
    .replace(/(["'])@rekixo\/3d-contracts\1/, JSON.stringify(contractUrl))
    .replace(/(["'])\.\/domain\1/, JSON.stringify(domainUrl)),
);

const { assertSceneManifestV2 } = await import(contractUrl);
const { newProject } = await import(domainUrl);
const { buildSceneManifestV2 } = await import(adapterUrl);

function fixture() {
  const p = { ...newProject("Garden Heights"), slug: "garden-heights" };
  const floorId = p.scene.floors[0].id;
  p.scene.rooms.push({
    id: "room-living-a1",
    name: "Living",
    floorId,
    unit: "A1",
    x: 10,
    z: -5,
    width: 4,
    depth: 3,
    height: 2.8,
    color: "#dddddd",
    source: "Plan A-101, dimension string",
    verified: true,
    mesh: "Living_A1",
  });
  p.scene.furniture.push({
    id: "furniture-sofa-1",
    kind: "sofa",
    roomId: "room-living-a1",
    x: 0.5,
    z: -0.25,
    rotation: 90,
    color: "#cccccc",
  });
  const model = {
    id: "asset-model",
    projectId: p.id,
    name: "building.glb",
    type: "model/gltf-binary",
    size: 1024,
    hash: "a".repeat(64),
    blob: new Blob(["model"]),
  };
  const drawing = {
    id: "asset-plan",
    projectId: p.id,
    name: "plan.pdf",
    type: "application/pdf",
    size: 512,
    hash: "b".repeat(64),
    blob: new Blob(["plan"]),
  };
  p.assets = [model.id, drawing.id];
  p.scene.modelId = model.id;
  return { p, files: [model, drawing] };
}

test("Studio exports a project-neutral Scene Manifest V2 hierarchy", () => {
  const { p, files } = fixture();
  const manifest = buildSceneManifestV2(p, files);
  assertSceneManifestV2(manifest);

  assert.equal(manifest.format, "rekixo-scene-manifest");
  assert.equal(manifest.version, 2);
  assert.equal(manifest.project.slug, "garden-heights");
  assert.equal(manifest.sites.length, 1);
  assert.equal(manifest.buildings.length, 1);
  assert.equal(manifest.floors[0].buildingId, manifest.buildings[0].id);
  assert.equal(manifest.units.length, 1);
  assert.equal(manifest.units[0].name, "A1");
  assert.equal(manifest.rooms[0].unitId, manifest.units[0].id);
  assert.deepEqual(manifest.rooms[0].boundary, {
    kind: "rectangle",
    center: [10, -5],
    size: [4, 3],
  });
  assert.equal(manifest.rooms[0].evidence.status, "reviewed");
  assert.equal(manifest.rooms[0].meshBindings[0].strategy, "source-node-name");
  assert.equal(manifest.assets.find((a) => a.id === "asset-model").role, "model");
  assert.equal(manifest.assets.find((a) => a.id === "asset-plan").role, "reference");
  assert.equal(manifest.surfaces.length, 6);
  assert.deepEqual(
    manifest.surfaces.map((surface) => surface.id),
    [
      "surface:room-living-a1:floor",
      "surface:room-living-a1:ceiling",
      "surface:room-living-a1:wall:0",
      "surface:room-living-a1:wall:1",
      "surface:room-living-a1:wall:2",
      "surface:room-living-a1:wall:3",
    ],
  );
  assert.equal(manifest.catalogItems.length, 5);
  assert.deepEqual(
    manifest.catalogItems.find((item) => item.id === "sofa").dimensionsM,
    [2.1, 0.8, 0.85],
  );
  assert.equal(manifest.catalogItems.find((item) => item.id === "sofa").source, "procedural");
});

test("V1 editor coordinates map to explicit world furniture transforms", () => {
  const { p, files } = fixture();
  p.scene.floors[0].elevation = 3.2;
  const manifest = buildSceneManifestV2(p, files);
  assert.deepEqual(manifest.furniture[0].transform.position, [10.5, 3.2, -5.25]);
  assert.ok(Math.abs(manifest.furniture[0].transform.rotation[1] - Math.PI / 2) < 1e-9);
  assert.equal(manifest.coordinateSystem.linearUnit, "metre");
  assert.equal(manifest.coordinateSystem.upAxis, "Y");
  assert.equal(manifest.coordinateSystem.handedness, "right");
});

test("unit IDs are deterministic and floor-scoped", () => {
  const { p, files } = fixture();
  const secondFloor = {
    id: "floor-two",
    name: "Second",
    elevation: 3,
  };
  p.scene.floors.push(secondFloor);
  p.scene.rooms.push({
    ...p.scene.rooms[0],
    id: "room-living-a1-second",
    floorId: secondFloor.id,
    mesh: undefined,
  });
  const first = buildSceneManifestV2(p, files);
  const second = buildSceneManifestV2(structuredClone(p), files);
  assert.deepEqual(first.units, second.units);
  assert.equal(first.units.length, 2);
  assert.notEqual(first.units[0].id, first.units[1].id);
});

test("Scene Manifest V2 supports polygon rooms without weakening reference checks", () => {
  const { p, files } = fixture();
  const manifest = buildSceneManifestV2(p, files);
  manifest.rooms[0].boundary = {
    kind: "polygon",
    points: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
  };
  assert.doesNotThrow(() => assertSceneManifestV2(manifest));

  manifest.rooms[0].floorId = "missing-floor";
  assert.throws(() => assertSceneManifestV2(manifest), /Invalid scene room/);
});

test("Studio adapter exports authored polygon rooms without flattening them", () => {
  const { p, files } = fixture();
  p.scene.rooms[0].polygon = [
    [8, -7],
    [12, -7],
    [12, -5],
    [10, -5],
    [10, -3],
    [8, -3],
  ];
  p.scene.rooms[0].x = 10;
  p.scene.rooms[0].z = -5;
  p.scene.rooms[0].width = 4;
  p.scene.rooms[0].depth = 4;
  const manifest = buildSceneManifestV2(p, files);
  assert.deepEqual(manifest.rooms[0].boundary, {
    kind: "polygon",
    points: p.scene.rooms[0].polygon,
  });
  assert.equal(
    manifest.surfaces.filter((surface) => surface.roomId === p.scene.rooms[0].id).length,
    p.scene.rooms[0].polygon.length + 2,
  );
  assertSceneManifestV2(manifest);
});

test("reviewed dimensions cannot lose their evidence in V2", () => {
  const { p, files } = fixture();
  const manifest = buildSceneManifestV2(p, files);
  manifest.rooms[0].evidence = { status: "reviewed" };
  assert.throws(
    () => assertSceneManifestV2(manifest),
    /Reviewed room measurements require evidence/,
  );
});

test("manifest export refuses incomplete or cross-project asset sets", () => {
  const { p, files } = fixture();
  assert.throws(
    () => buildSceneManifestV2(p, files.slice(0, 1)),
    /requires every project asset/,
  );
  const wrong = files.map((file) => ({ ...file }));
  wrong[1].projectId = "another-project";
  assert.throws(
    () => buildSceneManifestV2(p, wrong),
    /requires every project asset/,
  );
});

test("model alignment is exported as an explicit model transform", () => {
  const { p, files } = fixture();
  p.scene.modelTransform = { x: 1.25, y: 0.1, z: -3.5, rotationY: 90 };
  const manifest = buildSceneManifestV2(p, files);
  assert.deepEqual(manifest.models[0].transform.position, [1.25, 0.1, -3.5]);
  assert.ok(
    Math.abs(manifest.models[0].transform.rotation[1] - Math.PI / 2) < 1e-9,
  );
});


test("reviewed Studio openings export into Scene Manifest V2", () => {
  const { p, files } = fixture();
  p.scene.openings = [
    {
      id: "opening-door-1",
      floorId: p.scene.floors[0].id,
      kind: "door",
      roomIds: [p.scene.rooms[0].id],
      x: 8,
      y: 1.05,
      z: -5,
      width: 0.9,
      height: 2.1,
      rotationY: 90,
      reviewed: true,
      sourceNodeName: "Door_Main",
      sourceOccurrence: 1,
      confidence: 0.92,
    },
  ];
  const manifest = buildSceneManifestV2(p, files);
  assert.deepEqual(manifest.openings, [
    {
      id: "opening-door-1",
      floorId: p.scene.floors[0].id,
      kind: "door",
      roomIds: [p.scene.rooms[0].id],
      position: [8, 1.05, -5],
      widthM: 0.9,
      heightM: 2.1,
    },
  ]);
  assertSceneManifestV2(manifest);
});

test("unreviewed Studio opening drafts do not publish into Scene Manifest V2", () => {
  const { p, files } = fixture();
  p.scene.openings = [
    {
      id: "opening-window-draft",
      floorId: p.scene.floors[0].id,
      kind: "window",
      roomIds: [p.scene.rooms[0].id],
      x: 8,
      y: 1.6,
      z: -5,
      width: 1.2,
      height: 1.2,
      sillHeight: 1,
      rotationY: 0,
      reviewed: false,
    },
  ];
  const manifest = buildSceneManifestV2(p, files);
  assert.equal(manifest.openings.length, 0);
});


test("semantic surfaces validate room edges and PBR material references", () => {
  const { p, files } = fixture();
  const manifest = buildSceneManifestV2(p, files);
  manifest.assets.push({
    id: "texture-oak",
    name: "oak-basecolor.ktx2",
    mimeType: "image/ktx2",
    byteSize: 256,
    sha256: "c".repeat(64),
    role: "texture",
  });
  manifest.materials.push({
    id: "material-oak",
    name: "Oak",
    baseColor: "#b58a63",
    roughness: 0.58,
    metalness: 0,
    baseColorTextureAssetId: "texture-oak",
    uvScale: [1.5, 1.5],
  });
  manifest.surfaces[0].finish = { materialId: "material-oak" };
  assert.doesNotThrow(() => assertSceneManifestV2(manifest));

  const wall = manifest.surfaces.find((surface) => surface.kind === "wall");
  wall.edgeIndex = 99;
  assert.throws(
    () => assertSceneManifestV2(manifest),
    /Invalid wall surface edge/,
  );
});

test("catalog items become the authoritative furniture key when present", () => {
  const { p, files } = fixture();
  const manifest = buildSceneManifestV2(p, files);
  manifest.furniture[0].catalogKey = "missing-catalog-item";
  assert.throws(
    () => assertSceneManifestV2(manifest),
    /Invalid scene furniture/,
  );
});

test("older Scene Manifest V2 documents remain valid without interior foundation fields", () => {
  const { p, files } = fixture();
  const manifest = buildSceneManifestV2(p, files);
  delete manifest.surfaces;
  delete manifest.catalogItems;
  assert.doesNotThrow(() => assertSceneManifestV2(manifest));
});
