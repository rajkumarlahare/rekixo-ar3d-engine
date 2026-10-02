import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Admin and Public workers publish CSP in report-only mode first", () => {
  for (const path of [
    "workers/admin-cloud.mjs",
    "workers/admin.mjs",
    "workers/public.mjs",
    "workers/release-runtime.mjs",
  ]) {
    const source = read(path);
    assert.match(source, /"Content-Security-Policy-Report-Only"/, path);
    assert.doesNotMatch(
      source,
      /"Content-Security-Policy"\s*:/,
      `${path} must not enforce CSP before report-only validation`,
    );
    assert.match(source, /default-src 'self'/, path);
    assert.match(source, /object-src 'none'/, path);
    assert.match(source, /https:\/\/maps\.googleapis\.com/, path);
    assert.match(source, /worker-src 'self' blob:/, path);
  }
});

test("Admin report-only policy blocks framing while Public remains same-origin frameable", () => {
  const admin = read("workers/admin.mjs");
  const publicWorker = read("workers/public.mjs");

  assert.match(admin, /frame-ancestors 'none'/);
  assert.match(publicWorker, /frame-ancestors 'self'/);
});

test("production deployment verifies report-only CSP without silently enforcing it", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");

  assert.match(workflow, /Verify report-only browser security policy/);
  assert.match(workflow, /admin\.rekixo\.com\/3Dprojects/);
  assert.match(workflow, /ar3dstudio\.in\/3Dprojects/);
  assert.match(workflow, /content-security-policy-report-only:/i);
  assert.match(workflow, /Enforcing CSP appeared before report-only validation/);
});
