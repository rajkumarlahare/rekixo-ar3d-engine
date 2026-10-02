import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as THREE from "three";

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const dataUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const floorGeometryUrl = dataUrl(
  compile(fs.readFileSync("apps/public/src/viewer/floorGeometry.ts", "utf8")),
);
let source = fs.readFileSync(
  "apps/public/src/viewer/walkthrough.ts",
  "utf8",
);
source = source
  .replace(
    'import * as THREE from "three";',
    `import * as THREE from ${JSON.stringify(import.meta.resolve("three"))};`,
  )
  .replace(
    'from "./floorGeometry";',
    `from ${JSON.stringify(floorGeometryUrl)};`,
  );
const walkthrough = await import(dataUrl(compile(source)));

const lRoom = {
  id: "l-room",
  floorId: "floor-1",
  name: "L Room",
  unit: "A1",
  elevation: 0,
  height: 2.8,
  boundary: [
    [0, 0],
    [6, 0],
    [6, 2],
    [2, 2],
    [2, 6],
    [0, 6],
  ],
};

test("concave room interior point never falls into the missing corner", () => {
  const point = walkthrough.publicRoomInteriorPoint(lRoom, 0.18);
  assert.equal(
    walkthrough.publicRoomContains(lRoom, point.x, point.z, 0.18),
    true,
  );
  assert.equal(point.x > 2 && point.z > 2, false);
});

test("walk start stays inside concave reviewed rooms", () => {
  const graph = {
    version: 1,
    metresPerUnit: 1,
    rooms: [lRoom],
    doors: [],
  };
  const point = walkthrough.publicWalkStart(graph, lRoom);
  assert.equal(
    walkthrough.publicRoomContains(lRoom, point.x, point.z, 0.18),
    true,
  );
});


test("walk collision broad phase excludes distant meshes before raycast", () => {
  const root = new THREE.Group();
  const near = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshBasicMaterial(),
  );
  near.position.set(0, 1, -2);
  const far = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshBasicMaterial(),
  );
  far.position.set(50, 1, -2);
  root.add(near, far);

  const colliders = walkthrough.collectWalkColliders(root);
  assert.equal(colliders.length, 2);

  const candidates = walkthrough.walkRaycastCandidates(
    colliders,
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, -1),
    4,
    0.35,
  );
  assert.deepEqual(candidates, [near]);

  near.geometry.dispose();
  near.material.dispose();
  far.geometry.dispose();
  far.material.dispose();
});
