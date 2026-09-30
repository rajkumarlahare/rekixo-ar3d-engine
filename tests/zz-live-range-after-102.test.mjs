import assert from "node:assert/strict";
import test from "node:test";

const publicModel = "https://ar3dstudio.in/3Dprojects/api/releases/release_57c56ec2-50c0-4ee2-b916-df89bead1b94/models/b162a605-c922-4d7d-a4d6-194e44c37a95/content?v=1";
const adminModel = "https://admin.rekixo.com/3Dprojects/api/releases/release_57c56ec2-50c0-4ee2-b916-df89bead1b94/models/b162a605-c922-4d7d-a4d6-194e44c37a95/content?v=1";

for (const [label, url] of [["PUBLIC", publicModel], ["ADMIN", adminModel]]) {
  test(`live ${label} immutable GLB range`, async () => {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-3" },
      redirect: "follow",
    });
    const body = Buffer.from(await res.arrayBuffer());
    console.log("LIVE_RANGE", label, res.status, JSON.stringify(Object.fromEntries(res.headers.entries())), body.toString("ascii"));
    assert.equal(res.status, 206);
    assert.equal(body.toString("ascii"), "glTF");
  });
}
