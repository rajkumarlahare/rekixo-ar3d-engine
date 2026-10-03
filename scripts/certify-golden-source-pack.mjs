#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const GOLDEN_ROLES = [
  "model",
  "cad",
  "sketchup",
  "drawing",
  "visual",
  "metadata",
];
const ROLE_EXTENSIONS = {
  model: new Set(["fbx", "glb"]),
  cad: new Set(["dwg", "dxf"]),
  sketchup: new Set(["skp", "skb"]),
  drawing: new Set(["pdf"]),
  visual: new Set(["png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp"]),
  metadata: new Set(["drs", "json"]),
};
const MAX_DWG_BYTES = 32 * 1024 * 1024;
const NORMALIZED_CONTRACT = "rekixo-dwg-normalized";
const NORMALIZED_VERSION = 1;

function fail(message) {
  console.error(`golden-source-certification: ${message}`);
  process.exitCode = 1;
}

function usage() {
  return `Usage:\n  node scripts/certify-golden-source-pack.mjs manifest --dir <source-dir> --out <manifest.json> [--key <name>]\n  node scripts/certify-golden-source-pack.mjs verify --dir <source-dir> --manifest <manifest.json> [--processor-url <url>] [--out <certificate.json>] [--allow-dwg-pending]\n\nThe six production source files and their manifest must stay outside Git. The manifest contains private fingerprints.`;
}

