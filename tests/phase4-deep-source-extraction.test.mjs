import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const compile = (path) =>
  ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const drs = await import(
  asUrl(compile("apps/admin/src/studio/drsInspector.ts")),
);
const sketch = await import(
  asUrl(compile("apps/admin/src/studio/sketchUpArchive.ts")),
);

function asset(id, name, body, type = "application/octet-stream") {
  const blob = body instanceof Blob ? body : new Blob([body], { type });
  return {
    id,
    projectId: "project-1",
    name,
    type,
    size: blob.size,
    hash: "a".repeat(64),
    blob,
  };
}

function u16(value) {
  return [value & 255, (value >> 8) & 255];
}
function u32(value) {
  return [
    value & 255,
    (value >> 8) & 255,
    (value >> 16) & 255,
    (value >> 24) & 255,
  ];
}
function storedZip(name, data) {
  const encoder = new TextEncoder();
  const filename = encoder.encode(name);
  const bytes = data instanceof Uint8Array ? data : encoder.encode(data);
  const local = new Uint8Array(30 + filename.length + bytes.length);
  local.set([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0], 0);
  local.set(u32(bytes.length), 18);
  local.set(u32(bytes.length), 22);
  local.set(u16(filename.length), 26);
  local.set(filename, 30);
  local.set(bytes, 30 + filename.length);

  const centralOffset = local.length;
  const central = new Uint8Array(46 + filename.length);
  central.set([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0], 0);
  central.set(u32(bytes.length), 20);
  central.set(u32(bytes.length), 24);
  central.set(u16(filename.length), 28);
  central.set(u32(0), 42);
  central.set(filename, 46);

  const end = new Uint8Array(22);
  end.set([0x50, 0x4b, 0x05, 0x06], 0);
  end.set(u16(1), 8);
  end.set(u16(1), 10);
  end.set(u32(central.length), 12);
  end.set(u32(centralOffset), 16);
  return new Blob([local, central, end], { type: "application/octet-stream" });
}

test("Phase 4 parses structured DRS dependencies without treating them as geometry", async () => {
  const payload = {
    title: "Generic building",
    pak_URL: "d/project/1.skp",
    design_File_URL: "D:/project/building",
    source: "PLAN_DESIGN_SU",
    detail_Info: JSON.stringify({
      max_length: 1000,
      start_location: "X=0.0,Y=0.0,Z=160.0",
      floor_center: "X=0.0,Y=0.0,Z=0.0",
      room_centers: [
        "X=100.0,Y=100.0,Z=0.0",
        "X=200.0,Y=100.0,Z=0.0",
      ],
    }),
    dependent_pak_list: [
      "ModelTextures/a/Stone_basecolor.png",
      "ModelTextures/a/Stone_normal.png",
      "ModelTextures/a/Stone_roughness.png",
      "um/grass/grass_Opacity0.jpg",
      "packages/object.pak",
    ],
    dependent_products: ["product-a", "product-b"],
    dccPluginsData: [{ name: "SU-1.4.0", version: "SU-1.4.0" }],
    d5ClientVerData: [{ version: "3.1.0" }],
  };
  const result = await drs.inspectDrsMetadata(
    asset("drs", "scene.drs", JSON.stringify(payload), "application/json"),
  );

  assert.equal(result.json, true);
  assert.equal(result.source, "PLAN_DESIGN_SU");
  assert.equal(result.uniqueResourceCount, 7);
  assert.equal(result.roomCenters.length, 2);
  assert.equal(result.startLocation.z, 160);
  assert.deepEqual(result.pluginVersions, ["SU-1.4.0"]);
  assert.deepEqual(result.clientVersions, ["3.1.0"]);
  assert.ok(result.resources.some((entry) => entry.role === "basecolor"));
  assert.ok(result.resources.some((entry) => entry.role === "normal"));
  assert.ok(result.resources.some((entry) => entry.role === "roughness"));
  assert.ok(result.resources.some((entry) => entry.role === "opacity"));
  assert.ok(result.resources.some((entry) => entry.role === "package"));
  assert.ok(result.resources.some((entry) => entry.role === "model"));
});

test("Phase 4 SketchUp model.dat inspection recovers only literal semantic evidence", async () => {
  const body = new Uint8Array([
    0, 1, 2,
    ...new TextEncoder().encode(
      "Layer0\0TPClient-WINDOW\0sidewalk\0Main Door Component\0BED ROOM\0random_binary_name",
    ),
    0, 4, 5,
  ]);
  const result = await sketch.inspectSketchUpSemanticEvidence(
    asset("skb", "building.skb", storedZip("model.dat", body)),
  );

  assert.deepEqual(result.modelDataFiles, ["model.dat"]);
  assert.ok(result.architecturalTokens.some((value) => /window/i.test(value)));
  assert.ok(result.architecturalTokens.some((value) => /bed room/i.test(value)));
  assert.ok(result.tagCandidates.some((value) => /Layer0/i.test(value)));
  assert.ok(
    result.componentCandidates.some((value) => /Door Component/i.test(value)),
  );
});

test("Phase 4 PDF inspection keeps spatial text and embedded-image evidence explicit", () => {
  const source = fs.readFileSync(
    "apps/admin/src/studio/pdfPlanInspector.ts",
    "utf8",
  );
  const pipeline = fs.readFileSync(
    "apps/admin/src/studio/autoBuildPipeline.ts",
    "utf8",
  );
  const fusion = fs.readFileSync(
    "apps/admin/src/studio/sourceFusion.ts",
    "utf8",
  );

  assert.match(source, /PdfSpatialLabel/);
  assert.match(source, /getOperatorList/);
  assert.match(source, /paintImageXObject/);
  assert.match(source, /convertToViewportPoint/);
  assert.match(source, /embeddedImages/);
  assert.match(source, /spatialLabels/);
  assert.match(fusion, /pdf\.spatial-labels/);
  assert.match(fusion, /pdf\.embedded-image-candidates/);
  assert.match(fusion, /pdf\.plan-image-crop/);
  assert.match(pipeline, /rasterPdfReference/);
  assert.match(pipeline, /auto-plan-image/);
  assert.match(pipeline, /visible: false/);
  assert.doesNotMatch(pipeline, /metresPerPixel:/);
});

test("Phase 4 DRS dependencies remain provenance metadata when bytes are absent", () => {
  const fusion = fs.readFileSync(
    "apps/admin/src/studio/sourceFusion.ts",
    "utf8",
  );
  assert.match(fusion, /resource bytes not present in the six-file pack/);
  assert.match(fusion, /cannot be reconstructed or published automatically/);
  assert.match(fusion, /DRS detail_Info room-center hints; not geometry truth/);
});
