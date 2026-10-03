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
const authoringUrl = asUrl(
  compile("apps/admin/src/studio/architectureAuthoring.ts").replace(
    /(["'])\.\/domain\1/g,
    JSON.stringify(domainUrl),
  ),
);

const { newProject, validateProject } = await import(domainUrl);
const authoring = await import(authoringUrl);

function addRoom(project, id, x) {
  const floorId = project.scene.floors[0].id;
  project.scene.rooms.push({
    id,
    name: id === "left" ? "Living Room" : "Bedroom",
    floorId,
    unit: "Flat 101",
    x,
    z: 0,
    width: 4,
    depth: 4,
    height: 2.8,
    color: "#d8e8e2",
    source: "Manual test room",
    verified: false,
  });
}

function sharedWallScene() {
  const project = newProject("Architecture authoring");
  addRoom(project, "left", -2);
  addRoom(project, "right", 2);
  const floorId = project.scene.floors[0].id;
  const created = authoring.createManualWall(
    project.scene,
    {
      floorId,
      start: [0, -2],
      end: [0, 2],
      thickness: 0.12,
      height: 2.8,
    },
    () => "wall-1",
  );
  project.scene = created.scene;
  return { project, wall: created.wall };
}

test("Phase 16 manual wall binds to both room boundaries without creation-order guessing", () => {
  const { project, wall } = sharedWallScene();
  assert.deepEqual(new Set(wall.roomIds), new Set(["left", "right"]));
  assert.equal(wall.origin, "manual");
  assert.equal(wall.reviewed, false);
  assert.equal(wall.reviewState, "suggested");
  assert.equal(authoring.wallLength(wall), 4);
  validateProject(project);
});

test("Phase 16 door placement snaps to host wall and stays reviewable", () => {
  const { project, wall } = sharedWallScene();
  const result = authoring.createManualOpening(
    project.scene,
    {
      wallId: wall.id,
      kind: "door",
      x: 0.19,
      z: 0.25,
      width: 0.9,
      height: 2.1,
    },
    () => "door-1",
  );
  project.scene = result.scene;
  assert.equal(result.opening.x, 0);
  assert.ok(Math.abs(result.opening.z - 0.25) < 0.001);
  assert.deepEqual(new Set(result.opening.roomIds), new Set(["left", "right"]));
  assert.equal(result.opening.reviewed, false);
  assert.equal(result.opening.reviewState, "suggested");

  project.scene = authoring.setOpeningReviewed(project.scene, "door-1", true);
  const reviewed = project.scene.openings.find((opening) => opening.id === "door-1");
  assert.equal(reviewed.reviewed, true);
  assert.equal(reviewed.reviewState, "human_reviewed");
  validateProject(project);
});

test("Phase 16 opening dimensions and drag remain constrained to the host wall", () => {
  const { project, wall } = sharedWallScene();
  project.scene = authoring.createManualOpening(
    project.scene,
    {
      wallId: wall.id,
      kind: "window",
      x: 0,
      z: 0,
      width: 1.2,
      height: 1.1,
      sillHeight: 0.9,
    },
    () => "window-1",
  ).scene;

  project.scene = authoring.patchManualOpening(project.scene, "window-1", {
    width: 1.4,
    height: 1.0,
    sillHeight: 1.0,
  });
  let opening = project.scene.openings.find((entry) => entry.id === "window-1");
  assert.equal(opening.width, 1.4);
  assert.equal(opening.height, 1);
  assert.equal(opening.sillHeight, 1);

  project.scene = authoring.moveManualOpening(
    project.scene,
    "window-1",
    [0.31, 1.25],
  );
  opening = project.scene.openings.find((entry) => entry.id === "window-1");
  assert.equal(opening.x, 0);
  assert.ok(Math.abs(opening.z - 1.25) < 0.001);
  assert.equal(opening.reviewed, false);
  validateProject(project);
});

test("Phase 16 moving a wall reprojects hosted openings and invalidates source review state", () => {
  const { project, wall } = sharedWallScene();
  project.scene = authoring.createManualOpening(
    project.scene,
    {
      wallId: wall.id,
      kind: "door",
      x: 0,
      z: 0,
      width: 0.9,
      height: 2.1,
    },
    () => "door-1",
  ).scene;
  project.scene = authoring.setOpeningReviewed(project.scene, "door-1", true);

  project.scene = authoring.patchManualWall(project.scene, wall.id, {
    start: [0.1, -2],
    end: [0.1, 2],
  });
  const movedWall = project.scene.walls.find((entry) => entry.id === wall.id);
  const movedDoor = project.scene.openings.find((entry) => entry.id === "door-1");
  assert.equal(movedWall.start[0], 0.1);
  assert.equal(movedDoor.x, 0.1);
  assert.equal(movedDoor.reviewed, false);
  assert.equal(movedDoor.reviewState, "suggested");
  validateProject(project);
});

test("Phase 16 wall deletion is fail-closed while an opening is hosted", () => {
  const { project, wall } = sharedWallScene();
  project.scene.rooms = project.scene.rooms.map((room) => ({
    ...room,
    verified: true,
  }));
  project.scene = authoring.createManualOpening(
    project.scene,
    {
      wallId: wall.id,
      kind: "door",
      x: 0,
      z: 0,
      width: 0.9,
      height: 2.1,
    },
    () => "door-1",
  ).scene;

  assert.throws(
    () => authoring.removeManualWall(project.scene, wall.id),
    /Remove or move openings/,
  );
  project.scene = authoring.removeManualOpening(project.scene, "door-1");
  project.scene = authoring.removeManualWall(project.scene, wall.id);
  assert.equal(project.scene.walls.length, 0);
  assert.ok(project.scene.rooms.every((room) => room.verified === false));
  validateProject(project);
});

test("Phase 16 rejects geometry that cannot produce a safe wall opening", () => {
  const project = newProject("Invalid architecture");
  addRoom(project, "left", -2);
  const floorId = project.scene.floors[0].id;
  assert.throws(
    () =>
      authoring.createManualWall(
        project.scene,
        {
          floorId,
          start: [0, 0],
          end: [0.05, 0],
          thickness: 0.12,
          height: 2.8,
        },
        () => "bad-wall",
      ),
    /at least 0.2 m/,
  );
});
