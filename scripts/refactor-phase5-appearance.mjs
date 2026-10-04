import fs from "node:fs";

const path = "apps/admin/src/studio/SceneCanvas.tsx";
let source = fs.readFileSync(path, "utf8");

const importMarker = 'import { captureSceneVisualSample } from "./sceneCanvasVisualSample";';
const importReplacement = `${importMarker}\nimport { applySceneCanvasAppearance } from "./sceneCanvasAppearance";`;
if (!source.includes(importMarker)) throw Error("visual sample import marker missing");
source = source.replace(importMarker, importReplacement);

const start = '  useEffect(() => {\n    const runtime = api.current;\n    if (!runtime) return;\n    const appearance = props.scene.appearance;\n    const focusedInterior =\n      props.view === "rooms" && Boolean(props.soloRoomId);\n';
const end = '    props.soloRoomId,\n  ]);\n\n  useEffect(() => {\n    const runtime = api.current;\n    if (!runtime || !runtime.model.children.length) return;';
const startIndex = source.indexOf(start);
const endIndex = source.indexOf(end, startIndex);
if (startIndex < 0 || endIndex < 0) throw Error("appearance effect markers missing");
const replacement = `  useEffect(() => {\n    const runtime = api.current;\n    if (!runtime) return;\n    applySceneCanvasAppearance(\n      runtime,\n      props.scene.appearance,\n      props.view === "rooms" && Boolean(props.soloRoomId),\n    );\n  }, [props.scene.appearance, props.scene.modelId, props.view, props.soloRoomId]);\n\n  useEffect(() => {\n    const runtime = api.current;\n    if (!runtime || !runtime.model.children.length) return;`;
source = source.slice(0, startIndex) + replacement + source.slice(endIndex + end.length);
fs.writeFileSync(path, source);
console.log("SceneCanvas appearance effect extracted.");
