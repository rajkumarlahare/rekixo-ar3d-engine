import assert from "node:assert/strict";
import test from "node:test";

const PROJECT_URL = "https://ar3dstudio.in/3Dprojects/api/projects/jyoti-paradise-local-backup-302a8799";

test("diagnose live Jyoti immutable release asset", async () => {
  const projectRes = await fetch(PROJECT_URL, { redirect: "follow" });
  const projectText = await projectRes.text();
  console.log("JYOTI_LIVE_PROJECT", projectRes.status, projectText.slice(0, 4000));
  assert.equal(projectRes.ok, true, "project runtime must be reachable");

  const payload = JSON.parse(projectText);
  const modelUrl = payload?.model?.url
    ? new URL(payload.model.url, PROJECT_URL).toString()
    : "";
  console.log("JYOTI_LIVE_MODEL_URL", modelUrl);
  assert.ok(modelUrl, "published runtime must expose model URL");

  const head = await fetch(modelUrl, { method: "HEAD", redirect: "follow" });
  console.log("JYOTI_LIVE_MODEL_HEAD", head.status, JSON.stringify(Object.fromEntries(head.headers.entries())));
  if (!head.ok) {
    const getRes = await fetch(modelUrl, {
      method: "GET",
      headers: { Range: "bytes=0-63" },
      redirect: "follow",
    });
    const body = await getRes.text();
    console.log("JYOTI_LIVE_MODEL_GET", getRes.status, body.slice(0, 1200));
  }
});
