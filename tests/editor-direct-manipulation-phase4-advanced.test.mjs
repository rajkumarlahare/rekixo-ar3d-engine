import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("selected openings expose touch-friendly direct resize handles", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasArchitecture.ts",
    "utf8",
  );

  assert.match(source, /addOpeningResizeHandle/);
  assert.match(source, /openingResizeCorner = corner/);
  assert.match(source, /"top-left"/);
  assert.match(source, /"top-right"/);
  assert.match(source, /new T\.SphereGeometry\(0\.3/);
});

test("selected furniture exposes a direct rotation handle with a larger touch target", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasRoomObjects.ts",
    "utf8",
  );

  assert.match(source, /addFurnitureRotationHandle/);
  assert.match(source, /furnitureRotationHandle = true/);
  assert.match(source, /Furniture rotation touch target/);
  assert.match(source, /new T\.SphereGeometry\(0\.32/);
});

test("advanced direct manipulation keeps preview-only motion until pointer completion", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasDirectManipulation.ts",
    "utf8",
  );

  assert.match(source, /openingResizeHandle/);
  assert.match(source, /setOpeningResize/);
  assert.match(source, /setFurnitureRotation/);
  assert.match(source, /hostWallForOpening/);
  assert.match(source, /wallLength/);
  assert.match(source, /Math\.round\(width \/ 0\.05\) \* 0\.05/);
  assert.match(source, /Math\.round\(rotation \/ 15\) \* 15/);
  assert.match(source, /session\.previewTarget\.rotation\.y = session\.startRotationY/);

  const moveStart = source.indexOf("pointerMove(event: PointerEvent)");
  const upStart = source.indexOf("pointerUp(event: PointerEvent)", moveStart);
  assert.ok(moveStart >= 0 && upStart > moveStart);
  assert.doesNotMatch(source.slice(moveStart, upStart), /onTransformCommit/);
  assert.match(source.slice(upStart), /config\.onTransformCommit\?\.\(change\)/);
});

test("smart snap feedback renders visual plan and rotation guides", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/sceneCanvasDirectManipulation.ts",
    "utf8",
  );

  assert.match(source, /Direct manipulation snap guides/);
  assert.match(source, /renderPlanSnapGuides/);
  assert.match(source, /matchingEdgeTarget/);
  assert.match(source, /renderRotationSnapGuide/);
  assert.match(source, /clearSnapGuides\(session\.guideLayer\)/);
});
