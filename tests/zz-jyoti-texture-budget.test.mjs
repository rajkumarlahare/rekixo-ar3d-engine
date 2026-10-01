import test from "node:test";
import assert from "node:assert/strict";
import { NodeIO } from "@gltf-transform/core";

const PROJECT_URL =
  "https://ar3dstudio.in/3Dprojects/api/projects/jyoti-paradise-local-backup-302a8799";

test("diagnose Jyoti source texture byte budget", async () => {
  const project = await fetch(PROJECT_URL).then((r) => {
    assert.equal(r.ok, true);
    return r.json();
  });
  const modelUrl = new URL(project.model.url, PROJECT_URL).toString();
  const res = await fetch(modelUrl);
  assert.equal(res.ok, true);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const io = new NodeIO();
  const doc = await io.readBinary(bytes);
  const textures = doc.getRoot().listTextures().map((texture, index) => {
    const image = texture.getImage();
    return {
      index,
      name: texture.getName(),
      mimeType: texture.getMimeType(),
      uri: texture.getURI(),
      bytes: image?.byteLength || 0,
    };
  }).sort((a,b) => b.bytes - a.bytes);

  const attributeUse = {};
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of primitive.listSemantics()) {
        const accessor = primitive.getAttribute(semantic);
        const item = attributeUse[semantic] || { primitives: 0, elements: 0, bytes: 0 };
        item.primitives += 1;
        item.elements += accessor?.getCount?.() || 0;
        item.bytes += accessor?.getArray?.()?.byteLength || 0;
        attributeUse[semantic] = item;
      }
      const indices = primitive.getIndices();
      if (indices) {
        const item = attributeUse.INDICES || { primitives: 0, elements: 0, bytes: 0 };
        item.primitives += 1;
        item.elements += indices.getCount();
        item.bytes += indices.getArray()?.byteLength || 0;
        attributeUse.INDICES = item;
      }
    }
  }

  const materials = doc.getRoot().listMaterials().map((m) => ({
    name: m.getName(),
    alphaMode: m.getAlphaMode(),
    baseColorTexture: m.getBaseColorTexture()?.getName() || null,
    emissiveTexture: m.getEmissiveTexture()?.getName() || null,
    normalTexture: m.getNormalTexture()?.getName() || null,
    occlusionTexture: m.getOcclusionTexture()?.getName() || null,
    metallicRoughnessTexture:
      m.getMetallicRoughnessTexture()?.getName() || null,
  }));

  console.log("JYOTI_TEXTURE_BUDGET", JSON.stringify({
    sourceBytes: bytes.byteLength,
    textureCount: textures.length,
    textureBytes: textures.reduce((sum,t)=>sum+t.bytes,0),
    textures,
    materials,
    attributeUse,
  }));
});
