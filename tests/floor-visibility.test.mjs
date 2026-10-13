import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const viewer = await readFile(new URL("../apps/public/src/viewer/Viewer3D.tsx", import.meta.url), "utf8");
const visibilitySource = await readFile(new URL("../apps/public/src/viewer/floorVisibility.ts", import.meta.url), "utf8");
const threeUrl = import.meta.resolve("three");
const javascript = ts.transpile(visibilitySource, {
  module: ts.ModuleKind.ES2022,
  target: ts.ScriptTarget.ES2022,
}).replace('from "three"', `from "${threeUrl}"`);
const visibilityModule = await import(
  `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`
);
const THREE = await import(threeUrl);
const { createFloorVisibilityController } = visibilityModule;

function mesh(name, width, height, depth, y, color) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const object = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  object.name = name;
  object.position.y = y;
  return object;
}

test("customer floor isolation uses original mesh visibility and not vertical clipping planes", () => {
  assert.match(viewer, /createFloorVisibilityController\(object\)/);
  assert.match(viewer, /clientPresentation && floorVisibilityController/);
  assert.match(viewer, /floorVisibilityController\.showFloor\(level, clientFloorReviewModeRef\.current\)/);
  assert.match(viewer, /floorVisibilityController\.showAll\(\)/);
  assert.match(viewer, /clientFloorControlsReady && clientFloorIds\.length > 0/);
  assert.match(viewer, /const selectedBounds = applyFloorLevel\(level\)/);\n  assert.match(viewer, /clientFloorReviewModeRef.current === "stacked"/);\n  assert.match(viewer, /aria-label="Stacked floor view"/);\n  assert.match(viewer, /aria-label="Isolate selected floor"/);
});

test("actual Three.js meshes isolate a floor, ghost a shared shell, and frame the selected geometry", () => {
  const root = new THREE.Group();
  const ground = mesh("Ground slab", 4, 2, 4, 1, "#d8d8d8");
  const first = mesh("Interior wall first", 3, 2, 3, 3, "#eeeeee");
  const second = mesh("Interior wall second", 3, 2, 3, 5, "#cccccc");
  const shell = mesh("Mesh913", 8, 6, 8, 3, "#999999");
  root.add(ground, first, second, shell);

  const groundMaterial = ground.material;
  const shellMaterial = shell.material;
  const controller = createFloorVisibilityController(root);

  const groundBounds = controller.showFloor({ floor: 0, elevationM: 0, topElevationM: 2, source: "model" });
  assert.equal(ground.visible, true);
  assert.equal(first.visible, false);
  assert.equal(second.visible, false);
  assert.equal(shell.visible, true, "shared shell remains as context");
  assert.notEqual(shell.material, shellMaterial, "shared shell uses a ghost material");
  assert.equal(shell.material.transparent, true);
  assert.ok(shell.material.opacity <= 0.16);
  assert.ok(groundBounds, "selected floor returns camera bounds");
  assert.equal(groundBounds.min.y, 0);
  assert.equal(groundBounds.max.y, 2);

  controller.showFloor({ floor: 1, elevationM: 2, topElevationM: 4, source: "model" });
  assert.equal(ground.visible, false);
  assert.equal(first.visible, true);
  assert.equal(second.visible, false);
  assert.equal(shell.visible, true);

  controller.showAll();
  assert.equal(ground.visible, true);
  assert.equal(first.visible, true);
  assert.equal(second.visible, true);
  assert.equal(shell.visible, true);
  assert.equal(ground.material, groundMaterial);
  assert.equal(shell.material, shellMaterial);
  controller.dispose();
});

