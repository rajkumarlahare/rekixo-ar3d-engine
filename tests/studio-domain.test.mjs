import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
const code = ts.transpileModule(
  fs.readFileSync("apps/admin/src/studio/domain.ts", "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const {
  newProject,
  validateProject,
  snapshot,
  canWalk,
  duplicateFloor,
  projectSlug,
  validStudioSlug,
} = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
function fixture() {
  const p = newProject("Courtyard");
  p.scene.rooms.push({
    id: "living",
    name: "Living",
    unit: "A1",
    floorId: p.scene.floors[0].id,
    x: 10,
    z: -5,
    width: 4,
    depth: 4,
    height: 2.8,
    color: "#dddddd",
    source: "Drawing A, page 2",
    verified: true,
  });
  return p;
}
test("separate projects have distinct identity and floor IDs", () => {
  const a = newProject("A"),
    b = newProject("B");
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.scene.floors[0].id, b.scene.floors[0].id);
});
test("review snapshot survives subsequent furniture and room editing", () => {
  const p = fixture(),
    v = snapshot(p, "First review");
  v.scene.rooms[0].width = 8;
  assert.equal(v.releases[0].scene.rooms[0].width, 4);
  assert.equal(p.releases.length, 0);
});
test("reviewed measurements require evidence and reject impossible dimensions", () => {
  const p = fixture();
  p.scene.rooms[0].source = "";
  assert.throws(() => validateProject(p));
  p.scene.rooms[0].verified = false;
  p.scene.rooms[0].width = Infinity;
  assert.throws(() => validateProject(p));
});
test("orphan room/furniture and model references cannot be saved", () => {
  const p = fixture();
  p.scene.rooms[0].floorId = "other-project";
  assert.throws(() => validateProject(p));
  const q = fixture();
  q.scene.modelId = "missing";
  assert.throws(() => validateProject(q));
});
test("rotated furniture must fit within measured room walls", () => {
  const p = fixture();
  p.scene.furniture.push({
    id: "f1",
    kind: "sofa",
    roomId: "living",
    x: 1.6,
    z: 0,
    rotation: 0,
    color: "#cccccc",
  });
  assert.throws(() => validateProject(p));
  p.scene.furniture[0].rotation = 90;
  p.scene.furniture[0].x = 1.5;
  assert.doesNotThrow(() => validateProject(p));
});
test("walk cannot cross wall or rotated furniture; empty floor stays walkable", () => {
  const p = fixture(),
    r = p.scene.rooms[0];
  p.scene.furniture.push({
    id: "f1",
    kind: "sofa",
    roomId: r.id,
    x: 0,
    z: 0,
    rotation: 90,
    color: "#cccccc",
  });
  assert.equal(canWalk(p.scene, r, 12, -5), false);
  assert.equal(canWalk(p.scene, r, 10, -5), false);
  assert.equal(canWalk(p.scene, r, 11.4, -3.6), true);
  assert.equal(canWalk(p.scene, r, 10, -4.1), false);
});
test("snapshot and asset limits reject oversized or ambiguous projects", () => {
  const p = fixture();
  p.assets = ["a", "a"];
  assert.throws(() => validateProject(p));
  const q = fixture();
  q.scene.rooms.push({ ...q.scene.rooms[0] });
  assert.throws(() => validateProject(q));
});
test("slugs are stable for legacy projects and reject reserved or unsafe routes", () => {
  const p = fixture();
  assert.equal(projectSlug(p), projectSlug(structuredClone(p)));
  for (const slug of [
    "studio",
    "api",
    "assets",
    "../other",
    "A B",
    "x",
    "a".repeat(81),
  ])
    assert.equal(validStudioSlug(slug), false);
  p.slug = "garden-residences";
  p.name = "Renamed display name";
  assert.equal(projectSlug(p), "garden-residences");
  validateProject(p);
});
test("furnished floor copy remaps rooms and furniture without claiming source verification", () => {
  const p = fixture();
  p.scene.rooms[0].mesh = "source-mesh";
  p.scene.furniture.push({
    id: "sofa",
    kind: "sofa",
    roomId: "living",
    x: 0,
    z: 0,
    rotation: 0,
    color: "#cccccc",
  });
  const copy = duplicateFloor(p, p.scene.floors[0].id);
  assert.equal(p.scene.rooms.length, 1);
  assert.equal(copy.scene.rooms.length, 2);
  const room = copy.scene.rooms[1];
  assert.notEqual(room.id, "living");
  assert.equal(room.verified, false);
  assert.equal(room.mesh, undefined);
  assert.equal(copy.scene.furniture[1].roomId, room.id);
  assert.notEqual(copy.scene.furniture[1].id, "sofa");
  assert.equal(copy.scene.floors[1].elevation, 3);
});

test("reference layers and model alignment are validated without mutating source assets", () => {
  const p = fixture();
  p.assets.push("plan-image");
  p.scene.modelTransform = { x: 1.5, y: 0.02, z: -2, rotationY: 17 };
  p.scene.referenceLayers = [
    {
      id: "reference-1",
      assetId: "plan-image",
      visible: true,
      opacity: 0.45,
      metresPerPixel: 0.01,
      x: 0,
      y: 0.01,
      z: 0,
      rotation: 0,
    },
  ];
  assert.doesNotThrow(() => validateProject(p));

  p.scene.referenceLayers[0].opacity = 2;
  assert.throws(() => validateProject(p), /reference layer/i);
  p.scene.referenceLayers[0].opacity = 0.45;
  p.scene.referenceLayers[0].assetId = "missing-reference";
  assert.throws(() => validateProject(p), /Reference layer asset is missing/);
});
