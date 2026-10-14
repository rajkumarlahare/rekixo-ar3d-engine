import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const viewer = fs.readFileSync("apps/public/src/viewer/Viewer3D.tsx", "utf8");
const sourcePresentation = fs.readFileSync("apps/public/src/viewer/sourcePresentation.ts", "utf8");
const buildingPresentation = fs.readFileSync("apps/public/src/viewer/buildingPresentationRuntime.ts", "utf8");

test("source and Building presentation layers share one SHA-256 helper", () => {
  assert.match(sourcePresentation, /export async function sha256Hex\(bytes: ArrayBuffer\): Promise<string>/);
  assert.match(sourcePresentation, /crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.match(buildingPresentation, /import \{ sha256Hex \} from "\.\/sourcePresentation"/);
  assert.doesNotMatch(buildingPresentation, /async function sha256Hex/);
});

test("viewer computes a loaded GLB digest once and independently checks each presentation manifest", () => {
  const start = viewer.indexOf('if (sourcePresentation || buildingPresentation)');
  const end = viewer.indexOf('}).catch((error) =>', start);
  assert.ok(start >= 0 && end > start, "presentation-aware model load path must exist");
  const block = viewer.slice(start, end);
  assert.equal((block.match(/await sha256Hex\(bytes\)/g) ?? []).length, 1);
  assert.match(block, /await mountObject\(gltf\.scene, Boolean\(cameraPreset\)\)[\s\S]*?await sha256Hex\(bytes\)/);
  assert.match(block, /sourcePresentation,[\s\S]*?verifiedModelSha256/);
  assert.match(block, /buildingPresentation,[\s\S]*?verifiedModelSha256/);
  assert.match(sourcePresentation, /digest !== source\.modelSha256/);
  assert.match(buildingPresentation, /digest === presentation\.model\.canonicalSha256/);
});

test("direct presentation runtime calls retain their own checksum verification fallback", () => {
  assert.match(sourcePresentation, /verifiedModelSha256 \?\? await sha256Hex\(modelBytes\)/);
  assert.match(buildingPresentation, /verifiedModelSha256 \?\? await sha256Hex\(bytes\)/);
});
