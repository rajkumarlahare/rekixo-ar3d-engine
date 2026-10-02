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
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const slugPolicyUrl = asUrl(
  fs.readFileSync("shared/project-slug-policy.js", "utf8"),
);
const domainUrl = asUrl(
  compile("apps/admin/src/studio/domain.ts").replace(
    /(["'])\.\.\/\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js\1/,
    JSON.stringify(slugPolicyUrl),
  ),
);
const placementUrl = asUrl(
  compile("apps/admin/src/studio/furniturePlacement.ts").replace(
    /(["'])\.\/domain\1/g,
    JSON.stringify(domainUrl),
  ),
);
const interiorUrl = asUrl(
  compile("apps/admin/src/studio/autoInteriorDraft.ts")
    .replace(/(["'])\.\/domain\1/g, JSON.stringify(domainUrl))
    .replace(
      /(["'])\.\/furniturePlacement\1/g,
      JSON.stringify(placementUrl),
    ),
);
const { newProject, validateProject } = await import(domainUrl);
const interior = await import(interiorUrl);

function room(project, id, name, x, z, width = 5, depth = 4.5) {
  const floorId = project.scene.floors[0].id;
  project.scene.rooms.push({
    id,
    name,
    floorId,
    unit: "Flat 101",
    x,
    z,
    width,
    depth,
    height: 2.8,
    color: "#d8e8e2",
    source:
      "Auto draft from a closed high-confidence parametric wall loop. Auto semantics matched from aligned uploaded source evidence.",
    verified: false,
  });
}

test("Phase 7 auto interior furnishes supported semantic auto rooms", () => {
  const project = newProject("Auto interior");
  room(project, "living", "Living Room", 0, 0, 5.5, 4.5);
  room(project, "bed", "Bedroom", 7, 0, 5, 4.5);
  room(project, "balcony", "Balcony", 0, 6, 3, 2.5);

  let index = 0;
  const result = interior.buildSourceAutoInterior(
    project.scene,
    () => `auto-${++index}`,
  );
  const living = result.scene.furniture.filter(
    (item) => item.roomId === "living",
  );
  const bedroom = result.scene.furniture.filter(
    (item) => item.roomId === "bed",
  );
  const balcony = result.scene.furniture.filter(
    (item) => item.roomId === "balcony",
  );

  assert.ok(living.some((item) => item.kind === "sofa"));
  assert.ok(living.some((item) => item.kind === "table"));
  assert.ok(bedroom.some((item) => item.kind === "bed"));
  assert.ok(balcony.some((item) => item.kind === "plant"));
  assert.ok(result.created.every((item) => item.origin === "source-auto"));
  assert.ok(result.furnishedRooms >= 3);
  validateProject({ ...project, scene: result.scene });
});

test("Phase 7 auto interior is rerun-safe and preserves manual furniture", () => {
  const project = newProject("Auto interior rerun");
  room(project, "living", "Living Room", 0, 0, 5.5, 4.5);
  room(project, "manual-room", "Bedroom", 7, 0, 5, 4.5);
  project.scene.furniture.push({
    id: "manual-bed",
    kind: "bed",
    roomId: "manual-room",
    x: 0,
    z: 0,
    rotation: 0,
    color: "#d9d3c4",
  });

  let index = 0;
  const first = interior.buildSourceAutoInterior(
    project.scene,
    () => `first-${++index}`,
  );
  const second = interior.buildSourceAutoInterior(
    first.scene,
    () => `second-${++index}`,
  );

  assert.equal(second.created.length, 0);
  assert.equal(
    second.scene.furniture.filter((item) => item.roomId === "manual-room")
      .length,
    1,
  );
  assert.equal(
    second.scene.furniture.find((item) => item.id === "manual-bed")?.origin,
    undefined,
  );
  assert.ok(second.skippedRooms.includes("manual-room"));
});

test("Phase 7 auto interior avoids door clearance and repairs invalid automatic drafts", () => {
  const project = newProject("Opening clearance");
  room(project, "living", "Living Room", 0, 0, 5, 4);
  project.scene.openings = [
    {
      id: "door",
      floorId: project.scene.floors[0].id,
      kind: "door",
      roomIds: ["living"],
      x: -1.1,
      y: 1,
      z: -0.9,
      width: 1,
      height: 2.1,
      rotationY: 0,
      reviewed: false,
      reviewState: "auto_ready",
      confidence: 0.9,
    },
  ];
  project.scene.furniture.push({
    id: "bad-auto",
    kind: "sofa",
    roomId: "living",
    x: -1.1,
    z: -0.9,
    rotation: 0,
    color: "#b9a58d",
    origin: "source-auto",
  });

  let index = 0;
  const result = interior.buildSourceAutoInterior(
    project.scene,
    () => `replacement-${++index}`,
  );

  assert.equal(
    result.scene.furniture.some((item) => item.id === "bad-auto"),
    false,
  );
  assert.equal(result.removedInvalidAutomatic, 1);
  assert.ok(result.scene.furniture.some((item) => item.kind === "sofa"));
  validateProject({ ...project, scene: result.scene });
});
