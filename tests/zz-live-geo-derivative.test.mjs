import assert from "node:assert/strict";
import test from "node:test";

const PROJECT_URL =
  "https://ar3dstudio.in/3Dprojects/api/projects/jyoti-paradise-local-backup-302a8799";

test("live Jyoti project exposes verified Geo derivative", async () => {
  const response = await fetch(PROJECT_URL, { redirect: "follow" });
  const text = await response.text();
  console.log("LIVE_GEO_PROJECT", response.status, text.slice(0, 6000));
  assert.equal(response.ok, true);

  const payload = JSON.parse(text);
  assert.equal(payload.project?.slug, "jyoti-paradise-local-backup-302a8799");
  assert.equal(payload.release?.version, 1);
  assert.equal(payload.geoModel?.variant, "geo-optimized");
  assert.equal(payload.geoModel?.sourceModelId, payload.model?.id);
  assert.ok(payload.geoModel?.byteSize > 0);
  assert.ok(payload.geoModel?.byteSize < 5_000_000);
  assert.match(payload.geoModel?.url || "", /\/geo-models\/.*\/model\.glb\?v=1$/);

  const modelUrl = new URL(payload.geoModel.url, PROJECT_URL).toString();
  const range = await fetch(modelUrl, {
    headers: { Range: "bytes=0-3" },
    redirect: "follow",
  });
  const bytes = Buffer.from(await range.arrayBuffer());
  console.log(
    "LIVE_GEO_MODEL",
    range.status,
    payload.geoModel.byteSize,
    payload.geoModel.sha256,
    JSON.stringify(Object.fromEntries(range.headers.entries())),
    bytes.toString("ascii"),
  );
  assert.equal(range.status, 206);
  assert.equal(bytes.toString("ascii"), "glTF");
  assert.equal(range.headers.get("access-control-allow-origin"), "*");
});
