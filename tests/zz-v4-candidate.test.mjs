import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodeIO, VertexLayout } from "@gltf-transform/core";
import {
  center,
  dedup,
  flatten,
  getBounds,
  join,
  prune,
  simplify,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const PROJECT =
  "https://ar3dstudio.in/3Dprojects/api/projects/jyoti-paradise-local-backup-302a8799";

function parseGlbJson(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(
    new TextDecoder()
      .decode(bytes.slice(20, 20 + jsonLength))
      .replace(/\u0000+$/g, "")
      .trim(),
  );
}

test("experimental V4 candidate removes remaining Google renderer deltas", async () => {
  const payloadResponse = await fetch(PROJECT, {
    headers: { Accept: "application/json" },
  });
  assert.equal(payloadResponse.status, 200);
  const payload = await payloadResponse.json();
  const sourceUrl = new URL(payload.model.url, PROJECT).toString();
  const sourceResponse = await fetch(sourceUrl);
  assert.equal(sourceResponse.ok, true);
  const sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer());

  const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE);
  const document = await io.readBinary(sourceBytes);
  const root = document.getRoot();
  const hasTextures = root.listTextures().length > 0;

  for (const material of root.listMaterials()) material.setDoubleSided(true);
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (!hasTextures) {
        primitive.getAttribute("TANGENT")?.dispose();
        for (const semantic of primitive.listSemantics()) {
          if (semantic.startsWith("TEXCOORD_"))
            primitive.getAttribute(semantic)?.dispose();
        }
      }
    }
  }

  await MeshoptSimplifier.ready;
  await document.transform(
    center({ pivot: "below" }),
    weld(),
    dedup(),
    prune({
      keepAttributes: false,
      keepIndices: false,
      keepLeaves: false,
      keepSolidTextures: false,
    }),
    flatten(),
    join({ keepNamed: false, keepMeshes: false }),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.32,
      error: 0.01,
      lockBorder: false,
    }),
    prune({
      keepAttributes: false,
      keepIndices: false,
      keepLeaves: false,
      keepSolidTextures: false,
    }),
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rekixo-v4-probe-"));
  const out = path.join(dir, "candidate.glb");
  await io.write(out, document);
  const bytes = fs.readFileSync(out);
  const json = parseGlbJson(bytes);

  const scene = document.getRoot().getDefaultScene() || document.getRoot().listScenes()[0];
  const bounds = getBounds(scene);
  const primitives = (json.meshes || []).flatMap((mesh) => mesh.primitives || []);
  const vertexAccessorIndexes = new Set(
    primitives.flatMap((primitive) => Object.values(primitive.attributes || {})),
  );
  const vertexStrides = [...vertexAccessorIndexes]
    .map((accessorIndex) => json.accessors?.[accessorIndex]?.bufferView)
    .filter(Number.isInteger)
    .map((bufferViewIndex) => json.bufferViews?.[bufferViewIndex]?.byteStride || 0);

  const materials = json.materials || [];
  const result = {
    byteSize: bytes.byteLength,
    meshCount: (json.meshes || []).length,
    primitiveCount: primitives.length,
    materialCount: materials.length,
    allDoubleSided: materials.every((material) => material.doubleSided === true),
    maxVertexStride: Math.max(0, ...vertexStrides),
    extensionsUsed: json.extensionsUsed || [],
    extensionsRequired: json.extensionsRequired || [],
    bounds: {
      min: [...bounds.min],
      max: [...bounds.max],
      size: bounds.min.map((value, index) => bounds.max[index] - value),
    },
  };
  console.log("JYOTI_V4_CANDIDATE", JSON.stringify(result));

  assert.equal(result.allDoubleSided, true);
  assert.equal(result.maxVertexStride, 0);
  assert.deepEqual(result.extensionsUsed, []);
  assert.deepEqual(result.extensionsRequired, []);
  assert.ok(result.byteSize < 5_000_000, `candidate too large: ${result.byteSize}`);
  assert.ok(Math.abs(bounds.min[1]) < 0.05);
});
