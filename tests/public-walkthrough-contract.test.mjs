import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(
  "packages/contracts/src/runtime-validation.ts",
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { assertPublic3DExperiencePayload } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);

function experience() {
  return {
    project: {
      id: "project_1",
      slug: "garden-heights",
      name: "Garden Heights",
      status: "published",
    },
    walkthrough: {
      version: 1,
      metresPerUnit: 1,
      rooms: [
        {
          id: "room_left",
          floorId: "floor_1",
          name: "Living",
          unit: "101",
          elevation: 0,
          height: 2.8,
          boundary: [
            [-4, -2],
            [0, -2],
            [0, 2],
            [-4, 2],
          ],
        },
        {
          id: "room_right",
          floorId: "floor_1",
          name: "Bedroom",
          unit: "101",
          elevation: 0,
          height: 2.8,
          boundary: [
            [0, -2],
            [4, -2],
            [4, 2],
            [0, 2],
          ],
        },
      ],
      doors: [
        {
          id: "door_1",
          floorId: "floor_1",
          roomIds: ["room_left", "room_right"],
          x: 0,
          y: 1.05,
          z: 0,
          width: 0.9,
          height: 2.1,
          rotationY: -90,
        },
      ],
    },
  };
}

test("public experience validator accepts reviewed walkthrough graphs", () => {
  assert.doesNotThrow(() => assertPublic3DExperiencePayload(experience()));
});

test("public experience validator rejects doors that point outside published rooms", () => {
  const payload = experience();
  payload.walkthrough.doors[0].roomIds[1] = "missing";
  assert.throws(
    () => assertPublic3DExperiencePayload(payload),
    /walkthrough door/i,
  );
});

test("public experience validator rejects malformed room boundaries", () => {
  const payload = experience();
  payload.walkthrough.rooms[0].boundary = [[0, 0], [1, 1]];
  assert.throws(
    () => assertPublic3DExperiencePayload(payload),
    /walkthrough room/i,
  );
});
