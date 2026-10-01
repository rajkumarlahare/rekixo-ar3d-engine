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

function componentBytes(componentType) {
  return componentType === 5120 || componentType === 5121
    ? 1
    : componentType === 5122 || componentType === 5123
      ? 2
      : componentType === 5125 || componentType === 5126
        ? 4
        : 0;
}

function typeComponents(type) {
  return { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[type] || 0;
}

function stripRedundantVertexStrides(buffer) {
  const source = Buffer.from(buffer);
  const jsonLength = source.readUInt32LE(12);
  const jsonType = source.readUInt32LE(16);
  assert.equal(jsonType, 0x4e4f534a);
  const json = JSON.parse(
    source
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .replace(/\u0000+$/g, "")
      .trim(),
  );

  for (let viewIndex = 0; viewIndex < (json.bufferViews || []).length; viewIndex++) {
    const view = json.bufferViews[viewIndex];
    if (!Number.isInteger(view.byteStride)) continue;
    const users = (json.accessors || [])
      .map((accessor, index) => ({ accessor, index }))
      .filter(({ accessor }) => accessor.bufferView === viewIndex);
    assert.equal(users.length, 1, `strided view ${viewIndex} is shared`);
    const accessor = users[0].accessor;
    const packed =
      componentBytes(accessor.componentType) * typeComponents(accessor.type);
    assert.equal(view.byteStride, packed, `view ${viewIndex} is not tightly packed`);
    delete view.byteStride;
  }

  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const paddedJsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const jsonChunk = Buffer.alloc(paddedJsonLength, 0x20);
  jsonBytes.copy(jsonChunk);

  const binHeaderOffset = 20 + jsonLength;
  const binLength = source.readUInt32LE(binHeaderOffset);
  const binType = source.readUInt32LE(binHeaderOffset + 4);
  assert.equal(binType, 0x004e4942);
  const bin = source.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binLength);

  const out = Buffer.alloc(12 + 8 + paddedJsonLength + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(paddedJsonLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const outBinHeader = 20 + paddedJsonLength;
  out.writeUInt32LE(bin.length, outBinHeader);
  out.writeUInt32LE(0x004e4942, outBinHeader + 4);
  bin.copy(out, outBinHeader + 8);
  return out;
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
  const rawBytes = fs.readFileSync(out);
  const bytes = stripRedundantVertexStrides(rawBytes);
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
