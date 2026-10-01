import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";

const SLUG = "jyoti-paradise-local-backup-302a8799";

test("Jyoti Geo derivative emits explicit finite unit normals after simplification", async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "rekixo-geo-normals-"));
  try {
    execFileSync(
      process.execPath,
      ["scripts/build-geo-model-derivative.mjs", SLUG, outputDir],
      { stdio: "inherit", timeout: 120_000 },
    );
    const modelPath = path.join(outputDir, "model.glb");
    const bytes = fs.readFileSync(modelPath);
    assert.ok(bytes.byteLength < 4_800_000, "candidate stays under preferred 4.8 MB");

    const io = new NodeIO();
    const document = await io.readBinary(bytes);
    let primitives = 0;
    let normalCount = 0;
    let badNormals = 0;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const primitive of mesh.listPrimitives()) {
        primitives += 1;
        const position = primitive.getAttribute("POSITION");
        const normal = primitive.getAttribute("NORMAL");
        assert.ok(position, "POSITION exists");
        assert.ok(normal, "NORMAL exists");
        assert.equal(normal.getCount(), position.getCount(), "normal count matches positions");
        const v = [0, 0, 0];
        for (let index = 0; index < normal.getCount(); index += 1) {
          normal.getElement(index, v);
          normalCount += 1;
          const length = Math.hypot(v[0], v[1], v[2]);
          if (!Number.isFinite(length) || length < 0.99 || length > 1.01)
            badNormals += 1;
        }
      }
    }
    assert.ok(primitives > 0);
    assert.ok(normalCount > 0);
    assert.equal(badNormals, 0, "all explicit normals are finite unit vectors");

    console.log(
      "JYOTI_GEO_EXPLICIT_NORMALS",
      JSON.stringify({
        byteSize: bytes.byteLength,
        primitives,
        normalCount,
        badNormals,
      }),
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
