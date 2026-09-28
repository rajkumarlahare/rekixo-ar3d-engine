import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const compile = (file) =>
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const asUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");

const contract = await import(
  asUrl(compile("packages/contracts/src/source-pack-v1.ts"))
);
const pack = JSON.parse(
  fs.readFileSync("project-profiles/jyoti-paradise/source-pack.json", "utf8"),
);

test("canonical Jyoti source pack is valid and keeps all supplied sources fingerprinted", () => {
  assert.doesNotThrow(() => contract.assertProjectSourcePackV1(pack));
  assert.equal(pack.project.slug, "jyoti-paradise");
  assert.equal(pack.sources.length, 6);

  const byId = new Map(pack.sources.map((source) => [source.id, source]));
  assert.equal(
    byId.get("jyoti-source-fbx").sha256,
    "1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0",
  );
  assert.equal(byId.get("jyoti-source-fbx").byteSize, 45530329);
  assert.equal(
    byId.get("jyoti-source-dwg").sha256,
    "e2fbeb3a1feef2e2590133c2de728386cf730dcca73300dde25f2acfd84170fa",
  );
  assert.equal(
    byId.get("jyoti-source-brochure").sha256,
    "482a82c8e29137067cc24ed8072997dff23812b88e4a55ab0c7970204a055442",
  );
  assert.equal(
    byId.get("jyoti-source-render").sha256,
    "800fd18ac455ad867ba9f7ecdc5eab82b3320773c47ade76c1ca0692d563eacc",
  );
});

test("source precedence prevents brochure/render data from becoming silent dimensional truth", () => {
  const rule = (capability) =>
    pack.precedence.find((item) => item.capability === capability);
  assert.deepEqual(rule("dimensions").orderedSourceIds, [
    "jyoti-source-dwg",
    "jyoti-source-brochure",
  ]);
  assert.equal(rule("visual-style").orderedSourceIds[0], "jyoti-source-render");
  assert.equal(
    pack.sources.find((item) => item.id === "jyoti-source-brochure").authority,
    "reference-only",
  );
  assert.equal(
    pack.sources.find((item) => item.id === "jyoti-source-drs").authority,
    "metadata-only",
  );
});

test("source-backed runtime fingerprint and floor levels come from the canonical profile", () => {
  const exterior = fs.readFileSync(
    "apps/public/src/viewer/jyotiReferenceExterior.ts",
    "utf8",
  );
  const profile = fs.readFileSync(
    "apps/public/src/viewer/jyotiSourceProfile.ts",
    "utf8",
  );
  assert.match(exterior, /JYOTI_SOURCE_MODEL_SHA256/);
  assert.match(exterior, /JYOTI_SOURCE_FLOOR_LEVELS_M\.slice\(1\)/);
  assert.doesNotMatch(
    exterior,
    /1dce4dec093ef5707617c99ccb26ad3a5b6cb6c2d02b5efe4a171c852cc616e0/,
  );
  assert.match(profile, /reference-source-v9\/runtime\.json/);

  const runtime = JSON.parse(
    fs.readFileSync("project-profiles/reference-source-v9/runtime.json", "utf8"),
  );
  const floorClaim = pack.claims.find(
    (claim) => claim.key === "audit.architecturalFloorLevelsM",
  );
  const sourceModel = pack.sources.find(
    (source) => source.id === "jyoti-source-fbx",
  );
  assert.equal(runtime.sourceModelSha256, sourceModel.sha256);
  assert.deepEqual(runtime.floorLevelsM, floorClaim.value);
  assert.deepEqual(floorClaim.value, [
    0,
    3.048,
    6.0452,
    9.0424,
    12.0396,
    15.0368,
    18.034,
  ]);
});

test("brochure facts used by the published project remain traceable to page 2 claims", () => {
  const unitSeries = pack.claims.find(
    (claim) => claim.key === "brochure.unitSeries",
  );
  const unitAreas = pack.claims.find(
    (claim) => claim.key === "brochure.unitAreasSqFt",
  );
  const amenities = pack.claims.find(
    (claim) => claim.key === "brochure.amenities",
  );
  const migration = fs.readFileSync(
    "database/migrations/0004_jyoti_final_product_modules.sql",
    "utf8",
  );

  assert.equal(unitSeries.page, 2);
  assert.equal(unitAreas.page, 2);
  for (const series of unitSeries.value) assert.ok(migration.includes(series));
  for (const area of unitAreas.value) assert.ok(migration.includes(String(area)));
  for (const amenity of amenities.value) {
    assert.ok(
      migration.includes(amenity) ||
        fs
          .readFileSync("database/migrations/0003_jyoti_supplied_content_v1.sql", "utf8")
          .includes(amenity),
      amenity,
    );
  }

  const conflict = pack.claims.find(
    (claim) => claim.key === "review.floorCount",
  );
  assert.equal(conflict.status, "conflicted");
  assert.match(conflict.value, /do not infer/i);
});

test("generic verifier detects missing, resized and checksum-mismatched source files", async () => {
  const verifierUrl = pathToFileURL(
    path.resolve("scripts/verify-source-pack.mjs"),
  ).href;
  const { verifySourcePackFiles } = await import(verifierUrl);

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "rekixo-source-pack-"));
  try {
    const sourceBytes = Buffer.from("verified source bytes");
    const hash = createHash("sha256").update(sourceBytes).digest("hex");
    const manifest = {
      format: "rekixo-source-pack",
      version: 1,
      project: { id: "p", slug: "test-project", name: "Test" },
      sources: [
        {
          id: "source",
          filename: "source.bin",
          byteSize: sourceBytes.length,
          sha256: hash,
        },
      ],
    };
    const manifestPath = path.join(directory, "source-pack.json");
    await fsp.writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      verifySourcePackFiles(manifestPath, directory),
      /Missing source file/,
    );

    const sourcePath = path.join(directory, "source.bin");
    await fsp.writeFile(sourcePath, Buffer.from("wrong"));
    await assert.rejects(
      verifySourcePackFiles(manifestPath, directory),
      /size mismatch/,
    );

    await fsp.writeFile(sourcePath, Buffer.alloc(sourceBytes.length, 0x61));
    await assert.rejects(
      verifySourcePackFiles(manifestPath, directory),
      /checksum mismatch/,
    );

    await fsp.writeFile(sourcePath, sourceBytes);
    const result = await verifySourcePackFiles(manifestPath, directory);
    assert.equal(result.verified.length, 1);
    assert.equal(result.verified[0].sha256, hash);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});
