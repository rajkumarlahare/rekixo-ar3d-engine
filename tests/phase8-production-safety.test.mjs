import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveDraftProjectLocation } from "../workers/admin-cloud.mjs";

const read = (path) => fs.readFileSync(path, "utf8");

test("cloud draft location can be intentionally cleared", () => {
  assert.equal(
    resolveDraftProjectLocation({ location: "" }, { location: "Raipur" }),
    null,
  );
  assert.equal(
    resolveDraftProjectLocation({ location: "   " }, { location: "Raipur" }),
    null,
  );
  assert.equal(
    resolveDraftProjectLocation(
      { location: "  Bilaspur  " },
      { location: "Raipur" },
    ),
    "Bilaspur",
  );
  assert.equal(
    resolveDraftProjectLocation({}, { location: " Raipur " }),
    "Raipur",
  );
  assert.equal(resolveDraftProjectLocation({}, { location: "" }), null);
});

test("unauthenticated login exceptions do not expose internal exception reasons", () => {
  const worker = read("workers/admin-cloud.mjs");
  const start = worker.indexOf("async function login(request, env)");
  const end = worker.indexOf("async function logout", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const loginBlock = worker.slice(start, end);
  assert.match(loginBlock, /const requestId = crypto\.randomUUID\(\)/);
  assert.match(loginBlock, /diagnostic: `login-stage:\$\{stage\}`/);
  assert.match(loginBlock, /requestId,/);
  assert.doesNotMatch(loginBlock, /\breason\s*[:,=]/);
});

test("production workflows use locked dependencies without floating installs", () => {
  const root = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const validate = read(".github/workflows/validate.yml");
  const deploy = read(".github/workflows/deploy-cloudflare.yml");
  const provision = read(".github/workflows/provision-project.yml");

  assert.equal(root.devDependencies.wrangler, "4.146.0");
  assert.equal(root.devDependencies["@playwright/test"], "1.55.1");
  assert.equal(lock.lockfileVersion, 3);
  for (const workflow of [validate, deploy, provision])
    assert.match(workflow, /npm ci/);
  for (const workflow of [deploy, provision]) {
    assert.match(workflow, /npx --no-install wrangler/);
    assert.doesNotMatch(workflow, /wrangler@4/);
  }
  assert.doesNotMatch(deploy, /npm install --no-save/);
});

test("tracked Cloudflare metadata matches Engine R2 binding", () => {
  const resources = JSON.parse(read("cloudflare/resources.json"));
  assert.equal(resources.d1.database_name, "rekixo-3d-production");
  assert.equal(resources.r2.binding, "MODEL_ASSETS");
  assert.equal(resources.r2.bucket_name, "rekixo-3d-assets");
  assert.equal(resources.r2.status, "active");
  assert.equal(resources.workers.admin, "rekixo-3d-admin");
  assert.equal(resources.workers.public, "rekixo-3d-public");
});

test("deployment guide documents selective production behavior", () => {
  const deployment = read("docs/DEPLOYMENT.md");
  assert.match(deployment, /D1 migrations only when migration files changed/);
  assert.match(deployment, /Public Worker only when public runtime\/dependency inputs changed/);
  assert.match(deployment, /Wrangler `4\.146\.0`/);
  assert.match(deployment, /docs\/PHASE-8-CLOSEOUT\.md/);
});


test("production deployment fails closed for direct pushes to main", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /Require merged PR for production push/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /commits\/\$GITHUB_SHA\/pulls/);
  assert.match(workflow, /pr\.merged_at && pr\.base\?\.ref === "main"/);
  assert.match(
    workflow,
    /Production deploy blocked: main commit is not associated with a merged PR\./,
  );
});


test("production shell smoke retries bounded edge propagation and logs diagnostics", () => {
  const workflow = read(".github/workflows/deploy-cloudflare.yml");
  assert.match(workflow, /retry_http\(\)/);
  assert.match(workflow, /for attempt in 1 2 3 4 5 6/);
  assert.match(workflow, /Production shell status summary: admin=\$PAGE_CODE status=\$STATUS_CODE public=\$PUBLIC_CODE/);
  assert.match(workflow, /Public missing project/);
  assert.match(workflow, /Admin asset attempt \$attempt\/6/);
  assert.match(workflow, /Admin JavaScript asset did not become ready/);
});
