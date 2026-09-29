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

const slugPolicyUrl = url(
  fs.readFileSync("shared/project-slug-policy.js", "utf8"),
);
const domainUrl = url(
  compile("apps/admin/src/studio/domain.ts").replace(
    /(["'])\.\.\/\.\.\/\.\.\/\.\.\/shared\/project-slug-policy\.js\1/,
    JSON.stringify(slugPolicyUrl),
  ),
);
const associatorUrl = url(
  compile("apps/admin/src/studio/openingAssociator.ts").replace(
    /(["'])\.\/domain\1/,
    JSON.stringify(domainUrl),
  ),
);
const { newProject } = await import(domainUrl);
const { suggestOpeningAssociations } = await import(associatorUrl);

function sceneFixture() {
  const project = newProject("Opening association");
  const floorId = project.scene.floors[0].id;
  project.scene.rooms.push(
    {
      id: "left-room",
      name: "Living",
      floorId,
      unit: "101",
      x: -2,
      z: 0,
      width: 4,
      depth: 4,
      height: 2.8,
      color: "#dddddd",
      source: "",
      verified: false,
    },
    {
      id: "right-room",
      name: "Bedroom",
      floorId,
      unit: "101",
      x: 2,
      z: 0,
      width: 4,
      depth: 4,
      height: 2.8,
      color: "#dddddd",
      source: "",
      verified: false,
    },
  );
  return project.scene;
}

test("door candidate on a shared wall associates two mapped rooms", () => {
  const scene = sceneFixture();
  const suggestions = suggestOpeningAssociations(
    {
      floorCandidates: [{ elevation: 0, confidence: 0.95, evidenceCount: 8 }],
      architecturalCandidates: [
        {
          nodeName: "Door_101_Living_Bed",
          occurrence: 1,
          kind: "door",
          confidence: 0.96,
          floorIndex: 0,
          position: [0, 1.05, 0],
          size: [0.12, 2.1, 0.9],
          reasons: ["source name/material says door"],
        },
      ],
    },
    scene,
  );

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].ready, true);
  assert.deepEqual(new Set(suggestions[0].roomIds), new Set(["left-room", "right-room"]));
  assert.equal(suggestions[0].wallDistance, 0);
  assert.equal(suggestions[0].width, 0.9);
  assert.equal(suggestions[0].height, 2.1);
});

test("window candidate on an exterior wall stays single-room and keeps sill height", () => {
  const scene = sceneFixture();
  const suggestions = suggestOpeningAssociations(
    {
      floorCandidates: [{ elevation: 0, confidence: 0.95, evidenceCount: 8 }],
      architecturalCandidates: [
        {
          nodeName: "Window_Living_01",
          occurrence: 1,
          kind: "window",
          confidence: 0.97,
          floorIndex: 0,
          position: [-4, 1.6, 0],
          size: [0.12, 1.2, 1.2],
          reasons: ["source name/material says window"],
        },
      ],
    },
    scene,
  );

  assert.equal(suggestions[0].ready, true);
  assert.deepEqual(suggestions[0].roomIds, ["left-room"]);
  assert.equal(suggestions[0].sillHeight, 1);
});

test("candidate far from mapped walls remains review-only", () => {
  const scene = sceneFixture();
  const suggestions = suggestOpeningAssociations(
    {
      floorCandidates: [{ elevation: 0, confidence: 0.95, evidenceCount: 8 }],
      architecturalCandidates: [
        {
          nodeName: "Door_Unrelated",
          occurrence: 1,
          kind: "door",
          confidence: 0.99,
          floorIndex: 0,
          position: [20, 1.05, 20],
          size: [0.12, 2.1, 0.9],
          reasons: ["source name/material says door"],
        },
      ],
    },
    scene,
  );

  assert.equal(suggestions[0].ready, false);
  assert.equal(suggestions[0].roomIds.length, 0);
});
