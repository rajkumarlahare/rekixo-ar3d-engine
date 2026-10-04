import fs from "node:fs";

const path = "apps/admin/src/studio/SceneCanvas.tsx";
let source = fs.readFileSync(path, "utf8");

const controller = `    const directManipulation = createDirectManipulationController({\n      getConfig: () => latest.current,\n      renderer,\n      camera,\n      controls,\n      transform,\n      selectables,\n      pointOnFloor,\n      snapPlanPoint: snapRoomPoint,\n      setStatus,\n    });`;
const compactController = `    const directManipulation = createDirectManipulationController({ getConfig: () => latest.current, renderer, camera, controls, transform, selectables, pointOnFloor, snapPlanPoint: snapRoomPoint, setStatus });`;
if (!source.includes(controller)) throw new Error("Direct manipulation controller block not found.");
source = source.replace(controller, compactController);

const pointerUp = `      if (directManipulation.pointerUp(e)) {\n        point = undefined;\n        return;\n      }`;
if (!source.includes(pointerUp)) throw new Error("Direct manipulation pointer-up block not found.");
source = source.replace(pointerUp, `      if (directManipulation.pointerUp(e)) { point = undefined; return; }`);

const active = `  const authoringActive = Boolean(\n    architectureAuthoringActive(props) || props.roomDraw?.enabled ||\n      props.roomStamp?.enabled || props.roomPolygonDraw?.enabled ||\n      props.furniturePlacement?.enabled,\n  );`;
if (!source.includes(active)) throw new Error("Authoring active block not found.");
source = source.replace(active, `  const authoringActive = Boolean(architectureAuthoringActive(props) || props.roomDraw?.enabled || props.roomStamp?.enabled || props.roomPolygonDraw?.enabled || props.furniturePlacement?.enabled);`);

fs.writeFileSync(path, source);
