import assert from "node:assert/strict";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";

const PROJECT_URL =
  "https://ar3dstudio.in/3Dprojects/api/projects/jyoti-paradise-local-backup-302a8799";

function parseGlbJson(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, "GLB magic");
  assert.equal(view.getUint32(4, true), 2, "GLB version");
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, "first chunk JSON");
  return JSON.parse(
    new TextDecoder()
      .decode(bytes.slice(20, 20 + jsonLength))
      .replace(/\u0000+$/g, "")
      .trim(),
  );
}

function finiteArray(values) {
  return (
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((value) => typeof value === "number" && Number.isFinite(value))
  );
}

test("live Jyoti Geo derivative is visually renderable core glTF", async () => {
  const projectResponse = await fetch(PROJECT_URL, {
    headers: { Accept: "application/json" },
    redirect: "follow",
  });
  assert.equal(projectResponse.status, 200);
  const payload = await projectResponse.json();
  assert.equal(payload.project?.status, "published");
  assert.equal(payload.release?.version, 1);
  assert.equal(payload.geoModel?.variant, "geo-optimized");
  assert.equal(payload.geoModel?.sourceModelId, payload.model?.id);

  const modelUrl = new URL(payload.geoModel.url, PROJECT_URL).toString();
  const response = await fetch(modelUrl, { redirect: "follow" });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") || "",
    /^model\/gltf-binary(?:;|$)/i,
  );
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes.byteLength, payload.geoModel.byteSize);

  const json = parseGlbJson(bytes);
  assert.deepEqual(json.extensionsRequired || [], []);
  assert.deepEqual(json.extensionsUsed || [], []);
  assert.equal((json.animations || []).length, 0);
  assert.equal((json.skins || []).length, 0);
  assert.ok((json.scenes || []).length > 0, "scene exists");
  assert.ok((json.meshes || []).length > 0, "mesh exists");

  const primitives = (json.meshes || []).flatMap((mesh) => mesh.primitives || []);
  assert.ok(primitives.length > 0, "render primitives exist");
  assert.ok(
    primitives.every((primitive) => (primitive.mode ?? 4) === 4),
    "all primitives are TRIANGLES",
  );
  assert.ok(
    primitives.every((primitive) => !(primitive.targets || []).length),
    "no morph targets",
  );

  const materials = json.materials || [];
  assert.ok(materials.length > 0, "materials exist");
  const materialSummary = materials.map((material, index) => {
    const base = material.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
    const alpha = Number(base[3] ?? 1);
    return {
      index,
      name: material.name || "",
      alphaMode: material.alphaMode || "OPAQUE",
      alphaCutoff: Number(material.alphaCutoff ?? 0.5),
      alpha,
      doubleSided: Boolean(material.doubleSided),
      baseColorFactor: base,
    };
  });
  assert.ok(
    materialSummary.some(
      (material) =>
        Number.isFinite(material.alpha) &&
        material.alpha > 0 &&
        material.alphaMode !== "MASK"
          ? true
          : material.alpha > 0 && material.alphaCutoff <= 1,
    ),
    "at least one visible material",
  );
  assert.ok(
    materialSummary.every(
      (material) =>
        Number.isFinite(material.alpha) &&
        material.alpha >= 0 &&
        material.alpha <= 1 &&
        Number.isFinite(material.alphaCutoff),
    ),
    "material alpha values are finite",
  );
  assert.ok(
    materialSummary.every(
      (material) => !(material.alphaMode === "BLEND" && material.alpha === 0),
    ),
    "no fully transparent BLEND material",
  );

  for (const [index, node] of (json.nodes || []).entries()) {
    if (node.translation)
      assert.ok(finiteArray(node.translation), `node ${index} translation finite`);
    if (node.rotation)
      assert.ok(finiteArray(node.rotation), `node ${index} rotation finite`);
    if (node.scale) {
      assert.ok(finiteArray(node.scale), `node ${index} scale finite`);
      assert.ok(
        node.scale.every((value) => Math.abs(value) > 1e-8),
        `node ${index} has non-zero scale`,
      );
    }
    if (node.matrix)
      assert.ok(finiteArray(node.matrix), `node ${index} matrix finite`);
  }

  const io = new NodeIO();
  const document = await io.readBinary(bytes);
  const root = document.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  assert.ok(scene, "default scene exists");
  const bounds = getBounds(scene);
  const size = bounds.min.map((value, index) => bounds.max[index] - value);
  const center = bounds.min.map(
    (value, index) => (value + bounds.max[index]) / 2,
  );

  let visibleMeshes = 0;
  let vertices = 0;
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    let meshTriangles = 0;
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (!position) continue;
      vertices += position.getCount();
      const indices = primitive.getIndices();
      const primitiveTriangles = indices
        ? indices.getCount() / 3
        : position.getCount() / 3;
      triangles += primitiveTriangles;
      meshTriangles += primitiveTriangles;
    }
    if (meshTriangles > 0) visibleMeshes += 1;
  }

  assert.ok(size[0] > 5, "width > 5m");
  assert.ok(size[2] > 5, "depth > 5m");
  assert.ok(size[1] > 10, "height > 10m");
  assert.ok(visibleMeshes > 0, "visible mesh count > 0");
  assert.ok(triangles > 0, "triangles > 0");
  assert.ok(Math.abs(center[0]) < 0.05, "center X ~= 0");
  assert.ok(Math.abs(center[2]) < 0.05, "center Z ~= 0");
  assert.ok(Math.abs(bounds.min[1]) < 0.05, "min Y ~= 0");

  const diagnostic = {
    modelUrl,
    byteSize: bytes.byteLength,
    releaseId: payload.release.id,
    releaseVersion: payload.release.version,
    sourceModelId: payload.model.id,
    geoSha256: payload.geoModel.sha256,
    sceneCount: (json.scenes || []).length,
    nodeCount: (json.nodes || []).length,
    meshes: root.listMeshes().length,
    visibleMeshes,
    primitiveCount: primitives.length,
    materialCount: materials.length,
    materialSummary,
    textureCount: (json.textures || []).length,
    imageCount: (json.images || []).length,
    vertices,
    triangles,
    bounds: {
      min: [...bounds.min],
      max: [...bounds.max],
      center,
      size,
    },
  };
  console.log("LIVE_JYOTI_GEO_RENDERABILITY", JSON.stringify(diagnostic));
});
