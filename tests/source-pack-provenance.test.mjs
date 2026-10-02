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

const pack = {
  format: "rekixo-source-pack",
  version: 1,
  project: { id: "project_sample", slug: "sample-project", name: "Sample Project" },
  sources: [
    {
      id: "source-model",
      filename: "building.fbx",
      mediaType: "application/octet-stream",
      byteSize: 100,
      sha256: "a".repeat(64),
      role: "source-geometry-model",
      authority: "primary",
      capabilities: ["geometry", "materials", "openings"],
    },
    {
      id: "source-plan",
      filename: "floor-plan.dwg",
      mediaType: "image/vnd.dwg",
      byteSize: 200,
      sha256: "b".repeat(64),
      role: "architectural-drawing",
      authority: "primary",
      capabilities: ["geometry", "dimensions", "openings"],
    },
    {
      id: "source-render",
      filename: "exterior.jpg",
      mediaType: "image/jpeg",
      byteSize: 300,
      sha256: "c".repeat(64),
      role: "visual-reference",
      authority: "reference-only",
      capabilities: ["visual-style"],
    },
  ],
  precedence: [
    { capability: "geometry", orderedSourceIds: ["source-model", "source-plan"] },
    { capability: "dimensions", orderedSourceIds: ["source-plan"] },
    { capability: "openings", orderedSourceIds: ["source-plan", "source-model"] },
    { capability: "visual-style", orderedSourceIds: ["source-render"] },
  ],
  claims: [
    {
      id: "claim-room-size",
      sourceId: "source-plan",
      key: "room.size",
      value: [4, 3],
      status: "source-stated",
    },
  ],
};

test("generic source pack contract accepts fingerprinted multi-source evidence", () => {
  assert.doesNotThrow(() => contract.assertProjectSourcePackV1(pack));
  assert.equal(pack.sources.length, 3);
  assert.equal(pack.precedence[0].orderedSourceIds[0], "source-model");
  assert.equal(pack.precedence[1].orderedSourceIds[0], "source-plan");
});

test("source precedence rejects a source that lacks the declared capability", () => {
  const altered = structuredClone(pack);
  const plan = altered.sources.find((source) => source.id === "source-plan");
  plan.capabilities = plan.capabilities.filter((item) => item !== "openings");
  assert.throws(
    () => contract.assertProjectSourcePackV1(altered),
    /Invalid source precedence rule/,
  );
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
          mediaType: "application/octet-stream",
          byteSize: sourceBytes.length,
          sha256: hash,
          role: "source",
          authority: "primary",
          capabilities: ["geometry"],
        },
      ],
      precedence: [],
      claims: [],
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

    const traversal = {
      ...manifest,
      sources: [{ ...manifest.sources[0], filename: "../escape.bin" }],
    };
    await fsp.writeFile(manifestPath, JSON.stringify(traversal));
    await assert.rejects(
      verifySourcePackFiles(manifestPath, directory),
      /Unsafe source filename/,
    );

    const nested = path.join(directory, "nested");
    await fsp.mkdir(nested);
    const nestedFile = path.join(nested, "source.bin");
    await fsp.writeFile(nestedFile, sourceBytes);
    const nestedManifest = {
      ...manifest,
      sources: [{ ...manifest.sources[0], filename: "nested/source.bin" }],
    };
    await fsp.writeFile(manifestPath, JSON.stringify(nestedManifest));
    const nestedResult = await verifySourcePackFiles(manifestPath, directory);
    assert.equal(nestedResult.verified[0].filename, "nested/source.bin");

    const symlinkPath = path.join(directory, "linked.bin");
    try {
      await fsp.symlink(nestedFile, symlinkPath);
      const symlinkManifest = {
        ...manifest,
        sources: [{ ...manifest.sources[0], filename: "linked.bin" }],
      };
      await fsp.writeFile(manifestPath, JSON.stringify(symlinkManifest));
      await assert.rejects(
        verifySourcePackFiles(manifestPath, directory),
        /symlink is not allowed/,
      );
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
    }
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});
