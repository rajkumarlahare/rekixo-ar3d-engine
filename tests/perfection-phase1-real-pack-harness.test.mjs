import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/certify-golden-source-pack.mjs");
const knownPrivateFingerprint =
  "1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0";

function run(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
  });
}

function makePack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rekixo-golden-pack-"));
  const rows = [
    ["building.fbx", "FBX fixture bytes"],
    ["floor-plan.dwg", "AC1015 fixture bytes"],
    ["materials.skb", "SKB fixture bytes"],
    ["drawing.pdf", "%PDF-1.4 fixture bytes"],
    ["reference.jpg", "JPEG fixture bytes"],
    ["metadata.drs", '{"fixture":true}'],
  ];
  for (const [name, value] of rows)
    fs.writeFileSync(path.join(dir, name), value);
  return dir;
}

test("private golden runner fingerprints six roles and verifies exact bytes", () => {
  const dir = makePack();
  const manifestPath = path.join(dir, "pack.golden-manifest.json");
  const certificatePath = path.join(dir, "certificate.json");

  const generated = run([
    "manifest",
    "--dir",
    dir,
    "--out",
    manifestPath,
    "--key",
    "test-six-role-pack",
  ]);
  assert.equal(generated.status, 0, generated.stderr);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.sources.length, 6);
  assert.deepEqual(
    manifest.sources.map((source) => source.role),
    ["model", "cad", "sketchup", "drawing", "visual", "metadata"],
  );
  for (const source of manifest.sources) {
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(source.size > 0);
  }

  const verified = run([
    "verify",
    "--dir",
    dir,
    "--manifest",
    manifestPath,
    "--allow-dwg-pending",
    "--out",
    certificatePath,
  ]);
  assert.equal(verified.status, 0, verified.stderr);
  const certificate = JSON.parse(fs.readFileSync(certificatePath, "utf8"));
  assert.equal(certificate.overallStatus, "pending");
  assert.equal(certificate.sourcePack.matchedRoles, 6);
  assert.equal(certificate.dwg.state, "pending");
});

test("private golden runner fails closed when any source bytes change", () => {
  const dir = makePack();
  const manifestPath = path.join(dir, "pack.golden-manifest.json");
  const generated = run(["manifest", "--dir", dir, "--out", manifestPath]);
  assert.equal(generated.status, 0, generated.stderr);

  fs.appendFileSync(path.join(dir, "building.fbx"), "tampered");
  const verified = run([
    "verify",
    "--dir",
    dir,
    "--manifest",
    manifestPath,
    "--allow-dwg-pending",
  ]);
  assert.notEqual(verified.status, 0);
  assert.match(verified.stderr, /certification is blocked/i);
});

test("public harness never embeds customer-specific names or fingerprints", () => {
  const runner = fs.readFileSync(script, "utf8");
  const e2e = fs.readFileSync("e2e/golden-source-pack.spec.ts", "utf8");

  for (const source of [runner, e2e]) {
    assert.doesNotMatch(source, /Jyoti/i);
    assert.doesNotMatch(source, new RegExp(knownPrivateFingerprint, "i"));
  }

  assert.match(e2e, /REKIXO_GOLDEN_PACK_DIR/);
  assert.match(e2e, /REKIXO_GOLDEN_MANIFEST/);
  assert.match(e2e, /REKIXO_DWG_PROCESSOR_URL/);
  assert.match(e2e, /test\.skip/);
  assert.match(e2e, /certification \\d\+% \\(0 blocked/);
});
