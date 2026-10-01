import assert from "node:assert/strict";
import test from "node:test";

const URL =
  "https://ar3dstudio.in/3Dprojects/api/projects/jyoti-paradise-local-backup-302a8799";

test("live Jyoti project exposes a verified Geo derivative", async () => {
  const projectResponse = await fetch(URL, {
    headers: { Accept: "application/json" },
    redirect: "follow",
  });
  assert.equal(projectResponse.status, 200);
  const payload = await projectResponse.json();

  assert.equal(payload.project?.status, "published");
  assert.equal(payload.release?.version, 1);
  assert.equal(payload.geoModel?.variant, "geo-optimized");
  assert.equal(payload.geoModel?.sourceModelId, payload.model?.id);
  assert.equal(payload.geoModel?.mimeType, "model/gltf-binary");
  assert.ok(payload.geoModel?.byteSize > 0);
  assert.ok(payload.geoModel?.byteSize < 5_000_000);
  assert.match(payload.geoModel?.url || "", /\/geo-models\/[^/]+\/model\.glb\?v=1$/);

  const modelUrl = new URL(payload.geoModel.url, URL).toString();
  const range = await fetch(modelUrl, {
    headers: { Range: "bytes=0-3" },
    redirect: "follow",
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("access-control-allow-origin"), "*");
  assert.equal(Buffer.from(await range.arrayBuffer()).toString("ascii"), "glTF");

  console.log("LIVE_JYOTI_GEO", JSON.stringify({
    modelUrl,
    byteSize: payload.geoModel.byteSize,
    sha256: payload.geoModel.sha256,
    releaseId: payload.release.id,
    releaseVersion: payload.release.version,
  }));
});
