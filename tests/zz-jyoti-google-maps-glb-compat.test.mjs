import test from "node:test";
import assert from "node:assert/strict";

const MODEL_URL = "https://github.com/rajkumarlahare/rekixo-ar3d-engine/releases/download/jyoti-studio-design-v1/jyoti-source-preserved.glb";

function readGlbJson(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, "GLB magic");
  assert.equal(view.getUint32(4, true), 2, "GLB version");
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  assert.equal(jsonType, 0x4e4f534a, "first GLB chunk must be JSON");
  const jsonBytes = bytes.slice(20, 20 + jsonLength);
  return JSON.parse(new TextDecoder().decode(jsonBytes).replace(/\u0000+$/g, "").trim());
}

test("diagnose Jyoti GLB compatibility for Google Maps 3D", async () => {
  const response = await fetch(MODEL_URL, { redirect: "follow" });
  assert.equal(response.ok, true, `model fetch failed: ${response.status}`);
  const json = readGlbJson(await response.arrayBuffer());

  console.log("JYOTI_GLB_COMPAT", JSON.stringify({
    asset: json.asset,
    extensionsUsed: json.extensionsUsed || [],
    extensionsRequired: json.extensionsRequired || [],
    materials: Array.isArray(json.materials) ? json.materials.length : 0,
    meshes: Array.isArray(json.meshes) ? json.meshes.length : 0,
    nodes: Array.isArray(json.nodes) ? json.nodes.length : 0,
    scenes: Array.isArray(json.scenes) ? json.scenes.length : 0,
    animations: Array.isArray(json.animations) ? json.animations.length : 0,
  }));
});
