import fs from "node:fs";

const path = "apps/admin/src/studio/SceneCanvas.tsx";
let source = fs.readFileSync(path, "utf8");

const oldImport = 'import { analyzeReferencePixels, type ReferencePixelAnalysis } from "./referenceImagePalette";';
const newImport = 'import type { ReferencePixelAnalysis } from "./referenceImagePalette";\nimport { captureSceneVisualSample } from "./sceneCanvasVisualSample";';
if (!source.includes(oldImport)) throw Error("reference image palette import marker missing");
source = source.replace(oldImport, newImport);

const pattern = /  useEffect\(\(\) => \{\n    if \(!props\.visualSampleRequest \|\| props\.view !== "building"\) return;\n[\s\S]*?  \}, \[props\.visualSampleRequest\]\);\n/;
const replacement = `  useEffect(() => {\n    if (!props.visualSampleRequest || props.view !== "building") return;\n    const runtime = api.current;\n    if (!runtime) {\n      props.onVisualSampleError?.("Load the building model before scoring the current view.");\n      return;\n    }\n    try {\n      props.onVisualSample?.(\n        captureSceneVisualSample({\n          ...runtime,\n          transformHelper: runtime.transform.getHelper(),\n        }),\n      );\n    } catch (reason) {\n      props.onVisualSampleError?.(\n        reason instanceof Error\n          ? reason.message\n          : "Current rendered view could not be analyzed.",\n      );\n    }\n  }, [props.visualSampleRequest]);\n`;
if (!pattern.test(source)) throw Error("visual sampling effect marker missing");
source = source.replace(pattern, replacement);
fs.writeFileSync(path, source);
console.log("SceneCanvas visual sampling extracted.");
