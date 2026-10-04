import fs from "node:fs";

const path = "apps/admin/src/studio/SceneCanvas.tsx";
let source = fs.readFileSync(path, "utf8");

if (source.includes('from "./sceneCanvasDirectManipulation"')) {
  console.log("SceneCanvas direct manipulation integration is already present.");
  process.exit(0);
}

function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Cannot patch ${label}: anchor missing.`);
  if (source.indexOf(needle, first + needle.length) >= 0)
    throw new Error(`Cannot patch ${label}: anchor is ambiguous.`);
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
}

replaceOnce(
  '} from "./sceneCanvasArchitectureController";\nimport {\n  installCanvasFurnitureDrop,',
  '} from "./sceneCanvasArchitectureController";\nimport { createDirectManipulationController } from "./sceneCanvasDirectManipulation";\nimport {\n  installCanvasFurnitureDrop,',
  "direct manipulation import",
);

const roomPlaneAnchor = "    const roomPlanePoint = (\n";
const roomPlaneIndex = source.indexOf(roomPlaneAnchor);
if (roomPlaneIndex < 0) throw new Error("Cannot patch controller creation: room plane anchor missing.");
const controller = `    const directManipulation = createDirectManipulationController({\n      getConfig: () => latest.current,\n      renderer,\n      camera,\n      controls,\n      transform,\n      selectables,\n      pointOnFloor,\n      snapPlanPoint: snapRoomPoint,\n      setStatus,\n    });\n\n`;
source = source.slice(0, roomPlaneIndex) + controller + source.slice(roomPlaneIndex);

const pointerStart = source.indexOf("    const pointerDown = (e: PointerEvent) => {");
const moveStart = source.indexOf("    const move = (e: PointerEvent) => {", pointerStart);
if (pointerStart < 0 || moveStart < 0) throw new Error("Cannot patch pointerDown: handler anchors missing.");
const genericPoint = source.lastIndexOf("      point = {\n", moveStart);
if (genericPoint < pointerStart) throw new Error("Cannot patch pointerDown: generic pointer state anchor missing.");
source =
  source.slice(0, genericPoint) +
  "      if (directManipulation.pointerDown(e)) return;\n" +
  source.slice(genericPoint);

const clickStart = source.indexOf("    const click = (e: PointerEvent) => {", moveStart);
if (clickStart < 0) throw new Error("Cannot patch pointerMove: click handler anchor missing.");
const walkMove = source.lastIndexOf(
  '      if (!point || latest.current.view !== "walk") return;\n',
  clickStart,
);
if (walkMove < moveStart) throw new Error("Cannot patch pointerMove: walk anchor missing.");
source =
  source.slice(0, walkMove) +
  "      if (directManipulation.pointerMove(e)) return;\n" +
  source.slice(walkMove);

replaceOnce(
  "    const click = (e: PointerEvent) => {\n      if (architectureController.pointerUp(e)) return;\n",
  "    const click = (e: PointerEvent) => {\n      if (architectureController.pointerUp(e)) return;\n      if (directManipulation.pointerUp(e)) {\n        point = undefined;\n        return;\n      }\n",
  "pointerUp integration",
);

fs.writeFileSync(path, source);
console.log("SceneCanvas direct manipulation integration applied.");