function parseArgs(argv) {
  const command = argv[2];
  const options = {};
  for (let index = 3; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "allow-dwg-pending") {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--"))
      throw Error(`Missing value for --${key}.`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function extension(fileName) {
  return path.extname(fileName).slice(1).toLowerCase();
}

function roleForFile(fileName) {
  const ext = extension(fileName);
  for (const role of GOLDEN_ROLES)
    if (ROLE_EXTENSIONS[role].has(ext)) return role;
  return undefined;
}

async function fileSha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function discoverPack(dir) {
  const absoluteDir = path.resolve(dir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const role = roleForFile(entry.name);
    if (!role) continue;
    const filePath = path.join(absoluteDir, entry.name);
    const info = await stat(filePath);
    if (!info.isFile()) continue;
    candidates.push({ role, name: entry.name, path: filePath, size: info.size });
  }

  const byRole = new Map();
  for (const role of GOLDEN_ROLES) byRole.set(role, []);
  for (const candidate of candidates) byRole.get(candidate.role).push(candidate);

  const issues = [];
  const resolved = [];
  for (const role of GOLDEN_ROLES) {
    const rows = byRole.get(role);
    if (rows.length === 0) {
      issues.push(`Missing ${role} source.`);
      continue;
    }
    if (rows.length > 1) {
      issues.push(
        `Ambiguous ${role} source: ${rows.map((row) => row.name).join(", ")}.`,
      );
      continue;
    }
    resolved.push(rows[0]);
  }
  return { absoluteDir, resolved, issues };
}

async function fingerprintPack(dir) {
  const discovered = await discoverPack(dir);
  if (discovered.issues.length) throw Error(discovered.issues.join(" "));
  const sources = [];
  for (const source of discovered.resolved) {
    sources.push({
      role: source.role,
      fileName: source.name,
      size: source.size,
      sha256: await fileSha256(source.path),
    });
  }
  return { dir: discovered.absoluteDir, sources };
}

function validateManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Golden manifest must be a JSON object.");
  if (value.schema !== 1 || typeof value.key !== "string" || !value.key.trim())
    throw Error("Golden manifest schema/key is invalid.");
  if (
    !Array.isArray(value.sources) ||
    value.sources.length !== GOLDEN_ROLES.length
  )
    throw Error("Golden manifest must contain exactly six source records.");
  const seen = new Set();
  for (const row of value.sources) {
    if (!row || typeof row !== "object" || !GOLDEN_ROLES.includes(row.role))
      throw Error("Golden manifest contains an unsupported source role.");
    if (seen.has(row.role))
      throw Error(`Golden manifest duplicates role ${row.role}.`);
    seen.add(row.role);
    if (typeof row.fileName !== "string" || !row.fileName.trim())
      throw Error(`Golden manifest ${row.role} filename is invalid.`);
    if (!Number.isSafeInteger(row.size) || row.size <= 0)
      throw Error(`Golden manifest ${row.role} size is invalid.`);
    if (
      typeof row.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(row.sha256)
    )
      throw Error(`Golden manifest ${row.role} SHA-256 is invalid.`);
  }
  for (const role of GOLDEN_ROLES)
    if (!seen.has(role)) throw Error(`Golden manifest is missing ${role}.`);
  return value;
}

async function writeJson(filePath, value) {
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return absolute;
}

async function generateManifest(options) {
  if (!options.dir || !options.out)
    throw Error("manifest requires --dir and --out.");
  const pack = await fingerprintPack(options.dir);
  const manifest = {
    schema: 1,
    key: String(options.key || "private-golden-six-role-pack").trim(),
    generatedAt: new Date().toISOString(),
    sources: pack.sources,
  };
  const output = await writeJson(options.out, manifest);
  console.log(
    JSON.stringify(
      { ok: true, command: "manifest", output, roles: GOLDEN_ROLES.length },
      null,
      2,
    ),
  );
}

function joinedProcessorUrl(value) {
  const url = new URL(value);
  if (url.pathname === "/" || !url.pathname)
    url.pathname = "/v1/dwg/normalize";
  return url.toString();
}

function assetIdFor(source) {
  return `golden_${source.sha256.slice(0, 24)}`;
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function validateNormalizedDwg(document, source, assetId) {
  const problems = [];
  if (
    document?.contract !== NORMALIZED_CONTRACT ||
    document?.version !== NORMALIZED_VERSION
  )
    problems.push("unsupported normalized contract");
  if (document?.source?.assetId !== assetId)
    problems.push("source asset ID mismatch");
  if (
    String(document?.source?.sha256 || "").toLowerCase() !==
    source.sha256.toLowerCase()
  )
    problems.push("source SHA-256 mismatch");
  if (document?.source?.byteSize !== source.size)
    problems.push("source byte-size mismatch");
  if (document?.processor?.engine !== "gnu-libredwg")
    problems.push("unexpected processor engine");
  if (
    document?.units?.reviewed !== true ||
    !(document?.units?.metresPerUnit > 0)
  )
    problems.push("DWG units are unresolved/unreviewed");

  const segments = arrayLength(document?.segments);
  const objects = arrayLength(document?.objects);
  const inserts = arrayLength(document?.inserts);
  if (segments + objects + inserts === 0)
    problems.push(
      "normalized DWG contains no usable architecture/structural geometry",
    );

  return {
    ok: problems.length === 0,
    problems,
    summary: {
      contract: document?.contract,
      version: document?.version,
      versionCode: document?.source?.versionCode,
      processor: document?.processor,
      units: document?.units,
      layers: arrayLength(document?.layers),
      segments,
      texts: arrayLength(document?.texts),
      dimensions: arrayLength(document?.dimensions),
      inserts,
      objects,
      floors: arrayLength(document?.floors),
      issues: Array.isArray(document?.issues) ? document.issues : [],
    },
  };
}

async function certifyDwg(sourceFile, source, processorUrl) {
  if (extension(source.fileName) === "dxf")
    return {
      state: "not-required",
      detail: "Golden CAD source is DXF; native DWG decoding is not required.",
    };
  if (source.size > MAX_DWG_BYTES)
    return {
      state: "blocked",
      detail: `DWG is ${source.size} bytes and exceeds the ${MAX_DWG_BYTES}-byte processor limit.`,
    };
  if (!processorUrl)
    return {
      state: "pending",
      detail:
        "Real DWG bytes were verified, but no native processor URL was supplied.",
    };

  const assetId = assetIdFor(source);
  const bytes = await readFile(sourceFile);
  const response = await fetch(joinedProcessorUrl(processorUrl), {
    method: "POST",
    headers: {
      "content-type": "image/vnd.dwg",
      "x-rekixo-source-asset-id": assetId,
      "x-rekixo-source-sha256": source.sha256,
      "x-rekixo-source-name": source.fileName,
    },
    body: bytes,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return {
      state: "blocked",
      detail: `DWG processor returned HTTP ${response.status} with malformed JSON.`,
    };
  }
  if (!response.ok)
    return {
      state: "blocked",
      detail: `DWG processor returned HTTP ${response.status}: ${String(payload?.error || "unknown error").slice(0, 1200)}`,
    };

  const validation = validateNormalizedDwg(payload, source, assetId);
  return validation.ok
    ? {
        state: "passed",
        detail:
          "Real DWG decoded through the native GNU LibreDWG processor and passed source/units/geometry certification.",
        summary: validation.summary,
      }
    : {
        state: "blocked",
        detail: `Normalized DWG failed certification: ${validation.problems.join("; ")}.`,
        summary: validation.summary,
      };
}

async function verifyPack(options) {
  if (!options.dir || !options.manifest)
    throw Error("verify requires --dir and --manifest.");
  const manifest = validateManifest(
    JSON.parse(await readFile(path.resolve(options.manifest), "utf8")),
  );
  const pack = await fingerprintPack(options.dir);
  const actualByRole = new Map(
    pack.sources.map((source) => [source.role, source]),
  );
  const sourceChecks = [];
  let sourceBlocked = false;

  for (const expected of manifest.sources) {
    const actual = actualByRole.get(expected.role);
    const problems = [];
    if (!actual) problems.push("missing source");
    else {
      if (actual.fileName !== expected.fileName)
        problems.push(`filename mismatch (${actual.fileName})`);
      if (actual.size !== expected.size)
        problems.push(`size mismatch (${actual.size})`);
      if (actual.sha256.toLowerCase() !== expected.sha256.toLowerCase())
        problems.push("SHA-256 mismatch");
    }
    if (problems.length) sourceBlocked = true;
    sourceChecks.push({
      role: expected.role,
      state: problems.length ? "blocked" : "passed",
      detail: problems.length
        ? problems.join("; ")
        : "filename, byte size and SHA-256 matched",
      fileName: actual?.fileName ?? expected.fileName,
      size: actual?.size ?? null,
      sha256: actual?.sha256 ?? null,
    });
  }

  const cadExpected = manifest.sources.find((source) => source.role === "cad");
  const cadActual = actualByRole.get("cad");
  let dwg = {
    state: "blocked",
    detail: "CAD source verification failed before DWG certification.",
  };
  if (!sourceBlocked && cadExpected && cadActual) {
    const cadPath = path.join(pack.dir, cadActual.fileName);
    dwg = await certifyDwg(cadPath, cadExpected, options["processor-url"]);
  }

  const allowPending = Boolean(options["allow-dwg-pending"]);
  const blocked =
    sourceBlocked ||
    dwg.state === "blocked" ||
    (dwg.state === "pending" && !allowPending);
  const certificate = {
    schema: 1,
    kind: "rekixo-golden-source-certification",
    manifestKey: manifest.key,
    certifiedAt: new Date().toISOString(),
    overallStatus: blocked
      ? "blocked"
      : dwg.state === "pending"
        ? "pending"
        : "passed",
    sourcePack: {
      requiredRoles: GOLDEN_ROLES.length,
      matchedRoles: sourceChecks.filter((check) => check.state === "passed")
        .length,
      checks: sourceChecks,
    },
    dwg,
  };

  if (options.out) await writeJson(options.out, certificate);
  console.log(JSON.stringify(certificate, null, 2));
  if (blocked) throw Error("Golden source pack certification is blocked.");
}

async function main() {
  const { command, options } = parseArgs(process.argv);
  if (command === "manifest") return generateManifest(options);
  if (command === "verify") return verifyPack(options);
  throw Error(usage());
}

main().catch((error) =>
  fail(error instanceof Error ? error.message : String(error)),
);