test("stacked view keeps all lower floors connected and highlights the selected floor", () => {
  const root = new THREE.Group();
  const ground = mesh("Ground slab", 4, 2, 4, 1, "#d8d8d8");
  const first = mesh("First floor walls", 3, 2, 3, 3, "#eeeeee");
  const second = mesh("Second floor walls", 3, 2, 3, 5, "#cccccc");
  const third = mesh("Third floor walls", 3, 2, 3, 7, "#bbbbbb");
  const sharedCore = mesh("Shared lift core", 0.5, 8, 0.5, 4, "#888888");
  root.add(ground, first, second, third, sharedCore);

  const groundMaterial = ground.material;
  const firstMaterial = first.material;
  const secondMaterial = second.material;
  const thirdMaterial = third.material;
  const controller = createFloorVisibilityController(root);

  const stackBounds = controller.showFloor(
    { floor: 2, elevationM: 4, topElevationM: 6, source: "model" },
    "stacked",
  );
  assert.equal(ground.visible, true, "Ground remains attached below the selected floor");
  assert.equal(first.visible, true, "1F remains attached below the selected floor");
  assert.equal(second.visible, true, "selected 2F is visible");
  assert.equal(third.visible, false, "floors above the selected floor are hidden");
  assert.equal(ground.material.transparent, true, "lower floors are muted as context");
  assert.equal(first.material.transparent, true, "lower floors are muted as context");
  assert.equal(second.material, secondMaterial, "selected floor retains its original material");
  assert.equal(third.material, thirdMaterial, "hidden upper floors keep original materials");
  assert.equal(sharedCore.visible, true, "shared vertical structure is retained without cutting");
  assert.ok(sharedCore.material.transparent, "shared core is ghosted when it spans storeys");
  assert.ok(stackBounds, "stacked mode returns the bounds of all shown lower and selected floors");
  assert.equal(stackBounds.min.y, 0);
  assert.equal(stackBounds.max.y, 6);

  controller.showFloor(
    { floor: 2, elevationM: 4, topElevationM: 6, source: "model" },
    "isolate",
  );
  assert.equal(ground.visible, false, "isolate mode hides lower floors");
  assert.equal(first.visible, false, "isolate mode hides lower floors");
  assert.equal(second.visible, true, "isolate mode keeps selected floor visible");
  assert.equal(third.visible, false);
  assert.equal(second.material, secondMaterial);
  assert.equal(sharedCore.visible, true);

  controller.showAll();
  assert.equal(ground.visible, true);
  assert.equal(first.visible, true);
  assert.equal(second.visible, true);
  assert.equal(third.visible, true);
  assert.equal(ground.material, groundMaterial);
  assert.equal(first.material, firstMaterial);
  assert.equal(second.material, secondMaterial);
  assert.equal(third.material, thirdMaterial);
  controller.dispose();
});

test("floor names inherited from source hierarchy map meshes to the intended floor", () => {
  const root = new THREE.Group();
  const floorGroup = new THREE.Group();
  floorGroup.name = "Floor_2";
  const wall = mesh("Wall_001", 2, 2.7, 0.2, 4.35, "#eeeeee");
  floorGroup.add(wall);
  root.add(floorGroup);

  const controller = createFloorVisibilityController(root);
  const bounds = controller.showFloor({ floor: 2, elevationM: 3, topElevationM: 5.7, source: "model" });
  assert.equal(wall.visible, true);
  assert.ok(bounds);
  controller.showFloor({ floor: 1, elevationM: 0, topElevationM: 3, source: "model" });
  assert.equal(wall.visible, false);
  controller.showAll();
  assert.equal(wall.visible, true);
  controller.dispose();
});

test("cross-storey ghost materials and object visibility restore when controller is disposed", () => {
  const root = new THREE.Group();
  const shell = mesh("Building shell", 8, 18, 8, 9, "#888888");
  root.add(shell);
  const originalMaterial = shell.material;
  const controller = createFloorVisibilityController(root);
  controller.showFloor({ floor: 0, elevationM: 0, topElevationM: 3, source: "model" });
  assert.notEqual(shell.material, originalMaterial);
  controller.dispose();
  assert.equal(shell.visible, true);
  assert.equal(shell.material, originalMaterial);
});

test("walkthrough and experience-mode transitions restore source visibility", () => {
  assert.match(viewer, /if \(enabled && clientPresentation\) floorVisibilityController\?\.showAll\(\)/);
  assert.match(viewer, /if \(clientPresentation\) floorVisibilityController\?\.showAll\(\);\s*if \(!walkthrough\)/);
  assert.match(viewer, /floorVisibilityController\?\.dispose\(\)/);
  assert.match(viewer, /floorVisibilityController\?\.showAll\(\);\s*setClientFloorSelection\(null\)/);
});
