import assert from "node:assert/strict";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";

const GOOGLE_URL = "https://maps-docs-team.web.app/assets/windmill.glb";
const JYOTI_PROJECT =
  "https://ar3dstudio.in/3Dprojects/api/projects/jyoti-paradise-local-backup-302a8799";

function parseGlb(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const json = JSON.parse(
    new TextDecoder()
      .decode(bytes.slice(20, 20 + jsonLength))
      .replace(/\u0000+$/g, "")
      .trim(),
  );
  return json;
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: "follow" });
  assert.equal(response.ok, true, `${url} -> ${response.status}`);
  return {
    url: response.url,
    contentType: response.headers.get("content-type") || "",
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

function accessorInfo(json, index) {
  if (!Number.isInteger(index)) return null;
  const a = json.accessors?.[index];
  if (!a) return null;
  const bv = Number.isInteger(a.bufferView) ? json.bufferViews?.[a.bufferView] : null;
  return {
    index,
    componentType: a.componentType,
    type: a.type,
    count: a.count,
    normalized: Boolean(a.normalized),
    sparse: a.sparse || null,
    min: a.min || null,
    max: a.max || null,
    byteOffset: a.byteOffset || 0,
    bufferView: a.bufferView ?? null,
    byteStride: bv?.byteStride || null,
    target: bv?.target || null,
  };
}

function hierarchyStats(json) {
  const roots = [];
  for (const scene of json.scenes || [])
    for (const node of scene.nodes || []) roots.push(node);
  let maxDepth = 0;
  const visit = (index, depth, seen) => {
    maxDepth = Math.max(maxDepth, depth);
    if (seen.has(index)) return;
    const next = new Set(seen);
    next.add(index);
    for (const child of json.nodes?.[index]?.children || [])
      visit(child, depth + 1, next);
  };
  for (const root of roots) visit(root, 1, new Set());
  return { rootSceneNodes: [...new Set(roots)].length, maxDepth };
}

async function summarize(label, fetched) {
  const json = parseGlb(fetched.bytes);
  const io = new NodeIO();
  const doc = await io.readBinary(fetched.bytes);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  assert.ok(scene);
  const bounds = getBounds(scene);

  const primitiveSummaries = [];
  let invalidIndexPrimitives = 0;
  let mismatchedAttributeCounts = 0;
  let nonFiniteAttributes = 0;
  let invalidNormalLengths = 0;

  const rootMeshes = root.listMeshes();
  for (let meshIndex = 0; meshIndex < (json.meshes || []).length; meshIndex++) {
    const mesh = json.meshes[meshIndex];
    const gltfMesh = rootMeshes[meshIndex];
    for (let primitiveIndex = 0; primitiveIndex < (mesh.primitives || []).length; primitiveIndex++) {
      const primitive = mesh.primitives[primitiveIndex];
      const attrs = {};
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes || {}))
        attrs[semantic] = accessorInfo(json, accessorIndex);
      const position = attrs.POSITION;
      const indices = accessorInfo(json, primitive.indices);

      if (position) {
        for (const info of Object.values(attrs))
          if (info && info.count !== position.count) mismatchedAttributeCounts += 1;
      }

      const gltfPrimitive = gltfMesh?.listPrimitives()[primitiveIndex];
      const pos = gltfPrimitive?.getAttribute("POSITION");
      const normal = gltfPrimitive?.getAttribute("NORMAL");
      const idx = gltfPrimitive?.getIndices();

      if (pos) {
        for (const value of pos.getArray())
          if (!Number.isFinite(value)) nonFiniteAttributes += 1;
      }
      if (normal) {
        const arr = normal.getArray();
        for (let i = 0; i < arr.length; i += 3) {
          const x = arr[i], y = arr[i + 1], z = arr[i + 2];
          if (![x, y, z].every(Number.isFinite)) {
            nonFiniteAttributes += 1;
            continue;
          }
          const len = Math.hypot(x, y, z);
          if (len < 0.5 || len > 1.5) invalidNormalLengths += 1;
        }
      }
      if (idx && pos) {
        let max = -1;
        for (const value of idx.getArray()) max = Math.max(max, Number(value));
        if (max >= pos.getCount()) invalidIndexPrimitives += 1;
      }

      primitiveSummaries.push({
        mode: primitive.mode ?? 4,
        material: primitive.material ?? null,
        attributes: attrs,
        indices,
        targets: primitive.targets?.length || 0,
      });
    }
  }

  const summary = {
    label,
    finalUrl: fetched.url,
    byteSize: fetched.bytes.byteLength,
    contentType: fetched.contentType,
    asset: json.asset,
    sceneCount: (json.scenes || []).length,
    nodeCount: (json.nodes || []).length,
    hierarchy: hierarchyStats(json),
    meshCount: (json.meshes || []).length,
    primitiveCount: primitiveSummaries.length,
    accessorCount: (json.accessors || []).length,
    bufferViewCount: (json.bufferViews || []).length,
    bufferCount: (json.buffers || []).length,
    materialCount: (json.materials || []).length,
    textureCount: (json.textures || []).length,
    imageCount: (json.images || []).length,
    animationCount: (json.animations || []).length,
    skinCount: (json.skins || []).length,
    extensionsUsed: json.extensionsUsed || [],
    extensionsRequired: json.extensionsRequired || [],
    bounds: {
      min: [...bounds.min],
      max: [...bounds.max],
      size: bounds.min.map((v, i) => bounds.max[i] - v),
      center: bounds.min.map((v, i) => (v + bounds.max[i]) / 2),
    },
    materials: (json.materials || []).map((m, index) => ({
      index,
      name: m.name || "",
      alphaMode: m.alphaMode || "OPAQUE",
      alphaCutoff: m.alphaCutoff ?? null,
      doubleSided: Boolean(m.doubleSided),
      pbr: m.pbrMetallicRoughness || null,
    })),
    primitiveSummaries,
    nodes: (json.nodes || []).map((node, index) => ({
      index,
      mesh: node.mesh ?? null,
      children: node.children?.length || 0,
      translation: node.translation || null,
      rotation: node.rotation || null,
      scale: node.scale || null,
      matrix: node.matrix || null,
    })),
    validation: {
      invalidIndexPrimitives,
      mismatchedAttributeCounts,
      nonFiniteAttributes,
      invalidNormalLengths,
    },
  };

  console.log(`MODEL_COMPARE_${label}`, JSON.stringify(summary));
  return summary;
}

