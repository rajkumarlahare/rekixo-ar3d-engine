import fs from "node:fs";

const path = "apps/admin/src/studio/cadOnlyAutoBuildPipeline.ts";
let source = fs.readFileSync(path, "utf8");
const from = `      referenceImageEvidenceReady: Boolean(\n        next.scene.referenceImageEvidence,\n      ),\n      referencePaletteColors:\n`;
const to = `      referenceImageEvidenceReady: Boolean(\n        next.scene.referenceImageEvidence,\n      ),\n      referenceImagesAnalyzed:\n        next.scene.referenceImageEvidenceSet?.length ??\n        (next.scene.referenceImageEvidence ? 1 : 0),\n      referenceImageRegions:\n        next.scene.referenceImageEvidenceSet?.reduce(\n          (sum, evidence) => sum + (evidence.regions?.length ?? 0),\n          0,\n        ) ?? next.scene.referenceImageEvidence?.regions?.length ?? 0,\n      referencePaletteColors:\n`;
if (!source.includes(from)) throw new Error("CAD-only summary patch anchor missing.");
source = source.replace(from, to);
fs.writeFileSync(path, source);
console.log("Phase 5 CI compatibility patch applied.");
