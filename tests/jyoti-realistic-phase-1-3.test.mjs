import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("realistic viewer preserves source materials and applies PBR tuning", () => {
  const helper = read("apps/public/src/viewer/realism.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(helper, /enhanceArchitecturalModel/);
  assert.match(helper, /glass\|window\|translucent/);
  assert.match(helper, /metal\|steel/);
  assert.match(helper, /marble/);
  assert.match(helper, /granite/);
  assert.match(helper, /slate/);
  assert.match(helper, /tile/);
  assert.match(viewer, /RoomEnvironment/);
  assert.match(viewer, /ACESFilmicToneMapping/);
  assert.match(viewer, /controls\.enablePan = true/);
});

test("exploded floor interaction is geometry-derived and generic", () => {
  const helper = read("apps/public/src/viewer/realism.ts");
  const viewer = read("apps/public/src/viewer/Viewer3D.tsx");
  assert.match(helper, /createFloorExploder/);
  assert.match(helper, /floorForElevation/);
  assert.match(helper, /meshHeight > totalHeight \* 0\.22/);
  assert.match(viewer, /resolvedFloorGeometry/);
  assert.match(viewer, /Explode/);
  assert.match(viewer, /explodeRef/);
});

test("Phase 3 unit selection remains source-backed and does not fake mesh semantics", () => {
  const app = read("apps/public/src/main.tsx");
  const migration = read("database/migrations/0005_jyoti_realistic_phase_1_3.sql");
  assert.match(app, /selectedUnit/);
  assert.match(app, /Exact 3D room\/mesh/);
  assert.match(migration, /101 to 501/);
  assert.match(migration, /102 to 502/);
  assert.match(migration, /103 to 403/);
  assert.match(migration, /semanticMeshBinding/);
  assert.match(migration, /pending-source-verification/);
});

test("Phase 1 includes reusable FBX material audit", () => {
  const script = read("scripts/asset-pipeline/ascii-fbx-material-audit.mjs");
  assert.match(script, /auditAsciiFbxMaterials/);
  assert.match(script, /RelativeFilename/);
  assert.match(script, /glass/);
  assert.match(script, /concretePaving/);
});