test("compare Google official GLB against live Jyoti V3", async () => {
  const projectResponse = await fetch(JYOTI_PROJECT, {
    headers: { Accept: "application/json" },
  });
  assert.equal(projectResponse.status, 200);
  const payload = await projectResponse.json();
  assert.equal(payload.geoModel?.variant, "geo-optimized");
  const jyotiUrl = new URL(payload.geoModel.url, JYOTI_PROJECT).toString();

  const [googleBytes, jyotiBytes] = await Promise.all([
    fetchBytes(GOOGLE_URL),
    fetchBytes(jyotiUrl),
  ]);

  const [google, jyoti] = await Promise.all([
    summarize("GOOGLE", googleBytes),
    summarize("JYOTI", jyotiBytes),
  ]);

  assert.deepEqual(jyoti.extensionsUsed, []);
  assert.deepEqual(jyoti.extensionsRequired, []);
  assert.equal(jyoti.validation.invalidIndexPrimitives, 0);
  assert.equal(jyoti.validation.mismatchedAttributeCounts, 0);
  assert.equal(jyoti.validation.nonFiniteAttributes, 0);
  assert.equal(jyoti.validation.invalidNormalLengths, 0);

  console.log("MODEL_COMPARE_DIFF", JSON.stringify({
    google: {
      byteSize: google.byteSize,
      meshCount: google.meshCount,
      primitiveCount: google.primitiveCount,
      materialCount: google.materialCount,
      textureCount: google.textureCount,
      nodeCount: google.nodeCount,
      hierarchy: google.hierarchy,
      bounds: google.bounds,
      indexTypes: [...new Set(google.primitiveSummaries.map((p) => p.indices?.componentType))],
      strides: [...new Set(google.primitiveSummaries.flatMap((p) => Object.values(p.attributes).map((a) => a?.byteStride)).filter(Boolean))],
      semantics: [...new Set(google.primitiveSummaries.flatMap((p) => Object.keys(p.attributes)))],
    },
    jyoti: {
      byteSize: jyoti.byteSize,
      meshCount: jyoti.meshCount,
      primitiveCount: jyoti.primitiveCount,
      materialCount: jyoti.materialCount,
      textureCount: jyoti.textureCount,
      nodeCount: jyoti.nodeCount,
      hierarchy: jyoti.hierarchy,
      bounds: jyoti.bounds,
      indexTypes: [...new Set(jyoti.primitiveSummaries.map((p) => p.indices?.componentType))],
      strides: [...new Set(jyoti.primitiveSummaries.flatMap((p) => Object.values(p.attributes).map((a) => a?.byteStride)).filter(Boolean))],
      semantics: [...new Set(jyoti.primitiveSummaries.flatMap((p) => Object.keys(p.attributes)))],
    },
  }));
});
